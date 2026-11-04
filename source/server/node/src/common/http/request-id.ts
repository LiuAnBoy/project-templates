import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

/**
 * An upstream request id is accepted only when it is conservative enough to be
 * safe in both a log line and a response header. Anything else is replaced
 * rather than sanitised, so a caller cannot smuggle structure into either.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * The id for one request: the caller's, if it is safe to repeat, or a new one.
 *
 * @param candidate - Whatever arrived in `x-request-id`.
 * @returns The id this request will be known by.
 */
export function resolveRequestId(candidate: unknown): string {
  const header = typeof candidate === 'string' ? candidate.trim() : undefined;
  return header && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

/**
 * Echoes every request's id back on its response.
 *
 * `onRequest` runs before guards and also covers a body the parser rejected and
 * a route that matched nothing, so every response carries the header.
 *
 * @param instance - The Fastify instance.
 */
export function registerRequestId(instance: FastifyInstance): void {
  instance.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
}
