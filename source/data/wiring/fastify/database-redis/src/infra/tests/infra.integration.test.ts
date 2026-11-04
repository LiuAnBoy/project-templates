import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import {
  createProbe,
  testTarget as databaseTarget,
  type Probe,
  type TestTarget as DatabaseTarget,
} from '../../db/tests/support.js';
import {
  deleteByPrefix,
  testTarget as redisTarget,
  type TestTarget as RedisTarget,
} from '../../redis/tests/support.js';
import { createInfra } from '../infra.js';
import type { Infra } from '../types.js';

describe('the real createInfra', () => {
  let database: DatabaseTarget;
  let redis: RedisTarget;
  let infra: Infra;
  let probe: Probe;

  /**
   * @returns The configuration of the two test targets.
   */
  function config() {
    return loadConfig({
      ...process.env,
      DATABASE_URL: database.url,
      REDIS_URL: redis.url,
    });
  }

  beforeAll(async () => {
    database = await databaseTarget();
    redis = redisTarget();
    infra = createInfra(config());
    probe = await createProbe(infra);
  });
  afterAll(async () => {
    await probe.drop();
    await deleteByPrefix(infra.redis, redis.prefix);
    await infra.close();
    await database.dispose();
  });

  it('hands out the database and the runner, and one transaction through them commits', async () => {
    await infra.transactions.run((tx) => probe.insert(tx, 'seam'));

    expect(await probe.exists(infra.db, 'seam')).toBe(true);
  });

  it('hands out the Redis client, and one round trip through it completes', async () => {
    const key = `${redis.prefix}:seam`;

    await infra.redis.set(key, 'value', 'EX', 30);

    expect(await infra.redis.get(key)).toBe('value');
  });

  it('provides the limiter store and one check per store, which fail once the infra is closed', async () => {
    expect(infra.rateLimitStore).toBeDefined();
    expect(infra.checks.map((check) => check.name)).toEqual([
      expect.any(String),
      'redis',
    ]);
    for (const check of infra.checks)
      await expect(check.run()).resolves.toBeUndefined();

    const other = createInfra(config());
    await other.close();

    for (const check of other.checks)
      await expect(check.run()).rejects.toThrow();
  });
});
