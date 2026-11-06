import { describe, it, expect } from 'vitest';
import { stripTrailingSlashes } from '../../../src/utils/strip-trailing-slashes';

const viaRegex = (value: string) => value.replace(/\/+$/, '');

describe('stripTrailingSlashes', () => {
  it.each([
    '',
    '/',
    '///',
    'https://n8n.example.com',
    'https://n8n.example.com/',
    'https://n8n.example.com///',
    'https://n8n.example.com/api/v1/',
    '/webhook//path//',
    'a/b',
    ' https://x/ ',
  ])('matches the regex form for %j', (value) => {
    expect(stripTrailingSlashes(value)).toBe(viaRegex(value));
  });

  it('returns the same string instance when nothing is stripped', () => {
    const value = 'https://n8n.example.com/api';
    expect(stripTrailingSlashes(value)).toBe(value);
  });

  it('stays fast on many slashes that are not at the end', () => {
    // The regex form backtracks quadratically on this shape of input.
    const hostile = '/'.repeat(200_000) + 'x';
    const start = performance.now();
    expect(stripTrailingSlashes(hostile)).toBe(hostile);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
