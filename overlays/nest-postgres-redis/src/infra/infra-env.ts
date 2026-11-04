import { databaseEnv } from '../db/database.js';
import { redisEnv } from '../redis/client.js';

/**
 * The environment variables of the infrastructure, spread into `envSchema`:
 * the connection settings of both stores, required and validated with the rest
 * at boot.
 */
export const infraEnv = { ...databaseEnv, ...redisEnv };
