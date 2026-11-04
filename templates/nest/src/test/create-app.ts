import type { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
import { validateEnv, type Env } from '../config/env.js';
import {
  applicationOptions,
  configureApp,
  createHttpAdapter,
} from '../bootstrap.js';

/**
 * Boots the real application the way `main.ts` does, without listening.
 *
 * @param controllers - Extra controllers, for tests that need a route which fails on purpose.
 * @param override - Swaps providers at the wiring point, e.g. `(b) => b.overrideProvider(GREETER).useValue(fake)`.
 * @param env - Environment values for this app only, e.g. `{ RATE_LIMIT_MAX: '2' }`. The module reads its
 *   configuration when the file is imported, so a test cannot change it through `process.env`.
 * @returns The initialised application; call `close()` when done.
 */
export async function createTestApp(
  controllers: Type<unknown>[] = [],
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
  env: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  const values = validateEnv({ ...process.env, ...env });
  const config = { get: (key: keyof Env) => values[key] };
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule], controllers })
      .overrideProvider(ConfigService)
      .useValue(config),
  ).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createHttpAdapter(values.TRUST_PROXY),
    applicationOptions(),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
