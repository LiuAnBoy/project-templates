import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { createDatabase } from '../database.js';

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
});
