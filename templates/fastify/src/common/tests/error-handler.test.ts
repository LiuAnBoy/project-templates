import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { bounded } from '../concurrency/bounded.js';
import { AppError } from '../errors/app-error.js';
import { FAILURES } from '../errors/failures.js';
import { buildServer } from '../../server.js';

type App = Awaited<ReturnType<typeof buildServer>>;

/** The failure envelope for a table entry. */
const failureBody = (message: string): string =>
  JSON.stringify({ success: false, payload: { message } });

describe('error handling', () => {
  let app: App;

  beforeEach(async () => {
    app = await buildServer({ logLevel: 'silent' });
    app.get('/api/v1/__boom', async () => {
      throw new Error('secret detail: /etc/passwd SELECT * FROM users');
    });
    app.get('/api/v1/__down', async () => {
      throw new Error('query failed', {
        cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
      });
    });
    app.get('/api/v1/__hung', async () =>
      bounded(new Promise<never>(() => undefined), 10, 'database'),
    );
    app.get('/api/v1/__app-error', async () => {
      throw new AppError('forbidden');
    });
    app.get(
      '/api/v1/__validated',
      { schema: { querystring: z.object({ n: z.coerce.number().int() }) } },
      async () => ({}),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers an unknown route with the 404 entry of the table', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nothing-here',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe(failureBody(FAILURES.notFound.message));
  });

  it('answers an unexpected error with the fixed 500 text and no internal detail', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/__boom' });

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe(failureBody(FAILURES.internal.message));
    expect(response.body).not.toContain('passwd');
    expect(response.body).not.toContain('SELECT');
  });

  it('answers a dependency outage with 503', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/__down' });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(failureBody(FAILURES.unavailable.message));
  });

  it('answers a bounded() timeout with 503', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/__hung' });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(failureBody(FAILURES.unavailable.message));
  });

  it('answers an AppError with its own table entry', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__app-error',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toBe(failureBody(FAILURES.forbidden.message));
  });

  it('answers a validation failure with the fixed 400 text, not the issue list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__validated?n=abc',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe(failureBody(FAILURES.invalidRequest.message));
  });

  it('answers a malformed JSON body with the 400 entry and an empty body with success', async () => {
    app.post('/api/v1/__echo', async (request) => ({ body: request.body }));

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/__echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":',
    });
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/__echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toBe(failureBody(FAILURES.invalidRequest.message));
    expect(empty.statusCode).toBe(200);
  });
});
