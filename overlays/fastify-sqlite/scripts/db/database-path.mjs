/**
 * The one rule of what `DATABASE_URL` may hold on SQLite, shared by the server's
 * settings and the migration scripts. It lives here because the scripts run without
 * the build, and `src/db/database.ts` reads it through `database-path.d.mts`.
 */

/** What a migration script prints for a setting that breaks the rule, as the server does. */
export const INVALID_DATABASE_PATH = 'invalid configuration: DATABASE_URL';

/**
 * Refuses what is not the path of a file: `:memory:`, which the store's two connections
 * cannot share, and a URI, which is not how this setting names a file.
 *
 * @param {string} value The raw setting.
 * @returns {boolean} True for a path.
 */
export function isDatabasePath(value) {
  return !(
    value.startsWith(':') ||
    value.startsWith('file:') ||
    value.includes('://')
  );
}
