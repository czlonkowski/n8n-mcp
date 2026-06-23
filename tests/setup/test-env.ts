/**
 * Test Environment Configuration Loader
 * 
 * This module handles loading and validating test environment variables
 * with type safety and default values.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { existsSync } from 'fs';

// Load test environment variables
export function loadTestEnvironment(): void {
  // CI Debug logging
  const isCI = process.env.CI === 'true';

  // First, load the main .env file (for integration tests that need real credentials)
  const mainEnvPath = path.resolve(process.cwd(), '.env');
  if (existsSync(mainEnvPath)) {
    dotenv.config({ path: mainEnvPath });
    if (isCI) {
      console.log('[CI-DEBUG] Loaded .env file from:', mainEnvPath);
    }
  }

  // Load base test environment
  const testEnvPath = path.resolve(process.cwd(), '.env.test');

  if (isCI) {
    console.log('[CI-DEBUG] Looking for .env.test at:', testEnvPath);
    console.log('[CI-DEBUG] File exists?', existsSync(testEnvPath));
  }

  if (existsSync(testEnvPath)) {
    // Don't override values from .env
    const result = dotenv.config({ path: testEnvPath, override: false });
    if (isCI && result.error) {
      console.error('[CI-DEBUG] Failed to load .env.test:', result.error);
    } else if (isCI && result.parsed) {
      console.log('[CI-DEBUG] Successfully loaded', Object.keys(result.parsed).length, 'env vars from .env.test');
    }
  } else if (isCI) {
    console.warn('[CI-DEBUG] .env.test file not found, will use defaults only');
  }

  // Load local test overrides (for sensitive values)
  const localEnvPath = path.resolve(process.cwd(), '.env.test.local');
  if (existsSync(localEnvPath)) {
    dotenv.config({ path: localEnvPath, override: true });
  }

  // Set test-specific defaults (only if not already set)
  setTestDefaults();

  // Validate required environment variables
  validateTestEnvironment();
}

/**
 * Set default values for test environment variables
 */
function setTestDefaults(): void {
  // Ensure we're in test mode
  process.env.NODE_ENV = 'test';
  process.env.TEST_ENVIRONMENT = 'true';
  
  // Set defaults if not already set
  const defaults: Record<string, string> = {
    // Database
    NODE_DB_PATH: ':memory:',
    REBUILD_ON_START: 'false',
    
    // API
    N8N_API_URL: 'http://localhost:3001/mock-api',
    N8N_API_KEY: 'test-api-key-12345',

    // Tests target localhost. Match the trigger-handler test convention
    // (permissive mode) so the global SSRF gate does not reject the
    // operator-configured base URL.
    WEBHOOK_SECURITY_MODE: 'permissive',
    
    // Server
    PORT: '3001',
    HOST: '127.0.0.1',
    
    // Logging
    LOG_LEVEL: 'error',
    DEBUG: 'false',
    TEST_LOG_VERBOSE: 'false',
    
    // Timeouts
    TEST_TIMEOUT_UNIT: '5000',
    TEST_TIMEOUT_INTEGRATION: '15000',
    TEST_TIMEOUT_E2E: '30000',
    TEST_TIMEOUT_GLOBAL: '30000', // Reduced from 60s to 30s to catch hangs faster
    
    // Test execution
    TEST_RETRY_ATTEMPTS: '2',
    TEST_RETRY_DELAY: '1000',
    TEST_PARALLEL: 'true',
    TEST_MAX_WORKERS: '4',
    
    // Features
    FEATURE_MOCK_EXTERNAL_APIS: 'true',
    FEATURE_USE_TEST_CONTAINERS: 'false',
    MSW_ENABLED: 'true',
    MSW_API_DELAY: '0',
    
    // Paths
    TEST_FIXTURES_PATH: './tests/fixtures',
    TEST_DATA_PATH: './tests/data',
    TEST_SNAPSHOTS_PATH: './tests/__snapshots__',
    
    // Performance
    PERF_THRESHOLD_API_RESPONSE: '100',
    PERF_THRESHOLD_DB_QUERY: '50',
    PERF_THRESHOLD_NODE_PARSE: '200',
    
    // Caching
    CACHE_TTL: '0',
    CACHE_ENABLED: 'false',
    
    // Rate limiting
    RATE_LIMIT_MAX: '0',
    RATE_LIMIT_WINDOW: '0',
    
    // Error handling
    ERROR_SHOW_STACK: 'true',
    ERROR_SHOW_DETAILS: 'true',
    
    // Cleanup
    TEST_CLEANUP_ENABLED: 'true',
    TEST_CLEANUP_ON_FAILURE: 'false',
    
    // Database seeding
    TEST_SEED_DATABASE: 'true',
    TEST_SEED_TEMPLATES: 'true',
    
    // Network
    NETWORK_TIMEOUT: '5000',
    NETWORK_RETRY_COUNT: '0',
    
    // Memory
    TEST_MEMORY_LIMIT: '512',
    
    // Coverage
    COVERAGE_DIR: './coverage',
    COVERAGE_REPORTER: 'lcov,html,text-summary'
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Validate that required environment variables are set
 */
function validateTestEnvironment(): void {
  const required = [
    'NODE_ENV',
    'NODE_DB_PATH',
    'N8N_API_URL',
    'N8N_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required test environment variables: ${missing.join(', ')}\n` +
      'Please ensure .env.test is properly configured.'
    );
  }

  // Validate NODE_ENV is set to test
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'NODE_ENV must be set to "test" when running tests.\n' +
      'This prevents accidental execution against production systems.'
    );
  }
}

