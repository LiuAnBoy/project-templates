import { Global, Module } from '@nestjs/common';

import type { DependencyCheck } from '../common/dependency-checks.js';
import {
  DATABASE,
  DEPENDENCY_CHECKS,
  RATE_LIMIT_STORAGE,
  REDIS,
  TRANSACTION_RUNNER,
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
 * Replaces `InfraModule` in tests: no checks, no shared storage, and a database,
 * runner and Redis client that throw when used, so the ordinary tests need no
 * service, whatever overlay the project has. A test that wants a fake overrides
 * the `DATABASE`, `TRANSACTION_RUNNER` or `REDIS` provider on top of this, or a
 * check through `DEPENDENCY_CHECKS`.
 */
@Global()
@Module({
  providers: [
    { provide: DEPENDENCY_CHECKS, useValue: [] as DependencyCheck[] },
    { provide: RATE_LIMIT_STORAGE, useValue: undefined },
    { provide: DATABASE, useFactory: () => unavailable('DATABASE') },
    {
      provide: TRANSACTION_RUNNER,
      useFactory: () => unavailable('TRANSACTION_RUNNER'),
    },
    { provide: REDIS, useFactory: () => unavailable('REDIS') },
  ],
  exports: [
    DATABASE,
    DEPENDENCY_CHECKS,
    RATE_LIMIT_STORAGE,
    REDIS,
    TRANSACTION_RUNNER,
  ],
})
export class StubInfraModule {}
