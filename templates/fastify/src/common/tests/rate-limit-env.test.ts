import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseTrustProxy, rateLimitEnv } from '../http/rate-limit-env.js';

describe('parseTrustProxy', () => {
  it('trusts nothing when unset or empty', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('reads a list of specific proxies', () => {
    expect(parseTrustProxy('10.0.0.1, 192.168.0.0/16,loopback')).toEqual([
      '10.0.0.1',
      '192.168.0.0/16',
      'loopback',
    ]);
  });

  it.each([
    'true',
    '*',
    '1',
    '0',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.1,*',
    'not-an-ip',
  ])('refuses %s', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
  });
});

describe('rateLimitEnv', () => {
  const schema = z.object(rateLimitEnv);

  it('has a default for everything, 300 requests per 60 seconds', () => {
    expect(schema.parse({})).toEqual({
      RATE_LIMIT_MAX: 300,
      RATE_LIMIT_WINDOW_SECONDS: 60,
      TRUST_PROXY: false,
    });
  });

  it('takes the configured values and rejects a bad one', () => {
    expect(
      schema.parse({
        RATE_LIMIT_MAX: '5',
        RATE_LIMIT_WINDOW_SECONDS: '10',
        TRUST_PROXY: '10.0.0.1',
      }),
    ).toEqual({
      RATE_LIMIT_MAX: 5,
      RATE_LIMIT_WINDOW_SECONDS: 10,
      TRUST_PROXY: ['10.0.0.1'],
    });
    expect(schema.safeParse({ RATE_LIMIT_MAX: '0' }).success).toBe(false);
    expect(schema.safeParse({ TRUST_PROXY: 'true' }).success).toBe(false);
  });
});
