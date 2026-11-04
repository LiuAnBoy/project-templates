#!/usr/bin/env node
/**
 * Reports which direct dependencies of the templates are out of date.
 *
 *   node scripts/outdated.mjs          human-readable report
 *   node scripts/outdated.mjs --json   the same report as JSON, for an agent
 *
 * Four groups: security advisories; majors; minors and patches; updates
 * blocked by a peer range. A release younger than 7 days is left out unless
 * it fixes an advisory of the pinned version.
 *
 * Exit codes: 0 the check completed; 1 it completed and found at least one
 * advisory; 2 a source could not be read (the report is then partial and says
 * so). The decision logic (`analyze`, `satisfies`, `buildReport`, `exitCode`)
 * takes plain data, so tests need no network.
 *
 * Sources, all read-only and anonymous (a generic User-Agent, no credentials):
 *   npm versions, dates, peer ranges   GET  https://registry.npmjs.org/<name>
 *   npm advisories                     POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
 *   PyPI versions and dates            GET  https://pypi.org/pypi/<name>/json
 *   PyPI advisories                    POST https://api.osv.dev/v1/query
 *
 * Node standard library only.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectDependencies, recipeTargets } from './versions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86_400_000;
export const MIN_AGE_DAYS = 7;
const USER_AGENT = 'outdated-check/1';
const NPM = 'https://registry.npmjs.org';
const SOURCE_NPM = 'npm registry (registry.npmjs.org)';
const SOURCE_NPM_ADVISORIES = 'npm advisories (registry.npmjs.org bulk advisory endpoint)';
const SOURCE_PYPI = 'PyPI (pypi.org JSON API)';
const SOURCE_OSV = 'OSV (api.osv.dev)';

/**
 * @typedef {object} Dep
 * @property {'npm'|'pypi'} ecosystem
 * @property {string} name
 * @property {string} spec Pinned version, or the raw specifier when not an exact pin.
 * @property {string[]} users Templates and overlays that declare it.
 */

/**
 * @typedef {object} ReleaseInfo
 * @property {string} [time] ISO publish time.
 * @property {Record<string, string>} [peerDependencies] Peer ranges (npm only).
 * @property {boolean} [unavailable] Deprecated or yanked: never offered as a target.
 */

/**
 * @typedef {object} Advisory
 * @property {string} id
 * @property {string} title
 * @property {string} severity
 * @property {string} url
 */

/** Registry data: `registry[key(dep)].versions[version]`. @typedef {Record<string, {versions: Record<string, ReleaseInfo>}>} Registry */
/** Advisory data: `advisories[advisoryKey(dep, version)]`, an empty array meaning clean. @typedef {Record<string, Advisory[]>} AdvisoryData */

// ---------------------------------------------------------------- versions

/**
 * @param {string} v Version string.
 * @returns {boolean} True for plain dotted numbers (no pre-release, post or dev tag).
 */
export function isStable(v) {
  return /^\d+(\.\d+)*$/.test(v);
}

/**
 * Compare two dotted-number versions, padding the shorter with zeros.
 *
 * @param {string} a Version.
 * @param {string} b Version.
 * @returns {number} Negative, zero or positive.
 */
export function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Classify an update by the first differing component: the first is a major,
 * the second a minor, anything later a patch. A 0.x minor is therefore a
 * "minor" even though 0.x projects may break in it.
 *
 * @param {string} current Pinned version.
 * @param {string} next Newer version.
 * @returns {'major'|'minor'|'patch'} Kind.
 */
export function updateKind(current, next) {
  const [a, b] = current.split('.').map(Number);
  const [c, d] = next.split('.').map(Number);
  if (c !== a) return 'major';
  return (d ?? 0) !== (b ?? 0) ? 'minor' : 'patch';
}

// ------------------------------------------------------------------ ranges

