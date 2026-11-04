import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild does not emit decorator metadata, which Nest's injection reads; swc does.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/tests/**/*.test.ts'],
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
  },
});