/**
 * Get typed test environment configuration
 */
export function getTestConfig() {
  // Ensure defaults are set before accessing
  if (!process.env.N8N_API_URL) {
    setTestDefaults();
  }
  
  return {
    // Environment
    nodeEnv: process.env.NODE_ENV || 'test',
    isTest: process.env.TEST_ENVIRONMENT === 'true',
    
    // Database
    database: {
      path: process.env.NODE_DB_PATH || ':memory:',
      rebuildOnStart: process.env.REBUILD_ON_START === 'true',
      seedData: process.env.TEST_SEED_DATABASE === 'true',
      seedTemplates: process.env.TEST_SEED_TEMPLATES === 'true'
    },
    
    // API
    api: {
      url: process.env.N8N_API_URL || 'http://localhost:3001/mock-api',
      key: process.env.N8N_API_KEY || 'test-api-key-12345',
      webhookBaseUrl: process.env.N8N_WEBHOOK_BASE_URL,
      webhookTestUrl: process.env.N8N_WEBHOOK_TEST_URL
    },
    
    // Server
    server: {
      port: parseInt(process.env.PORT || '3001', 10),
      host: process.env.HOST || '127.0.0.1',
      corsOrigin: process.env.CORS_ORIGIN?.split(',') || []
    },
    
    // Authentication
    auth: {
      token: process.env.AUTH_TOKEN,
      mcpToken: process.env.MCP_AUTH_TOKEN
    },
    
    // Logging
    logging: {
      level: process.env.LOG_LEVEL || 'error',
      debug: process.env.DEBUG === 'true',
      verbose: process.env.TEST_LOG_VERBOSE === 'true',
      showStack: process.env.ERROR_SHOW_STACK === 'true',
      showDetails: process.env.ERROR_SHOW_DETAILS === 'true'
    },
    
    // Test execution
    execution: {
      timeouts: {
        unit: parseInt(process.env.TEST_TIMEOUT_UNIT || '5000', 10),
        integration: parseInt(process.env.TEST_TIMEOUT_INTEGRATION || '15000', 10),
        e2e: parseInt(process.env.TEST_TIMEOUT_E2E || '30000', 10),
        global: parseInt(process.env.TEST_TIMEOUT_GLOBAL || '60000', 10)
      },
      retry: {
        attempts: parseInt(process.env.TEST_RETRY_ATTEMPTS || '2', 10),
        delay: parseInt(process.env.TEST_RETRY_DELAY || '1000', 10)
      },
      parallel: process.env.TEST_PARALLEL === 'true',
      maxWorkers: parseInt(process.env.TEST_MAX_WORKERS || '4', 10)
    },
    
    // Features
    features: {
      coverage: process.env.FEATURE_TEST_COVERAGE === 'true',
      screenshots: process.env.FEATURE_TEST_SCREENSHOTS === 'true',
      videos: process.env.FEATURE_TEST_VIDEOS === 'true',
      trace: process.env.FEATURE_TEST_TRACE === 'true',
      mockExternalApis: process.env.FEATURE_MOCK_EXTERNAL_APIS === 'true',
      useTestContainers: process.env.FEATURE_USE_TEST_CONTAINERS === 'true'
    },
    
    // Mocking
    mocking: {
      msw: {
        enabled: process.env.MSW_ENABLED === 'true',
        apiDelay: parseInt(process.env.MSW_API_DELAY || '0', 10)
      },
      redis: {
        enabled: process.env.REDIS_MOCK_ENABLED === 'true',
        port: parseInt(process.env.REDIS_MOCK_PORT || '6380', 10)
      },
      elasticsearch: {
        enabled: process.env.ELASTICSEARCH_MOCK_ENABLED === 'true',
        port: parseInt(process.env.ELASTICSEARCH_MOCK_PORT || '9201', 10)
      }
    },
    
    // Paths
    paths: {
      fixtures: process.env.TEST_FIXTURES_PATH || './tests/fixtures',
      data: process.env.TEST_DATA_PATH || './tests/data',
      snapshots: process.env.TEST_SNAPSHOTS_PATH || './tests/__snapshots__'
    },
    
    // Performance
    performance: {
      thresholds: {
        apiResponse: parseInt(process.env.PERF_THRESHOLD_API_RESPONSE || '100', 10),
        dbQuery: parseInt(process.env.PERF_THRESHOLD_DB_QUERY || '50', 10),
        nodeParse: parseInt(process.env.PERF_THRESHOLD_NODE_PARSE || '200', 10)
      }
    },
    
    // Rate limiting
    rateLimiting: {
      max: parseInt(process.env.RATE_LIMIT_MAX || '0', 10),
      window: parseInt(process.env.RATE_LIMIT_WINDOW || '0', 10)
    },
    
    // Caching
    cache: {
      enabled: process.env.CACHE_ENABLED === 'true',
      ttl: parseInt(process.env.CACHE_TTL || '0', 10)
    },
    
    // Cleanup
    cleanup: {
      enabled: process.env.TEST_CLEANUP_ENABLED === 'true',
      onFailure: process.env.TEST_CLEANUP_ON_FAILURE === 'true'
    },
    
    // Network
    network: {
      timeout: parseInt(process.env.NETWORK_TIMEOUT || '5000', 10),
      retryCount: parseInt(process.env.NETWORK_RETRY_COUNT || '0', 10)
    },
    
    // Memory
    memory: {
      limit: parseInt(process.env.TEST_MEMORY_LIMIT || '512', 10)
    },
    
    // Coverage
    coverage: {
      dir: process.env.COVERAGE_DIR || './coverage',
      reporters: (process.env.COVERAGE_REPORTER || 'lcov,html,text-summary').split(',')
    }
  };
}

// Export type for the test configuration
export type TestConfig = ReturnType<typeof getTestConfig>;

/**
 * Helper to check if we're in test mode
 */
export function isTestMode(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.TEST_ENVIRONMENT === 'true';
}

/**
 * Helper to get timeout for specific test type
 */
export function getTestTimeout(type: 'unit' | 'integration' | 'e2e' | 'global' = 'unit'): number {
  const config = getTestConfig();
  return config.execution.timeouts[type];
}

/**
 * Helper to check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof TestConfig['features']): boolean {
  const config = getTestConfig();
  return config.features[feature];
}

/**
 * Reset environment to defaults (useful for test isolation)
 */
export function resetTestEnvironment(): void {
  // Clear all test-specific environment variables
  const testKeys = Object.keys(process.env).filter(key => 
    key.startsWith('TEST_') || 
    key.startsWith('FEATURE_') ||
    key.startsWith('MSW_') ||
    key.startsWith('PERF_')
  );
  
  testKeys.forEach(key => {
    delete process.env[key];
  });
  
  // Reload defaults
  loadTestEnvironment();
}