/**
 * Parse a possibly partial version such as `1`, `1.2`, `1.2.x` or `*`.
 * A pre-release or build suffix is dropped (conservative: bounds are then read as the plain version).
 *
 * @param {string} text Partial version.
 * @returns {{n: number, parts: number[]}|null} Count of leading numbers and their values, or null when unparseable.
 */
function parsePartial(text) {
  const t = text.replace(/^v/i, '').replace(/\+.*$/, '').replace(/-.*$/, '');
  if (t === '' || /^[xX*]$/.test(t)) return { n: 0, parts: [] };
  const raw = t.split('.');
  if (raw.length > 3) return null;
  const parts = [];
  let wild = false;
  for (const p of raw) {
    if (/^[xX*]$/.test(p)) wild = true;
    else if (wild || !/^\d+$/.test(p)) return null;
    else parts.push(Number(p));
  }
  return { n: parts.length, parts };
}

/**
 * Turn an operator and a partial version into primitive comparators.
 *
 * @param {string} op One of '', '=', '^', '~', '~>', '>=', '>', '<=', '<'.
 * @param {{n: number, parts: number[]}} p Parsed partial version.
 * @returns {Array<[string, number[]]>|null} Comparators that must all hold, or null when unsupported.
 */
function comparators(op, p) {
  const [a = 0, b = 0, c = 0] = p.parts;
  const n = p.n;
  const low = [a, b, c];
  switch (op) {
    case '':
    case '=':
      if (n === 0) return [];
      if (n === 3) return [['=', low]];
      return [['>=', low], ['<', n === 2 ? [a, b + 1, 0] : [a + 1, 0, 0]]];
    case '^': {
      if (n === 0) return [];
      let up;
      if (a > 0 || n === 1) up = [a + 1, 0, 0];
      else if (n === 2 || b > 0) up = [0, b + 1, 0];
      else up = [0, 0, c + 1];
      return [['>=', low], ['<', up]];
    }
    case '~':
    case '~>':
      if (n === 0) return [];
      return [['>=', low], ['<', n === 1 ? [a + 1, 0, 0] : [a, b + 1, 0]]];
    case '>=':
      return n === 0 ? [] : [['>=', low]];
    case '>':
      if (n === 0) return null;
      if (n === 3) return [['>', low]];
      return [['>=', n === 2 ? [a, b + 1, 0] : [a + 1, 0, 0]]];
    case '<=':
      if (n === 0) return [];
      if (n === 3) return [['<=', low]];
      return [['<', n === 2 ? [a, b + 1, 0] : [a + 1, 0, 0]]];
    case '<':
      return n === 0 ? null : [['<', low]];
    default:
      return null;
  }
}

/**
 * Evaluate one comparator set (the part between `||`) against a version.
 *
 * @param {string} version Stable version.
 * @param {string} set Space-separated comparators, or a hyphen range.
 * @returns {boolean|null} Result, or null when the set is not understood.
 */
function matchSet(version, set) {
  const text = set.trim();
  if (text === '') return true;
  let list = [];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hyphen) {
    const from = parsePartial(hyphen[1]);
    const to = parsePartial(hyphen[2]);
    if (!from || !to) return null;
    list = [...(comparators('>=', from) ?? []), ...(comparators('<=', to) ?? [])];
  } else {
    for (const token of text.replace(/([<>=~^]+)\s+/g, '$1').split(/\s+/)) {
      const m = /^(\^|~>?|>=|<=|>|<|=)?(.*)$/.exec(token);
      const partial = parsePartial(m[2]);
      if (!partial) return null;
      const parts = comparators(m[1] ?? '', partial);
      if (parts === null) return null;
      list.push(...parts);
    }
  }
  return list.every(([op, triple]) => {
    const d = compareVersions(version, triple.join('.'));
    return { '=': d === 0, '>=': d >= 0, '>': d > 0, '<=': d <= 0, '<': d < 0 }[op];
  });
}

