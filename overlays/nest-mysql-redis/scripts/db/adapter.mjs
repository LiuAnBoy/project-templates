/**
 * MySQL's side of the migration scripts: the connection and the lookup of
 * Drizzle's record table, `__drizzle_migrations`, which sits in the database the
 * URL names. The table is found through `information_schema.TABLES`.
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createPool } from 'mysql2/promise';

import { asksForIgnoredTls, INVALID_DATABASE_URL } from './database-url.mjs';

const MIGRATIONS_TABLE = '__drizzle_migrations';

/** How long `close` waits for the pool before it gives up and lets the real error print. */
const CLOSE_WAIT_MS = 2000;

/** How long a connection attempt may take. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Opens the database named by `DATABASE_URL`.
 *
 * @returns {Promise<import('./runner.mjs').Store>} The store.
 * @throws {Error} When `DATABASE_URL` is not set, or asks for TLS with a key the driver ignores.
 */
export async function openStore() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required: copy .env.example to .env first.',
    );
  }
  if (asksForIgnoredTls(url)) throw new Error(INVALID_DATABASE_URL);
  // One connection, so the migrator's transaction and its statements share it.
  const pool = createPool({
    uri: url,
    connectionLimit: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  const db = drizzle(pool, { mode: 'default' });
  return {
    table: MIGRATIONS_TABLE,
    async listApplied() {
      const [found] = await pool.query(
        'select count(*) as present from information_schema.TABLES where TABLE_SCHEMA = database() and TABLE_NAME = ?',
        [MIGRATIONS_TABLE],
      );
      if (Number(found[0]?.present) === 0) return null;
      const [stamps] = await pool.query(
        `select created_at from \`${MIGRATIONS_TABLE}\``,
      );
      return stamps.map((row) => Number(row.created_at));
    },
    async migrate(folder) {
      await migrate(db, { migrationsFolder: folder });
    },
    async close() {
      // A pool that cannot finish ending must not hide the failure that caused
      // it, so the wait is bounded.
      let timer;
      await Promise.race([
        pool.end(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, CLOSE_WAIT_MS);
        }),
      ]).catch(() => undefined);
      clearTimeout(timer);
    },
  };
}
