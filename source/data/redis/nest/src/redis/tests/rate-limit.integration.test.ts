import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATE_LIMIT_STORAGE } from '../../infra/tokens.js';
import { createTestApp } from '../../test/create-app.js';
import { BoundedThrottlerStorage } from '../bounded-throttler.storage.js';
import { createRedisClient, type RedisPort } from '../client.js';
import {
  deleteByPrefix,
  keysWithPrefix,
  testTarget,
  type TestTarget,
} from './support.js';

const TOO_MANY = '{"success":false,"payload":{"message":"too many requests"}}';
const UNAVAILABLE =
  '{"success":false,"payload":{"message":"service unavailable"}}';

describe('the rate limit in Redis', () => {
  let target: TestTarget;
  let first: RedisPort;
  let second: RedisPort;
  const apps: NestFastifyApplication[] = [];

  /**
   * Builds the real application with its limiter counting in the given Redis.
   *
   * @param redis - The client whose store the limiter uses.
   * @param max - Requests allowed per client in the window.
   * @returns The initialised application.
   */
  async function appOn(
    redis: RedisPort,
    max: number,
  ): Promise<NestFastifyApplication> {
    const storage = new BoundedThrottlerStorage(
      new ThrottlerStorageRedisService(redis.client),
      { prefix: target.prefix },
    );
    const app = await createTestApp(
      [],
      (builder) =>
        builder.overrideProvider(RATE_LIMIT_STORAGE).useValue(storage),
      { RATE_LIMIT_MAX: String(max), RATE_LIMIT_WINDOW_SECONDS: '60' },
    );
    apps.push(app);
    return app;
  }

  /**
   * @param app - The application.
   * @returns The response to one hello request from a fixed client address.
   */
  function hello(app: NestFastifyApplication) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/hello',
      remoteAddress: '10.9.9.9',
    });
  }

  beforeAll(async () => {
    target = testTarget();
    first = createRedisClient({ REDIS_URL: target.url });
    second = createRedisClient({ REDIS_URL: target.url });
    await Promise.all([first.probe(), second.probe()]);
  });
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await deleteByPrefix(first.client, target.prefix);
    await first.close();
    await second.close();
  });

  it('counts two clients against one limit and answers 429 from the failure table', async () => {
    const a = await appOn(first, 2);
    const b = await appOn(second, 2);

    const one = await hello(a);
    const two = await hello(b);
    const three = await hello(a);
    const four = await hello(b);

    expect(one.statusCode).toBe(200);
    expect(two.statusCode).toBe(200);
    expect(three.statusCode).toBe(429);
    expect(three.body).toBe(TOO_MANY);
    expect(four.statusCode).toBe(429);
    expect(four.body).toBe(TOO_MANY);
  });

  it('keeps every counter under the service prefix, with a TTL', async () => {
    const keys = await keysWithPrefix(first.client, target.prefix);

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toContain(`${target.prefix}:rate-limit:`);
      expect(await first.client.pttl(key)).toBeGreaterThan(0);
    }
  });

  it('answers the 503 failure at once when its client has been closed, and never hangs', async () => {
    const dead = createRedisClient({ REDIS_URL: target.url });
    await dead.probe();
    await dead.close();
    const app = await appOn(dead, 2);
    const started = Date.now();

    const response = await hello(app);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
