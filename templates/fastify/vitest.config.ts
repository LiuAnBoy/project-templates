import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The fake settings of `.env.example`, which the tests run with: a required
 * setting that `.env.example` leaves out fails the tests, so the file cannot
 * drift from the schema. `NODE_ENV` stays with the test runner.
 */
const exampleEnv = parseEnv(
  readFileSync(new URL('./.env.example', import.meta.url), 'utf8'),
);
delete exampleEnv.NODE_ENV;

export default defineConfig({
  test: {
    include: ['src/**/tests/**/*.test.ts'],
    // Store tests need a real service and run through `pnpm test:integration`.
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
    environment: 'node',
    env: exampleEnv,
  },
});
