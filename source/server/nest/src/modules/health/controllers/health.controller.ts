import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { RawResponse } from '../../../common/http/decorators/raw-response.decorator.js';

/** The path of the liveness route, which sits outside the global prefix. */
export const HEALTH_PATH = 'api/health';

/**
 * The liveness probe. It is public and stays public when authentication is
 * added, and it is exempt from the rate limit: a probe that is answered 429
 * reads as a dead service.
 */
@Controller(HEALTH_PATH)
export class HealthController {
  /**
   * `GET /api/health`, outside `/api/v1`.
   *
   * Envelope exception: a probe answers a bare status so a load balancer can
   * read it, hence `@RawResponse()`. It touches no dependency, because none
   * ships; a data overlay adds its checks and answers 503
   * `{"status":"unavailable"}` when one is down.
   *
   * @returns The bare liveness body.
   */
  @RawResponse()
  @SkipThrottle()
  @Get()
  get(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
