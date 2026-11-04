import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Where the API listens; `/api` is forwarded there by dev and preview.
  const apiHost =
    loadEnv(mode, process.cwd(), '').API_HOST ?? 'http://localhost:8000';
  const proxy = { '/api': { target: apiHost, changeOrigin: true } };

  return {
    plugins: [react()],
    resolve: { tsconfigPaths: true },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
