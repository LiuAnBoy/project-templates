import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ServiceUnavailableException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { describeFailure } from '../../common/errors/failure.js';
import { RATE_LIMIT_STORAGE } from '../../infra/tokens.js';
import { createTestApp } from '../../test/create-app.js';
import { BoundedThrottlerStorage } from '../bounded-throttler.storage.js';
import { createRedisClient, type RedisPort } from '../client.js';
import { silentRedis, type FakeRedis } from './support.js';

const UNAVAILABLE =
  '{"success":false,"payload":{"message":"service unavailable"}}';

/** What must never reach an answer or a described failure. */
const SECRETS = ['secret-pw', '10.9.9.9', 'redis://'];

describe('the rate limit when Redis is lost, with no service running', () => {
  let redis: RedisPort | undefined;
  let silent: FakeRedis | undefined;
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    await redis?.close();
    await silent?.stop();
    app = redis = silent = undefined;
  });

  /**
   * Builds the real application whose limiter counts in a client of the given URL.
   *
   * @param url - The Redis URL of the client.
   * @param timeoutMs - How long the limiter waits for Redis.
   * @returns The storage and the application.
   */
  async function limitedOn(url: string, timeoutMs: number) {
    redis = createRedisClient({ REDIS_URL: url }, { log: () => undefined });
    const storage = new BoundedThrottlerStorage(
      new ThrottlerStorageRedisService(redis.client),
      { timeoutMs },
    );
    app = await createTestApp([], (builder) =>
      builder.overrideProvider(RATE_LIMIT_STORAGE).useValue(storage),
    );
    return { storage, app };
  }

  /**
   * @param server - The application.
   * @returns The response to one hello request.
   */
  function hello(server: NestFastifyApplication) {
    return server.inject({
      method: 'GET',
      url: '/api/v1/hello',
      remoteAddress: '10.9.9.9',
    });
  }

  it('answers the 503 failure within the bound on a closed port', async () => {
    const { app: server } = await limitedOn(
      'redis://:secret-pw@127.0.0.1:1',
      1000,
    );
    const started = Date.now();

    const response = await hello(server);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('answers the 503 failure within the bound when the connection is up but silent', async () => {
    silent = await silentRedis();
    const { app: server, storage } = await limitedOn(silent.url, 300);
    await new Promise<void>((resolve) =>
      redis?.client.once('ready', () => resolve()),
    );
    const started = Date.now();

    const response = await hello(server);
    const error = await storage
      .increment('10.9.9.9', 60_000, 5, 60_000, 'default')
      .catch((caught: unknown) => caught);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
  });

  it('describes the failure with no key, address or URL in it', async () => {
    silent = await silentRedis();
    const { storage } = await limitedOn(silent.url, 200);
    await new Promise<void>((resolve) =>
      redis?.client.once('ready', () => resolve()),
    );

    const error = await storage
      .increment('10.9.9.9', 60_000, 5, 60_000, 'default')
      .catch((caught: unknown) => caught);
    const logged = JSON.stringify(describeFailure(error));

    expect(logged).toContain('rate limiter unavailable');
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });
});
