import helmet from '@fastify/helmet';
import type { NestApplicationOptions } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { IncomingMessage } from 'node:http';

import { registerRoutePattern } from './common/http/access-log.js';
import { registerJsonBodyParser } from './common/http/json-body-parser.js';
import {
  registerRequestId,
  resolveRequestId,
} from './common/http/request-id.js';

/** The largest JSON body any endpoint accepts, in bytes. */
const JSON_BODY_LIMIT_BYTES = 1_048_576;

/** The prefix of every route. */
export const API_PREFIX = 'api/v1';

/**
 * Builds the Fastify adapter the application runs on.
 *
 * Two settings carry contract rather than preference:
 *
 * - `bodyLimit` is the JSON size limit, enforced while the body is read.
 * - `requestIdHeader: false` hands the incoming header to `genReqId` instead of
 *   trusting it. An id that reaches a log line and a response header must be
 *   conservative enough for both.
 *
 * The route-pattern hook is registered here rather than in `configureApp`, for
 * ordering. `NestFactory.create` initialises the adapter, which installs the
 * middleware bridge and with it the access log, before `configureApp` can run;
 * a hook registered later runs after the log has serialised the request. The
 * testing module initialises the adapter at `app.init()` instead, so tests
 * create the adapter with this function too.
 *
 * @returns The adapter.
 */
export function createHttpAdapter(): FastifyAdapter {
  const adapter = new FastifyAdapter({
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) =>
      resolveRequestId(request.headers['x-request-id']),
  });
  registerRoutePattern(adapter.getInstance());
  return adapter;
}

/**
 * Options every way of creating the application has to pass.
 *
 * `bodyParser: false` turns off the JSON parser Nest installs during `init()`,
 * so `registerJsonBodyParser` can install one that answers a bad body from the
 * failure table. Fastify allows exactly one parser per content type, and Nest's
 * goes in later: leaving this out is a crash on startup, not a fallback.
 *
 * @returns Options for `NestFactory.create` and `createNestApplication`.
 */
export function applicationOptions(): NestApplicationOptions {
  return { bodyParser: false };
}

/**
 * Applies everything the application needs beyond its modules.
 *
 * Shared by `main.ts` and by every test that boots the application. That
 * sharing is the point: a plugin registered only in `main.ts` does not fail a
 * test, it quietly does nothing in one and works in the other. Pipes, filters
 * and interceptors are `APP_*` providers in `app.module.ts` instead, because
 * those can inject other providers.
 *
 * @param app - The Nest application, before it listens.
 * @returns Resolves once the plugins are registered.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const instance = app.getHttpAdapter().getInstance();
  app.setGlobalPrefix(API_PREFIX);
  registerRequestId(instance);
  registerJsonBodyParser(instance);
  await app.register(helmet, { contentSecurityPolicy: false });
}
