import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';

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
 * a local host. Tests never write outside a throwaway schema of their own.
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

/** A throwaway table that a test writes to and reads from. */
export type Probe = {
  /** Inserts a row through the executor the caller holds. */
  insert: (executor: DatabaseExecutor, id: string) => Promise<void>;
  /** Whether a row with this id is visible to the executor. */
  exists: (executor: DatabaseExecutor, id: string) => Promise<boolean>;
  /** Drops the table and its schema. */
  drop: () => Promise<void>;
};

/**
 * Creates a table in a schema of its own, so a test never touches a shared one
 * and never needs a flush.
 *
 * @param database - The client and the runner of the database under test.
 * @returns The probe table's operations.
 */
export async function createProbe(database: {
  db: Database;
  transactions: TransactionRunner<DatabaseTransaction>;
}): Promise<Probe> {
  const schemaName = `it_${randomBytes(6).toString('hex')}`;
  const rows = pgSchema(schemaName).table('probe', {
    id: text('id').primaryKey(),
  });
  await database.transactions.run(async (tx) => {
    await tx.execute(sql`create schema ${sql.identifier(schemaName)}`);
    await tx.execute(sql`create table ${rows} (id text primary key)`);
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
      await database.transactions.run(async (tx) => {
        await tx.execute(
          sql`drop schema ${sql.identifier(schemaName)} cascade`,
        );
      });
    },
  };
}
