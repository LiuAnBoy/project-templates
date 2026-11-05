import { describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import {
  createTransactionEnd,
  TRANSACTION_ENDED_MESSAGE,
  TransactionEndedError,
} from '../transaction-end.js';

describe('createTransactionEnd', () => {
  it('lets everything through while the work runs', async () => {
    const end = createTransactionEnd();

    await end.during(() => {
      expect(() => end.check('select 1')).not.toThrow();
      return Promise.resolve();
    });
  });

  it('lets only the commit or the rollback through once the work has settled, and nothing after finish', async () => {
    const end = createTransactionEnd();

    await end.during(() => Promise.resolve());

    expect(() => end.check('commit')).not.toThrow();
    expect(() => end.check('rollback')).not.toThrow();
    expect(() => end.check('select 1')).toThrow(TransactionEndedError);
    expect(() => end.check()).toThrow(TransactionEndedError);

    end.finish();

    expect(() => end.check('commit')).toThrow(TRANSACTION_ENDED_MESSAGE);
  });

  it('ends the handle when the work throws too', async () => {
    const end = createTransactionEnd();

    await end
      .during(() => Promise.reject(new Error('boom')))
      .catch(() => undefined);

    expect(() => end.check('select 1')).toThrow(TransactionEndedError);
  });

  it('wraps a handle that refuses every use and can still be awaited or printed', async () => {
    const end = createTransactionEnd();
    const handle = end.handle({ value: 1 });

    expect(handle.value).toBe(1);
    await end.during(() => Promise.resolve());

    expect(() => handle.value).toThrow(TransactionEndedError);
    expect(await Promise.resolve(handle)).toBe(handle);
    expect(String(Object.prototype.toString.call(handle))).toContain('Object');
  });

  it('is a failure of the code, not an outage', () => {
    expect(isDependencyOutage(new TransactionEndedError())).toBe(false);
  });
});
