/**
 * `pnpm db:status`: lists the migrations that are still pending, and never writes.
 */
import { openStore } from './adapter.mjs';
import { exitOnError, runStatus } from './runner.mjs';

await exitOnError(runStatus(openStore));
