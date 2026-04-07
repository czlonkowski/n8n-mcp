/**
 * Comprehensive unit tests for instance-context.ts coverage gaps
 *
 * This test file targets the missing 9 lines (14.29%) to achieve >95% coverage
 */

import { describe, it, expect } from 'vitest';
import {
  InstanceContext,
  isInstanceContext,
  validateInstanceContext
} from '../../../src/types/instance-context';

describe('instance-context Coverage Tests', () => {
  describe('validateInstanceContext Edge Cases', () => {
    it('should handle empty string URL validation', () => {
      const context: InstanceContext = {
        n8nApiUrl: '', // Empty string should be invalid
        n8nApiKey: 'valid-key'
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid n8nApiUrl:');
      expect(result.errors?.[0]).toContain('empty string');
    });

    it('should handle empty string API key validation', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: '' // Empty string should be invalid
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid n8nApiKey:');
      expect(result.errors?.[0]).toContain('empty string');
    });

    it('should handle Infinity values for timeout', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiTimeout: Infinity // Should be invalid
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid n8nApiTimeout:');
      expect(result.errors?.[0]).toContain('Must be a finite number');
    });

    it('should handle -Infinity values for timeout', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiTimeout: -Infinity // Should be invalid
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid n8nApiTimeout:');
      expect(result.errors?.[0]).toContain('Must be positive');
    });

    it('should handle Infinity values for retries', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiMaxRetries: Infinity // Should be invalid
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid n8nApiMaxRetries:');
      expect(result.errors?.[0]).toContain('Must be a finite number');
    });

    it('should handle -Infinity values for retries', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiMaxRetries: -Infinity // Should be invalid
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid n8nApiMaxRetries:');
      expect(result.errors?.[0]).toContain('Must be non-negative');
    });

    it('should handle multiple validation errors at once', () => {
      const context: InstanceContext = {
        n8nApiUrl: '', // Invalid
        n8nApiKey: '', // Invalid
        n8nApiTimeout: 0, // Invalid (not positive)
        n8nApiMaxRetries: -1 // Invalid (negative)
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(4);
      expect(result.errors?.some(err => err.includes('Invalid n8nApiUrl:'))).toBe(true);
      expect(result.errors?.some(err => err.includes('Invalid n8nApiKey:'))).toBe(true);
      expect(result.errors?.some(err => err.includes('Invalid n8nApiTimeout:'))).toBe(true);
      expect(result.errors?.some(err => err.includes('Invalid n8nApiMaxRetries:'))).toBe(true);
    });

    it('should return no errors property when validation passes', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiTimeout: 30000,
        n8nApiMaxRetries: 3
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined(); // Should be undefined, not empty array
    });

    it('should handle context with only optional fields undefined', () => {
      const context: InstanceContext = {
        // All optional fields undefined
      };

      const result = validateInstanceContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  describe('isInstanceContext Edge Cases', () => {
    it('should handle null metadata', () => {
      const context = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        metadata: null // null is not allowed
      };

      const result = isInstanceContext(context);

      expect(result).toBe(false);
    });

    it('should handle valid metadata object', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        metadata: {
          userId: 'user123',
          nested: {
            data: 'value'
          }
        }
      };

      const result = isInstanceContext(context);

      expect(result).toBe(true);
    });

    it('should handle edge case URL validation in type guard', () => {
      const context = {
        n8nApiUrl: 'ftp://invalid-protocol.com', // Invalid protocol
        n8nApiKey: 'valid-key'
      };

      const result = isInstanceContext(context);

      expect(result).toBe(false);
    });

    it('should handle edge case API key validation in type guard', () => {
      const context = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'placeholder' // Invalid placeholder key
      };

      const result = isInstanceContext(context);

      expect(result).toBe(false);
    });

    it('should handle zero timeout in type guard', () => {
      const context = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiTimeout: 0 // Invalid (not positive)
      };

      const result = isInstanceContext(context);

      expect(result).toBe(false);
    });

    it('should handle negative retries in type guard', () => {
      const context = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        n8nApiMaxRetries: -1 // Invalid (negative)
      };

      const result = isInstanceContext(context);

      expect(result).toBe(false);
    });

    it('should handle all invalid properties at once', () => {
      const context = {
        n8nApiUrl: 123, // Wrong type
        n8nApiKey: false, // Wrong type
        n8nApiTimeout: 'invalid', // Wrong type
        n8nApiMaxRetries: 'invalid', // Wrong type
        instanceId: 123, // Wrong type
        sessionId: [], // Wrong type
        metadata: 'invalid' // Wrong type
      };

      const result = isInstanceContext(context);

      expect(result).toBe(false);
    });
  });

  describe('URL Validation Function Edge Cases', () => {
    it('should handle URL constructor exceptions', () => {
      // Test the internal isValidUrl function through public API
      const context = {
        n8nApiUrl: 'http://[invalid-ipv6]', // Malformed URL that throws
        n8nApiKey: 'valid-key'
      };

      // Should not throw even with malformed URL
      expect(() => isInstanceContext(context)).not.toThrow();
      expect(isInstanceContext(context)).toBe(false);
    });

    it('should accept only http and https protocols', () => {
      const invalidProtocols = [
        'file://local/path',
        'ftp://ftp.example.com',
        'ssh://server.com',
        'data:text/plain,hello',
        'javascript:alert(1)',
        'vbscript:msgbox(1)',
        'ldap://server.com'
      ];

      invalidProtocols.forEach(url => {
        const context = {
          n8nApiUrl: url,
          n8nApiKey: 'valid-key'
        };

        expect(isInstanceContext(context)).toBe(false);
      });
    });
  });

  describe('API Key Validation Function Edge Cases', () => {
    it('should reject case-insensitive placeholder values', () => {
      const placeholderKeys = [
        'YOUR_API_KEY',
        'your_api_key',
        'Your_Api_Key',
        'PLACEHOLDER',
        'placeholder',
        'PlaceHolder',
        'EXAMPLE',
        'example',
        'Example',
        'your_api_key_here',
        'example-key-here',
        'placeholder-token-here'
      ];

      placeholderKeys.forEach(key => {
        const context = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: key
        };

        expect(isInstanceContext(context)).toBe(false);

        const validation = validateInstanceContext(context);
        expect(validation.valid).toBe(false);
        // Check for any of the specific error messages
        const hasValidError = validation.errors?.some(err =>
          err.includes('Invalid n8nApiKey:') && (
            err.includes('placeholder') ||
            err.includes('example') ||
            err.includes('your_api_key')
          )
        );
        expect(hasValidError).toBe(true);
      });
    });

    it('should accept valid API keys with mixed case', () => {
      const validKeys = [
        'ValidApiKey123',
        'VALID_API_KEY_456',
        'sk_live_AbCdEf123456',
        'token_Mixed_Case_789',
        'api-key-with-CAPS-and-numbers-123'
      ];

      validKeys.forEach(key => {
        const context: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiKey: key
        };

        expect(isInstanceContext(context)).toBe(true);

        const validation = validateInstanceContext(context);
        expect(validation.valid).toBe(true);
      });
    });
  });

  describe('Complex Object Structure Tests', () => {
    it('should handle deeply nested metadata', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'valid-key',
        metadata: {
          level1: {
            level2: {
              level3: {
                data: 'deep value'
              }
            }
          },
          array: [1, 2, 3],
          nullValue: null,
          undefinedValue: undefined
        }
      };

      expect(isInstanceContext(context)).toBe(true);

      const validation = validateInstanceContext(context);
      expect(validation.valid).toBe(true);
    });

    it('should handle context with all optional properties as undefined', () => {
      const context: InstanceContext = {
        n8nApiUrl: undefined,
        n8nApiKey: undefined,
        n8nApiTimeout: undefined,
        n8nApiMaxRetries: undefined,
        instanceId: undefined,
        sessionId: undefined,
        metadata: undefined
      };

      expect(isInstanceContext(context)).toBe(true);

      const validation = validateInstanceContext(context);
      expect(validation.valid).toBe(true);
    });
  });

  describe('Cookie Authentication', () => {
    it('should accept context with only cookie credential', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiCookie: 'n8n-auth=abc123; Path=/'
      };

      expect(isInstanceContext(context)).toBe(true);
      const validation = validateInstanceContext(context);
      expect(validation.valid).toBe(true);
    });

    it('should accept context with both apiKey and cookie (apiKey takes precedence)', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiKey: 'my-api-key',
        n8nApiCookie: 'n8n-auth=abc123'
      };

      expect(isInstanceContext(context)).toBe(true);
      const validation = validateInstanceContext(context);
      expect(validation.valid).toBe(true);
    });

    it('should reject empty string cookie', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiCookie: ''
      };

      const validation = validateInstanceContext(context);
      expect(validation.valid).toBe(false);
      expect(validation.errors?.[0]).toContain('Invalid n8nApiCookie:');
      expect(validation.errors?.[0]).toContain('empty string');
    });

    it('should reject placeholder cookie values', () => {
      const placeholderCookies = [
        'your_cookie',
        'YOUR_COOKIE',
        'placeholder',
        'example',
      ];

      placeholderCookies.forEach(cookie => {
        const context: InstanceContext = {
          n8nApiUrl: 'https://api.n8n.cloud',
          n8nApiCookie: cookie
        };

        const validation = validateInstanceContext(context);
        expect(validation.valid).toBe(false);
        expect(validation.errors?.some(e => e.includes('Invalid n8nApiCookie:'))).toBe(true);
      });
    });

    it('should reject invalid cookie in isInstanceContext type guard', () => {
      const context = {
        n8nApiUrl: 'https://api.n8n.cloud',
        n8nApiCookie: 'placeholder'
      };

      expect(isInstanceContext(context)).toBe(false);
    });

    it('should accept context with no credentials (documentation-only usage)', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://api.n8n.cloud'
      };

      expect(isInstanceContext(context)).toBe(true);
      const validation = validateInstanceContext(context);
      expect(validation.valid).toBe(true);
    });
  });
});