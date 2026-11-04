import type { IncomingMessage } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { getClientAddress } from './client-address.js';

/**
 * What the access log writes in place of a path no route matched.
 *
 * A fixed string rather than the path: an unmatched path is whatever the caller
 * typed, and a log is not a place for a caller's input verbatim.
 */
export const UNMATCHED_ROUTE = '<unmatched>';

/**
 * Where the route pattern is kept on the raw request for the log line to read.
 *
 * A symbol rather than a named property because the raw `IncomingMessage` is
 * shared with everything else that touches the request, and a plain name could
 * collide with one added later.
 */
const ROUTE_PATTERN = Symbol('routePattern');

/** The raw request, once `registerRoutePattern` has stamped it. */
type RawRequestWithRoute = IncomingMessage & { [ROUTE_PATTERN]?: string };

/**
 * Records on every raw request which route it matched, for the access log.
 *
 * The access log is written by pino-http, which nestjs-pino installs as Nest
 * middleware. Under the Fastify adapter that middleware sees the raw Node
 * request, which knows only the concrete URL. The pattern lives on
 * `request.routeOptions.url`, reachable only from a Fastify hook, so a hook
 * leaves it where the serializer can find it. A request that matched nothing is
 * stamped with the placeholder.
 *
 * Registration order is load-bearing: pino-http serialises the request the
 * moment its middleware runs, so this hook must be registered before the
 * middleware bridge. `createHttpAdapter` does that.
 *
 * @param instance - The Fastify instance behind the Nest application.
 */
export function registerRoutePattern(instance: FastifyInstance): void {
  instance.addHook('onRequest', (request, _reply, done) => {
    const url = request.routeOptions?.url;
    (request.raw as RawRequestWithRoute)[ROUTE_PATTERN] =
      request.is404 || !url ? UNMATCHED_ROUTE : url;
    done();
  });
}

/**
 * The route pattern a raw request was stamped with.
 *
 * Falls back to the placeholder rather than the URL for a request the hook
 * never saw: the failure mode of a missing hook must be a useless log line,
 * never a leaked one. Exported for `AllExceptionsFilter`, the other place a
 * request is written to the log.
 *
 * @param raw - The raw request, as pino-http hands it over.
 * @returns The pattern that matched, or the placeholder.
 */
export function routePattern(raw: IncomingMessage): string {
  return (raw as RawRequestWithRoute)[ROUTE_PATTERN] ?? UNMATCHED_ROUTE;
}

/**
 * The pino-http options the access log is written with, without a level.
 *
 * pino-http's own serializers log the whole request, headers included, which
 * would write every caller's bearer token to disk. These write the fields an
 * access log needs and nothing else. The URL is the route pattern, because a
 * path parameter can be a credential.
 *
 * @returns Options to spread into `pinoHttp`.
 */
export function accessLogOptions() {
  return {
    // Fastify's own request id, derived from a safe `x-request-id` header, so a
    // log line and the response the caller holds can be quoted against each other.
    genReqId: (request: IncomingMessage) => request.id as string,
    customProps: (request: { headers: IncomingMessage['headers'] }) => ({
      clientAddress: getClientAddress(request),
    }),
    serializers: {
      req: (request: { id: string; method: string; raw: IncomingMessage }) => ({
        id: request.id,
        method: request.method,
        url: routePattern(request.raw),
      }),
      res: (reply: { statusCode: number }) => ({
        statusCode: reply.statusCode,
      }),
    },
  };
}
