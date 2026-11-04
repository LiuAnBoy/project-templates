/**
 * Tells a dependency being down apart from a fault in our own code.
 *
 * The difference is a 503 against a 500, and they say opposite things: 503
 * means "we are fine, something we need is not, come back", 500 means "we are
 * broken". A client should retry the first and report the second.
 *
 * The check is an allowlist of the two things only a broken connection
 * produces, wherever they hide in the cause chain: a network errno, or a
 * PostgreSQL SQLSTATE of the connection classes. Anything unrecognised is not
 * an outage, so a new failure mode arrives as a 500 that gets investigated.
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
      (ERRNOS.has(code) || isConnectionSqlState(code))
    )
      return true;
  }
  return false;
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
