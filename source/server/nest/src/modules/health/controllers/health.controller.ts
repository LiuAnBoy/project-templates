import { Controller, Get, Inject, Logger, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import {
  createHealthProbe,
  type DependencyCheck,
  type HealthProbe,
} from '../../../common/dependency-checks.js';
import { RawResponse } from '../../../common/http/decorators/raw-response.decorator.js';
import { DEPENDENCY_CHECKS } from '../../../infra/tokens.js';

/** The path of the health route, which sits outside the global prefix. */
export const HEALTH_PATH = 'api/health';

/**
 * The health probe. It is public and stays public when authentication is
 * added, and it is exempt from the rate limit: a probe that is answered 429
 * reads as a dead service.
 */
@Controller(HEALTH_PATH)
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly probe: HealthProbe;

  constructor(@Inject(DEPENDENCY_CHECKS) checks: readonly DependencyCheck[]) {
    this.probe = createHealthProbe(checks, {
      onFailure: (names) =>
        this.logger.error(`dependency unavailable: ${names.join(', ')}`),
    });
  }

  /**
   * `GET /api/health`, outside `/api/v1`.
   *
   * Envelope exception: a probe answers a bare status so a load balancer can
   * read it, hence `@RawResponse()`. It runs the dependency checks of
   * `InfraModule` through one shared probe (concurrent requests share one run,
   * and its result is reused for a second), because the route is exempt from
   * the limit and must not cost a store round trip per request. All passing, or
   * no checks at all, answers 200 `{"status":"ok"}`; any failure answers 503
   * `{"status":"unavailable"}` with no check name in the body.
   *
   * @param reply - The reply, only to set the status.
   * @returns The bare status body.
   */
  @RawResponse()
  @SkipThrottle()
  @Get()
  async get(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ status: 'ok' | 'unavailable' }> {
    if (await this.probe()) return { status: 'ok' };
    void reply.status(503);
    return { status: 'unavailable' };
  }
}
