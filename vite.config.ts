import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works at https://<user>.github.io/<repo>/ without hard-coding the repo name.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'lcov'],
      // The scoring engine is the heart of the app: keep it well covered.
      thresholds: {
        'src/core/**': { lines: 90, functions: 90, statements: 90, branches: 75 },
      },
    },
  },
});
