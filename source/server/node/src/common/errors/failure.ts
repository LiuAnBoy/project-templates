/**
 * Turns a thrown value into something a person can read when debugging.
 *
 * The useful part of a failure is rarely on the object that was thrown: a
 * driver error hides the network error under `cause`, and a failed transaction
 * can arrive as an `AggregateError` whose own message is empty. The chain is
 * flattened, every link is described, and the last link is the root cause.
 *
 * What a person needs is the class and the code; the message is the part that
 * can hold a secret. The message of a failed statement is replaced by the
 * statement without its bound values, the message of a data exception by
 * nothing, and the message of every failure of the connection layer (a refused
 * or dropped connection, a name that does not resolve, a rejected login or
 * database, a TLS failure) by nothing, because it names the host, the port, the
 * user or the database. So does a system error of any other kind, which names the
 * file or the address it tried. A withheld link keeps its class, its code and its
 * frames. A `FixedTextError` keeps its message: we wrote it, and it holds no value.
 */
import { flattenCauses, read, type Flattened } from './cause-chain.js';
import { isConnectionLayerFailure } from './dependency-failure.js';
import { FixedTextError } from './fixed-text-error.js';

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
 * Names an error's class without trusting the prototype chain to cooperate.
 *
 * @param value - The error.
 * @returns Its class name, or a stand-in.
 */
export function nameOf(value: object): string {
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
export function framesOf(stack: string, message: string): string {
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
 * Codes `mysql2` gives a failed statement (`ER_DUP_ENTRY`, `ER_TRUNCATED_WRONG_VALUE`).
 * Their SQLSTATE cannot tell which quote a value, since `ER_TRUNCATED_WRONG_VALUE_FOR_FIELD`
 * is `HY000` and quotes it, so the code prefix decides.
 */
const MYSQL_STATEMENT_CODE = /^ER_/;

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
  if (error instanceof FixedTextError) {
    // Text we wrote and fixed: it names the dependency and carries no value.
  } else if (
    isConnectionLayerFailure(error) ||
    typeof read(error, 'syscall') === 'string'
  ) {
    // The message of a connection-layer failure names the host and port it
    // tried, the user it logged in as or the database it asked for, a TLS failure
    // quotes the certificate's names, and a system error names its path. The class
    // and the code say what went wrong.
    link.message = '';
    if (stack !== undefined) link.stack = framesOf(stack, message);
  } else if (query !== undefined && isStatementFailure(error)) {
    // A failed statement of a query builder: its message and stack carry the
    // bound values, which can be tokens or personal data. The statement and the
    // cause underneath say what went wrong.
    link.message = `Failed query: ${query}`;
    if (stack !== undefined) link.stack = framesOf(stack, message);
  } else if (
    underStatement &&
    code !== undefined &&
    (DATA_EXCEPTION.test(code) || MYSQL_STATEMENT_CODE.test(code))
  ) {
    // The driver's cause of a statement that sent a value of the wrong shape
    // (SQLSTATE 22P02 and its class, or a `mysql2` `ER_*` code, whose message
    // quotes a duplicate key or a rejected value) quotes that value in its
    // message. The code says what went wrong.
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
