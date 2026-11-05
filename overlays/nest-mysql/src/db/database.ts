import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import {
  createPool,
  type Pool,
  type PoolConnection,
  type PoolOptions,
} from 'mysql2/promise';
import { z } from 'zod';

import { asksForIgnoredTls } from '../../scripts/db/database-url.mjs';
import { bounded } from '../common/concurrency/bounded.js';
import { CHECK_TIMEOUT_MS } from '../common/dependency-checks.js';
import { FixedTextError } from '../common/errors/fixed-text-error.js';
import { createNestingGuard } from './nesting-guard.js';
import * as schema from './schema/index.js';
import { createTransactionEnd } from './transaction-end.js';
import type { DatabasePort, TransactionRunner } from './types.js';

/**
 * The settings of the database, spread into the environment schema by
 * `src/infra/infra-env.ts`. Required: a missing or malformed value stops the
 * boot naming the variable, and the message never carries the value.
 */
export const databaseEnv = {
  DATABASE_URL: z
    .string()
    .regex(/^mysql:\/\//, 'must be a mysql:// URL')
    .refine(isUsableUrl, 'must be a valid mysql:// URL'),
};

/**
 * Whether the driver can read a URL, and whether it asks for TLS in a way the
 * driver understands. Building a pool parses the URL and never connects, and a
 * parser's error quotes what it read, so it stays inside this check. `sslmode` is
 * refused: `mysql2` ignores it and connects in plain text (`docs/rules/mysql.md`).
 *
 * @param url - The raw setting.
 * @returns True when a pool can be built from it and it sets no `sslmode`.
 */
function isUsableUrl(url: string): boolean {
  try {
    if (asksForIgnoredTls(url)) return false;
    void createPool({ uri: url }).end();
    return true;
  } catch {
    return false;
  }
}

/** What `createDatabase` reads of the validated environment. */
export type DatabaseConfig = { DATABASE_URL: string };

/** The query client. */
export type Database = MySql2Database<typeof schema>;

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
  /** How long a call waits for a free connection of a busy pool, in milliseconds. */
  acquireTimeoutMs?: number;
  /** The most connections the pool opens. */
  connectionLimit?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** `mysql2` has no acquire timeout, so a busy pool is bounded here. */
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5000;

/** How long `close` waits for connections still in use, in milliseconds. */
const CLOSE_WAIT_MS = 1000;

/** The session setting every connection starts with, so `CURRENT_TIMESTAMP(3)` is UTC. */
const SESSION_TIME_ZONE = "SET time_zone = '+00:00'";

/** What `mysql2` hands a call that wants a connection: the callback of its core pool. */
type AcquireCallback = Parameters<Pool['pool']['getConnection']>[0];

/**
 * Bounds how long a call waits for a free connection.
 *
 * The core pool of `mysql2` queues a call for ever when every connection is held
 * (`queueLimit` only counts calls). The wrapper answers the waiting call with a
 * fixed error at the deadline and gives a connection that arrives afterwards back
 * unused, so a call that gave up never runs its statement late.
 *
 * @param pool - The pool to bound.
 * @param waitMs - The deadline.
 */
function boundAcquire(pool: Pool, waitMs: number): void {
  const core = pool.pool;
  const original = core.getConnection.bind(core);
  const wrapped = new WeakSet<object>();
  core.getConnection = ((callback: AcquireCallback) => {
    // The pool calls this again for a queued call it now has a connection for.
    if (wrapped.has(callback)) {
      original(callback);
      return;
    }
    let gaveUp = false;
    const timer = setTimeout(() => {
      gaveUp = true;
      callback(
        new FixedTextError(
          'mysql: no connection became free in time',
          'ETIMEDOUT',
        ),
        undefined as never,
      );
    }, waitMs);
    const guarded: AcquireCallback = (error, connection) => {
      clearTimeout(timer);
      if (gaveUp) {
        connection?.release();
        return;
      }
      callback(error, connection);
    };
    wrapped.add(guarded);
    original(guarded);
  }) as typeof core.getConnection;
}

/**
 * Creates the MySQL client, its transaction runner, a probe and a close.
 *
 * The pool connects on first use, so creating it touches nothing; the startup
 * check of `src/infra/` is what proves the server is reachable. It does not read
 * the environment and assumes nothing about where the server is.
 *
 * Each connection starts with `time_zone = '+00:00'`, so a default of
 * `CURRENT_TIMESTAMP(3)` is UTC on a server whose own zone is not. A call that waits
 * for a busy pool gives up at the acquire deadline (`boundAcquire`), and the failure
 * is an outage.
 *
 * A nested `transactions.run` is refused at once (`createNestingGuard`), because the
 * inner call would take a second connection and wait for locks the outer one holds, or
 * exhaust the pool when several requests nest at the same time: pass the transaction
 * handle down instead.
 *
 * Each `run` gives Drizzle a client of its own that exposes only `query` and `execute`
 * and refuses a statement once the callback has settled (`createTransactionEnd`),
 * because a builder or a prepared statement made before the end reaches the driver
 * through that client, and the connection underneath goes back to the pool for someone
 * else. The check also runs as Drizzle's logger, which it calls outside its error
 * wrapper, so the fixed message is what the caller sees.
 *
 * The probe takes a connection of its own and gives it up when the query fails or
 * does not answer within its timeout: `mysql2` keeps the connection busy after a
 * query timeout, so a probe that returned it would let a silent server use up the
 * pool. An application query has no such deadline (`docs/rules/data.md`). `close`
 * waits a moment for connections in use and then gives up, so a silent server cannot
 * stop the process from ending.
 *
 * @param config - The validated settings.
 * @param options - Timeouts and pool size, for tests.
 * @returns The database port.
 */
export function createDatabase(
  config: DatabaseConfig,
  options: DatabaseOptions = {},
): DatabasePort<Database, DatabaseTransaction> {
  const poolOptions: PoolOptions = {
    uri: config.DATABASE_URL,
    connectionLimit: options.connectionLimit ?? 10,
    connectTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    waitForConnections: true,
    queueLimit: 0,
    idleTimeout: 30_000,
    enableKeepAlive: true,
    timezone: 'Z',
  };
  const pool = createPool(poolOptions);
  boundAcquire(pool, options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS);
  pool.pool.on('connection', (connection) => {
    connection.on('error', (error: Error & { code?: string }) => {
      console.error(
        `mysql: a connection failed${error.code ? ` (${error.code})` : ''}`,
      );
    });
    connection.query(SESSION_TIME_ZONE, () => undefined);
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  const guard = createNestingGuard('mysql', 'transaction handle');
  const transactions: TransactionRunner<DatabaseTransaction> = {
    run: (work) =>
      guard.enter(async () => {
        const connection: PoolConnection = await pool.getConnection();
        const end = createTransactionEnd();
        const statementOf = (query: unknown): string | undefined =>
          typeof query === 'string'
            ? query
            : (query as { sql?: string } | undefined)?.sql;
        const scoped = drizzle(
          {
            query: (query: unknown, ...rest: unknown[]) => {
              end.check(statementOf(query));
              return Reflect.apply(connection.query, connection, [
                query,
                ...rest,
              ]) as unknown;
            },
            execute: (query: unknown, ...rest: unknown[]) => {
              end.check(statementOf(query));
              return Reflect.apply(connection.execute, connection, [
                query,
                ...rest,
              ]) as unknown;
            },
          } as unknown as Pool,
          {
            schema,
            mode: 'default',
            logger: { logQuery: (statement) => end.check(statement) },
          },
        );
        try {
          return await scoped.transaction((tx) =>
            end.during(() => work(end.handle(tx))),
          );
        } finally {
          end.finish();
          connection.release();
        }
      }),
  };
  let closed = false;
  return {
    name: 'mysql',
    db,
    transactions,
    probe: async () => {
      const connection = await pool.getConnection();
      try {
        await connection.query({ sql: 'select 1', timeout: CHECK_TIMEOUT_MS });
      } catch (error) {
        connection.destroy();
        throw error;
      }
      connection.release();
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await bounded(pool.end(), CLOSE_WAIT_MS, 'mysql').catch(() => {
        // Connections still in use on a silent server end with the process.
      });
    },
  };
}
