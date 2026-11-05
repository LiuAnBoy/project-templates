/**
 * `pnpm db:pull`: adopts a database that already has tables. It runs
 * `drizzle-kit pull` against `DATABASE_URL`, then makes the result usable:
 *
 * - The baseline migration that Drizzle Kit writes holds the introspected
 *   `CREATE TABLE` statements inside one block comment. `db:migrate` cuts a
 *   migration at each `--> statement-breakpoint`, which splits that comment, and the
 *   server rejects the pieces, so the baseline is replaced by a statement that
 *   changes nothing. The tables stay as they are; the schema file and the snapshot
 *   in `drizzle/meta/` describe them.
 * - `drizzle/schema.ts` and `drizzle/relations.ts` move into `src/db/schema/` and are
 *   exported from its entry, because that folder is the one place a table is defined.
 *   Their unused imports are dropped, because the project's lint refuses them, and
 *   they are formatted with the project's Prettier.
 *
 * Only for a project that has no migration yet. Drizzle Kit's own output stays
 * unprinted, because its report of a refused login can name the user and the host.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asksForIgnoredTls, INVALID_DATABASE_URL } from './database-url.mjs';
import { MIGRATIONS_FOLDER, readJournal } from './journal.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_FOLDER = resolve(ROOT, 'src', 'db', 'schema');
const PULL_FAILED =
  'drizzle-kit pull wrote no migration. Check DATABASE_URL, that the server is running and that the database has tables; `pnpm exec drizzle-kit pull` shows its own output, which can name the host and the user.';
const INTROSPECTION_HEADER =
  '-- Current sql file was generated after introspecting the database';
const BASELINE_SQL = `-- Baseline adopted from an existing database by \`pnpm db:pull\`.
-- The tables already exist there, so this migration changes nothing; it records
-- where Drizzle's history starts. Their definitions are in src/db/schema/ and in
-- the snapshot next to this file.
SELECT 1;
`;

/**
 * Runs Drizzle Kit's `pull` with the project's own installation.
 *
 * @returns {void}
 * @throws {Error} When Drizzle Kit is not installed or exits non-zero.
 */
function runPull() {
  const bin = resolve(ROOT, 'node_modules', '.bin', 'drizzle-kit');
  if (!existsSync(bin)) {
    throw new Error('drizzle-kit is not installed: run pnpm install first.');
  }
  const result = spawnSync(bin, ['pull'], { cwd: ROOT, stdio: 'pipe' });
  if (result.status !== 0) throw new Error(PULL_FAILED);
}

/**
 * Drops the names a one-line `import { ... } from '...'` brings in and the file never uses.
 *
 * @param {string} text The generated file.
 * @returns {string} The file with those names, and imports left empty, removed.
 */
function dropUnusedImports(text) {
  const lines = text.split('\n');
  const body = lines.filter((line) => !line.startsWith('import ')).join('\n');
  return lines
    .map((line) => {
      const match = /^import \{([^}]*)\} from (.*)$/.exec(line);
      if (!match) return line;
      const used = match[1]
        .split(',')
        .map((name) => name.trim())
        .filter(
          (name) => name !== '' && new RegExp(`\\b${name}\\b`).test(body),
        );
      return used.length > 0
        ? `import { ${used.join(', ')} } from ${match[2]}`
        : null;
    })
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Names the foreign keys whose name Drizzle would not generate. The pulled schema
 * declares a key inline with `.references()`, which carries no name, so the next
 * `db:generate` would drop and re-add each such key under the generated name.
 *
 * @param {number} idx The position of the baseline in the journal.
 * @returns {Promise<string[]>} `table.key` for each key to declare by hand.
 */
async function foreignKeysToName(idx) {
  const file = resolve(
    MIGRATIONS_FOLDER,
    'meta',
    `${String(idx).padStart(4, '0')}_snapshot.json`,
  );
  if (!existsSync(file)) return [];
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  const found = [];
  for (const [table, definition] of Object.entries(snapshot.tables ?? {})) {
    for (const key of Object.values(definition.foreignKeys ?? {})) {
      const generated = `${key.tableFrom}_${key.columnsFrom.join('_')}_${key.tableTo}_${key.columnsTo.join('_')}_fk`;
      if (key.name !== generated) found.push(`${table}.${key.name}`);
    }
  }
  return found;
}

