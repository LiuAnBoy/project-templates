import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createZodDto } from 'nestjs-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp } from '../../../test/create-app.js';
import { AppError } from '../../errors/app-error.js';
import { FAILURES } from '../../errors/failures.js';
import { paginated } from '../response.js';
import { RawResponse } from '../decorators/raw-response.decorator.js';

class NumberQuery extends createZodDto(
  z.object({ n: z.coerce.number().int() }),
) {}

/** Routes that fail or answer in the ways the tests need. */
@Controller('__fault')
class FaultController {
  @Get('boom')
  boom(): never {
    throw new Error('secret detail: /etc/passwd SELECT * FROM users');
  }

  @Get('down')
  down(): never {
    throw new Error('query failed', {
      cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
    });
  }

  @Get('app-error')
  appError(): never {
    throw new AppError('forbidden');
  }

  @Get('validated')
  validated(@Query() query: NumberQuery): { n: number } {
    return { n: query.n };
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Get('nothing')
  nothing(): undefined {
    return undefined;
  }

  @Get('page')
  page() {
    return paginated([{ id: 1 }], { page: 1, page_size: 20, total_count: 1 });
  }

  @RawResponse()
  @Get('raw')
  raw(): { status: string } {
    return { status: 'ok' };
  }
}

/** The failure envelope for a table entry. */
const failureBody = (message: string): string =>
  JSON.stringify({ success: false, payload: { message } });

describe('error handling and envelope', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await createTestApp([FaultController]);
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
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/boom',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe(failureBody(FAILURES.internal.message));
    expect(response.body).not.toContain('passwd');
    expect(response.body).not.toContain('SELECT');
  });

  it('answers a dependency outage with 503', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/down',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(failureBody(FAILURES.unavailable.message));
  });

  it('answers an AppError with its own table entry', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/app-error',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toBe(failureBody(FAILURES.forbidden.message));
  });

  it('answers a validation failure with the fixed 400 text, not the issue list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/validated?n=abc',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe(failureBody(FAILURES.invalidRequest.message));
  });

  it('answers a malformed JSON body with the 400 entry and an empty body with success', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/__fault/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":',
    });
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/__fault/echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toBe(failureBody(FAILURES.invalidRequest.message));
    expect(empty.statusCode).toBe(201);
  });

  it('answers a handler that returns nothing with data: {}', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/nothing',
    });

    expect(response.body).toBe('{"success":true,"payload":{"data":{}}}');
  });

  it('answers a list with the paging fields beside data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/page',
    });

    expect(response.body).toBe(
      '{"success":true,"payload":{"data":[{"id":1}],"page":1,"page_size":20,"total_count":1}}',
    );
  });

  it('leaves a @RawResponse() handler outside the envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__fault/raw',
    });

    expect(response.body).toBe('{"status":"ok"}');
  });
});
