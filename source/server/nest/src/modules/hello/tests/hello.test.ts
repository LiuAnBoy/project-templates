import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../../test/create-app.js';
import { GREETER, type Greeter } from '../ports/greeter.port.js';

describe('GET /api/v1/hello', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers exactly the success envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/hello' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      '{"success":true,"payload":{"data":{"message":"hello world!!"}}}',
    );
  });

  it('echoes a safe request id and replaces an unsafe one', async () => {
    const safe = await app.inject({
      method: 'GET',
      url: '/api/v1/hello',
      headers: { 'x-request-id': 'req-12345678' },
    });
    const unsafe = await app.inject({
      method: 'GET',
      url: '/api/v1/hello',
      headers: { 'x-request-id': 'bad id\twith spaces' },
    });

    expect(safe.headers['x-request-id']).toBe('req-12345678');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('wiring a different Greeter', () => {
  it('changes the answer with no other code touched', async () => {
    const fake: Greeter = { greet: () => 'hi from a fake' };
    const app = await createTestApp([], (builder) =>
      builder.overrideProvider(GREETER).useValue(fake),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/hello' });

    expect(response.json()).toEqual({
      success: true,
      payload: { data: { message: 'hi from a fake' } },
    });
    await app.close();
  });
});
