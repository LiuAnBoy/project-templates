/**
 * `pnpm db:migrate`: applies every migration the database has not recorded and
 * prints what it applied. The only way a shared database changes. Run it once
 * per deploy, before the new code starts.
 */
import { openStore } from './adapter.mjs';
import { exitOnError, runMigrate } from './runner.mjs';

await exitOnError(runMigrate(openStore));
