import { AsyncLocalStorage } from 'node:async_hooks';

/** One open transaction, as the code running inside it sees it. */
type Scope = { live: boolean };

/** Refuses a `transactions.run` from inside an open one; see `createNestingGuard`. */
export type NestingGuard = {
  /**
   * Runs one transaction's whole life inside a scope.
   *
   * @param transaction - Opens, runs and ends the transaction.
   * @returns What it returned.
   * @throws Error, before anything runs, when called from inside a live scope.
   */
  enter<T>(transaction: () => Promise<T>): Promise<T>;
};

/**
 * Builds the guard every store's `transactions.run` goes through.
 *
 * A nested `run` would wait for a lock or a connection its own caller holds, so it
 * is refused at once. The refusal lasts exactly as long as the transaction: async
 * context is inherited by whatever the callback starts, a timer or a promise it does
 * not await included, and that work can outlive the transaction. So the context
 * carries a flag that the transaction clears when it has committed or rolled back,
 * and a late `run` from such work opens a transaction of its own. Work started
 * inside and running while the transaction is still open is refused like any nested
 * call, because it would deadlock the same way on a row the transaction holds.
 *
 * @param store - The store's name, for the error.
 * @param handle - What the caller should pass down instead, for the error.
 * @returns The guard.
 */
export function createNestingGuard(
  store: string,
  handle: string,
): NestingGuard {
  const scopes = new AsyncLocalStorage<Scope>();
  return {
    enter: async (transaction) => {
      if (scopes.getStore()?.live) {
        throw new Error(
          `${store}: transactions.run was called inside a transaction; pass the ${handle} down instead`,
        );
      }
      const scope: Scope = { live: true };
      try {
        return await scopes.run(scope, transaction);
      } finally {
        scope.live = false;
      }
    },
  };
}
