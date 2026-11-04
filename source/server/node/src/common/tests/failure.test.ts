import { describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../errors/dependency-failure.js';
import { AppError } from '../errors/app-error.js';
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
