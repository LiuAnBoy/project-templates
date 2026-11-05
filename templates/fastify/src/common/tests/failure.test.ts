import { describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../errors/dependency-failure.js';
import { AppError } from '../errors/app-error.js';
import { describeFailure } from '../errors/failure.js';
import { FAILURES, failureForStatus } from '../errors/failures.js';
import { bounded } from '../concurrency/bounded.js';

describe('dependency outage classification', () => {
  it('recognises a network errno anywhere in the cause chain', () => {
    const error = new Error('outer', {
      cause: new Error('mid', { cause: { code: 'ETIMEDOUT' } }),
    });
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('recognises a connection-class SQLSTATE and an aggregate entry', () => {
    expect(isDependencyOutage({ code: '57P01' })).toBe(true);
    expect(
      isDependencyOutage(new AggregateError([{ code: 'ECONNREFUSED' }])),
    ).toBe(true);
  });

  it('recognises a SQLite database that is busy, locked or cannot be opened', () => {
    for (const code of [
      'SQLITE_BUSY',
      'SQLITE_BUSY_SNAPSHOT',
      'SQLITE_LOCKED',
      'SQLITE_CANTOPEN',
    ]) {
      expect(isDependencyOutage({ code })).toBe(true);
      expect(isDependencyOutage(new Error('query', { cause: { code } }))).toBe(
        true,
      );
    }
  });

  it('recognises the errors a Redis client raises while it has no connection', () => {
    expect(isDependencyOutage(new Error('Connection is closed.'))).toBe(true);
    expect(
      isDependencyOutage(
        new Error(
          "Stream isn't writeable and enableOfflineQueue options is false",
        ),
      ),
    ).toBe(true);
    const exhausted = new Error('Reached the max retries per request limit');
    exhausted.name = 'MaxRetriesPerRequestError';
    expect(isDependencyOutage(exhausted)).toBe(true);
  });

  it('recognises the errors pg raises for a connection that ended or timed out', () => {
    for (const message of [
      'Connection terminated unexpectedly',
      'Connection terminated due to connection timeout',
      'timeout exceeded when trying to connect',
      'Client has encountered a connection error and is not queryable',
    ]) {
      expect(isDependencyOutage(new Error(message))).toBe(true);
      expect(
        isDependencyOutage(new Error('query', { cause: new Error(message) })),
      ).toBe(true);
    }
    expect(isDependencyOutage(new Error('Some other timeout'))).toBe(false);
  });

  it('does not treat a SQLite constraint error or another Redis error as an outage', () => {
    expect(isDependencyOutage({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(
      false,
    );
    expect(isDependencyOutage(new Error('WRONGTYPE Operation'))).toBe(false);
  });

  it('does not treat a statement error or a plain bug as an outage', () => {
    expect(isDependencyOutage({ code: '42P01' })).toBe(false);
    expect(isDependencyOutage(new TypeError('x is not a function'))).toBe(
      false,
    );
    expect(isDependencyOutage(undefined)).toBe(false);
  });
});

describe('failure table', () => {
  it('has no two entries with the same message', () => {
    const messages = Object.values(FAILURES).map((entry) => entry.message);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('shows a templated name only when it is a safe token', () => {
    expect(new AppError('invalidField', 'page_size').message).toBe(
      "invalid value for 'page_size'",
    );
    expect(new AppError('invalidField', "x'; DROP").message).toBe(
      "invalid value for '?'",
    );
  });

  it('answers an unlisted status with the 400 or 500 entry', () => {
    expect(failureForStatus(418).message).toBe(FAILURES.invalidRequest.message);
    expect(failureForStatus(502).message).toBe(FAILURES.internal.message);
  });
});

describe('bounded', () => {
  it('rejects with the dependency name when the work does not answer in time', async () => {
    const never = new Promise<never>(() => undefined);
    await expect(bounded(never, 10, 'cache')).rejects.toThrow(
      'cache: no answer in 10ms',
    );
  });

  it('returns the result of work that answers in time', async () => {
    await expect(bounded(Promise.resolve(7), 50, 'cache')).resolves.toBe(7);
  });
});

describe('describeFailure', () => {
  it('withholds the message and the stack header of a connection-layer failure, keeping its class and code', () => {
    const cases: [string, string][] = [
      ['connect ECONNREFUSED 10.9.8.7:5432', 'ECONNREFUSED'],
      ['getaddrinfo ENOTFOUND canary-host.internal', 'ENOTFOUND'],
      ['password authentication failed for user "canary-user"', '28P01'],
      ['database "canary-db" does not exist', '3D000'],
      ['too many connections for role "canary-user"', '53300'],
      [
        "Hostname/IP does not match certificate's altnames: Host: canary-host. is not in the cert's altnames: DNS:canary-cert.internal",
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ],
      ['self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'],
      ['unable to open database file', 'SQLITE_CANTOPEN'],
    ];
    for (const [message, code] of cases) {
      const error = Object.assign(new Error(message), { code });

      const link = describeFailure(new Error('query failed', { cause: error }))
        .chain[1];

      expect(link?.code).toBe(code);
      expect(link?.name).toBe('Error');
      expect(link?.message).toBe('');
      expect(link?.stack).toContain('failure.test');
      expect(JSON.stringify(link)).not.toMatch(/canary|10\.9\.8\.7|5432/);
    }
  });

  it('withholds the message of any system error, which names its path, without calling it an outage', () => {
    const error = Object.assign(
      new Error("ENOENT: no such file or directory, open '/canary/path'"),
      { code: 'ENOENT', syscall: 'open', path: '/canary/path' },
    );

    const link = describeFailure(error).chain[0];

    expect(link?.code).toBe('ENOENT');
    expect(JSON.stringify(link)).not.toContain('canary');
    expect(isDependencyOutage(error)).toBe(false);
  });

  it('keeps the fixed message of a client that lost its connection', () => {
    const link = describeFailure(
      new Error('Connection terminated unexpectedly'),
    ).chain[0];

    expect(link?.message).toBe('Connection terminated unexpectedly');
  });

  it('describes a failed statement by its query and cause, never its bound values', () => {
    const failed = Object.assign(
      new Error('Failed query: select $1\nparams: SECRET-TOKEN-123'),
      { query: 'select $1', params: ['SECRET-TOKEN-123'] },
    );
    const error = Object.assign(failed, {
      cause: Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    });

    const failure = describeFailure(error);

    expect(JSON.stringify(failure)).not.toContain('SECRET-TOKEN-123');
    expect(failure.chain[0]?.message).toBe('Failed query: select $1');
    expect(failure.chain[1]?.code).toBe('ECONNREFUSED');
  });

  it('cuts the stack after the message, so a bound value that looks like a frame keeps no tail', () => {
    const message =
      'Failed query: select $1\nparams: x\n    at forged (SECRET-TAIL.js:1:1)\nSECRET-AFTER';
    const error = Object.assign(new Error(message), {
      query: 'select $1',
      params: ['x'],
    });

    const link = describeFailure(error).chain[0];

    expect(link?.stack).toContain('failure.test');
    expect(JSON.stringify(link)).not.toContain('SECRET');
  });

  it('keeps none of the text of a statement failure whose message changed after the stack was captured', () => {
    const error = Object.assign(new Error('before'), {
      query: 'select $1',
      params: ['x'],
    });
    error.message = 'params: SECRET-VALUE\n    at forged (SECRET.js:1:1)';

    const link = describeFailure(error).chain[0];

    // Depending on when the runtime formats the stack its header holds the old
    // or the new message; either way only frames may remain, and none of the text.
    expect(link?.stack === '' || link?.stack?.startsWith('    at ')).toBe(true);
    expect(JSON.stringify(link)).not.toContain('SECRET');
  });

  it('logs the code and drops the message of a data exception under a failed statement', () => {
    const cause = Object.assign(
      new Error('invalid input syntax for type integer: "SECRET-TOKEN-123"'),
      { code: '22P02' },
    );
    const error = Object.assign(new Error('Failed query: select $1'), {
      query: 'select $1',
      params: ['SECRET-TOKEN-123'],
      cause,
    });

    const failure = describeFailure(error);

    expect(failure.chain[1]?.code).toBe('22P02');
    expect(failure.chain[1]?.message).toBe('');
    expect(JSON.stringify(failure)).not.toContain('SECRET-TOKEN-123');
  });

  it('keeps the message of a data exception that has no failed statement above it, and of other codes under one', () => {
    const quoted = Object.assign(new Error('value out of range'), {
      code: '22003',
    });
    const constraint = Object.assign(
      new Error('duplicate key value violates unique constraint "users_pkey"'),
      { code: '23505' },
    );
    const statement = Object.assign(new Error('Failed query: select $1'), {
      query: 'select $1',
      params: [1],
      cause: constraint,
    });

    expect(describeFailure(quoted).chain[0]?.message).toBe(
      'value out of range',
    );
    expect(describeFailure(statement).chain[1]?.message).toBe(
      'duplicate key value violates unique constraint "users_pkey"',
    );
  });

  it('keeps the message of an error that has a query but no params', () => {
    const error = Object.assign(new Error('plain message'), { query: 'x' });

    expect(describeFailure(error).chain[0]?.message).toBe('plain message');
  });
});

describe('the classifier against the failure log', () => {
  it('answers a refused login, an unknown database and a TLS failure as an outage, and keeps them withheld', () => {
    for (const code of [
      '28P01',
      '28000',
      '3D000',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_SSL_WRONG_VERSION_NUMBER',
      'EPROTO',
    ]) {
      const error = Object.assign(new Error('names canary-host'), { code });

      expect(isDependencyOutage(new Error('query', { cause: error }))).toBe(
        true,
      );
      expect(describeFailure(error).chain[0]?.message).toBe('');
    }
  });

  it('answers a reply that ended the connection as an outage', () => {
    const error = Object.assign(new Error('terminating connection'), {
      code: '25P03',
      severity: 'FATAL',
    });

    expect(isDependencyOutage(error)).toBe(true);
  });

  it('answers the fixed errors of a client that cannot log in or is closed as an outage', () => {
    for (const message of [
      'The server does not support SSL connections',
      'There was an error establishing an SSL connection',
      'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string',
      'Cannot use a pool after calling end on the pool',
      'Query read timeout',
    ]) {
      expect(isDependencyOutage(new Error(message))).toBe(true);
    }
    for (const message of [
      'WRONGPASS invalid username-password pair',
      'NOAUTH Authentication required.',
      'LOADING Redis is loading the dataset in memory',
    ]) {
      const reply = new Error(message);
      reply.name = 'ReplyError';
      expect(isDependencyOutage(reply)).toBe(true);
    }
  });

  it('keeps a constraint violation, a syntax error, another reply and an application error as 500s, with their messages', () => {
    const cases: Error[] = [
      Object.assign(new Error('duplicate key'), { code: '23505' }),
      Object.assign(new Error('syntax error'), { code: '42601' }),
      Object.assign(new Error('WRONGTYPE Operation'), { name: 'ReplyError' }),
      new Error('the order is already paid'),
    ];
    for (const error of cases) {
      expect(isDependencyOutage(error)).toBe(false);
      expect(describeFailure(error).chain[0]?.message).toBe(error.message);
    }
  });

  it('logs the text of a bounded timeout, which is fixed and names the dependency', async () => {
    const error = await bounded(
      new Promise<never>(() => undefined),
      5,
      'postgres',
    ).catch((caught: unknown) => caught);

    const link = describeFailure(error).chain[0];

    expect(isDependencyOutage(error)).toBe(true);
    expect(link?.message).toBe('postgres: no answer in 5ms');
    expect(link?.code).toBe('ETIMEDOUT');
  });

  it('handles the late rejection of work a bound abandoned', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    let fail: (reason: Error) => void = () => undefined;
    const work = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });

    await bounded(work, 5, 'postgres').catch(() => undefined);
    fail(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', listener);

    expect(unhandled).toEqual([]);
  });
});
