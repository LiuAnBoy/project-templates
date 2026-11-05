import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { RuntimeException } from '@nestjs/core/errors/exceptions/runtime.exception.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import {
  applicationOptions,
  configureApp,
  createHttpAdapter,
} from './bootstrap.js';
import {
  runStartupChecks,
  type DependencyCheck,
} from './common/dependency-checks.js';
import { describeStartupFailure } from './common/errors/startup-failure.js';
import { installProcessGuards } from './common/process-guard.js';
import { validateEnv, type Env } from './config/env.js';
import { DEPENDENCY_CHECKS } from './infra/tokens.js';

/**
 * Boots the HTTP process; it only wires, `bootstrap.ts` holds the setup.
 *
 * `abortOnError: false` makes an initialisation failure reject, so it reaches
 * the catch below instead of Nest killing the process. `logger: false` keeps Nest's
 * own handler from printing that failure on its way there, message included, because
 * a provider's error can quote a setting; `useLogger` turns logging on once the
 * application exists, and the catch prints what is safe.
 *
 * Before the server listens, every dependency check of `InfraModule` runs under
 * `bounded()`; a failure closes the application and exits non-zero naming the
 * check, never a value. The base has no checks, so it starts as it always has.
 *
 * @returns Resolves once the server is listening.
 */
async function bootstrap(): Promise<void> {
  installProcessGuards();
  // The adapter is built before the config module exists, and it needs the
  // proxy trust, so the environment is validated once here as well.
  const { TRUST_PROXY } = validateEnv(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createHttpAdapter(TRUST_PROXY),
    {
      ...applicationOptions(),
      logger: false,
      bufferLogs: true,
      abortOnError: false,
    },
  );
  const logger = app.get(Logger);
  app.useLogger(logger);
  await configureApp(app);
  app.enableShutdownHooks();

  try {
    await runStartupChecks(
      app.get<DependencyCheck[]>(DEPENDENCY_CHECKS, { strict: false }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }

  const config = app.get(ConfigService<Env, true>);
  await app.init();
  // Nest's `listen` logs the text of a failed bind, which quotes HOST, before it
  // rejects; the catch below prints the failure instead.
  app.useLogger(false);
  await app.listen({
    host: config.get('HOST', { infer: true }),
    port: config.get('PORT', { infer: true }),
  });
  app.useLogger(logger);
}

bootstrap().catch((error: unknown) => {
  // Nest's own errors name providers and modules, and a developer needs that text.
  console.error(
    error instanceof RuntimeException
      ? `failed to start: ${error.message}`
      : describeStartupFailure(error),
  );
  process.exit(1);
});
