import { describe, it, expect } from 'vitest';
import { validateInstanceContext, isInstanceContext, InstanceContext } from '@/types/instance-context';

const base: InstanceContext = { n8nApiUrl: 'https://n8n.example.com', n8nApiKey: 'valid-key' };

describe('InstanceContext.n8nMcpAccessToken', () => {
  it('is optional', () => {
    expect(validateInstanceContext(base).valid).toBe(true);
    expect(isInstanceContext(base)).toBe(true);
  });
  it('accepts a well-formed token', () => {
    const ctx = { ...base, n8nMcpAccessToken: 'eyJhbGciOi.abc.def' };
    expect(validateInstanceContext(ctx).valid).toBe(true);
    expect(isInstanceContext(ctx)).toBe(true);
  });
  it('rejects whitespace, empty, placeholder and non-string tokens without echoing the value', () => {
    for (const bad of ['', 'a b', 'YOUR_TOKEN_HERE', 'placeholder', 123 as any]) {
      const result = validateInstanceContext({ ...base, n8nMcpAccessToken: bad });
      expect(result.valid).toBe(false);
      expect(result.errors?.join(' ')).toContain('Invalid n8nMcpAccessToken');
      expect(result.errors?.join(' ')).not.toContain('YOUR_TOKEN_HERE');
      expect(isInstanceContext({ ...base, n8nMcpAccessToken: bad })).toBe(false);
    }
  });
});
