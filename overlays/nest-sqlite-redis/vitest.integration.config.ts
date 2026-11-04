import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import swc from 'unplugin-swc';
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
  // esbuild does not emit decorator metadata, which Nest's injection reads; swc does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/tests/**/*.integration.test.ts'],
    environment: 'node',
    env: { ...env, LOG_LEVEL: 'silent' },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
