/**
 * Walks everything an error hides underneath itself.
 *
 * Shared by the two readers of a thrown value: `describeFailure`, which makes it
 * printable, and `isDependencyOutage`, which classifies it. Neither reads a
 * property of a thrown value without `read`, because a getter can throw.
 */

/** How far to follow a chain: deep enough for real failures, shallow enough to survive a cycle. */
const MAX_DEPTH = 6;

/** One error found in a chain, and how it was reached. */
export type Flattened = { error: unknown; sibling: boolean };

/**
 * Reads a property without letting it throw.
 *
 * Anything can be thrown, including an object whose `message` is a getter that
 * fails. This runs inside the error handler, where a second error means the
 * response is never sent.
 *
 * @param value - The object to read from.
 * @param key - Which property.
 * @returns The value, or undefined when reading failed.
 */
export function read(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Flattens everything an error hides underneath itself.
 *
 * Follows `cause` and the entries of an `AggregateError`. The order is
 * outermost first, so the last element is the innermost thing that went wrong.
 *
 * @param error - Whatever was thrown.
 * @param depth - Internal; how far down this call already is.
 * @returns The error and everything under it.
 */
export function flattenCauses(error: unknown, depth = 0): Flattened[] {
  if (error === null || error === undefined) return [];
  if (depth > MAX_DEPTH || typeof error !== 'object')
    return [{ error, sibling: false }];

  const under: { value: unknown; sibling: boolean }[] = [
    { value: read(error, 'cause'), sibling: false },
  ];
  const entries = read(error, 'errors');
  if (Array.isArray(entries)) {
    under.push(
      ...(entries as unknown[]).map((value) => ({ value, sibling: true })),
    );
  }

  return [
    { error, sibling: false },
    ...under
      .filter(({ value }) => value !== undefined && value !== null)
      .flatMap(({ value, sibling }) =>
        flattenCauses(value, depth + 1).map((found) => ({
          ...found,
          sibling: found.sibling || sibling,
        })),
      ),
  ];
}
