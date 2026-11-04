import { describe, expect, it } from 'vitest';

import { frameworkStatus } from '../errors/framework-status.js';

describe('frameworkStatus', () => {
  it('accepts only an error Fastify raised, never another library statusCode', () => {
    const fastifyError = Object.assign(new Error('body is too large'), {
      code: 'FST_ERR_CTP_BODY_TOO_LARGE',
      statusCode: 413,
    });
    const upstreamError = Object.assign(new Error('unauthorized'), {
      statusCode: 401,
    });

    expect(frameworkStatus(fastifyError)).toBe(413);
    expect(frameworkStatus(upstreamError)).toBeUndefined();
    expect(
      frameworkStatus({ code: 'FST_ERR_X', statusCode: 400 }),
    ).toBeUndefined();
    expect(frameworkStatus('boom')).toBeUndefined();
  });
});
