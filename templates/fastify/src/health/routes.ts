import type { FastifyPluginAsync } from 'fastify';

/** The path of the liveness route, which sits outside `/api/v1`. */
export const HEALTH_PATH = '/api/health';

/**
 * The liveness probe, mounted by `buildServer` on the root, not under `/api/v1`.
 *
 * Envelope exception: a probe answers a bare status so a load balancer can read
 * it, so this route does not call `success()`. It is public and stays public
 * when authentication is added, and it is exempt from the rate limit
 * (`config: { rateLimit: false }`): a probe answered 429 reads as a dead
 * service. It touches no dependency, because none ships; a data overlay adds
 * its checks and answers 503 `{"status":"unavailable"}` when one is down.
 *
 * @param app - The root instance.
 * @returns Resolves once the route is registered.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(HEALTH_PATH, { config: { rateLimit: false } }, async () => ({
    status: 'ok',
  }));
};
