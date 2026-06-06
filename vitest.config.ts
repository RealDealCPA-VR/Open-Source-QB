import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'test/**/*.test.ts'],
    // PGlite's WASM boot + first migration can be slow on a cold run.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
