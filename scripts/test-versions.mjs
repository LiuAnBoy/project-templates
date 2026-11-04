#!/usr/bin/env node
/**
 * Guards versions.mjs and outdated.mjs with fixtures and injected registry
 * data; no network. Run with plain `node scripts/test-versions.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  advisoryKey,
  analyze,
  buildReport,
  check,
  exitCode,
  formatText,
  key,
  satisfies,
  versionsToCheck,
} from './outdated.mjs';
import { run } from './versions.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'test-versions-'));
const NOW = Date.parse('2026-11-04T12:00:00Z');
let counter = 0;
let failures = 0;

/**
 * Run one named test and record its outcome.
 *
 * @param {string} name Test name.
 * @param {() => Promise<void>|void} fn Test body.
 * @returns {Promise<void>}
 */
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}

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
 * Build a fixture repository with two templates, one overlay and a Python project.
 *
 * @returns {{root: string, targets: Array<{name: string, dir: string}>}} Fixture.
 */
function fixture() {
  counter += 1;
  const root = path.join(base, `repo${counter}`);
  const pkg = (deps) => JSON.stringify({ name: 'x', dependencies: deps });
  put(path.join(root, 'templates/a/package.json'), pkg({ zod: '4.0.0', left: '1.0.0', local: 'workspace:*' }));
  put(path.join(root, 'templates/b/package.json'), pkg({ zod: '3.0.0' }));
  put(path.join(root, 'templates/b/node_modules/ignored/package.json'), pkg({ ghost: '9.9.9' }));
  put(path.join(root, 'overlays/a-ui/package.json'), pkg({ zod: '4.0.0', ui: '2.0.0' }));
  put(
    path.join(root, 'templates/py/pyproject.toml'),
    ['[project]', 'dependencies = [', '    "FastAPI==0.1.0",', '    "uvicorn[standard]==0.2.0",', ']', '', '[dependency-groups]', 'dev = ["pytest==9.0.0"]', ''].join('\n'),
  );
  const targets = [
    { name: 'a', dir: 'templates/a' },
    { name: 'b', dir: 'templates/b' },
    { name: 'a-ui', dir: 'overlays/a-ui' },
    { name: 'py', dir: 'templates/py' },
  ];
  return { root, targets };
}

/**
 * Run versions.mjs against a fixture and capture its output.
 *
 * @param {ReturnType<typeof fixture>} fx Fixture.
 * @param {string[]} argv Arguments.
 * @param {string} [today] Date for `--stamp`.
 * @returns {Promise<{code: number, out: string[]}>} Exit code and output lines.
 */
async function versions(fx, argv, today = '2026-01-02') {
  const out = [];
  const code = await run(argv, { root: fx.root, targets: fx.targets, today, log: (l) => out.push(l) });
  return { code, out };
}

/**
 * Release table for injected registry data.
 *
 * @param {Record<string, {daysAgo: number, peers?: Record<string, string>}>} releases Versions and ages.
 * @returns {{versions: Record<string, object>}} Registry entry.
 */
function releases(releases) {
  const out = {};
  for (const [v, r] of Object.entries(releases)) {
    out[v] = { time: new Date(NOW - r.daysAgo * 86_400_000).toISOString(), peerDependencies: r.peers ?? {} };
  }
  return { versions: out };
}

const dep = (name, spec, users = ['t'], ecosystem = 'npm') => ({ ecosystem, name, spec, users });

await test('versions.mjs lists every package with its users and keeps different pins apart', async () => {
  const fx = fixture();
  assert.equal((await versions(fx, ['--stamp'])).code, 0);
  const text = fs.readFileSync(path.join(fx.root, 'VERSIONS.md'), 'utf8');
  assert.match(text, /最後通過驗證的日期：2026-01-02/);
  assert.match(text, /\| `zod` \| `3\.0\.0` \| b \|/);
  assert.match(text, /\| `zod` \| `4\.0\.0` \| a, a-ui \|/);
  assert.match(text, /\| `fastapi` \| `0\.1\.0` \| py \|/);
  assert.match(text, /\| `uvicorn` \| `0\.2\.0` \| py \|/);
  assert.match(text, /\| `pytest` \| `9\.0\.0` \| py \|/);
  assert.doesNotMatch(text, /ghost|workspace:/);
});

