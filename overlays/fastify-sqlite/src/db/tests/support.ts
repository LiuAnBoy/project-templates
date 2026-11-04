import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  Database,
  DatabaseExecutor,
  DatabaseTransaction,
} from '../database.js';
import type { TransactionRunner } from '../types.js';

/** A database for a store test to run against, and how to give it back. */
export type TestTarget = {
  /** The value for `DATABASE_URL`. */
  url: string;
  /** Deletes what `testTarget` created. */
  dispose: () => Promise<void>;
};

/**
 * A database file of its own in a temporary folder, created empty, because the
 * store refuses to open a file that does not exist. Nothing of the project's
 * own database is touched.
 *
 * @returns The target.
 */
export function testTarget(): Promise<TestTarget> {
  const folder = mkdtempSync(join(tmpdir(), 'sqlite-it-'));
  const url = join(folder, 'test.db');
  new BetterSqlite3(url).close();
  return Promise.resolve({
    url,
    dispose: () => {
      rmSync(folder, { recursive: true, force: true });
      return Promise.resolve();
    },
  });
}

/** A throwaway table that a test writes to and reads from. */
export type Probe = {
  /** Inserts a row through the executor the caller holds. */
  insert: (executor: DatabaseExecutor, id: string) => Promise<void>;
  /** Whether a row with this id is visible to the executor. */
  exists: (executor: DatabaseExecutor, id: string) => Promise<boolean>;
  /** Drops the table. */
  drop: () => Promise<void>;
};

const rows = sqliteTable('probe', { id: text('id').primaryKey() });

/**
 * Creates a throwaway table in the test database.
 *
 * @param database - The client and the runner of the database under test.
 * @returns The probe table's operations.
 */
export async function createProbe(database: {
  db: Database;
  transactions: TransactionRunner<DatabaseTransaction>;
}): Promise<Probe> {
  await database.transactions.run((tx) => {
    tx.run(sql`create table probe (id text primary key)`);
    return Promise.resolve();
  });
  return {
    insert: async (executor, id) => {
      await executor.insert(rows).values({ id });
    },
    exists: async (executor, id) => {
      const found = await executor.select().from(rows).where(eq(rows.id, id));
      return found.length > 0;
    },
    drop: async () => {
      await database.transactions.run((tx) => {
        tx.run(sql`drop table probe`);
        return Promise.resolve();
      });
    },
  };
}
