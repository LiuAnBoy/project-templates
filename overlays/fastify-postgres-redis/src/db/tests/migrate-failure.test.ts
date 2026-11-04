import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStore } from '../../../scripts/db/adapter.mjs';
import {
  describeMigrateFailure,
  runMigrate,
  runStatus,
} from '../../../scripts/db/runner.mjs';

describe('what db:migrate prints when it cannot connect', () => {
  const quiet = { write: () => true };

  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgresql://secret-user:secret-pw@127.0.0.1:1/secret-db';
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('prints fixed text and the code, with no host, user, password or database name', async () => {
    for (const run of [runMigrate, runStatus]) {
      const error = await run(openStore, { out: quiet }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      const text = describeMigrateFailure(error);

      expect(text).toContain('ECONNREFUSED');
      for (const secret of [
        '127.0.0.1',
        'secret-user',
        'secret-pw',
        'secret-db',
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

describe('what db:migrate prints when the server ends the connection', () => {
  it('prints fixed text for a FATAL reply that quotes a name from the URL', () => {
    const fatal = Object.assign(
      new Error('unrecognized configuration parameter "canary_opt"'),
      { severity: 'FATAL', code: '42704' },
    );

    const text = describeMigrateFailure(fatal);

    expect(text).toContain('Cannot reach or open the database');
    expect(text).not.toContain('canary');
  });
});

describe('what db:migrate prints for a URL whose port cannot be used', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('reproduces a port option that is not a number: fixed text, not silence, and no value', async () => {
    process.env.DATABASE_URL =
      'postgresql://secret-user:secret-pw@127.0.0.1:1/secret-db?port=CANARYPORT';

    for (const run of [runMigrate, runStatus]) {
      const error = await run(openStore, { out: { write: () => true } }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      const text = describeMigrateFailure(error);

      expect(text).toMatch(/^Cannot reach or open the database/);
      expect(text).not.toContain('CANARYPORT');
    }
  });
});
