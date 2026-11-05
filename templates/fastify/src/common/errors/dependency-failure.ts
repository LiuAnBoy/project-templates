/**
 * Tells a dependency that cannot be used apart from a fault in our own code.
 *
 * The difference is a 503 against a 500, and they say opposite things: 503
 * means "we are fine, something we need is not, come back", 500 means "we are
 * broken". A client should retry the first and report the second.
 *
 * The check is an allowlist of what only the connection layer produces, wherever
 * it hides in the cause chain: a network errno, a PostgreSQL SQLSTATE of the
 * connection classes, a refused login or database, a TLS failure, a `FATAL` reply
 * of the server, a SQLite code for a database that is busy, locked or cannot be
 * opened, an error a MySQL, Redis or PostgreSQL client raises while it has no usable
 * connection, or a `mysql2` code of a login, a database or a TLS handshake it refused. A wrong password is on the list because the answer to a client is the
 * same as for a server that is down: this request cannot be served and nothing about
 * it is wrong. A constraint violation, a syntax error and anything unrecognised
 * are not on the list, so a new failure mode arrives as a 500 that gets investigated.
 *
 * The codes also decide which messages the log withholds (`isConnectionLayerFailure`).
 * The fixed messages of `pg`, `mysql2` and ioredis count as an outage and stay readable.
 */
import { flattenCauses, read } from './cause-chain.js';

/** Network-level failures: the far end was not reached or went away mid-conversation. */
const ERRNOS: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTDOWN',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPROTO',
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
 * Messages `mysql2` raises for a pool that cannot serve a call or a connection that
 * ended, with no code. `Pool is closed.`, `Queue limit reached.` and
 * `No connections available.` are read from its pool, and the last one was
 * reproduced by killing a connection a caller still held.
 */
const MYSQL_CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
  'Pool is closed.',
  'Queue limit reached.',
  'No connections available.',
  "Can't add new command when connection is in closed state",
]);

/**
 * `mysql2` codes of a connection that was lost or timed out: their messages are fixed
 * text and stay readable. A server out of connections (`ER_CON_COUNT_ERROR`) needs no
 * entry, since its SQLSTATE `08004` is of the connection class.
 */
const MYSQL_OFFLINE_CODES: ReadonlySet<string> = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
]);

/**
 * `mysql2` codes of a connection the server or the TLS layer refused, whose SQLSTATE
 * is not of the classes above. Their messages name the user, the host or the database
 * (`Access denied for user ... to database ...`), so the log withholds them. A refused
 * login (`ER_ACCESS_DENIED_ERROR`, SQLSTATE `28000`) is already of class `28`.
 * `ER_BAD_DB_ERROR` needs a user with rights on every database and was reproduced as
 * root, since the application's own user gets `ER_DBACCESS_DENIED_ERROR` instead.
 * The rest refuse a login for its host, its account or its limits; they carry the
 * SQLSTATE `HY000` or `42000` and need a server set up to refuse, so they are held to
 * this list by a test of the classifier, not by a live refusal.
 */
const MYSQL_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'ER_DBACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_HOST_NOT_PRIVILEGED',
  'ER_HOST_IS_BLOCKED',
  'ER_ACCOUNT_HAS_BEEN_LOCKED',
  'ER_USER_LIMIT_REACHED',
  'ER_TOO_MANY_USER_CONNECTIONS',
  'ER_MUST_CHANGE_PASSWORD_LOGIN',
  'ER_SERVER_OFFLINE_MODE',
  'HANDSHAKE_SSL_ERROR',
]);

/** The first word of a Redis reply that says the connection is not usable: not logged in, or still loading. */
const REDIS_UNUSABLE_REPLY = /^(NOAUTH|WRONGPASS|LOADING)\b/;

/**
 * Messages `pg` raises for a connection that ended or never came up. They carry
 * no code, errno or cause, so they are recognised by their fixed text.
 */
