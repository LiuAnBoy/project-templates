import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import {
  applicationOptions,
  configureApp,
  createHttpAdapter,
} from './bootstrap.js';
import type { Env } from './config/env.js';

/**
 * Boots the HTTP process; it only wires, `bootstrap.ts` holds the setup.
 *
 * `abortOnError: false` makes an initialisation failure reject, so it reaches
 * the catch below with a readable message instead of Nest killing the process
 * with a bare stack trace.
 *
 * @returns Resolves once the server is listening.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createHttpAdapter(),
    { ...applicationOptions(), bufferLogs: true, abortOnError: false },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);
  await app.listen({
    host: config.get('HOST', { infer: true }),
    port: config.get('PORT', { infer: true }),
  });
}

bootstrap().catch((error: unknown) => {
  console.error(
    'failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
