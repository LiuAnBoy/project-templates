#!/usr/bin/env node
/**
 * Renders the standalone templates under `templates/` from the layers in
 * `source/`, following the recipes in `scripts/recipes.mjs`.
 *
 * Usage:
 *   node scripts/render.mjs                    render all templates
 *   node scripts/render.mjs --only a,b         render only the named templates
 *   node scripts/render.mjs --check            compare a fresh render to templates/
 *   Options: --root <dir> (repository root), --recipes <file> (recipes module)
 *
 * Rules:
 *   - Layers are copied in order; a later layer overwrites an earlier file.
 *   - Each layer's package.fragment.json is deep-merged (objects merge, arrays
 *     and scalars are replaced by the later layer) into a generated
 *     package.json whose `name` is the template name. Fragments are never
 *     copied. A template with no fragment gets no package.json.
 *   - Existing root pnpm-lock.yaml and uv.lock in the target are preserved.
 *   - --check ignores those lockfiles and build leftovers listed in IGNORED.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRAGMENT = 'package.fragment.json';
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
 * Render one template into `outDir`, replacing its content but keeping the
 * root lockfiles that already exist there.
 *
 * @param {string} root Repository root.
 * @param {string} name Template name.
 * @param {string[]} layers Layer paths relative to root.
 * @param {string} outDir Absolute target directory.
 * @returns {void}
 * @throws {Error} When a layer directory does not exist.
 */
export function renderTemplate(root, name, layers, outDir) {
  const layerDirs = layers.map((layer) => path.resolve(root, layer));
  for (const [index, dir] of layerDirs.entries()) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(
        `template "${name}": layer directory missing: ${layers[index]}`,
      );
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
          return base !== FRAGMENT && base !== '.DS_Store';
        },
      });
    }
    const pkg = buildPackageJson(name, layerDirs);
    if (pkg !== null) fs.writeFileSync(path.join(staging, 'package.json'), pkg);

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
  const { recipes } = await import(pathToFileURL(recipesFile).href);

  const names = opts.only ?? Object.keys(recipes);
  if (names.length === 0) throw new Error('--only selected no template');
  const unknown = names.filter((name) => !(name in recipes));
  if (unknown.length > 0) {
    throw new Error(
      `unknown template(s): ${unknown.join(', ')} (known: ${Object.keys(recipes).join(', ')})`,
    );
  }

  const templatesDir = path.join(root, 'templates');
  if (!opts.check) {
    for (const name of names) {
      renderTemplate(root, name, recipes[name], path.join(templatesDir, name));
      console.log(`rendered ${name}`);
    }
    return 0;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'render-check-'));
  let failed = false;
  try {
    for (const name of names) {
      const fresh = path.join(scratch, name);
      renderTemplate(root, name, recipes[name], fresh);
      const problems = diffDirs(fresh, path.join(templatesDir, name));
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
