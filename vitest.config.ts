import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only include global-setup.ts, remove msw-setup.ts from global setup
    setupFiles: ['./tests/setup/global-setup.ts'],
    // Load environment variables from .env.test
    env: {
      NODE_ENV: 'test'
    },
    // Test execution settings
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: parseInt(process.env.TEST_MAX_WORKERS || '4', 10),
        minThreads: 1
      }
    },
    // No retries - flaky tests should be fixed, not masked
    retry: 0,
    // Test reporter - reduce reporters in CI to prevent hanging
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: './test-results/junit.xml'
    },
    coverage: {
      provider: 'v8',
      enabled: process.env.FEATURE_TEST_COVERAGE !== 'false',
      reporter: process.env.CI ? ['lcov', 'text-summary'] : (process.env.COVERAGE_REPORTER || 'lcov,html,text-summary').split(','),
      reportsDirectory: process.env.COVERAGE_DIR || './coverage',
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'scripts/',
        'dist/',
        '**/test-*.ts',
        '**/mock-*.ts',
        '**/__mocks__/**'
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75
      },
      // Add coverage-specific settings to prevent hanging
      all: false, // Don't collect coverage for untested files
      skipFull: true // Skip files with 100% coverage
    },
    // Test isolation
    isolate: true,
    // Force exit after tests complete in CI to prevent hanging
    forceRerunTriggers: ['**/tests/**/*.ts'],
    teardownTimeout: 1000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests')
    }
  },
  // TypeScript configuration
  esbuild: {
    target: 'node18'
  },
  // Define global constants
  define: {
    'process.env.TEST_ENVIRONMENT': JSON.stringify('true')
  }
});