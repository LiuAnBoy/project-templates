import type { NextConfig } from 'next';

/** Where the API listens; `/api/v1` is forwarded there. Read at build time. */
const API_HOST = process.env.API_HOST ?? 'http://localhost:8000';

const nextConfig: NextConfig = {
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
