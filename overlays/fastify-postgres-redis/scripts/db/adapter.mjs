/**
 * PostgreSQL's side of the migration scripts: the connection and the lookup of
 * Drizzle's record table, `drizzle.__drizzle_migrations`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
const QUALIFIED_TABLE = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;

/**
 * Opens the database named by `DATABASE_URL`.
 *
 * @returns {Promise<import('./runner.mjs').Store>} The store.
 * @throws {Error} When `DATABASE_URL` is not set.
 */
export async function openStore() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required: copy .env.example to .env first.',
    );
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzle({ client: pool });
  return {
    table: QUALIFIED_TABLE,
    async listApplied() {
      const exists = await pool.query(
        'select to_regclass($1) is not null as present',
        [QUALIFIED_TABLE],
      );
      if (!exists.rows[0]?.present) return null;
      const stamps = await pool.query(
        `select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
      );
      return stamps.rows.map((row) => Number(row.created_at));
    },
    async migrate(folder) {
      await migrate(db, {
        migrationsFolder: folder,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
    },
    async close() {
      await pool.end();
    },
  };
}
