import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DependencyCheck } from '../../common/dependency-checks.js';
import { validateEnv } from '../../config/env.js';
import type { Database, DatabaseTransaction } from '../../db/database.js';
import {
  createProbe,
  testTarget as databaseTarget,
  type Probe,
  type TestTarget as DatabaseTarget,
} from '../../db/tests/support.js';
import type { TransactionRunner } from '../../db/types.js';
import {
  deleteByPrefix,
  testTarget as redisTarget,
  type TestTarget as RedisTarget,
} from '../../redis/tests/support.js';
import { InfraModule } from '../infra.module.js';
import {
  DATABASE,
  DEPENDENCY_CHECKS,
  REDIS,
  TRANSACTION_RUNNER,
} from '../tokens.js';

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
  let database: DatabaseTarget;
  let redis: RedisTarget;
  let moduleRef: TestingModule;
  let probe: Probe;

  beforeAll(async () => {
    database = await databaseTarget();
    redis = redisTarget();
    process.env.DATABASE_URL = database.url;
    process.env.REDIS_URL = redis.url;
    moduleRef = await buildInfra();
    probe = await createProbe({
      db: moduleRef.get<Database>(DATABASE),
      transactions:
        moduleRef.get<TransactionRunner<DatabaseTransaction>>(
          TRANSACTION_RUNNER,
        ),
    });
  });
  afterAll(async () => {
    await probe.drop();
    await deleteByPrefix(moduleRef.get<Redis>(REDIS), redis.prefix);
    await moduleRef.close();
    await database.dispose();
  });

  it('hands out the database and the runner, and one transaction through them commits', async () => {
    const db = moduleRef.get<Database>(DATABASE);
    const runner =
      moduleRef.get<TransactionRunner<DatabaseTransaction>>(TRANSACTION_RUNNER);

    await runner.run((tx) => probe.insert(tx, 'seam'));

    expect(await probe.exists(db, 'seam')).toBe(true);
  });

  it('hands out the Redis client, and one round trip through it completes', async () => {
    const client = moduleRef.get<Redis>(REDIS);
    const key = `${redis.prefix}:seam`;

    await client.set(key, 'value', 'EX', 30);

    expect(await client.get(key)).toBe('value');
  });

  it('provides one check per store that passes, and fails once the application has closed', async () => {
    const checks = moduleRef.get<DependencyCheck[]>(DEPENDENCY_CHECKS);
    expect(checks.map((check) => check.name)).toEqual([
      expect.any(String),
      'redis',
    ]);
    for (const check of checks)
      await expect(check.run()).resolves.toBeUndefined();

    const other = await buildInfra();
    const otherChecks = other.get<DependencyCheck[]>(DEPENDENCY_CHECKS);
    await other.close();

    for (const check of otherChecks)
      await expect(check.run()).rejects.toThrow();
  });
});
