/**
 * The reporting around Drizzle's migrator, shared by every SQL store. A store's
 * `adapter.mjs` supplies the connection and the lookup of its own record table;
 * everything printed here is names and counts, never a connection value.
 */
import {
  MIGRATIONS_FOLDER,
  findPending,
  findSkipped,
  isAheadOfDisk,
  readJournal,
} from './journal.mjs';

/**
 * @typedef {object} Store
 * @property {string} table The qualified name of the record table, for the report.
 * @property {() => Promise<number[] | null>} listApplied The `created_at` stamps of the record,
 *   or null when the table (or the SQLite file) does not exist. Never writes.
 * @property {(folder: string) => Promise<void>} migrate Runs Drizzle's migrator over the folder.
 * @property {() => Promise<void>} close Releases the connection.
 */

/**
 * @typedef {object} RunOptions
 * @property {string} [folder] The migrations folder; defaults to `drizzle/`.
 * @property {{write: (text: string) => unknown}} [out] Where the report goes; defaults to stdout.
 */

/**
 * Writes a list of migration tags under a heading.
 *
 * @param {{write: (text: string) => unknown}} out Where to write.
 * @param {string} heading The heading line.
 * @param {{tag: string}[]} entries The entries to list.
 * @returns {void}
 */
function report(out, heading, entries) {
  out.write(`${heading}\n`);
  for (const entry of entries) out.write(`  - ${entry.tag}\n`);
}

/**
 * Names the migrations the migrator would silently skip, and fails.
 *
 * @param {{write: (text: string) => unknown}} out Where to write.
 * @param {{tag: string}[]} skipped The skipped entries.
 * @returns {never}
 * @throws {Error} Always.
 */
function failSkipped(out, skipped) {
  report(
    out,
    'Skipped by the migrator (older than the newest applied migration, never recorded):',
    skipped,
  );
  throw new Error(
    'A migration was merged after a newer one had already run. Regenerate it on top of the latest trunk.',
  );
}

/**
 * Applies every migration the database has not recorded, and reports it.
 *
 * Prints the counts, the names before applying and the record after, warns when
 * the database holds a migration this checkout lacks, and fails when a journal
 * entry would be skipped silently or the migrator leaves work behind.
 *
 * @param {(options: {forMigrate: boolean}) => Promise<Store>} openStore Opens the store.
 * @param {RunOptions} [options] Folder and output.
 * @returns {Promise<void>} Resolves when the database is up to date.
 * @throws {Error} On a skipped entry, a migrator that left work behind, or any failure of the store.
 */
export async function runMigrate(openStore, options = {}) {
  const folder = options.folder ?? MIGRATIONS_FOLDER;
  const out = options.out ?? process.stdout;
  const journal = await readJournal(folder);
  const store = await openStore({ forMigrate: true });
  try {
    const applied = await store.listApplied();
    const pending = findPending(journal, applied);
    const skipped = findSkipped(journal, applied);
    out.write(
      `Migrations on disk: ${journal.length}, already applied: ${journal.length - pending.length - skipped.length}\n`,
    );
    if (skipped.length > 0) failSkipped(out, skipped);
    if (isAheadOfDisk(journal, applied)) {
      out.write(
        'Warning: the database recorded a migration this checkout does not contain. An older release is being deployed over a newer one.\n',
      );
    }
    if (pending.length === 0) {
      out.write('No pending migrations.\n');
      return;
    }
    report(out, `Applying ${pending.length} pending migration(s):`, pending);
    await store.migrate(folder);
    const left = findPending(journal, await store.listApplied());
    if (left.length > 0) {
      report(out, 'Migrations remained unapplied:', left);
      throw new Error('The migrator reported success but left work behind.');
    }
    report(out, `Recorded in ${store.table}:`, pending);
  } finally {
    await store.close();
  }
}

/**
 * Lists the migrations that are still pending. It never writes, and a missing
 * record, or a missing SQLite file, means nothing is applied.
 *
 * @param {(options: {forMigrate: boolean}) => Promise<Store>} openStore Opens the store.
 * @param {RunOptions} [options] Folder and output.
 * @returns {Promise<void>} Resolves after the report.
 * @throws {Error} On a skipped entry, or any failure of the store.
 */
export async function runStatus(openStore, options = {}) {
  const folder = options.folder ?? MIGRATIONS_FOLDER;
  const out = options.out ?? process.stdout;
  const journal = await readJournal(folder);
  const store = await openStore({ forMigrate: false });
  try {
    const applied = await store.listApplied();
    const pending = findPending(journal, applied);
    const skipped = findSkipped(journal, applied);
    out.write(
      `Migrations on disk: ${journal.length}, already applied: ${journal.length - pending.length - skipped.length}\n`,
    );
    if (skipped.length > 0) failSkipped(out, skipped);
    if (pending.length === 0) {
      out.write('No pending migrations.\n');
      return;
    }
    report(out, `Pending migrations (${pending.length}):`, pending);
  } finally {
    await store.close();
  }
}

/**
 * Runs a script's task and turns a failure into a message on stderr and exit code 1.
 *
 * @param {Promise<void>} task The task.
 * @returns {Promise<void>} Resolves either way; the exit code carries the failure.
 */
export async function exitOnError(task) {
  try {
    await task;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