/**
 * Formats the schema folder with the project's Prettier, when it is installed.
 *
 * @returns {void}
 */
function formatSchemaFolder() {
  const bin = resolve(ROOT, 'node_modules', '.bin', 'prettier');
  if (existsSync(bin)) {
    spawnSync(bin, ['--write', SCHEMA_FOLDER], { cwd: ROOT, stdio: 'ignore' });
  }
}

/**
 * Moves one file Drizzle Kit wrote into the schema folder, when it wrote it.
 *
 * @param {string} from The file name inside `drizzle/`.
 * @param {string} to The file name inside `src/db/schema/`.
 * @param {(text: string) => string} [rewrite] Fixes the text on the way.
 * @returns {Promise<boolean>} Whether a file was written.
 */
async function moveIntoSchema(from, to, rewrite = (text) => text) {
  const source = resolve(MIGRATIONS_FOLDER, from);
  if (!existsSync(source)) return false;
  const text = rewrite(await readFile(source, 'utf8'));
  await rm(source);
  // A file that exports nothing (a relations file of tables with no foreign keys) has no use.
  if (!/\bexport\b/.test(text)) return false;
  await writeFile(resolve(SCHEMA_FOLDER, to), text);
  return true;
}

/**
 * Pulls the database and tidies what Drizzle Kit wrote.
 *
 * @returns {Promise<void>} Resolves when the project holds the adopted schema.
 * @throws {Error} When the setting asks for TLS the driver ignores, a migration already exists, or the pull fails.
 */
async function main() {
  if (asksForIgnoredTls(process.env.DATABASE_URL ?? '')) {
    throw new Error(INVALID_DATABASE_URL);
  }
  if ((await readJournal()).length > 0) {
    throw new Error(
      'drizzle/ already holds a migration: db:pull adopts a database once, at the start of a project.',
    );
  }
  runPull();
  // Drizzle Kit exits 0 when it cannot connect, so what it wrote is the only proof.
  const entries = await readJournal();
  if (entries.length === 0) {
    // An empty database can leave a schema file with no migration, which lint refuses.
    for (const name of ['schema.ts', 'relations.ts']) {
      await rm(resolve(MIGRATIONS_FOLDER, name), { force: true });
    }
    throw new Error(PULL_FAILED);
  }
  for (const entry of entries) {
    const file = resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`);
    const text = await readFile(file, 'utf8');
    if (text.startsWith(INTROSPECTION_HEADER)) {
      await writeFile(file, BASELINE_SQL);
    }
  }
  const tables = await moveIntoSchema(
    'schema.ts',
    'introspected.ts',
    dropUnusedImports,
  );
  const relations = await moveIntoSchema(
    'relations.ts',
    'introspected-relations.ts',
    (text) =>
      text.replace(/from\s+["']\.\/schema["']/g, "from './introspected.js'"),
  );
  const exports = [
    ...(tables ? ["export * from './introspected.js';"] : []),
    ...(relations ? ["export * from './introspected-relations.js';"] : []),
  ];
  if (exports.length > 0) {
    const entry = resolve(SCHEMA_FOLDER, 'index.ts');
    const current = await readFile(entry, 'utf8');
    await writeFile(entry, `${current.trimEnd()}\n${exports.join('\n')}\n`);
  }
  formatSchemaFolder();
  const named = await foreignKeysToName(entries[0]?.idx ?? 0);
  if (named.length > 0) {
    process.stdout.write(
      `Declare these foreign keys with foreignKey({ name }) in the schema, or db:generate drops and re-adds them under another name: ${named.join(', ')}\n`,
    );
  }
  process.stdout.write(
    'Adopted the database. Next: run pnpm db:generate: it must say "No schema changes" before you add anything. See docs/rules/mysql.md.\n',
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'db:pull failed.'}\n`,
  );
  process.exitCode = 1;
}
