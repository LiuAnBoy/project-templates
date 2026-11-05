import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStaticGreeter } from '../../hello/greeter.js';
import { createHelloModule } from '../../hello/routes.js';
import { buildServer } from '../../server.js';
import { createRedisClient, type RedisPort } from '../client.js';
import { createRateLimitStore } from '../rate-limit-store.js';
import {
  deleteByPrefix,
  keysWithPrefix,
  testTarget,
  type TestTarget,
} from './support.js';

const TOO_MANY = '{"success":false,"payload":{"message":"too many requests"}}';
const UNAVAILABLE =
  '{"success":false,"payload":{"message":"service unavailable"}}';

type Server = Awaited<ReturnType<typeof buildServer>>;

describe('the rate limit in Redis', () => {
  let target: TestTarget;
  let first: RedisPort;
  let second: RedisPort;
  const servers: Server[] = [];

  /**
   * Builds the real server with its limiter counting in the given Redis.
   *
   * @param redis - The client whose store the limiter uses.
   * @param max - Requests allowed per client in the window.
   * @returns The server.
   */
  async function serverOn(redis: RedisPort, max: number): Promise<Server> {
    const server = await buildServer({
      logLevel: 'silent',
      rateLimit: {
        max,
        windowSeconds: 60,
        store: createRateLimitStore(redis.client, { prefix: target.prefix }),
      },
      modules: [createHelloModule({ greeter: createStaticGreeter() })],
    });
    servers.push(server);
    return server;
  }

  /**
   * @param server - The server.
   * @returns The response to one hello request from a fixed client address.
   */
  function hello(server: Server) {
    return server.inject({
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
    await Promise.all(servers.map((server) => server.close()));
    await deleteByPrefix(first.client, target.prefix);
    await first.close();
    await second.close();
  });

  it('counts two clients against one limit and answers 429 from the failure table', async () => {
    const a = await serverOn(first, 2);
    const b = await serverOn(second, 2);

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

  it('counts a request to an unknown path against the same limit', async () => {
    const a = await serverOn(first, 2);

    const response = await a.inject({
      method: 'GET',
      url: '/api/v1/nope',
      remoteAddress: '10.9.9.9',
    });

    expect(response.statusCode).toBe(429);
  });

  it('keeps every counter under the service prefix, with a TTL', async () => {
    const keys = await keysWithPrefix(first.client, target.prefix);

    expect(keys).toContain(`${target.prefix}:rate-limit:10.9.9.9`);
    for (const key of keys) {
      expect(key.startsWith(`${target.prefix}:rate-limit:`)).toBe(true);
      expect(await first.client.pttl(key)).toBeGreaterThan(0);
    }
  });

  it('answers the 503 failure at once when its client has been closed, and never hangs', async () => {
    const dead = createRedisClient({ REDIS_URL: target.url });
    await dead.probe();
    await dead.close();
    const server = await serverOn(dead, 2);
    const started = Date.now();

    const response = await hello(server);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
