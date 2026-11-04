/**
 * Turns a thrown value into something a person can read when debugging.
 *
 * The useful part of a failure is rarely on the object that was thrown: a
 * driver error hides the network error under `cause`, and a failed transaction
 * can arrive as an `AggregateError` whose own message is empty. The chain is
 * flattened, every link is described, and the last link is the root cause.
 */

/** One link in a chain of causes. */
export type FailureLink = {
  /** The error's class name, when it has one. */
  name: string;
  message: string;
  /** A Node errno, a SQLSTATE or any other string `code` the error carries. */
  code?: string;
  stack?: string;
  /**
   * True when this link is one entry of an `AggregateError`. Entries are
   * separate failures that happened together, not causes of each other.
   */
  sibling?: boolean;
};

/** A failure described from the outside in; the last entry is the root cause. */
export type Failure = { chain: FailureLink[] };

/** One error found in a chain, and how it was reached. */
export type Flattened = { error: unknown; sibling: boolean };

/** How far to follow a chain: deep enough for real failures, shallow enough to survive a cycle. */
const MAX_DEPTH = 6;

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
function read(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Reads a non-empty string field off anything.
 *
 * @param value - The candidate.
 * @param key - Field to read.
 * @returns The value when it is a non-empty string.
 */
function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = read(value, key);
  return typeof found === 'string' && found.length > 0 ? found : undefined;
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

/**
 * Names an error's class without trusting the prototype chain to cooperate.
 *
 * @param value - The error.
 * @returns Its class name, or a stand-in.
 */
function nameOf(value: object): string {
  try {
    return (
      (value as { constructor?: { name?: string } }).constructor?.name ??
      'Object'
    );
  } catch {
    return 'Object';
  }
}

/**
 * Keeps only the call frames of a stack, dropping the message lines before them.
 *
 * The cut is made after the error's own message, not at the first line that
 * looks like a frame: a message holding bound values can hold such a line, and
 * cutting at it would keep the rest of the value. A stack whose header does not
 * contain the message (the message was changed after the stack was captured)
 * keeps no frames, because where its header ends is not known.
 *
 * @param stack - A stack string whose first lines are the error's message.
 * @param message - The message the error had when it was thrown.
 * @returns The frames, or an empty string when there are none.
 */
function framesOf(stack: string, message: string): string {
  const at = stack.indexOf(message);
  if (at === -1) return '';
  const rest = stack.slice(at + message.length);
  const start = rest.search(/\n\s+at /);
  return start === -1 ? '' : rest.slice(start + 1);
}

/**
 * Whether an error is a failed statement of a query builder: it carries the
 * statement and its bound values.
 *
 * @param error - One error in the chain.
 * @returns True when it has a non-empty `query` string and a `params` array.
 */
function isStatementFailure(error: unknown): boolean {
  return (
    stringField(error, 'query') !== undefined &&
    Array.isArray(read(error as object, 'params'))
  );
}

/** SQLSTATE class 22, data exceptions: the driver's message quotes the offending value. */
const DATA_EXCEPTION = /^22/;

/**
 * Describes one link of a chain.
 *
 * @param link - One error in the chain.
 * @param underStatement - Whether a failed statement sits above this link, whose
 *   bound values a data-exception message of the driver would quote.
 * @returns What is worth printing about it.
 */
function describe(
  { error, sibling }: Flattened,
  underStatement: boolean,
): FailureLink {
  if (typeof error !== 'object' || error === null) {
    return {
      name: typeof error,
      message: String(error),
      ...(sibling ? { sibling } : {}),
    };
  }
  const message = stringField(error, 'message') ?? '';
  const link: FailureLink = { name: nameOf(error), message };
  const code = stringField(error, 'code') ?? stringField(error, 'sqlState');
  if (code !== undefined) link.code = code;
  const stack = stringField(error, 'stack');
  if (stack !== undefined) link.stack = stack;
  const query = stringField(error, 'query');
  if (query !== undefined && isStatementFailure(error)) {
    // A failed statement of a query builder: its message and stack carry the
    // bound values, which can be tokens or personal data. The statement and the
    // cause underneath say what went wrong.
    link.message = `Failed query: ${query}`;
    if (stack !== undefined) link.stack = framesOf(stack, message);
  } else if (
    underStatement &&
    code !== undefined &&
    DATA_EXCEPTION.test(code)
  ) {
    // The driver's cause of a statement that sent a value of the wrong shape
    // (SQLSTATE 22P02 and its class) quotes that value in its message. The code
    // says what went wrong.
    link.message = '';
    if (stack !== undefined) link.stack = framesOf(stack, message);
  }
  if (sibling) link.sibling = true;
  return link;
}

/**
 * Describes a failure and everything underneath it.
 *
 * @param error - Whatever was thrown.
 * @returns The chain, outermost first.
 */
export function describeFailure(error: unknown): Failure {
  let underStatement = false;
  const chain = flattenCauses(error).map((found) => {
    const link = describe(found, underStatement);
    if (isStatementFailure(found.error)) underStatement = true;
    return link;
  });
  return {
    chain:
      chain.length > 0 ? chain : [describe({ error, sibling: false }, false)],
  };
}
