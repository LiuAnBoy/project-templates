/**
 * The failure table: every error a client can see comes from here.
 *
 * A failure answers with an HTTP status and a fixed message. The code (the key)
 * stays inside the process, for logs and tests, and is never serialised. No two
 * entries share a message, so the message alone tells two failures with one
 * status apart.
 */
export const FAILURES = {
  invalidRequest: { status: 400, message: 'invalid request' },
  invalidField: { status: 400, message: "invalid value for '{name}'" },
  unauthorized: { status: 401, message: 'authentication required' },
  forbidden: { status: 403, message: 'not allowed' },
  notFound: { status: 404, message: 'not found' },
  conflict: {
    status: 409,
    message: 'the request conflicts with the current state',
  },
  busy: { status: 409, message: 'the resource is busy' },
  payloadTooLarge: { status: 413, message: 'the request body is too large' },
  unsupportedMediaType: { status: 415, message: 'unsupported media type' },
  unprocessable: { status: 422, message: 'the request cannot be processed' },
  tooManyRequests: { status: 429, message: 'too many requests' },
  unavailable: { status: 503, message: 'service unavailable' },
  internal: { status: 500, message: 'internal error' },
} as const;

/** A key of the failure table. */
export type FailureCode = keyof typeof FAILURES;

/** The entry that answers a framework-raised error of a given status. */
const STATUS_CODES: Readonly<Record<number, FailureCode>> = {
  400: 'invalidRequest',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  413: 'payloadTooLarge',
  415: 'unsupportedMediaType',
  422: 'unprocessable',
  429: 'tooManyRequests',
  500: 'internal',
  503: 'unavailable',
};

/**
 * Restricts a caller-supplied name to a safe token.
 *
 * @param name - A parameter or field name from a closed set the server defines.
 * @returns The name when it matches `[A-Za-z0-9_.-]{1,40}`, otherwise `?`.
 */
function safeName(name: string): string {
  return /^[A-Za-z0-9_.-]{1,40}$/.test(name) ? name : '?';
}

/**
 * Finds the table entry that answers a status raised outside the services.
 *
 * Used for errors a framework or a guard raised: the client sees the table's
 * message, never the framework's own text. A status with no entry answers the
 * entry for 400 (4xx) or `internal` (anything else).
 *
 * @param status - The HTTP status of the raised error.
 * @returns The status to answer with and the fixed message.
 */
export function failureForStatus(status: number): {
  status: number;
  message: string;
} {
  const code =
    STATUS_CODES[status] ??
    (status >= 400 && status < 500 ? 'invalidRequest' : 'internal');
  return FAILURES[code];
}

/** An error the client may see; its code never leaves the process. */
export class AppError extends Error {
  readonly status: number;

  /**
   * @param code - A key of the failure table.
   * @param name - Fills `{name}` in a templated message.
   */
  constructor(
    readonly code: FailureCode,
    name?: string,
  ) {
    const entry = FAILURES[code];
    super(
      name ? entry.message.replace('{name}', safeName(name)) : entry.message,
    );
    this.name = 'AppError';
    this.status = entry.status;
  }
}
