import type { FastifyPluginAsync } from 'fastify';

import {
  createHealthProbe,
  type DependencyCheck,
} from '../common/dependency-checks.js';

/** The path of the health route, which sits outside `/api/v1`. */
export const HEALTH_PATH = '/api/health';

/** Options of `healthRoutes`. */
export type HealthOptions = {
  /** The dependency checks; none means the route answers 200 with no check. */
  checks?: readonly DependencyCheck[];
};

/**
 * The health probe, mounted by `buildServer` on the root, not under `/api/v1`.
 *
 * Envelope exception: a probe answers a bare status so a load balancer can read
 * it, so this route does not call `success()`. It is public and stays public
 * when authentication is added, and it is exempt from the rate limit
 * (`config: { rateLimit: false }`): a probe answered 429 reads as a dead
 * service. It runs the dependency checks through one shared probe: concurrent
 * requests share one run and its result is reused for a second, because an
 * exempt route must not cost a store round trip per request. All passing, or no
 * checks at all, answers 200 `{"status":"ok"}`; any failure answers 503
 * `{"status":"unavailable"}` with no check name in the body, and the log names it.
 *
 * @param app - The root instance.
 * @param options - The dependency checks.
 * @returns Resolves once the route is registered.
 */
export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (
  app,
  options,
) => {
  const probe = createHealthProbe(options.checks ?? [], {
    onFailure: (names) =>
      app.log.error({ dependencies: names }, 'dependency unavailable'),
  });
  app.get(
    HEALTH_PATH,
    { config: { rateLimit: false } },
    async (_request, reply) => {
      if (await probe()) return { status: 'ok' };
      return reply.code(503).send({ status: 'unavailable' });
    },
  );
};
