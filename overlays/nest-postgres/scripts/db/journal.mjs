/**
 * The migration journal and the rule for what is pending, shared by every SQL
 * store. Drizzle owns both halves of the bookkeeping: `drizzle/meta/_journal.json`
 * lists the migrations that exist and the store's own table records what ran.
 * Nothing here writes either; the scripts only read them and report.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder `drizzle-kit generate` writes into, next to `scripts/`. */
export const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

/**
 * @typedef {object} JournalEntry
 * @property {number} idx Position in the journal.
 * @property {string} tag The migration's name, which is its file name without `.sql`.
 * @property {number} when The millisecond stamp assigned when it was generated. It is
 *   what lands in `created_at` of the record, and the only field the migrator compares.
 */

/**
 * Reads the journal in the order the migrations were generated.
 *
 * A folder with no journal means no migrations, so a project that has not
 * generated one yet still migrates, as a no-op.
 *
 * @param {string} [folder] The migrations folder.
 * @returns {Promise<JournalEntry[]>} The entries, oldest first.
 * @throws {Error} When the journal exists but is not valid JSON with an `entries` array.
 */
export async function readJournal(folder = MIGRATIONS_FOLDER) {
  let text;
  try {
    text = await readFile(resolve(folder, 'meta', '_journal.json'), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  const journal = JSON.parse(text);
  if (!journal || !Array.isArray(journal.entries)) {
    throw new Error('drizzle/meta/_journal.json has no entries array');
  }
  return [...journal.entries].sort((left, right) => left.when - right.when);
}

/**
 * The newest stamp the database has recorded.
 *
 * @param {number[] | null} applied The `created_at` stamps of the record, or null when
 *   the record does not exist yet.
 * @returns {number | null} The newest stamp, or null when nothing was ever applied.
 */
export function newestStamp(applied) {
  if (!applied || applied.length === 0) return null;
  return Math.max(...applied);
}

/**
 * The entries the migrator will apply: those newer than the newest recorded stamp.
 * This is the migrator's own rule, so `db:status` shows what `db:migrate` really does.
 *
 * @param {JournalEntry[]} journal The journal, oldest first.
 * @param {number[] | null} applied The recorded stamps, or null when there is no record.
 * @returns {JournalEntry[]} The pending entries.
 */
export function findPending(journal, applied) {
  const newest = newestStamp(applied);
  return newest === null
    ? journal
    : journal.filter((entry) => entry.when > newest);
}

/**
 * The entries the migrator will never apply: older than the newest recorded stamp
 * and absent from the record. This is a migration generated on a branch and merged
 * after a newer one had already run; the migrator skips it with no error.
 *
 * @param {JournalEntry[]} journal The journal, oldest first.
 * @param {number[] | null} applied The recorded stamps, or null when there is no record.
 * @returns {JournalEntry[]} The skipped entries.
 */
export function findSkipped(journal, applied) {
  const newest = newestStamp(applied);
  if (newest === null) return [];
  const recorded = new Set(applied);
  return journal.filter(
    (entry) => entry.when <= newest && !recorded.has(entry.when),
  );
}

/**
 * Whether the database ran a migration this checkout does not carry, which is an
 * older release deployed over a newer one. The migrator then applies nothing, silently.
 *
 * @param {JournalEntry[]} journal The journal, oldest first.
 * @param {number[] | null} applied The recorded stamps, or null when there is no record.
 * @returns {boolean} True when a recorded stamp is newer than every journal entry.
 */
export function isAheadOfDisk(journal, applied) {
  const newest = newestStamp(applied);
  if (newest === null) return false;
  return newest > (journal.at(-1)?.when ?? 0);
}
