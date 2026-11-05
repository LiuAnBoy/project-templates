import type { NextConfig } from 'next';

/** Where the API listens; `/api/v1` is forwarded there. Read at build time. */
const API_HOST = process.env.API_HOST ?? 'http://localhost:8000';

const nextConfig: NextConfig = {
  /**
   * The Dockerfile sets `NEXT_OUTPUT=standalone` so the image holds a
   * self-contained server; `next start` and every other command leave it unset.
   */
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  /**
   * Forward the API from the page's own origin, so the browser never makes a
   * cross-origin request and the API needs no CORS.
   *
   * @returns The rewrite rules.
   */
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_HOST}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
