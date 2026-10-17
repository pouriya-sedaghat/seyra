import { defineConfig } from 'vitest/config';

// Integration tests hit one shared running stack; run files sequentially with generous timeouts.
export default defineConfig({
  test: {
    include: ['src/**/*.it.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
    reporters: ['default', 'json'],
    outputFile: { json: '../../docs/evidence/integration/vitest-report.json' },
  },
});
