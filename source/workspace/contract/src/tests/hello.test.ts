import { describe, expect, it } from 'vitest';

import { helloResponseSchema } from '../hello.js';

describe('helloResponseSchema', () => {
  it('parses the hello body', () => {
    const body = {
      success: true,
      payload: { data: { message: 'hello world!!' } },
    };

    expect(helloResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a body that is not the success envelope of a message', () => {
    expect(helloResponseSchema.safeParse({}).success).toBe(false);
    expect(
      helloResponseSchema.safeParse({
        success: false,
        payload: { message: 'x' },
      }).success,
    ).toBe(false);
    expect(
      helloResponseSchema.safeParse({
        success: true,
        payload: { data: { message: 42 } },
      }).success,
    ).toBe(false);
  });
});
