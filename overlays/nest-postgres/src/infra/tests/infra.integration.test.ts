import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DependencyCheck } from '../../common/dependency-checks.js';
import { validateEnv } from '../../config/env.js';
import type { Database, DatabaseTransaction } from '../../db/database.js';
import {
  createProbe,
  testTarget,
  type Probe,
  type TestTarget,
} from '../../db/tests/support.js';
import type { TransactionRunner } from '../../db/types.js';
import { InfraModule } from '../infra.module.js';
import { DATABASE, DEPENDENCY_CHECKS, TRANSACTION_RUNNER } from '../tokens.js';

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
  let probe: Probe;

  beforeAll(async () => {
    target = await testTarget();
    process.env.DATABASE_URL = target.url;
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
    await moduleRef.close();
    await target.dispose();
  });

  it('hands out the database and the runner, and one transaction through them commits', async () => {
    const db = moduleRef.get<Database>(DATABASE);
    const runner =
      moduleRef.get<TransactionRunner<DatabaseTransaction>>(TRANSACTION_RUNNER);

    await runner.run((tx) => probe.insert(tx, 'seam'));

    expect(await probe.exists(db, 'seam')).toBe(true);
  });

  it('provides one dependency check that passes, and fails once the application has closed', async () => {
    const checks = moduleRef.get<DependencyCheck[]>(DEPENDENCY_CHECKS);
    expect(checks).toHaveLength(1);
    await expect(checks[0]?.run()).resolves.toBeUndefined();

    const other = await buildInfra();
    const otherChecks = other.get<DependencyCheck[]>(DEPENDENCY_CHECKS);
    await other.close();

    await expect(otherChecks[0]?.run()).rejects.toThrow();
  });
});
