import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

/** The typed process configuration. */
export type Config = z.infer<typeof envSchema>;

/**
 * Validates the environment once at boot.
 *
 * Every variable has a default for local development, so the server boots with
 * no `.env`. Add a variable when code reads it, and add it to `.env.example`
 * with a fake value.
 *
 * @param raw - The raw environment, normally `process.env`.
 * @returns The typed configuration.
 * @throws ZodError when a value is malformed.
 */
export function loadConfig(raw: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(raw);
}
