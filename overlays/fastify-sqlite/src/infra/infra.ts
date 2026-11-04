import type { Config } from '../config.js';
import { createDatabase } from '../db/database.js';
import type { Infra } from './types.js';

/**
 * Builds what the process depends on from its configuration.
 *
 * The seam between the application and its stores: `main.ts` takes the checks,
 * the optional shared limiter store, the database and its runner, and the close
 * function from here, and nothing else names a store. The database is created
 * once, here; the project passes `db` and `transactions` to the factories it
 * wires in `main.ts`.
 *
 * @param config - The validated configuration; the store's settings are on it.
 * @returns The checks, the database, its runner and the close function.
 */
export function createInfra(config: Config): Infra {
  const database = createDatabase(config);
  return {
    checks: [{ name: database.name, run: database.probe }],
    db: database.db,
    transactions: database.transactions,
    close: database.close,
  };
}
