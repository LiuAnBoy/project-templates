import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/http/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/http/interceptors/response-envelope.interceptor.js';
import { loggerOptions } from './common/logging/logger.options.js';
import { validateEnv, type Env } from './config/env.js';
import { HelloModule } from './modules/hello/hello.module.js';

/**
 * The root module: configuration, logging, the global pipe, interceptor and
 * filter, and one module per domain.
 *
 * This template ships no authentication, so every route is public. Add a global
 * guard here (`APP_GUARD`) before the first route that must not be.
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
    HelloModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
