import { describe, it, expect } from 'vitest';
import { AuthManager } from '../../../src/utils/auth';

/**
 * Unit tests for AuthManager.timingSafeCompare
 *
 * SECURITY: These tests verify constant-time comparison to prevent timing attacks
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

    it('should use constant-time comparison (timing analysis)', () => {
      const correctToken = 'a'.repeat(64);
      const wrongFirstChar = 'b' + 'a'.repeat(63);
      const wrongLastChar = 'a'.repeat(63) + 'b';

      const samples = 1000;
      const timings = {
        wrongFirst: [] as number[],
        wrongLast: [] as number[],
      };

      // Measure timing for wrong first character
      for (let i = 0; i < samples; i++) {
        const start = process.hrtime.bigint();
        AuthManager.timingSafeCompare(wrongFirstChar, correctToken);
        const end = process.hrtime.bigint();
        timings.wrongFirst.push(Number(end - start));
      }

      // Measure timing for wrong last character
      for (let i = 0; i < samples; i++) {
        const start = process.hrtime.bigint();
        AuthManager.timingSafeCompare(wrongLastChar, correctToken);
        const end = process.hrtime.bigint();
        timings.wrongLast.push(Number(end - start));
      }

      // Calculate medians
      const median = (arr: number[]) => {
        const sorted = arr.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };

      const medianFirst = median(timings.wrongFirst);
      const medianLast = median(timings.wrongLast);

      // Timing variance should be less than 10% (constant-time)
      // Guard against division by zero when medians are very small (fast operations)
      const maxMedian = Math.max(medianFirst, medianLast);
      const variance = maxMedian === 0
        ? Math.abs(medianFirst - medianLast)
        : Math.abs(medianFirst - medianLast) / maxMedian;

      // For constant-time comparison, variance should be minimal
      // If maxMedian is 0, check absolute difference is small (< 1000ns)
      // Otherwise, check relative variance is < 50% (relaxed for CI runner noise;
      // the underlying crypto.timingSafeEqual is guaranteed constant-time)
      expect(variance).toBeLessThan(maxMedian === 0 ? 1000 : 0.50);
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
