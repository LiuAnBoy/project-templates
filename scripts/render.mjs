#!/usr/bin/env node
/**
 * Renders the standalone templates under `templates/` and the UI overlays
 * under `overlays/` from the layers in `source/`, following the recipes in
 * `scripts/recipes.mjs`.
 *
 * Usage:
 *   node scripts/render.mjs                    render all templates and overlays
 *   node scripts/render.mjs --only a,b         render only the named ones
 *   node scripts/render.mjs --check            compare a fresh render to the committed output
 *   Options: --root <dir> (repository root), --recipes <file> (recipes module)
 *
 * Rules:
 *   - Layers are copied in order; a later layer overwrites an earlier file.
 *   - Each layer's package.fragment.json is deep-merged (objects merge, arrays
 *     and scalars are replaced by the later layer) into a generated
 *     package.json whose `name` is the template name. Fragments are never
 *     copied. A template with no fragment gets no package.json.
 *   - A layer may hold AGENTS.fragment.md. When any layer does, the fragments
 *     are concatenated in layer order, one blank line apart, into the generated
 *     AGENTS.md; fragments are never copied. With no fragment, a layer's own
 *     AGENTS.md is copied like any file. Four more text outputs are joined the
 *     same way from the `agentsLayers`: env.fragment -> .env.example,
 *     database.fragment.md -> docs/database.md, docs-index.fragment.md ->
 *     docs/README.md and Makefile.fragment -> Makefile.
 *   - Three fragments edit a file that a base layer owns, found in the last of
 *     the `fragmentLayers` that holds it, and each is written only when some
 *     layer has entries, and fails loudly when the file has an unexpected shape:
 *     pyproject.dependencies (one exact pin per line) is inserted, sorted, into
 *     `[project] dependencies` of pyproject.toml; pnpm-allow.fragment (one
 *     package name per line) is merged, sorted, into `onlyBuiltDependencies` of
 *     pnpm-workspace.yaml; prettierignore.fragment (one pattern per line) is
 *     appended to .prettierignore.
 *   - compose.fragment.yml is joined from the layers the target copies (its own
 *     `layers`) into docker-compose.dev.yml, and no file is written when no layer
 *     has one. The first fragment is the main block: its leading comment is the
 *     header. Every other fragment is a store block, a compose file whose only
 *     top-level keys are `services` and `volumes`. The output is the header,
 *     then one `services:` holding every block's services in layer order, then
 *     one `volumes:` likewise. A different top-level key, or a service or volume
 *     named twice, fails the render. A plain concatenation would repeat a key and
 *     a real merge needs a YAML parser, so the join is by section.
 *   - An overlay (recipes `overlays` export: {base, layers}) copies only its own
 *     layers, but its package.json merges the fragments of its base template's
 *     layers and its own, and is named after the base so the project can extend
 *     it as its own. An overlay that replaces its base's manifest or documents
 *     outright names `fragmentLayers` and `agentsLayers` itself, and then only
 *     those layers contribute.
 *   - Existing root pnpm-lock.yaml and uv.lock in the target are preserved.
 *   - --check ignores those lockfiles and build leftovers listed in IGNORED.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRAGMENT = 'package.fragment.json';
const AGENTS_FRAGMENT = 'AGENTS.fragment.md';
/** Text fragments joined block by block into one output file, from the `agentsLayers`. */
const TEXT_JOINS = [
  { fragment: AGENTS_FRAGMENT, output: 'AGENTS.md' },
  { fragment: 'env.fragment', output: '.env.example' },
  { fragment: 'database.fragment.md', output: 'docs/database.md' },
  { fragment: 'docs-index.fragment.md', output: 'docs/README.md' },
  { fragment: 'Makefile.fragment', output: 'Makefile' },
];
const COMPOSE_FRAGMENT = 'compose.fragment.yml';
const COMPOSE_OUTPUT = 'docker-compose.dev.yml';
const PYPROJECT_PINS = 'pyproject.dependencies';
const PNPM_ALLOW = 'pnpm-allow.fragment';
const PRETTIER_FRAGMENT = 'prettierignore.fragment';
/** Every fragment name: never copied into a rendered target. */
const FRAGMENT_NAMES = new Set([
  FRAGMENT,
  ...TEXT_JOINS.map((join) => join.fragment),
  COMPOSE_FRAGMENT,
  PYPROJECT_PINS,
  PNPM_ALLOW,
  PRETTIER_FRAGMENT,
]);
const LOCKFILES = ['pnpm-lock.yaml', 'uv.lock'];
const IGNORED = new Set([
  '.DS_Store',
  'node_modules',
  '.venv',
  '__pycache__',
  '.next',
  'dist',
  'test-results',
  'playwright-report',
]);
const SORTED_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * Check whether a value is a plain object.
 *
 * @param {unknown} value Any value.
 * @returns {boolean} True for non-null, non-array objects.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `source` over `target` without mutating either.
 *
 * @param {Record<string, unknown>} target Base object.
 * @param {Record<string, unknown>} source Overriding object.
 * @returns {Record<string, unknown>} New merged object.
 */
