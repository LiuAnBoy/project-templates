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

import { INVALID_DATABASE_PATH, isDatabasePath } from './database-path.mjs';

const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Opens the database file named by `DATABASE_URL`, under the rule the server applies.
 *
 * @param {{forMigrate: boolean}} options `forMigrate` creates the file (and its folder) when missing.
 * @returns {Promise<import('./runner.mjs').Store>} The store.
 * @throws {Error} When `DATABASE_URL` is not set, or is not the path of a file.
 */
export async function openStore({ forMigrate }) {
  const path = process.env.DATABASE_URL;
  if (!path) {
    throw new Error(
      'DATABASE_URL is required: copy .env.example to .env first.',
    );
  }
  if (!isDatabasePath(path)) throw new Error(INVALID_DATABASE_PATH);
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
    // Foreign keys stay off while migrating. Drizzle runs a migration inside a
    // transaction, where the `PRAGMA foreign_keys=OFF` of a generated table
    // rebuild is a no-op, so with enforcement on, `DROP TABLE` of a parent
    // silently deletes the child rows that `ON DELETE CASCADE` points at.
    // `verify` takes the place of the enforcement: `foreign_key_check` runs after
    // every migration and also when nothing is pending.
    connection.pragma('foreign_keys = OFF');
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
    async verify() {
      const violations = connection.pragma('foreign_key_check');
      if (violations.length > 0) {
        const tables = [...new Set(violations.map((row) => row.table))];
        throw new Error(
          `The database holds rows that break a foreign key (${violations.length} in ${tables.join(', ')}). A migration that is already applied cannot be undone: fix the data, or add a migration that does.`,
        );
      }
    },
    async close() {
      connection.close();
    },
  };
}
