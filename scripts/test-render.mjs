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
  broken: ['source/a', 'source/nope'],
  nofrag: ['source/c'],
};\n`,
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

/** @type {Array<[string, () => void]>} */
const tests = [];
/**
 * Register a test.
 *
 * @param {string} name Test name.
 * @param {() => void} fn Test body.
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

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
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
