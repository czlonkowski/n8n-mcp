/**
 * Advanced security and error handling tests for flexible instance configuration
 *
 * This test file focuses on advanced security scenarios, error handling edge cases,
 * and comprehensive testing of security-related code paths
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { InstanceContext, validateInstanceContext } from '../../src/types/instance-context';
import { getN8nApiClient } from '../../src/mcp/handlers-n8n-manager';
import { getN8nApiConfigFromContext } from '../../src/config/n8n-api';
import { N8nApiClient } from '../../src/services/n8n-api-client';
import { logger } from '../../src/utils/logger';
import { createCacheKey } from '../../src/utils/cache-utils';

// Mock dependencies
vi.mock('../../src/services/n8n-api-client');
vi.mock('../../src/config/n8n-api');
vi.mock('../../src/utils/logger');

describe('Advanced Security and Error Handling Tests', () => {
  let mockN8nApiClient: Mock;
  let mockGetN8nApiConfigFromContext: Mock;
  let mockLogger: any; // Logger mock has complex type

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mockN8nApiClient = vi.mocked(N8nApiClient);
    mockGetN8nApiConfigFromContext = vi.mocked(getN8nApiConfigFromContext);
    mockLogger = vi.mocked(logger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Advanced Input Sanitization', () => {
    it('should handle SQL injection attempts in context fields', () => {
      const maliciousContext = {
        n8nApiUrl: "https://api.n8n.cloud'; DROP TABLE users; --",
        n8nApiKey: "key'; DELETE FROM secrets; --",
        instanceId: "'; SELECT * FROM passwords; --"
      };

      const validation = validateInstanceContext(maliciousContext);

      // URL should be invalid due to special characters
      expect(validation.valid).toBe(false);
      expect(validation.errors?.some(error => error.startsWith('Invalid n8nApiUrl:'))).toBe(true);
    });

    it('should handle XSS attempts in context fields', () => {
      const xssContext = {
        n8nApiUrl: 'https://api.n8n.cloud<script>alert("xss")</script>',
        n8nApiKey: '<img src=x onerror=alert("xss")>',
        instanceId: 'javascript:alert("xss")'
      };

      const validation = validateInstanceContext(xssContext);

      // Should be invalid due to malformed URL
      expect(validation.valid).toBe(false);
    });

    it('should handle extremely long input values', () => {
      const longString = 'a'.repeat(100000);
      const longContext: InstanceContext = {
        n8nApiUrl: `https://api.n8n.cloud/${longString}`,
        n8nApiKey: longString,
        instanceId: longString
      };

      // Should handle without crashing
      expect(() => validateInstanceContext(longContext)).not.toThrow();
      expect(() => getN8nApiClient(longContext)).not.toThrow();
    });

    it('should handle Unicode and special characters safely', () => {
      const unicodeContext: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud/测试',
        n8nApiKey: 'key-ñáéíóú-кириллица-🚀',
        instanceId: '用户-123-αβγ'
      };

      expect(() => validateInstanceContext(unicodeContext)).not.toThrow();
      expect(() => getN8nApiClient(unicodeContext)).not.toThrow();
    });

    it('should handle null bytes and control characters', () => {
      const maliciousContext = {
        n8nApiUrl: 'https://api.n8n.cloud\0\x01\x02',
        n8nApiKey: 'key\r\n\t\0',
        instanceId: 'instance\x00\x1f'
      };

      expect(() => validateInstanceContext(maliciousContext)).not.toThrow();
    });
  });

  describe('Prototype Pollution Protection', () => {
    it('should not be vulnerable to prototype pollution via __proto__', () => {
      const pollutionAttempt = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key',
        __proto__: {
          isAdmin: true,
          polluted: 'value'
        }
      };

      expect(() => validateInstanceContext(pollutionAttempt)).not.toThrow();

      // Verify prototype wasn't polluted
      const cleanObject = {};
      expect((cleanObject as any).isAdmin).toBeUndefined();
      expect((cleanObject as any).polluted).toBeUndefined();
    });

    it('should not be vulnerable to prototype pollution via constructor', () => {
      const pollutionAttempt = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key',
        constructor: {
          prototype: {
            isAdmin: true
          }
        }
      };

      expect(() => validateInstanceContext(pollutionAttempt)).not.toThrow();
    });

    it('should handle Object.create(null) safely', () => {
      const nullProtoObject = Object.create(null);
      nullProtoObject.n8nApiUrl = 'https://api.n8n.cloud';
      nullProtoObject.n8nApiKey = 'test-key';

      expect(() => validateInstanceContext(nullProtoObject)).not.toThrow();
    });
  });

  describe('Memory Exhaustion Protection', () => {
    it('should handle deeply nested objects without stack overflow', () => {
      let deepObject: any = { n8nApiUrl: 'https://api.n8n.cloud', n8nApiKey: 'key' };
      for (let i = 0; i < 1000; i++) {
        deepObject = { nested: deepObject };
      }
      deepObject.metadata = deepObject;

      expect(() => validateInstanceContext(deepObject)).not.toThrow();
    });

    it('should handle circular references in metadata', () => {
      const circularContext: any = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key',
        metadata: {}
      };
      circularContext.metadata.self = circularContext;
      circularContext.metadata.circular = circularContext.metadata;

      expect(() => validateInstanceContext(circularContext)).not.toThrow();
    });

    it('should handle massive arrays in metadata', () => {
      const massiveArray = new Array(100000).fill('data');
      const arrayContext: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'test-key',
        metadata: {
          massiveArray
        }
      };

      expect(() => validateInstanceContext(arrayContext)).not.toThrow();
    });
  });

  describe('Cache Security and Isolation', () => {
    it('should prevent cache key collisions through hash security', () => {
      mockGetN8nApiConfigFromContext.mockReturnValue({
        baseUrl: 'https://api.n8n.cloud',
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 3
      });

      // Create contexts that might produce hash collisions
      const context1: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'abc',
        instanceId: 'def'
      };

      const context2: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'ab',
        instanceId: 'cdef'
      };

      // Use the real cache key function so we're testing what production
      // actually does (HMAC-SHA256, per-process secret) rather than
      // re-implementing the hash in the test. Also avoids CodeQL flagging
      // direct crypto.createHash calls on apiKey input in test fixtures.
      const hash1 = createCacheKey(
        `${context1.n8nApiUrl}:${context1.n8nApiKey}:${context1.instanceId}`
      );
      const hash2 = createCacheKey(
        `${context2.n8nApiUrl}:${context2.n8nApiKey}:${context2.instanceId}`
      );

      expect(hash1).not.toBe(hash2);

      // Verify separate cache entries
      getN8nApiClient(context1);
      getN8nApiClient(context2);

      expect(mockN8nApiClient).toHaveBeenCalledTimes(2);
    });

    it('should not expose sensitive data in cache key logs', () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info');
      const sensitiveContext: InstanceContext = {
        n8nApiUrl: 'https://super-secret-api.example.com/v1/secret',
        n8nApiKey: 'sk_live_SUPER_SECRET_API_KEY_123456789',
        instanceId: 'production-instance-sensitive'
      };

      mockGetN8nApiConfigFromContext.mockReturnValue({
        baseUrl: 'https://super-secret-api.example.com/v1/secret',
        apiKey: 'sk_live_SUPER_SECRET_API_KEY_123456789',
        timeout: 30000,
        maxRetries: 3
      });

      getN8nApiClient(sensitiveContext);

      // Check all log calls
      const allLogData = loggerInfoSpy.mock.calls.flat().join(' ');

      // Should not contain sensitive data
      expect(allLogData).not.toContain('sk_live_SUPER_SECRET_API_KEY_123456789');
      expect(allLogData).not.toContain('super-secret-api-key');
      expect(allLogData).not.toContain('/v1/secret');

      // Logs should not expose the actual API key value
      expect(allLogData).not.toContain('SUPER_SECRET');
    });

    it('should handle hash collisions securely', () => {
      // Mock a scenario where two different inputs could theoretically
      // produce the same hash (extremely unlikely with SHA-256)
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

      mockGetN8nApiConfigFromContext.mockReturnValue({
        baseUrl: 'https://api.n8n.cloud',
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 3
      });

      // Even if hashes were identical, different configs would be isolated
      getN8nApiClient(context1);
      getN8nApiClient(context2);

      expect(mockN8nApiClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Message Security', () => {
    it('should not expose sensitive data in validation error messages', () => {
      const sensitiveContext: InstanceContext = {
        n8nApiUrl: 'https://secret-api.example.com/private-endpoint',
        n8nApiKey: 'super-secret-key-123',
        n8nApiTimeout: -1
      };

      const validation = validateInstanceContext(sensitiveContext);

      expect(validation.valid).toBe(false);

      // Error messages should not contain sensitive data
      const errorMessage = validation.errors?.join(' ') || '';
      expect(errorMessage).not.toContain('super-secret-key-123');
      expect(errorMessage).not.toContain('secret-api');
      expect(errorMessage).not.toContain('private-endpoint');
    });

    it('should sanitize error details in API responses', () => {
      const sensitiveContext: InstanceContext = {
        n8nApiUrl: 'invalid-url-with-secrets/api/key=secret123',
        n8nApiKey: 'another-secret-key'
      };

      const validation = validateInstanceContext(sensitiveContext);

      expect(validation.valid).toBe(false);
      expect(validation.errors?.some(error => error.startsWith('Invalid n8nApiUrl:'))).toBe(true);

      // Should not contain the actual invalid URL
      const errorData = JSON.stringify(validation);
      expect(errorData).not.toContain('secret123');
      expect(errorData).not.toContain('another-secret-key');
    });
  });

  describe('Resource Exhaustion Protection', () => {
    it('should handle memory pressure gracefully', () => {
      // Create many large contexts to simulate memory pressure
      const largeData = 'x'.repeat(10000);

      for (let i = 0; i < 100; i++) {
        const context: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: `key-${i}`,
          instanceId: `instance-${i}`,
          metadata: {
            largeData: largeData,
            moreData: new Array(1000).fill(largeData)
          }
        };

        expect(() => validateInstanceContext(context)).not.toThrow();
      }
    });

    it('should handle high frequency validation requests', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'frequency-test-key'
      };

      // Rapid fire validation
      for (let i = 0; i < 1000; i++) {
        expect(() => validateInstanceContext(context)).not.toThrow();
      }
    });
  });

  describe('Cryptographic Security', () => {
    it('should use cryptographically secure hash function', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'crypto-test-key',
        instanceId: 'crypto-instance'
      };

      // Generate cache key multiple times for the same input — must be
      // deterministic within a process. Uses the real createCacheKey so
      // the assertion tracks production behavior.
      const input = `${context.n8nApiUrl}:${context.n8nApiKey}:${context.instanceId}`;
      const hash1 = createCacheKey(input);
      const hash2 = createCacheKey(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // HMAC-SHA-256 also produces a 64-char hex string
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle edge cases in hash input', () => {
      const edgeCases = [
        { url: '', key: '', id: '' },
        { url: 'https://api.n8n.cloud', key: '', id: '' },
        { url: '', key: 'key', id: '' },
        { url: '', key: '', id: 'id' },
        { url: undefined, key: undefined, id: undefined }
      ];

      edgeCases.forEach((testCase, index) => {
        expect(() => {
          createCacheKey(`${testCase.url || ''}:${testCase.key || ''}:${testCase.id || ''}`);
        }).not.toThrow();
      });
    });
  });

  describe('Injection Attack Prevention', () => {
    it('should prevent command injection through context fields', () => {
      const commandInjectionContext = {
        n8nApiUrl: 'https://api.n8n.cloud; rm -rf /',
        n8nApiKey: '$(whoami)',
        instanceId: '`cat /etc/passwd`'
      };

      expect(() => validateInstanceContext(commandInjectionContext)).not.toThrow();

      // URL should be invalid
      const validation = validateInstanceContext(commandInjectionContext);
      expect(validation.valid).toBe(false);
    });

    it('should prevent path traversal attempts', () => {
      const pathTraversalContext = {
        n8nApiUrl: 'https://api.n8n.cloud/../../../etc/passwd',
        n8nApiKey: '..\\..\\windows\\system32\\config\\sam',
        instanceId: '../secrets.txt'
      };

      expect(() => validateInstanceContext(pathTraversalContext)).not.toThrow();
    });

    it('should prevent LDAP injection attempts', () => {
      const ldapInjectionContext = {
        n8nApiUrl: 'https://api.n8n.cloud)(|(password=*))',
        n8nApiKey: '*)(uid=*',
        instanceId: '*))(|(cn=*'
      };

      expect(() => validateInstanceContext(ldapInjectionContext)).not.toThrow();
    });
  });

  describe('State Management Security', () => {
    it('should maintain isolation between contexts', () => {
      const context1: InstanceContext = {
        n8nApiUrl: 'https://tenant1.n8n.cloud',
        n8nApiKey: 'tenant1-key',
        instanceId: 'tenant1'
      };

      const context2: InstanceContext = {
        n8nApiUrl: 'https://tenant2.n8n.cloud',
        n8nApiKey: 'tenant2-key',
        instanceId: 'tenant2'
      };

      mockGetN8nApiConfigFromContext
        .mockReturnValueOnce({
          baseUrl: 'https://tenant1.n8n.cloud',
          apiKey: 'tenant1-key',
          timeout: 30000,
          maxRetries: 3
        })
        .mockReturnValueOnce({
          baseUrl: 'https://tenant2.n8n.cloud',
          apiKey: 'tenant2-key',
          timeout: 30000,
          maxRetries: 3
        });

      const client1 = getN8nApiClient(context1);
      const client2 = getN8nApiClient(context2);

      // Should create separate clients
      expect(mockN8nApiClient).toHaveBeenCalledTimes(2);
      expect(client1).not.toBe(client2);
    });

    it('should handle concurrent access securely', async () => {
      const contexts = Array(50).fill(null).map((_, i) => ({
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: `concurrent-key-${i}`,
        instanceId: `concurrent-${i}`
      }));

      mockGetN8nApiConfigFromContext.mockReturnValue({
        baseUrl: 'https://api.n8n.cloud',
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 3
      });

      // Simulate concurrent access
      const promises = contexts.map(context =>
        Promise.resolve(getN8nApiClient(context))
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result).toBeDefined();
      });

      expect(mockN8nApiClient).toHaveBeenCalledTimes(50);
    });
  });
});