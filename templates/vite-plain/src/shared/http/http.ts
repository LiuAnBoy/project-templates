/**
 * The only door to the API. This is the one file that imports `axios`; every
 * call returns the answer's data, never the axios response, and every failure
 * is thrown as an `HttpError`, `NetworkError` or `TimeoutError`, except a
 * cancellation, which is rethrown unchanged.
 *
 * The API answers one envelope:
 *   success  { "success": true,  "payload": { "data": ..., "page"?, "page_size"?, "total_count"? } }
 *   failure  { "success": false, "payload": { "message": "..." } }
 * A write may answer `{ "success": true }` alone; its call resolves to `undefined`.
 *
 * `shared/` never imports `modules/`, so behaviour that belongs to a feature
 * (the bearer token, the reaction to a 401) is registered at startup through
 * `setAuthTokenProvider` and `setUnauthorizedHandler`.
 */
import axios, {
  isCancel,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

import { getApiBase } from './base-url';
import { HttpError, NetworkError, TimeoutError } from './errors';

/** Timeout of a call that does not set its own. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Page size used by `getAllPages`. */
const ALL_PAGES_SIZE = 100;
/** Bound of the `getAllPages` loop: 200 pages of 100 rows. */
const ALL_PAGES_CAP = 200;

/** Query parameters; `undefined` and `null` values are dropped before sending. */
export type Query = Record<
  string,
  string | number | boolean | undefined | null
>;

/** Options every call accepts. */
export interface RequestOptions {
  /** Aborting it rejects the call with axios's `CanceledError` (see `isCancel`). */
  signal?: AbortSignal;
  /** Overrides the 15 s default for this call. */
  timeoutMs?: number;
}

/** One page of a list route. */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** Source of the bearer token; may answer later (a promise) while a session loads. */
export type AuthTokenProvider = () =>
  string | null | undefined | Promise<string | null | undefined>;

/** Reaction to a 401, registered by the module that owns sign-in. */
export type UnauthorizedHandler = (context: {
  status: 401;
  error: HttpError;
}) => void;

let authTokenProvider: AuthTokenProvider | null = null;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register where the bearer token comes from. Every request asks the provider;
 * when it answers a token, the request carries `Authorization: Bearer <token>`.
 *
 * @param provider The token source, or `null` to clear it.
 */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

/**
 * Register the reaction to a 401 answer (for example a redirect to sign-in).
 * The handler runs before the call rejects with the `HttpError`.
 *
 * @param handler The reaction, or `null` to clear it.
 */
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  unauthorizedHandler = handler;
}

/**
 * The configured axios instance. Exported for the wrapper's own tests (they swap
 * its adapter); application code never imports it.
 */
export const httpClient = axios.create({
  baseURL: getApiBase(),
  // A path that is absolute or protocol-relative is appended to the base, never
  // followed, so the bearer token cannot be sent to another host.
  allowAbsoluteUrls: false,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
  // Every status is handled in `send`, in one place.
  validateStatus: () => true,
});

