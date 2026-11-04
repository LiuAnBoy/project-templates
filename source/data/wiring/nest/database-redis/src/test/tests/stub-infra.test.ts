import { Controller, Get, Inject } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE, REDIS, TRANSACTION_RUNNER } from '../../infra/tokens.js';
import { createTestApp } from '../create-app.js';

/** A service-shaped consumer: it injects the three tokens a repository, a service and a cache provider take. */
@Controller('stub-probe')
class ProbeController {
  constructor(
    @Inject(DATABASE) readonly database: unknown,
    @Inject(TRANSACTION_RUNNER) readonly runner: unknown,
    @Inject(REDIS) readonly redis: unknown,
  ) {}

  @Get()
  get(): { injected: boolean } {
    return {
      injected: this.database !== undefined && this.redis !== undefined,
    };
  }
}

describe('createTestApp with the store tokens', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('compiles a controller that injects DATABASE, TRANSACTION_RUNNER and REDIS, and keeps the other routes working', async () => {
    app = await createTestApp([ProbeController]);

    const probe = await app.inject({ url: '/api/v1/stub-probe' });
    const hello = await app.inject({ url: '/api/v1/hello' });

    expect(probe.statusCode).toBe(200);
    expect(hello.statusCode).toBe(200);
  });

  it('fails with a clear message when a test uses a default store', async () => {
    app = await createTestApp([ProbeController]);
    const runner = app.get<{ run: () => unknown }>(TRANSACTION_RUNNER, {
      strict: false,
    });
    const redis = app.get<{ get: () => unknown }>(REDIS, { strict: false });

    expect(() => runner.run()).toThrow(/override it/);
    expect(() => redis.get()).toThrow(/override it/);
  });

  it('lets a test override a store with a fake', async () => {
    const fake = { fake: true };
    app = await createTestApp([ProbeController], (builder) =>
      builder.overrideProvider(REDIS).useValue(fake),
    );

    expect(app.get(REDIS, { strict: false })).toBe(fake);
  });
});
