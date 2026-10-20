import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { AuthManager } from '../../../src/utils/auth';

/**
 * Unit tests for AuthManager.timingSafeCompare
 *
 * SECURITY: These tests verify delegation to the constant-time crypto primitive
 * See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-02)
 */
describe('AuthManager.timingSafeCompare', () => {
  describe('Security: Timing Attack Prevention', () => {
    it('should return true for matching tokens', () => {
      const token = 'a'.repeat(32);
      const result = AuthManager.timingSafeCompare(token, token);
      expect(result).toBe(true);
    });

    it('should return false for different tokens', () => {
      const token1 = 'a'.repeat(32);
      const token2 = 'b'.repeat(32);
      const result = AuthManager.timingSafeCompare(token1, token2);
      expect(result).toBe(false);
    });

    it('should return false for tokens of different lengths', () => {
      const token1 = 'a'.repeat(32);
      const token2 = 'a'.repeat(64);
      const result = AuthManager.timingSafeCompare(token1, token2);
      expect(result).toBe(false);
    });

    it('should return false for empty tokens', () => {
      expect(AuthManager.timingSafeCompare('', 'test')).toBe(false);
      expect(AuthManager.timingSafeCompare('test', '')).toBe(false);
      expect(AuthManager.timingSafeCompare('', '')).toBe(false);
    });

    it.each([
      ['matching', 'a'.repeat(64), true],
      ['first character differs', 'b' + 'a'.repeat(63), false],
      ['last character differs', 'a'.repeat(63) + 'b', false],
    ] as const)('delegates full buffers to timingSafeEqual when %s', (_case, candidate, expected) => {
      const correctToken = 'a'.repeat(64);
      // Preserve the real primitive. Wall-clock variance under CI load cannot
      // establish constant-time behavior; guard against an early string comparison.
      const compare = vi.spyOn(crypto, 'timingSafeEqual');
      try {
        expect(AuthManager.timingSafeCompare(candidate, correctToken)).toBe(expected);
        expect(compare).toHaveBeenCalledExactlyOnceWith(
          Buffer.from(candidate, 'utf8'), Buffer.from(correctToken, 'utf8'),
        );
      } finally {
        compare.mockRestore();
      }
    });

    it('should handle special characters safely', () => {
      const token1 = 'abc!@#$%^&*()_+-=[]{}|;:,.<>?';
      const token2 = 'abc!@#$%^&*()_+-=[]{}|;:,.<>?';
      const token3 = 'xyz!@#$%^&*()_+-=[]{}|;:,.<>?';

      expect(AuthManager.timingSafeCompare(token1, token2)).toBe(true);
      expect(AuthManager.timingSafeCompare(token1, token3)).toBe(false);
    });

    it('should handle unicode characters', () => {
      const token1 = '你好世界🌍🔒';
      const token2 = '你好世界🌍🔒';
      const token3 = '你好世界🌍❌';

      expect(AuthManager.timingSafeCompare(token1, token2)).toBe(true);
      expect(AuthManager.timingSafeCompare(token1, token3)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined gracefully', () => {
      expect(AuthManager.timingSafeCompare(null as any, 'test')).toBe(false);
      expect(AuthManager.timingSafeCompare('test', null as any)).toBe(false);
      expect(AuthManager.timingSafeCompare(undefined as any, 'test')).toBe(false);
      expect(AuthManager.timingSafeCompare('test', undefined as any)).toBe(false);
    });

    it('should handle very long tokens', () => {
      const longToken = 'a'.repeat(10000);
      expect(AuthManager.timingSafeCompare(longToken, longToken)).toBe(true);
      expect(AuthManager.timingSafeCompare(longToken, 'b'.repeat(10000))).toBe(false);
    });

    it('should handle whitespace correctly', () => {
      const token1 = 'test-token-with-spaces';
      const token2 = 'test-token-with-spaces '; // Trailing space
      const token3 = ' test-token-with-spaces'; // Leading space

      expect(AuthManager.timingSafeCompare(token1, token1)).toBe(true);
      expect(AuthManager.timingSafeCompare(token1, token2)).toBe(false);
      expect(AuthManager.timingSafeCompare(token1, token3)).toBe(false);
    });

    it('should be case-sensitive', () => {
      const token1 = 'TestToken123';
      const token2 = 'testtoken123';

      expect(AuthManager.timingSafeCompare(token1, token2)).toBe(false);
    });
  });
});
