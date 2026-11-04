import type { Config } from '../config.js';
import type { Infra } from './types.js';

/**
 * Builds what the process depends on from its configuration.
 *
 * The seam between the application and its stores: `main.ts` takes the checks,
 * the optional shared limiter store and the close function from here, and
 * nothing else names a store. The base has no store, so it returns no checks, no
 * shared store and a close that does nothing, and the server starts and answers
 * as it always has. A data overlay replaces this file (and `infra-env.ts`) with
 * one that connects its store; `main.ts` does not change.
 *
 * @param _config - The validated configuration; a store's settings are on it.
 * @returns The checks, the optional limiter store and the close function.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the base ignores it; an overlay reads its store's settings
export function createInfra(_config: Config): Infra {
  return { checks: [], close: async () => undefined };
}
