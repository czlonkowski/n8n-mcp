import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
import { resolveOfficialMcpConfig, getOfficialMcpClient, notConfiguredResponse, officialFailure, clearOfficialMcpClientCache, buildOfficialMcpHealth } from '@/mcp/official-mcp-access';
import { OfficialMcpError } from '@/services/n8n-official-mcp-client';
import { startFakeOfficialMcp, FakeOfficialMcp } from '../../helpers/fake-official-mcp-server';

const ENV = ['N8N_API_URL', 'N8N_API_KEY', 'N8N_MCP_ACCESS_TOKEN', 'ENABLE_MULTI_TENANT'] as const;
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
  it('treats a context with n8nApiUrl + n8nMcpAccessToken (no n8nApiKey) as authoritative, never falling back to env', () => {
    process.env.N8N_API_URL = 'https://env.example.com'; process.env.N8N_API_KEY = 'k'; process.env.N8N_MCP_ACCESS_TOKEN = 'envtok';
    expect(resolveOfficialMcpConfig({ n8nApiUrl: 'https://ctx.example.com', n8nMcpAccessToken: 'ctxtok' }))
      .toEqual({ endpoint: 'https://ctx.example.com/mcp-server/http', token: 'ctxtok' });
  });
  it('falls back to env for a context with neither n8nApiKey nor n8nMcpAccessToken, when multi-tenant mode is off', () => {
    process.env.N8N_API_URL = 'https://env.example.com'; process.env.N8N_API_KEY = 'k'; process.env.N8N_MCP_ACCESS_TOKEN = 'envtok';
    expect(resolveOfficialMcpConfig({ n8nApiUrl: 'https://ctx.example.com' }))
      .toEqual({ endpoint: 'https://env.example.com/mcp-server/http', token: 'envtok' });
  });
  it('refuses the env fallback in multi-tenant mode, with or without a context', () => {
    process.env.N8N_API_URL = 'https://env.example.com'; process.env.N8N_API_KEY = 'k'; process.env.N8N_MCP_ACCESS_TOKEN = 'envtok';
    process.env.ENABLE_MULTI_TENANT = 'true';
    expect(resolveOfficialMcpConfig({ n8nApiUrl: 'https://ctx.example.com' })).toBeNull();
    expect(resolveOfficialMcpConfig(undefined)).toBeNull();
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
  it('strips every angle bracket from the embedder hint, even nested/malformed tag-like input', () => {
    const custom = notConfiguredResponse({ n8nApiUrl: 'https://x.example.com', n8nApiKey: 'k', metadata: { officialMcpSetupHint: '<script<script<script>alert(1)' } }, 'get');
    expect(custom.hint).not.toContain('<');
    expect(custom.hint).not.toContain('>');
  });
  it('handles an embedder hint with 100k angle brackets in linear time', () => {
    const start = Date.now();
    const custom = notConfiguredResponse({ n8nApiUrl: 'https://x.example.com', n8nApiKey: 'k', metadata: { officialMcpSetupHint: '<'.repeat(100_000) } }, 'get');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(custom.hint).not.toContain('<');
    expect(custom.hint!.length).toBeLessThanOrEqual(500);
  });
  it('officialFailure maps OfficialMcpError and unknown errors', () => {
    expect(officialFailure(new OfficialMcpError('OFFICIAL_MCP_RATE_LIMITED', 'slow down', 429), 'call'))
      .toMatchObject({ success: false, action: 'call', code: 'OFFICIAL_MCP_RATE_LIMITED', error: 'slow down', details: { status: 429 } });
    expect(officialFailure(new Error('socket hang up'))).toMatchObject({ code: 'OFFICIAL_MCP_TRANSPORT_ERROR' });
    expect(officialFailure(new OfficialMcpError('OFFICIAL_MCP_AUTH_FAILED', 'n8n rejected the MCP access token', 401)))
      .toMatchObject({ success: false, code: 'OFFICIAL_MCP_AUTH_FAILED', error: 'n8n rejected the MCP access token', details: { status: 401 } });
  });
});

describe('buildOfficialMcpHealth', () => {
  let fake: FakeOfficialMcp;
  let savedMode: string | undefined;
  // The fake server listens on loopback, which the default strict SSRF mode
  // refuses before any request is made.
  beforeAll(() => { savedMode = process.env.WEBHOOK_SECURITY_MODE; process.env.WEBHOOK_SECURITY_MODE = 'moderate'; });
  afterAll(() => { if (savedMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE; else process.env.WEBHOOK_SECURITY_MODE = savedMode; });
  afterEach(async () => { await fake?.close(); });

  /** A context pointing at the fake server; url + token makes it authoritative, no env involved. */
  function contextFor(url: string) {
    return { n8nApiUrl: new URL(url).origin, n8nMcpAccessToken: 'mcp-token-placeholder' };
  }

  it('reports configured:false with a setup hint when there is no config', async () => {
    const health = await buildOfficialMcpHealth(undefined, false);
    expect(health).toEqual({ configured: false, hint: expect.stringContaining('N8N_MCP_ACCESS_TOKEN') });
  });

  // Same hint logic as notConfiguredResponse: an embedder's own hint wins,
  // with angle brackets removed (text only) and capped.
  it('prefers the embedder setup hint when there is no config', async () => {
    const health = await buildOfficialMcpHealth(
      { metadata: { officialMcpSetupHint: '<b>Open</b> the setup page ' + 'x'.repeat(600) } },
      false,
    );
    expect(health.configured).toBe(false);
    expect(health.hint).toContain('Open');
    expect(health.hint).toContain('the setup page');
    expect(health.hint).not.toMatch(/[<>]/);
    expect(health.hint!.length).toBeLessThanOrEqual(500);
  });

  it('reports the endpoint alone when configured but never probed and live is false', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const health = await buildOfficialMcpHealth(contextFor(fake.url), false);
    expect(health).toEqual({ configured: true, endpoint: fake.url });
    expect(health).not.toHaveProperty('reachable');
    expect(fake.requests).toHaveLength(0);   // status mode never touches the network
  });

  it('probes live and reports reachability, tool count and the check time', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }, { name: 'search_workflows' }] });
    const health = await buildOfficialMcpHealth(contextFor(fake.url), true);
    expect(health).toMatchObject({ configured: true, endpoint: fake.url, reachable: true, toolCount: 2, agentTools: true });
    expect(new Date(health.checkedAt!).toISOString()).toBe(health.checkedAt);
    expect(health).not.toHaveProperty('error');
  });

  it('reports the error code and hint when a live probe is rejected', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }], raw: { status: 401, body: '{}', contentType: 'application/json' } });
    const health = await buildOfficialMcpHealth(contextFor(fake.url), true);
    expect(health).toMatchObject({
      configured: true,
      endpoint: fake.url,
      reachable: false,
      toolCount: 0,
      agentTools: false,
      error: 'OFFICIAL_MCP_AUTH_FAILED',
      hint: expect.stringContaining('N8N_MCP_ACCESS_TOKEN'),
    });
  });

  it('serves the cached probe result once one exists, without a second request', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const context = contextFor(fake.url);
    await buildOfficialMcpHealth(context, true);
    const afterProbe = fake.requests.length;
    const health = await buildOfficialMcpHealth(context, false);
    expect(health).toMatchObject({ reachable: true, toolCount: 1 });
    expect(fake.requests.length).toBe(afterProbe);
  });
});