/**
 * Whether a stable version satisfies an npm semver range. Supports `||`,
 * `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, x-ranges, `*` and hyphen ranges.
 * Anything else (tags, URLs, `workspace:`) is "not understood": the result is
 * null, and callers must treat it as not blocking, so a block is only ever
 * claimed on a range this function read. Pre-release suffixes inside a range
 * are ignored.
 *
 * @param {string} version Stable dotted version.
 * @param {string} range Range text.
 * @returns {boolean|null} True or false, or null when the range is not understood.
 */
export function satisfies(version, range) {
  let unknown = false;
  for (const set of range.split('||')) {
    const result = matchSet(version, set);
    if (result === null) unknown = true;
    else if (result) return true;
  }
  return unknown ? null : false;
}

// ---------------------------------------------------------------- analysis

/**
 * @param {Pick<Dep, 'ecosystem'|'name'>} dep Dependency.
 * @returns {string} Key into the registry data.
 */
export const key = (dep) => `${dep.ecosystem}:${dep.name}`;

/**
 * @param {Pick<Dep, 'ecosystem'|'name'>} dep Dependency.
 * @param {string} version Version.
 * @returns {string} Key into the advisory data.
 */
export const advisoryKey = (dep, version) => `${dep.ecosystem}:${dep.name}@${version}`;

/**
 * Whether a dependency is an exact pin that can be compared.
 *
 * @param {Dep} dep Dependency.
 * @returns {boolean} True for `x.y.z` (npm) or a plain dotted version (PyPI).
 */
export function isExactPin(dep) {
  return dep.ecosystem === 'npm' ? /^\d+\.\d+\.\d+$/.test(dep.spec) : isStable(dep.spec);
}

/**
 * Stable, available versions newer than the pinned one, newest first.
 *
 * @param {Dep} dep Dependency.
 * @param {Registry} registry Registry data.
 * @returns {string[]} Versions.
 */
function newerVersions(dep, registry) {
  const versions = registry[key(dep)]?.versions ?? {};
  return Object.keys(versions)
    .filter((v) => isStable(v) && !versions[v].unavailable && compareVersions(v, dep.spec) > 0)
    .sort((a, b) => compareVersions(b, a));
}

/**
 * Whether a release is old enough to recommend.
 *
 * @param {ReleaseInfo|undefined} info Release data.
 * @param {number} now Current time in ms.
 * @returns {boolean} True when it is at least {@link MIN_AGE_DAYS} old; an unknown date counts as old.
 */
function isSeasoned(info, now) {
  const t = info?.time ? Date.parse(info.time) : NaN;
  return Number.isNaN(t) || now - t >= MIN_AGE_DAYS * DAY_MS;
}

/**
 * Versions whose advisories must be fetched for a dependency: the pinned
 * one, the newest newer release, and the newest newer release old enough to
 * recommend. The first tells whether the pin is affected, the others whether
 * an update fixes it.
 *
 * @param {Dep} dep Exactly pinned dependency.
 * @param {Registry} registry Registry data.
 * @param {number} now Current time in ms.
 * @returns {string[]} Distinct versions.
 */
export function versionsToCheck(dep, registry, now) {
  const newer = newerVersions(dep, registry);
  const versions = registry[key(dep)]?.versions ?? {};
  const seasoned = newer.find((v) => isSeasoned(versions[v], now));
  return [...new Set([dep.spec, newer[0], seasoned].filter(Boolean))];
}

/**
 * Pinned dependencies whose peer range rejects a version of another one.
 *
 * Only pairs that share a template or overlay count, because only then are
 * they installed together.
 *
 * @param {Dep} dep Dependency being updated.
 * @param {string} version Candidate version.
 * @param {Dep[]} deps All exactly pinned dependencies.
 * @param {Registry} registry Registry data.
 * @param {string[]} notes Receives a line for each peer range that could not be read.
 * @returns {Array<{name: string, version: string, range: string}>} Blockers.
 */
