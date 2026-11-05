import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';

import { bounded } from '../common/concurrency/bounded.js';
import { CHECK_TIMEOUT_MS } from '../common/dependency-checks.js';
import { createNestingGuard } from './nesting-guard.js';
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
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL')
    .refine(isUsableUrl, 'must be a valid postgresql:// URL'),
};

/**
 * Whether the driver can read a URL. Building a client parses the URL and never
 * connects, and a parser's error quotes what it read, so it stays inside this check.
 *
 * @param url - The raw setting.
 * @returns True when a client can be built from it.
 */
function isUsableUrl(url: string): boolean {
  try {
    new pg.Client({ connectionString: url });
    return true;
  } catch {
    return false;
  }
}

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

/** Settings that tests and unusual deployments may change. */
export type DatabaseOptions = {
  /** How long a connection attempt may take, in milliseconds. */
  connectTimeoutMs?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** How long `close` waits for connections still in use, in milliseconds. */
const CLOSE_WAIT_MS = 1000;

/**
 * Creates the PostgreSQL client, its transaction runner, a probe and a close.
 *
 * The pool connects on first use, so creating it touches nothing; the startup
 * check of `src/infra/` is what proves the server is reachable. It does not read
 * the environment and assumes nothing about where the server is.
 *
 * Every connection gets its `error` listener when it opens, because a connection
 * that fails with no listener ends the process, and the pool listens only while a
 * connection is idle or runs its own `query`: a connection checked out for a
 * transaction is on its own. A lost one fails its query, the failure answers 503 and
 * the pool drops the connection on release.
 *
 * A nested `transactions.run` is refused at once (`createNestingGuard`), because the
 * inner call would take a second connection and wait for locks the outer one holds, or
 * exhaust the pool when several requests nest at the same time: pass the transaction
 * handle down instead.
 *
 * The probe's query has a deadline of its own, because `bounded()` only ends the
 * caller's wait: on a server that went silent, a query with no deadline keeps its
 * connection until the socket dies, and the probes of the health route would use up
 * the pool. Its timeout makes the pool drop the connection. An application query has
 * no such deadline (`docs/rules/data.md`). `close` waits a moment for connections in
 * use and then gives up, so a silent server cannot stop the process from ending.
 *
 * @param config - The validated settings.
 * @param options - Timeouts, for tests.
 * @returns The database port.
 */
export function createDatabase(
  config: DatabaseConfig,
  options: DatabaseOptions = {},
): DatabasePort<Database, DatabaseTransaction> {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis:
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
  });
  pool.on('connect', (client) => {
    client.on('error', (error: Error & { code?: string }) => {
      console.error(
        `postgres: a connection failed${error.code ? ` (${error.code})` : ''}`,
      );
    });
  });
  pool.on('error', () => {
    // The listener above has said it; the pool emits this for an idle connection
    // and drops it, and an emitter with no listener would end the process.
  });
  const db = drizzle({ client: pool, schema });
  const guard = createNestingGuard('postgres', 'transaction handle');
  const transactions: TransactionRunner<DatabaseTransaction> = {
    run: (work) => guard.enter(() => db.transaction(work)),
  };
  let closed = false;
  return {
    name: 'postgres',
    db,
    transactions,
    probe: async () => {
      await pool.query({
        text: 'select 1',
        query_timeout: CHECK_TIMEOUT_MS,
      } as pg.QueryConfig);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await bounded(pool.end(), CLOSE_WAIT_MS, 'postgres').catch(() => {
        // Connections still in use on a silent server end with the process.
      });
    },
  };
}
