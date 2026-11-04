import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

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
 * The client address an access log line names.
 *
 * For logs only, never for a decision: the headers are whatever the caller
 * typed unless a reverse proxy overwrites them, so a forgeable address must not
 * pick a rate-limit bucket (the limit counts `request.ip`). Only a value that
 * parses as an IP address is returned; free text from a header never reaches a
 * log, and a request with no usable header is `unknown`.
 *
 * Takes the headers rather than a framework request, so it does not name one
 * HTTP adapter.
 *
 * @param request - Anything carrying the incoming headers.
 * @returns The first forwarded address or the real-ip header when it is an IP address, otherwise `unknown`.
 */
export function getClientAddress(request: {
  headers: IncomingHttpHeaders;
}): string {
  const forwarded = headerValue(request.headers['x-forwarded-for'])
    ?.split(',')[0]
    ?.trim();
  const candidate =
    forwarded || headerValue(request.headers['x-real-ip'])?.trim() || '';
  return isIP(candidate) !== 0 ? candidate : 'unknown';
}
