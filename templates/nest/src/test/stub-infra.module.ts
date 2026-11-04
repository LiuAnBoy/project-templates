import { Global, Module } from '@nestjs/common';

import type { DependencyCheck } from '../common/dependency-checks.js';
import { DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE } from '../infra/tokens.js';

/**
 * Replaces `InfraModule` in tests: no checks and no shared storage, so the
 * ordinary tests need no service, whatever overlay the project has. A test that
 * wants a check overrides the `DEPENDENCY_CHECKS` provider on top of this.
 */
@Global()
@Module({
  providers: [
    { provide: DEPENDENCY_CHECKS, useValue: [] as DependencyCheck[] },
    { provide: RATE_LIMIT_STORAGE, useValue: undefined },
  ],
  exports: [DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE],
})
export class StubInfraModule {}
