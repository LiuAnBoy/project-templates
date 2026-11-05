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

import { fillDockerfile, joinDockerignore } from './docker-blocks.mjs';

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
/** The line the join adds to every compose file it writes, the dev file included. */
const DEV_NAME = 'name: ${COMPOSE_PROJECT_NAME:?set COMPOSE_PROJECT_NAME in .env}\n';
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
${DEV_NAME}
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
    `${COMPOSE_MAIN}\n${DEV_NAME}\nservices:\n  postgres:\n    image: x\n`,
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
    `${COMPOSE_MAIN}\n${DEV_NAME}\nservices:\n  postgres:\n    image: x\n`,
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
  assert.deepEqual(all['nest-redis'].layers, [
    'source/data/compose',
    'source/data/integration/nest',
    'source/data/redis/alone',
    'source/data/redis/common',
    'source/data/redis/node',
    'source/data/redis/nest',
    'source/data/wiring/nest/redis',
  ]);
  assert.equal(all['nest-postgres-redis'].layers.includes('source/data/redis/alone'), false);
  assert.equal(all['nest-sqlite-redis'].layers.includes('source/data/redis/alone'), false);
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
  assert.deepEqual(Object.keys(buildDataOverlays(bases, { frameworks: ['nest'], stores: [] })), ['nest-redis']);
  assert.deepEqual(buildDataOverlays(bases, { frameworks: [], stores: ['postgres'] }), {});
  assert.deepEqual(buildDataLive({ frameworks: ['nest'], stores: ['postgres', 'sqlite'] }), [
    'nest-postgres-redis',
    'nest-sqlite',
    'nest-redis',
  ]);
  assert.throws(
    () => buildDataOverlays(bases, { frameworks: ['nest'], stores: ['nope'] }),
    /no STORE_TRAITS entry for "nope"/,
  );
  assert.throws(
    () => buildDataOverlays(bases, { frameworks: ['zzz'], stores: [] }),
    /no base recipe for "zzz"/,
  );
});

test('a store that names its frameworks gets overlays and live entries for those alone', async () => {
  const { buildDataOverlays, buildDataLive, buildDockerLive, STORE_TRAITS, dataOverlays, DATA_LIVE } = await loadRecipes();
  assert.deepEqual(STORE_TRAITS.mysql.frameworks, ['nest', 'fastify']);
  const bases = {
    nest: ['source/server/common', 'source/server/node', 'source/server/nest'],
    fastapi: ['source/server/common', 'source/server/fastapi'],
  };
  const options = { frameworks: ['nest', 'fastapi'], stores: ['mysql', 'sqlite'] };
  assert.deepEqual(Object.keys(buildDataOverlays(bases, options)), [
    'nest-mysql',
    'nest-mysql-redis',
    'nest-sqlite',
    'nest-sqlite-redis',
    'nest-redis',
    'fastapi-sqlite',
    'fastapi-sqlite-redis',
    'fastapi-redis',
  ]);
  assert.deepEqual(buildDataLive(options), ['nest-mysql-redis', 'nest-sqlite', 'nest-redis', 'fastapi-sqlite', 'fastapi-redis']);
  assert.deepEqual(buildDockerLive(options), ['nest-mysql-redis', 'nest-sqlite', 'fastapi-sqlite']);
  // The shipped recipes: four MySQL overlays, none on FastAPI, one of them live.
  const mysql = Object.keys(dataOverlays).filter((name) => name.includes('mysql'));
  assert.deepEqual(mysql, ['nest-mysql', 'nest-mysql-redis', 'fastify-mysql', 'fastify-mysql-redis']);
  assert.deepEqual(DATA_LIVE.filter((name) => name.includes('mysql')), ['nest-mysql-redis', 'fastify-mysql-redis']);
});

