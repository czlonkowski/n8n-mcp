import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
const access = vi.hoisted(() => ({ getOfficialMcpClient: vi.fn(), notConfiguredResponse: vi.fn(), officialFailure: vi.fn() }));
vi.mock('@/mcp/official-mcp-access', async (orig) => ({ ...(await orig<any>()), getOfficialMcpClient: access.getOfficialMcpClient }));
const api = vi.hoisted(() => ({ getN8nApiClient: vi.fn() }));
vi.mock('@/mcp/handlers-n8n-manager', () => ({ getN8nApiClient: api.getN8nApiClient }));
import { handleManageAgents } from '@/mcp/handlers-agents';
import { AGENT_ACTION_MAP, resolveOfficialTool } from '@/mcp/agents-action-map';

function fakeClient(tools: string[], results: Record<string, any> = {}) {
  return {
    capabilities: vi.fn().mockResolvedValue({ reachable: true, toolCount: tools.length, toolNames: tools, agentTools: true, checkedAt: Date.now() }),
    hasTool: vi.fn(async (n: string) => tools.includes(n)),
    callTool: vi.fn(async (name: string) => { const r = results[name] ?? { ok: true }; return { isError: r.ok === false, text: JSON.stringify(r), json: r, sizeBytes: 10, truncated: false }; }),
    reference: vi.fn().mockResolvedValue({ ok: true, guide: '# guide' }),
  };
}
const ALL = Object.values(AGENT_ACTION_MAP).flatMap(s => s.tools);

beforeEach(() => { vi.clearAllMocks(); api.getN8nApiClient.mockReturnValue(null); });

describe('handleManageAgents', () => {
  it('returns NOT_CONFIGURED without a client and without calling anything', async () => {
    access.getOfficialMcpClient.mockReturnValue(null);
    const r = await handleManageAgents({ action: 'search', args: {} });
    expect(r).toMatchObject({ success: false, code: 'NOT_CONFIGURED', action: 'search' });
  });
  it('rejects unknown actions and bad timeoutMs before any network call', async () => {
    const client = fakeClient(ALL); access.getOfficialMcpClient.mockReturnValue(client);
    expect(await handleManageAgents({ action: 'fly' })).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(await handleManageAgents({ action: 'get', args: { agentId: 'a' }, timeoutMs: 10 })).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(client.callTool).not.toHaveBeenCalled();
  });
  it('forwards args verbatim to the mapped tool with the default timeout', async () => {
    const client = fakeClient(ALL, { get_agent: { ok: true, agent: { id: 'a1' } } }); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'get', args: { agentId: 'a1', versionId: 'v9' } });
    expect(client.callTool).toHaveBeenCalledWith('get_agent', { agentId: 'a1', versionId: 'v9' }, { timeoutMs: 30_000 });
    expect(r).toMatchObject({ success: true, action: 'get', officialTool: 'get_agent', data: { ok: true, agent: { id: 'a1' } } });
  });
  it('uses 180 s for call and honours an explicit timeoutMs', async () => {
    const client = fakeClient(ALL); access.getOfficialMcpClient.mockReturnValue(client);
    await handleManageAgents({ action: 'call', args: { agentId: 'a', request: { type: 'message', message: 'hi' } } });
    expect(client.callTool).toHaveBeenLastCalledWith('call_agent', expect.anything(), { timeoutMs: 180_000 });
    await handleManageAgents({ action: 'call', args: { agentId: 'a', request: { type: 'message', message: 'hi' } }, timeoutMs: 240_000 });
    expect(client.callTool).toHaveBeenLastCalledWith('call_agent', expect.anything(), { timeoutMs: 240_000 });
  });
  it('serves reference from the client cache', async () => {
    const client = fakeClient(ALL); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'reference' });
    expect(client.reference).toHaveBeenCalled(); expect(client.callTool).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true, officialTool: 'get_agent_builder_reference', data: { guide: '# guide' } });
  });
  it('maps official error codes', async () => {
    const client = fakeClient(ALL, { mutate_agent: { ok: false, code: 'stale_config', configHash: 'h2' }, validate_agent: { ok: false, code: 'agent_misconfigured' } });
    access.getOfficialMcpClient.mockReturnValue(client);
    const stale = await handleManageAgents({ action: 'mutate', args: { agentId: 'a', baseConfigHash: 'h1', operation: {} } });
    expect(stale).toMatchObject({ success: false, code: 'STALE_CONFIG', officialError: { code: 'stale_config' } });
    expect(stale.hint).toContain('configHash');
    expect(await handleManageAgents({ action: 'validate', args: { agentId: 'a' } })).toMatchObject({ success: false, code: 'AGENT_NOT_RUNNABLE' });
  });
  it('maps input validation text to INVALID_ARGS', async () => {
    const client = fakeClient(ALL); client.callTool.mockResolvedValue({ isError: true, text: 'Input validation error: agentId required', json: undefined, sizeBytes: 5, truncated: false });
    access.getOfficialMcpClient.mockReturnValue(client);
    expect(await handleManageAgents({ action: 'get', args: {} })).toMatchObject({ success: false, code: 'INVALID_ARGS', error: 'Input validation error: agentId required' });
  });
  it('returns OFFICIAL_MCP_TOOL_UNAVAILABLE when no alias is present', async () => {
    const client = fakeClient(['search_workflows']); access.getOfficialMcpClient.mockReturnValue(client);
    expect(await handleManageAgents({ action: 'search', args: {} })).toMatchObject({ success: false, code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE' });
  });
  it('adds the credential-type hint for missing:["credential"] when the credential type is known-unsupported', async () => {
    // Matches docs/local/official-agent-tools-2026-08-27/spike-log-3-azure-incompatible.json:
    // validate_agent answers a "missing credential" outcome with ok:true, valid:false
    // (isError stays false on the wire) — this is a validation *result*, not an official
    // protocol-level error, so the fakeClient's `isError = r.ok === false` stays false here
    // and the handler's success path (with the attached hint) is exercised, not the failure path.
    const client = fakeClient(ALL, { validate_agent: { ok: true, valid: false, errors: [], missing: ['credential'] } });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockResolvedValue({ id: 'c1', name: 'Azure', type: 'azureOpenAiApi' }) });
    const r = await handleManageAgents({ action: 'validate', args: { agentId: 'a', credential: 'c1' } });
    expect(r.success).toBe(true);  // validate returned ok:false but that is a validation *result*, not an official error
    expect(r.hint).toContain('azureOpenAiApi'); expect(r.hint).toContain('openAiApi');
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockRejectedValue(new Error('403')) });
    expect((await handleManageAgents({ action: 'validate', args: { agentId: 'a', credential: 'c1' } })).hint).toBeUndefined();
  });
});

describe('resolveOfficialTool', () => {
  it('returns the first alias present', () => {
    expect(resolveOfficialTool({ tools: ['mutate_agent', 'update_agent'], defaultTimeoutMs: 1, destructive: false }, ['update_agent'])).toBe('update_agent');
    expect(resolveOfficialTool({ tools: ['mutate_agent'], defaultTimeoutMs: 1, destructive: false }, [])).toBeNull();
  });
});
