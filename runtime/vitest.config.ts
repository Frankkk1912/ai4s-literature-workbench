import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // The first import of pdfjs is slow on a loaded Windows runner and took more than the
    // default 5 s in CI once; every other test finishes in milliseconds.
    testTimeout: 30_000,
  },
});
