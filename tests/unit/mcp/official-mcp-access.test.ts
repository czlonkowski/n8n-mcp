import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
import { resolveOfficialMcpConfig, getOfficialMcpClient, notConfiguredResponse, officialFailure, clearOfficialMcpClientCache } from '@/mcp/official-mcp-access';
import { OfficialMcpError } from '@/services/n8n-official-mcp-client';

const ENV = ['N8N_API_URL', 'N8N_API_KEY', 'N8N_MCP_ACCESS_TOKEN'] as const;
let saved: Record<string, string | undefined>;
beforeEach(async () => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); ENV.forEach(k => delete process.env[k]); await clearOfficialMcpClientCache(); });
afterEach(() => { ENV.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('resolveOfficialMcpConfig', () => {
  it('prefers the instance context and never falls back to env when the context has API credentials', () => {
    process.env.N8N_API_URL = 'https://env.example.com'; process.env.N8N_API_KEY = 'k'; process.env.N8N_MCP_ACCESS_TOKEN = 'envtok';
    expect(resolveOfficialMcpConfig({ n8nApiUrl: 'https://ctx.example.com', n8nApiKey: 'k2' })).toBeNull();
    expect(resolveOfficialMcpConfig({ n8nApiUrl: 'https://ctx.example.com', n8nApiKey: 'k2', n8nMcpAccessToken: 'ctxtok' }))
      .toEqual({ endpoint: 'https://ctx.example.com/mcp-server/http', token: 'ctxtok' });
  });
  it('uses env when there is no instance context', () => {
    process.env.N8N_API_URL = 'https://env.example.com'; process.env.N8N_API_KEY = 'k'; process.env.N8N_MCP_ACCESS_TOKEN = 'envtok';
    expect(resolveOfficialMcpConfig(undefined)).toEqual({ endpoint: 'https://env.example.com/mcp-server/http', token: 'envtok' });
  });
});

describe('getOfficialMcpClient', () => {
  it('returns null when not configured and makes no network call', () => {
    expect(getOfficialMcpClient({ n8nApiUrl: 'https://ctx.example.com', n8nApiKey: 'k' })).toBeNull();
  });
  it('caches per endpoint+token+instanceId and separates tokens', () => {
    const a1 = getOfficialMcpClient({ n8nApiUrl: 'https://ctx.example.com', n8nApiKey: 'k', n8nMcpAccessToken: 't1', instanceId: 'i' });
    const a2 = getOfficialMcpClient({ n8nApiUrl: 'https://ctx.example.com', n8nApiKey: 'k', n8nMcpAccessToken: 't1', instanceId: 'i' });
    const b = getOfficialMcpClient({ n8nApiUrl: 'https://ctx.example.com', n8nApiKey: 'k', n8nMcpAccessToken: 't2', instanceId: 'i' });
    expect(a1).toBe(a2); expect(a1).not.toBe(b); expect(a1?.endpoint).toBe('https://ctx.example.com/mcp-server/http');
  });
});

describe('envelopes', () => {
  it('notConfiguredResponse uses the env hint by default and the embedder hint when provided (text only, capped)', () => {
    const def = notConfiguredResponse(undefined, 'search');
    expect(def).toMatchObject({ success: false, action: 'search', code: 'NOT_CONFIGURED' });
    expect(def.hint).toContain('N8N_MCP_ACCESS_TOKEN');
    const custom = notConfiguredResponse({ n8nApiUrl: 'https://x.example.com', n8nApiKey: 'k', metadata: { officialMcpSetupHint: '<b>Open</b> the instance page ' + 'x'.repeat(600) } }, 'get');
    expect(custom.hint).not.toContain('<b>'); expect(custom.hint!.length).toBeLessThanOrEqual(500);
  });
  it('officialFailure maps OfficialMcpError and unknown errors', () => {
    expect(officialFailure(new OfficialMcpError('OFFICIAL_MCP_RATE_LIMITED', 'slow down', 429), 'call'))
      .toMatchObject({ success: false, action: 'call', code: 'OFFICIAL_MCP_RATE_LIMITED', error: 'slow down', details: { status: 429 } });
    expect(officialFailure(new Error('socket hang up'))).toMatchObject({ code: 'OFFICIAL_MCP_TRANSPORT_ERROR' });
    expect(JSON.stringify(officialFailure(new OfficialMcpError('OFFICIAL_MCP_AUTH_FAILED', 'n8n rejected the MCP access token', 401)))).not.toContain('secret-value');
  });
});
