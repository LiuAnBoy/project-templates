import { FixedTextError } from '../common/errors/fixed-text-error.js';

/** What every use of a transaction handle after its `run` ended fails with. */
export const TRANSACTION_ENDED_MESSAGE =
  'the transaction has ended; use a transaction handle only inside its transactions.run';

/**
 * A transaction handle was used after its `run` ended. It is a bug in the code that
 * kept the handle, so it answers 500: its code is on no outage list.
 */
export class TransactionEndedError extends FixedTextError {
  constructor() {
    super(TRANSACTION_ENDED_MESSAGE, 'ERR_TRANSACTION_ENDED');
    this.name = 'TransactionEndedError';
  }
}

/** The life of one transaction's handle; see `createTransactionEnd`. */
export type TransactionEnd = {
  /**
   * Runs the unit of work, and ends the handle the moment it settles, before the
   * commit or the rollback starts, so nothing it left running can slip in between.
   *
   * @param work - The unit of work.
   * @returns What it returned.
   */
  during<T>(work: () => Promise<T>): Promise<T>;
  /** Closes the last gap: the runner's own commit or rollback has finished. */
  finish(): void;
  /**
   * @param statement - The text about to run, when the caller knows it.
   * @throws TransactionEndedError once the handle has ended; only the runner's own
   *   `commit` or `rollback` passes until `finish`.
   */
  check(statement?: string): void;
  /**
   * Wraps the object the callback receives, so that any use of it throws once the
   * handle has ended. `then` and symbols stay readable: a promise resolving with the
   * handle and a logger printing it are not uses of it.
   *
   * @param target - The driver's or the ORM's handle.
   * @returns The wrapped handle.
   */
  handle<T extends object>(target: T): T;
};

/**
 * Builds the state every store's `transactions.run` ends a handle through.
 *
 * A query builder, a prepared statement and the raw client all outlive the callback
 * that made them, and a pooled connection goes on to serve someone else, so wrapping
 * the handle is not enough. A store therefore also gives its ORM a client that calls
 * `check` before every statement, and calls `during` around the work and `finish` when
 * the transaction has ended. That costs one check per statement, about 2 microseconds
 * through SQLite's wrapper and not measurable on a network store, and one ORM client per
 * transaction, which reads the schema: about 75 microseconds for 100 tables.
 *
 * @returns The state of one transaction.
 */
export function createTransactionEnd(): TransactionEnd {
  let state: 'open' | 'ending' | 'ended' = 'open';

  const refuseUnlessOpen = (statement?: string): void => {
    if (state === 'open') return;
    if (
      state === 'ending' &&
      (statement === 'commit' || statement === 'rollback')
    )
      return;
    throw new TransactionEndedError();
  };

  return {
    during: async (work) => {
      try {
        return await work();
      } finally {
        state = 'ending';
      }
    },
    finish: () => {
      state = 'ended';
    },
    check: refuseUnlessOpen,
    handle: (target) =>
      new Proxy(target, {
        get: (object, key, receiver) => {
          if (state === 'open' || typeof key === 'symbol')
            return Reflect.get(object, key, receiver) as unknown;
          if (key === 'then') return undefined;
          throw new TransactionEndedError();
        },
      }),
  };
}