function peerBlockers(dep, version, deps, registry, notes) {
  const blockers = [];
  for (const other of deps) {
    if (other.ecosystem !== 'npm' || other === dep) continue;
    if (!other.users.some((u) => dep.users.includes(u))) continue;
    const range = registry[key(other)]?.versions[other.spec]?.peerDependencies?.[dep.name];
    if (range === undefined) continue;
    const ok = satisfies(version, range);
    if (ok === null) notes.push(`${other.name}@${other.spec} peer range for ${dep.name} not understood: "${range}" (not treated as a block)`);
    else if (!ok) blockers.push({ name: other.name, version: other.spec, range });
  }
  return blockers;
}

/**
 * Classify every exactly pinned dependency. Pure: no network, no clock.
 *
 * @param {object} input
 * @param {Dep[]} input.deps Direct dependencies.
 * @param {Registry} input.registry Versions, dates and peer ranges.
 * @param {AdvisoryData} input.advisories Advisories per `advisoryKey`.
 * @param {number} input.now Current time in ms.
 * @returns {object} Groups: `advisories`, `majors`, `minorsAndPatches`, `blocked`, `heldBack`, `skipped`, `notes`.
 */
export function analyze({ deps, registry, advisories, now }) {
  const groups = { advisories: [], majors: [], minorsAndPatches: [], blocked: [], heldBack: [], skipped: [], notes: [] };
  const pinned = deps.filter(isExactPin);
  for (const dep of deps) {
    if (!isExactPin(dep)) groups.skipped.push({ ecosystem: dep.ecosystem, name: dep.name, spec: dep.spec, reason: 'not an exact pin' });
  }

  for (const dep of pinned) {
    const versions = registry[key(dep)]?.versions;
    if (!versions) continue;
    const newer = newerVersions(dep, registry);
    const current = advisories[advisoryKey(dep, dep.spec)] ?? [];
    const release = (v) => ({ version: v, kind: updateKind(dep.spec, v), released: versions[v]?.time ?? null });
    const base = { ecosystem: dep.ecosystem, name: dep.name, current: dep.spec, users: dep.users };

    if (current.length > 0) {
      const clean = newer.find((v) => (advisories[advisoryKey(dep, v)] ?? null)?.length === 0);
      const blockedBy = clean ? peerBlockers(dep, clean, pinned, registry, groups.notes) : [];
      groups.advisories.push({
        ...base,
        advisories: current,
        fix: clean ? release(clean) : null,
        newest: newer[0] ?? null,
        blockedBy,
      });
      continue;
    }

    const seasoned = newer.filter((v) => isSeasoned(versions[v], now));
    for (const v of newer) {
      if (!seasoned.includes(v)) {
        groups.heldBack.push({ ...base, ...release(v), ageDays: Math.floor((now - Date.parse(versions[v].time)) / DAY_MS) });
      }
    }
    if (seasoned.length === 0) continue;

    const target = seasoned[0];
    const blockedBy = peerBlockers(dep, target, pinned, registry, groups.notes);
    let offered = target;
    if (blockedBy.length > 0) {
      offered = seasoned.find((v) => peerBlockers(dep, v, pinned, registry, []).length === 0) ?? null;
      groups.blocked.push({ ...base, ...release(target), blockedBy, allowed: offered ? release(offered) : null });
    }
    if (offered) {
      const entry = { ...base, ...release(offered) };
      (entry.kind === 'major' ? groups.majors : groups.minorsAndPatches).push(entry);
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'en') || compareVersions(a.current, b.current);
  for (const list of Object.values(groups)) {
    if (list.length > 0 && 'name' in list[0]) list.sort(byName);
  }
  groups.notes = [...new Set(groups.notes)].sort();
  return groups;
}

/**
 * Assemble the final report.
 *
 * @param {object} input
 * @param {Dep[]} input.deps Every dependency that was considered.
 * @param {object} input.groups Result of {@link analyze}.
 * @param {Array<{source: string, target?: string, message: string}>} input.errors Sources that could not be read.
 * @param {number} input.now Current time in ms.
 * @returns {object} Report; `complete` is true only when `errors` is empty.
 */
export function buildReport({ deps, groups, errors, now }) {
  return {
    complete: errors.length === 0,
    checkedAt: new Date(now).toISOString().slice(0, 10),
    counts: {
      npm: deps.filter((d) => d.ecosystem === 'npm').length,
      pypi: deps.filter((d) => d.ecosystem === 'pypi').length,
    },
    errors,
    ...groups,
  };
}

/**
 * @param {{complete: boolean, advisories: unknown[]}} report Report.
 * @returns {number} 2 when a source failed, else 1 when an advisory exists, else 0.
 */
export function exitCode(report) {
  if (!report.complete) return 2;
  return report.advisories.length > 0 ? 1 : 0;
}

// -------------------------------------------------------------- formatting

/**
 * @param {{released: string|null}} e Entry.
 * @returns {string} Release date text.
 */
const when = (e) => (e.released ? ` (released ${e.released.slice(0, 10)})` : '');

/**
 * Render a report as plain text.
 *
 * @param {ReturnType<typeof buildReport>} r Report.
 * @returns {string} Text.
 */
export function formatText(r) {
  const out = [];
  const total = r.counts.npm + r.counts.pypi;
  out.push(`Dependency check ${r.checkedAt}: ${total} direct dependencies (npm ${r.counts.npm}, PyPI ${r.counts.pypi}).`);
  if (r.complete) {
    out.push('Every source was read; the result is complete.');
  } else {
    out.push('INCOMPLETE: these sources could not be read, so the groups below are partial.');
    out.push('Do NOT read this as "up to date". Fix the cause and run again.');
    for (const e of r.errors) out.push(`  - ${e.source}${e.target ? ` [${e.target}]` : ''}: ${e.message}`);
  }
  const users = (e) => `used by: ${e.users.join(', ')}`;
  const section = (title, list, line) => {
    out.push('', `== ${title} (${list.length}) ==`);
    if (list.length === 0) out.push('  none');
    for (const e of list) out.push(...[].concat(line(e)).map((l) => `  ${l}`));
  };
  section('Security advisories: fix before creating a project', r.advisories, (e) => [
    `${e.name} ${e.current}  (${e.ecosystem})`,
    ...e.advisories.map((a) => `  [${a.severity}] ${a.id}: ${a.title}  ${a.url}`),
    e.fix
      ? `  fix: ${e.fix.version} (${e.fix.kind})${when(e.fix)}${e.blockedBy.length ? `; BLOCKED by ${e.blockedBy.map((b) => `${b.name}@${b.version} peer "${b.range}"`).join(', ')}` : ''}`
      : `  fix: no clean release among the checked ones${e.newest ? ` (newest ${e.newest})` : ''}`,
    `  ${users(e)}`,
  ]);
  const move = (e) => `${e.name}  ${e.current} -> ${e.version}${when(e)}  ${users(e)}`;
  section('Major updates', r.majors, move);
  section('Minor and patch updates', r.minorsAndPatches, (e) => `${move(e)} [${e.kind}]`);
  section('Blocked by a peer range', r.blocked, (e) => [
    `${e.name}  ${e.current} -> ${e.version} (${e.kind})${when(e)}`,
    ...e.blockedBy.map((b) => `  blocked by ${b.name}@${b.version}: peer ${e.name} "${b.range}"`),
    e.allowed ? `  highest allowed meanwhile: ${e.allowed.version} (listed above)` : '  no newer version is allowed',
    `  ${users(e)}`,
  ]);
  if (r.heldBack.length > 0) {
    out.push('', `Left out, released under ${MIN_AGE_DAYS} days ago (${r.heldBack.length}): ${r.heldBack.map((h) => `${h.name} ${h.version}`).join(', ')}`);
  }
  if (r.skipped.length > 0) {
    out.push('', `Not checked, not an exact pin (${r.skipped.length}): ${r.skipped.map((s) => `${s.name} ${s.spec}`).join(', ')}`);
  }
  for (const note of r.notes) out.push('', `Note: ${note}`);
  return out.join('\n');
}

// ----------------------------------------------------------------- network

/**
 * Fetch JSON with a timeout and two retries for network errors, 429 and 5xx.
 *
 * @param {string} url URL.
 * @param {{method?: string, body?: unknown}} [init] Request options; a body is sent as JSON.
 * @returns {Promise<any>} Parsed body.
 * @throws {Error} After the last attempt, with the status or cause in the message.
 */
export async function httpJson(url, init = {}) {
  let last = 'request failed';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(last);
}

/**
 * Run async work over a list with bounded concurrency.
 *
 * @template T
 * @param {T[]} items Items.
 * @param {(item: T) => Promise<void>} work Worker; must not throw.
 * @param {number} [limit] Parallelism.
 * @returns {Promise<void>}
 */
async function pool(items, work, limit = 8) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) await work(queue.shift());
  }));
}

