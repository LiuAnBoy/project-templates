import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../server.js';

let app: Awaited<ReturnType<typeof buildServer>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('answers exactly the bare status, outside the envelope', async () => {
    app = await buildServer({ logLevel: 'silent' });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');
  });

  it('an unknown route still answers the 404 envelope', async () => {
    app = await buildServer({ logLevel: 'silent' });

    const moved = await app.inject({
      method: 'GET',
      url: '/api/v1/no-such-route',
    });

    expect(moved.statusCode).toBe(404);
    expect(moved.body).toBe(
      '{"success":false,"payload":{"message":"not found"}}',
    );
  });

  it('still answers 200 for a client that is over the rate limit', async () => {
    app = await buildServer({
      logLevel: 'silent',
      rateLimit: { max: 1, windowSeconds: 60 },
    });
    const get = (url: string) => app!.inject({ method: 'GET', url });

    await get('/api/v1/nope');
    const limited = await get('/api/v1/nope');
    const health = await get('/api/health');

    expect(limited.statusCode).toBe(429);
    expect(health.statusCode).toBe(200);
    expect(health.body).toBe('{"status":"ok"}');
  });
});
