import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * A mountable piece of the API: a Fastify plugin that registers the routes of
 * one domain. `buildServer` mounts each one under `/api/v1`.
 */
export type ServerModule = FastifyPluginAsyncZod;
