import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../../test/create-app.js';

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('answers exactly the bare status, outside the envelope', async () => {
    app = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');
  });

  it('an unknown route still answers the 404 envelope', async () => {
    app = await createTestApp();

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
    app = await createTestApp([], (builder) => builder, {
      RATE_LIMIT_MAX: '1',
    });

    await app.inject({ method: 'GET', url: '/api/v1/hello' });
    const limited = await app.inject({ method: 'GET', url: '/api/v1/hello' });
    const health = await app.inject({ method: 'GET', url: '/api/health' });

    expect(limited.statusCode).toBe(429);
    expect(health.statusCode).toBe(200);
    expect(health.body).toBe('{"status":"ok"}');
  });
});