export function deepMerge(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] =
      isPlainObject(value) && isPlainObject(out[key])
        ? deepMerge(out[key], value)
        : structuredClone(value);
  }
  return out;
}

/**
 * Sort the keys of an object alphabetically.
 *
 * @param {Record<string, unknown>} obj Object to sort.
 * @returns {Record<string, unknown>} New object with sorted keys.
 */
function sortKeys(obj) {
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((key) => [key, obj[key]]),
  );
}

/**
 * Build the package.json text for a template from its layers' fragments.
 *
 * @param {string} name Template name, used as the package name.
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {string | null} JSON text, or null when no layer has a fragment.
 */
export function buildPackageJson(name, layerDirs) {
  let merged = null;
  for (const dir of layerDirs) {
    const file = path.join(dir, FRAGMENT);
    if (!fs.existsSync(file)) continue;
    let fragment;
    try {
      fragment = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`invalid JSON in ${file}: ${error.message}`);
    }
    if (!isPlainObject(fragment)) {
      throw new Error(`${file} must contain a JSON object`);
    }
    merged = deepMerge(merged ?? {}, fragment);
  }
  if (merged === null) return null;
  const { name: _ignored, ...rest } = merged;
  for (const key of SORTED_KEYS) {
    if (isPlainObject(rest[key])) rest[key] = sortKeys(rest[key]);
  }
  return `${JSON.stringify({ name, ...rest }, null, 2)}\n`;
}

/**
 * Join the blocks of one fragment name across the layers, in order, one blank
 * line apart. Leading blank lines and trailing whitespace of a block are cut;
 * its first line keeps its indentation, which a Makefile recipe needs.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @param {string} fragment Fragment file name.
 * @returns {string | null} The joined text, or null when no layer has a block.
 */
export function joinFragments(layerDirs, fragment) {
  const parts = [];
  for (const dir of layerDirs) {
    const file = path.join(dir, fragment);
    if (!fs.existsSync(file)) continue;
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/^(?:[ \t]*\r?\n)+/, '')
      .replace(/\s+$/, '');
    if (text !== '') parts.push(text);
  }
  return parts.length === 0 ? null : `${parts.join('\n\n')}\n`;
}

/**
 * Join the AGENTS.fragment.md files of the layers, in order.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {string | null} The document, or null when no layer has a fragment.
 */
export function buildAgentsMd(layerDirs) {
  return joinFragments(layerDirs, AGENTS_FRAGMENT);
}

/**
 * Collect the entries of a line-per-entry fragment across the layers, in order.
 * Blank lines and lines starting with `#` are not entries.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @param {string} fragment Fragment file name.
 * @returns {string[]} Trimmed entries, possibly empty.
 */
function fragmentEntries(layerDirs, fragment) {
  const entries = [];
  for (const dir of layerDirs) {
    const file = path.join(dir, fragment);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const entry = line.trim();
      if (entry !== '' && !entry.startsWith('#')) entries.push(entry);
    }
  }
  return entries;
}

/**
 * Read a file from the last layer that holds it.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @param {string} rel Path relative to a layer.
 * @param {string} reason Why the file is needed, for the error message.
 * @returns {{text: string, file: string}} The content and the file it came from.
 * @throws {Error} When no layer holds the file.
 */
function readFromLayers(layerDirs, rel, reason) {
  for (const dir of [...layerDirs].reverse()) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) return { text: fs.readFileSync(file, 'utf8'), file };
  }
  throw new Error(`${reason}, but no layer holds ${rel}`);
}

/**
 * Normalise a Python requirement to its package name for comparison.
 *
 * @param {string} requirement A requirement such as `Foo_Bar[extra]==1.0`.
 * @returns {string} Lower case name with extras and version cut, `_` and `.` as `-`.
 */
