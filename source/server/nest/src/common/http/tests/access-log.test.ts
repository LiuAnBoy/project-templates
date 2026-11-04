import { Writable } from 'node:stream';

import { Controller, Get } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applicationOptions,
  configureApp,
  createHttpAdapter,
} from '../../../bootstrap.js';
import { UNMATCHED_ROUTE, accessLogOptions } from '../access-log.js';

/** A route with a path parameter, which can be a credential. */
@Controller('__items')
class ItemsController {
  @Get(':token')
  get(): Record<string, never> {
    return {};
  }
}

describe('access log', () => {
  let app: NestFastifyApplication;
  let lines: string[];

  beforeEach(async () => {
    lines = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [{ level: 'info', ...accessLogOptions() }, stream],
        }),
      ],
      controllers: [ItemsController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createHttpAdapter(),
      applicationOptions(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('records the route pattern and never the concrete URL', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/__items/secret-token-123?key=hunter2',
    });

    const log = lines.join('');
    expect(log).toContain('/api/v1/__items/:token');
    expect(log).not.toContain('secret-token-123');
    expect(log).not.toContain('hunter2');
  });

  it('records a placeholder for a path no route matched', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/typed-by-a-caller-4242' });

    const log = lines.join('');
    expect(log).toContain(UNMATCHED_ROUTE);
    expect(log).not.toContain('typed-by-a-caller-4242');
  });

  it('never writes a bearer token and carries the request id of the response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/__items/abc',
      headers: { authorization: 'Bearer sekrit-token' },
    });

    const log = lines.join('');
    expect(log).not.toContain('sekrit-token');
    expect(log).toContain(String(response.headers['x-request-id']));
  });
});
