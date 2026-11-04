/**
 * Rejects if something has not answered in time.
 *
 * Clients of a dead dependency usually wait instead of failing: a connection
 * pool waits for a slot, a Redis client queues commands while it reconnects.
 * Without a bound a broken dependency produces a request that never finishes,
 * which reads as "still working" and leaves nothing in the log. Wrap every
 * dependency call on the request path.
 *
 * @param work - The operation to bound.
 * @param ms - How long it has.
 * @param what - Named in the error, so the log says which dependency it was.
 * @returns The operation's result.
 * @throws Error with code `ETIMEDOUT` when it has not answered within the
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
              Object.assign(new Error(`${what}: no answer in ${ms}ms`), {
                code: 'ETIMEDOUT',
              }),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
