import type { IncomingHttpHeaders } from 'node:http';

/**
 * Reads one header value, collapsing the repeated-header form to the first.
 *
 * @param value - A raw header value.
 * @returns The first value, if any.
 */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The client address a rate limit or a log line counts against.
 *
 * Takes the headers rather than a framework request, so it does not name one
 * HTTP adapter. It is only correct behind a reverse proxy that overwrites
 * `x-forwarded-for` instead of forwarding what the client sent; with no proxy
 * the header is whatever the caller typed. `unknown` is a real bucket: a request
 * with neither header still has to be counted.
 *
 * @param request - Anything carrying the incoming headers.
 * @returns The first forwarded address, the real-ip header, or `unknown`.
 */
export function getClientAddress(request: {
  headers: IncomingHttpHeaders;
}): string {
  const forwarded = headerValue(request.headers['x-forwarded-for'])
    ?.split(',')[0]
    ?.trim();
  return (
    forwarded || headerValue(request.headers['x-real-ip'])?.trim() || 'unknown'
  );
}
