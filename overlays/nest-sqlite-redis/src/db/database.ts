import { AsyncLocalStorage } from 'node:async_hooks';

import BetterSqlite3 from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';

import * as schema from './schema/index.js';
import type { DatabasePort, TransactionRunner } from './types.js';

/**
 * The settings of the database, spread into the environment schema by
 * `src/infra/infra-env.ts`. Required: a missing value stops the boot naming
 * the variable, and the message never carries the value.
 */
export const databaseEnv = {
  DATABASE_URL: z.string().min(1),
};

/** What `createDatabase` reads of the validated environment: the path of the database file. */
export type DatabaseConfig = { DATABASE_URL: string };

/**
 * The query client. It reads only: its connection is `query_only`, so a write
 * through it fails loudly instead of landing outside a transaction. Writes go
 * through `transactions.run`.
 */
export type Database = BetterSQLite3Database<typeof schema>;

/** The handle a transaction callback receives: a client on the one writing connection. */
export type DatabaseTransaction = Database;

/** Anything a repository can run a statement against. */
export type DatabaseExecutor = Database | DatabaseTransaction;

/** Settings that tests and unusual deployments may change. */
export type DatabaseOptions = {
  /** How long a connection waits for a lock held by another process, in milliseconds. */
  busyTimeoutMs?: number;
  /** How long `run` waits for the write lock of this process before it fails as busy, in milliseconds. */
  writeWaitMs?: number;
};

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const DEFAULT_WRITE_WAIT_MS = 5000;

/**
 * An error shaped like the driver's own, so `isDependencyOutage` reads the code.
 * Its message never holds the path, which can reach the console.
 *
 * @param message - What happened, without any value from the environment.
 * @param code - The SQLite result code.
 * @returns The error.
 */
function sqliteError(message: string, code: string): Error {
  return Object.assign(new Error(`sqlite: ${message}`), { code });
}

/**
 * Opens one connection to a database file that must already exist: only
 * `pnpm db:migrate` creates it, so a wrong path fails at boot instead of
 * silently starting an empty database.
 *
 * @param path - The database file.
 * @param busyTimeoutMs - How long to wait for another process's lock.
 * @returns The open connection, with its pragmas set.
 * @throws Error with code `SQLITE_CANTOPEN` (or the driver's own code) and no path in its message.
 */
function open(path: string, busyTimeoutMs: number): BetterSqlite3.Database {
  let connection: BetterSqlite3.Database | undefined;
  try {
    connection = new BetterSqlite3(path, { fileMustExist: true });
    connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
    connection.pragma('foreign_keys = ON');
    connection.pragma('journal_mode = WAL');
  } catch (error) {
    connection?.close();
    const code = (error as { code?: unknown }).code;
    throw sqliteError(
      'the database file cannot be opened',
      typeof code === 'string' && code.startsWith('SQLITE_')
        ? code
        : 'SQLITE_CANTOPEN',
    );
  }
  return connection;
}

/**
 * A mutex whose wait is bounded.
 *
 * A second writer must not block inside SQLite's `busy_timeout`: that blocks the
 * event loop, which the open transaction needs to finish. It waits here instead,
 * and gives up as a busy store.
 *
 * @returns `acquire`, which resolves to a release function.
 */
function createWriteLock(): {
  acquire: (waitMs: number) => Promise<() => void>;
} {
  let held = false;
  const waiters: Array<() => void> = [];

  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else held = false;
  };
  const once = (): (() => void) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      release();
    };
  };

  return {
    acquire: async (waitMs) => {
      if (!held) {
        held = true;
        return once();
      }
      await new Promise<void>((resolve, reject) => {
        const turn = (): void => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(turn), 1);
          reject(sqliteError('the write lock is busy', 'SQLITE_BUSY'));
        }, waitMs);
        waiters.push(turn);
      });
      return once();
    },
  };
}

/**
 * Creates the SQLite client, its transaction runner, a probe and a close.
 *
 * It holds two connections. Reads default to one (`db`). `transactions.run` takes
 * an in-process lock on the other, issues `BEGIN IMMEDIATE`, awaits the callback
 * and commits or rolls back, because `better-sqlite3` refuses a transaction whose
 * callback returns a promise and one shared connection would let another request's
 * statement land inside an open transaction across an `await`. A nested `run` is
 * refused at once, because it would wait for a lock its own callback holds and stop
 * every write until a restart: pass the transaction handle down instead.
 *
 * The files must exist, so this throws, with no path in its message, when the path
 * is wrong. The pragmas are `busy_timeout`, `foreign_keys` and `journal_mode = WAL`.
 *
 * @param config - The validated settings.
 * @param options - Timeouts, for tests.
 * @returns The database port.
 * @throws Error with code `SQLITE_CANTOPEN` when the file cannot be opened.
 */
export function createDatabase(
  config: DatabaseConfig,
  options: DatabaseOptions = {},
): DatabasePort<Database, DatabaseTransaction> {
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const writeWaitMs = options.writeWaitMs ?? DEFAULT_WRITE_WAIT_MS;

  const writer = open(config.DATABASE_URL, busyTimeoutMs);
  let reader: BetterSqlite3.Database;
  try {
    reader = open(config.DATABASE_URL, busyTimeoutMs);
  } catch (error) {
    writer.close();
    throw error;
  }
  reader.pragma('query_only = ON');

  const db: Database = drizzle({ client: reader, schema });
  const tx: DatabaseTransaction = drizzle({ client: writer, schema });
  const lock = createWriteLock();
  const insideRun = new AsyncLocalStorage<true>();

  const transactions: TransactionRunner<DatabaseTransaction> = {
    run: async (work) => {
      if (insideRun.getStore()) {
        throw new Error(
          'sqlite: transactions.run was called inside a transaction; pass the transaction handle down instead',
        );
      }
      const release = await lock.acquire(writeWaitMs);
      try {
        writer.exec('BEGIN IMMEDIATE');
        try {
          const result = await insideRun.run(true, () => work(tx));
          writer.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            if (writer.inTransaction) writer.exec('ROLLBACK');
          } catch {
            // The original error is the one the caller needs.
          }
          throw error;
        }
      } finally {
        release();
      }
    },
  };

  return {
    name: 'sqlite',
    db,
    transactions,
    probe: async () => {
      reader.prepare('select 1').get();
    },
    close: () => {
      if (reader.open) reader.close();
      if (writer.open) writer.close();
      return Promise.resolve();
    },
  };
}
