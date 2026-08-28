import { describe, it, expect } from 'vitest';
import * as root from '@/index';

describe('package root exports', () => {
  it('re-exports the official MCP probe for embedders', () => {
    expect(typeof root.probeOfficialMcp).toBe('function');
    expect(typeof root.N8NMCPEngine).toBe('function');
  });
});
