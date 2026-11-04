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