test('every layer of every data overlay runs in a live overlay, or the rule fails', async () => {
  const { buildDataOverlays, buildDataLive, uncoveredLayers, dataOverlays, DATA_LIVE } = await loadRecipes();
  const bases = { nest: ['source/server/common', 'source/server/node', 'source/server/nest'] };
  const options = { frameworks: ['nest'], stores: ['postgres', 'sqlite'] };
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

const APP_MAIN = '# Whole project.\n# Start: docker compose up.\nnetworks:\n  edge:\n    driver: bridge\n';
const APP_SERVICES =
  'services:\n  server:\n    build:\n      context: .\n    environment:\n      HOST: 0.0.0.0\n  migrate:\n    build:\n      context: .\n    restart: \'no\'\n    environment:\n      MODE: migrate\n';
const SERVER_FRAGMENT =
  'services:\n  server:\n    environment:\n      DATABASE_URL: x\n    depends_on:\n      postgres:\n        condition: service_healthy\n      migrate:\n        condition: service_completed_successfully\n  migrate:\n    environment:\n      DATABASE_URL: x\n    depends_on:\n      postgres:\n        condition: service_healthy\n      migrate:\n        condition: service_completed_successfully\nvolumes:\n  app-data:\n';
const DOCKERFILE =
  'FROM node:24-slim AS build\n# docker-fragment: build\nRUN true\n\nFROM node:24-slim\n# docker-fragment: runtime\nCMD ["node"]\n';

/**
 * A fixture with Docker fragments in separate layers. `dk` is a template made
 * of all of them; the overlays join subsets.
 *
 * @param {Record<string, string>} extra Extra files, which override the defaults.
 * @returns {{root: string, recipes: string}} Fixture.
 */
function dockerFixture(extra = {}) {
  return custom(
    {
      'source/base/keep.txt': 'base\n',
      'source/m/compose.app.fragment.yml': APP_MAIN,
      'source/pg/compose.fragment.yml': COMPOSE_PG,
      'source/pg/compose.server.fragment.yml': SERVER_FRAGMENT,
      'source/sv/compose.app.fragment.yml': APP_SERVICES,
      'source/sv/Dockerfile': DOCKERFILE,
      'source/sv/Dockerfile.build.fragment': 'RUN apt-get install -y libpq5\n',
      'source/sv/.dockerignore': '**/.env\n**/node_modules\ntodos\n',
      'source/pg/dockerignore.fragment': '# local data\ndata\n**/.env\n',
      'source/ui/keep.txt': 'ui\n',
      ...extra,
    },
    `export const recipes = { dk: ['source/m', 'source/pg', 'source/sv'], ui: ['source/base'] };
export const overlays = {
  late: { base: 'ui', layers: ['source/pg', 'source/sv', 'source/m'] },
  nomain: { base: 'ui', layers: ['source/pg', 'source/sv'] },
  uilike: { base: 'dk', layers: ['source/ui'] },
  servervol: { base: 'ui', layers: ['source/m', 'source/sv', 'source/vol'] },
};\n`,
  );
}

const JOINED = `# Whole project.
# Start: docker compose up.

name: \${COMPOSE_PROJECT_NAME:?set COMPOSE_PROJECT_NAME in .env}

services:
  postgres:
    image: postgres:18-alpine
    healthcheck:
      test: ["CMD", "pg_isready"]
    restart: unless-stopped
  server:
    build:
      context: .
    environment:
      HOST: 0.0.0.0
      DATABASE_URL: x
    depends_on:
      postgres:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped
  migrate:
    build:
      context: .
    restart: 'no'
    environment:
      MODE: migrate
      DATABASE_URL: x
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-data:
  app-data:

networks:
  edge:
    driver: bridge
`;

test('docker-compose.yml is one services key with a store and app services, named by the join', () => {
  const fx = dockerFixture();
  const result = render(fx, ['--only', 'dk']);
  assert.equal(result.code, 0, result.out);
  const out = read(fx, 'templates/dk/docker-compose.yml');
  assert.equal(out, JOINED);
  assert.equal(out.match(/^services:/gm).length, 1);
  // The dev file keeps the store services alone, and no fragment is copied.
  const dev = read(fx, 'templates/dk/docker-compose.dev.yml');
  assert.match(dev, /postgres:/);
  assert.doesNotMatch(dev, /server:/);
  assert.equal(dev.match(/^name: /gm).length, 1);
  for (const name of ['compose.app.fragment.yml', 'compose.server.fragment.yml', 'Dockerfile.build.fragment', 'dockerignore.fragment']) {
    assert.equal(fs.existsSync(path.join(fx.root, 'templates/dk', name)), false, name);
  }
});

test('the main block heads docker-compose.yml from any layer; none or two fail', () => {
  const fx = dockerFixture();
  assert.equal(render(fx, ['--only', 'late']).code, 0);
  assert.ok(read(fx, 'overlays/late/docker-compose.yml').startsWith('# Whole project.\n# Start: docker compose up.\n\nname:'));
  const none = render(fx, ['--only', 'nomain']);
  assert.notEqual(none.code, 0);
  assert.match(none.out, /no main block/);
  const two = dockerFixture({ 'source/pg/compose.app.fragment.yml': '# second\nnetworks:\n  other: {}\n' });
  const result = render(two, ['--only', 'dk']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /two main blocks/);
});

test('compose.server.fragment.yml writes no dev file, and its volumes reach the file', () => {
  const fx = dockerFixture({
    'source/vol/compose.server.fragment.yml':
      'services:\n  server:\n    volumes:\n      - app-data:/app/data\nvolumes:\n  app-data:\n',
  });
  const result = render(fx, ['--only', 'servervol']);
  assert.equal(result.code, 0, result.out);
  const out = read(fx, 'overlays/servervol/docker-compose.yml');
  assert.match(out, /  server:\n    build:\n      context: \.\n    environment:\n      HOST: 0\.0\.0\.0\n    volumes:\n      - app-data:\/app\/data\n/);
  assert.match(out, /\nvolumes:\n  app-data:\n/);
  assert.equal(fs.existsSync(path.join(fx.root, 'overlays/servervol/docker-compose.dev.yml')), false);
});

test('compose.server.fragment.yml names only server and migrate, and only a service that exists', () => {
  const other = dockerFixture({ 'source/pg/compose.server.fragment.yml': 'services:\n  web:\n    environment:\n      A: 1\n' });
  assert.match(render(other, ['--only', 'dk']).out, /service "web" is not allowed/);
  const key = dockerFixture({ 'source/pg/compose.server.fragment.yml': 'services:\n  server:\n    image: x\n' });
  assert.match(render(key, ['--only', 'dk']).out, /"image" of server is not allowed/);
  const lost = dockerFixture({ 'source/sv/compose.app.fragment.yml': 'services:\n  server:\n    environment:\n      A: 1\n' });
  assert.match(render(lost, ['--only', 'dk']).out, /service "migrate" is not defined/);
  const twice = dockerFixture({
    'source/pg/compose.server.fragment.yml':
      'services:\n  server:\n    environment:\n      HOST: 1\n',
  });
  assert.match(render(twice, ['--only', 'dk']).out, /environment of service "server" lists "HOST" twice/);
});

test('a store block may not set build, restart or container_name; an app block may not set container_name', () => {
  for (const key of ['build: .', 'restart: always', 'container_name: x']) {
    const fx = dockerFixture({ 'source/pg/compose.fragment.yml': `services:\n  postgres:\n    image: x\n    ${key}\n` });
    const result = render(fx, ['--only', 'dk']);
    assert.notEqual(result.code, 0, key);
    assert.match(result.out, /a store block may not set/, key);
    // The dev file is joined by the same code and refuses too.
    assert.notEqual(render(fx, ['--only', 'dk']).code, 0);
  }
  const app = dockerFixture({ 'source/sv/compose.app.fragment.yml': 'services:\n  server:\n    container_name: x\n' });
  const result = render(app, ['--only', 'dk']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /an app block may not set/);
  // A top-level name: is written by the join alone.
  const named = dockerFixture({ 'source/m/compose.app.fragment.yml': `name: mine\n${APP_MAIN}` });
  assert.match(render(named, ['--only', 'dk']).out, /top-level key "name" is not allowed/);
});

test('restart is added where absent and kept where stated', () => {
  const fx = dockerFixture();
  render(fx, ['--only', 'dk']);
  const out = read(fx, 'templates/dk/docker-compose.yml');
  assert.equal(out.match(/restart: unless-stopped/g).length, 2);
  assert.equal(out.match(/restart: 'no'/g).length, 1);
});

test('Dockerfile markers are filled, removed when empty, and never reach the output', () => {
  const fx = dockerFixture();
  assert.equal(render(fx, ['--only', 'dk']).code, 0);
  assert.equal(
    read(fx, 'templates/dk/Dockerfile'),
    'FROM node:24-slim AS build\nRUN apt-get install -y libpq5\nRUN true\n\nFROM node:24-slim\nCMD ["node"]\n',
  );
  const text = fillDockerfile('A\n# docker-fragment: build\n\n# docker-fragment: runtime\nB\n', { build: 'X\nY' });
  assert.equal(text, 'A\nX\nY\n\nB\n');
  assert.throws(() => fillDockerfile('A\n', { runtime: 'X' }), /no "# docker-fragment: runtime" line/);
  assert.throws(
    () => fillDockerfile('# docker-fragment: build\n# docker-fragment: build\n', {}),
    /appears 2 times/,
  );
  assert.throws(() => fillDockerfile('# docker-fragment: other\n', {}), /unknown marker/);
  const lost = dockerFixture({ 'source/sv/Dockerfile': 'FROM node:24-slim\n' });
  const result = render(lost, ['--only', 'dk']);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /fragment exists but the file has no/);
  const orphan = dockerFixture();
  fs.rmSync(path.join(orphan.root, 'source/sv/Dockerfile'));
  assert.match(render(orphan, ['--only', 'dk']).out, /no layer holds Dockerfile/);
});

test('.dockerignore takes the fragments appended, without repeating a pattern', () => {
  const fx = dockerFixture();
  assert.equal(render(fx, ['--only', 'dk']).code, 0);
  assert.equal(read(fx, 'templates/dk/.dockerignore'), '**/.env\n**/node_modules\ntodos\n# local data\ndata\n');
  assert.equal(joinDockerignore('a\n', ['b\n\n\nc\na\n']), 'a\nb\n\nc\n');
});

test('an overlay writes a Docker file only when a layer of its own contributes', () => {
  const fx = dockerFixture();
  const both = render(fx, ['--only', 'dk,uilike']);
  assert.equal(both.code, 0, both.out);
  const dir = path.join(fx.root, 'overlays/uilike');
  assert.equal(fs.existsSync(path.join(dir, 'keep.txt')), true);
  for (const name of ['docker-compose.yml', 'docker-compose.dev.yml', 'Dockerfile', '.dockerignore']) {
    assert.equal(fs.existsSync(path.join(dir, name)), false, name);
  }
  // An overlay that does contribute holds the whole file.
  const fx2 = dockerFixture();
  fs.appendFileSync(fx2.recipes, "overlays.store = { base: 'ui', layers: ['source/m', 'source/pg', 'source/sv'] };\n");
  const stored = render(fx2, ['--only', 'store']);
  assert.equal(stored.code, 0, stored.out);
  assert.equal(read(fx2, 'overlays/store/docker-compose.yml'), JOINED);
  assert.equal(read(fx2, 'overlays/store/.dockerignore'), '**/.env\n**/node_modules\ntodos\n# local data\ndata\n');
  // Store blocks alone make no project compose file.
  const fx3 = composeFixture();
  assert.equal(render(fx3, ['--only', 'both']).code, 0);
  assert.equal(fs.existsSync(path.join(fx3.root, 'overlays/both/docker-compose.yml')), false);
});

test('render.mjs re-exports buildCompose from docker-blocks.mjs', async () => {
  const render = await import(new URL('./render.mjs', import.meta.url).href);
  const blocks = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  assert.equal(render.buildCompose, blocks.buildCompose);
  assert.equal(typeof blocks.buildAppCompose, 'function');
});

test('guard: a build argument other than API_HOST and PART fails, in a Dockerfile and in a compose file', async () => {
  const { checkBuildArgs } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  assert.deepEqual(checkBuildArgs('ARG API_HOST\nARG PART=web\nARG\tapi_host\n'.replace(/ARG\tapi_host\n/, ''), 'D'), []);
  assert.match(checkBuildArgs('ARG NPM_TOKEN\n', 'D')[0], /NPM_TOKEN is not allowed/);
  assert.equal(checkBuildArgs('ARG API_HOST=x\nARG DB_PASSWORD=y\n', 'D').length, 1);
  const list = 'services:\n  web:\n    build:\n      args:\n        - API_HOST=x\n        - TOKEN=y\n    restart: x\n';
  assert.match(checkBuildArgs(list, 'C')[0], /TOKEN/);
  const map = 'services:\n  web:\n    build:\n      args:\n        PART: web\n        SECRET: y\n';
  assert.equal(checkBuildArgs(map, 'C').length, 1);
    assert.deepEqual(checkBuildArgs('    args:\n      PART: web\n    environment:\n      TOKEN: y\n', 'C'), []);
});

test('guard: a Dockerfile is read as Docker does, and compose args must be a block', async () => {
  const { checkBuildArgs } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  for (const text of [
    'ARG PART NPM_TOKEN=abc\n',
    'ARG PART=web DB_PASSWORD=x\n',
    'ARG PART \\\n    NPM_TOKEN=abc\n',
    'ARG PART \\\n\n    NPM_TOKEN=abc\n',
    'ARG PART \\\n# note\n    NPM_TOKEN=abc\n',
    '# note \\\nARG NPM_TOKEN=abc\n',
    'ARG API_HOST="a b" TOKEN=x\n',
    'arg token=x\n',
    '    args:\n      - \'NPM_TOKEN=x\'\n',
    '    args:\n      - "NPM_TOKEN"\n',
    '    args:\n      "NPM_TOKEN": x\n',
  ]) {
    assert.equal(checkBuildArgs(text, 'D').length, 1, text);
  }
  for (const flow of ['    args: [PART=web, NPM_TOKEN]\n', '    args: { NPM_TOKEN: x }\n']) {
    assert.match(checkBuildArgs(flow, 'D')[0], /must be a block/, flow);
  }
  assert.deepEqual(checkBuildArgs('ARG PART API_HOST=x\narg PART\n    args:\n      - \'PART=web\'\n', 'D'), []);
});

test('guard: the only .dockerignore negation allowed is !.env.example', async () => {
  const { checkDockerignore } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const base = '**/.env\n**/node_modules\ntodos\n';
  for (const negation of ['!**/.env', '!.env', '!**/.env*', '!**', '!web/.env', '!node_modules']) {
    assert.match(checkDockerignore(`${base}${negation}\n`, 'I')[0], /negation .* is not allowed/, negation);
  }
  assert.deepEqual(checkDockerignore(`${base}!.env.example\n!**/.env.example\n`, 'I'), []);
});

test('guard: a .dockerignore must hold **/.env, **/node_modules and todos', async () => {
  const { checkDockerignore } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  assert.deepEqual(checkDockerignore('**/.env\n**/node_modules\ntodos\n.git\n', 'I'), []);
  assert.equal(checkDockerignore('.env\nnode_modules\n', 'I').length, 3);
  assert.match(checkDockerignore('**/node_modules\ntodos\n', 'I')[0], /lacks \*\*\/\.env/);
  assert.match(checkDockerignore('**/.env\n**/node_modules\n', 'I')[0], /lacks todos/);
});

test('guard: the last USER of a Dockerfile is a numeric uid other than 0', async () => {
  const { checkFinalUser } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  assert.deepEqual(checkFinalUser('USER root\nFROM x\nUSER 1000:1000\nCMD a\n', 'D'), []);
  assert.deepEqual(checkFinalUser('USER 1000\n', 'D'), []);
  // Only the final stage counts: a USER of an earlier stage never covers a root one.
  assert.deepEqual(checkFinalUser('FROM a\nUSER 1000\nFROM b\nCMD x\n', 'D').length, 1);
  assert.equal(checkFinalUser('FROM a\nUSER 1000\nFROM b\nUSER root\n', 'D').length, 1);
  assert.deepEqual(checkFinalUser('FROM a AS build\nUSER root\nFROM b\nUSER 101:101\n', 'D'), []);
  for (const bad of ['USER root', 'USER 0', 'USER 0:0', 'USER app', 'USER 1000:1000\nUSER root', '']) {
    assert.equal(checkFinalUser(`FROM x\n${bad}\n`, 'D').length, 1, bad);
  }
});

test('guard: a web service sets no env_file', async () => {
  const { checkWebEnvFile } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const web = 'name: x\nservices:\n  web:\n    build: .\n    ports:\n      - "1:2"\n';
  assert.deepEqual(checkWebEnvFile(web, 'C'), []);
  assert.deepEqual(checkWebEnvFile(`${web}  server:\n    env_file: .env\n`, 'C'), []);
  assert.match(checkWebEnvFile(web.replace('build: .', 'build: .\n    env_file: .env'), 'C')[0], /service web sets env_file/);
  assert.equal(checkWebEnvFile(`${web}  dashboard:\n    env_file:\n      - .env\n`, 'C').length, 1);
  assert.deepEqual(checkWebEnvFile('volumes:\n  a: {}\n', 'C'), []);
});

test('guard: FROM node must match the major of .nvmrc, and exactly one services key', async () => {
  const { checkNodeMajor, checkOneServices } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  assert.deepEqual(checkNodeMajor('FROM node:24-slim AS b\nFROM node:24-slim\nFROM python:3.15-slim\n', '24\n', 'D'), []);
  assert.deepEqual(checkNodeMajor('FROM node:24-slim\n', 'v24.1.0\n', 'D'), []);
  assert.match(checkNodeMajor('FROM node:22-alpine\n', '24\n', 'D')[0], /node:22 differs from .nvmrc major 24/);
  assert.equal(checkNodeMajor('FROM node:24-slim\nFROM --platform=linux/amd64 node:22\n', '24', 'D').length, 1);
  assert.deepEqual(checkOneServices('name: x\nservices:\n  a: {}\n', 'C'), []);
  assert.equal(checkOneServices('services:\n  a: {}\nservices:\n  b: {}\n', 'C').length, 1);
  assert.equal(checkOneServices('volumes:\n', 'C').length, 1);
});

test('guard: a server store ships compose.server.fragment.yml, and a Docker layer is in a live target', async () => {
  const { serverStoresMissingFragment } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const { buildDockerLive, dockerFragmentLayers, uncoveredDockerLayers, DOCKER_LIVE } = await loadRecipes();
  const fx = dockerFixture({ 'source/data/redis/common/compose.server.fragment.yml': 'services: {}\n' });
  const traits = { postgres: { server: true }, sqlite: { server: false }, redis: { server: true } };
  put(path.join(fx.root, 'source/data/postgres/node/note.txt'), 'x\n');
  assert.deepEqual(serverStoresMissingFragment(fx.root, traits), ['postgres']);
  put(path.join(fx.root, 'source/data/postgres/common/compose.server.fragment.yml'), 'services: {}\n');
  assert.deepEqual(serverStoresMissingFragment(fx.root, traits), []);

  const layers = dockerFragmentLayers(fx.root, ['source/base', 'source/m', 'source/pg', 'source/sv', 'source/sv', 'source/ui']);
  assert.deepEqual(layers, ['source/m', 'source/pg', 'source/sv']);
  const targets = { dk: ['source/m', 'source/pg', 'source/sv'], part: ['source/m'], ui: ['source/base'] };
  assert.deepEqual(uncoveredDockerLayers(targets, ['dk'], layers), []);
  assert.deepEqual(uncoveredDockerLayers(targets, ['part'], layers), ['source/pg', 'source/sv']);
  assert.deepEqual(uncoveredDockerLayers(targets, ['zzz'], []), ['unknown live target: zzz']);

  assert.deepEqual(
    buildDockerLive({ named: ['fastify', 'next-heroui'], frameworks: ['nest', 'fastapi'], stores: ['postgres', 'sqlite'] }),
    ['fastify', 'next-heroui', 'nest-postgres-redis', 'nest-sqlite', 'fastapi-postgres-redis', 'fastapi-sqlite'],
  );
  assert.deepEqual(DOCKER_LIVE, [
    'fastify',
    'next',
    'vite',
    'next-heroui',
    'nest-postgres-redis',
    'nest-sqlite',
    'nest-mysql-redis',
    'fastapi-postgres-redis',
    'fastapi-sqlite',
  ]);
});

test('guard on real output: a server store ships its fragment, a Docker layer runs in a live target, and each compose file has one name:', async () => {
  const { serverStoresMissingFragment, checkOneName, DOCKER_FRAGMENT_NAMES } = await import(
    new URL('./docker-blocks.mjs', import.meta.url).href
  );
  const { default: recipes, overlays, STORE_TRAITS, DOCKER_LIVE, dockerFragmentLayers, uncoveredDockerLayers } =
    await loadRecipes();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.deepEqual(serverStoresMissingFragment(root, STORE_TRAITS), []);

  // Every template and overlay, to the layers its Docker output is joined from.
  const targets = Object.fromEntries([
    ...Object.entries(recipes),
    ...Object.entries(overlays).map(([name, entry]) => [name, entry.agentsLayers ?? [...recipes[entry.base], ...entry.layers]]),
  ]);
  const layers = dockerFragmentLayers(root, Object.values(targets).flat());
  assert.ok(layers.includes('source/data/postgres/common'), 'the scan found no PostgreSQL Docker layer');
  assert.deepEqual(uncoveredDockerLayers(targets, DOCKER_LIVE, layers), []);
  assert.ok(DOCKER_FRAGMENT_NAMES.length > 0);

  let seen = 0;
  const problems = [];
  for (const group of ['templates', 'overlays']) {
    for (const name of fs.readdirSync(path.join(root, group))) {
      for (const file of ['docker-compose.yml', 'docker-compose.dev.yml']) {
        const full = path.join(root, group, name, file);
        if (!fs.existsSync(full)) continue;
        seen += 1;
        problems.push(...checkOneName(fs.readFileSync(full, 'utf8'), `${group}/${name}/${file}`));
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(seen >= 30, `the scan found ${seen} compose files, expected at least 30`);
});

test('guard: a compose file with no name:, two, or another one is reported; a store block with no server fragment is named; an unlisted Docker layer is named', async () => {
  const { checkOneName, serverStoresMissingFragment } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const { uncoveredDockerLayers } = await loadRecipes();
  const line = 'name: ${COMPOSE_PROJECT_NAME:?set COMPOSE_PROJECT_NAME in .env}';
  assert.deepEqual(checkOneName(`${line}\nservices:\n`, 'C'), []);
  assert.equal(checkOneName('services:\n', 'C').length, 1);
  assert.equal(checkOneName(`${line}\n${line}\n`, 'C').length, 1);
  assert.equal(checkOneName('name: fixed\nservices:\n', 'C').length, 1);
  const fx = dockerFixture({ 'source/data/redis/common/compose.fragment.yml': 'services: {}\n' });
  assert.deepEqual(serverStoresMissingFragment(fx.root, { redis: { server: true } }), ['redis']);
  assert.deepEqual(uncoveredDockerLayers({ a: ['source/x'], b: ['source/y'] }, ['a'], ['source/x', 'source/y']), ['source/y']);
});

test('guard on real output: every Dockerfile, compose file and .dockerignore of templates/ and overlays/ obeys the Docker rules', async () => {
  const { checkBuildArgs, checkDockerignore, checkFinalUser, checkNodeMajor, checkOneServices, checkWebEnvFile } =
    await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = [];
  let seen = 0;
  for (const group of ['templates', 'overlays']) {
    for (const name of fs.readdirSync(path.join(root, group))) {
      const dir = path.join(root, group, name);
      for (const file of fs.readdirSync(dir)) {
        const rel = `${group}/${name}/${file}`;
        const text = () => fs.readFileSync(path.join(dir, file), 'utf8');
        if (file === 'Dockerfile') {
          seen += 1;
          problems.push(...checkBuildArgs(text(), rel), ...checkFinalUser(text(), rel));
          const nvmrc = path.join(dir, '.nvmrc');
          if (fs.existsSync(nvmrc)) problems.push(...checkNodeMajor(text(), fs.readFileSync(nvmrc, 'utf8'), rel));
        } else if (/^docker-compose(\..+)?\.yml$/.test(file)) {
          problems.push(...checkOneServices(text(), rel), ...checkWebEnvFile(text(), rel));
          if (file === 'docker-compose.yml') {
            seen += 1;
            problems.push(...checkBuildArgs(text(), rel));
          }
        } else if (file === '.dockerignore') {
          seen += 1;
          problems.push(...checkDockerignore(text(), rel));
        }
      }
    }
  }
  assert.deepEqual(problems, []);
  // The scan must have found the files it guards: a renamed or moved file cannot silently empty it.
  assert.ok(seen >= 9, `the scan found ${seen} Docker files, expected at least 9`);
});

test('guard on real output: the guards report a secret argument, a missing ignore pattern and a drifted Node major', async () => {
  const { checkBuildArgs, checkDockerignore, checkNodeMajor } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const real = fs.readFileSync(new URL('../templates/fastify/Dockerfile', import.meta.url), 'utf8');
  assert.deepEqual(checkBuildArgs(real, 'real'), []);
  assert.equal(checkBuildArgs(`${real}ARG NPM_TOKEN\n`, 'real').length, 1);
  const ignore = fs.readFileSync(new URL('../templates/fastify/.dockerignore', import.meta.url), 'utf8');
  assert.deepEqual(checkDockerignore(ignore, 'real'), []);
  assert.equal(checkDockerignore(ignore.replace('**/.env\n', ''), 'real').length, 1);
  assert.equal(checkNodeMajor(real, '22\n', 'real').length, 2);
});

test('guard on real output: the web .env.example holds its old lines unchanged, then only the Docker lines', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const old = {
    next:
      '# Where the API listens. Read twice: at build time by next.config.ts (the /api/v1\n' +
      '# rewrite target) and at runtime by server-side calls. Set it in both places.\n' +
      'API_HOST=http://localhost:8000\n',
    vite:
      '# Where the API listens. Only the dev and preview proxy read it; /api is forwarded here.\n' +
      'API_HOST=http://localhost:8000\n',
  };
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const docker = [read('source/docker/main/env.fragment'), read('source/docker/web/env.fragment')]
    .map((text) => text.replace(/\s+$/, ''))
    .join('\n\n');
  for (const framework of Object.keys(old)) {
    assert.equal(read(`templates/${framework}/.env.example`), `${old[framework]}\n${docker}\n`, framework);
  }
  for (const overlay of ['next-antd', 'next-mui', 'next-heroui', 'vite-antd', 'vite-mui', 'vite-heroui']) {
    const base = overlay.split('-')[0];
    assert.equal(read(`overlays/${overlay}/.env.example`), read(`templates/${base}/.env.example`), overlay);
    assert.equal(read(`overlays/${overlay}/docs/README.md`), read(`templates/${base}/docs/README.md`), overlay);
  }
});

test('guard on real output: a web service with env_file, and a final stage with no USER, are reported', async () => {
  const { checkFinalUser, checkWebEnvFile } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  for (const framework of ['next', 'vite']) {
    const compose = fs.readFileSync(new URL(`../templates/${framework}/docker-compose.yml`, import.meta.url), 'utf8');
    assert.deepEqual(checkWebEnvFile(compose, framework), []);
    assert.equal(checkWebEnvFile(compose.replace('    build:', '    env_file: .env\n    build:'), framework).length, 1);
    const dockerfile = fs.readFileSync(new URL(`../templates/${framework}/Dockerfile`, import.meta.url), 'utf8');
    assert.deepEqual(checkFinalUser(dockerfile, framework), []);
    assert.equal(checkFinalUser(dockerfile.replace(/^USER .*$/m, ''), framework).length, 1);
  }
});

test('monorepo root: a web block is instantiated per part, the migrate context is retargeted, and the Docker env lines are split out', async () => {
  const { instantiateWeb, retargetBuild, splitDockerEnv } = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const block = 'services:\n  __PART__:\n    dockerfile: __PART__/Dockerfile\n    ports:\n      - \'${__PORT_VAR__:-__PORT__}:3000\'\n';
  assert.match(instantiateWeb(block, 'web'), /^services:\n {2}web:\n[^]*web\/Dockerfile[^]*\$\{WEB_PORT:-3000\}/);
  assert.match(instantiateWeb(block, 'dashboard'), /^services:\n {2}dashboard:\n[^]*dashboard\/Dockerfile[^]*\$\{DASHBOARD_PORT:-3001\}/);
  const compose = 'services:\n  server:\n    build: .\n  migrate:\n    # note\n    build: .\n    restart: \'no\'\n';
  assert.equal(
    retargetBuild(compose, 'migrate', ['build: server']),
    'services:\n  server:\n    build: .\n  migrate:\n    # note\n    build: server\n    restart: \'no\'\n',
  );
  assert.equal(retargetBuild(compose, 'worker', ['build: x']), compose);
  const env =
    'PORT=8000\n# a\nCOMPOSE_PROJECT_NAME=\n\n# the files\n# second line\nCOMPOSE_FILE=docker-compose.yml\n# the network\nX_DOCKER_NETWORK=\nTRUST_PROXY=\n';
  const split = splitDockerEnv(env, ['# a\nCOMPOSE_PROJECT_NAME=\n']);
  assert.equal(split.kept, 'PORT=8000\n\nTRUST_PROXY=\n');
  assert.deepEqual(split.moved, ['# the files', '# second line', 'COMPOSE_FILE=docker-compose.yml', '# the network', 'X_DOCKER_NETWORK=']);
});

test('guard on real output: source/docker/monorepo obeys the Dockerfile, ignore and web env_file rules, and its root join has one web, one dashboard and the overlay\'s store blocks', async () => {
  const docker = await import(new URL('./docker-blocks.mjs', import.meta.url).href);
  const { overlays } = await import(new URL('./recipes.mjs', import.meta.url).href);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mono = path.join(root, docker.MONOREPO_LAYERS);
  const problems = [];
  let seen = 0;
  for (const layer of fs.readdirSync(mono)) {
    for (const file of fs.readdirSync(path.join(mono, layer), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)) {
      const rel = `${docker.MONOREPO_LAYERS}/${layer}/${file}`;
      const text = fs.readFileSync(path.join(mono, layer, file), 'utf8');
      if (file === 'Dockerfile') {
        seen += 1;
        problems.push(...docker.checkBuildArgs(text, rel), ...docker.checkFinalUser(text, rel));
        problems.push(...docker.checkNodeMajor(text, fs.readFileSync(path.join(root, 'source/workspace/.nvmrc'), 'utf8'), rel));
      } else if (file === 'compose.app.fragment.yml') {
        seen += 1;
        problems.push(...docker.checkBuildArgs(text, rel), ...docker.checkWebEnvFile(text, rel));
      } else if (file === '.dockerignore') {
        seen += 1;
        problems.push(...docker.checkDockerignore(text, rel));
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(seen >= 8, `the scan found ${seen} monorepo Docker files, expected at least 8`);
  const ignore = fs.readFileSync(path.join(mono, 'main/.dockerignore'), 'utf8');
  assert.equal(docker.checkDockerignore(ignore.replace('**/.env\n', ''), 'root').length, 1);
  const tmp = fs.mkdtempSync(path.join(base, 'root-join-'));
  const layers = ['web', 'dashboard'].map((part) => {
    const dir = path.join(tmp, part);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'compose.app.fragment.yml'), docker.instantiateWeb(fs.readFileSync(path.join(mono, 'web-next/compose.app.fragment.yml'), 'utf8'), part));
    return dir;
  });
  const data = overlays['nest-postgres-redis'].layers.map((layer) => path.join(root, layer));
  const compose = docker.buildRootCompose([path.join(mono, 'main'), ...layers, path.join(mono, 'server-node'), ...data], 'node');
  const names = [...compose.split(/^volumes:/m)[0].matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ['dashboard', 'migrate', 'postgres', 'redis', 'server', 'web']);
  assert.deepEqual(docker.checkWebEnvFile(compose, 'root'), []);
  assert.deepEqual(docker.checkOneServices(compose, 'root'), []);
  assert.deepEqual(docker.checkOneName(compose, 'root'), []);
  assert.deepEqual(docker.checkBuildArgs(compose, 'root'), []);
  assert.match(compose, /migrate:[^]*dockerfile: server\/Dockerfile/);
  const overlay = fs.readFileSync(path.join(root, 'overlays/nest-postgres-redis/docker-compose.yml'), 'utf8');
  for (const store of ['postgres', 'redis']) {
    const block = (text) => new RegExp(`^ {2}${store}:\\n(?: {4}.*\\n|\\n| {6}.*\\n)*`, 'm').exec(text)?.[0];
    assert.ok(block(overlay), `${store} is in the overlay`);
    assert.equal(block(compose), block(overlay), `${store} block differs from the overlay's`);
  }
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
