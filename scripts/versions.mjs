#!/usr/bin/env node
/**
 * Generates VERSIONS.md: every direct dependency of every template and
 * overlay, the version it is pinned at, and the templates that use it.
 *
 *   node scripts/versions.mjs            regenerate, keeping the recorded date
 *   node scripts/versions.mjs --stamp    regenerate and set the date to today
 *   node scripts/versions.mjs --check    exit 1 when the file is not what would be generated
 *
 * The date records when verification last passed (`verify.sh` stamps it).
 * Output is sorted, so `--check` is stable.
 *
 * Node standard library only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'dist', '.next', '.turbo']);
const NODE_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const UNRECORDED = '尚未記錄';
const DATE_LINE = /^最後通過驗證的日期：(.+)$/m;

/**
 * @typedef {object} Dependency
 * @property {'npm'|'pypi'} ecosystem Package index the name belongs to.
 * @property {string} name Package name (PyPI names are normalised).
 * @property {string} spec Version as written in the manifest, without `==` for Python pins.
 * @property {string[]} users Sorted names of the templates and overlays that declare it.
 */

/**
 * Normalise a PyPI project name (PEP 503).
 *
 * @param {string} name Name as written.
 * @returns {string} Lower-case name with runs of `-_.` collapsed to `-`.
 */
export function normalizePypiName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Find every manifest under a directory, skipping build and install output.
 *
 * @param {string} dir Directory to walk.
 * @returns {string[]} Absolute paths of `package.json` and `pyproject.toml` files, sorted.
 */
export function findManifests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...findManifests(full));
    } else if (entry.name === 'package.json' || entry.name === 'pyproject.toml') {
      found.push(full);
    }
  }
  return found.sort();
}

/**
 * Read the direct dependencies of a `package.json`.
 *
 * Workspace, file and link specs are internal packages, not registry
 * dependencies, and are left out.
 *
 * @param {string} text File content.
 * @returns {Array<{name: string, spec: string}>} Dependencies.
 */
export function parsePackageJson(text) {
  const json = JSON.parse(text);
  const out = [];
  for (const section of NODE_SECTIONS) {
    for (const [name, spec] of Object.entries(json[section] ?? {})) {
      if (/^(workspace|file|link):/.test(spec)) continue;
      out.push({ name, spec });
    }
  }
  return out;
}

/**
 * Read the direct dependencies of a `pyproject.toml`: `[project] dependencies`,
 * `[project.optional-dependencies]` and `[dependency-groups]`.
 *
 * This is a line scanner for those arrays, not a TOML parser.
 *
 * @param {string} text File content.
 * @returns {Array<{name: string, spec: string}>} Dependencies; `spec` has `==` removed for exact pins.
 */
export function parsePyproject(text) {
  const out = [];
  let section = '';
  let buffer = null;
  for (const line of text.split('\n')) {
    if (buffer === null) {
      const header = /^\[([^\]]+)\]\s*$/.exec(line);
      if (header) {
        section = header[1].trim();
        continue;
      }
      const start = /^\s*("?[A-Za-z0-9_.-]+"?)\s*=\s*\[(.*)$/.exec(line);
      if (!start) continue;
      const key = start[1].replace(/"/g, '');
      const wanted =
        (section === 'project' && key === 'dependencies') ||
        section === 'project.optional-dependencies' ||
        section === 'dependency-groups';
      if (!wanted) continue;
      buffer = start[2];
    } else {
      buffer += `\n${line}`;
    }
    // The array ends at a `]` outside any string (extras such as `pkg[x]` sit inside strings).
    if (buffer.replace(/"(?:[^"\\]|\\.)*"/g, '""').includes(']')) {
      const withoutTables = buffer.replace(/\{[^}]*\}/g, '');
      for (const m of withoutTables.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const req = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;\s]*)/.exec(m[1]);
        if (!req) continue;
        const rawSpec = req[2];
        out.push({
          name: normalizePypiName(req[1]),
          spec: rawSpec.startsWith('==') ? rawSpec.slice(2) : rawSpec || '*',
        });
      }
      buffer = null;
    }
  }
  return out;
}

/**
 * Collect the direct dependencies of the given targets, merged by package and spec.
 *
 * @param {string} root Repository root that the target directories are relative to.
 * @param {Array<{name: string, dir: string}>} targets Template or overlay names and their directories (relative to root).
 * @returns {Dependency[]} Sorted by ecosystem, name and spec.
 * @throws {Error} When a target directory does not exist.
 */
export function collectDependencies(root, targets) {
  /** @type {Map<string, Dependency>} */
  const merged = new Map();
  for (const target of targets) {
    const dir = path.join(root, target.dir);
    if (!fs.existsSync(dir)) throw new Error(`directory of "${target.name}" does not exist: ${target.dir}`);
    for (const file of findManifests(dir)) {
      const text = fs.readFileSync(file, 'utf8');
      const isNode = path.basename(file) === 'package.json';
      const ecosystem = isNode ? 'npm' : 'pypi';
      for (const { name, spec } of isNode ? parsePackageJson(text) : parsePyproject(text)) {
        const key = `${ecosystem}\0${name}\0${spec}`;
        const entry = merged.get(key) ?? { ecosystem, name, spec, users: [] };
        if (!entry.users.includes(target.name)) entry.users.push(target.name);
        merged.set(key, entry);
      }
    }
  }
  return [...merged.values()]
    .map((d) => ({ ...d, users: [...d.users].sort() }))
    .sort(
      (a, b) =>
        a.ecosystem.localeCompare(b.ecosystem) ||
        a.name.localeCompare(b.name, 'en') ||
        a.spec.localeCompare(b.spec, 'en', { numeric: true }),
    );
}

