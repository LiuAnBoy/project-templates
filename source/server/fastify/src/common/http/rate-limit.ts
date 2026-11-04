import rateLimit, { type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import { AppError } from '../errors/app-error.js';

/** What the limiter counts and where it keeps the counts. */
export type RateLimitOptions = {
  /** Requests allowed per client in one window. */
  max: number;
  /** The window, in seconds. */
  windowSeconds: number;
  /**
   * Where the counts live: the store class of `@fastify/rate-limit` is the
   * port. Omitted, one process's memory holds them, so a second instance needs
   * a shared store passed here.
   */
  store?: FastifyRateLimitStoreCtor;
};

/**
 * Limits every route per client.
 *
 * The client is `request.ip`, which Fastify takes from the socket unless
 * `trustProxy` says a proxy in front may be believed; there is no second place
 * that decides the address. A limit answers through the error handler, so the
 * body is the failure table's `tooManyRequests`, not the package's own; the
 * package's `Retry-After` header stays. To exempt a route, give it
 * `config: { rateLimit: false }`. All routes without their own `rateLimit`
 * config share one count per client.
 *
 * @param app - The root instance, before any route is registered.
 * @param options - The limit and, optionally, the store.
 * @returns The hook that counts a request to an unknown path against the same
 *   limit; Fastify runs no route hook for those, so the not-found handler
 *   takes this as its `preHandler`.
 */
export async function registerRateLimit(
  app: FastifyInstance,
  options: RateLimitOptions,
): Promise<preHandlerAsyncHookHandler> {
  await app.register(rateLimit, {
    global: true,
    max: options.max,
    timeWindow: options.windowSeconds * 1000,
    store: options.store,
    errorResponseBuilder: () => new AppError('tooManyRequests'),
  });
  return app.rateLimit();
}
