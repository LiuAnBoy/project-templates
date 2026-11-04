/**
 * Reads the HTTP status of an error that Fastify itself raised.
 *
 * Fastify's own refusals (an oversized body, an unsupported media type) are
 * `Error` objects whose `code` starts with `FST_ERR_` and whose `statusCode` is
 * the status to answer. Nothing else qualifies: a driver or an HTTP client
 * library also puts a `statusCode` on its errors, and that is the status of
 * some other server's answer, not of ours, so it must fall through to the 500.
 *
 * @param error - Whatever was thrown.
 * @returns The 4xx or 5xx status of a Fastify error, otherwise undefined.
 */
export function frameworkStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code, statusCode } = error as {
    code?: unknown;
    statusCode?: unknown;
  };
  if (typeof code !== 'string' || !code.startsWith('FST_ERR_'))
    return undefined;
  return typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode <= 599
    ? statusCode
    : undefined;
}
