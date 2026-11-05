import type { FastifyRequest } from 'fastify';

import { getClientAddress } from './client-address.js';

/**
 * What the access log writes in place of a path no route matched.
 *
 * A fixed string rather than the path: an unmatched path is whatever the caller
 * typed, and a log is not a place for a caller's input verbatim.
 */
export const UNMATCHED_ROUTE = '<unmatched>';

/**
 * The route pattern a request matched, such as `/api/v1/items/:id`.
 *
 * The concrete URL is never logged: a path parameter can be a credential (an
 * order number, a share token), and the pattern says everything an operator
 * needs. A request that matched nothing is logged as `UNMATCHED_ROUTE`.
 *
 * @param request - The request being logged.
 * @returns The pattern, or the placeholder.
 */
function routePattern(request: FastifyRequest): string {
  const url = request.routeOptions?.url;
  return request.is404 || !url ? UNMATCHED_ROUTE : url;
}

/**
 * The pino serializers that write the access log lines.
 *
 * Fastify's default serializers log the whole URL and every header, which would
 * write each caller's bearer token to disk. These write the fields an access log
 * needs and nothing else.
 */
export const accessLogSerializers = {
  req: (request: FastifyRequest) => ({
    id: request.id,
    method: request.method,
    url: routePattern(request),
    clientAddress: getClientAddress(request),
  }),
  res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
};
