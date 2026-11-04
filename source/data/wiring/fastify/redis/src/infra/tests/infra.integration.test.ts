import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import {
  deleteByPrefix,
  testTarget,
  type TestTarget,
} from '../../redis/tests/support.js';
import { createInfra } from '../infra.js';
import type { Infra } from '../types.js';

describe('the real createInfra', () => {
  let target: TestTarget;
  let infra: Infra;

  beforeAll(() => {
    target = testTarget();
    infra = createInfra(loadConfig({ ...process.env, REDIS_URL: target.url }));
  });
  afterAll(async () => {
    await deleteByPrefix(infra.redis, target.prefix);
    await infra.close();
  });

  it('hands out the Redis client, and one round trip through it completes', async () => {
    const key = `${target.prefix}:seam`;

    await infra.redis.set(key, 'value', 'EX', 30);

    expect(await infra.redis.get(key)).toBe('value');
  });

  it('provides the limiter store and one passing dependency check, which fails once the infra is closed', async () => {
    expect(infra.rateLimitStore).toBeDefined();
    expect(infra.checks.map((check) => check.name)).toEqual(['redis']);
    await expect(infra.checks[0]?.run()).resolves.toBeUndefined();

    const other = createInfra(
      loadConfig({ ...process.env, REDIS_URL: target.url }),
    );
    await other.close();

    await expect(other.checks[0]?.run()).rejects.toThrow();
  });
});
