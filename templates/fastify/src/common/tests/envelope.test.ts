import { describe, expect, it } from 'vitest';

import { failure, paginated, success } from '../http/envelope.js';

describe('response envelope', () => {
  it('wraps one page of a list in the paged envelope', () => {
    expect(JSON.stringify(paginated([{ id: 1 }], 1, 20, 1))).toBe(
      '{"success":true,"payload":{"data":[{"id":1}],"page":1,"page_size":20,"total_count":1}}',
    );
  });

  it('answers an empty success with data as an empty object', () => {
    expect(JSON.stringify(success())).toBe(
      '{"success":true,"payload":{"data":{}}}',
    );
  });

  it('wraps a message in the failure envelope', () => {
    expect(JSON.stringify(failure('not found'))).toBe(
      '{"success":false,"payload":{"message":"not found"}}',
    );
  });
});
