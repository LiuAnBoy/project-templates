import type {
  FastifyRateLimitStore,
  FastifyRateLimitStoreCtor,
} from '@fastify/rate-limit';
import type { Redis } from 'ioredis';

import { bounded } from '../common/concurrency/bounded.js';
import { REDIS_KEY_PREFIX } from './client.js';

/** How long the limiter waits for Redis before it gives up, in milliseconds. */
const RATE_LIMIT_TIMEOUT_MS = 1000;

/** Settings of `createRateLimitStore`. */
export type RateLimitStoreOptions = {
  /** The service prefix of the keys; defaults to `REDIS_KEY_PREFIX`. */
  prefix?: string;
  /** How long Redis has to answer; defaults to `RATE_LIMIT_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/**
 * Counts one hit and returns the count with the time left in the window, in one
 * atomic step. The key always ends with an expiry: a crash between two commands
 * cannot leave a counter that never resets.
 */
const COUNT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

/**
 * The error a failed count becomes. It looks like the errors Fastify itself
 * raises (a `FST_ERR_` code and a `statusCode`), so the error handler answers
 * it from the failure table as a 503 and logs the cause chain, which holds no
 * key and no URL.
 */
class RateLimiterUnavailableError extends Error {
  readonly code = 'FST_ERR_RATE_LIMIT_STORE_UNAVAILABLE';
  readonly statusCode = 503;

  /**
   * @param cause - What Redis did or did not do.
   */
  constructor(cause: unknown) {
    super('rate limiter unavailable', { cause });
    this.name = 'RateLimiterUnavailableError';
  }
}

/**
 * Builds the store class `RateLimitOptions.store` takes, counting in Redis.
 *
 * Every counter lives under the service prefix and has a TTL. A Redis that
 * fails or does not answer within the bound fails the request with 503 and
 * never lets it through uncounted: letting requests through would keep the
 * service up while the limit in front of password guessing is switched off,
 * unnoticed, and a limiter waiting on a dead Redis would stop every route with
 * nothing in the log. The health route skips the limiter, so an outage cannot
 * get every instance restarted.
 *
 * @param client - The Redis client of the seam.
 * @param options - Key prefix and the time Redis has to answer.
 * @returns The store class, for `@fastify/rate-limit`.
 */
export function createRateLimitStore(
  client: Redis,
  options: RateLimitStoreOptions = {},
): FastifyRateLimitStoreCtor {
  const timeoutMs = options.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS;

  /** One scope of counters: the global one, or the one of a route with its own limit. */
  class RedisRateLimitStore implements FastifyRateLimitStore {
    /**
     * @param keyPrefix - What every key of this scope starts with.
     */
    constructor(private readonly keyPrefix: string) {}

    incr(
      key: string,
      callback: (
        error: Error | null,
        result?: { current: number; ttl: number },
      ) => void,
      timeWindow: number,
    ): void {
      bounded(
        client.eval(COUNT_SCRIPT, 1, `${this.keyPrefix}${key}`, timeWindow),
        timeoutMs,
        'rate limiter',
      ).then(
        (reply) => {
          const [current, ttl] = reply as [number, number];
          callback(null, { current, ttl });
        },
        (error: unknown) => callback(new RateLimiterUnavailableError(error)),
      );
    }

    child(
      routeOptions: Parameters<FastifyRateLimitStore['child']>[0],
    ): FastifyRateLimitStore {
      // The plugin passes the merged route settings, which carry the route's
      // method and url under `routeInfo` (empty for `app.rateLimit(options)`).
      const { routeInfo } = routeOptions as unknown as {
        routeInfo?: { method?: string | string[]; url?: string };
      };
      return new RedisRateLimitStore(
        `${this.keyPrefix}${String(routeInfo?.method ?? '')}${routeInfo?.url ?? ''}:`,
      );
    }
  }

  /** The class the plugin constructs; the options it passes in are not needed. */
  return class extends RedisRateLimitStore {
    constructor() {
      super(`${options.prefix ?? REDIS_KEY_PREFIX}:rate-limit:`);
    }
  };
}
