import { describe, it, expect } from 'vitest';
import { parseTypeVersion, isValidTypeVersion } from '@/utils/typeversion';

describe('parseTypeVersion', () => {
  describe('numbers', () => {
    it('returns finite numbers as-is', () => {
      expect(parseTypeVersion(1)).toBe(1);
      expect(parseTypeVersion(2.3)).toBe(2.3);
      expect(parseTypeVersion(0)).toBe(0);
    });

    it('rejects NaN and Infinity', () => {
      expect(parseTypeVersion(NaN)).toBeNull();
      expect(parseTypeVersion(Infinity)).toBeNull();
      expect(parseTypeVersion(-Infinity)).toBeNull();
    });

    it('rejects negative numbers (consistency with isValidTypeVersion / validator)', () => {
      expect(parseTypeVersion(-1)).toBeNull();
      expect(parseTypeVersion(-0.5)).toBeNull();
    });
  });

  describe('arrays', () => {
    it('returns the maximum of a number array', () => {
      expect(parseTypeVersion([1, 2, 2.1])).toBe(2.1);
      expect(parseTypeVersion([1])).toBe(1);
    });

    it('ignores non-finite entries', () => {
      expect(parseTypeVersion([1, NaN, 2])).toBe(2);
    });

    it('returns null for empty or all-invalid arrays', () => {
      expect(parseTypeVersion([])).toBeNull();
      expect(parseTypeVersion([NaN, Infinity])).toBeNull();
    });
  });

  describe('strings', () => {
    it('parses single-integer strings', () => {
      expect(parseTypeVersion('1')).toBe(1);
      expect(parseTypeVersion('  2 ')).toBe(2);
    });

    it('parses single-decimal strings', () => {
      expect(parseTypeVersion('2.3')).toBe(2.3);
      expect(parseTypeVersion('1.1')).toBe(1.1);
    });

    it('parses comma-separated arrays from .toString()', () => {
      expect(parseTypeVersion('1,2')).toBe(2);
      expect(parseTypeVersion('1, 2, 3')).toBe(3);
    });

    it('parses JSON array strings', () => {
      expect(parseTypeVersion('[1, 2]')).toBe(2);
      expect(parseTypeVersion('[1]')).toBe(1);
    });

    // The whole reason this helper exists.
    it('rejects npm-package-style multi-dot semver strings', () => {
      expect(parseTypeVersion('0.2.21')).toBeNull();
      expect(parseTypeVersion('2.1.17-rc.31')).toBeNull();
      expect(parseTypeVersion('1.0.0')).toBeNull();
    });

    it('rejects negative numeric strings', () => {
      expect(parseTypeVersion('-1')).toBeNull();
      expect(parseTypeVersion('-0.5')).toBeNull();
    });

    it('rejects empty and whitespace strings', () => {
      expect(parseTypeVersion('')).toBeNull();
      expect(parseTypeVersion('   ')).toBeNull();
    });

    it('rejects non-numeric strings', () => {
      expect(parseTypeVersion('alpha')).toBeNull();
      expect(parseTypeVersion('v1.0')).toBeNull();
    });

    it('returns null for malformed JSON arrays', () => {
      expect(parseTypeVersion('[1, 2')).toBeNull();
    });
  });

  describe('null and undefined', () => {
    it('returns null', () => {
      expect(parseTypeVersion(null)).toBeNull();
      expect(parseTypeVersion(undefined)).toBeNull();
    });
  });

  describe('other types', () => {
    it('returns null for objects, booleans, etc.', () => {
      expect(parseTypeVersion({})).toBeNull();
      expect(parseTypeVersion(true)).toBeNull();
      expect(parseTypeVersion(Symbol('x'))).toBeNull();
    });
  });
});

describe('isValidTypeVersion', () => {
  it('accepts finite non-negative numbers', () => {
    expect(isValidTypeVersion(0)).toBe(true);
    expect(isValidTypeVersion(1)).toBe(true);
    expect(isValidTypeVersion(2.3)).toBe(true);
  });

  it('rejects negative numbers, NaN, Infinity, non-numbers', () => {
    expect(isValidTypeVersion(-1)).toBe(false);
    expect(isValidTypeVersion(NaN)).toBe(false);
    expect(isValidTypeVersion(Infinity)).toBe(false);
    expect(isValidTypeVersion('1')).toBe(false);
    expect(isValidTypeVersion(null)).toBe(false);
    expect(isValidTypeVersion(undefined)).toBe(false);
  });
});
