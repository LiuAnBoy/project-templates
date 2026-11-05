import type BetterSqlite3 from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import { createDatabase, type DatabaseTransaction } from '../database.js';
import {
  TRANSACTION_ENDED_MESSAGE,
  TransactionEndedError,
} from '../transaction-end.js';
import {
  createProbe,
  testTarget,
  type Probe,
  type TestTarget,
} from './support.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The raw connection Drizzle exposes on a handle, which its types leave out. */
const clientOf = (tx: DatabaseTransaction) =>
  (tx as unknown as { $client: BetterSqlite3.Database }).$client;

describe('sqlite database', () => {
  let target: TestTarget;
  let database: ReturnType<typeof createDatabase>;
  let probe: Probe;

  beforeAll(async () => {
    target = await testTarget();
    database = createDatabase(
      { DATABASE_URL: target.url },
      { writeWaitMs: 300 },
    );
    probe = await createProbe(database);
  });
  afterAll(async () => {
    await probe.drop();
    await database.close();
    await target.dispose();
  });

  it('answers the probe', async () => {
    await expect(database.probe()).resolves.toBeUndefined();
  });

  it('commits when the work returns', async () => {
    await database.transactions.run((tx) => probe.insert(tx, 'committed'));

    expect(await probe.exists(database.db, 'committed')).toBe(true);
  });

  it('rolls back when the work throws, and rethrows its error', async () => {
    await expect(
      database.transactions.run(async (tx) => {
        await probe.insert(tx, 'rolled-back');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await probe.exists(database.db, 'rolled-back')).toBe(false);
  });

  it('lets a repository write see its own transaction and hides it from outside until commit', async () => {
    await database.transactions.run(async (tx) => {
      await probe.insert(tx, 'inside');
      await sleep(20);

      expect(await probe.exists(tx, 'inside')).toBe(true);
      expect(await probe.exists(database.db, 'inside')).toBe(false);
    });

    expect(await probe.exists(database.db, 'inside')).toBe(true);
  });

  it('serialises two concurrent runs', async () => {
    const order: string[] = [];
    const first = database.transactions.run(async (tx) => {
      order.push('first:start');
      await probe.insert(tx, 'serial-1');
      await sleep(60);
      order.push('first:end');
    });
    const second = database.transactions.run(async (tx) => {
      order.push('second:start');
      await probe.insert(tx, 'serial-2');
      order.push('second:end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
    expect(await probe.exists(database.db, 'serial-2')).toBe(true);
  });

  it('refuses a nested run at once, and stays usable', async () => {
    const outcome = await database.transactions
      .run(async () => {
        await database.transactions.run(() => Promise.resolve());
      })
      .catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(
      /pass the transaction handle down/,
    );
    await database.transactions.run((tx) => probe.insert(tx, 'after-nested'));
    expect(await probe.exists(database.db, 'after-nested')).toBe(true);
  });

  it('fails a run that outwaits the bound as a busy store, and stays usable', async () => {
    const holder = database.transactions.run(() => sleep(700));
    await sleep(20);

    const outcome = await database.transactions
      .run(() => Promise.resolve())
      .catch((error: unknown) => error);
    await holder;

    expect((outcome as { code?: string }).code).toBe('SQLITE_BUSY');
    await database.transactions.run((tx) => probe.insert(tx, 'after-busy'));
    expect(await probe.exists(database.db, 'after-busy')).toBe(true);
  });

  describe('a handle used after its run ended', () => {
    /** Runs a transaction that commits, and gives back the handle the work kept. */
    const keptHandle = async (): Promise<DatabaseTransaction> => {
      let kept: DatabaseTransaction | undefined;
      await database.transactions.run((tx) => {
        kept = tx;
        return Promise.resolve();
      });
      return kept as DatabaseTransaction;
    };

    it('throws the fixed error, classified as no outage', async () => {
      const tx = await keptHandle();

      const error = await probe
        .insert(tx, 'after-commit')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TransactionEndedError);
      expect((error as Error).message).toBe(TRANSACTION_ENDED_MESSAGE);
      expect(isDependencyOutage(error)).toBe(false);
      expect(JSON.stringify(describeFailure(error))).toContain(
        TRANSACTION_ENDED_MESSAGE,
      );
      expect(await probe.exists(database.db, 'after-commit')).toBe(false);
    });

    it('reproduces a write after the rollback: it never commits', async () => {
      let kept: DatabaseTransaction | undefined;
      await database.transactions
        .run((tx) => {
          kept = tx;
          return Promise.reject(new Error('boom'));
        })
        .catch(() => undefined);

      await expect(
        probe.insert(kept as DatabaseTransaction, 'after-rollback'),
      ).rejects.toBeInstanceOf(TransactionEndedError);

      expect(await probe.exists(database.db, 'after-rollback')).toBe(false);
    });

    it('reproduces a kept handle joining another transaction: it is refused and rolls back with nothing', async () => {
      const stale = await keptHandle();
      let outcome: unknown;

      await database.transactions
        .run(async (tx) => {
          await probe.insert(tx, 'other');
          outcome = await probe
            .insert(stale, 'joined')
            .catch((caught: unknown) => caught);
          throw new Error('boom');
        })
        .catch(() => undefined);

      expect(outcome).toBeInstanceOf(TransactionEndedError);
      expect(await probe.exists(database.db, 'other')).toBe(false);
    });

    it('refuses a builder, a prepared statement and the raw client made before the end, on the shared connection', async () => {
      let built: unknown;
      let prepared: { all: () => unknown } | undefined;
      let client: BetterSqlite3.Database | undefined;
      let statement: BetterSqlite3.Statement | undefined;
      await database.transactions.run((tx) => {
        built = tx.select({ one: sql`1` }).from(sql`(select 1) as t`);
        prepared = tx
          .select({ one: sql`1` })
          .from(sql`(select 1) as t`)
          .prepare();
        client = clientOf(tx);
        statement = client.prepare('select 1');
        return Promise.resolve();
      });

      await expect(Promise.resolve(built)).rejects.toBeInstanceOf(
        TransactionEndedError,
      );
      expect(() => prepared?.all()).toThrow(TransactionEndedError);
      expect(() => client?.exec('select 1')).toThrow(TransactionEndedError);
      expect(() => client?.prepare('select 1')).toThrow(TransactionEndedError);
      expect(() => statement?.run()).toThrow(TransactionEndedError);
      expect(() => statement?.database).toThrow(TransactionEndedError);
    });

    it('gives work still running when the run ends the same error, stored in a repository too', async () => {
      class Repository {
        constructor(readonly tx: DatabaseTransaction) {}
        write(): Promise<void> {
          return probe.insert(this.tx, 'from-repository');
        }
      }
      let late: Promise<unknown> | undefined;

      await database.transactions.run((tx) => {
        const repository = new Repository(tx);
        late = sleep(20)
          .then(() => repository.write())
          .catch((caught: unknown) => caught);
        return Promise.resolve();
      });

      expect(await late).toBeInstanceOf(TransactionEndedError);
      expect(await probe.exists(database.db, 'from-repository')).toBe(false);
    });

    it('lets work started inside open its own transaction after the end', async () => {
      let late: Promise<void> | undefined;

      await database.transactions.run(() => {
        late = sleep(20).then(() =>
          database.transactions.run((tx) => probe.insert(tx, 'timer-after')),
        );
        return Promise.resolve();
      });
      await late;

      expect(await probe.exists(database.db, 'timer-after')).toBe(true);
    });

    it('keeps a statement of the open transaction and a row read in it working', async () => {
      await database.transactions.run(async (tx) => {
        await probe.insert(tx, 'keep-working');
        const rows = clientOf(tx).prepare('select 1 as one').raw().all();
        expect(rows).toEqual([[1]]);
        expect(clientOf(tx).inTransaction).toBe(true);
      });

      expect(await probe.exists(database.db, 'keep-working')).toBe(true);
    });
  });

  it('refuses a write through the reading client', async () => {
    await expect(probe.insert(database.db, 'outside')).rejects.toThrow();
  });

  it('fails the probe on a closed connection', async () => {
    const closed = createDatabase({ DATABASE_URL: target.url });
    await closed.close();

    await expect(closed.probe()).rejects.toThrow();
    await expect(closed.close()).resolves.toBeUndefined();
  });
});