/**
 * Reduce an npm packument to the fields the analysis needs.
 *
 * @param {any} json Full packument.
 * @returns {{versions: Record<string, ReleaseInfo>}} Normalised data.
 */
export function normalizeNpm(json) {
  const versions = {};
  for (const [v, meta] of Object.entries(json.versions ?? {})) {
    versions[v] = {
      time: json.time?.[v],
      peerDependencies: meta.peerDependencies ?? {},
      unavailable: typeof meta.deprecated === 'string' && meta.deprecated !== '',
    };
  }
  return { versions };
}

/**
 * Reduce a PyPI project JSON to the fields the analysis needs.
 *
 * @param {any} json Response of `/pypi/<name>/json`.
 * @returns {{versions: Record<string, ReleaseInfo>}} Normalised data; releases with no files are dropped.
 */
export function normalizePypi(json) {
  const versions = {};
  for (const [v, files] of Object.entries(json.releases ?? {})) {
    if (files.length === 0) continue;
    const times = files.map((f) => f.upload_time_iso_8601).filter(Boolean).sort();
    versions[v] = { time: times[0], unavailable: files.every((f) => f.yanked) };
  }
  return { versions };
}

/**
 * Read versions, dates and peer ranges of every pinned package.
 *
 * @param {Dep[]} deps Exactly pinned dependencies.
 * @param {typeof httpJson} getJson Request function (injectable).
 * @returns {Promise<{registry: Registry, errors: Array<{source: string, target?: string, message: string}>}>} Data and failures.
 */
