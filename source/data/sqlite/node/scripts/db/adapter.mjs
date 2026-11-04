/**
 * SQLite's side of the migration scripts: the connection and the lookup of
 * Drizzle's record table, `__drizzle_migrations`. Only `db:migrate` creates the
 * database file; `db:status` reads, and a missing file means nothing is applied.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Opens the database file named by `DATABASE_URL`.
 *
 * @param {{forMigrate: boolean}} options `forMigrate` creates the file (and its folder) when missing.
 * @returns {Promise<import('./runner.mjs').Store>} The store.
 * @throws {Error} When `DATABASE_URL` is not set.
 */
export async function openStore({ forMigrate }) {
  const path = process.env.DATABASE_URL;
  if (!path) {
    throw new Error(
      'DATABASE_URL is required: copy .env.example to .env first.',
    );
  }
  if (!forMigrate && !existsSync(path)) {
    return {
      table: MIGRATIONS_TABLE,
      listApplied: async () => null,
      migrate: async () => {
        throw new Error('status never migrates');
      },
      close: async () => undefined,
    };
  }
  if (forMigrate) mkdirSync(dirname(path), { recursive: true });
  const connection = forMigrate
    ? new BetterSqlite3(path)
    : new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  connection.pragma('busy_timeout = 5000');
  if (forMigrate) {
    connection.pragma('foreign_keys = ON');
    connection.pragma('journal_mode = WAL');
  }
  return {
    table: MIGRATIONS_TABLE,
    async listApplied() {
      const present = connection
        .prepare(
          "select 1 from sqlite_master where type = 'table' and name = ?",
        )
        .get(MIGRATIONS_TABLE);
      if (!present) return null;
      return connection
        .prepare(`select created_at from "${MIGRATIONS_TABLE}"`)
        .all()
        .map((row) => Number(row.created_at));
    },
    async migrate(folder) {
      migrate(drizzle({ client: connection }), { migrationsFolder: folder });
    },
    async close() {
      connection.close();
    },
  };
}
