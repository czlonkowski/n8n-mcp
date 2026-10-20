import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') } },
  test: {
    environment: 'jsdom', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], exclude: ['tests/browser/**'],
    globals: true, setupFiles: ['tests/setup.ts'], retry: 0,
    coverage: { provider: 'v8', include: ['src/shared/result-state.ts', 'src/shared/hooks/useCardExpansion.ts', 'src/shared/validation-model.ts', 'src/shared/operation-model.ts', 'src/shared/inspection-models.ts'], reporter: ['text', 'lcov'], thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 } },
  },
});
