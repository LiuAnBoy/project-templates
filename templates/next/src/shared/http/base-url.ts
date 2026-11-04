/**
 * The base URL of the API. In the browser it is the same-origin `/api/v1`,
 * which `next.config.ts` forwards. On the server (server components, route
 * handlers) Node cannot resolve a relative URL, so it is `API_HOST` plus
 * `/api/v1`.
 *
 * @returns The base to put in front of every path.
 */
export function getApiBase(): string {
  if (typeof window === 'undefined') {
    return `${process.env.API_HOST ?? 'http://localhost:8000'}/api/v1`;
  }
  return '/api/v1';
}
