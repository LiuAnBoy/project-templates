import { Controller, Get, Inject } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { REDIS } from '../../infra/tokens.js';
import { createTestApp } from '../create-app.js';

/** A service-shaped consumer: it injects the token a cache provider takes. */
@Controller('stub-probe')
class ProbeController {
  constructor(@Inject(REDIS) readonly redis: unknown) {}

  @Get()
  get(): { injected: boolean } {
    return { injected: this.redis !== undefined };
  }
}

describe('createTestApp with the Redis token', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('compiles a controller that injects REDIS, and keeps the other routes working', async () => {
    app = await createTestApp([ProbeController]);

    const probe = await app.inject({ url: '/api/v1/stub-probe' });
    const hello = await app.inject({ url: '/api/v1/hello' });

    expect(probe.statusCode).toBe(200);
    expect(hello.statusCode).toBe(200);
  });

  it('fails with a clear message when a test uses the default client', async () => {
    app = await createTestApp([ProbeController]);
    const redis = app.get<{ get: () => unknown }>(REDIS, { strict: false });

    expect(() => redis.get()).toThrow(/override it/);
  });

  it('lets a test override the client with a fake', async () => {
    const fake = { fake: true };
    app = await createTestApp([ProbeController], (builder) =>
      builder.overrideProvider(REDIS).useValue(fake),
    );

    expect(app.get(REDIS, { strict: false })).toBe(fake);
  });
});
