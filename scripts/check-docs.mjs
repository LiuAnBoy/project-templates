#!/usr/bin/env node
/**
 * Checks the documents of one or more templates.
 *
 * Usage: node scripts/check-docs.mjs <name|dir>...
 *   An argument containing a slash, or naming an existing directory, is
 *   checked where it stands; any other argument resolves to templates/<name>.
 *
 * Checks, per target:
 *   - relative markdown links resolve to existing files or directories
 *   - AGENTS.md and docs/rules/**.md contain no CJK characters
 *   - every other docs/**.md page contains Han characters
 *   - the required paths of the target's type exist (REQUIRED_* below)
 *   - .gitignore covers `.env`
 *
 * Target types, detected from manifests: web (next or vite dependency), nest, fastify, fastapi, workspace
 * (pnpm-workspace.yaml plus contract/package.json) and monorepo (a composed
 * root holding web/ and server/, optional dashboard/ and contract/, and
 * docs/). A monorepo is checked part by part, each part as its own type;
 * contract/ needs only its package.json, not a CLAUDE.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  '.venv',
  '__pycache__',
  'test-results',
  'playwright-report',
]);

/** Characters that must not appear in English-only documents. */
const CJK_ANY = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
/** Han ideographs: what a Traditional Chinese page must contain. */
const HAN = /[㐀-䶿一-鿿]/;

const RULES_WEB = ['architecture', 'data-layer', 'testing', 'ui'].map(
  (n) => `docs/rules/${n}.md`,
);
const RULES_SERVER = [
  'architecture',
  'api-and-errors',
  'data',
  'patterns',
  'docs-to-update',
].map((n) => `docs/rules/${n}.md`);

/** Paths every web template needs, whatever its UI variant (plain or an overlay). */
export const REQUIRED_WEB = [
  'CLAUDE.md',
  'docs/README.md',
  'docs/styles.md',
  'docs/components/README.md',
  'docs/components/http-client.md',
  'docs/components/useMediaQuery.md',
  'docs/components/date.md',
  'docs/components/useNotification.md',
  'docs/components/ErrorState.md',
  'docs/components/test-helpers.md',
  ...RULES_WEB,
  'src/app',
  'src/modules/home/index.ts',
  'src/shared/http/http.ts',
  'src/shared/http/errors.ts',
  'src/shared/hooks/useMediaQuery.ts',
  'src/shared/hooks/useNotification.ts',
  'src/shared/components/ErrorState.tsx',
  'src/test/renderWithProviders.tsx',
  'src/test/matchMedia.ts',
  'src/shared/utils/date.ts',
  'src/shared/providers/UiProvider.tsx',
  'src/shared/providers/ThemeVariables.tsx',
  'src/shared/styles/theme.ts',
];
const SERVER_DOCS = [
  'CLAUDE.md',
  'docs/README.md',
  'docs/apis/README.md',
  'docs/apis/conventions.md',
  'docs/apis/hello.md',
  'docs/database.md',
  ...RULES_SERVER,
];
/** Required paths per server framework. */
export const REQUIRED_SERVER = {
  nest: [
    ...SERVER_DOCS,
    'src/main.ts',
    'src/bootstrap.ts',
    'src/app.module.ts',
    'src/config',
    'src/common/errors',
    'src/common/http',
    'src/common/logging',
    'src/modules',
  ],
  fastify: [
    ...SERVER_DOCS,
    'src/main.ts',
    'src/server.ts',
    'src/config.ts',
    'src/common',
  ],
  fastapi: [...SERVER_DOCS, 'src/main.py', 'src/core'],
};
/** Required paths of the workspace template (and of a composed root with contract/). */
export const REQUIRED_WORKSPACE = [
  'pnpm-workspace.yaml',
  'contract/package.json',
  'CLAUDE.md',
  'docs/README.md',
  'docs/contract.md',
];
/** Required paths of every standalone target (not of parts inside a monorepo). */
export const REQUIRED_STANDALONE = ['AGENTS.md', '.gitignore'];
/** Required paths of a composed monorepo root. */
export const REQUIRED_MONOREPO_ROOT = ['AGENTS.md', 'CLAUDE.md', '.gitignore', 'docs/README.md'];
/** The parts of a monorepo that hold a template; `dashboard` is optional. */
const MONOREPO_PARTS = ['web', 'dashboard', 'server'];

/**
 * Walk a directory and return files whose names satisfy a predicate.
 *
 * @param {string} dir Directory to walk (may not exist).
 * @param {(name: string) => boolean} match Filename predicate.
 * @returns {string[]} Absolute paths, sorted.
 */
