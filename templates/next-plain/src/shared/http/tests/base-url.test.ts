// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiBase } from '../base-url';

describe('getApiBase on the server', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is an absolute URL built from API_HOST', () => {
    vi.stubEnv('API_HOST', 'http://api.test:9000');
    expect(getApiBase()).toBe('http://api.test:9000/api/v1');
  });

  it('defaults to port 8000 on localhost', () => {
    vi.stubEnv('API_HOST', '');
    delete process.env.API_HOST;
    expect(getApiBase()).toBe('http://localhost:8000/api/v1');
  });
});
