import type { Config } from '../config.js';
import { createRedisClient } from '../redis/client.js';
import { createRateLimitStore } from '../redis/rate-limit-store.js';
import type { Infra } from './types.js';

/**
 * Builds what the process depends on from its configuration.
 *
 * The seam between the application and its stores: `main.ts` takes the checks,
 * the shared limiter store, the Redis client and the close function from here,
 * and nothing else names a store. The client is created once, here; the project
 * passes `redis` to the factories it wires in `main.ts`. The limiter counts in
 * Redis, shared by every instance, and a Redis that does not answer fails the
 * request with 503.
 *
 * @param config - The validated configuration; the store's settings are on it.
 * @returns The checks, the limiter store, the client and the close function.
 */
export function createInfra(config: Config): Infra {
  const redis = createRedisClient(config);
  return {
    checks: [{ name: redis.name, run: redis.probe }],
    rateLimitStore: createRateLimitStore(redis.client),
    redis: redis.client,
    close: redis.close,
  };
}
