import { redisEnv } from '../redis/client.js';

/**
 * The environment variables of the infrastructure, spread into the config schema:
 * the store's connection settings, required and validated with the rest at boot.
 */
export const infraEnv = { ...redisEnv };
