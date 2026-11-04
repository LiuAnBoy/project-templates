#!/usr/bin/env node
/**
 * Guards render.mjs with fixture layers built in a temp directory.
 * Run with plain `node scripts/test-render.mjs`; exits non-zero on failure.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'render.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'test-render-'));
let counter = 0;

/**
 * Write a file, creating parent directories.
 *
 * @param {string} file Absolute path.
 * @param {string} content File content.
 * @param {number} [mode] Optional file mode.
 * @returns {void}
 */
function put(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode !== undefined) fs.chmodSync(file, mode);
}

/**
 * Build a fixture repository with layers and a recipes module.
 *
 * @returns {{root: string, recipes: string}} Fixture paths.
 */
function fixture() {
  counter += 1;
  const root = path.join(base, `repo${counter}`);
  put(path.join(root, 'source/a/shared.txt'), 'from a\n');
  put(path.join(root, 'source/a/only-a.txt'), 'a\n');
  put(path.join(root, 'source/a/run.sh'), '#!/bin/sh\n', 0o755);
  put(path.join(root, 'source/a/nested/package.fragment.json'), '{"x":1}');
  put(
    path.join(root, 'source/a/package.fragment.json'),
    JSON.stringify({
      name: 'ignored-name',
      scripts: { lint: 'a-lint', test: 'a-test' },
      dependencies: { zeta: '1.0.0', alpha: '1.0.0' },
      nested: { keep: 1, over: 'a' },
      list: ['a'],
    }),
  );
  put(path.join(root, 'source/b/shared.txt'), 'from b\n');
  put(path.join(root, 'source/b/only-b.txt'), 'b\n');
  put(
    path.join(root, 'source/b/package.fragment.json'),
    JSON.stringify({
      scripts: { lint: 'b-lint' },
      dependencies: { beta: '2.0.0' },
      nested: { over: 'b', added: true },
      list: ['b1', 'b2'],
    }),
  );
  const recipes = path.join(root, 'recipes.mjs');
  put(
    recipes,
    `export const recipes = {
  ab: ['source/a', 'source/b'],
  ba: ['source/b', 'source/a'],
  withplain: ['source/a', 'source/ui/plain'],
  broken: ['source/a', 'source/nope'],
  nofrag: ['source/c'],
};
export const overlays = {
  over: { base: 'ab', layers: ['source/o'] },
};\n`,
  );
  put(path.join(root, 'source/o/shared.txt'), 'from overlay\n');
  put(path.join(root, 'source/o/only-o.txt'), 'o\n');
  put(path.join(root, 'source/a/AGENTS.fragment.md'), '# Doc\n\nblock a\n');
  put(path.join(root, 'source/b/AGENTS.fragment.md'), '## B\n\nblock b\n\n\n');
  put(path.join(root, 'source/o/AGENTS.fragment.md'), '## O\n\nblock o\n');
  put(path.join(root, 'source/ui/plain/AGENTS.fragment.md'), '## Plain\n\nno library\n');
  put(path.join(root, 'source/o/nested/deep.txt'), 'deep\n');
  put(
    path.join(root, 'source/o/package.fragment.json'),
    JSON.stringify({
      name: 'overlay-name',
      scripts: { lint: 'o-lint' },
      dependencies: { omega: '3.0.0' },
    }),
  );
  put(path.join(root, 'source/c/file.txt'), 'c\n');
  return { root, recipes };
}

/**
 * Run render.mjs against a fixture.
 *
 * @param {{root: string, recipes: string}} fx Fixture.
 * @param {string[]} args Extra arguments.
 * @returns {{code: number, out: string}} Exit code and combined output.
 */
