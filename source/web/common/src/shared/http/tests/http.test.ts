import {
  AxiosError,
  AxiosHeaders,
  CanceledError,
  isCancel,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HttpError,
  NetworkError,
  TimeoutError,
  getErrorMessage,
} from '../errors';
import {
  http,
  httpClient,
  setAuthTokenProvider,
  setUnauthorizedHandler,
} from '../http';

type Handler = (config: InternalAxiosRequestConfig) => {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/** Replace the transport: every request is answered by `handler`, or rejected when it throws. */
function mockTransport(handler: Handler) {
  const seen: InternalAxiosRequestConfig[] = [];
  httpClient.defaults.adapter = async (config) => {
    seen.push(config);
    const reply = handler(config);
    return {
      data: reply.body,
      status: reply.status ?? 200,
      statusText: '',
      headers: new AxiosHeaders(reply.headers),
      config,
    };
  };
  return seen;
}

const ok = (data: unknown) => ({ body: { success: true, payload: { data } } });

describe('http wrapper', () => {
  beforeEach(() => {
    setAuthTokenProvider(null);
    setUnauthorizedHandler(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps payload.data and drops empty query values', async () => {
    const seen = mockTransport(() => ok({ message: 'hi' }));
    const data = await http.get<{ message: string }>('/hello', {
      q: 'a',
      empty: undefined,
      none: null,
      zero: 0,
    });
    expect(data).toEqual({ message: 'hi' });
    expect(seen[0].params).toEqual({ q: 'a', zero: 0 });
  });

  it('resolves a write that answers success only to undefined', async () => {
    mockTransport(() => ({ body: { success: true } }));
    await expect(http.post('/things', { a: 1 })).resolves.toBeUndefined();
  });

  it('returns a list with its paging and rejects a list without it', async () => {
    mockTransport(() => ({
      body: {
        success: true,
        payload: { data: [1, 2], page: 1, page_size: 2, total_count: 5 },
      },
    }));
    await expect(http.list<number>('/numbers')).resolves.toEqual({
      items: [1, 2],
      page: 1,
      pageSize: 2,
      totalCount: 5,
    });

    mockTransport(() => ok([1, 2]));
    await expect(http.list('/numbers')).rejects.toBeInstanceOf(HttpError);
  });

  it('reads every page with getAllPages', async () => {
    const seen = mockTransport((config) => {
      const page = (config.params as { page: number }).page;
      return {
        body: {
          success: true,
          payload: {
            data: page === 1 ? [1, 2] : [3],
            page,
            page_size: 2,
            total_count: 3,
          },
        },
      };
    });
    await expect(http.getAllPages<number>('/numbers')).resolves.toEqual([
      1, 2, 3,
    ]);
    expect(seen).toHaveLength(2);
  });

  it('throws an HttpError built from a failure body', async () => {
    mockTransport(() => ({
      status: 503,
      body: { success: false, payload: { message: 'try again shortly' } },
      headers: { 'x-request-id': 'req-1', 'retry-after': '7' },
    }));
    const error = await http.get('/hello').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 503,
      message: 'try again shortly',
      requestId: 'req-1',
      retryAfter: 7,
    });
    expect(getErrorMessage(error)).toBe('try again shortly');
  });

  it('never follows an absolute path to another host', async () => {
    const seen = mockTransport(() => ok(null));
    await http.get('https://other.example/steal');
    await http.get('//other.example/steal');
    for (const config of seen) {
      expect(httpClient.getUri(config)).toMatch(/^\/api\/v1\//);
    }
  });

  it('throws an HttpError when a 2xx body is not the envelope', async () => {
    mockTransport(() => ({ body: '<html></html>' }));
    await expect(http.get('/hello')).rejects.toBeInstanceOf(HttpError);
  });

  it('throws NetworkError when no answer arrives', async () => {
    httpClient.defaults.adapter = async () => {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK);
    };
    const error = await http.get('/hello').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(TimeoutError);
  });

  it('throws TimeoutError on a timeout and sends the per-call timeout', async () => {
    let timeout: number | undefined;
    httpClient.defaults.adapter = async (config) => {
      timeout = config.timeout;
      throw new AxiosError('timeout', AxiosError.ECONNABORTED);
    };
    const error = await http
      .get('/hello', undefined, { timeoutMs: 1234 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(NetworkError);
    expect(timeout).toBe(1234);
  });

  it('passes a cancellation through untouched', async () => {
    const canceled = new CanceledError('canceled');
    httpClient.defaults.adapter = async () => {
      throw canceled;
    };
    const error = await http
      .get('/hello', undefined, { signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(error).toBe(canceled);
    expect(isCancel(error)).toBe(true);
  });

  it('runs the 401 handler and still rejects', async () => {
    mockTransport(() => ({
      status: 401,
      body: { success: false, payload: { message: 'sign in first' } },
    }));
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(http.get('/me')).rejects.toBeInstanceOf(HttpError);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      status: 401,
      error: { message: 'sign in first' },
    });
  });

  it('sends the bearer token from the provider, awaiting a promise', async () => {
    const seen = mockTransport(() => ok(null));
    setAuthTokenProvider(async () => 'token-1');
    await http.get('/me');
    expect(seen[0].headers.get('Authorization')).toBe('Bearer token-1');

    setAuthTokenProvider(() => undefined);
    await http.get('/me');
    expect(seen[1].headers.has('Authorization')).toBe(false);
  });
});
