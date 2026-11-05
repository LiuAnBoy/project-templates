import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStore } from '../../../scripts/db/adapter.mjs';
import {
  describeMigrateFailure,
  runMigrate,
  runStatus,
} from '../../../scripts/db/runner.mjs';

/**
 * Runs a script against the URL in `DATABASE_URL` and describes how it failed.
 *
 * @param run - `runMigrate` or `runStatus`.
 * @returns What the script would print for the failure.
 */
async function failureOf(run: typeof runMigrate): Promise<string> {
  const error = await run(openStore, { out: { write: () => true } }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  return describeMigrateFailure(error);
}

describe('what db:migrate prints when it cannot connect', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  describe('a closed port', () => {
    beforeEach(() => {
      process.env.DATABASE_URL =
        'mysql://secret-user:secret-pw@127.0.0.1:1/secret-db';
    });

    it('prints fixed text and the code, with no host, user, password or database name', async () => {
      for (const run of [runMigrate, runStatus]) {
        const text = await failureOf(run);

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

  describe('a host that does not resolve', () => {
    it('prints fixed text and the code, with no host name', async () => {
      process.env.DATABASE_URL =
        'mysql://secret-user:secret-pw@secret-host.invalid:3306/secret-db';

      for (const run of [runMigrate, runStatus]) {
        const text = await failureOf(run);

        expect(text).toMatch(/ENOTFOUND|EAI_AGAIN/);
        for (const secret of ['secret-host', 'secret-user', 'secret-pw']) {
          expect(text).not.toContain(secret);
        }
      }
    });
  });

  describe('a URL the driver cannot read', () => {
    it('prints fixed text, not silence, and no part of the URL', async () => {
      process.env.DATABASE_URL =
        'mysql://secret-user:secret-pw@secret-host:secret-port/secret-db';

      for (const run of [runMigrate, runStatus]) {
        const text = await failureOf(run);

        expect(text).toMatch(/^Cannot reach or open the database/);
        for (const secret of [
          'secret-host',
          'secret-user',
          'secret-pw',
          'secret-port',
        ]) {
          expect(text).not.toContain(secret);
        }
      }
    });
  });
});

describe('what db:migrate prints for failures it recognises by code', () => {
  it('treats a refused login, a missing database and a failed handshake as the database being unreachable', () => {
    for (const [code, message] of [
      [
        'ER_ACCESS_DENIED_ERROR',
        "Access denied for user 'canary-user'@'canary-host'",
      ],
      [
        'ER_DBACCESS_DENIED_ERROR',
        "Access denied for user 'u'@'%' to database 'canary-db'",
      ],
      ['ER_BAD_DB_ERROR', "Unknown database 'canary-db'"],
      ['HANDSHAKE_SSL_ERROR', 'self-signed certificate in certificate chain'],
      [
        'PROTOCOL_CONNECTION_LOST',
        'Connection lost: The server closed the connection.',
      ],
    ] as const) {
      const text = describeMigrateFailure(
        Object.assign(new Error(message), { code }),
      );

      expect(text).toContain('Cannot reach or open the database');
      expect(text).toContain(code);
      expect(text).not.toContain('canary');
    }
  });

  it('prints the code of an ER_* error under a statement and not its message', () => {
    const cause = Object.assign(
      new Error("Duplicate entry 'CANARY-VALUE' for key 't.u'"),
      {
        code: 'ER_DUP_ENTRY',
      },
    );
    const failed = Object.assign(
      new Error('Failed query: CREATE UNIQUE INDEX u ON t (c)'),
      {
        query: 'CREATE UNIQUE INDEX u ON t (c)',
        params: [],
        cause,
      },
    );

    const text = describeMigrateFailure(failed);

    expect(text).toContain('CREATE UNIQUE INDEX u ON t (c)');
    expect(text).toContain('ER_DUP_ENTRY');
    expect(text).not.toContain('CANARY');
  });
});
