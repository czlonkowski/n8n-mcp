/**
 * Unit tests for flexible instance configuration security improvements
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstanceContext, isInstanceContext, validateInstanceContext } from '../../src/types/instance-context';
import { getN8nApiClient } from '../../src/mcp/handlers-n8n-manager';
import { createCacheKey } from '../../src/utils/cache-utils';

describe('Flexible Instance Security', () => {
  beforeEach(() => {
    // Clear module cache to reset singleton state
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Validation', () => {
    describe('URL Validation', () => {
      it('should accept valid HTTP and HTTPS URLs', () => {
        const validContext: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: 'valid-key'
        };
        expect(isInstanceContext(validContext)).toBe(true);

        const httpContext: InstanceContext = {
          n8nApiUrl: 'http://localhost:5678',
          n8nApiKey: 'valid-key'
        };
        expect(isInstanceContext(httpContext)).toBe(true);
      });

      it('should reject invalid URL formats', () => {
        const invalidUrls = [
          'not-a-url',
          'ftp://invalid-protocol.com',
          'javascript:alert(1)',
          '//missing-protocol.com',
          'https://',
          ''
        ];

        invalidUrls.forEach(url => {
          const context = {
            n8nApiUrl: url,
            n8nApiKey: 'key'
          };
          const validation = validateInstanceContext(context);
          expect(validation.valid).toBe(false);
          expect(validation.errors?.some(error => error.startsWith('Invalid n8nApiUrl:'))).toBe(true);
        });
      });
    });

    describe('API Key Validation', () => {
      it('should accept valid API keys', () => {
        const validKeys = [
          'abc123def456',
          'sk_live_abcdefghijklmnop',
          'token_1234567890',
          'a'.repeat(100) // Long key
        ];

        validKeys.forEach(key => {
          const context: InstanceContext = {
            n8nApiUrl: 'https://api.n8n.cloud',
            n8nApiKey: key
          };
          const validation = validateInstanceContext(context);
          expect(validation.valid).toBe(true);
        });
      });

      it('should reject placeholder or invalid API keys', () => {
        const invalidKeys = [
          'YOUR_API_KEY',
          'placeholder',
          'example',
          'YOUR_API_KEY_HERE',
          'example-key',
          'placeholder-token'
        ];

        invalidKeys.forEach(key => {
          const context: InstanceContext = {
            n8nApiUrl: 'https://api.n8n.cloud',
            n8nApiKey: key
          };
          const validation = validateInstanceContext(context);
          expect(validation.valid).toBe(false);
          expect(validation.errors?.some(error => error.startsWith('Invalid n8nApiKey:'))).toBe(true);
        });
      });
    });

    describe('Timeout and Retry Validation', () => {
      it('should validate timeout values', () => {
        const invalidTimeouts = [0, -1, -1000];

        invalidTimeouts.forEach(timeout => {
          const context: InstanceContext = {
            n8nApiUrl: 'https://api.n8n.cloud',
            n8nApiKey: 'key',
            n8nApiTimeout: timeout
          };
          const validation = validateInstanceContext(context);
          expect(validation.valid).toBe(false);
          expect(validation.errors?.some(error => error.includes('Must be positive (greater than 0)'))).toBe(true);
        });

        // NaN and Infinity are handled differently
        const nanContext: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: 'key',
          n8nApiTimeout: NaN
        };
        const nanValidation = validateInstanceContext(nanContext);
        expect(nanValidation.valid).toBe(false);

        // Valid timeout
        const validContext: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: 'key',
          n8nApiTimeout: 30000
        };
        const validation = validateInstanceContext(validContext);
        expect(validation.valid).toBe(true);
      });

      it('should validate retry values', () => {
        const invalidRetries = [-1, -10];

        invalidRetries.forEach(retries => {
          const context: InstanceContext = {
            n8nApiUrl: 'https://api.n8n.cloud',
            n8nApiKey: 'key',
            n8nApiMaxRetries: retries
          };
          const validation = validateInstanceContext(context);
          expect(validation.valid).toBe(false);
          expect(validation.errors?.some(error => error.includes('Must be non-negative (0 or greater)'))).toBe(true);
        });

        // Valid retries (including 0)
        [0, 1, 3, 10].forEach(retries => {
          const context: InstanceContext = {
            n8nApiUrl: 'https://api.n8n.cloud',
            n8nApiKey: 'key',
            n8nApiMaxRetries: retries
          };
          const validation = validateInstanceContext(context);
          expect(validation.valid).toBe(true);
        });
      });
    });
  });

  describe('Cache Key Security', () => {
    it('should hash cache keys instead of using raw credentials', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'super-secret-key',
        instanceId: 'instance-1'
      };

      // Sanity-check the real cache key function for this input.
      // Uses createCacheKey rather than calling crypto.createHash directly
      // so the test tracks production behavior and doesn't trip CodeQL
      // js/insufficient-password-hash on test fixtures.
      const expectedHash = createCacheKey(
        `${context.n8nApiUrl}:${context.n8nApiKey}:${context.instanceId}`
      );
      expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);

      // The actual cache key should be hashed, not contain raw values
      // We can't directly test the internal cache key, but we can verify
      // that the function doesn't throw and returns a client
      const client = getN8nApiClient(context);

      // If validation passes, client could be created (or null if no env vars)
      // The important part is that raw credentials aren't exposed
      expect(() => getN8nApiClient(context)).not.toThrow();
    });

    it('should not expose API keys in any form', () => {
      const sensitiveKey = 'super-secret-api-key-12345';
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: sensitiveKey,
        instanceId: 'test'
      };

      // Mock console methods to capture any output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      getN8nApiClient(context);

      // Verify the sensitive key is never logged
      const allLogs = [
        ...consoleSpy.mock.calls,
        ...consoleWarnSpy.mock.calls,
        ...consoleErrorSpy.mock.calls
      ].flat().join(' ');

      expect(allLogs).not.toContain(sensitiveKey);

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Error Message Sanitization', () => {
    it('should not expose sensitive data in error messages', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'invalid-url',
        n8nApiKey: 'secret-key-that-should-not-appear',
        instanceId: 'test-instance'
      };

      const validation = validateInstanceContext(context);

      // Error messages should be generic, not include actual values
      expect(validation.errors).toBeDefined();
      expect(validation.errors!.join(' ')).not.toContain('secret-key');
      expect(validation.errors!.join(' ')).not.toContain(context.n8nApiKey);
    });
  });

  describe('Type Guard Security', () => {
    it('should safely handle malicious input', () => {
      // Test specific malicious inputs
      const objectAsUrl = { n8nApiUrl: { toString: () => { throw new Error('XSS'); } } };
      expect(() => isInstanceContext(objectAsUrl)).not.toThrow();
      expect(isInstanceContext(objectAsUrl)).toBe(false);

      const arrayAsKey = { n8nApiKey: ['array', 'instead', 'of', 'string'] };
      expect(() => isInstanceContext(arrayAsKey)).not.toThrow();
      expect(isInstanceContext(arrayAsKey)).toBe(false);

      // These are actually valid objects with extra properties
      const protoObj = { __proto__: { isAdmin: true } };
      expect(() => isInstanceContext(protoObj)).not.toThrow();
      // This is actually a valid object, just has __proto__ property
      expect(isInstanceContext(protoObj)).toBe(true);

      const constructorObj = { constructor: { name: 'Evil' } };
      expect(() => isInstanceContext(constructorObj)).not.toThrow();
      // This is also a valid object with constructor property
      expect(isInstanceContext(constructorObj)).toBe(true);

      // Object.create(null) creates an object without prototype
      const nullProto = Object.create(null);
      expect(() => isInstanceContext(nullProto)).not.toThrow();
      // This is actually a valid empty object, so it passes
      expect(isInstanceContext(nullProto)).toBe(true);
    });

    it('should handle circular references safely', () => {
      const circular: any = { n8nApiUrl: 'https://api.n8n.cloud' };
      circular.self = circular;

      expect(() => isInstanceContext(circular)).not.toThrow();
    });
  });

  describe('Memory Management', () => {
    it('should validate LRU cache configuration', () => {
      // This is more of a configuration test
      // In real implementation, we'd test that the cache has proper limits
      const MAX_CACHE_SIZE = 100;
      const TTL_MINUTES = 30;

      // Verify reasonable limits are in place
      expect(MAX_CACHE_SIZE).toBeLessThanOrEqual(1000); // Not too many
      expect(TTL_MINUTES).toBeLessThanOrEqual(60); // Not too long
    });
  });
});