httpClient.interceptors.request.use(async (config) => {
  // Resolved per request: on the Next.js server the base is an absolute URL.
  config.baseURL = getApiBase();
  const token = await authTokenProvider?.();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

/**
 * Check whether a value is a plain object.
 *
 * @param value Any value.
 * @returns True for non-null, non-array objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Drop `undefined` and `null` parameters.
 *
 * @param query The caller's parameters.
 * @returns The parameters worth sending, or `undefined` when none were given.
 */
function clean(
  query?: Query,
): Record<string, string | number | boolean> | undefined {
  if (!query) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/**
 * Parse a body that arrived as text.
 *
 * @param raw The response data.
 * @returns The parsed JSON, the value itself when it is not text, or `undefined` when the text is not JSON.
 */
function parseBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Read a header as a string.
 *
 * @param response The axios response.
 * @param name Lower-case header name.
 * @returns The header value, or `undefined` when absent.
 */
function header(response: AxiosResponse, name: string): string | undefined {
  const value: unknown = response.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read `Retry-After` as seconds.
 *
 * @param response The axios response.
 * @returns Seconds, or `null` when the header is absent or not a number.
 */
function retryAfterOf(response: AxiosResponse): number | null {
  const raw = header(response, 'retry-after');
  if (raw === undefined) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isNaN(seconds) ? null : seconds;
}

/**
 * Turn a transport failure into the wrapper's error types.
 *
 * @param error What axios rejected with.
 * @returns A `TimeoutError` for a timeout, else a `NetworkError`.
 */
function transportError(error: unknown): NetworkError {
  if (
    axios.isAxiosError(error) &&
    (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
  ) {
    return new TimeoutError(error);
  }
  return new NetworkError('Network request failed', error);
}

/**
 * Build the `HttpError` of a non-success answer.
 *
 * @param response The axios response.
 * @param body The parsed body.
 * @param fallback Message used when the body carries none.
 * @returns The error, carrying status, request id, retry delay and body.
 */
function failureOf(
  response: AxiosResponse,
  body: unknown,
  fallback: string,
): HttpError {
  const payload = isRecord(body) ? body.payload : undefined;
  const message =
    isRecord(payload) && typeof payload.message === 'string' && payload.message
      ? payload.message
      : fallback;
  return new HttpError(message, {
    status: response.status,
    requestId: header(response, 'x-request-id'),
    retryAfter: retryAfterOf(response),
    body,
  });
}

/**
 * Send a request and return the success envelope's payload.
 *
 * @param config Axios request config.
 * @param expectEnvelope False for a route that answers plain text.
 * @returns The raw response and the envelope's payload (empty for text routes).
 * @throws {HttpError} A non-2xx answer or a body that is not the envelope.
 * @throws {TimeoutError} No answer within the timeout.
 * @throws {NetworkError} No answer at all.
 */
async function send(
  config: AxiosRequestConfig,
  expectEnvelope = true,
): Promise<{ response: AxiosResponse; payload: Record<string, unknown> }> {
  let response: AxiosResponse;
  try {
    response = await httpClient.request(config);
  } catch (error) {
    // A cancellation is something the caller asked for, not a failure to report.
    if (isCancel(error)) throw error;
    throw transportError(error);
  }

  const body = parseBody(response.data);
  if (response.status < 200 || response.status >= 300) {
    const error = failureOf(
      response,
      body,
      `Request failed with status ${response.status}`,
    );
    if (response.status === 401) {
      unauthorizedHandler?.({ status: 401, error });
    }
    throw error;
  }
  if (!expectEnvelope) return { response, payload: {} };

  if (!isRecord(body) || body.success !== true) {
    throw failureOf(response, body, 'The response was not understood.');
  }
  if (body.payload === undefined) return { response, payload: {} };
  if (!isRecord(body.payload)) {
    throw failureOf(response, body, 'The response was not understood.');
  }
  return { response, payload: body.payload };
}

/**
 * Build the axios config shared by every call.
 *
 * @param method HTTP method.
 * @param path Path relative to the API base (`/api/v1`).
 * @param options Per-call options.
 * @param extra Method-specific fields (params, data, responseType).
 * @returns The axios config.
 */
function configOf(
  method: string,
  path: string,
  options: RequestOptions | undefined,
  extra: AxiosRequestConfig = {},
): AxiosRequestConfig {
  return {
    ...extra,
    method,
    url: path,
    signal: options?.signal,
    timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Send a request with a body and return the answer's `payload.data`.
 *
 * @param method HTTP method.
 * @param path Path relative to the API base (`/api/v1`).
 * @param body A JSON object or `FormData`.
 * @param options Per-call options.
 * @returns `payload.data`, or `undefined` when the answer has none.
 */
async function sendBody<T>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  const { payload } = await send(
    configOf(method, path, options, { data: body }),
  );
  return payload.data as T;
}

/**
 * The HTTP wrapper. Paths are relative to `/api/v1`, for example `http.get('/hello')`.
 */
export const http = {
  /**
   * GET a route that answers one object.
   *
   * @param path Path relative to the API base (`/api/v1`).
   * @param query Query parameters; empty values are dropped.
   * @param options Per-call options.
   * @returns `payload.data`.
   */
  get: async <T>(
    path: string,
    query?: Query,
    options?: RequestOptions,
  ): Promise<T> => {
    const { payload } = await send(
      configOf('GET', path, options, { params: clean(query) }),
    );
    return payload.data as T;
  },

  /**
   * GET one page of a list route.
   *
   * @param path Path relative to the API base (`/api/v1`).
   * @param query Query parameters; empty values are dropped.
   * @param options Per-call options.
   * @returns The rows and the paging fields (`page_size` and `total_count` camel-cased).
   * @throws {HttpError} When the paging fields are missing.
   */
  list: async <T>(
    path: string,
    query?: Query,
    options?: RequestOptions,
  ): Promise<Page<T>> => {
    const { response, payload } = await send(
      configOf('GET', path, options, { params: clean(query) }),
    );
    const {
      data,
      page,
      page_size: pageSize,
      total_count: totalCount,
    } = payload;
    if (
      !Array.isArray(data) ||
      typeof page !== 'number' ||
      typeof pageSize !== 'number' ||
      typeof totalCount !== 'number'
    ) {
      throw failureOf(
        response,
        response.data,
        'The response was not understood.',
      );
    }
    return { items: data as T[], page, pageSize, totalCount };
  },

  /**
   * GET a list whole: pages of 100 until `totalCount` rows are in or a page is
   * empty. Reaching the page bound short of `totalCount` throws instead of
   * returning a partial list.
   *
   * @param path Path relative to the API base (`/api/v1`).
   * @param query Query parameters; `page` and `page_size` are set here.
   * @param options Per-call options, applied to each page request.
   * @returns Every row.
   * @throws {HttpError} When the page bound is reached first.
   */
  getAllPages: async <T>(
    path: string,
    query?: Query,
    options?: RequestOptions,
  ): Promise<T[]> => {
    const rows: T[] = [];
    for (let page = 1; page <= ALL_PAGES_CAP; page += 1) {
      const result = await http.list<T>(
        path,
        { ...query, page, page_size: ALL_PAGES_SIZE },
        options,
      );
      rows.push(...result.items);
      if (result.items.length === 0 || rows.length >= result.totalCount) {
        return rows;
      }
    }
    throw new HttpError('The list is longer than the page bound.', {
      status: 200,
    });
  },

  /**
   * GET a route that answers plain text; a failure is still the JSON failure envelope.
   *
   * @param path Path relative to the API base (`/api/v1`).
   * @param query Query parameters; empty values are dropped.
   * @param options Per-call options.
   * @returns The response text.
   */
  getText: async (
    path: string,
    query?: Query,
    options?: RequestOptions,
  ): Promise<string> => {
    const { response } = await send(
      configOf('GET', path, options, {
        params: clean(query),
        responseType: 'text',
        transformResponse: (data: unknown) => data,
      }),
      false,
    );
    return typeof response.data === 'string' ? response.data : '';
  },

  /**
   * POST a JSON object or `FormData`.
   *
   * @param path Path relative to the API base (`/api/v1`).
   * @param body The request body.
   * @param options Per-call options.
   * @returns `payload.data`.
   */
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    sendBody<T>('POST', path, body, options),

  /** PUT a JSON object; same body, options and result as `post`. */
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    sendBody<T>('PUT', path, body, options),

  /** PATCH a JSON object; same body, options and result as `post`. */
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    sendBody<T>('PATCH', path, body, options),

  /**
   * DELETE a resource.
   *
   * @param path Path relative to the API base (`/api/v1`).
   * @param options Per-call options.
   * @returns `payload.data`, or `undefined` when the answer has none.
   */
  delete: async <T>(path: string, options?: RequestOptions): Promise<T> => {
    const { payload } = await send(configOf('DELETE', path, options));
    return payload.data as T;
  },
};
