import { Controller, Get } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SkipThrottle } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../../test/create-app.js';

const TOO_MANY = '{"success":false,"payload":{"message":"too many requests"}}';

/** A second route, to show the limit is one count per client. */
@Controller('__other')
class OtherController {
  @Get()
  other(): string {
    return 'other';
  }

  @SkipThrottle()
  @Get('probe')
  probe(): string {
    return 'ok';
  }
}

let app: NestFastifyApplication | undefined;

/**
 * Boots the real application with the given environment.
 *
 * @param env - Environment values for this app only.
 * @returns The application.
 */
async function serve(
  env: Record<string, string> = {},
): Promise<NestFastifyApplication> {
  app = await createTestApp([OtherController], (builder) => builder, env);
  return app;
}

/**
 * Sends one request from a socket address and forwarded address.
 *
 * @param server - The application.
 * @param url - The path.
 * @param forwarded - The `x-forwarded-for` value to send, if any.
 * @returns The response.
 */
function get(server: NestFastifyApplication, url: string, forwarded?: string) {
  return server.inject({
    method: 'GET',
    url,
    remoteAddress: '10.1.1.1',
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('rate limit', () => {
  it('leaves a request under the limit untouched', async () => {
    const server = await serve({ RATE_LIMIT_MAX: '2' });

    const response = await get(server, '/api/v1/hello');

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      '{"success":true,"payload":{"data":{"message":"hello world!!"}}}',
    );
  });

  it('answers the request past the limit with the exact failure envelope', async () => {
    const server = await serve({ RATE_LIMIT_MAX: '2' });

    await get(server, '/api/v1/hello');
    await get(server, '/api/v1/hello');
    const response = await get(server, '/api/v1/hello');

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe(TOO_MANY);
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('follows the configured values and counts every route together', async () => {
    const server = await serve({
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_SECONDS: '30',
    });

    expect((await get(server, '/api/v1/hello')).statusCode).toBe(200);
    expect((await get(server, '/api/v1/__other')).statusCode).toBe(200);
    expect((await get(server, '/api/v1/hello')).statusCode).toBe(429);
  });

  it('allows 300 requests per client by default', async () => {
    const server = await serve();

    for (let n = 0; n < 300; n += 1) {
      expect((await get(server, '/api/v1/hello')).statusCode).toBe(200);
    }
    expect((await get(server, '/api/v1/hello')).statusCode).toBe(429);
  });

  it('exempts a route decorated with SkipThrottle', async () => {
    const server = await serve({ RATE_LIMIT_MAX: '1' });

    for (let n = 0; n < 3; n += 1) {
      expect((await get(server, '/api/v1/__other/probe')).statusCode).toBe(200);
    }
  });

  it('gives a forged x-forwarded-for no new bucket when no proxy is trusted', async () => {
    const server = await serve({ RATE_LIMIT_MAX: '2' });

    await get(server, '/api/v1/hello', '1.1.1.1');
    await get(server, '/api/v1/hello', '2.2.2.2');
    const response = await get(server, '/api/v1/hello', '3.3.3.3');

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe(TOO_MANY);
  });

  it('counts the forwarded address once the proxy is trusted', async () => {
    const server = await serve({
      RATE_LIMIT_MAX: '1',
      TRUST_PROXY: '10.1.1.1',
    });

    expect((await get(server, '/api/v1/hello', '1.1.1.1')).statusCode).toBe(
      200,
    );
    expect((await get(server, '/api/v1/hello', '2.2.2.2')).statusCode).toBe(
      200,
    );
    expect((await get(server, '/api/v1/hello', '1.1.1.1')).statusCode).toBe(
      429,
    );
  });

  it('ignores the forwarded header from an address that is not a trusted proxy', async () => {
    const server = await serve({
      RATE_LIMIT_MAX: '1',
      TRUST_PROXY: '10.9.9.9',
    });

    expect((await get(server, '/api/v1/hello', '1.1.1.1')).statusCode).toBe(
      200,
    );
    expect((await get(server, '/api/v1/hello', '2.2.2.2')).statusCode).toBe(
      429,
    );
  });
});
