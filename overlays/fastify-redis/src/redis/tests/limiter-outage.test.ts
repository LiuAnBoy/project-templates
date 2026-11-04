import { afterEach, describe, expect, it } from 'vitest';

import { describeFailure } from '../../common/errors/failure.js';
import { createStaticGreeter } from '../../hello/greeter.js';
import { createHelloModule } from '../../hello/routes.js';
import { buildServer } from '../../server.js';
import { createRedisClient, type RedisPort } from '../client.js';
import { createRateLimitStore } from '../rate-limit-store.js';
import { silentRedis, type FakeRedis } from './support.js';

const UNAVAILABLE =
  '{"success":false,"payload":{"message":"service unavailable"}}';

/** What must never reach an answer or a described failure. */
const SECRETS = ['secret-pw', '10.9.9.9', 'redis://'];

type Server = Awaited<ReturnType<typeof buildServer>>;

describe('the rate limit when Redis is lost, with no service running', () => {
  let redis: RedisPort | undefined;
  let silent: FakeRedis | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    await server?.close();
    await redis?.close();
    await silent?.stop();
    server = redis = silent = undefined;
  });

  /**
   * Builds the real server whose limiter counts in a client of the given URL.
   *
   * @param url - The Redis URL of the client.
   * @param timeoutMs - How long the limiter waits for Redis.
   * @returns The store class and the server.
   */
  async function limitedOn(url: string, timeoutMs: number) {
    redis = createRedisClient({ REDIS_URL: url }, { log: () => undefined });
    const store = createRateLimitStore(redis.client, { timeoutMs });
    server = await buildServer({
      logLevel: 'silent',
      rateLimit: { max: 5, windowSeconds: 60, store },
      modules: [createHelloModule({ greeter: createStaticGreeter() })],
    });
    return { store, server };
  }

  /**
   * @param app - The server.
   * @returns The response to one hello request.
   */
  function hello(app: Server) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/hello',
      remoteAddress: '10.9.9.9',
    });
  }

  it('answers the 503 failure within the bound on a closed port', async () => {
    const { server: app } = await limitedOn(
      'redis://:secret-pw@127.0.0.1:1',
      1000,
    );
    const started = Date.now();

    const response = await hello(app);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('answers the 503 failure within the bound when the connection is up but silent', async () => {
    silent = await silentRedis();
    const { server: app } = await limitedOn(silent.url, 300);
    await new Promise<void>((resolve) =>
      redis?.client.once('ready', () => resolve()),
    );
    const started = Date.now();

    const response = await hello(app);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('counts a request to an unknown path through the same store, and fails it the same way', async () => {
    const { server: app } = await limitedOn(
      'redis://:secret-pw@127.0.0.1:1',
      1000,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      remoteAddress: '10.9.9.9',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
  });

  it('describes the failure with no key, address or URL in it', async () => {
    silent = await silentRedis();
    const { store } = await limitedOn(silent.url, 200);
    await new Promise<void>((resolve) =>
      redis?.client.once('ready', () => resolve()),
    );
    const counted = new store({} as never);

    const error = await new Promise<unknown>((resolve) =>
      counted.incr('10.9.9.9', (caught) => resolve(caught), 60_000, 5),
    );
    const logged = JSON.stringify(describeFailure(error));

    expect(logged).toContain('rate limiter unavailable');
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });
});