export async function loadRegistry(deps, getJson = httpJson) {
  const registry = {};
  const errors = [];
  const unique = [...new Map(deps.map((d) => [key(d), d])).values()];
  await pool(unique, async (dep) => {
    const isNpm = dep.ecosystem === 'npm';
    const url = isNpm ? `${NPM}/${dep.name.replace('/', '%2F')}` : `https://pypi.org/pypi/${dep.name}/json`;
    try {
      const json = await getJson(url);
      registry[key(dep)] = isNpm ? normalizeNpm(json) : normalizePypi(json);
    } catch (error) {
      errors.push({ source: isNpm ? SOURCE_NPM : SOURCE_PYPI, target: dep.name, message: error.message });
    }
  });
  return { registry, errors };
}

/**
 * Read the advisories of the versions that matter for each package.
 *
 * npm answers the bulk endpoint with advisories per package but not per
 * version, so each request carries one version per package; a package that
 * needs several versions checked spreads them over several requests.
 *
 * @param {Dep[]} deps Exactly pinned dependencies.
 * @param {Registry} registry Registry data.
 * @param {number} now Current time in ms.
 * @param {typeof httpJson} getJson Request function (injectable).
 * @returns {Promise<{advisories: AdvisoryData, errors: Array<{source: string, target?: string, message: string}>}>} Data and failures.
 */