function render(fx, args) {
  const result = spawnSync(
    process.execPath,
    [RENDER, '--root', fx.root, '--recipes', fx.recipes, ...args],
    { encoding: 'utf8' },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** @type {Array<[string, () => void | Promise<void>]>} */
const tests = [];
/**
 * Register a test.
 *
 * @param {string} name Test name.
 * @param {() => void | Promise<void>} fn Test body.
 * @returns {void}
 */
const test = (name, fn) => tests.push([name, fn]);

test('merges fragments deeply, names the package, never copies fragments', () => {
  const fx = fixture();
  assert.equal(render(fx, ['--only', 'ab']).code, 0);
  const dir = path.join(fx.root, 'templates/ab');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'ab');
  assert.deepEqual(pkg.scripts, { lint: 'b-lint', test: 'a-test' });
  assert.deepEqual(Object.keys(pkg.dependencies), ['alpha', 'beta', 'zeta']);
  assert.deepEqual(pkg.nested, { keep: 1, over: 'b', added: true });
  assert.deepEqual(pkg.list, ['b1', 'b2']);
  assert.equal(fs.existsSync(path.join(dir, 'package.fragment.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'nested/package.fragment.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'only-a.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'only-b.txt')), true);
  assert.notEqual(fs.statSync(path.join(dir, 'run.sh')).mode & 0o111, 0);
});

test('later layer wins and order matters', () => {
  const fx = fixture();
  assert.equal(render(fx, ['--only', 'ab,ba']).code, 0);
  const read = (n, f) => fs.readFileSync(path.join(fx.root, 'templates', n, f), 'utf8');
  assert.equal(read('ab', 'shared.txt'), 'from b\n');
  assert.equal(read('ba', 'shared.txt'), 'from a\n');
  const ba = JSON.parse(read('ba', 'package.json'));
  assert.equal(ba.scripts.lint, 'a-lint');
  assert.deepEqual(ba.list, ['a']);
});

test('a template without fragments gets no package.json', () => {
  const fx = fixture();
  assert.equal(render(fx, ['--only', 'nofrag']).code, 0);
  assert.equal(fs.existsSync(path.join(fx.root, 'templates/nofrag/package.json')), false);
  assert.equal(fs.existsSync(path.join(fx.root, 'templates/nofrag/file.txt')), true);
});

test('preserves root lockfiles and removes stale files', () => {
  const fx = fixture();
  const dir = path.join(fx.root, 'templates/ab');
  put(path.join(dir, 'pnpm-lock.yaml'), 'lock-a\n');
  put(path.join(dir, 'uv.lock'), 'lock-b\n');
  put(path.join(dir, 'stale.txt'), 'old\n');
  put(path.join(dir, 'sub/stale.txt'), 'old\n');
  put(path.join(dir, 'sub/pnpm-lock.yaml'), 'nested lock is not preserved\n');
  assert.equal(render(fx, ['--only', 'ab']).code, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8'), 'lock-a\n');
  assert.equal(fs.readFileSync(path.join(dir, 'uv.lock'), 'utf8'), 'lock-b\n');
  assert.equal(fs.existsSync(path.join(dir, 'stale.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'sub')), false);
});

test('--check passes on a fresh render and ignores lockfiles', () => {
  const fx = fixture();
  render(fx, ['--only', 'ab']);
  put(path.join(fx.root, 'templates/ab/pnpm-lock.yaml'), 'whatever\n');
  const result = render(fx, ['--check', '--only', 'ab']);
  assert.equal(result.code, 0, result.out);
});

test('--check catches a changed file', () => {
  const fx = fixture();
  render(fx, ['--only', 'ab']);
  put(path.join(fx.root, 'templates/ab/only-a.txt'), 'edited by hand\n');
  const result = render(fx, ['--check', '--only', 'ab']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /changed file: only-a\.txt/);
});

test('--check catches a missing file, an extra file and a lost executable bit', () => {
  const fx = fixture();
  render(fx, ['--only', 'ab']);
  const dir = path.join(fx.root, 'templates/ab');
  fs.rmSync(path.join(dir, 'only-b.txt'));
  put(path.join(dir, 'extra.txt'), 'x\n');
  fs.chmodSync(path.join(dir, 'run.sh'), 0o644);
  const result = render(fx, ['--check', '--only', 'ab']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /missing file: only-b\.txt/);
  assert.match(result.out, /extra file: extra\.txt/);
  assert.match(result.out, /executable bit: run\.sh/);
});

test('--check fails when the template directory does not exist', () => {
  const fx = fixture();
  const result = render(fx, ['--check', '--only', 'ab']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /directory missing/);
});

test('a missing layer fails only for a template selected by --only', () => {
  const fx = fixture();
  const selected = render(fx, ['--only', 'broken']);
  assert.notEqual(selected.code, 0);
  assert.match(selected.out, /source\/nope/);
  assert.equal(render(fx, ['--only', 'ab']).code, 0);
  assert.notEqual(render(fx, []).code, 0, 'rendering all must hit the broken recipe');
});

test('an unknown --only name fails', () => {
  const fx = fixture();
  const result = render(fx, ['--only', 'ab,zzz']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /zzz/);
});

test('an overlay holds only its own files and the merged package.json of its base', () => {
  const fx = fixture();
  assert.equal(render(fx, ['--only', 'over']).code, 0);
  const dir = path.join(fx.root, 'overlays/over');
  assert.equal(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8'), 'from overlay\n');
  assert.equal(fs.existsSync(path.join(dir, 'only-o.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'nested/deep.txt')), true);
  // Files of the base layers are not copied into the overlay.
  assert.equal(fs.existsSync(path.join(dir, 'only-a.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'only-b.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'package.fragment.json')), false);
  assert.equal(fs.existsSync(path.join(fx.root, 'templates/over')), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  // Named after the base, never after the overlay, and a full manifest.
  assert.equal(pkg.name, 'ab');
  assert.deepEqual(pkg.scripts, { lint: 'o-lint', test: 'a-test' });
  assert.deepEqual(Object.keys(pkg.dependencies), ['alpha', 'beta', 'omega', 'zeta']);
  assert.deepEqual(pkg.list, ['b1', 'b2']);
});

test('AGENTS.md is joined from fragments in layer order and fragments are not copied', () => {
  const fx = fixture();
  assert.equal(render(fx, ['--only', 'ab,ba']).code, 0);
  const read = (n) => fs.readFileSync(path.join(fx.root, 'templates', n, 'AGENTS.md'), 'utf8');
  assert.equal(read('ab'), '# Doc\n\nblock a\n\n## B\n\nblock b\n');
  assert.equal(read('ba'), '## B\n\nblock b\n\n# Doc\n\nblock a\n');
  assert.equal(fs.existsSync(path.join(fx.root, 'templates/ab/AGENTS.fragment.md')), false);
  // A layer with no fragment adds nothing, and without any fragment nothing is generated.
  assert.equal(render(fx, ['--only', 'nofrag']).code, 0);
  assert.equal(fs.existsSync(path.join(fx.root, 'templates/nofrag/AGENTS.md')), false);
});

test('an overlay AGENTS.md is the whole file: base blocks without the plain block, plus its own', () => {
  const fx = fixture();
  fs.appendFileSync(fx.recipes, "recipes.ab = ['source/a', 'source/b', 'source/ui/plain'];\n");
  assert.equal(render(fx, ['--only', 'ab,over']).code, 0);
  const base = fs.readFileSync(path.join(fx.root, 'templates/ab/AGENTS.md'), 'utf8');
  assert.match(base, /no library/);
  const over = fs.readFileSync(path.join(fx.root, 'overlays/over/AGENTS.md'), 'utf8');
  assert.equal(over, '# Doc\n\nblock a\n\n## B\n\nblock b\n\n## O\n\nblock o\n');
});

test('--check catches a hand-edited generated AGENTS.md', () => {
  const fx = fixture();
  render(fx, ['--only', 'ab']);
  put(path.join(fx.root, 'templates/ab/AGENTS.md'), 'edited by hand\n');
  const result = render(fx, ['--check', '--only', 'ab']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /changed file: AGENTS\.md/);
});

test('an overlay keeps its lockfile and drops stale files', () => {
  const fx = fixture();
  const dir = path.join(fx.root, 'overlays/over');
  put(path.join(dir, 'pnpm-lock.yaml'), 'overlay-lock\n');
  put(path.join(dir, 'stale.txt'), 'old\n');
  assert.equal(render(fx, ['--only', 'over']).code, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8'), 'overlay-lock\n');
  assert.equal(fs.existsSync(path.join(dir, 'stale.txt')), false);
});

test('a template and an overlay render together', () => {
  const fx = fixture();
  const result = render(fx, ['--only', 'ab,over']);
  assert.equal(result.code, 0, result.out);
  assert.equal(fs.existsSync(path.join(fx.root, 'templates/ab/package.json')), true);
  assert.equal(fs.existsSync(path.join(fx.root, 'overlays/over/package.json')), true);
});

test('--check covers overlays: fresh render passes, edits and a missing directory fail', () => {
  const fx = fixture();
  render(fx, ['--only', 'over']);
  put(path.join(fx.root, 'overlays/over/pnpm-lock.yaml'), 'ignored\n');
  assert.equal(render(fx, ['--check', '--only', 'over']).code, 0);

  put(path.join(fx.root, 'overlays/over/only-o.txt'), 'edited\n');
  put(path.join(fx.root, 'overlays/over/extra.txt'), 'x\n');
  const changed = render(fx, ['--check', '--only', 'over']);
  assert.notEqual(changed.code, 0);
  assert.match(changed.out, /changed file: only-o\.txt/);
  assert.match(changed.out, /extra file: extra\.txt/);

  fs.rmSync(path.join(fx.root, 'overlays/over'), { recursive: true });
  const missing = render(fx, ['--check', '--only', 'over']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.out, /directory missing/);
});

test('an overlay with an unknown base fails', () => {
  const fx = fixture();
  fs.appendFileSync(fx.recipes, "overlays.lost = { base: 'zzz', layers: ['source/o'] };\n");
  const result = render(fx, ['--only', 'over']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /unknown base "zzz"/);
});

test('an overlay that names its fragment and AGENTS layers drops the base contributions', () => {
  const fx = fixture();
  fs.appendFileSync(
    fx.recipes,
    "overlays.solo = { base: 'ab', layers: ['source/o'], fragmentLayers: ['source/o'], agentsLayers: ['source/o'] };\n",
  );
  assert.equal(render(fx, ['--only', 'solo']).code, 0);
  const dir = path.join(fx.root, 'overlays/solo');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'ab');
  assert.deepEqual(pkg.scripts, { lint: 'o-lint' });
  assert.deepEqual(Object.keys(pkg.dependencies), ['omega']);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), '## O\n\nblock o\n');
});

/**
 * Build a fixture repository from a file map and a recipes source.
 *
 * @param {Record<string, string>} files Path relative to the root, to content.
 * @param {string} recipesSource Source of the recipes module.
 * @returns {{root: string, recipes: string}} Fixture paths.
 */
function custom(files, recipesSource) {
  counter += 1;
  const root = path.join(base, `repo${counter}`);
  for (const [rel, content] of Object.entries(files)) put(path.join(root, rel), content);
  const recipes = path.join(root, 'recipes.mjs');
  put(recipes, recipesSource);
  return { root, recipes };
}

/**
 * Read a rendered file.
 *
 * @param {{root: string}} fx Fixture.
 * @param {string} rel Path under the root.
 * @returns {string} Content.
 */
const read = (fx, rel) => fs.readFileSync(path.join(fx.root, rel), 'utf8');

const COMPOSE_MAIN = '# Dev only.\n# Start: docker compose up.\n';
const COMPOSE_PG =
  'services:\n  postgres:\n    image: postgres:18-alpine\n    healthcheck:\n      test: ["CMD", "pg_isready"]\nvolumes:\n  postgres-data:\n';
const COMPOSE_REDIS =
  'services:\n  redis:\n    image: redis:8-alpine\nvolumes:\n  redis-data:\n';

/**
 * A fixture with a base layer and an overlay that carries compose blocks.
 *
 * @param {Record<string, string>} extra Extra files, which override the defaults.
 * @returns {{root: string, recipes: string}} Fixture.
 */
function composeFixture(extra = {}) {
  return custom(
    {
      'source/base/keep.txt': 'base\n',
      'source/m/compose.fragment.yml': COMPOSE_MAIN,
      'source/pg/compose.fragment.yml': COMPOSE_PG,
      'source/rd/compose.fragment.yml': COMPOSE_REDIS,
      'source/none/file.txt': 'none\n',
      ...extra,
    },
    `export const recipes = { b: ['source/base'] };
export const overlays = {
  both: { base: 'b', layers: ['source/m', 'source/pg', 'source/rd'] },
  solo: { base: 'b', layers: ['source/none'] },
  pgonly: { base: 'b', layers: ['source/m', 'source/pg'] },
};\n`,
  );
}

test('compose blocks join by section: one services key, volumes under one key, layer order', () => {
  const fx = composeFixture();
  assert.equal(render(fx, ['--only', 'both']).code, 0);
  const out = read(fx, 'overlays/both/docker-compose.dev.yml');
  assert.equal(
    out,
    `${COMPOSE_MAIN}
services:
  postgres:
    image: postgres:18-alpine
    healthcheck:
      test: ["CMD", "pg_isready"]
  redis:
    image: redis:8-alpine

volumes:
  postgres-data:
  redis-data:
`,
  );
  assert.equal(out.match(/^services:/gm).length, 1);
  assert.equal(out.match(/^volumes:/gm).length, 1);
  assert.equal(fs.existsSync(path.join(fx.root, 'overlays/both/compose.fragment.yml')), false);
  // Layer order decides service order.
  const swapped = composeFixture();
  fs.appendFileSync(
    swapped.recipes,
    "overlays.swap = { base: 'b', layers: ['source/m', 'source/rd', 'source/pg'] };\n",
  );
  assert.equal(render(swapped, ['--only', 'swap']).code, 0);
  const text = read(swapped, 'overlays/swap/docker-compose.dev.yml');
  assert.ok(text.indexOf('  redis:') < text.indexOf('  postgres:'));
});

test('an overlay with no compose fragment has no compose file', () => {
  const fx = composeFixture();
  assert.equal(render(fx, ['--only', 'solo']).code, 0);
  assert.equal(fs.existsSync(path.join(fx.root, 'overlays/solo/docker-compose.dev.yml')), false);
  assert.equal(fs.existsSync(path.join(fx.root, 'overlays/solo/file.txt')), true);
});

test('a compose block without volumes writes no volumes key', () => {
  const fx = composeFixture({ 'source/pg/compose.fragment.yml': 'services:\n  postgres:\n    image: x\n' });
  assert.equal(render(fx, ['--only', 'pgonly']).code, 0);
  assert.equal(
    read(fx, 'overlays/pgonly/docker-compose.dev.yml'),
    `${COMPOSE_MAIN}\nservices:\n  postgres:\n    image: x\n`,
  );
});

test('a compose block with another top-level key fails the render', () => {
  for (const key of ['name: app\n', 'networks:\n  net: {}\n', 'include:\n  - other.yml\n']) {
    const fx = composeFixture({ 'source/pg/compose.fragment.yml': `${COMPOSE_PG}${key}` });
    const result = render(fx, ['--only', 'pgonly']);
    assert.notEqual(result.code, 0, key);
    assert.match(result.out, /top-level key "(name|networks|include)" is not allowed/);
  }
  const odd = composeFixture({ 'source/pg/compose.fragment.yml': 'services:\n  a: {}\nstray line\n' });
  assert.match(render(odd, ['--only', 'pgonly']).out, /unexpected top-level line/);
});

test('a top-level key may carry a trailing comment', () => {
  const fx = composeFixture({
    'source/pg/compose.fragment.yml': 'services: # the store\n  postgres:\n    image: x\nvolumes: {} # none\n',
  });
  assert.equal(render(fx, ['--only', 'pgonly']).code, 0);
  assert.equal(
    read(fx, 'overlays/pgonly/docker-compose.dev.yml'),
    `${COMPOSE_MAIN}\nservices:\n  postgres:\n    image: x\n`,
  );
  const bad = composeFixture({ 'source/pg/compose.fragment.yml': 'services: value # note\n' });
  assert.match(render(bad, ['--only', 'pgonly']).out, /must open an indented block/);
});

test('a service named twice, or blocks with no service, fail the render', () => {
  const dup = composeFixture({ 'source/rd/compose.fragment.yml': 'services:\n  postgres:\n    image: x\n' });
  const result = render(dup, ['--only', 'both']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /service "postgres" is defined twice/);
  const none = composeFixture({ 'source/pg/compose.fragment.yml': '# nothing\n' });
  assert.match(render(none, ['--only', 'pgonly']).out, /define no service/);
});

test('env, database, docs-index and Makefile fragments are joined in agentsLayers order', () => {
  const fx = custom(
    {
      'source/a/env.fragment': 'A=1\n',
      'source/b/env.fragment': '\n\nB=2\nC=3\n\n',
      'source/a/database.fragment.md': '## Tables\n\nnone\n',
      'source/b/database.fragment.md': '## Store\n\nmore\n',
      'source/a/docs-index.fragment.md': '# Docs\n',
      'source/b/Makefile.fragment': '\ttab-first-line\n',
      'source/a/Makefile.fragment': 'all:\n\t@echo a\n',
      'source/o/keep.txt': 'o\n',
      'source/o/env.fragment': 'O=9\n',
    },
    `export const recipes = { ab: ['source/a', 'source/b'], ba: ['source/b', 'source/a'] };
export const overlays = { over: { base: 'ab', layers: ['source/o'] } };\n`,
  );
  assert.equal(render(fx, ['--only', 'ab,ba,over']).code, 0);
  assert.equal(read(fx, 'templates/ab/.env.example'), 'A=1\n\nB=2\nC=3\n');
  assert.equal(read(fx, 'templates/ba/.env.example'), 'B=2\nC=3\n\nA=1\n');
  assert.equal(read(fx, 'templates/ab/docs/database.md'), '## Tables\n\nnone\n\n## Store\n\nmore\n');
  assert.equal(read(fx, 'templates/ab/docs/README.md'), '# Docs\n');
  assert.equal(read(fx, 'templates/ab/Makefile'), 'all:\n\t@echo a\n\n\ttab-first-line\n');
  // The overlay holds the base's blocks and its own, as one whole file.
  assert.equal(read(fx, 'overlays/over/.env.example'), 'A=1\n\nB=2\nC=3\n\nO=9\n');
  for (const name of ['env.fragment', 'database.fragment.md', 'docs-index.fragment.md', 'Makefile.fragment']) {
    assert.equal(fs.existsSync(path.join(fx.root, 'templates/ab', name)), false);
  }
  assert.equal(fs.existsSync(path.join(fx.root, 'overlays/over/Makefile')), true);
});

/**
 * A fixture whose base holds pyproject.toml, pnpm-workspace.yaml and
 * .prettierignore, and whose overlay holds the fragments that edit them.
 *
 * @param {Record<string, string>} extra Files that override or add to the defaults.
 * @returns {{root: string, recipes: string}} Fixture.
 */
function insertFixture(extra = {}) {
  return custom(
    {
      'source/base/pyproject.toml':
        '[project]\nname = "x"\ndependencies = [\n    "zeta==1.0",\n    "alpha==1.0",\n]\n\n[tool.other]\ndependencies = ["keep"]\n',
      'source/base/pnpm-workspace.yaml':
        "packages:\n  - web\nonlyBuiltDependencies:\n  - '@nestjs/core'\n  - esbuild\noverrides:\n  fastify: 1\n",
      'source/base/.prettierignore': 'dist\nnode_modules\n',
      'source/o/pyproject.dependencies': '# pins\nmiddle==2.0\nBeta_pkg[extra]==3.1\n',
      'source/o/pnpm-allow.fragment': 'better-sqlite3\n@a/first\nesbuild\n',
      'source/o/prettierignore.fragment': 'drizzle\ndist\ndrizzle\n',
      ...extra,
    },
    `export const recipes = { b: ['source/base'] };
export const overlays = { over: { base: 'b', layers: ['source/o'] } };\n`,
  );
}

test('pins, allowlist names and ignore lines are inserted, sorted, into the base files', () => {
  const fx = insertFixture();
  assert.equal(render(fx, ['--only', 'over']).code, 0, 'render');
  assert.equal(
    read(fx, 'overlays/over/pyproject.toml'),
    '[project]\nname = "x"\ndependencies = [\n    "alpha==1.0",\n    "Beta_pkg[extra]==3.1",\n    "middle==2.0",\n    "zeta==1.0",\n]\n\n[tool.other]\ndependencies = ["keep"]\n',
  );
  assert.equal(
    read(fx, 'overlays/over/pnpm-workspace.yaml'),
    "packages:\n  - web\nonlyBuiltDependencies:\n  - '@a/first'\n  - '@nestjs/core'\n  - better-sqlite3\n  - esbuild\noverrides:\n  fastify: 1\n",
  );
  assert.equal(read(fx, 'overlays/over/.prettierignore'), 'dist\nnode_modules\ndrizzle\n');
  for (const name of ['pyproject.dependencies', 'pnpm-allow.fragment', 'prettierignore.fragment']) {
    assert.equal(fs.existsSync(path.join(fx.root, 'overlays/over', name)), false);
  }
});

test('the inserts write nothing when no layer has entries', () => {
  const fx = insertFixture({
    'source/o/pyproject.dependencies': '# none\n\n',
    'source/o/pnpm-allow.fragment': '',
    'source/o/prettierignore.fragment': '\n',
    'source/o/keep.txt': 'o\n',
  });
  assert.equal(render(fx, ['--only', 'over']).code, 0);
  for (const name of ['pyproject.toml', 'pnpm-workspace.yaml', '.prettierignore']) {
    assert.equal(fs.existsSync(path.join(fx.root, 'overlays/over', name)), false, name);
  }
});

test('the inserts fail loudly on an unknown shape', () => {
  const cases = [
    ['source/base/pyproject.toml', '[project]\ndependencies = ["one"]\n', /dependencies = \[/],
    ['source/base/pyproject.toml', '[project]\ndependencies = [\n  "a==1"  # note\n]\n', /unexpected line in dependencies/],
    ['source/base/pyproject.toml', '[tool.x]\nfoo = 1\n', /no \[project\] table/],
    ['source/base/pyproject.toml', '[project]\ndependencies = [\n  "middle==1.0",\n]\n', /already listed/],
    ['source/o/pyproject.dependencies', 'loose>=1.0\n', /not an exact pin/],
    ['source/base/pnpm-workspace.yaml', 'packages:\n  - web\n', /no top-level "onlyBuiltDependencies:"/],
    ['source/base/pnpm-workspace.yaml', 'onlyBuiltDependencies:\n  # none\n', /holds no "- name" lines/],
    ['source/o/pnpm-allow.fragment', 'not a name!\n', /is not a package name/],
  ];
  for (const [file, content, pattern] of cases) {
    const fx = insertFixture({ [file]: content });
    const result = render(fx, ['--only', 'over']);
    assert.notEqual(result.code, 0, `${file}: ${content}`);
    assert.match(result.out, pattern, `${file}: ${content}`);
  }
  // A fragment with no file to edit fails too.
  const fx = insertFixture();
  fs.rmSync(path.join(fx.root, 'source/base/.prettierignore'));
  const result = render(fx, ['--only', 'over']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /no layer holds \.prettierignore/);
});

/**
 * Load a copy of the real recipes module, which exports the pure generators.
 *
 * @returns {Promise<Record<string, any>>} The module namespace.
 */
function loadRecipes() {
  return import(new URL('./recipes.mjs', import.meta.url).href);
}

test('data overlay entries name, order and filter their layers', async () => {
  const { buildDataOverlays, buildDataLive } = await loadRecipes();
  const bases = {
    nest: ['source/server/common', 'source/server/node', 'source/server/nest', 'source/data/none'],
    fastapi: ['source/server/common', 'source/server/fastapi', 'source/data/none'],
  };
  const all = buildDataOverlays(bases, {
    frameworks: ['nest', 'fastapi'],
    stores: ['postgres', 'sqlite'],
    redis: true,
  });
  assert.deepEqual(Object.keys(all), [
    'nest-postgres',
    'nest-postgres-redis',
    'nest-sqlite',
    'nest-sqlite-redis',
    'nest-redis',
    'fastapi-postgres',
    'fastapi-postgres-redis',
    'fastapi-sqlite',
    'fastapi-sqlite-redis',
    'fastapi-redis',
  ]);
  assert.deepEqual(all['nest-postgres-redis'].layers, [
    'source/data/compose',
    'source/data/integration/nest',
    'source/data/sql/node',
    'source/data/postgres/common',
    'source/data/postgres/node',
    'source/data/postgres/nest',
    'source/data/redis/common',
    'source/data/redis/node',
    'source/data/redis/nest',
    'source/data/wiring/nest/database-redis',
  ]);
  assert.deepEqual(all['fastapi-sqlite'].layers, [
    'source/data/integration/fastapi',
    'source/data/sql/fastapi',
    'source/data/sqlite/common',
    'source/data/sqlite/fastapi',
    'source/data/wiring/fastapi/database',
  ]);
  assert.deepEqual(all['nest-redis'].layers.slice(-1), ['source/data/wiring/nest/redis']);
  assert.equal(all['nest-redis'].layers.includes('source/data/sql/node'), false);
  assert.equal(all['nest-sqlite'].layers.includes('source/data/compose'), false);
  assert.equal(all['nest-sqlite-redis'].layers[0], 'source/data/compose');
  assert.deepEqual(all['nest-sqlite'].agentsLayers.slice(0, 3), [
    'source/server/common',
    'source/server/node',
    'source/server/nest',
  ]);
  for (const entry of Object.values(all)) {
    assert.equal(entry.agentsLayers.includes('source/data/none'), false);
    assert.deepEqual(entry.agentsLayers.slice(-entry.layers.length), entry.layers);
    assert.equal(entry.base, entry.layers.at(-1).split('/')[3] ?? entry.base);
  }
  const noRedis = buildDataOverlays(bases, { frameworks: ['nest'], stores: ['postgres', 'sqlite'], redis: false });
  assert.deepEqual(Object.keys(noRedis), ['nest-postgres', 'nest-sqlite']);
  assert.deepEqual(buildDataOverlays(bases, { frameworks: [], stores: ['postgres'], redis: true }), {});
  assert.deepEqual(
    buildDataLive({ frameworks: ['nest'], stores: ['postgres', 'sqlite'], redis: true }),
    ['nest-postgres-redis', 'nest-sqlite', 'nest-redis'],
  );
  assert.deepEqual(buildDataLive({ frameworks: ['nest'], stores: ['postgres', 'sqlite'], redis: false }), [
    'nest-postgres',
    'nest-sqlite',
  ]);
  assert.throws(
    () => buildDataOverlays(bases, { frameworks: ['nest'], stores: ['nope'], redis: false }),
    /no STORE_TRAITS entry for "nope"/,
  );
  assert.throws(
    () => buildDataOverlays(bases, { frameworks: ['zzz'], stores: [], redis: false }),
    /no base recipe for "zzz"/,
  );
});

test('every layer of every data overlay runs in a live overlay, or the rule fails', async () => {
  const { buildDataOverlays, buildDataLive, uncoveredLayers, dataOverlays, DATA_LIVE } = await loadRecipes();
  const bases = { nest: ['source/server/common', 'source/server/node', 'source/server/nest'] };
  const options = { frameworks: ['nest'], stores: ['postgres', 'sqlite'], redis: true };
  const entries = buildDataOverlays(bases, options);
  assert.deepEqual(uncoveredLayers(entries, buildDataLive(options)), []);
  // A live set that leaves a layer out is reported by name.
  assert.deepEqual(uncoveredLayers(entries, ['nest-sqlite', 'nest-redis']), [
    'source/data/postgres/common',
    'source/data/postgres/nest',
    'source/data/postgres/node',
    'source/data/wiring/nest/database-redis',
  ]);
  assert.deepEqual(uncoveredLayers(entries, ['nest-zzz']).slice(0, 1), ['unknown live overlay: nest-zzz']);
  // The shipped recipes obey the rule.
  assert.deepEqual(uncoveredLayers(dataOverlays, DATA_LIVE), []);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
fs.rmSync(base, { recursive: true, force: true });
if (failed > 0) {
  console.error(`${failed} of ${tests.length} tests failed`);
  process.exit(1);
}
console.log(`all ${tests.length} tests passed`);
