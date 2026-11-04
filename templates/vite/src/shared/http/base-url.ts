/**
 * The base URL of the API. A single-page app always runs in a browser, where
 * `/api/v1` is same-origin: the dev server proxies it, and a reverse proxy does
 * in production.
 *
 * @returns The relative base.
 */
export function getApiBase(): string {
  return '/api/v1';
}
