/**
 * Error types thrown by the HTTP wrapper and the helpers that turn them into
 * user-facing text. Every failure leaves `http.ts` as one of these, except a
 * cancellation, which is passed through untouched.
 */

/** Text shown when a failure carries no message of its own. */
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/**
 * The server answered, but not with success: a non-2xx status, or a 2xx
 * whose body is not the success envelope.
 */
export class HttpError extends Error {
  /** HTTP status of the answer. */
  readonly status: number;
  /** Value of the `x-request-id` response header, when the server sent one. */
  readonly requestId: string | null;
  /** Seconds from the `Retry-After` header (a 503 usually carries it), else null. */
  readonly retryAfter: number | null;
  /** The parsed response body, for callers that branch on extra fields. */
  readonly body: unknown;

  /**
   * @param message The server's `payload.message`, or a generic text.
   * @param options Status plus the optional request id, retry delay and body.
   */
  constructor(
    message: string,
    options: {
      status: number;
      requestId?: string | null;
      retryAfter?: number | null;
      body?: unknown;
    },
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.body = options.body;
  }
}

/** The request produced no answer at all: offline, refused, DNS failure. */
export class NetworkError extends Error {
  /**
   * @param message Fixed description of the failure.
   * @param cause The underlying error, kept for debugging.
   */
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'NetworkError';
  }
}

/** The auth token provider failed, so the request was never sent. */
export class AuthTokenError extends Error {
  /**
   * @param cause The provider's own failure, kept for debugging.
   */
  constructor(cause?: unknown) {
    super('The auth token could not be read', { cause });
    this.name = 'AuthTokenError';
  }
}

/** The request was sent but no answer arrived within the timeout. */
export class TimeoutError extends NetworkError {
  /**
   * @param cause The underlying error, kept for debugging.
   */
  constructor(cause?: unknown) {
    super('The request timed out', cause);
    this.name = 'TimeoutError';
  }
}

/**
 * Pick the text to show for a failed request. A server failure already carries
 * the API's own wording and is shown as is; a transport failure gets a fixed
 * text; anything else gets the fallback.
 *
 * @param error The thrown value of a request or mutation.
 * @param fallback Text used when there is nothing better to show.
 * @returns A message safe to show to the user.
 */
export function getErrorMessage(
  error: unknown,
  fallback: string = FALLBACK_MESSAGE,
): string {
  if (error instanceof HttpError && error.message) return error.message;
  if (error instanceof TimeoutError) {
    return 'The server did not answer in time. Please try again.';
  }
  if (error instanceof NetworkError) {
    return 'Cannot reach the server. Check the connection and try again.';
  }
  return fallback;
}
