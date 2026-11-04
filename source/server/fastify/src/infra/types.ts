import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';

import type { DependencyCheck } from '../common/dependency-checks.js';

/** What the process depends on, as `createInfra` hands it to `main.ts`. */
export type Infra = {
  /** Run by the health route and, before the server listens, by `main.ts`. */
  checks: readonly DependencyCheck[];
  /** The shared store of the rate limit; omitted, the counts stay in process memory. */
  rateLimitStore?: FastifyRateLimitStoreCtor;
  /** Releases what `createInfra` opened; called on shutdown and after a failed start. */
  close: () => Promise<void>;
};
