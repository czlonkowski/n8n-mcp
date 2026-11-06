import { describe, it, expect } from 'vitest';
import { sanitizeErrorMessageCore } from '../../../src/telemetry/error-sanitization-utils';

describe('sanitizeErrorMessageCore', () => {
  it('removes long tokens whatever their last character', () => {
    for (const token of ['a'.repeat(32), 'a'.repeat(31) + '-', 'a'.repeat(31) + '_']) {
      expect(sanitizeErrorMessageCore(`failed with ${token} here`)).not.toContain('a'.repeat(16));
    }
  });
});
