import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeFailure } from '../../common/errors/failure.js';
import { openStore } from '../../../scripts/db/adapter.mjs';
import {
  describeMigrateFailure,
  runMigrate,
  runStatus,
} from '../../../scripts/db/runner.mjs';
import { createDatabase } from '../database.js';
import {
  createProbe,
  testTarget,
  type Probe,
  type TestTarget,
} from './support.js';

describe('postgres database', () => {
  let target: TestTarget;
  let database: ReturnType<typeof createDatabase>;
  let probe: Probe;

  beforeAll(async () => {
    target = await testTarget();
    database = createDatabase({ DATABASE_URL: target.url });
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

      expect(await probe.exists(tx, 'inside')).toBe(true);
      expect(await probe.exists(database.db, 'inside')).toBe(false);
    });

    expect(await probe.exists(database.db, 'inside')).toBe(true);
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

  it('reproduces the self-deadlock of a nested run on a row the outer transaction wrote: the nested call is refused, the outer rolls back', async () => {
    const outcome = await database.transactions
      .run(async (tx) => {
        await probe.insert(tx, 'self-deadlock');
        await database.transactions.run((inner) =>
          probe.insert(inner, 'self-deadlock'),
        );
      })
      .catch((error: unknown) => error);

    expect((outcome as Error).message).toMatch(
      /pass the transaction handle down/,
    );
    expect(await probe.exists(database.db, 'self-deadlock')).toBe(false);
  });

  it('commits the outer transaction when it catches the refusal of a nested run', async () => {
    await database.transactions.run(async (tx) => {
      await probe.insert(tx, 'outer-survives');
      await database.transactions
        .run(() => Promise.resolve())
        .catch(() => undefined);
    });

    expect(await probe.exists(database.db, 'outer-survives')).toBe(true);
  });

  it('reproduces twelve concurrent nested calls: each is refused at once and the pool still serves a later run', async () => {
    const started = Date.now();

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        database.transactions
          .run(async () => {
            await database.transactions.run(() => Promise.resolve());
          })
          .catch((error: unknown) => error),
      ),
    );

    expect(Date.now() - started).toBeLessThan(2000);
    for (const outcome of outcomes) {
      expect((outcome as Error).message).toMatch(
        /pass the transaction handle down/,
      );
    }
    await database.transactions.run((tx) => probe.insert(tx, 'after-twelve'));
    expect(await probe.exists(database.db, 'after-twelve')).toBe(true);
  });

  it('logs the code and not the quoted value of a data exception under a failed statement', async () => {
    const error = await database.db
      .execute(sql`select ${'SECRET-TOKEN-123'}::int`)
      .catch((caught: unknown) => caught);

    const failure = describeFailure(error);

    expect(failure.chain.map((link) => link.code)).toContain('22P02');
    expect(JSON.stringify(failure)).not.toContain('SECRET-TOKEN-123');
  });

  it('fails the probe on a closed pool', async () => {
    const closed = createDatabase({ DATABASE_URL: target.url });
    await closed.probe();
    await closed.close();

    await expect(closed.probe()).rejects.toThrow();
    await expect(closed.close()).resolves.toBeUndefined();
  });

  it('reproduces a rejected login and an unknown database: the log names neither the user nor the database, and keeps the code', async () => {
    const url = new URL(target.url);
    const wrongUser = new URL(url);
    wrongUser.username = 'canary-user';
    wrongUser.password = 'canary-pw';
    const wrongDatabase = new URL(url);
    wrongDatabase.pathname = '/canary-db';

    for (const [candidate, code] of [
      [wrongUser, '28'],
      [wrongDatabase, '3D000'],
    ] as const) {
      const failing = createDatabase({ DATABASE_URL: candidate.toString() });
      const error = await failing.probe().catch((caught: unknown) => caught);
      await failing.close();

      const logged = JSON.stringify(describeFailure(error));
      expect(logged).not.toContain('canary-user');
      expect(logged).not.toContain('canary-pw');
      expect(logged).not.toContain('canary-db');
      expect(logged).toContain(`"code":"${code}`);
    }
  });

  it('reproduces a startup option the server refuses: db:migrate and db:status print fixed text, and the log names no option', async () => {
    const refused = new URL(target.url);
    refused.searchParams.set('options', '-c canary_opt=1');
    process.env.DATABASE_URL = refused.toString();
    try {
      for (const run of [runMigrate, runStatus]) {
        const error = await run(openStore, {
          out: { write: () => true },
        }).then(
          () => undefined,
          (caught: unknown) => caught,
        );

        expect(error).toBeDefined();
        expect(describeMigrateFailure(error)).toMatch(
          /^Cannot reach or open the database/,
        );
        expect(describeMigrateFailure(error)).not.toContain('canary');
        expect(JSON.stringify(describeFailure(error))).not.toContain('canary');
      }
    } finally {
      delete process.env.DATABASE_URL;
    }
  });
});
