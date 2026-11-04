import type { Config } from '../config.js';
import type { Infra } from './types.js';

/**
 * Builds what the process depends on from its configuration.
 *
 * The seam between the application and its stores: `main.ts` takes the checks,
 * the optional shared limiter store and the close function from here, and
 * nothing else names a store. The base has no store, so it returns no checks, no
 * shared store and a close that does nothing, and the server starts and answers
 * as it always has. It is typed as a function of the configuration and ignores
 * it, which is the shape a data overlay replaces: its file (and `infra-env.ts`)
 * reads the store's settings from the configuration and connects the store, and
 * `main.ts` does not change.
 *
 * @returns The checks, the optional limiter store and the close function.
 */
export const createInfra: (config: Config) => Infra = () => ({
  checks: [],
  close: async () => undefined,
});