await test('versions.mjs keeps the recorded date unless --stamp is given', async () => {
  const fx = fixture();
  await versions(fx, ['--stamp'], '2026-01-02');
  await versions(fx, [], '2026-05-05');
  assert.match(fs.readFileSync(path.join(fx.root, 'VERSIONS.md'), 'utf8'), /2026-01-02/);
  await versions(fx, ['--stamp'], '2026-05-05');
  assert.match(fs.readFileSync(path.join(fx.root, 'VERSIONS.md'), 'utf8'), /2026-05-05/);
});

await test('versions.mjs --check passes on a fresh file and names what is stale', async () => {
  const fx = fixture();
  assert.equal((await versions(fx, ['--check'])).code, 1, 'missing file is stale');
  await versions(fx, ['--stamp']);
  assert.equal((await versions(fx, ['--check'])).code, 0);
  put(path.join(fx.root, 'templates/b/package.json'), JSON.stringify({ dependencies: { zod: '3.1.0' } }));
  const { code, out } = await versions(fx, ['--check']);
  assert.equal(code, 1);
  assert.ok(out.some((l) => l.includes('zod') && l.includes('3.1.0')), out.join('\n'));
  assert.ok(out.some((l) => l.includes('zod') && l.includes('3.0.0')), out.join('\n'));
});

await test('satisfies reads the range forms the templates use and refuses what it cannot read', () => {
  assert.equal(satisfies('11.2.8', '^10.0.0 || ^11.0.0'), true);
  assert.equal(satisfies('12.0.0', '^10.0.0 || ^11.0.0'), false);
  assert.equal(satisfies('6.0.3', '>=4.8.4 <6.1.0'), true);
  assert.equal(satisfies('6.1.0', '>=4.8.4 <6.1.0'), false);
  assert.equal(satisfies('0.3.1', '^0.3.0'), true);
  assert.equal(satisfies('0.4.0', '^0.3.0'), false);
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
  assert.equal(satisfies('3.9.9', '3.x'), true);
  assert.equal(satisfies('9.0.0', '*'), true);
  assert.equal(satisfies('2.5.0', '1.0.0 - 2.5.0'), true);
  assert.equal(satisfies('1.0.0', 'latest'), null);
  assert.equal(satisfies('1.0.0', '>=2 || latest'), null);
  assert.equal(satisfies('2.0.0', '>=2 || latest'), true);
});

await test('analyze classifies major, minor and patch and leaves out fresh releases', () => {
  const deps = [dep('big', '1.0.0'), dep('mid', '1.0.0'), dep('small', '1.0.0'), dep('fresh', '1.0.0'), dep('same', '1.0.0')];
  const registry = {
    [key(deps[0])]: releases({ '1.0.0': { daysAgo: 400 }, '2.0.0': { daysAgo: 30 } }),
    [key(deps[1])]: releases({ '1.0.0': { daysAgo: 400 }, '1.4.0': { daysAgo: 30 } }),
    [key(deps[2])]: releases({ '1.0.0': { daysAgo: 400 }, '1.0.3': { daysAgo: 30 }, '1.0.4': { daysAgo: 2 }, '1.1.0-rc.1': { daysAgo: 40 } }),
    [key(deps[3])]: releases({ '1.0.0': { daysAgo: 400 }, '1.0.1': { daysAgo: 3 } }),
    [key(deps[4])]: releases({ '1.0.0': { daysAgo: 400 } }),
  };
  const g = analyze({ deps, registry, advisories: {}, now: NOW });
  assert.deepEqual(g.majors.map((e) => [e.name, e.version]), [['big', '2.0.0']]);
  assert.deepEqual(g.minorsAndPatches.map((e) => [e.name, e.version, e.kind]), [['mid', '1.4.0', 'minor'], ['small', '1.0.3', 'patch']]);
  assert.deepEqual(g.heldBack.map((e) => e.name + e.version), ['fresh1.0.1', 'small1.0.4']);
  assert.equal(g.advisories.length + g.blocked.length, 0);
});

