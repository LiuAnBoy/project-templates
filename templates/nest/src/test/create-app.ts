import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import { AppModule } from '../app.module.js';
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
 * @returns The initialised application; call `close()` when done.
 */
export async function createTestApp(
  controllers: Type<unknown>[] = [],
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
    builder,
  ) => builder,
): Promise<NestFastifyApplication> {
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule], controllers }),
  ).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createHttpAdapter(),
    applicationOptions(),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
