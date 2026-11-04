import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../database.js';
import {
  createProbe,
  testTarget,
  type Probe,
  type TestTarget,
} from './support.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