const PG_CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
  'Connection terminated',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout expired',
  'timeout exceeded when trying to connect',
  'Query read timeout',
  'Client has encountered a connection error and is not queryable',
  'Client was closed and is not queryable',
  'Cannot use a pool after calling end on the pool',
  'The server does not support SSL connections',
  'There was an error establishing an SSL connection',
]);

/** Every failure of `pg`'s login exchange starts with this; a password that is missing is one. */
const PG_LOGIN_MESSAGE = /^SASL: /;

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
 * Whether an error is a client failing because it has no usable connection:
 * ioredis with no connection or refused by the server, `pg` whose connection
 * ended, timed out or could not log in, or `mysql2` whose pool or connection ended.
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
  if (name === REDIS_RETRIES_EXHAUSTED) return true;
  if (typeof message !== 'string') return false;
  return (
    REDIS_OFFLINE_MESSAGES.has(message) ||
    PG_CONNECTION_MESSAGES.has(message) ||
    MYSQL_CONNECTION_MESSAGES.has(message) ||
    PG_LOGIN_MESSAGE.test(message) ||
    (name === 'ReplyError' && REDIS_UNUSABLE_REPLY.test(message))
  );
}

/** The codes of a failed TLS handshake or certificate check, from Node and from OpenSSL. */
const TLS_CODE =
  /^(ERR_TLS_|ERR_SSL_|ERR_OSSL_|CERT_|UNABLE_TO_|HOSTNAME_MISMATCH$|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$)/;

/**
 * PostgreSQL states of a connection the server refused for who or what it asked
 * for: `28` is invalid authorization, `3D000` an unknown database.
 *
 * @param state - A SQLSTATE.
 * @returns Whether it names a refused login or database.
 */
function isRefusedConnectionSqlState(state: string): boolean {
  return state.startsWith('28') || state === '3D000';
}

/**
 * Reads the string `code` and `sqlState` of one link.
 *
 * @param value - One error in the chain.
 * @returns The codes it carries.
 */
function codesOf(value: object): string[] {
  return ['code', 'sqlState']
    .map((key) => read(value, key))
    .filter((code): code is string => typeof code === 'string');
}

/**
 * Whether one link failed in the connection layer, which is where a message
 * names the host, the port, the user or the database.
 *
 * Decided by code only: the fixed messages that `pg` and ioredis raise for a
 * connection that ended carry nothing and stay readable.
 *
 * @param value - One error in the chain.
 * @returns True for a network errno, a connection-class SQLSTATE, a refused login
 *   or database, any `FATAL` reply of a PostgreSQL server (it ends the connection
 *   before a statement ran), a SQLite open or lock failure, a TLS failure and a
 *   `mysql2` refusal.
 */
export function isConnectionLayerFailure(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const severity = read(value, 'severity');
  return (
    severity === 'FATAL' ||
    severity === 'PANIC' ||
    codesOf(value).some(
      (code) =>
        ERRNOS.has(code) ||
        isConnectionSqlState(code) ||
        isRefusedConnectionSqlState(code) ||
        isSqliteOutage(code) ||
        MYSQL_REFUSAL_CODES.has(code) ||
        TLS_CODE.test(code),
    )
  );
}

/**
 * Decides whether one link of the chain says the dependency cannot be used.
 *
 * @param value - One error in the chain.
 * @returns True for a connection-layer failure and for a client with no usable connection.
 */
function linkIsOutage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (
    isConnectionLayerFailure(value) ||
    isClientOffline(value) ||
    codesOf(value).some((code) => MYSQL_OFFLINE_CODES.has(code))
  );
}

/**
 * Whether a thrown value means a dependency cannot be used.
 *
 * @param error - Whatever was thrown.
 * @returns True when any link of its cause chain is a connection failure.
 */
export function isDependencyOutage(error: unknown): boolean {
  return flattenCauses(error).some(({ error: link }) => linkIsOutage(link));
}
