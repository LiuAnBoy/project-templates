import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import { z } from 'zod';

import { createDatabase, databaseEnv } from '../database.js';

describe('sqlite outage', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'sqlite-outage-'));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('fails to open a wrong path with an error the classifier accepts, and creates no file', () => {
    const wrong = join(folder, 'missing.db');

    let error: unknown;
    try {
      createDatabase({ DATABASE_URL: wrong });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(isDependencyOutage(error)).toBe(true);
    expect((error as Error).message).not.toContain(folder);
    expect(existsSync(wrong)).toBe(false);
  });

  it('fails a write on a held lock with an error the classifier accepts', async () => {
    const file = join(folder, 'held.db');
    new BetterSqlite3(file).close();
    const holder = new BetterSqlite3(file);
    holder.pragma('journal_mode = WAL');
    holder.exec('BEGIN IMMEDIATE');
    const database = createDatabase(
      { DATABASE_URL: file },
      { busyTimeoutMs: 50 },
    );

    const error = await database.transactions
      .run(() => Promise.resolve())
      .catch((caught: unknown) => caught);
    holder.close();
    await database.close();

    expect(isDependencyOutage(error)).toBe(true);
  });

  it('describes a failed statement without its bound values', async () => {
    const file = join(folder, 'values.db');
    new BetterSqlite3(file).close();
    const database = createDatabase({ DATABASE_URL: file });

    const error = await database.transactions
      .run((tx) => {
        tx.run(sql`insert into missing_table values (${'SECRET-TOKEN-123'})`);
        return Promise.resolve();
      })
      .catch((caught: unknown) => caught);
    await database.close();

    const logged = JSON.stringify(describeFailure(error));
    expect(logged).toContain('no such table');
    expect(logged).not.toContain('SECRET-TOKEN-123');
  });

  it('reproduces a timer set inside a run that fires after it ended: it opens its own transaction', async () => {
    const file = join(folder, 'timer.db');
    new BetterSqlite3(file).close();
    const database = createDatabase({ DATABASE_URL: file });
    let late: Promise<string> | undefined;

    await database.transactions.run(() => {
      late = new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
        database.transactions.run(() => Promise.resolve('opened')),
      );
      return Promise.resolve();
    });

    await expect(late).resolves.toBe('opened');
    await database.close();
  });

  it('refuses work started inside a run while it is still open, at once', async () => {
    const file = join(folder, 'during.db');
    new BetterSqlite3(file).close();
    const database = createDatabase({ DATABASE_URL: file });
    let during: Promise<unknown> | undefined;

    await database.transactions.run(async () => {
      during = database.transactions
        .run(() => Promise.resolve())
        .catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(((await during) as Error).message).toMatch(
      /pass the transaction handle down/,
    );
    await database.close();
  });

  it('logs the fixed text of a wrong path, which holds no path', () => {
    let error: unknown;
    try {
      createDatabase({ DATABASE_URL: join(folder, 'missing.db') });
    } catch (caught) {
      error = caught;
    }

    const link = describeFailure(error).chain[0];

    expect(link?.code).toBe('SQLITE_CANTOPEN');
    expect(link?.message).toBe('sqlite: the database file cannot be opened');
  });

  it('refuses a setting that is not the path of a file', () => {
    const settings = z.object(databaseEnv);

    for (const value of [':memory:', 'file:canary.db', 'sqlite://canary.db']) {
      const result = settings.safeParse({ DATABASE_URL: value });

      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).not.toContain('canary');
    }
    expect(settings.safeParse({ DATABASE_URL: './data/app.db' }).success).toBe(
      true,
    );
  });
});
