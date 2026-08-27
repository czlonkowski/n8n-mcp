import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { startFakeOfficialMcp, FakeOfficialMcp } from '../../helpers/fake-official-mcp-server';
import { N8nOfficialMcpClient } from '@/services/n8n-official-mcp-client';

let savedMode: string | undefined;
beforeAll(() => { savedMode = process.env.WEBHOOK_SECURITY_MODE; process.env.WEBHOOK_SECURITY_MODE = 'moderate'; });
afterAll(() => { if (savedMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE; else process.env.WEBHOOK_SECURITY_MODE = savedMode; });

describe('N8nOfficialMcpClient', () => {
  let fake: FakeOfficialMcp;
  afterEach(async () => { await fake?.close(); });

  it('lists tools from the fake server with the bearer token', async () => {
    fake = await startFakeOfficialMcp({ token: 'tok', tools: [{ name: 'search_agents' }, { name: 'get_agent' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const caps = await client.capabilities();
    expect(caps.reachable).toBe(true);
    expect(caps.toolNames).toEqual(['search_agents', 'get_agent']);
    expect(caps.agentTools).toBe(true);
    expect(fake.requests.every(r => r.authorization === 'Bearer tok')).toBe(true);
    await client.close();
  });

  it('calls a tool and parses JSON text', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'get_agent', handler: (a) => ({ ok: true, agent: { id: a.agentId } }) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('get_agent', { agentId: 'a1' });
    expect(result.isError).toBe(false);
    expect(result.json).toEqual({ ok: true, agent: { id: 'a1' } });
    expect(result.truncated).toBe(false);
    await client.close();
  });

  it('keeps non-JSON text as text', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'echo', handler: () => 'plain words' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('echo', {});
    expect(result.text).toBe('plain words'); expect(result.json).toBeUndefined();
    await client.close();
  });

  it('marks isError results without throwing', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'mutate_agent', isError: true, handler: () => ({ ok: false, code: 'stale_config' }) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('mutate_agent', {});
    expect(result.isError).toBe(true); expect(result.json).toEqual({ ok: false, code: 'stale_config' });
    await client.close();
  });

  it('truncates oversized results', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'big', handler: () => 'x'.repeat(300 * 1024) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('big', {});
    expect(result.truncated).toBe(true); expect(result.text.length).toBeLessThanOrEqual(256 * 1024 + 64); expect(result.sizeBytes).toBe(300 * 1024);
    await client.close();
  });

  it('maps 401 to OFFICIAL_MCP_AUTH_FAILED', async () => {
    fake = await startFakeOfficialMcp({ token: 'right', tools: [{ name: 'search_agents' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'wrong' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code: 'OFFICIAL_MCP_AUTH_FAILED', status: 401 });
    const caps = await client.capabilities(true);
    expect(caps).toMatchObject({ reachable: false, error: 'OFFICIAL_MCP_AUTH_FAILED' });
    await client.close();
  });

  it.each([
    [{ status: 404, body: 'Not found', contentType: 'text/plain' }, 'OFFICIAL_MCP_NOT_ENABLED'],
    [{ status: 200, body: '<html>n8n</html>', contentType: 'text/html' }, 'OFFICIAL_MCP_NOT_ENABLED'],
    [{ status: 429, body: 'Too many requests', contentType: 'text/plain' }, 'OFFICIAL_MCP_RATE_LIMITED'],
    [{ status: 500, body: 'boom', contentType: 'text/plain' }, 'OFFICIAL_MCP_TRANSPORT_ERROR'],
  ])('maps raw response %j to %s', async (raw, code) => {
    fake = await startFakeOfficialMcp({ raw });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code });
    await client.close();
  });

  it('maps a request timeout to OFFICIAL_MCP_TIMEOUT', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'call_agent', handler: () => new Promise(r => setTimeout(() => r({ ok: true }), 400)) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await expect(client.callTool('call_agent', {}, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'OFFICIAL_MCP_TIMEOUT' });
    await client.close();
  });

  it('rejects a private endpoint before any request (strict mode)', async () => {
    process.env.WEBHOOK_SECURITY_MODE = 'strict';
    try {
      const client = new N8nOfficialMcpClient({ endpoint: 'http://10.0.0.8/mcp-server/http', token: 'tok' });
      await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code: 'OFFICIAL_MCP_URL_REJECTED' });
      await client.close();
    } finally { process.env.WEBHOOK_SECURITY_MODE = 'moderate'; }
  });

  it('caches capabilities and reference for the TTL', async () => {
    let listCalls = 0;
    fake = await startFakeOfficialMcp({ tools: [{ name: 'get_agent_builder_reference', handler: () => { listCalls++; return { ok: true, guide: '# guide', configSchema: {} }; } }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await client.capabilities(); await client.capabilities();
    const before = fake.requests.length;
    await client.capabilities();
    expect(fake.requests.length).toBe(before);           // served from cache
    await client.reference(); await client.reference();
    expect(listCalls).toBe(1);
    await client.close();
  });

  it('reconnects once after the transport drops', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await client.callTool('search_agents', {});
    fake.setRaw({ status: 503, body: 'restarting', contentType: 'text/plain' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code: 'OFFICIAL_MCP_TRANSPORT_ERROR' });
    fake.setRaw(undefined);
    const result = await client.callTool('search_agents', {});   // fresh transport, no stale state
    expect(result.isError).toBe(false);
    await client.close();
  });
});