export async function loadAdvisories(deps, registry, now, getJson = httpJson) {
  const advisories = {};
  const errors = [];
  const wanted = deps
    .filter((d) => registry[key(d)])
    .map((d) => ({ dep: d, versions: versionsToCheck(d, registry, now) }));

  // A package pinned at several versions needs one round per version, so every
  // name and version pair is queried and none overwrites another.
  const npmVersions = new Map();
  for (const { dep, versions } of wanted.filter((w) => w.dep.ecosystem === 'npm')) {
    const set = npmVersions.get(dep.name) ?? new Set();
    for (const v of versions) set.add(v);
    npmVersions.set(dep.name, set);
  }
  const npmRounds = [];
  for (const [name, set] of npmVersions) {
    [...set].forEach((v, i) => {
      (npmRounds[i] ??= {})[name] = v;
    });
  }
  for (const round of npmRounds) {
    try {
      const body = await getJson(`${NPM}/-/npm/v1/security/advisories/bulk`, {
        method: 'POST',
        body: Object.fromEntries(Object.entries(round).map(([name, v]) => [name, [v]])),
      });
      for (const [name, version] of Object.entries(round)) {
        advisories[advisoryKey({ ecosystem: 'npm', name }, version)] = (body[name] ?? []).map((a) => ({
          id: a.url?.split('/').pop() ?? String(a.id),
          title: a.title ?? '',
          severity: a.severity ?? 'unknown',
          url: a.url ?? '',
        }));
      }
    } catch (error) {
      errors.push({ source: SOURCE_NPM_ADVISORIES, message: error.message });
    }
  }

  const pypi = wanted.filter((w) => w.dep.ecosystem === 'pypi').flatMap((w) => w.versions.map((v) => ({ dep: w.dep, v })));
  await pool(pypi, async ({ dep, v }) => {
    try {
      const found = [];
      let pageToken;
      do {
        const body = await getJson('https://api.osv.dev/v1/query', {
          method: 'POST',
          body: { version: v, package: { name: dep.name, ecosystem: 'PyPI' }, ...(pageToken ? { page_token: pageToken } : {}) },
        });
        found.push(...(body.vulns ?? []).filter((x) => !x.withdrawn));
        pageToken = body.next_page_token;
      } while (pageToken);
      advisories[advisoryKey(dep, v)] = found.map((x) => ({
        id: x.id,
        title: x.summary ?? '',
        severity: String(x.database_specific?.severity ?? 'unknown').toLowerCase(),
        url: `https://osv.dev/vulnerability/${x.id}`,
      }));
    } catch (error) {
      errors.push({ source: SOURCE_OSV, target: `${dep.name}@${v}`, message: error.message });
    }
  });
  return { advisories, errors };
}

/**
 * Run the check end to end.
 *
 * @param {object} options
 * @param {Dep[]} options.deps Direct dependencies.
 * @param {typeof httpJson} [options.getJson] Request function (injectable).
 * @param {number} [options.now] Current time in ms.
 * @returns {Promise<ReturnType<typeof buildReport>>} Report.
 */
export async function check({ deps, getJson = httpJson, now = Date.now() }) {
  const pinned = deps.filter(isExactPin);
  const { registry, errors: registryErrors } = await loadRegistry(pinned, getJson);
  const { advisories, errors: advisoryErrors } = await loadAdvisories(pinned, registry, now, getJson);
  const errors = [...registryErrors, ...advisoryErrors].sort(
    (a, b) => a.source.localeCompare(b.source) || (a.target ?? '').localeCompare(b.target ?? ''),
  );
  return buildReport({ deps, groups: analyze({ deps, registry, advisories, now }), errors, now });
}

/**
 * Command line entry.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv) {
  if (argv.some((a) => a !== '--json')) {
    console.error('usage: node scripts/outdated.mjs [--json]');
    return 2;
  }
  let deps;
  try {
    deps = collectDependencies(ROOT, await recipeTargets(ROOT));
  } catch (error) {
    console.error(`outdated: cannot read the manifests: ${error.message}`);
    return 2;
  }
  const report = await check({ deps });
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatText(report));
  return exitCode(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