/**
 * The targets named by `scripts/recipes.mjs`: every template and every overlay.
 *
 * @param {string} [root] Repository root.
 * @returns {Promise<Array<{name: string, dir: string}>>} Targets, sorted by name.
 */
export async function recipeTargets(root = ROOT) {
  const { recipes, overlays } = await import(pathToFileURL(path.join(root, 'scripts/recipes.mjs')).href);
  return [
    ...Object.keys(recipes).map((name) => ({ name, dir: `templates/${name}` })),
    ...Object.keys(overlays).map((name) => ({ name, dir: `overlays/${name}` })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Render VERSIONS.md.
 *
 * @param {Dependency[]} deps Dependencies from {@link collectDependencies}.
 * @param {string} date Date line value (`YYYY-MM-DD` or the unrecorded marker).
 * @returns {string} File content, ending in a newline.
 */
export function renderVersions(deps, date) {
  const npm = deps.filter((d) => d.ecosystem === 'npm');
  const pypi = deps.filter((d) => d.ecosystem === 'pypi');
  const names = (list) => new Set(list.map((d) => d.name));
  const diverging = (list) =>
    [...names(list)].filter((n) => list.filter((d) => d.name === n).length > 1).length;
  const table = (list) => [
    '| 套件 | 版本 | 使用者 |',
    '| --- | --- | --- |',
    ...list.map((d) => `| \`${d.name}\` | \`${d.spec}\` | ${d.users.join(', ')} |`),
  ];
  const lines = [
    '# 套件版本紀錄',
    '',
    `最後通過驗證的日期：${date}`,
    '',
    '本檔由 `node scripts/versions.mjs` 依各範本與 overlay 的依賴清單產生，請勿手動編輯。驗證全部通過後，`scripts/verify.sh` 會更新上方日期。',
    '',
    '「使用者」欄列出宣告該版本的範本與 overlay；overlay 的清單已合併其基底範本的依賴，所以基底範本的套件也會列出 overlay。同一套件在不同範本釘在不同版本時，每個版本各佔一列。',
    '',
    `共 ${names(npm).size} 個 Node 套件、${names(pypi).size} 個 Python 套件；釘在多個版本的套件：Node ${diverging(npm)} 個、Python ${diverging(pypi)} 個。`,
    '',
    '## Node（npm）',
    '',
    ...table(npm),
    '',
    '## Python（PyPI）',
    '',
    ...table(pypi),
    '',
  ];
  return lines.join('\n');
}

/**
 * Describe how two documents differ, line by line.
 *
 * @param {string} actual Content on disk.
 * @param {string} expected Content that would be generated.
 * @returns {string[]} Messages; empty when the two are equal.
 */
export function describeDifference(actual, expected) {
  if (actual === expected) return [];
  const have = actual.split('\n');
  const want = expected.split('\n');
  const haveSet = new Set(have);
  const wantSet = new Set(want);
  const missing = want.filter((l) => !haveSet.has(l));
  const stale = have.filter((l) => !wantSet.has(l));
  const cap = (label, list) => [
    ...list.slice(0, 15).map((l) => `${label} ${l}`),
    ...(list.length > 15 ? [`${label} ... and ${list.length - 15} more`] : []),
  ];
  const out = [...cap('missing from file:', missing), ...cap('stale in file:  ', stale)];
  return out.length > 0 ? out : ['same lines in a different order or spacing'];
}

/**
 * Run the command.
 *
 * @param {string[]} argv Arguments after the script name.
 * @param {object} [options] Overrides for tests.
 * @param {string} [options.root] Repository root.
 * @param {Array<{name: string, dir: string}>} [options.targets] Targets; defaults to the recipes.
 * @param {string} [options.today] Date used by `--stamp` (YYYY-MM-DD).
 * @param {(line: string) => void} [options.log] Output sink.
 * @returns {Promise<number>} Exit code: 0 ok, 1 stale in `--check`, 2 usage or read error.
 */
export async function run(argv, options = {}) {
  const root = options.root ?? ROOT;
  const log = options.log ?? ((line) => console.log(line));
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const flags = new Set(argv);
  const unknown = argv.filter((a) => a !== '--stamp' && a !== '--check');
  if (unknown.length > 0 || (flags.has('--check') && flags.has('--stamp'))) {
    log('usage: node scripts/versions.mjs [--stamp | --check]');
    return 2;
  }
  const file = path.join(root, 'VERSIONS.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const recorded = existing ? DATE_LINE.exec(existing)?.[1] : null;
  const date = flags.has('--stamp') ? today : (recorded ?? UNRECORDED);
  let content;
  try {
    const targets = options.targets ?? (await recipeTargets(root));
    content = renderVersions(collectDependencies(root, targets), date);
  } catch (error) {
    log(`versions: ${error.message}`);
    return 2;
  }
  if (flags.has('--check')) {
    if (existing === null) {
      log('VERSIONS.md does not exist; run: node scripts/versions.mjs');
      return 1;
    }
    const diff = describeDifference(existing, content);
    if (diff.length === 0) return 0;
    log('VERSIONS.md is stale; run: node scripts/versions.mjs');
    diff.forEach((line) => log(`  ${line}`));
    return 1;
  }
  fs.writeFileSync(file, content);
  log(`wrote VERSIONS.md (date: ${date})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
