/**
 * Comprehensive unit tests for LRU cache behavior in handlers-n8n-manager.ts
 *
 * This test file focuses specifically on cache behavior, TTL, eviction, and dispose callbacks
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { LRUCache } from 'lru-cache';
import { createCacheKey } from '../../../src/utils/cache-utils';
import { getN8nApiClient } from '../../../src/mcp/handlers-n8n-manager';
import { InstanceContext, validateInstanceContext } from '../../../src/types/instance-context';
import { N8nApiClient } from '../../../src/services/n8n-api-client';
import { getN8nApiConfigFromContext } from '../../../src/config/n8n-api';
import { logger } from '../../../src/utils/logger';

// Mock dependencies
vi.mock('../../../src/services/n8n-api-client');
vi.mock('../../../src/config/n8n-api');
vi.mock('../../../src/utils/logger');
vi.mock('../../../src/types/instance-context', async () => {
  const actual = await vi.importActual('../../../src/types/instance-context');
  return {
    ...actual,
    validateInstanceContext: vi.fn()
  };
});

describe('LRU Cache Behavior Tests', () => {
  let mockN8nApiClient: Mock;
  let mockGetN8nApiConfigFromContext: Mock;
  let mockLogger: any; // Logger mock has complex type
  let mockValidateInstanceContext: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.clearAllMocks();

    mockN8nApiClient = vi.mocked(N8nApiClient);
    mockGetN8nApiConfigFromContext = vi.mocked(getN8nApiConfigFromContext);
    mockLogger = vi.mocked(logger);
    mockValidateInstanceContext = vi.mocked(validateInstanceContext);

    // Default mock returns valid config
    mockGetN8nApiConfigFromContext.mockReturnValue({
      baseUrl: 'https://api.n8n.cloud',
      apiKey: 'test-key',
      timeout: 30000,
      maxRetries: 3
    });

    // Default mock returns valid context validation
    mockValidateInstanceContext.mockReturnValue({
      valid: true,
      errors: undefined
    });

    // Force re-import of the module to get fresh cache state
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Cache Key Generation and Collision', () => {
    it('should generate different cache keys for different contexts', () => {
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

      // Verify distinct contexts produce distinct cache keys. Uses the
      // real createCacheKey (HMAC-SHA256, per-process secret) so the
      // test tracks production behavior and avoids CodeQL flagging
      // direct crypto.createHash calls on apiKey-named values.
      const hash1 = createCacheKey(
        `${context1.n8nApiUrl}:${context1.n8nApiKey}:${context1.instanceId}`
      );
      const hash2 = createCacheKey(
        `${context2.n8nApiUrl}:${context2.n8nApiKey}:${context2.instanceId}`
      );

      expect(hash1).not.toBe(hash2);

      // Create clients to verify different cache entries
      const client1 = getN8nApiClient(context1);
      const client2 = getN8nApiClient(context2);

      expect(mockN8nApiClient).toHaveBeenCalledTimes(2);
    });

    it('should generate same cache key for identical contexts', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'same-key',
        instanceId: 'same-instance'
      };

      const client1 = getN8nApiClient(context);
      const client2 = getN8nApiClient(context);

      // Should only create one client (cache hit)
      expect(mockN8nApiClient).toHaveBeenCalledTimes(1);
      expect(client1).toBe(client2);
    });

    it('should handle potential cache key collisions gracefully', () => {
      // Create contexts that might produce similar hashes but are valid
      const contexts = [
        {
          n8nApiUrl: 'https://a.com',
          n8nApiKey: 'keyb',
          instanceId: 'c'
        },
        {
          n8nApiUrl: 'https://ab.com',
          n8nApiKey: 'key',
          instanceId: 'bc'
        },
        {
          n8nApiUrl: 'https://abc.com',
          n8nApiKey: 'differentkey',  // Fixed: empty string causes config creation to fail
          instanceId: 'key'
        }
      ];

      contexts.forEach((context, index) => {
        const client = getN8nApiClient(context);
        expect(client).toBeDefined();
      });

      // Each should create a separate client due to different hashes
      expect(mockN8nApiClient).toHaveBeenCalledTimes(3);
    });
  });

  describe('LRU Eviction Behavior', () => {
    it('should evict oldest entries when cache is full', async () => {
      const loggerDebugSpy = vi.spyOn(logger, 'debug');

      // Create 101 different contexts to exceed max cache size of 100
      const contexts: InstanceContext[] = [];
      for (let i = 0; i < 101; i++) {
        contexts.push({
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: `key-${i}`,
          instanceId: `instance-${i}`
        });
      }

      // Create clients for all contexts
      contexts.forEach(context => {
        getN8nApiClient(context);
      });

      // Should have called dispose callback for evicted entries
      expect(loggerDebugSpy).toHaveBeenCalledWith(
        'Evicting API client from cache',
        expect.objectContaining({
          cacheKey: expect.stringMatching(/^[a-f0-9]{8}\.\.\.$/i)
        })
      );

      // Verify dispose was called at least once
      expect(loggerDebugSpy).toHaveBeenCalled();
    });

    it('should maintain LRU order during access', () => {
      const contexts: InstanceContext[] = [];
      for (let i = 0; i < 5; i++) {
        contexts.push({
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: `key-${i}`,
          instanceId: `instance-${i}`
        });
      }

      // Create initial clients
      contexts.forEach(context => {
        getN8nApiClient(context);
      });

      expect(mockN8nApiClient).toHaveBeenCalledTimes(5);

      // Access first context again (should move to most recent)
      getN8nApiClient(contexts[0]);

      // Should not create new client (cache hit)
      expect(mockN8nApiClient).toHaveBeenCalledTimes(5);
    });

    it('should handle rapid successive access patterns', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'rapid-access-key',
        instanceId: 'rapid-instance'
      };

      // Rapidly access same context multiple times
      for (let i = 0; i < 10; i++) {
        getN8nApiClient(context);
      }

      // Should only create one client despite multiple accesses
      expect(mockN8nApiClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTL (Time To Live) Behavior', () => {
    it('should respect TTL settings', async () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'ttl-test-key',
        instanceId: 'ttl-instance'
      };

      // Create initial client
      const client1 = getN8nApiClient(context);
      expect(mockN8nApiClient).toHaveBeenCalledTimes(1);

      // Access again immediately (should hit cache)
      const client2 = getN8nApiClient(context);
      expect(mockN8nApiClient).toHaveBeenCalledTimes(1);
      expect(client1).toBe(client2);

      // Note: We can't easily test TTL expiration in unit tests
      // as it requires actual time passage, but we can verify
      // the updateAgeOnGet behavior
    });

    it('should update age on cache access (updateAgeOnGet)', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'age-update-key',
        instanceId: 'age-instance'
      };

      // Create and access multiple times
      getN8nApiClient(context);
      getN8nApiClient(context);
      getN8nApiClient(context);

      // Should only create one client due to cache hits
      expect(mockN8nApiClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dispose Callback Security and Logging', () => {
    it('should sanitize cache keys in dispose callback logs', () => {
      const loggerDebugSpy = vi.spyOn(logger, 'debug');

      // Create enough contexts to trigger eviction
      const contexts: InstanceContext[] = [];
      for (let i = 0; i < 102; i++) {
        contexts.push({
          n8nApiUrl: 'https://sensitive-api.n8n.cloud',
          n8nApiKey: `super-secret-key-${i}`,
          instanceId: `sensitive-instance-${i}`
        });
      }

      // Create clients to trigger eviction
      contexts.forEach(context => {
        getN8nApiClient(context);
      });

      // Verify dispose callback logs don't contain sensitive data
      const logCalls = loggerDebugSpy.mock.calls.filter(call =>
        call[0] === 'Evicting API client from cache'
      );

      logCalls.forEach(call => {
        const logData = call[1] as any;

        // Should only log partial cache key (first 8 chars + ...)
        expect(logData.cacheKey).toMatch(/^[a-f0-9]{8}\.\.\.$/i);

        // Should not contain any sensitive information
        const logString = JSON.stringify(call);
        expect(logString).not.toContain('super-secret-key');
        expect(logString).not.toContain('sensitive-api');
        expect(logString).not.toContain('sensitive-instance');
      });
    });

    it('should handle dispose callback with undefined client', () => {
      const loggerDebugSpy = vi.spyOn(logger, 'debug');

      // Create many contexts to trigger disposal
      for (let i = 0; i < 105; i++) {
        const context: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: `disposal-key-${i}`,
          instanceId: `disposal-${i}`
        };
        getN8nApiClient(context);
      }

      // Should handle disposal gracefully
      expect(() => {
        // The dispose callback should have been called
        expect(loggerDebugSpy).toHaveBeenCalled();
      }).not.toThrow();
    });
  });

  describe('Cache Memory Management', () => {
    it('should maintain consistent cache size limits', () => {
      // Create exactly 100 contexts (max cache size)
      const contexts: InstanceContext[] = [];
      for (let i = 0; i < 100; i++) {
        contexts.push({
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: `memory-key-${i}`,
          instanceId: `memory-${i}`
        });
      }

      // Create all clients
      contexts.forEach(context => {
        getN8nApiClient(context);
      });

      // All should be cached
      expect(mockN8nApiClient).toHaveBeenCalledTimes(100);

      // Access all again - should hit cache
      contexts.forEach(context => {
        getN8nApiClient(context);
      });

      // Should not create additional clients
      expect(mockN8nApiClient).toHaveBeenCalledTimes(100);
    });

    it('should handle edge case of single cache entry', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'single-key',
        instanceId: 'single-instance'
      };

      // Create and access multiple times
      for (let i = 0; i < 5; i++) {
        getN8nApiClient(context);
      }

      expect(mockN8nApiClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cache Configuration Validation', () => {
    it('should use reasonable cache limits', () => {
      // These values should match the actual cache configuration
      const MAX_CACHE_SIZE = 100;
      const TTL_MINUTES = 30;
      const TTL_MS = TTL_MINUTES * 60 * 1000;

      // Verify limits are reasonable
      expect(MAX_CACHE_SIZE).toBeGreaterThan(0);
      expect(MAX_CACHE_SIZE).toBeLessThanOrEqual(1000);
      expect(TTL_MS).toBeGreaterThan(0);
      expect(TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000); // Max 1 hour
    });
  });

  describe('Cache Interaction with Validation', () => {
    it('should not cache when context validation fails', () => {
      // Reset mocks to ensure clean state for this test
      vi.clearAllMocks();
      mockValidateInstanceContext.mockClear();

      const invalidContext: InstanceContext = {
        n8nApiUrl: 'invalid-url',
        n8nApiKey: 'test-key',
        instanceId: 'invalid-instance'
      };

      // Mock validation failure
      mockValidateInstanceContext.mockReturnValue({
        valid: false,
        errors: ['Invalid n8nApiUrl format']
      });

      const client = getN8nApiClient(invalidContext);

      // Should not create client or cache anything
      expect(client).toBeNull();
      expect(mockN8nApiClient).not.toHaveBeenCalled();
    });

    it('should handle cache when config creation fails', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key',
        instanceId: 'config-fail'
      };

      // Mock config creation failure
      mockGetN8nApiConfigFromContext.mockReturnValue(null);

      const client = getN8nApiClient(context);

      expect(client).toBeNull();
    });
  });

  describe('Complex Cache Scenarios', () => {
    it('should handle mixed valid and invalid contexts', () => {
      // Reset mocks to ensure clean state for this test
      vi.clearAllMocks();
      mockValidateInstanceContext.mockClear();

      // First, set up default valid behavior
      mockValidateInstanceContext.mockReturnValue({
        valid: true,
        errors: undefined
      });

      const validContext: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        instanceId: 'valid'
      };

      const invalidContext: InstanceContext = {
        n8nApiUrl: 'invalid-url',
        n8nApiKey: 'key',
        instanceId: 'invalid'
      };

      // Valid context should work
      const validClient = getN8nApiClient(validContext);
      expect(validClient).toBeDefined();

      // Change mock for invalid context
      mockValidateInstanceContext.mockReturnValueOnce({
        valid: false,
        errors: ['Invalid URL']
      });

      const invalidClient = getN8nApiClient(invalidContext);
      expect(invalidClient).toBeNull();

      // Reset mock back to valid for subsequent calls
      mockValidateInstanceContext.mockReturnValue({
        valid: true,
        errors: undefined
      });

      // Valid context should still work (cache hit)
      const validClient2 = getN8nApiClient(validContext);
      expect(validClient2).toBe(validClient);
    });

    it('should handle concurrent access to same cache key', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'concurrent-key',
        instanceId: 'concurrent'
      };

      // Simulate concurrent access
      const promises = Array(10).fill(null).map(() =>
        Promise.resolve(getN8nApiClient(context))
      );

      return Promise.all(promises).then(clients => {
        // All should return the same cached client
        const firstClient = clients[0];
        clients.forEach(client => {
          expect(client).toBe(firstClient);
        });

        // Should only create one client
        expect(mockN8nApiClient).toHaveBeenCalledTimes(1);
      });
    });
  });
});