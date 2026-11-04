import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';

import * as schema from './schema/index.js';
import type { DatabasePort, TransactionRunner } from './types.js';

/**
 * The settings of the database, spread into the environment schema by
 * `src/infra/infra-env.ts`. Required: a missing or malformed value stops the
 * boot naming the variable, and the message never carries the value.
 */
export const databaseEnv = {
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL'),
};

/** What `createDatabase` reads of the validated environment. */
export type DatabaseConfig = { DATABASE_URL: string };

/** The query client. */
export type Database = NodePgDatabase<typeof schema>;

/** The handle a transaction callback receives. */
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/** Anything a repository can run a statement against: the client or a transaction handle. */
export type DatabaseExecutor = Database | DatabaseTransaction;

/** How long a connection attempt may take, in milliseconds. */
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Creates the PostgreSQL client, its transaction runner, a probe and a close.
 *
 * The pool connects on first use, so creating it touches nothing; the startup
 * check of `src/infra/` is what proves the server is reachable. It does not read
 * the environment and assumes nothing about where the server is. A pooled
 * connection that fails while idle (the server restarted) is dropped by the pool,
 * so the error event is handled here and the process stays up.
 *
 * @param config - The validated settings.
 * @returns The database port.
 */
export function createDatabase(
  config: DatabaseConfig,
): DatabasePort<Database, DatabaseTransaction> {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (error: Error & { code?: string }) => {
    console.error(
      `postgres: an idle connection failed${error.code ? ` (${error.code})` : ''}`,
    );
  });
  const db = drizzle({ client: pool, schema });
  const transactions: TransactionRunner<DatabaseTransaction> = {
    run: (work) => db.transaction(work),
  };
  let closed = false;
  return {
    name: 'postgres',
    db,
    transactions,
    probe: async () => {
      await pool.query('select 1');
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
