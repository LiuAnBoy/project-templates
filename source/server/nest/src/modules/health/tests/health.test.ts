import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHECK_TIMEOUT_MS,
  type DependencyCheck,
} from '../../../common/dependency-checks.js';
import { DEPENDENCY_CHECKS } from '../../../infra/tokens.js';
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

describe('GET /api/health with dependency checks', () => {
  const up: DependencyCheck = { name: 'secret-store', run: async () => 'up' };
  const down: DependencyCheck = {
    name: 'secret-store',
    run: () => Promise.reject(new Error('connect ECONNREFUSED secret-host:1')),
  };
  const hang: DependencyCheck = {
    name: 'secret-store',
    run: () => new Promise<never>(() => undefined),
  };

  /**
   * Boots the application with the given checks in place of the stub's none.
   *
   * @param checks - The fake checks.
   * @param env - Environment values for this app only.
   * @returns The application.
   */
  async function withChecks(
    checks: DependencyCheck[],
    env: Record<string, string> = {},
  ): Promise<NestFastifyApplication> {
    return createTestApp(
      [],
      (builder) => builder.overrideProvider(DEPENDENCY_CHECKS).useValue(checks),
      env,
    );
  }

  it('answers exactly the bare status when a passing check is installed', async () => {
    app = await withChecks([up]);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"status":"ok"}');
  });

  it('answers exactly 503 unavailable, naming no check, when a check fails', async () => {
    app = await withChecks([down]);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('{"status":"unavailable"}');
    expect(response.body).not.toContain('secret');
  });

  it(
    'answers 503 within the bound when a check hangs',
    async () => {
      app = await withChecks([hang]);
      const started = Date.now();

      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(503);
      expect(response.body).toBe('{"status":"unavailable"}');
      expect(Date.now() - started).toBeLessThan(CHECK_TIMEOUT_MS + 1000);
    },
    CHECK_TIMEOUT_MS + 3000,
  );

  it('stays exempt from the rate limit while a check fails', async () => {
    app = await withChecks([down], { RATE_LIMIT_MAX: '1' });

    await app.inject({ method: 'GET', url: '/api/v1/hello' });
    const limited = await app.inject({ method: 'GET', url: '/api/v1/hello' });
    const first = await app.inject({ method: 'GET', url: '/api/health' });
    const second = await app.inject({ method: 'GET', url: '/api/health' });

    expect(limited.statusCode).toBe(429);
    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(503);
  });
});
