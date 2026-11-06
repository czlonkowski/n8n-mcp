import { describe, it, expect } from 'vitest';
import { IntentSanitizer } from '../../../src/telemetry/intent-sanitizer';

describe('IntentSanitizer', () => {
  it('removes email addresses, including local parts longer than 64 characters', () => {
    const sanitizer = new IntentSanitizer();
    expect(sanitizer.sanitize('notify jane.doe@example.com today')).toBe('notify [EMAIL] today');
    expect(sanitizer.sanitize(`notify ${'a.'.repeat(50)}b@example.com today`)).toBe('notify [EMAIL] today');
    expect(sanitizer.sanitize(`notify -${'a'.repeat(70)}@example.com`)).toBe('notify -[EMAIL]');
  });

  it('handles long dotted intents', () => {
    const sanitizer = new IntentSanitizer();
    const intent = 'b.'.repeat(40_000);
    const start = performance.now();
    sanitizer.sanitize(intent);
    sanitizer.containsPII(intent);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('replaces intents above the size cap', () => {
    const sanitizer = new IntentSanitizer();
    expect(sanitizer.sanitize('word '.repeat(2_001))).toBe('[TRUNCATED]');
    expect(sanitizer.sanitize('add a node')).toBe('add a node');
  });

  it('removes long tokens whatever their last character', () => {
    const sanitizer = new IntentSanitizer();
    for (const token of ['a'.repeat(32), 'a'.repeat(31) + '-', 'a'.repeat(31) + '_']) {
      expect(sanitizer.sanitize(`use ${token} now`)).not.toContain('a'.repeat(16));
    }
  });
});
