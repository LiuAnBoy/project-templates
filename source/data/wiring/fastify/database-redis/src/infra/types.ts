import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { Redis } from 'ioredis';

import type { DependencyCheck } from '../common/dependency-checks.js';
import type { Database, DatabaseTransaction } from '../db/database.js';
import type { TransactionRunner } from '../db/types.js';

/** What the process depends on, as `createInfra` hands it to `main.ts`. */
export type Infra = {
  /** Run by the health route and, before the server listens, by `main.ts`; one per store. */
  checks: readonly DependencyCheck[];
  /** The shared store of the rate limit, counting in Redis. */
  rateLimitStore?: FastifyRateLimitStoreCtor;
  /** The database client, for the factories `main.ts` wires. */
  db: Database;
  /** Opens a transaction; the service owns its scope and passes the handle down. */
  transactions: TransactionRunner<DatabaseTransaction>;
  /** The Redis client, for the factories `main.ts` wires. */
  redis: Redis;
  /** Releases what `createInfra` opened; called on shutdown and after a failed start. */
  close: () => Promise<void>;
};
