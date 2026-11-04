import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRedisClient, type RedisPort } from '../client.js';
import { deleteByPrefix, testTarget, type TestTarget } from './support.js';

describe('redis client', () => {
  let target: TestTarget;
  let redis: RedisPort;
  const lines: string[] = [];

  beforeAll(() => {
    target = testTarget();
    redis = createRedisClient(
      { REDIS_URL: target.url },
      { log: (line) => lines.push(line) },
    );
  });
  afterAll(async () => {
    await deleteByPrefix(redis.client, target.prefix);
    await redis.close();
  });

  it('answers the probe with a real round trip, even right after it was created', async () => {
    const fresh = createRedisClient({ REDIS_URL: target.url });

    await expect(fresh.probe()).resolves.toBeUndefined();
    await fresh.close();
  });

  it('writes a key with a TTL and reads it back', async () => {
    const key = `${target.prefix}:thing:1`;

    await redis.client.set(key, 'value', 'EX', 30);

    expect(await redis.client.get(key)).toBe('value');
    expect(await redis.client.ttl(key)).toBeGreaterThan(0);
  });

  it('reconnects by itself after the server drops its connection, and says so once each way', async () => {
    const id = await redis.client.client('ID');
    const killer = createRedisClient({ REDIS_URL: target.url });
    await killer.probe();
    await killer.client.client('KILL', 'ID', String(id));
    await killer.close();

    const deadline = Date.now() + 8000;
    let recovered = false;
    while (!recovered && Date.now() < deadline) {
      recovered = await redis.probe().then(
        () => true,
        () => false,
      );
      if (!recovered) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(recovered).toBe(true);
    expect(lines).toEqual([
      'redis: connection lost, retrying',
      'redis: connection restored',
    ]);
    expect(lines.join('\n')).not.toContain(target.url);
  });

  it('closes twice without error, and a closed client fails its probe', async () => {
    const other = createRedisClient({ REDIS_URL: target.url });
    await other.probe();

    await other.close();
    await other.close();

    await expect(other.probe()).rejects.toThrow();
  });
});
