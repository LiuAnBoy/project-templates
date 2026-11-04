/**
 * Tells a dependency being down apart from a fault in our own code.
 *
 * The difference is a 503 against a 500, and they say opposite things: 503
 * means "we are fine, something we need is not, come back", 500 means "we are
 * broken". A client should retry the first and report the second.
 *
 * The check is an allowlist of what only a broken connection produces,
 * wherever it hides in the cause chain: a network errno, a PostgreSQL SQLSTATE
 * of the connection classes, a SQLite code for a database that is busy, locked
 * or cannot be opened, or an error a Redis or PostgreSQL client raises while
 * it has no connection. Anything unrecognised is not an outage, so a new failure mode
 * arrives as a 500 that gets investigated.
 */
import { flattenCauses } from './failure.js';

/** Network-level failures: the far end was not reached or went away mid-conversation. */
const ERRNOS: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** SQLite result codes, with their extended forms, that mean the database is not usable now. */
const SQLITE_OUTAGE_PREFIXES = [
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_CANTOPEN',
] as const;

/** Messages a Redis client (ioredis) raises when it holds no connection and fails the command. */
const REDIS_OFFLINE_MESSAGES: ReadonlySet<string> = new Set([
  'Connection is closed.',
  "Stream isn't writeable and enableOfflineQueue options is false",
]);

/**
 * Messages `pg` raises for a connection that ended or never came up. They carry
 * no code, errno or cause, so they are recognised by their fixed text.
 */
const PG_CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error and is not queryable',
]);

/** The class name ioredis gives the error of a command that outlived its retries. */
const REDIS_RETRIES_EXHAUSTED = 'MaxRetriesPerRequestError';

/**
 * PostgreSQL states that mean the connection, not the statement.
 *
 * `08` is the connection exception class, `57P0` the server going away
 * (shutdown, crash, recovery), `53300` a full connection limit.
 *
 * @param state - A SQLSTATE.
 * @returns Whether it names a connection problem.
 */
function isConnectionSqlState(state: string): boolean {
  return (
    state.startsWith('08') || state.startsWith('57P0') || state === '53300'
  );
}

/**
 * Whether a string `code` names a SQLite database that is busy, locked or cannot be opened.
 *
 * @param code - A driver's `code`.
 * @returns True for `SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_CANTOPEN` and their extended codes.
 */
function isSqliteOutage(code: string): boolean {
  return SQLITE_OUTAGE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

/**
 * Whether an error is a client failing because it has no connection: ioredis
 * with no connection, or `pg` whose connection ended or timed out.
 *
 * These errors carry no errno or code, so they are recognised by their fixed
 * message or class name.
 *
 * @param value - One error in the chain.
 * @returns True for the offline errors of ioredis and the connection errors of pg.
 */
function isClientOffline(value: object): boolean {
  let name: unknown;
  let message: unknown;
  try {
    name = (value as Record<string, unknown>)['name'];
    message = (value as Record<string, unknown>)['message'];
  } catch {
    return false;
  }
  return (
    name === REDIS_RETRIES_EXHAUSTED ||
    (typeof message === 'string' &&
      (REDIS_OFFLINE_MESSAGES.has(message) ||
        PG_CONNECTION_MESSAGES.has(message)))
  );
}

/**
 * Decides whether one link of the chain is a connection failure.
 *
 * @param value - One error in the chain.
 * @returns Whether this link says the dependency is unreachable.
 */
function linkIsOutage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  for (const key of ['code', 'sqlState']) {
    let code: unknown;
    try {
      code = (value as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (
      typeof code === 'string' &&
      (ERRNOS.has(code) || isConnectionSqlState(code) || isSqliteOutage(code))
    )
      return true;
  }
  return isClientOffline(value);
}

/**
 * Whether a thrown value means a dependency is unreachable.
 *
 * @param error - Whatever was thrown.
 * @returns True when any link of its cause chain is a connection failure.
 */
export function isDependencyOutage(error: unknown): boolean {
  return flattenCauses(error).some(({ error: link }) => linkIsOutage(link));
}
