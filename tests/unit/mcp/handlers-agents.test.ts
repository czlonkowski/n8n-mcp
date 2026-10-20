import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
const access = vi.hoisted(() => ({ getOfficialMcpClient: vi.fn(), notConfiguredResponse: vi.fn(), officialFailure: vi.fn() }));
vi.mock('@/mcp/official-mcp-access', async (orig) => ({ ...(await orig<any>()), getOfficialMcpClient: access.getOfficialMcpClient }));
const api = vi.hoisted(() => ({ getN8nApiClient: vi.fn() }));
vi.mock('@/mcp/handlers-n8n-manager', () => ({ getN8nApiClient: api.getN8nApiClient }));
import { handleManageAgents } from '@/mcp/handlers-agents';
import { AGENT_ACTION_MAP, resolveOfficialTool } from '@/mcp/agents-action-map';
import { OfficialMcpError } from '@/services/n8n-official-mcp-client';

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
  it('rejects an unknown top-level key and names it', async () => {
    const client = fakeClient(ALL); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'get', arg: { agentId: 'a' } });
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', action: 'get' });
    expect(r.error).toContain('arg');
    expect(client.callTool).not.toHaveBeenCalled();
  });
  it('forwards args verbatim to the mapped tool with the default timeout', async () => {
    const client = fakeClient(ALL, { get_agent: { ok: true, agent: { id: 'a1' } } }); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'get', args: { agentId: 'a1', versionId: 'v9' } });
    expect(client.callTool).toHaveBeenCalledWith('get_agent', { agentId: 'a1', versionId: 'v9' }, { timeoutMs: 30_000, idempotent: true });
    expect(r).toMatchObject({ success: true, action: 'get', officialTool: 'get_agent', data: { ok: true, agent: { id: 'a1' } } });
  });
  it('uses 180 s for call and honours an explicit timeoutMs', async () => {
    const client = fakeClient(ALL); access.getOfficialMcpClient.mockReturnValue(client);
    await handleManageAgents({ action: 'call', args: { agentId: 'a', request: { type: 'message', message: 'hi' } } });
    expect(client.callTool).toHaveBeenLastCalledWith('call_agent', expect.anything(), { timeoutMs: 180_000, idempotent: false });
    await handleManageAgents({ action: 'call', args: { agentId: 'a', request: { type: 'message', message: 'hi' } }, timeoutMs: 240_000 });
    expect(client.callTool).toHaveBeenLastCalledWith('call_agent', expect.anything(), { timeoutMs: 240_000, idempotent: false });
  });
  it('serves reference from the client cache', async () => {
    const client = fakeClient(ALL); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'reference' });
    expect(client.reference).toHaveBeenCalled(); expect(client.callTool).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true, officialTool: 'get_agent_builder_reference', data: { guide: '# guide' } });
  });
  // reference used to skip capability resolution entirely, so an instance
  // without the agents module answered with a transport error instead of the
  // same OFFICIAL_MCP_TOOL_UNAVAILABLE every other action gives.
  it('resolves reference against the instance tool list like every other action', async () => {
    const client = fakeClient(['search_workflows']); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'reference' });
    expect(r).toMatchObject({ success: false, action: 'reference', code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE' });
    expect(client.reference).not.toHaveBeenCalled();
  });
  it('surfaces a failed reference as a failure envelope', async () => {
    const client = fakeClient(ALL);
    client.reference.mockRejectedValue(new OfficialMcpError('OFFICIAL_MCP_TOOL_UNAVAILABLE', 'n8n did not return the agent builder reference'));
    access.getOfficialMcpClient.mockReturnValue(client);
    expect(await handleManageAgents({ action: 'reference' })).toMatchObject({ success: false, action: 'reference', code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE' });
  });
  it('maps agent_tool_error to AGENT_TOOL_ERROR with a hint covering both causes', async () => {
    const client = fakeClient(ALL, { mutate_agent: { ok: false, code: 'agent_tool_error', message: 'tool failed' } });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'mutate', args: { agentId: 'a', baseConfigHash: 'h', operation: {} } });
    expect(r).toMatchObject({ success: false, code: 'AGENT_TOOL_ERROR' });
    expect(r.hint).toContain('officialError.error');
    expect(r.hint).toContain('unknown agentId');
  });
  it('never reaches for the environment n8n API to build a credential hint for a token-only context', async () => {
    const client = fakeClient(ALL, {
      validate_agent: { ok: true, valid: false, errors: [], missing: ['credential'] },
      get_agent: { ok: true, agent: { id: 'a' }, config: { credential: 'c1' } },
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockResolvedValue({ id: 'c1', name: 'Azure', type: 'azureOpenAiApi' }) });
    const r = await handleManageAgents({ action: 'validate', args: { agentId: 'a' } }, { n8nApiUrl: 'https://tenant.example.com', n8nMcpAccessToken: 'ctx-token-placeholder' });
    expect(r.success).toBe(true);
    expect(r.hint).toBeUndefined();
    expect(api.getN8nApiClient).not.toHaveBeenCalled();
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
  it('adds the credential-type hint for missing:["credential"] by looking up get_agent, not args.credential', async () => {
    // Matches docs/local/official-agent-tools-2026-08-27/spike-log-3-azure-incompatible.json:
    // validate_agent answers a "missing credential" outcome with ok:true, valid:false
    // (isError stays false on the wire) — a validation *result*, not an official
    // protocol-level error — so the success path (with the attached hint) is exercised.
    // validate_agent's own schema is {agentId} with additionalProperties:false, so the
    // credential id can only come from the official result: here that means one
    // best-effort get_agent lookup keyed on args.agentId, reading config.credential
    // (a sibling of config.model, not nested under it).
    const client = fakeClient(ALL, {
      validate_agent: { ok: true, valid: false, errors: [], missing: ['credential'] },
      get_agent: { ok: true, agent: { id: 'a' }, config: { model: 'azure-openai/gpt-5.4-mini', credential: 'c1' } },
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockResolvedValue({ id: 'c1', name: 'Azure', type: 'azureOpenAiApi' }) });
    const r = await handleManageAgents({ action: 'validate', args: { agentId: 'a' } });
    expect(r.success).toBe(true);
    expect(client.callTool).toHaveBeenCalledWith('get_agent', { agentId: 'a' }, { timeoutMs: 30_000, idempotent: true });
    expect(r.hint).toContain('azureOpenAiApi'); expect(r.hint).toContain('openAiApi');
  });
  it('treats the Azure Entra credential as unsupported and lists the providers added in n8n 2.40', async () => {
    const client = fakeClient(ALL, {
      validate_agent: { ok: true, valid: false, errors: [], missing: ['credential'] },
      get_agent: { ok: true, agent: { id: 'a' }, config: { model: 'azure-openai/gpt-5.4-mini', credential: 'c1' } },
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockResolvedValue({ id: 'c1', name: 'Azure Entra', type: 'azureEntraCognitiveServicesOAuth2Api' }) });
    const r = await handleManageAgents({ action: 'validate', args: { agentId: 'a' } });
    expect(r.hint).toContain('is type azureEntraCognitiveServicesOAuth2Api');
    const supported = r.hint!.split('one of these types: ')[1];
    expect(supported).toContain('moonshotApi'); expect(supported).toContain('alibabaCloudApi'); expect(supported).toContain('minimaxApi');
    expect(supported).not.toContain('azureEntraCognitiveServicesOAuth2Api');
  });
  it('attaches the credential-type hint on the failure branch too (call_agent reports it as an error)', async () => {
    // call_agent reports the same missing-credential condition as an official error
    // (isError:true, code:agent_misconfigured), per spike-log-3. The hint must still
    // attach, replacing the generic AGENT_NOT_RUNNABLE hint.
    const client = fakeClient(ALL, {
      call_agent: { ok: false, status: 'error', code: 'agent_misconfigured', message: "This agent isn't ready to run yet. Finish configuring it and try again.", missing: ['credential'] },
      get_agent: { ok: true, agent: { id: 'a' }, config: { credential: 'c1' } },
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockResolvedValue({ id: 'c1', name: 'Azure', type: 'azureOpenAiApi' }) });
    const r = await handleManageAgents({ action: 'call', args: { agentId: 'a', request: { type: 'message', message: 'ping' } } });
    expect(r).toMatchObject({ success: false, code: 'AGENT_NOT_RUNNABLE' });
    expect(r.hint).toContain('azureOpenAiApi');
  });
  it('uses config.credential directly when the acted-on result already carries it, without an extra get_agent call', async () => {
    const client = fakeClient(ALL, {
      get_agent: { ok: true, agent: { id: 'a' }, config: { model: 'azure-openai/gpt-5.4-mini', credential: 'c1' }, missing: ['credential'] },
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockResolvedValue({ id: 'c1', name: 'Azure', type: 'azureOpenAiApi' }) });
    const r = await handleManageAgents({ action: 'get', args: { agentId: 'a' } });
    expect(r.success).toBe(true);
    expect(r.hint).toContain('azureOpenAiApi');
    expect(client.callTool).toHaveBeenCalledTimes(1); // only the 'get' action's own call — no extra get_agent lookup
  });
  it('attaches no hint when the credential lookup itself fails', async () => {
    const client = fakeClient(ALL, {
      validate_agent: { ok: true, valid: false, errors: [], missing: ['credential'] },
      get_agent: { ok: true, agent: { id: 'a' }, config: { credential: 'c1' } },
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    api.getN8nApiClient.mockReturnValue({ getCredential: vi.fn().mockRejectedValue(new Error('403')) });
    const r = await handleManageAgents({ action: 'validate', args: { agentId: 'a' } });
    expect(r.success).toBe(true);
    expect(r.hint).toBeUndefined();
  });
  it('caps error text at 2000 chars and only trusts message/error when they are strings', async () => {
    const client = fakeClient(ALL);
    access.getOfficialMcpClient.mockReturnValue(client);
    client.callTool.mockResolvedValueOnce({ isError: true, text: '', json: { ok: false, code: 'weird', message: 'x'.repeat(5000) }, sizeBytes: 5000, truncated: false });
    const long = await handleManageAgents({ action: 'get', args: { agentId: 'a' } });
    expect(long.error?.length).toBe(2000);

    client.callTool.mockResolvedValueOnce({ isError: true, text: '', json: { ok: false, code: 'weird', message: { nested: true }, error: 'plain error text' }, sizeBytes: 10, truncated: false });
    const objectMessage = await handleManageAgents({ action: 'get', args: { agentId: 'a' } });
    expect(objectMessage.error).toBe('plain error text');
  });
});

describe('resolveOfficialTool', () => {
  it('returns the first alias present', () => {
    expect(resolveOfficialTool({ tools: ['mutate_agent', 'update_agent'], defaultTimeoutMs: 1, destructive: false, idempotent: false }, ['update_agent'])).toBe('update_agent');
    expect(resolveOfficialTool({ tools: ['mutate_agent'], defaultTimeoutMs: 1, destructive: false, idempotent: false }, [])).toBeNull();
  });
});

describe('handleManageAgents projectId default', () => {
  const PERSONAL = { ok: true, data: [{ id: 'pp1', name: 'Me <me@example.com>', type: 'personal' }], count: 1, teamProjectsEnabled: false };
  const TOOLS = [...ALL, 'search_projects'];

  it('fills an omitted projectId with the token user\'s personal project', async () => {
    const client = fakeClient(TOOLS, { search_projects: PERSONAL, discover_agent_assets: { ok: true, models: [] } });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'discover_assets', args: { kind: 'models', provider: 'minimax' } });
    expect(client.callTool).toHaveBeenCalledWith('search_projects', { type: 'personal', limit: 2 }, { timeoutMs: 30_000, idempotent: true });
    expect(client.callTool).toHaveBeenLastCalledWith('discover_agent_assets', { kind: 'models', provider: 'minimax', projectId: 'pp1' }, { timeoutMs: 30_000, idempotent: true });
    expect(r).toMatchObject({ success: true, action: 'discover_assets', defaultedProjectId: 'pp1' });
  });

  it('resolves the "personal" alias on create and verify_mcp_server', async () => {
    const client = fakeClient(TOOLS, { search_projects: PERSONAL });
    access.getOfficialMcpClient.mockReturnValue(client);
    await handleManageAgents({ action: 'create', args: { projectId: 'personal', name: 'x' } });
    expect(client.callTool).toHaveBeenLastCalledWith('create_agent', { projectId: 'pp1', name: 'x' }, { timeoutMs: 30_000, idempotent: false });
    await handleManageAgents({ action: 'verify_mcp_server', args: { name: 'm', url: 'https://mcp.example.com' } });
    expect(client.callTool).toHaveBeenLastCalledWith('verify_agent_mcp_server', { name: 'm', url: 'https://mcp.example.com', projectId: 'pp1' }, expect.anything());
  });

  it('keeps an explicit projectId and never defaults search\'s optional filter', async () => {
    const client = fakeClient(TOOLS, { search_projects: PERSONAL });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'create', args: { projectId: 'team1', name: 'x' } });
    await handleManageAgents({ action: 'search', args: {} });
    expect(client.callTool).not.toHaveBeenCalledWith('search_projects', expect.anything(), expect.anything());
    expect(client.callTool).toHaveBeenCalledWith('create_agent', { projectId: 'team1', name: 'x' }, expect.anything());
    expect(client.callTool).toHaveBeenLastCalledWith('search_agents', {}, expect.anything());
    expect(r.defaultedProjectId).toBeUndefined();
  });

  it.each([
    ['two personal projects', { ok: true, data: [{ id: 'a', type: 'personal' }, { id: 'b', type: 'personal' }] }],
    ['no personal project', { ok: true, data: [] }],
  ])('forwards the call unchanged and adds a hint when %s come back', async (_label, projects) => {
    const client = fakeClient(TOOLS, { search_projects: projects });
    client.callTool.mockImplementation(async (name: string) => name === 'search_projects'
      ? { isError: false, text: JSON.stringify(projects), json: projects, sizeBytes: 10, truncated: false }
      : { isError: true, text: 'Input validation error: Invalid arguments for tool discover_agent_assets: projectId: Required', json: undefined, sizeBytes: 10, truncated: false });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'discover_assets', args: { kind: 'models' } });
    expect(client.callTool).toHaveBeenLastCalledWith('discover_agent_assets', { kind: 'models' }, expect.anything());
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(r.hint).toContain("n8n_list_catalog({kind: 'projects'})");
    expect(r.defaultedProjectId).toBeUndefined();
  });

  it('does not look for the personal project when the instance has no search_projects tool', async () => {
    const client = fakeClient(ALL);
    access.getOfficialMcpClient.mockReturnValue(client);
    await handleManageAgents({ action: 'discover_assets', args: { kind: 'models' } });
    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(client.callTool).toHaveBeenCalledWith('discover_agent_assets', { kind: 'models' }, expect.anything());
  });

  it('treats null and "" as omitted, and drops them when the lookup fails', async () => {
    const client = fakeClient(TOOLS, { search_projects: PERSONAL });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'create', args: { projectId: null, name: 'x' } });
    expect(client.callTool).toHaveBeenLastCalledWith('create_agent', { projectId: 'pp1', name: 'x' }, expect.anything());
    expect(r.defaultedProjectId).toBe('pp1');

    const noLookup = fakeClient(ALL);
    access.getOfficialMcpClient.mockReturnValue(noLookup);
    await handleManageAgents({ action: 'create', args: { projectId: '', name: 'x' } });
    expect(noLookup.callTool).toHaveBeenLastCalledWith('create_agent', { name: 'x' }, expect.anything());
  });

  it('refuses an unresolved "personal" alias instead of sending it to n8n as a project ID', async () => {
    const client = fakeClient(ALL);
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'create', args: { projectId: 'personal', name: 'x' } });
    expect(r).toMatchObject({ success: false, action: 'create', code: 'INVALID_ARGS' });
    expect(r.hint).toContain('n8n_list_catalog');
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it.each([
    ['an error result', { ok: false, code: 'forbidden' }],
    ['a count above one on a truncated page', { ok: true, data: [{ id: 'a', type: 'personal' }], count: 3 }],
  ])('does not default from %s', async (_label, projects) => {
    const client = fakeClient(TOOLS, { search_projects: projects });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'create', args: { name: 'x' } });
    expect(client.callTool).toHaveBeenLastCalledWith('create_agent', { name: 'x' }, expect.anything());
    expect(r.defaultedProjectId).toBeUndefined();
  });

  it('picks the personal entry and ignores team projects in the answer', async () => {
    const client = fakeClient(TOOLS, { search_projects: { ok: true, data: [{ id: 't1', type: 'team' }, { id: 'pp1', type: 'personal' }] } });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'create', args: { name: 'x' } });
    expect(r.defaultedProjectId).toBe('pp1');
  });

  it('reports defaultedProjectId when n8n rejects another argument, and caps the lookup at the caller timeout', async () => {
    const client = fakeClient(TOOLS);
    client.callTool.mockImplementation(async (name: string) => name === 'search_projects'
      ? { isError: false, text: JSON.stringify(PERSONAL), json: PERSONAL, sizeBytes: 10, truncated: false }
      : { isError: true, text: 'Input validation error: kind: Required', json: undefined, sizeBytes: 10, truncated: false });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'discover_assets', args: {}, timeoutMs: 5_000 });
    expect(client.callTool).toHaveBeenCalledWith('search_projects', expect.anything(), { timeoutMs: 5_000, idempotent: true });
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', defaultedProjectId: 'pp1' });
    expect(r.hint).toBeUndefined();
  });

  it('keeps defaultedProjectId when the action call itself throws after the lookup', async () => {
    const client = fakeClient(TOOLS);
    client.callTool.mockImplementation(async (name: string) => {
      if (name === 'search_projects') return { isError: false, text: JSON.stringify(PERSONAL), json: PERSONAL, sizeBytes: 10, truncated: false };
      throw new OfficialMcpError('OFFICIAL_MCP_TIMEOUT', 'timed out');
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'discover_assets', args: { kind: 'models' } });
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_TIMEOUT', defaultedProjectId: 'pp1' });
  });

  it('forwards unchanged when the personal-project lookup throws', async () => {
    const client = fakeClient(TOOLS);
    client.callTool.mockImplementation(async (name: string) => {
      if (name === 'search_projects') throw new OfficialMcpError('OFFICIAL_MCP_TIMEOUT', 'timed out');
      return { isError: false, text: '{"ok":true}', json: { ok: true }, sizeBytes: 10, truncated: false };
    });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleManageAgents({ action: 'create', args: { name: 'x' } });
    expect(client.callTool).toHaveBeenLastCalledWith('create_agent', { name: 'x' }, expect.anything());
    expect(r).toMatchObject({ success: true });
    expect(r.defaultedProjectId).toBeUndefined();
  });
});
