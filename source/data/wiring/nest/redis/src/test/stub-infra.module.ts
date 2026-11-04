import { Global, Module } from '@nestjs/common';

import type { DependencyCheck } from '../common/dependency-checks.js';
import {
  DEPENDENCY_CHECKS,
  RATE_LIMIT_STORAGE,
  REDIS,
} from '../infra/tokens.js';

/** The properties Nest reads off every provider to find lifecycle hooks, and that a promise probe reads. */
const PROBED: ReadonlySet<string> = new Set([
  'then',
  'onModuleInit',
  'onModuleDestroy',
  'onApplicationBootstrap',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

/**
 * A stand-in for something the ordinary tests must not touch: it resolves, so a
 * service that injects it compiles, and fails with a clear message on first use.
 *
 * @param token - Which provider it stands in for, named in the message.
 * @returns An object that throws on any property read except the ones Nest and promises probe.
 */
function unavailable(token: string): object {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key === 'symbol' || PROBED.has(key)) return undefined;
        throw new Error(
          `${token} is not available in createTestApp: override it, for example overrideProvider(${token}).useValue(fake)`,
        );
      },
    },
  );
}

/**
 * Replaces `InfraModule` in tests: no checks, no shared storage, and a Redis
 * client that throws when used, so the ordinary tests need no service, whatever
 * overlay the project has. A test that wants a fake overrides the `REDIS`
 * provider on top of this, or a check through `DEPENDENCY_CHECKS`.
 */
@Global()
@Module({
  providers: [
    { provide: DEPENDENCY_CHECKS, useValue: [] as DependencyCheck[] },
    { provide: RATE_LIMIT_STORAGE, useValue: undefined },
    { provide: REDIS, useFactory: () => unavailable('REDIS') },
  ],
  exports: [DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE, REDIS],
})
export class StubInfraModule {}
