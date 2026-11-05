/** The hosts a store test may run against: the machine itself. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

/**
 * The query keys a test URL may carry: the charset, and the TLS settings of the
 * drivers (`sslmode` of `pg`, `ssl` of `mysql2`). Every other key is refused,
 * because a driver can take its server from one of them: `pg` from `host` and
 * `hostaddr`, `mysql2` from `socketPath` (reproduced against a real server;
 * `mysql2` ignores `host` and `unix_socket` and says so, but a driver that
 * honours them is one upgrade away).
 */
const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'charset',
  'sslmode',
  'ssl',
]);

/**
 * Reads a test connection URL from the environment and refuses to hand out one
 * that points off this machine, so a test that creates and drops things can
 * never touch a shared server.
 *
 * Integration tests fail rather than skip when the variable is missing: a run
 * that skipped its store tests would read as a pass.
 *
 * @param name - The variable to read, e.g. `TEST_DATABASE_URL`.
 * @param env - The environment to read; defaults to `process.env`.
 * @returns The URL.
 * @throws Error when the variable is missing, is not a URL, names a host that is not local, or
 *   carries a query key outside `charset`, `sslmode` and `ssl`.
 */
export function requireLocalUrl(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is required: copy .env.example to .env and start the services before running the integration tests`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  // A driver can take the server from the query ahead of the authority (`?host=`,
  // `?hostaddr=`, `?socketPath=`), so a URL naming localhost can still point
  // somewhere else. Only the keys known to be harmless pass.
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new Error(
        `${name} sets a query key outside charset, sslmode and ssl; the integration tests only run against this machine`,
      );
    }
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `${name} names a host that is not local; the integration tests only run against this machine`,
    );
  }
  return value;
}
