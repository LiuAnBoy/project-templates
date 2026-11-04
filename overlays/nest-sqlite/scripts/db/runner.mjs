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

/** How far down a chain of causes to look. */
const MAX_DEPTH = 6;

/** Network errnos and the codes of an unreachable or unopenable database. */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_INVALID_URL',
  'SQLITE_CANTOPEN',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
]);

/** Fixed messages of `pg` for a connection that ended or timed out; they carry no code. */
const CONNECTION_MESSAGES =
  /^(Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error)/;

/**
 * Flattens an error and everything under it, following `cause` and the entries
 * of an `AggregateError`.
 *
 * @param {unknown} error Whatever was thrown.
 * @param {number} [depth] Internal.
 * @returns {object[]} The error and its causes, outermost first; only objects.
 */
function flatten(error, depth = 0) {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH)
    return [];
  const under = [
    error.cause,
    ...(Array.isArray(error.errors) ? error.errors : []),
  ];
  return [error, ...under.flatMap((link) => flatten(link, depth + 1))];
}

/**
 * Whether a link says the database could not be reached or opened, or that a
 * path could not be used. Their messages carry the host, the user or the path.
 *
 * @param {{code?: unknown, message?: unknown, syscall?: unknown}} link One error in the chain.
 * @returns {boolean} True when the link names a connection or file-system failure.
 */
function isConnectionLink(link) {
  const code = typeof link.code === 'string' ? link.code : '';
  return (
    CONNECTION_CODES.has(code) ||
    code.startsWith('08') ||
    code.startsWith('28') ||
    code.startsWith('57P0') ||
    typeof link.syscall === 'string' ||
    (typeof link.message === 'string' && CONNECTION_MESSAGES.test(link.message))
  );
}

/**
 * Turns a failure of a migration script into what is safe to print.
 *
 * A failure to reach the database prints fixed text and the code found on the
 * chain, never the driver's message, which carries the host, the user or the
 * path. Any other failure prints its statement, when it has one, and the
 * message of every link under it, so the root cause is never lost, and an
 * `AggregateError` with an empty message never prints an empty line. Bound
 * values (`params`) are never printed.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string} One or more lines, never empty.
 */
export function describeMigrateFailure(error) {
  const links = flatten(error);
  if (links.length === 0) return `Migration failed: ${typeof error}`;
  if (links.some(isConnectionLink)) {
    const codes = [
      ...new Set(
        links
          .map((link) => link.code)
          .filter((code) => typeof code === 'string'),
      ),
    ];
    return `Cannot reach or open the database${codes.length > 0 ? ` (${codes.join(', ')})` : ''}. Check DATABASE_URL and that the server is running.`;
  }
  const lines = [];
  for (const link of links) {
    const text =
      typeof link.query === 'string' && Array.isArray(link.params)
        ? `Failed query: ${link.query}`
        : typeof link.message === 'string'
          ? link.message.trim()
          : '';
    if (text !== '' && !lines.includes(text)) lines.push(text);
  }
  if (lines.length === 0)
    return `Migration failed: ${links[0].constructor?.name ?? 'Error'}`;
  return lines
    .map((line, index) => (index === 0 ? line : `  caused by: ${line}`))
    .join('\n');
}

/**
 * Runs a script's task and turns a failure into a message on stderr and exit code 1.
 * The message comes from `describeMigrateFailure`, so it never holds a connection value.
 *
 * @param {Promise<void>} task The task.
 * @returns {Promise<void>} Resolves either way; the exit code carries the failure.
 */
export async function exitOnError(task) {
  try {
    await task;
  } catch (error) {
    process.stderr.write(`${describeMigrateFailure(error)}\n`);
    process.exitCode = 1;
  }
}
