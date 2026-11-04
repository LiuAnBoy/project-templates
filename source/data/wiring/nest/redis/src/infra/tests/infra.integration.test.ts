import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DependencyCheck } from '../../common/dependency-checks.js';
import { validateEnv } from '../../config/env.js';
import {
  deleteByPrefix,
  testTarget,
  type TestTarget,
} from '../../redis/tests/support.js';
import { InfraModule } from '../infra.module.js';
import { DEPENDENCY_CHECKS, REDIS } from '../tokens.js';

/**
 * Builds the real `InfraModule`, not the stub the ordinary tests use, over the
 * settings in `process.env`.
 *
 * @returns The initialised module.
 */
async function buildInfra(): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnv,
      }),
      InfraModule,
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

describe('the real InfraModule', () => {
  let target: TestTarget;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    target = testTarget();
    process.env.REDIS_URL = target.url;
    moduleRef = await buildInfra();
  });
  afterAll(async () => {
    await deleteByPrefix(moduleRef.get<Redis>(REDIS), target.prefix);
    await moduleRef.close();
  });

  it('hands out the Redis client, and one round trip through it completes', async () => {
    const redis = moduleRef.get<Redis>(REDIS);
    const key = `${target.prefix}:seam`;

    await redis.set(key, 'value', 'EX', 30);

    expect(await redis.get(key)).toBe('value');
  });

  it('provides one dependency check that passes, and fails once the application has closed', async () => {
    const checks = moduleRef.get<DependencyCheck[]>(DEPENDENCY_CHECKS);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.name).toBe('redis');
    await expect(checks[0]?.run()).resolves.toBeUndefined();

    const other = await buildInfra();
    const otherChecks = other.get<DependencyCheck[]>(DEPENDENCY_CHECKS);
    await other.close();

    await expect(otherChecks[0]?.run()).rejects.toThrow();
  });
});
