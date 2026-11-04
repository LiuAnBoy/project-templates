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
 * @throws Error when the variable is missing, is not a URL, or names a host that is not local.
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
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `${name} names a host that is not local; the integration tests only run against this machine`,
    );
  }
  return value;
}
