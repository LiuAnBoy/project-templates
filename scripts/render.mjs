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
 *     AGENTS.md is copied like any file.
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
 * Join the AGENTS.fragment.md files of the layers, in order.
 *
 * @param {string[]} layerDirs Absolute layer directories in order.
 * @returns {string | null} The document, or null when no layer has a fragment.
 */
export function buildAgentsMd(layerDirs) {
  const parts = [];
  for (const dir of layerDirs) {
    const file = path.join(dir, AGENTS_FRAGMENT);
    if (!fs.existsSync(file)) continue;
    parts.push(fs.readFileSync(file, 'utf8').trim());
  }
  return parts.length === 0 ? null : `${parts.join('\n\n')}\n`;
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
 *   `fragmentLayers` are the layers whose package fragments are merged (default `layers`);
 *   `agentsLayers` are the layers whose AGENTS fragments are joined (default `fragmentLayers`).
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
          return base !== FRAGMENT && base !== AGENTS_FRAGMENT && base !== '.DS_Store';
        },
      });
    }
    const pkg = buildPackageJson(packageName, fragmentDirs);
    if (pkg !== null) fs.writeFileSync(path.join(staging, 'package.json'), pkg);
    const agents = buildAgentsMd(agentsDirs);
    if (agents !== null) fs.writeFileSync(path.join(staging, 'AGENTS.md'), agents);

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
