/**
 * Dependency checks: what the health route and the startup gate ask of the
 * things the process cannot run without (a database, a cache).
 *
 * The base ships none, so a project with no store starts and answers as it
 * always has. A data overlay hands its checks in through the `src/infra/` seam.
 * Every check runs under `bounded()`, so a dependency that hangs fails the
 * check instead of the caller, and no failure ever carries the dependency's own
 * error text further than the log: the answer names a check, never a value.
 */
import { bounded } from './concurrency/bounded.js';

/** One thing the process depends on. */
export type DependencyCheck = {
  /** Stable name, e.g. `postgres`; the only thing a log line or an exit message says. */
  name: string;
  /** Resolves when the dependency answers; rejects when it does not. */
  run: () => Promise<unknown>;
};

/** How long one check has to answer, in milliseconds. */
export const CHECK_TIMEOUT_MS = 2000;

/** How long the health route reuses one result, failure included, in milliseconds. */
export const HEALTH_CACHE_MS = 1000;

/**
 * Runs every check once, each under `bounded()`, all at the same time.
 *
 * @param checks - The checks to run.
 * @param timeoutMs - The deadline of each.
 * @returns The names of the checks that failed or did not answer; never rejects.
 */
async function failedChecks(
  checks: readonly DependencyCheck[],
  timeoutMs: number,
): Promise<string[]> {
  const outcomes = await Promise.all(
    checks.map(async (check) => {
      try {
        await bounded(
          Promise.resolve().then(() => check.run()),
          timeoutMs,
          check.name,
        );
        return undefined;
      } catch {
        return check.name;
      }
    }),
  );
  return outcomes.filter((name): name is string => name !== undefined);
}

/** Thrown by `runStartupChecks`; its message names the failed checks and nothing else. */
export class StartupCheckError extends Error {
  /**
   * @param names - The names of the checks that failed.
   */
  constructor(readonly names: readonly string[]) {
    super(`dependency check failed: ${names.join(', ')}`);
    this.name = 'StartupCheckError';
  }
}

/**
 * The gate before the server listens: every check must pass.
 *
 * The error is built from the names alone, because a driver's error text can
 * carry the host, the path or the URL, and this message reaches the console.
 *
 * @param checks - The checks to run.
 * @param options - `timeoutMs` overrides the deadline of each check.
 * @returns Resolves when every check passed.
 * @throws StartupCheckError naming each check that failed or timed out.
 */
export async function runStartupChecks(
  checks: readonly DependencyCheck[],
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const failed = await failedChecks(
    checks,
    options.timeoutMs ?? CHECK_TIMEOUT_MS,
  );
  if (failed.length > 0) throw new StartupCheckError(failed);
}

/** Answers whether every dependency is up; see `createHealthProbe`. */
export type HealthProbe = () => Promise<boolean>;

/** Settings of `createHealthProbe`. */
export type HealthProbeOptions = {
  /** The deadline of each check; defaults to `CHECK_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** How long a result is reused; defaults to `HEALTH_CACHE_MS`. */
  cacheMs?: number;
  /** Called with the names of the failed checks each time a run fails; for the log. */
  onFailure?: (names: readonly string[]) => void;
};

/**
 * Builds the probe behind the health route.
 *
 * The route is exempt from the rate limit, so a client could otherwise cost
 * one store round trip per request and drain the pool that the domain routes
 * share. Concurrent calls therefore share one in-flight run, and its result,
 * failure included, is reused for `cacheMs` after it settles.
 *
 * @param checks - The checks to run; none means always healthy.
 * @param options - Deadline, cache window and the failure callback.
 * @returns The probe; it resolves, never rejects.
 */
export function createHealthProbe(
  checks: readonly DependencyCheck[],
  options: HealthProbeOptions = {},
): HealthProbe {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? HEALTH_CACHE_MS;
  let inFlight: Promise<boolean> | undefined;
  let cached: { healthy: boolean; until: number } | undefined;

  /**
   * One run of every check. The result is cached before the callback runs, and
   * `inFlight` is cleared in `finally`, so a throwing `onFailure` can neither
   * change the answer nor leave a rejected promise behind for later callers.
   *
   * @returns Whether every check passed.
   */
  const run = async (): Promise<boolean> => {
    try {
      const failed = await failedChecks(checks, timeoutMs);
      const healthy = failed.length === 0;
      cached = { healthy, until: Date.now() + cacheMs };
      if (!healthy) {
        try {
          options.onFailure?.(failed);
        } catch {
          // A failing log callback must not change what the probe answers.
        }
      }
      return healthy;
    } finally {
      inFlight = undefined;
    }
  };

  return () => {
    if (checks.length === 0) return Promise.resolve(true);
    if (cached && Date.now() < cached.until) {
      return Promise.resolve(cached.healthy);
    }
    inFlight ??= run();
    return inFlight;
  };
}
