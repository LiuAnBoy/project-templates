import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { DependencyCheck } from '../common/dependency-checks.js';
import type { Env } from '../config/env.js';
import { BoundedThrottlerStorage } from '../redis/bounded-throttler.storage.js';
import { createRedisClient, type RedisPort } from '../redis/client.js';
import { DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE, REDIS } from './tokens.js';

/** Internal token of the whole Redis port, which the providers below take apart. */
const REDIS_PORT = Symbol('REDIS_PORT');

/**
 * The seam between the application and what it depends on.
 *
 * It is global and exports three tokens: `DEPENDENCY_CHECKS`, read by the health
 * route and by `main.ts` before the server listens; `RATE_LIMIT_STORAGE`, which
 * `AppModule` hands to the limiter (the counts live in Redis, shared by every
 * instance, and a Redis that does not answer fails the request with 503); and
 * `REDIS`, the client a provider injects. The client is created once, here, from
 * the validated settings, and closed when the application shuts down.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createRedisClient({
          REDIS_URL: config.get('REDIS_URL', { infer: true }),
        }),
    },
    {
      provide: REDIS,
      inject: [REDIS_PORT],
      useFactory: (port: RedisPort) => port.client,
    },
    {
      provide: DEPENDENCY_CHECKS,
      inject: [REDIS_PORT],
      useFactory: (port: RedisPort): DependencyCheck[] => [
        { name: port.name, run: port.probe },
      ],
    },
    {
      provide: RATE_LIMIT_STORAGE,
      inject: [REDIS_PORT],
      useFactory: (port: RedisPort) =>
        new BoundedThrottlerStorage(
          new ThrottlerStorageRedisService(port.client),
        ),
    },
  ],
  exports: [DEPENDENCY_CHECKS, RATE_LIMIT_STORAGE, REDIS],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_PORT) private readonly redis: RedisPort) {}

  /**
   * Ends the Redis connection when the application closes, which is also what a
   * failed startup check does before it exits.
   *
   * @returns Resolves once the connection is closed.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.redis.close();
  }
}
