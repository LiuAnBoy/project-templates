/** The hosts a store test may run against: the machine itself. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
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
 *   overrides the host in its query.
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
  // The driver takes the server from `?host=` or `?hostaddr=` ahead of the
  // authority, so a URL naming localhost can still point somewhere else.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) {
    throw new Error(
      `${name} sets host or hostaddr in its query; the integration tests only run against this machine`,
    );
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `${name} names a host that is not local; the integration tests only run against this machine`,
    );
  }
  return value;
}
