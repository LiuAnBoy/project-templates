/**
 * The one rule of how `DATABASE_URL` may ask for TLS on MySQL, shared by the server's
 * settings and the scripts. It lives here because the scripts run without the build,
 * and `src/db/database.ts` reads it through `database-url.d.mts`.
 */

/** What a script prints for a setting that breaks the rule, as the server does. */
export const INVALID_DATABASE_URL = 'invalid configuration: DATABASE_URL';

/**
 * Whether a URL asks for TLS with `sslmode`, which `mysql2` ignores, so the connection
 * would stay in plain text (`docs/rules/mysql.md`).
 *
 * @param {string} url The raw setting.
 * @returns {boolean} True when it carries the key; false also for a URL that cannot be read.
 */
export function asksForIgnoredTls(url) {
  try {
    return new URL(url).searchParams.has('sslmode');
  } catch {
    return false;
  }
}