function pythonName(requirement) {
  return requirement
    .replace(/\[.*$/, '')
    .replace(/==.*$/, '')
    .toLowerCase()
    .replace(/[_.]/g, '-');
}

/**
 * Insert pins, sorted by package name, into `[project] dependencies` of a
 * pyproject.toml. The list must be a multi-line array of one quoted
 * requirement per line.
 *
 * @param {string} text The pyproject.toml content.
 * @param {string[]} pins Exact pins such as `sqlalchemy==2.1.8`.
 * @param {string} label Name of the file, for error messages.
 * @returns {string} The new content.
 * @throws {Error} On a pin that is not an exact pin, a package that is already
 *   listed, or a file whose `[project] dependencies` has another shape.
 */
export function insertPyprojectDependencies(text, pins, label) {
  const pinShape = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9,._-]+\])?==[A-Za-z0-9][A-Za-z0-9.!+_-]*$/;
  for (const pin of pins) {
    if (!pinShape.test(pin)) throw new Error(`${PYPROJECT_PINS}: "${pin}" is not an exact pin (name==version)`);
  }
  const lines = text.split('\n');
  const project = lines.findIndex((line) => line.trim() === '[project]');
  if (project === -1) throw new Error(`${label}: no [project] table`);
  let open = -1;
  for (let i = project + 1; i < lines.length; i += 1) {
    if (/^\[/.test(lines[i])) break;
    if (/^dependencies\s*=\s*\[\s*$/.test(lines[i])) {
      open = i;
      break;
    }
  }
  if (open === -1) {
    throw new Error(`${label}: [project] needs a line "dependencies = [" opening a multi-line list`);
  }
  let close = -1;
  const entries = [];
  let indent = '    ';
  for (let i = open + 1; i < lines.length; i += 1) {
    if (/^\s*\]\s*$/.test(lines[i])) {
      close = i;
      break;
    }
    const match = /^(\s+)"([^"]+)",?\s*$/.exec(lines[i]);
    if (!match) throw new Error(`${label}: unexpected line in dependencies: ${lines[i]}`);
    if (entries.length === 0) indent = match[1];
    entries.push(match[2]);
  }
  if (close === -1) throw new Error(`${label}: the dependencies list is not closed`);
  const known = new Set(entries.map(pythonName));
  for (const pin of pins) {
    const name = pythonName(pin);
    if (known.has(name)) throw new Error(`${label}: ${PYPROJECT_PINS} pins "${name}", which is already listed`);
    known.add(name);
  }
  const all = [...entries, ...pins].sort((a, b) => {
    const left = pythonName(a);
    const right = pythonName(b);
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
  lines.splice(open + 1, close - open - 1, ...all.map((entry) => `${indent}"${entry}",`));
  return lines.join('\n');
}

/**
 * Merge package names, sorted, into `onlyBuiltDependencies` of a
 * pnpm-workspace.yaml. The key must be at the top level, followed by `- name`
 * lines; a name that starts with `@` is single-quoted.
 *
 * @param {string} text The pnpm-workspace.yaml content.
 * @param {string[]} names Package names to allow.
 * @param {string} label Name of the file, for error messages.
 * @returns {string} The new content.
 * @throws {Error} On a name that is not a package name or a file whose list has another shape.
 */
export function insertBuildAllowlist(text, names, label) {
  const nameShape = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i;
  for (const name of names) {
    if (!nameShape.test(name)) throw new Error(`${PNPM_ALLOW}: "${name}" is not a package name`);
  }
  const lines = text.split('\n');
  const open = lines.findIndex((line) => /^onlyBuiltDependencies:\s*$/.test(line));
  if (open === -1) throw new Error(`${label}: no top-level "onlyBuiltDependencies:" list`);
  let end = open + 1;
  const current = [];
  for (; end < lines.length; end += 1) {
    const match = /^\s+-\s+(?:'([^']+)'|"([^"]+)"|([^\s#'"]+))\s*$/.exec(lines[end]);
    if (!match) break;
    current.push(match[1] ?? match[2] ?? match[3]);
  }
  if (current.length === 0) throw new Error(`${label}: "onlyBuiltDependencies:" holds no "- name" lines`);
  if (end < lines.length && lines[end].trim() !== '' && /^\s/.test(lines[end])) {
    throw new Error(`${label}: unexpected line in onlyBuiltDependencies: ${lines[end]}`);
  }
  const all = [...new Set([...current, ...names])].sort();
  const quote = (name) => (name.startsWith('@') ? `'${name}'` : name);
  lines.splice(open + 1, end - open - 1, ...all.map((name) => `  - ${quote(name)}`));
  return lines.join('\n');
}

