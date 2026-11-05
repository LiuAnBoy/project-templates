import { FixedTextError } from '../errors/fixed-text-error.js';

/**
 * Rejects if something has not answered in time.
 *
 * Clients of a dead dependency usually wait instead of failing: a connection
 * pool waits for a slot, a Redis client queues commands while it reconnects.
 * Without a bound a broken dependency produces a request that never finishes,
 * which reads as "still working" and leaves nothing in the log. Wrap every
 * dependency call on the request path.
 *
 * The bound ends the caller's wait and nothing else: a promise cannot be cancelled,
 * so the work keeps running, and keeps the connection it holds, until the driver
 * gives up. Its late rejection is handled here and goes nowhere.
 *
 * @param work - The operation to bound.
 * @param ms - How long it has.
 * @param what - Named in the error, so the log says which dependency it was.
 * @returns The operation's result.
 * @throws FixedTextError with code `ETIMEDOUT` when it has not answered within the
 *   deadline; `isDependencyOutage` reads that code, so the answer is a 503.
 */
export async function bounded<T>(
  work: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new FixedTextError(`${what}: no answer in ${ms}ms`, 'ETIMEDOUT'),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
