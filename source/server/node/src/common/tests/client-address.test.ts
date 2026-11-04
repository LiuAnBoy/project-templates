import { describe, expect, it } from 'vitest';

import { getClientAddress } from '../http/client-address.js';

describe('getClientAddress', () => {
  it('names an IP address from the headers', () => {
    expect(
      getClientAddress({
        headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      }),
    ).toBe('203.0.113.7');
    expect(getClientAddress({ headers: { 'x-real-ip': '2001:db8::1' } })).toBe(
      '2001:db8::1',
    );
  });

  it('never lets free text from a header reach a log line', () => {
    expect(
      getClientAddress({
        headers: { 'x-forwarded-for': 'attacker-typed\nfake log line' },
      }),
    ).toBe('unknown');
    expect(getClientAddress({ headers: {} })).toBe('unknown');
  });
});
