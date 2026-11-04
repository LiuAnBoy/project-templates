import { Global, Module } from '@nestjs/common';

import type { DependencyCheck } from '../common/dependency-checks.js';
import { DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE } from './tokens.js';

/**
 * The seam between the application and what it depends on.
 *
 * It is global and exports two tokens: `DEPENDENCY_CHECKS`, read by the health
 * route and by `main.ts` before the server listens, and `RATE_LIMIT_STORAGE`,
 * which `AppModule` hands to the limiter. This module has no checks and no
 * shared storage, so a project without a store behaves as the base does. A data
 * overlay replaces this file (and `infra-env.ts`) with one that provides its
 * store's checks, storage and clients; nothing else changes.
 */
@Global()
@Module({
  providers: [
    { provide: DEPENDENCY_CHECKS, useValue: [] as DependencyCheck[] },
    { provide: RATE_LIMIT_STORAGE, useValue: undefined },
  ],
  exports: [DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE],
})
export class InfraModule {}
