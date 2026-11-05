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
import {
  createDatabase,
  type Database,
  type DatabaseTransaction,
} from '../db/database.js';
import type { DatabasePort } from '../db/types.js';
import { BoundedThrottlerStorage } from '../redis/bounded-throttler.storage.js';
import { createRedisClient, type RedisPort } from '../redis/client.js';
import {
  DATABASE,
  DEPENDENCY_CHECKS,
  RATE_LIMIT_STORAGE,
  REDIS,
  TRANSACTION_RUNNER,
} from './tokens.js';

/** Internal token of the whole database port, which the providers below take apart. */
const DATABASE_PORT = Symbol('DATABASE_PORT');

/** Internal token of the whole Redis port, which the providers below take apart. */
const REDIS_PORT = Symbol('REDIS_PORT');

/**
 * The seam between the application and what it depends on.
 *
 * It is global and exports five tokens: `DEPENDENCY_CHECKS`, read by the health
 * route and by `main.ts` before the server listens (one check per store);
 * `RATE_LIMIT_STORAGE`, which `AppModule` hands to the limiter (the counts live
 * in Redis, shared by every instance, and a Redis that does not answer fails
 * the request with 503); and `DATABASE`, `TRANSACTION_RUNNER` and `REDIS`, which
 * a repository, a service and a cache provider inject. Each store is created
 * once, here, from the validated settings, and closed when the application shuts
 * down.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createDatabase({
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
        }),
    },
    {
      provide: REDIS_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createRedisClient({
          REDIS_URL: config.get('REDIS_URL', { infer: true }),
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_PORT],
      useFactory: (port: DatabasePort<Database, DatabaseTransaction>) =>
        port.db,
    },
    {
      provide: TRANSACTION_RUNNER,
      inject: [DATABASE_PORT],
      useFactory: (port: DatabasePort<Database, DatabaseTransaction>) =>
        port.transactions,
    },
    {
      provide: REDIS,
      inject: [REDIS_PORT],
      useFactory: (port: RedisPort) => port.client,
    },
    {
      provide: DEPENDENCY_CHECKS,
      inject: [DATABASE_PORT, REDIS_PORT],
      useFactory: (
        database: DatabasePort<Database, DatabaseTransaction>,
        redis: RedisPort,
      ): DependencyCheck[] => [
        { name: database.name, run: database.probe },
        { name: redis.name, run: redis.probe },
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
  exports: [
    DATABASE,
    DEPENDENCY_CHECKS,
    RATE_LIMIT_STORAGE,
    REDIS,
    TRANSACTION_RUNNER,
  ],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_PORT)
    private readonly database: DatabasePort<Database, DatabaseTransaction>,
    @Inject(REDIS_PORT) private readonly redis: RedisPort,
  ) {}

  /**
   * Releases both stores when the application closes, which is also what a
   * failed startup check does before it exits.
   *
   * @returns Resolves once the connections are closed.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.database.close(), this.redis.close()]);
  }
}
