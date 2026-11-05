import BetterSqlite3 from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';

import { isDatabasePath } from '../../scripts/db/database-path.mjs';
import { FixedTextError } from '../common/errors/fixed-text-error.js';
import { createNestingGuard } from './nesting-guard.js';
import * as schema from './schema/index.js';
import { createTransactionEnd } from './transaction-end.js';
import type { DatabasePort, TransactionRunner } from './types.js';

/**
 * The settings of the database, spread into the environment schema by
 * `src/infra/infra-env.ts`. Required: a missing value stops the boot naming
 * the variable, and the message never carries the value. The rule itself lives with
 * the migration scripts, which share it and run without the build.
 */
export const databaseEnv = {
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(isDatabasePath, 'must be the path of a database file'),
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
  return new FixedTextError(`sqlite: ${message}`, code);
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
 * Puts a check in front of the writing connection, for one transaction.
 *
 * Every transaction shares this connection, so a statement or the client kept from an
 * earlier one would otherwise write straight into whichever transaction is open now.
 * What the driver hands out on the way to a statement is wrapped the same way: functions,
 * statements (`raw()` returns the statement itself), iterators and the connection a
 * statement names. Rows are returned as they are.
 *
 * @param writer - The writing connection.
 * @param check - Throws once the transaction has ended.
 * @returns The connection, as Drizzle and the handle see it.
 */
function checkedWriter(
  writer: BetterSqlite3.Database,
  check: () => void,
): BetterSqlite3.Database {
  const wrapped = new WeakMap<object, object>();

  const isDriverObject = (value: unknown): value is object =>
    typeof value === 'function' ||
    value === writer ||
    (typeof value === 'object' &&
      value !== null &&
      ((value as { constructor?: { name?: string } }).constructor?.name ===
        'Statement' ||
        typeof (value as { next?: unknown }).next === 'function'));

  const wrap = <T extends object>(target: T): T => {
    const known = wrapped.get(target);
    if (known) return known as T;
    const proxy = new Proxy(target, {
      get: (object, key) => {
        check();
        const value = Reflect.get(object, key, object) as unknown;
        if (typeof value === 'function')
          return wrap((value as () => unknown).bind(object));
        return isDriverObject(value) ? wrap(value) : value;
      },
      apply: (fn, _self, args) => {
        check();
        const result = Reflect.apply(
          fn as (...parameters: unknown[]) => unknown,
          undefined,
          args,
        );
        return isDriverObject(result) ? wrap(result) : result;
      },
    });
    wrapped.set(target, proxy);
    return proxy;
  };

  return wrap(writer);
}

/**
 * Creates the SQLite client, its transaction runner, a probe and a close.
 *
 * It holds two connections. Reads default to one (`db`). `transactions.run` takes
 * an in-process lock on the other, issues `BEGIN IMMEDIATE`, awaits the callback
 * and commits or rolls back, because `better-sqlite3` refuses a transaction whose
 * callback returns a promise and one shared connection would let another request's
 * statement land inside an open transaction across an `await`. A nested `run` is
 * refused at once (`createNestingGuard`), because it would wait for a lock its own
 * callback holds and stop every write until a restart: pass the transaction handle
 * down instead.
 *
 * Each `run` gives its callback a Drizzle client of its own, on `checkedWriter`, which
 * refuses every statement once the callback has settled (`createTransactionEnd`). The
 * commit or the rollback then runs on the connection itself, so a statement kept from
 * this transaction can never join the next.
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
  const lock = createWriteLock();
  const guard = createNestingGuard('sqlite', 'transaction handle');

  const transactions: TransactionRunner<DatabaseTransaction> = {
    run: (work) =>
      guard.enter(async () => {
        const release = await lock.acquire(writeWaitMs);
        const end = createTransactionEnd();
        try {
          writer.exec('BEGIN IMMEDIATE');
          const tx: DatabaseTransaction = drizzle({
            client: checkedWriter(writer, () => end.check()),
            schema,
          });
          try {
            const result = await end.during(() => work(end.handle(tx)));
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
          end.finish();
          release();
        }
      }),
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
