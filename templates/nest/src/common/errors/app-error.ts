import { FAILURES, type FailureCode } from './failures.js';

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
 * An error the client may see; its code never leaves the process.
 *
 * It extends `Error`, not `HttpException`, and takes a failure-table code and
 * never free text. Services throw it; controllers and repositories do not
 * build HTTP responses.
 */
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
