import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { mysqlTable, varchar } from 'drizzle-orm/mysql-core';

import { requireLocalUrl } from '../../common/tests/local-target.js';
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
  /** Releases what `testTarget` set up. */
  dispose: () => Promise<void>;
};

/**
 * The database the store tests run against: `TEST_DATABASE_URL`, which must name
 * a local host. The application's user cannot create a database, so tests never
 * write outside a table of their own with a random name.
 *
 * @returns The target.
 * @throws Error when `TEST_DATABASE_URL` is missing or not local.
 */
export function testTarget(): Promise<TestTarget> {
  return Promise.resolve({
    url: requireLocalUrl('TEST_DATABASE_URL'),
    dispose: () => Promise.resolve(),
  });
}

/**
 * Makes a table name no other test or project table uses.
 *
 * @param label - A word for whoever reads a leftover table.
 * @returns The name.
 */
export function randomTableName(label: string): string {
  return `it_${label}_${randomBytes(6).toString('hex')}`;
}

/** A throwaway table that a test writes to and reads from. */
export type Probe = {
  /** Inserts a row through the executor the caller holds. */
  insert: (executor: DatabaseExecutor, id: string) => Promise<void>;
  /** Whether a row with this id is visible to the executor. */
  exists: (executor: DatabaseExecutor, id: string) => Promise<boolean>;
  /** Drops the table. */
  drop: () => Promise<void>;
  /** The table's name, for statements a test writes by hand. */
  name: string;
};

/**
 * Creates a table of its own before any transaction opens: MySQL commits at each
 * DDL statement, so a `create table` inside a transaction would end it.
 *
 * @param database - The client of the database under test.
 * @returns The probe table's operations.
 */
export async function createProbe(database: {
  db: Database;
  transactions: TransactionRunner<DatabaseTransaction>;
}): Promise<Probe> {
  const name = randomTableName('probe');
  const rows = mysqlTable(name, {
    id: varchar('id', { length: 36 }).primaryKey(),
  });
  await database.db.execute(
    sql`create table ${sql.identifier(name)} (id varchar(36) primary key)`,
  );
  return {
    name,
    insert: async (executor, id) => {
      await executor.insert(rows).values({ id });
    },
    exists: async (executor, id) => {
      const found = await executor.select().from(rows).where(eq(rows.id, id));
      return found.length > 0;
    },
    drop: async () => {
      await database.db.execute(sql`drop table ${sql.identifier(name)}`);
    },
  };
}
