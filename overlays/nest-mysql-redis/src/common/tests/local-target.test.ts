import { describe, expect, it } from 'vitest';

import { requireLocalUrl } from './local-target.js';

describe('requireLocalUrl', () => {
  it('hands out a URL on a local host', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const url = `postgresql://u:p@${host}:5432/app`;
      expect(requireLocalUrl('X', { X: url })).toBe(url);
    }
  });

  it('refuses a host that is not local, without printing the URL', () => {
    const url = 'postgresql://u:secret-pw@db.example.com:5432/app';
    expect(() => requireLocalUrl('X', { X: url })).toThrow(/not local/);
    expect(() => requireLocalUrl('X', { X: url })).not.toThrow(/secret-pw/);
  });

  it('refuses a URL whose query can move the server: host, hostaddr, socketPath, unix_socket', () => {
    for (const query of [
      'host=db.example.com',
      'hostaddr=10.0.0.5',
      'socketPath=/tmp/other.sock',
      'unix_socket=/tmp/other.sock',
    ]) {
      const url = `postgresql://u:secret-pw@localhost:5432/app?${query}`;
      expect(() => requireLocalUrl('X', { X: url })).toThrow(
        /query key outside/,
      );
      expect(() => requireLocalUrl('X', { X: url })).not.toThrow(/secret-pw/);
    }
  });

  it('lets the charset and the TLS keys through', () => {
    for (const query of [
      'charset=utf8mb4',
      'sslmode=require',
      'ssl=%7B%7D&charset=utf8mb4',
    ]) {
      const url = `mysql://u:p@localhost:3306/app?${query}`;
      expect(requireLocalUrl('X', { X: url })).toBe(url);
    }
  });

  it('fails when the variable is missing or is not a URL', () => {
    expect(() => requireLocalUrl('X', {})).toThrow(/X is required/);
    expect(() => requireLocalUrl('X', { X: 'not a url' })).toThrow(/not a URL/);
  });
});
