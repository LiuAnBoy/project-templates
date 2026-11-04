import { ServiceUnavailableException } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { bounded } from '../common/concurrency/bounded.js';
import { REDIS_KEY_PREFIX } from './client.js';

/** The answer of one `increment`, whatever the storage behind it. */
type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** How long the limiter waits for Redis before it gives up, in milliseconds. */
export const RATE_LIMIT_TIMEOUT_MS = 1000;

/** Settings of `BoundedThrottlerStorage`. */
export type BoundedThrottlerOptions = {
  /** The service prefix of the keys; defaults to `REDIS_KEY_PREFIX`. */
  prefix?: string;
  /** How long Redis has to answer; defaults to `RATE_LIMIT_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/**
 * Puts the rate limiter's counters under the service prefix and makes a Redis
 * that does not answer fail the request instead of hanging it.
 *
 * The guard that reads the counters runs before every handler, so a limiter
 * waiting on a dead Redis would stop every route, with no error and nothing in
 * the log. Failing is the deliberate choice, and failing open is not: letting
 * requests through uncounted would keep the service up while the one thing in
 * front of password guessing is switched off, unnoticed. A 503 stops everybody,
 * which is loud, and somebody fixes Redis. The health route skips the limiter,
 * so an outage cannot get every instance restarted.
 *
 * The answer is a 503 for any failure of the inner storage, and the cause rides
 * along for the log. The key and the counts are never part of a message.
 */
export class BoundedThrottlerStorage implements ThrottlerStorage {
  private readonly prefix: string;
  private readonly timeoutMs: number;

  /**
   * @param inner - The storage that talks to Redis.
   * @param options - Key prefix and the time Redis has to answer.
   */
  constructor(
    private readonly inner: ThrottlerStorage,
    options: BoundedThrottlerOptions = {},
  ) {
    this.prefix = options.prefix ?? REDIS_KEY_PREFIX;
    this.timeoutMs = options.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS;
  }

  /**
   * Counts one request against its limit, or gives up.
   *
   * @param key - Who is being counted.
   * @param ttl - The window, in milliseconds.
   * @param limit - How many are allowed in it.
   * @param blockDuration - How long a breach stays blocked.
   * @param throttlerName - Which configured limiter this is.
   * @returns The updated record.
   * @throws ServiceUnavailableException when Redis fails or does not answer in time.
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
      return await bounded(
        this.inner.increment(
          `${this.prefix}:rate-limit:${key}`,
          ttl,
          limit,
          blockDuration,
          throttlerName,
        ),
        this.timeoutMs,
        'rate limiter',
      );
    } catch (error) {
      throw new ServiceUnavailableException('rate limiter unavailable', {
        cause: error,
      });
    }
  }
}
