import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { defineConfig } from 'vitest/config';

/**
 * The settings of `.env`, when the file exists, for the values the process
 * environment does not already hold: the store tests run against the services
 * the project's own `.env` names, never against the fake values of
 * `.env.example`.
 */
const dotenv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const env = Object.fromEntries(
  Object.entries(dotenv).filter(([name]) => process.env[name] === undefined),
);

export default defineConfig({
  test: {
    include: ['src/**/tests/**/*.integration.test.ts'],
    environment: 'node',
    env: { ...env, LOG_LEVEL: 'silent' },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
