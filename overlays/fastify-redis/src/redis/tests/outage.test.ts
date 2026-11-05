import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { describeFailure } from '../../common/errors/failure.js';
import {
  createRedisClient,
  redisEnv,
  retryDelay,
  type RedisPort,
} from '../client.js';
import { fakeRedis, type FakeRedis } from './support.js';

const CLOSED_PORT_URL = 'redis://:secret-pw@127.0.0.1:1';

/** What a test must never see in a log line or a failure description. */
const SECRETS = [
  'secret-pw',
  'secret-key',
  'secret-value',
  '127.0.0.1',
  'redis://',
];

describe('redis outage, with no service running', () => {
  let redis: RedisPort | undefined;

  afterEach(async () => {
    await redis?.close();
    redis = undefined;
  });

  it('fails a command on a closed port within a moment, with an error the classifier accepts', async () => {
    redis = createRedisClient(
      { REDIS_URL: CLOSED_PORT_URL },
      { log: () => undefined },
    );
    const started = Date.now();

    const error = await redis.client
      .set('secret-key', 'secret-value')
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeDefined();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(isDependencyOutage(error)).toBe(true);
    expect(JSON.stringify(describeFailure(error))).not.toContain(
      'secret-value',
    );
  });

  it('keeps failing a command while the client reconnects, and never queues it', async () => {
    redis = createRedisClient(
      { REDIS_URL: CLOSED_PORT_URL },
      { log: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(redis.client.status).toBe('reconnecting');
    const started = Date.now();

    const error = await redis.client
      .get('secret-key')
      .catch((caught: unknown) => caught);

    expect(Date.now() - started).toBeLessThan(500);
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('fails the probe on a closed port before the check bound', async () => {
    redis = createRedisClient(
      { REDIS_URL: CLOSED_PORT_URL },
      { log: () => undefined },
    );
    const started = Date.now();

    await expect(redis.probe()).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(1900);
  });

  it('says an outage once, with the code and nothing the connection carries', async () => {
    const lines: string[] = [];
    redis = createRedisClient(
      { REDIS_URL: CLOSED_PORT_URL },
      { log: (line) => lines.push(line) },
    );

    await new Promise((resolve) => setTimeout(resolve, 1800));

    expect(lines).toEqual(['redis: unreachable (ECONNREFUSED), retrying']);
    for (const secret of SECRETS)
      expect(lines.join('\n')).not.toContain(secret);
  });

  it('stops reconnecting once closed', async () => {
    redis = createRedisClient(
      { REDIS_URL: CLOSED_PORT_URL },
      { log: () => undefined },
    );

    await redis.close();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(redis.client.status).toBe('end');
  });

  it('waits longer between attempts as they fail, up to a cap', () => {
    expect(retryDelay(1)).toBe(500);
    expect(retryDelay(4)).toBe(2000);
    expect(retryDelay(50)).toBe(5000);
  });
});

describe('redis connection errors described for the log', () => {
  /**
   * Collects the error ioredis emits for a URL it cannot reach.
   *
   * @param url - The Redis URL to fail against.
   * @returns The failure as the log line would hold it.
   */
  async function describeEmittedError(url: string): Promise<string> {
    const client = new Redis(url, {
      retryStrategy: () => null,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    const emitted = new Promise<unknown>((resolve) =>
      client.once('error', resolve),
    );
    client.connect().catch(() => undefined);
    const error = await emitted;
    client.disconnect();
    return JSON.stringify(describeFailure(error));
  }

  it('reproduces a refused connection: the log names no host, port or password, and keeps ECONNREFUSED', async () => {
    const logged = await describeEmittedError(
      'redis://canary-user:canary-pw@127.0.0.1:1/0',
    );

    for (const canary of ['127.0.0.1', 'canary-user', 'canary-pw']) {
      expect(logged).not.toContain(canary);
    }
    expect(logged).toContain('ECONNREFUSED');
  });

  it('reproduces a host that does not resolve: the log names no host and keeps ENOTFOUND', async () => {
    const logged = await describeEmittedError(
      'redis://canary-host.invalid:6379',
    );

    expect(logged).not.toContain('canary-host');
    expect(logged).toMatch(/ENOTFOUND|EAI_AGAIN/);
  });
});

describe('redis errors that are not a lost connection', () => {
  let fake: FakeRedis | undefined;
  let redis: RedisPort | undefined;

  afterEach(async () => {
    await redis?.close();
    await fake?.stop();
    redis = fake = undefined;
  });

  it('names the protocol word of a refused login and nothing else', async () => {
    fake = await fakeRedis(
      () => '-NOAUTH Authentication required for secret-pw.\r\n',
    );
    const lines: string[] = [];

    redis = createRedisClient(
      { REDIS_URL: fake.url },
      { log: (line) => lines.push(line) },
    );
    await redis.probe().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(lines[0]).toBe('redis: unreachable (ReplyError NOAUTH), retrying');
    for (const secret of SECRETS)
      expect(lines.join('\n')).not.toContain(secret);
  });
});

describe('connections made from the client', () => {
  it('reproduces a duplicate losing its server: the error reaches the one log line, and ioredis prints nothing raw', async () => {
    const raw = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lines: string[] = [];
    const redis = createRedisClient(
      { REDIS_URL: CLOSED_PORT_URL },
      { log: (line) => lines.push(line) },
    );

    const duplicate = redis.client.duplicate();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await redis.close();

    expect(raw).not.toHaveBeenCalled();
    raw.mockRestore();
    expect(lines.join('\n')).toContain('ECONNREFUSED');
    let attempts = 0;
    duplicate.on('connecting', () => {
      attempts += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(attempts).toBe(0);
  });
});

describe('a Redis that refuses the client', () => {
  it('reproduces a wrong password: an outage through the real client', async () => {
    const fake = await fakeRedis(
      () => '-WRONGPASS invalid username-password pair\r\n',
    );
    const redis = createRedisClient(
      { REDIS_URL: fake.url },
      { log: () => undefined },
    );

    const error = await redis.probe().catch((caught: unknown) => caught);
    await redis.close();
    await fake.stop();

    expect(error).toBeInstanceOf(Error);
    expect(isDependencyOutage(error)).toBe(true);
  });
});

describe('the settings of redis', () => {
  const settings = z.object(redisEnv);

  it('reproduces a malformed URL: refused naming the setting and no value', () => {
    for (const value of [
      'redis://:canary-pw@canary-host:canary-port',
      'redis://[canary-host]:6379',
      'redis://canary-host:99999',
      'canary',
    ]) {
      const result = settings.safeParse({ REDIS_URL: value });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['REDIS_URL']);
      expect(JSON.stringify(result.error?.issues)).not.toContain('canary');
    }
  });

  it('accepts the shapes a deployment uses', () => {
    for (const value of [
      'redis://localhost:6379',
      'redis://:p%40ss@host:6380/2',
      'rediss://user:pass@host',
    ]) {
      expect(settings.safeParse({ REDIS_URL: value }).success).toBe(true);
    }
  });
});