function walk(dir, match) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out.sort();
}

/**
 * Read a JSON file, or null when absent or invalid.
 *
 * @param {string} file Absolute path.
 * @returns {Record<string, any> | null} Parsed object.
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Find the dependency names of a package.json.
 *
 * @param {string} dir Directory holding package.json.
 * @returns {Set<string>} Dependency names of every kind.
 */
function deps(dir) {
  const pkg = readJson(path.join(dir, 'package.json')) ?? {};
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
}

/**
 * Detect what kind of target a directory is.
 *
 * @param {string} dir Target directory.
 * @returns {'monorepo' | 'workspace' | 'fastapi' | 'nest' | 'fastify' | 'web' | null} Type.
 */
export function detectType(dir) {
  const has = (p) => fs.existsSync(path.join(dir, p));
  if (has('web') && has('server')) return 'monorepo';
  if (has('pnpm-workspace.yaml') && has('contract/package.json')) return 'workspace';
  if (has('pyproject.toml')) return 'fastapi';
  const d = deps(dir);
  if (d.has('@nestjs/core')) return 'nest';
  if (d.has('fastify')) return 'fastify';
  if (d.has('next') || d.has('vite')) return 'web';
  return null;
}

/**
 * Check whether a .gitignore ignores `.env` (last matching line wins).
 *
 * @param {string} file Path of the .gitignore.
 * @returns {boolean} True when `.env` is ignored.
 */
export function gitignoreCoversEnv(file) {
  if (!fs.existsSync(file)) return false;
  let ignored = false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    line = line.replace(/^\//, '').replace(/^\*\*\//, '');
    if (line.endsWith('/')) continue;
    const regex = new RegExp(
      `^${line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`,
    );
    if (regex.test('.env')) ignored = !negate;
  }
  return ignored;
}

/**
 * Remove fenced code blocks and inline code from markdown text.
 *
 * @param {string} text Markdown source.
 * @returns {string} Text without code.
 */
function stripCode(text) {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
}

/**
 * Collect the relative link targets of a markdown file.
 *
 * @param {string} text Markdown source.
 * @returns {string[]} Link targets without fragment or query.
 */
function linkTargets(text) {
  const plain = stripCode(text);
  const raw = [];
  for (const m of plain.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    raw.push(m[1]);
  }
  for (const m of plain.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) {
    raw.push(m[1]);
  }
  return raw
    .filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('#') && !t.startsWith('/'))
    .map((t) => t.split('#')[0].split('?')[0])
    .filter(Boolean)
    .map((t) => {
      try {
        return decodeURI(t);
      } catch {
        return t;
      }
    });
}

/**
 * Check the markdown files of a directory for broken relative links.
 *
 * @param {string} dir Directory to scan.
 * @param {string} label Prefix for violation messages.
 * @returns {string[]} Violations.
 */
function checkLinks(dir, label) {
  const out = [];
  for (const file of walk(dir, (n) => n.endsWith('.md'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const target of linkTargets(text)) {
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
        out.push(`${label}${path.relative(dir, file)}: broken link: ${target}`);
      }
    }
  }
  return out;
}

/**
 * Check CJK rules for AGENTS.md and the docs/ tree.
 *
 * @param {string} dir Directory holding AGENTS.md and docs/.
 * @param {string} label Prefix for violation messages.
 * @returns {string[]} Violations.
 */
function checkLanguage(dir, label) {
  const out = [];
  const agents = path.join(dir, 'AGENTS.md');
  if (fs.existsSync(agents) && CJK_ANY.test(fs.readFileSync(agents, 'utf8'))) {
    out.push(`${label}AGENTS.md: contains CJK characters (must be English)`);
  }
  const docs = path.join(dir, 'docs');
  const rules = path.join(docs, 'rules');
  for (const file of walk(docs, (n) => n.endsWith('.md'))) {
    const rel = path.relative(dir, file);
    const text = fs.readFileSync(file, 'utf8');
    if (file.startsWith(`${rules}${path.sep}`)) {
      if (CJK_ANY.test(text)) out.push(`${label}${rel}: contains CJK characters (rules must be English)`);
    } else if (!HAN.test(text)) {
      out.push(`${label}${rel}: has no Traditional Chinese (design and record pages must be Chinese)`);
    }
  }
  return out;
}

/**
 * Check that required paths exist.
 *
 * @param {string} dir Directory to check.
 * @param {string[]} required Relative paths that must exist.
 * @param {string} label Prefix for violation messages.
 * @returns {string[]} Violations.
 */
