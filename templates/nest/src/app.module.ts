import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/http/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/http/interceptors/response-envelope.interceptor.js';
import { createThrottlerOptions } from './common/http/rate-limit.js';
import { loggerOptions } from './common/logging/logger.options.js';
import { validateEnv, type Env } from './config/env.js';
import { HealthModule } from './modules/health/health.module.js';
import { HelloModule } from './modules/hello/hello.module.js';
import { InfraModule } from './infra/infra.module.js';
import { RATE_LIMIT_STORAGE } from './infra/tokens.js';

/**
 * The root module: configuration, the infrastructure seam, logging, the request
 * limit, the global pipe, interceptor and filter, and one module per domain.
 *
 * `ThrottlerGuard` limits every route per client; the numbers come from the
 * environment, the counts live in the storage `InfraModule` provides (memory
 * when it provides none), and the guard is the one wiring place of the limit. This template
 * ships no authentication, so every route is public. Add a global guard here
 * (`APP_GUARD`) before the first route that must not be.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerOptions(config.get('LOG_LEVEL', { infer: true })),
    }),
    InfraModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RATE_LIMIT_STORAGE],
      useFactory: (
        config: ConfigService<Env, true>,
        storage: ThrottlerStorage | undefined,
      ) =>
        createThrottlerOptions({
          max: config.get('RATE_LIMIT_MAX', { infer: true }),
          windowSeconds: config.get('RATE_LIMIT_WINDOW_SECONDS', {
            infer: true,
          }),
          storage,
        }),
    }),
    HealthModule,
    HelloModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
