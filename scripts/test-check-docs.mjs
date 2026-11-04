#!/usr/bin/env node
/**
 * Guards check-docs.mjs with fixtures built in a temp directory.
 * Run with plain `node scripts/test-check-docs.mjs`; exits non-zero on failure.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_SERVER,
  REQUIRED_WEB,
  REQUIRED_WEB_UI,
  REQUIRED_WORKSPACE,
} from './check-docs.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-docs.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'test-check-docs-'));
let counter = 0;

/**
 * Write a file, creating parent directories.
 *
 * @param {string} file Absolute path.
 * @param {string} content Content.
 * @returns {void}
 */
function put(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Create a required path: a directory when it has no extension, else a file
 * whose content fits its place (Chinese for record pages, English for rules).
 *
 * @param {string} dir Fixture root.
 * @param {string} rel Required relative path.
 * @returns {void}
 */
function touch(dir, rel) {
  const full = path.join(dir, rel);
  if (!path.extname(rel)) fs.mkdirSync(full, { recursive: true });
  else if (rel.endsWith('.md')) {
    put(full, rel.startsWith('docs/rules/') ? '# Rule\n\nEnglish only.\n' : '# 文件\n\n繁體中文內容。\n');
  } else put(full, '');
}

/**
 * Build a clean fixture of the given kind.
 *
 * @param {'web-plain' | 'web-ui' | 'nest' | 'fastify' | 'fastapi' | 'workspace'} kind Kind.
 * @returns {string} Fixture directory.
 */
function make(kind) {
  counter += 1;
  const dir = path.join(base, `${kind}-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  put(path.join(dir, 'AGENTS.md'), '# Rules\n\nSee [docs](docs/README.md).\n');
  put(path.join(dir, '.gitignore'), 'node_modules/\n.env\n');
  const pkg = (dependencies) =>
    put(path.join(dir, 'package.json'), JSON.stringify({ name: kind, dependencies }));
  let required = [];
  if (kind === 'web-plain') {
    pkg({ next: '1.0.0' });
    required = REQUIRED_WEB;
  } else if (kind === 'web-ui') {
    pkg({ vite: '1.0.0', antd: '1.0.0' });
    required = [...REQUIRED_WEB, ...REQUIRED_WEB_UI];
  } else if (kind === 'nest') {
    pkg({ '@nestjs/core': '1.0.0' });
    required = REQUIRED_SERVER.nest;
  } else if (kind === 'fastify') {
    pkg({ fastify: '1.0.0' });
    required = REQUIRED_SERVER.fastify;
  } else if (kind === 'fastapi') {
    put(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    required = REQUIRED_SERVER.fastapi;
  } else {
    pkg({});
    required = REQUIRED_WORKSPACE;
  }
  for (const rel of required) touch(dir, rel);
  // The index links to a page that exists, so link checking has a good link to accept.
  put(path.join(dir, 'docs/README.md'), '# 索引\n\n[忽略規則](../.gitignore)\n');
  return dir;
}

/**
 * Build a composed monorepo fixture.
 *
 * @param {boolean} withContract Whether to include contract/ (it has no CLAUDE.md).
 * @param {boolean} [withDashboard] Whether to include dashboard/.
 * @returns {string} Fixture directory.
 */
function makeMonorepo(withContract, withDashboard = false) {
  counter += 1;
  const dir = path.join(base, `mono-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  const web = make('web-ui');
  const server = make('nest');
  fs.renameSync(web, path.join(dir, 'web'));
  fs.renameSync(server, path.join(dir, 'server'));
  fs.rmSync(path.join(dir, 'web/AGENTS.md'));
  fs.rmSync(path.join(dir, 'server/AGENTS.md'));
  if (withDashboard) fs.renameSync(make('web-plain'), path.join(dir, 'dashboard'));
  put(path.join(dir, 'AGENTS.md'), '# Rules\n');
  put(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  put(path.join(dir, '.gitignore'), '.env*\n!.env.example\n');
  put(path.join(dir, 'docs/README.md'), '# 產品規則\n');
  if (withContract) {
    put(path.join(dir, 'contract/package.json'), '{"name":"contract"}');
    put(path.join(dir, 'docs/contract.md'), '# 契約\n');
  }
  return dir;
}

/**
 * Run check-docs on a directory.
 *
 * @param {string} dir Target directory.
 * @returns {{code: number, out: string}} Result.
 */
function run(dir) {
  const r = spawnSync(process.execPath, [CHECK, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/**
 * Assert that a fixture fails and the output names the violation.
 *
 * @param {string} dir Fixture directory.
 * @param {RegExp} pattern Text the output must contain.
 * @returns {void}
 */
function failsWith(dir, pattern) {
  const r = run(dir);
  assert.notEqual(r.code, 0, `expected failure, got:\n${r.out}`);
  assert.match(r.out, pattern);
}

/**
 * Assert that a fixture passes.
 *
 * @param {string} dir Fixture directory.
 * @returns {void}
 */
function passes(dir) {
  const r = run(dir);
  assert.equal(r.code, 0, r.out);
}

const KINDS = ['web-plain', 'web-ui', 'nest', 'fastify', 'fastapi', 'workspace'];
/** @type {Array<[string, () => void]>} */
const tests = [];
/**
 * Register a test.
 *
 * @param {string} name Test name.
 * @param {() => void} fn Body.
 * @returns {void}
 */
const test = (name, fn) => tests.push([name, fn]);

for (const kind of KINDS) {
  test(`clean ${kind} fixture passes`, () => passes(make(kind)));
}

test('CJK in docs/rules fails', () => {
  const dir = make('nest');
  put(path.join(dir, 'docs/rules/architecture.md'), '# Rule\n\n不要這樣。\n');
  failsWith(dir, /docs\/rules\/architecture\.md: contains CJK/);
});

test('fullwidth punctuation in AGENTS.md fails', () => {
  const dir = make('web-plain');
  put(path.join(dir, 'AGENTS.md'), '# Rules\n\nUse this，not that.\n');
  failsWith(dir, /AGENTS\.md: contains CJK/);
});

test('an English record page fails', () => {
  const dir = make('web-ui');
  put(path.join(dir, 'docs/styles.md'), '# Styles\n\nEnglish only.\n');
  failsWith(dir, /docs\/styles\.md: has no Traditional Chinese/);
});

test('a broken relative link fails, a link inside code does not', () => {
  const dir = make('fastify');
  put(path.join(dir, 'docs/apis/hello.md'), '# 你好\n\n[gone](./missing.md)\n');
  failsWith(dir, /docs\/apis\/hello\.md: broken link: \.\/missing\.md/);
  put(path.join(dir, 'docs/apis/hello.md'), '# 你好\n\n`[x](./missing.md)` 與 https://example.com 與 [a](#anchor)\n');
  passes(dir);
});

test('a missing required path fails for each type', () => {
  const dirs = {
    'web-plain': 'docs/components/http-client.md',
    'web-ui': 'src/shared/hooks/useNotification.ts',
    nest: 'docs/rules/redis.md',
    fastify: 'src/server.ts',
    fastapi: 'docs/database.md',
    workspace: 'docs/contract.md',
  };
  for (const [kind, rel] of Object.entries(dirs)) {
    const dir = make(kind);
    fs.rmSync(path.join(dir, rel), { recursive: true });
    failsWith(dir, new RegExp(`${rel.replace(/[.]/g, '\\.')}: required path missing`));
  }
});

test('a plain web template must not ship useNotification', () => {
  const dir = make('web-plain');
  touch(dir, 'docs/components/useNotification.md');
  failsWith(dir, /useNotification\.md: must not exist/);
});

test('a missing .gitignore, or one not covering .env, fails', () => {
  const dir = make('nest');
  put(path.join(dir, '.gitignore'), 'node_modules/\n.env.example\n');
  failsWith(dir, /\.gitignore: does not cover \.env/);
  put(path.join(dir, '.gitignore'), '.env*\n!.env\n');
  failsWith(dir, /\.gitignore: does not cover \.env/);
  fs.rmSync(path.join(dir, '.gitignore'));
  failsWith(dir, /\.gitignore: required path missing/);
});

test('a directory that does not exist fails clearly', () => {
  failsWith(path.join(base, 'not-rendered'), /does not exist/);
});

test('a composed monorepo passes and is checked part by part', () => {
  passes(makeMonorepo(true));
  passes(makeMonorepo(false));
  const dir = makeMonorepo(true);
  fs.rmSync(path.join(dir, 'web/docs/rules/ui.md'));
  failsWith(dir, /web\/docs\/rules\/ui\.md: required path missing/);
  put(path.join(dir, 'server/docs/rules/patterns.md'), '# Rule\n\n不行\n');
  failsWith(dir, /server\/docs\/rules\/patterns\.md: contains CJK/);
});

test('a composed monorepo fails on a missing root doc, root .env ignore and contract page', () => {
  let dir = makeMonorepo(true);
  fs.rmSync(path.join(dir, 'docs/contract.md'));
  failsWith(dir, /docs\/contract\.md: required path missing/);
  dir = makeMonorepo(false);
  put(path.join(dir, '.gitignore'), 'node_modules/\n');
  failsWith(dir, /\.gitignore: does not cover \.env/);
  dir = makeMonorepo(false);
  fs.rmSync(path.join(dir, 'docs/README.md'));
  failsWith(dir, /docs\/README\.md: required path missing/);
});

test('a composed monorepo with a dashboard checks it like web, and needs a root CLAUDE.md', () => {
  passes(makeMonorepo(true, true));
  let dir = makeMonorepo(true, true);
  fs.rmSync(path.join(dir, 'dashboard/docs/rules/ui.md'));
  failsWith(dir, /dashboard\/docs\/rules\/ui\.md: required path missing/);
  dir = makeMonorepo(true, true);
  put(path.join(dir, 'dashboard/docs/README.md'), '[x](./missing.md) 索引\n');
  failsWith(dir, /dashboard\/docs\/README\.md: broken link/);
  dir = makeMonorepo(false);
  fs.rmSync(path.join(dir, 'CLAUDE.md'));
  failsWith(dir, /CLAUDE\.md: required path missing/);
});

test('a name that is not a directory resolves to templates/<name> and fails when absent', () => {
  const r = spawnSync(process.execPath, [CHECK, 'definitely-not-a-template'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /templates\/definitely-not-a-template/);
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
