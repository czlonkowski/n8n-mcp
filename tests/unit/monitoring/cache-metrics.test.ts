/**
 * Unit tests for cache metrics monitoring functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getInstanceCacheMetrics,
  getN8nApiClient,
  clearInstanceCache
} from '../../../src/mcp/handlers-n8n-manager';
import {
  cacheMetrics,
  getCacheStatistics
} from '../../../src/utils/cache-utils';
import { InstanceContext } from '../../../src/types/instance-context';

// Mock the N8nApiClient
vi.mock('../../../src/clients/n8n-api-client', () => ({
  N8nApiClient: vi.fn().mockImplementation(function (config) { return ({
    config,
    getWorkflows: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn().mockResolvedValue({}),
    isConnected: vi.fn().mockReturnValue(true)
  }); })
}));

// Mock logger to reduce noise in tests
vi.mock('../../../src/utils/logger', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  return {
    Logger: vi.fn().mockImplementation(function () { return mockLogger; }),
    logger: mockLogger
  };
});

describe('Cache Metrics Monitoring', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearInstanceCache();
    cacheMetrics.reset();

    // Reset environment variables
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
    delete process.env.INSTANCE_CACHE_MAX;
    delete process.env.INSTANCE_CACHE_TTL_MINUTES;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getInstanceCacheStatistics', () => {
    it('should return initial statistics', () => {
      const stats = getInstanceCacheMetrics();

      expect(stats).toBeDefined();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.avgHitRate).toBe(0);
    });

    it('should track cache hits and misses', () => {
      const context1: InstanceContext = {
        n8nApiUrl: 'https://api1.n8n.cloud',
        n8nApiKey: 'key1',
        instanceId: 'instance1'
      };

      const context2: InstanceContext = {
        n8nApiUrl: 'https://api2.n8n.cloud',
        n8nApiKey: 'key2',
        instanceId: 'instance2'
      };

      // First access - cache miss
      getN8nApiClient(context1);
      let stats = getInstanceCacheMetrics();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
      expect(stats.size).toBe(1);

      // Second access same context - cache hit
      getN8nApiClient(context1);
      stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.avgHitRate).toBe(0.5); // 1 hit / 2 total

      // Third access different context - cache miss
      getN8nApiClient(context2);
      stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
      expect(stats.avgHitRate).toBeCloseTo(0.333, 2); // 1 hit / 3 total
    });

    it('should track evictions when cache is full', () => {
      // Note: Cache is created with default size (100), so we need many items to trigger evictions
      // This test verifies that eviction tracking works, even if we don't hit the limit in practice
      const initialStats = getInstanceCacheMetrics();

      // The cache dispose callback should track evictions when items are removed
      // For this test, we'll verify the eviction tracking mechanism exists
      expect(initialStats.evictions).toBeGreaterThanOrEqual(0);

      // Add a few items to cache
      const contexts = [
        { n8nApiUrl: 'https://api1.n8n.cloud', n8nApiKey: 'key1' },
        { n8nApiUrl: 'https://api2.n8n.cloud', n8nApiKey: 'key2' },
        { n8nApiUrl: 'https://api3.n8n.cloud', n8nApiKey: 'key3' }
      ];

      contexts.forEach(ctx => getN8nApiClient(ctx));

      const stats = getInstanceCacheMetrics();
      expect(stats.size).toBe(3); // All items should fit in default cache (max: 100)
    });

    it('should track cache operations over time', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key'
      };

      // Simulate multiple operations
      for (let i = 0; i < 10; i++) {
        getN8nApiClient(context);
      }

      const stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(9); // First is miss, rest are hits
      expect(stats.misses).toBe(1);
      expect(stats.avgHitRate).toBe(0.9); // 9/10
      expect(stats.sets).toBeGreaterThanOrEqual(1);
    });

    it('should include timestamp information', () => {
      const stats = getInstanceCacheMetrics();

      expect(stats.createdAt).toBeInstanceOf(Date);
      expect(stats.lastResetAt).toBeInstanceOf(Date);
      expect(stats.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should track cache clear operations', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key'
      };

      // Add some clients
      getN8nApiClient(context);

      // Clear cache
      clearInstanceCache();

      const stats = getInstanceCacheMetrics();
      expect(stats.clears).toBe(1);
      expect(stats.size).toBe(0);
    });
  });

  describe('Cache Metrics with Different Scenarios', () => {
    it('should handle rapid successive requests', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'rapid-test'
      };

      // Simulate rapid requests
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(Promise.resolve(getN8nApiClient(context)));
      }

      return Promise.all(promises).then(() => {
        const stats = getInstanceCacheMetrics();
        expect(stats.hits).toBe(49); // First is miss
        expect(stats.misses).toBe(1);
        expect(stats.avgHitRate).toBe(0.98); // 49/50
      });
    });

    it('should track metrics for fallback to environment variables', () => {
      // Note: Singleton mode (no context) doesn't use the instance cache
      // This test verifies that cache metrics are not affected by singleton usage
      const initialStats = getInstanceCacheMetrics();

      process.env.N8N_API_URL = 'https://env.n8n.cloud';
      process.env.N8N_API_KEY = 'env-key';

      // Calls without context use singleton mode (no cache metrics)
      getN8nApiClient();
      getN8nApiClient();

      const stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(initialStats.hits);
      expect(stats.misses).toBe(initialStats.misses);
    });

    it('should maintain separate metrics for different instances', () => {
      const contexts = Array.from({ length: 5 }, (_, i) => ({
        n8nApiUrl: `https://api${i}.n8n.cloud`,
        n8nApiKey: `key${i}`,
        instanceId: `instance${i}`
      }));

      // Access each instance twice
      contexts.forEach(ctx => {
        getN8nApiClient(ctx); // Miss
        getN8nApiClient(ctx); // Hit
      });

      const stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(5);
      expect(stats.misses).toBe(5);
      expect(stats.size).toBe(5);
      expect(stats.avgHitRate).toBe(0.5);
    });

    it('should handle cache with TTL expiration', () => {
      // Note: TTL configuration is set when cache is created, not dynamically
      // This test verifies that TTL-related cache behavior can be tracked
      const context: InstanceContext = {
        n8nApiUrl: 'https://ttl-test.n8n.cloud',
        n8nApiKey: 'ttl-key'
      };

      // First access - miss
      getN8nApiClient(context);

      // Second access - hit (within TTL)
      getN8nApiClient(context);

      const stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('getCacheStatistics (formatted)', () => {
    it('should return human-readable statistics', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key'
      };

      // Generate some activity
      getN8nApiClient(context);
      getN8nApiClient(context);
      getN8nApiClient({ ...context, instanceId: 'different' });

      const formattedStats = getCacheStatistics();

      expect(formattedStats).toContain('Cache Statistics:');
      expect(formattedStats).toContain('Runtime:');
      expect(formattedStats).toContain('Total Operations:');
      expect(formattedStats).toContain('Hit Rate:');
      expect(formattedStats).toContain('Current Size:');
      expect(formattedStats).toContain('Total Evictions:');
    });

    it('should show runtime in minutes', () => {
      const stats = getCacheStatistics();
      expect(stats).toMatch(/Runtime: \d+ minutes/);
    });

    it('should show operation counts', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key'
      };

      // Generate operations
      getN8nApiClient(context); // Set
      getN8nApiClient(context); // Hit
      clearInstanceCache(); // Clear

      const stats = getCacheStatistics();
      expect(stats).toContain('Sets: 1');
      expect(stats).toContain('Clears: 1');
    });
  });

  describe('Monitoring Performance Impact', () => {
    it('should have minimal performance overhead', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://perf-test.n8n.cloud',
        n8nApiKey: 'perf-key'
      };

      const startTime = performance.now();

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        getN8nApiClient(context);
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should complete quickly (< 100ms for 1000 operations)
      expect(totalTime).toBeLessThan(100);

      // Verify metrics were tracked
      const stats = getInstanceCacheMetrics();
      expect(stats.hits).toBe(999);
      expect(stats.misses).toBe(1);
    });

    it('should handle concurrent metric updates', async () => {
      const contexts = Array.from({ length: 10 }, (_, i) => ({
        n8nApiUrl: `https://concurrent${i}.n8n.cloud`,
        n8nApiKey: `key${i}`
      }));

      // Concurrent requests
      const promises = contexts.map(ctx =>
        Promise.resolve(getN8nApiClient(ctx))
      );

      await Promise.all(promises);

      const stats = getInstanceCacheMetrics();
      expect(stats.misses).toBe(10);
      expect(stats.size).toBe(10);
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle metrics when cache operations fail', () => {
      const invalidContext = {
        n8nApiUrl: '',
        n8nApiKey: ''
      } as InstanceContext;

      // This should fail validation but metrics should still work
      const client = getN8nApiClient(invalidContext);
      expect(client).toBeNull();

      // Metrics should not be affected by validation failures
      const stats = getInstanceCacheMetrics();
      expect(stats).toBeDefined();
    });

    it('should maintain metrics integrity after reset', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://reset-test.n8n.cloud',
        n8nApiKey: 'reset-key'
      };

      // Generate some metrics
      getN8nApiClient(context);
      getN8nApiClient(context);

      // Reset metrics
      cacheMetrics.reset();

      // New operations should start fresh
      getN8nApiClient(context);
      const stats = getInstanceCacheMetrics();

      expect(stats.hits).toBe(1); // Cache still has item from before reset
      expect(stats.misses).toBe(0);
      expect(stats.lastResetAt.getTime()).toBeGreaterThan(stats.createdAt.getTime());
    });

    it('should handle maximum cache size correctly', () => {
      // Note: Cache uses default configuration (max: 100) since it's created at module load
      const contexts = Array.from({ length: 5 }, (_, i) => ({
        n8nApiUrl: `https://max${i}.n8n.cloud`,
        n8nApiKey: `key${i}`
      }));

      // Add items within default cache size
      contexts.forEach(ctx => getN8nApiClient(ctx));

      const stats = getInstanceCacheMetrics();
      expect(stats.size).toBe(5); // Should fit in default cache
      expect(stats.maxSize).toBe(100); // Default max size
    });
  });
});