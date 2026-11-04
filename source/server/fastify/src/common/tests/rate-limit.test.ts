import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import { buildServer } from '../../server.js';
import { createHelloModule } from '../../hello/routes.js';
import { createStaticGreeter } from '../../hello/greeter.js';

const TOO_MANY = '{"success":false,"payload":{"message":"too many requests"}}';

let app: Awaited<ReturnType<typeof buildServer>> | undefined;

/**
 * Builds the real server with a limit small enough to hit.
 *
 * @param options - The settings under test.
 * @returns The server.
 */
async function serve(options: Parameters<typeof buildServer>[0] = {}) {
  app = await buildServer({
    logLevel: 'silent',
    modules: [createHelloModule({ greeter: createStaticGreeter() })],
    ...options,
  });
  return app;
}

/**
 * Sends one request to hello from a socket address and forwarded address.
 *
 * @param server - The server.
 * @param forwarded - The `x-forwarded-for` value to send, if any.
 * @returns The response.
 */
function hello(
  server: Awaited<ReturnType<typeof buildServer>>,
  forwarded?: string,
) {
  return server.inject({
    method: 'GET',
    url: '/api/v1/hello',
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
    const server = await serve({ rateLimit: { max: 2, windowSeconds: 60 } });

    const response = await hello(server);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      '{"success":true,"payload":{"data":{"message":"hello world!!"}}}',
    );
  });

  it('answers the request past the limit with the exact failure envelope', async () => {
    const server = await serve({ rateLimit: { max: 2, windowSeconds: 60 } });

    await hello(server);
    await hello(server);
    const response = await hello(server);

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe(TOO_MANY);
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('follows the configured values', async () => {
    const config = loadConfig({
      ...process.env,
      RATE_LIMIT_MAX: '1',
      RATE_LIMIT_WINDOW_SECONDS: '30',
    });
    const server = await serve({
      rateLimit: {
        max: config.RATE_LIMIT_MAX,
        windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
      },
    });

    expect((await hello(server)).statusCode).toBe(200);
    expect((await hello(server)).statusCode).toBe(429);
  });

  it('counts a request to an unknown path against the same limit', async () => {
    const server = await serve({ rateLimit: { max: 2, windowSeconds: 60 } });
    const unknown = () =>
      server.inject({ method: 'GET', url: '/nope', remoteAddress: '10.1.1.1' });

    expect((await unknown()).statusCode).toBe(404);
    expect((await hello(server)).statusCode).toBe(200);
    const response = await unknown();

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe(TOO_MANY);
  });

  it('exempts a route that opts out', async () => {
    const server = await serve({
      rateLimit: { max: 1, windowSeconds: 60 },
      modules: [
        async (app) => {
          app.get('/probe', { config: { rateLimit: false } }, () => 'ok');
        },
      ],
    });
    const probe = () => server.inject({ method: 'GET', url: '/api/v1/probe' });

    expect((await probe()).statusCode).toBe(200);
    expect((await probe()).statusCode).toBe(200);
    expect((await probe()).statusCode).toBe(200);
  });

  it('allows 300 requests per client by default', async () => {
    const server = await serve();

    for (let n = 0; n < 300; n += 1) {
      expect((await hello(server)).statusCode).toBe(200);
    }
    expect((await hello(server)).statusCode).toBe(429);
  });

  it('gives a forged x-forwarded-for no new bucket when no proxy is trusted', async () => {
    const server = await serve({ rateLimit: { max: 2, windowSeconds: 60 } });

    await hello(server, '1.1.1.1');
    await hello(server, '2.2.2.2');
    const response = await hello(server, '3.3.3.3');

    expect(response.statusCode).toBe(429);
    expect(response.body).toBe(TOO_MANY);
  });

  it('counts the forwarded address once a proxy is trusted', async () => {
    const server = await serve({
      trustProxy: ['10.1.1.1'],
      rateLimit: { max: 1, windowSeconds: 60 },
    });

    expect((await hello(server, '1.1.1.1')).statusCode).toBe(200);
    expect((await hello(server, '2.2.2.2')).statusCode).toBe(200);
    expect((await hello(server, '1.1.1.1')).statusCode).toBe(429);
  });

  it('ignores the forwarded header from an address that is not a trusted proxy', async () => {
    const server = await serve({
      trustProxy: ['10.9.9.9'],
      rateLimit: { max: 1, windowSeconds: 60 },
    });

    expect((await hello(server, '1.1.1.1')).statusCode).toBe(200);
    expect((await hello(server, '2.2.2.2')).statusCode).toBe(429);
  });
});
