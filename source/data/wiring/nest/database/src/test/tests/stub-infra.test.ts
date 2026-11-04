import { Controller, Get, Inject } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE, TRANSACTION_RUNNER } from '../../infra/tokens.js';
import { createTestApp } from '../create-app.js';

/** A service-shaped consumer: it injects the two tokens a repository and a service take. */
@Controller('stub-probe')
class ProbeController {
  constructor(
    @Inject(DATABASE) readonly database: unknown,
    @Inject(TRANSACTION_RUNNER) readonly runner: unknown,
  ) {}

  @Get()
  get(): { injected: boolean } {
    return { injected: this.database !== undefined };
  }
}

describe('createTestApp with the database tokens', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('compiles a controller that injects DATABASE and TRANSACTION_RUNNER, and keeps the other routes working', async () => {
    app = await createTestApp([ProbeController]);

    const probe = await app.inject({ url: '/api/v1/stub-probe' });
    const hello = await app.inject({ url: '/api/v1/hello' });

    expect(probe.statusCode).toBe(200);
    expect(hello.statusCode).toBe(200);
  });

  it('fails with a clear message when a test uses the default database', async () => {
    app = await createTestApp([ProbeController]);
    const runner = app.get<{ run: () => unknown }>(TRANSACTION_RUNNER, {
      strict: false,
    });

    expect(() => runner.run()).toThrow(/override it/);
  });

  it('lets a test override the database with a fake', async () => {
    const fake = { fake: true };
    app = await createTestApp([ProbeController], (builder) =>
      builder.overrideProvider(DATABASE).useValue(fake),
    );

    expect(app.get(DATABASE, { strict: false })).toBe(fake);
  });
});