/**
 * Append patterns that a file does not list yet.
 *
 * @param {string} text The .prettierignore content.
 * @param {string[]} patterns Patterns to append, in order.
 * @returns {string} The new content, ending in one newline.
 */
export function appendIgnorePatterns(text, patterns) {
  const present = new Set(text.split('\n').map((line) => line.trim()));
  const added = patterns.filter((pattern, i) => !present.has(pattern) && patterns.indexOf(pattern) === i);
  return `${text.replace(/\s+$/, '')}\n${added.map((pattern) => `${pattern}\n`).join('')}`;
}

/**
 * Join the compose blocks of the layers into one compose file by section.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {string | null} The compose file, or null when no layer has a block.
 * @throws {Error} On a top-level key other than `services` and `volumes`, a
 *   key repeated inside a block, a line that is neither a key, a comment nor
 *   indented, a service or volume named twice, or blocks that define no service.
 */
export function buildCompose(layerDirs) {
  const sections = { services: [], volumes: [] };
  const names = { services: new Set(), volumes: new Set() };
  let header = [];
  let seenFragment = false;
  for (const dir of layerDirs) {
    const file = path.join(dir, COMPOSE_FRAGMENT);
    if (!fs.existsSync(file)) continue;
    const isMain = !seenFragment;
    seenFragment = true;
    /** @type {string[] | null} */
    let current = null;
    let pending = [];
    const keys = new Set();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const key = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(line);
      if (key) {
        if (key[1] !== 'services' && key[1] !== 'volumes') {
          throw new Error(
            `${file}: top-level key "${key[1]}" is not allowed in a compose block (only services and volumes)`,
          );
        }
        const value = (key[2] ?? '').replace(/(^|\s)#.*$/, '').trim();
        if (value !== '' && value !== '{}') {
          throw new Error(`${file}: "${key[1]}:" must open an indented block, found "${value}"`);
        }
        if (keys.has(key[1])) throw new Error(`${file}: top-level key "${key[1]}" appears twice`);
        keys.add(key[1]);
        // The main block's comment before its first key is the file header; any
        // other comment before a key stays with the section that follows it.
        const body = [];
        if (isMain && current === null) header = pending;
        else body.push(...pending);
        pending = [];
        current = body;
        sections[key[1]].push(body);
        continue;
      }
      if (line.trim() === '' || line.startsWith('#') || /^\s/.test(line)) {
        (current ?? pending).push(line);
        continue;
      }
      throw new Error(`${file}: unexpected top-level line in a compose block: ${line}`);
    }
    if (isMain && current === null) header = pending;
  }
  if (!seenFragment) return null;
  const render = (name) => {
    const bodies = sections[name].map((body) => {
      while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
      while (body.length > 0 && body[0].trim() === '') body.shift();
      return body;
    });
    const indent = bodies
      .flat()
      .map((line) => /^(\s+)[^\s#]/.exec(line))
      .find((match) => match);
    const keyIndent = indent ? indent[1].match(/^\s*/)[0] : '  ';
    for (const body of bodies) {
      const own = body
        .map((line) => /^(\s+)([A-Za-z0-9_.-]+):/.exec(line))
        .filter((match) => match && match[1] === keyIndent);
      for (const match of own) {
        if (names[name].has(match[2])) throw new Error(`compose: ${name.slice(0, -1)} "${match[2]}" is defined twice`);
        names[name].add(match[2]);
      }
    }
    const lines = bodies.flat();
    return lines.length === 0 ? null : [`${name}:`, ...lines].join('\n');
  };
  const services = render('services');
  if (services === null) throw new Error('compose fragments define no service');
  const volumes = render('volumes');
  const head = header.join('\n').replace(/^\s+|\s+$/g, '');
  return `${[head === '' ? null : head, services, volumes].filter((part) => part !== null).join('\n\n')}\n`;
}

/**
 * Render one template or overlay into `outDir`, replacing its content but
 * keeping the root lockfiles that already exist there.
 *
 * @param {string} root Repository root.
 * @param {string} name Target name, used in error messages.
 * @param {string[]} layers Layer paths relative to root whose files are copied.
 * @param {string} outDir Absolute target directory.
 * @param {{packageName?: string, fragmentLayers?: string[], agentsLayers?: string[]}} [options]
 *   `packageName` is the generated package name (default `name`);
 *   `fragmentLayers` are the layers whose package fragments are merged, and whose
 *   pins, allowlist names and ignore patterns are inserted (default `layers`);
 *   `agentsLayers` are the layers whose text fragments are joined: AGENTS.md,
 *   .env.example, docs/database.md, docs/README.md and Makefile (default `fragmentLayers`).
 *   The compose file is joined from `layers`.
 * @returns {void}
 * @throws {Error} When a layer directory does not exist.
 */
export function renderTemplate(root, name, layers, outDir, options = {}) {
  const packageName = options.packageName ?? name;
  const fragmentLayers = options.fragmentLayers ?? layers;
  const layerDirs = layers.map((layer) => path.resolve(root, layer));
  const fragmentDirs = fragmentLayers.map((layer) => path.resolve(root, layer));
  const agentsLayers = options.agentsLayers ?? fragmentLayers;
  const agentsDirs = agentsLayers.map((layer) => path.resolve(root, layer));
  const wanted = [...new Set([...layers, ...fragmentLayers, ...agentsLayers])];
  for (const layer of wanted) {
    const dir = path.resolve(root, layer);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`template "${name}": layer directory missing: ${layer}`);
    }
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'render-stage-'));
  try {
    for (const dir of layerDirs) {
      fs.cpSync(dir, staging, {
        recursive: true,
        force: true,
        filter: (src) => {
          const base = path.basename(src);
          return !FRAGMENT_NAMES.has(base) && base !== '.DS_Store';
        },
      });
    }
    /**
     * Write a joined output into the staging directory.
     *
     * @param {string} rel Path relative to the target.
     * @param {string} content File content.
     */
    const emit = (rel, content) => {
      const file = path.join(staging, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    const pkg = buildPackageJson(packageName, fragmentDirs);
    if (pkg !== null) emit('package.json', pkg);
    for (const join of TEXT_JOINS) {
      const text = joinFragments(agentsDirs, join.fragment);
      if (text !== null) emit(join.output, text);
    }
    const compose = buildCompose(layerDirs);
    if (compose !== null) emit(COMPOSE_OUTPUT, compose);
    const pins = fragmentEntries(fragmentDirs, PYPROJECT_PINS);
    if (pins.length > 0) {
      const { text, file } = readFromLayers(fragmentDirs, 'pyproject.toml', `${name} has ${PYPROJECT_PINS}`);
      emit('pyproject.toml', insertPyprojectDependencies(text, pins, file));
    }
    const allowed = fragmentEntries(fragmentDirs, PNPM_ALLOW);
    if (allowed.length > 0) {
      const { text, file } = readFromLayers(fragmentDirs, 'pnpm-workspace.yaml', `${name} has ${PNPM_ALLOW}`);
      emit('pnpm-workspace.yaml', insertBuildAllowlist(text, allowed, file));
    }
    const ignored = fragmentEntries(fragmentDirs, PRETTIER_FRAGMENT);
    if (ignored.length > 0) {
      const { text } = readFromLayers(fragmentDirs, '.prettierignore', `${name} has ${PRETTIER_FRAGMENT}`);
      emit('.prettierignore', appendIgnorePatterns(text, ignored));
    }

    const kept = new Map();
    for (const lock of LOCKFILES) {
      const file = path.join(outDir, lock);
      if (fs.existsSync(file)) kept.set(lock, fs.readFileSync(file));
    }
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.cpSync(staging, outDir, { recursive: true });
    for (const [lock, content] of kept) {
      fs.writeFileSync(path.join(outDir, lock), content);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * List files under a directory, relative and sorted, skipping ignored names.
 *
 * @param {string} dir Directory to walk (may not exist).
 * @param {boolean} [skipLocks] Skip root lockfiles.
 * @returns {string[]} Relative POSIX paths of files.
 */
function listFiles(dir, skipLocks = true) {
  const out = [];
  /** @param {string} current Directory being walked. */
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(dir, full).split(path.sep).join('/');
        if (skipLocks && LOCKFILES.includes(rel)) continue;
        out.push(rel);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * Compare a freshly rendered directory to the committed one.
 *
 * @param {string} expectedDir Fresh render.
 * @param {string} actualDir Committed template directory.
 * @returns {string[]} Human-readable differences; empty when identical.
 */
export function diffDirs(expectedDir, actualDir) {
  const problems = [];
  if (!fs.existsSync(actualDir)) {
    return [`directory missing: ${actualDir}`];
  }
  const expected = listFiles(expectedDir);
  const actual = new Set(listFiles(actualDir));
  for (const rel of expected) {
    if (!actual.has(rel)) {
      problems.push(`missing file: ${rel}`);
      continue;
    }
    const a = path.join(expectedDir, rel);
    const b = path.join(actualDir, rel);
    if (!fs.readFileSync(a).equals(fs.readFileSync(b))) {
      problems.push(`changed file: ${rel}`);
    } else if ((fs.statSync(a).mode & 0o111) !== (fs.statSync(b).mode & 0o111)) {
      problems.push(`changed executable bit: ${rel}`);
    }
    actual.delete(rel);
  }
  for (const rel of [...actual].sort()) problems.push(`extra file: ${rel}`);
  return problems;
}

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {{check: boolean, only: string[] | null, root: string | null, recipes: string | null}} Options.
 * @throws {Error} On an unknown flag or a flag missing its value.
 */
export function parseArgs(argv) {
  const opts = { check: false, only: null, root: null, recipes: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--check') opts.check = true;
    else if (arg === '--only') opts.only = value().split(',').filter(Boolean);
    else if (arg.startsWith('--only=')) {
      opts.only = arg.slice(7).split(',').filter(Boolean);
    } else if (arg === '--root') opts.root = value();
    else if (arg === '--recipes') opts.recipes = value();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

/**
 * Entry point.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {Promise<number>} Process exit code.
 */
async function main(argv) {
  const opts = parseArgs(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(opts.root ?? path.join(here, '..'));
  const recipesFile = path.resolve(opts.recipes ?? path.join(here, 'recipes.mjs'));
  const { recipes, overlays = {} } = await import(pathToFileURL(recipesFile).href);

  /** @type {Record<string, {dir: string, layers: string[], options: object}>} */
  const targets = {};
  for (const [name, layers] of Object.entries(recipes)) {
    targets[name] = { dir: 'templates', layers, options: {} };
  }
  for (const [name, overlay] of Object.entries(overlays)) {
    if (name in targets) throw new Error(`overlay "${name}" has the name of a template`);
    const baseLayers = recipes[overlay.base];
    if (!baseLayers) throw new Error(`overlay "${name}": unknown base "${overlay.base}"`);
    targets[name] = {
      dir: 'overlays',
      layers: overlay.layers,
      options: {
        packageName: overlay.base,
        fragmentLayers: overlay.fragmentLayers ?? [...baseLayers, ...overlay.layers],
        // The base's blocks without the no-library block, so the result is the whole file.
        agentsLayers: overlay.agentsLayers ?? [
          ...baseLayers.filter((layer) => layer !== 'source/ui/plain'),
          ...overlay.layers,
        ],
      },
    };
  }

  const names = opts.only ?? Object.keys(targets);
  if (names.length === 0) throw new Error('--only selected no template');
  const unknown = names.filter((name) => !(name in targets));
  if (unknown.length > 0) {
    throw new Error(
      `unknown template(s): ${unknown.join(', ')} (known: ${Object.keys(targets).join(', ')})`,
    );
  }

  /**
   * Absolute committed output directory of a target.
   *
   * @param {string} name Target name.
   * @returns {string} Directory under templates/ or overlays/.
   */
  const outputOf = (name) => path.join(root, targets[name].dir, name);

  if (!opts.check) {
    for (const name of names) {
      const { layers, options } = targets[name];
      renderTemplate(root, name, layers, outputOf(name), options);
      console.log(`rendered ${name}`);
    }
    return 0;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'render-check-'));
  let failed = false;
  try {
    for (const name of names) {
      const fresh = path.join(scratch, name);
      renderTemplate(root, name, targets[name].layers, fresh, targets[name].options);
      const problems = diffDirs(fresh, outputOf(name));
      if (problems.length === 0) console.log(`ok ${name}`);
      else {
        failed = true;
        console.error(`DIFF ${name}`);
        for (const problem of problems) console.error(`  ${problem}`);
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`render: ${error.message}`);
      process.exit(2);
    },
  );
}