function checkPaths(dir, required, label) {
  const out = [];
  for (const rel of required) {
    if (!fs.existsSync(path.join(dir, rel))) out.push(`${label}${rel}: required path missing`);
  }
  return out;
}

/**
 * Check one part (a standalone template, or a piece of a monorepo).
 *
 * @param {string} dir Part directory.
 * @param {string} type Part type from detectType.
 * @param {string} label Prefix for violation messages.
 * @param {boolean} standalone Whether AGENTS.md and .gitignore are required here.
 * @returns {string[]} Violations.
 */
function checkPart(dir, type, label, standalone) {
  let required = [];
  if (type === 'web') required = REQUIRED_WEB;
  else if (type === 'workspace') required = REQUIRED_WORKSPACE;
  else required = REQUIRED_SERVER[type];
  if (standalone) required = [...REQUIRED_STANDALONE, ...required];

  const out = [
    ...checkPaths(dir, required, label),
    ...checkLanguage(dir, label),
    ...checkLinks(dir, label),
  ];
  if (standalone && !gitignoreCoversEnv(path.join(dir, '.gitignore')) && fs.existsSync(path.join(dir, '.gitignore'))) {
    out.push(`${label}.gitignore: does not cover .env`);
  }
  return out;
}

/**
 * Check a composed monorepo root and each of its parts.
 *
 * @param {string} dir Monorepo root.
 * @returns {string[]} Violations.
 */
function checkMonorepo(dir) {
  const out = [
    ...checkPaths(dir, REQUIRED_MONOREPO_ROOT, ''),
    ...checkLanguage(dir, ''),
  ];
  if (fs.existsSync(path.join(dir, '.gitignore')) && !gitignoreCoversEnv(path.join(dir, '.gitignore'))) {
    out.push('.gitignore: does not cover .env');
  }
  const hasContract = fs.existsSync(path.join(dir, 'contract'));
  if (hasContract) out.push(...checkPaths(dir, ['contract/package.json', 'docs/contract.md'], ''));
  for (const part of MONOREPO_PARTS) {
    const partDir = path.join(dir, part);
    if (part === 'dashboard' && !fs.existsSync(partDir)) continue;
    const type = detectType(partDir);
    const wantsWeb = part !== 'server';
    if (type === null || type === 'monorepo' || type === 'workspace') {
      out.push(`${part}/: cannot detect a web or server template (check package.json dependencies or pyproject.toml)`);
    } else if (wantsWeb !== type.startsWith('web')) {
      out.push(`${part}/: holds a ${type} template, expected ${wantsWeb ? 'a web' : 'a server'} template`);
    } else out.push(...checkPart(partDir, type, `${part}/`, false));
  }
  out.push(
    ...checkLinks(dir, '').filter((v) => !MONOREPO_PARTS.some((part) => v.startsWith(`${part}/`))),
  );
  return out;
}

/**
 * Check one target directory.
 *
 * @param {string} dir Absolute target directory.
 * @returns {string[]} Violations; empty when the target is clean.
 */
export function checkTarget(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [`directory does not exist (template not rendered yet?): ${dir}`];
  }
  if (fs.readdirSync(dir).length === 0) return [`directory is empty: ${dir}`];
  const type = detectType(dir);
  if (type === null) {
    return ['cannot detect the template type (no next/vite/nest/fastify dependency, pyproject.toml or workspace layout)'];
  }
  if (type === 'monorepo') return checkMonorepo(dir);
  return checkPart(dir, type, '', true);
}

/**
 * Resolve a CLI argument to a directory.
 *
 * @param {string} arg Template name or directory path.
 * @returns {string} Absolute directory.
 */
export function resolveTarget(arg) {
  if (arg.includes('/') || (fs.existsSync(arg) && fs.statSync(arg).isDirectory())) {
    return path.resolve(arg);
  }
  return path.join(REPO, 'templates', arg);
}

/**
 * Entry point.
 *
 * @param {string[]} args CLI arguments.
 * @returns {number} Exit code.
 */
function main(args) {
  if (args.length === 0) {
    console.error('usage: check-docs.mjs <template-name|directory>...');
    return 2;
  }
  let failed = false;
  for (const arg of args) {
    const dir = resolveTarget(arg);
    const violations = checkTarget(dir);
    if (violations.length === 0) console.log(`ok ${arg}`);
    else {
      failed = true;
      console.error(`FAIL ${arg}`);
      for (const v of violations) console.error(`  ${v}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
