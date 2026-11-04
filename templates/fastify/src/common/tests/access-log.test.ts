import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../server.js';
import { UNMATCHED_ROUTE } from '../http/access-log.js';

describe('access log', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let lines: string[];

  beforeEach(async () => {
    lines = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    app = await buildServer({ logLevel: 'info', logStream: stream });
    app.get('/api/v1/__items/:token', async () => ({}));
  });

  afterEach(async () => {
    await app.close();
  });

  it('records the route pattern and never the concrete URL', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/__items/secret-token-123?key=hunter2',
    });

    const log = lines.join('');
    expect(log).toContain('/api/v1/__items/:token');
    expect(log).not.toContain('secret-token-123');
    expect(log).not.toContain('hunter2');
  });

  it('records a placeholder for a path no route matched', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/typed-by-a-caller-4242' });

    const log = lines.join('');
    expect(log).toContain(UNMATCHED_ROUTE);
    expect(log).not.toContain('typed-by-a-caller-4242');
  });

  it('never writes a bearer token', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/__items/abc',
      headers: { authorization: 'Bearer sekrit-token' },
    });

    expect(lines.join('')).not.toContain('sekrit-token');
  });
});
