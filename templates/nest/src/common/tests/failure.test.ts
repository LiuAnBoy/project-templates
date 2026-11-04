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
    expect(isDependencyOutage(new Error('Query read timeout'))).toBe(false);
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

  it('keeps the message of an error that has a query but no params', () => {
    const error = Object.assign(new Error('plain message'), { query: 'x' });

    expect(describeFailure(error).chain[0]?.message).toBe('plain message');
  });
});
