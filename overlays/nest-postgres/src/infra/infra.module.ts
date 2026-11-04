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
import {
  DATABASE,
  DEPENDENCY_CHECKS,
  RATE_LIMIT_STORAGE,
  TRANSACTION_RUNNER,
} from './tokens.js';

/** Internal token of the whole database port, which the providers below take apart. */
const DATABASE_PORT = Symbol('DATABASE_PORT');

/**
 * The seam between the application and what it depends on.
 *
 * It is global and exports four tokens: `DEPENDENCY_CHECKS`, read by the health
 * route and by `main.ts` before the server listens; `RATE_LIMIT_STORAGE`, which
 * `AppModule` hands to the limiter (none here, so the counts stay in memory);
 * and `DATABASE` and `TRANSACTION_RUNNER`, which a repository and a service
 * inject. The database is created once, here, from the validated settings, and
 * closed when the application shuts down.
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
      provide: DEPENDENCY_CHECKS,
      inject: [DATABASE_PORT],
      useFactory: (
        port: DatabasePort<Database, DatabaseTransaction>,
      ): DependencyCheck[] => [{ name: port.name, run: port.probe }],
    },
    { provide: RATE_LIMIT_STORAGE, useValue: undefined },
  ],
  exports: [
    DATABASE,
    DEPENDENCY_CHECKS,
    RATE_LIMIT_STORAGE,
    TRANSACTION_RUNNER,
  ],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_PORT)
    private readonly database: DatabasePort<Database, DatabaseTransaction>,
  ) {}

  /**
   * Releases the database connections when the application closes, which is
   * also what a failed startup check does before it exits.
   *
   * @returns Resolves once the connections are closed.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