await test('a release under 7 days old is kept when it fixes an advisory of the pin', () => {
  const d = dep('vuln', '1.0.0');
  const registry = { [key(d)]: releases({ '1.0.0': { daysAgo: 400 }, '1.0.1': { daysAgo: 30 }, '1.0.2': { daysAgo: 1 } }) };
  const advisories = {
    [advisoryKey(d, '1.0.0')]: [{ id: 'GHSA-x', title: 'bad', severity: 'high', url: 'u' }],
    [advisoryKey(d, '1.0.1')]: [{ id: 'GHSA-x', title: 'bad', severity: 'high', url: 'u' }],
    [advisoryKey(d, '1.0.2')]: [],
  };
  assert.deepEqual(versionsToCheck(d, registry, NOW), ['1.0.0', '1.0.2', '1.0.1']);
  const g = analyze({ deps: [d], registry, advisories, now: NOW });
  assert.equal(g.advisories.length, 1);
  assert.equal(g.advisories[0].fix.version, '1.0.2');
  assert.equal(g.minorsAndPatches.length, 0, 'an advisory entry is not repeated as a plain update');
  const report = buildReport({ deps: [d], groups: g, errors: [], now: NOW });
  assert.equal(exitCode(report), 1);
});

await test('a peer range of another pinned dependency blocks the update and names the blocker', () => {
  const ts = dep('typescript', '6.0.3');
  const lint = dep('typescript-eslint', '8.0.0');
  const registry = {
    [key(ts)]: releases({ '6.0.3': { daysAgo: 300 }, '6.0.9': { daysAgo: 50 }, '7.0.0': { daysAgo: 60 } }),
    [key(lint)]: releases({ '8.0.0': { daysAgo: 300, peers: { typescript: '>=4.8.4 <6.1.0' } } }),
  };
  const g = analyze({ deps: [ts, lint], registry, advisories: {}, now: NOW });
  assert.equal(g.blocked.length, 1);
  assert.equal(g.blocked[0].version, '7.0.0');
  assert.deepEqual(g.blocked[0].blockedBy, [{ name: 'typescript-eslint', version: '8.0.0', range: '>=4.8.4 <6.1.0' }]);
  assert.equal(g.blocked[0].allowed.version, '6.0.9', 'the highest allowed version is still offered');
  assert.deepEqual(g.minorsAndPatches.map((e) => e.version), ['6.0.9']);
  assert.equal(g.majors.length, 0);
});

await test('a peer range only blocks packages that are installed together', () => {
  const ts = dep('typescript', '6.0.3', ['web']);
  const lint = dep('typescript-eslint', '8.0.0', ['server']);
  const registry = {
    [key(ts)]: releases({ '6.0.3': { daysAgo: 300 }, '7.0.0': { daysAgo: 60 } }),
    [key(lint)]: releases({ '8.0.0': { daysAgo: 300, peers: { typescript: '<6.1.0' } } }),
  };
  const g = analyze({ deps: [ts, lint], registry, advisories: {}, now: NOW });
  assert.equal(g.blocked.length, 0);
  assert.equal(g.majors.length, 1);
});

await test('a source that cannot be read gives exit 2, names the source and is never complete', async () => {
  const deps = [dep('a', '1.0.0'), dep('b', '1.0.0', ['t'], 'pypi')];
  const getJson = async (url) => {
    if (url.includes('pypi.org')) throw new Error('ECONNREFUSED');
    if (url.includes('security/advisories')) return {};
    return { versions: { '1.0.0': {} }, time: {} };
  };
  const report = await check({ deps, getJson, now: NOW });
  assert.equal(report.complete, false);
  assert.equal(exitCode(report), 2);
  assert.deepEqual(report.errors.map((e) => [e.source, e.target]), [['PyPI (pypi.org JSON API)', 'b']]);
  const text = formatText(report);
  assert.match(text, /INCOMPLETE/);
  assert.match(text, /PyPI \(pypi\.org JSON API\) \[b\]: ECONNREFUSED/);
  assert.doesNotMatch(text, /result is complete/);

  const ok = await check({ deps: [deps[0]], getJson, now: NOW });
  assert.equal(ok.complete, true);
  assert.equal(exitCode(ok), 0);
});

fs.rmSync(base, { recursive: true, force: true });
if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('all tests passed');
