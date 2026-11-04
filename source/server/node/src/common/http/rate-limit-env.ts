import { isIP } from 'node:net';

import { z } from 'zod';

/**
 * The forwarded-address trust a Fastify instance accepts: `false` (the socket
 * address is the client) or the list of proxy addresses whose forwarded header
 * is believed. Fastify has no safe hop count: it fails a bare number closed.
 */
export type TrustProxy = false | string[];

/** The rate limit a server starts with when nothing configures it. */
export const DEFAULT_RATE_LIMIT = { max: 300, windowSeconds: 60 } as const;

/** Names `proxy-addr` (and so Fastify) accepts in place of an address. */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Tells whether one entry of a proxy list is a specific address or range.
 *
 * @param entry - An address, an `address/prefix` range or a named range.
 * @returns True for a specific entry; false for anything that would trust
 *   every caller (`*`, `true`, a `/0` range) or is not an address at all.
 */
function isSpecificProxy(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address ?? '');
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d+$/.test(prefix) && bits >= 1 && bits <= (family === 4 ? 32 : 128);
}

/**
 * Reads the `TRUST_PROXY` setting.
 *
 * Unset, empty or `false` means no proxy is trusted: the client is the socket address
 * and a forwarded header is ignored. Set it to a comma-separated list of the
 * addresses or ranges of the proxies in front of the server; the forwarded
 * header is believed only on a connection from one of them. A blanket value
 * (`true`, `*`, `0.0.0.0/0`) or a bare number is refused, because it lets any
 * caller choose the address the limit counts.
 *
 * @param raw - The raw environment value.
 * @returns The setting in the form Fastify's `trustProxy` takes.
 * @throws Error when the value is a blanket trust or is not a list of addresses.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  const entries = value.split(',').map((entry) => entry.trim());
  if (!entries.every(isSpecificProxy)) {
    throw new Error(
      'TRUST_PROXY is a comma-separated list of specific proxy addresses or ranges, never a blanket value or a count',
    );
  }
  return entries;
}

/**
 * The environment variables of the rate limit, to spread into an env schema.
 *
 * Every field has a default, so these variables never need a `.env`.
 */
export const rateLimitEnv = {
  RATE_LIMIT_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_RATE_LIMIT.max),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_RATE_LIMIT.windowSeconds),
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((value, ctx): TrustProxy => {
      try {
        return parseTrustProxy(value);
      } catch (error) {
        ctx.issues.push({
          code: 'custom',
          message:
            error instanceof Error ? error.message : 'invalid TRUST_PROXY',
          input: value,
        });
        return z.NEVER;
      }
    }),
};
