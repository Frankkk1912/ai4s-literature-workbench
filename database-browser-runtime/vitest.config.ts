import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Windows CI cold-start file locks can outlive the 5s vitest default before
    // waitFor reports the last job status. Keep this above the helper budget.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
