import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // setupFiles comes from the base config; mergeConfig concatenates the
      // array, so repeating it here registered every hook twice per file.
      // Runs once before the integration suite (not per test file, and not
      // on a plain `npm test`, which may be selected down to unit files - the base config intentionally
      // omits this) to sweep orphaned n8n integration-test workflows without
      // racing running tests. See tests/setup/integration-global-setup.ts
      // and issue #1102.
      globalSetup: ['./tests/setup/integration-global-setup.ts'],
      // Only include integration tests
      include: ['tests/integration/**/*.test.ts'],
      // Integration tests might need more time
      testTimeout: 30000,
      // Specific pool options for integration tests
      poolOptions: {
        threads: {
          // Run integration tests sequentially by default
          singleThread: true,
          maxThreads: 1
        }
      },
      // Disable coverage for integration tests or set lower thresholds
      coverage: {
        enabled: false
      }
    }
  })
);