import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { registerErrorHandling } from './common/http/error-handler.js';
import { registerJsonBodyParser } from './common/http/json-body-parser.js';
import {
  DEFAULT_RATE_LIMIT,
  type TrustProxy,
} from './common/http/rate-limit-env.js';
import {
  registerRateLimit,
  type RateLimitOptions,
} from './common/http/rate-limit.js';
import {
  registerRequestId,
  resolveRequestId,
} from './common/http/request-id.js';
import { healthRoutes } from './health/routes.js';
import type { ServerModule } from './common/module.js';
import { createLogger } from './common/logging/logger-options.js';

/** The largest JSON body any route accepts, in bytes. */
const JSON_BODY_LIMIT_BYTES = 1_048_576;

/** Options of `buildServer`. */
export type ServerOptions = {
  /** Log level; `silent` in tests. */
  logLevel?: string;
  /** Where log records go; stdout when omitted. */
  logStream?: NodeJS.WritableStream;
  /**
   * Which forwarded addresses to believe: `false` (the default) counts the
   * socket address, a list of proxy addresses trusts the forwarded header on
   * a connection from one of them. It decides `request.ip`, which the limit counts; the
   * client address in the access log reads the headers as given and ignores it.
   */
  trustProxy?: TrustProxy;
  /** The request limit; 300 per 60 seconds, in process memory, when omitted. */
  rateLimit?: RateLimitOptions;
  /** The domains to mount under `/api/v1`; each is built by its own factory. */
  modules?: ServerModule[];
};

/**
 * Builds the Fastify instance without listening, so tests can use `app.inject()`.
 *
 * Everything the process needs is registered here and nowhere else, so a test
 * boots exactly what `main.ts` boots. Registration order matters: the rate
 * limit, the error handlers and the body parser go on the root instance before
 * any route, so every scope inherits them.
 *
 * @param options - Log level, log stream, proxy trust, rate limit and the modules to mount.
 * @returns The configured instance, not yet listening.
 */
export async function buildServer(options: ServerOptions = {}) {
  const app = Fastify({
    loggerInstance: createLogger(options.logLevel ?? 'info', options.logStream),
    // The incoming header is judged by resolveRequestId, not trusted.
    requestIdHeader: false,
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    trustProxy: options.trustProxy ?? false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerRequestId(app);
  const limitUnknownPaths = await registerRateLimit(
    app,
    options.rateLimit ?? DEFAULT_RATE_LIMIT,
  );
  registerErrorHandling(app, limitUnknownPaths);
  registerJsonBodyParser(app);
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(healthRoutes);

  for (const module of options.modules ?? []) {
    await app.register(module, { prefix: '/api/v1' });
  }

  return app;
}
