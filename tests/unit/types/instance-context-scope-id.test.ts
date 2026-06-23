import { describe, it, expect } from 'vitest';
import { getInstanceScopeId, type InstanceContext } from '@/types/instance-context';

/**
 * Tests for the tenant scope key used to isolate the local workflow_versions
 * table (GHSA-j6r7-6fhx-77wx). The key must be deterministic (it is persisted
 * and compared on later reads) and non-spoofable (bound to the API key).
 */
describe('getInstanceScopeId', () => {
  const base: InstanceContext = {
    n8nApiUrl: 'https://n8n.example.com',
    n8nApiKey: 'secret-key-123'
  };

  it('returns "" when no credentials are present (single-user mode)', () => {
    expect(getInstanceScopeId(undefined)).toBe('');
    expect(getInstanceScopeId({})).toBe('');
    expect(getInstanceScopeId({ n8nApiUrl: 'https://n8n.example.com' })).toBe('');
    expect(getInstanceScopeId({ n8nApiKey: 'secret-key-123' })).toBe('');
  });

  it('is deterministic across calls for the same credentials', () => {
    expect(getInstanceScopeId(base)).toBe(getInstanceScopeId({ ...base }));
  });

  it('produces a 32-char hex id', () => {
    expect(getInstanceScopeId(base)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs when the API key differs (non-spoofable across tenants)', () => {
    const a = getInstanceScopeId(base);
    const b = getInstanceScopeId({ ...base, n8nApiKey: 'different-key' });
    expect(a).not.toBe(b);
  });

  it('differs when the URL differs', () => {
    const a = getInstanceScopeId(base);
    const b = getInstanceScopeId({ ...base, n8nApiUrl: 'https://other.example.com' });
    expect(a).not.toBe(b);
  });

  it('normalizes trailing slashes and case in the URL', () => {
    const canonical = getInstanceScopeId(base);
    expect(getInstanceScopeId({ ...base, n8nApiUrl: 'https://n8n.example.com/' })).toBe(canonical);
    expect(getInstanceScopeId({ ...base, n8nApiUrl: 'https://N8N.EXAMPLE.COM' })).toBe(canonical);
    expect(getInstanceScopeId({ ...base, n8nApiUrl: '  https://n8n.example.com  ' })).toBe(canonical);
  });

  it('does not include the API key in the derived id', () => {
    expect(getInstanceScopeId(base)).not.toContain('secret-key-123');
  });
});
