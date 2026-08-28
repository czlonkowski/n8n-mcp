import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
const access = vi.hoisted(() => ({ getOfficialMcpClient: vi.fn() }));
vi.mock('@/mcp/official-mcp-access', async (orig) => ({ ...(await orig<any>()), getOfficialMcpClient: access.getOfficialMcpClient }));
const api = vi.hoisted(() => ({ getN8nApiClient: vi.fn() }));
vi.mock('@/mcp/handlers-n8n-manager', () => ({ getN8nApiClient: api.getN8nApiClient }));
import { handleExploreNodeResources, handleListCatalog, callOfficialTool, resolveProjectChoices } from '@/mcp/handlers-official-tools';
import { N8nApiError } from '@/utils/n8n-errors';
import { N8nOfficialMcpClient } from '@/services/n8n-official-mcp-client';
import { startFakeOfficialMcp, FakeOfficialMcp, FakeTool } from '../../helpers/fake-official-mcp-server';

function fakeClient(tools: string[], result: any = { ok: true, results: [{ name: '#general', value: 'C1' }] }) {
  return {
    capabilities: vi.fn().mockResolvedValue({ reachable: true, toolCount: tools.length, toolNames: tools, agentTools: false, checkedAt: Date.now() }),
    callTool: vi.fn().mockResolvedValue({ isError: false, text: JSON.stringify(result), json: result, sizeBytes: 10, truncated: false }),
  };
}
const VALID = { nodeType: 'n8n-nodes-base.slack', version: 2.3, methodName: 'getChannels', methodType: 'listSearch', credentialType: 'slackApi', credentialId: 'c1' };
beforeEach(() => vi.clearAllMocks());

describe('handleExploreNodeResources', () => {
  it('NOT_CONFIGURED without a client', async () => {
    access.getOfficialMcpClient.mockReturnValue(null);
    expect(await handleExploreNodeResources(VALID)).toMatchObject({ success: false, code: 'NOT_CONFIGURED' });
  });
  it('validates required fields before calling', async () => {
    const client = fakeClient(['explore_node_resources']); access.getOfficialMcpClient.mockReturnValue(client);
    expect(await handleExploreNodeResources({ ...VALID, methodType: 'magic' })).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(client.callTool).not.toHaveBeenCalled();
  });
  it('rejects an unknown top-level key and names it', async () => {
    const client = fakeClient(['explore_node_resources']); access.getOfficialMcpClient.mockReturnValue(client);
    const r: any = await handleExploreNodeResources({ ...VALID, currentNodeParameter: {} });
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(r.error).toContain('currentNodeParameter');
    expect(client.callTool).not.toHaveBeenCalled();
  });
  it('forwards the validated args and returns data verbatim', async () => {
    const client = fakeClient(['explore_node_resources']); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleExploreNodeResources({ ...VALID, filter: 'gen', timeoutMs: 60000 });
    expect(client.callTool).toHaveBeenCalledWith('explore_node_resources', { ...VALID, filter: 'gen' }, { timeoutMs: 60000, idempotent: true });
    expect(r).toMatchObject({ success: true, officialTool: 'explore_node_resources', data: { results: [{ value: 'C1' }] } });
  });
  it('OFFICIAL_MCP_TOOL_UNAVAILABLE when the instance lacks the tool', async () => {
    access.getOfficialMcpClient.mockReturnValue(fakeClient(['search_workflows']));
    expect(await handleExploreNodeResources(VALID)).toMatchObject({ success: false, code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE' });
  });
  it('maps an "Input validation error" text response to INVALID_ARGS', async () => {
    const text = 'Input validation error: credentialId must be a string';
    const client = {
      capabilities: vi.fn().mockResolvedValue({ reachable: true, toolCount: 1, toolNames: ['explore_node_resources'], agentTools: false, checkedAt: Date.now() }),
      callTool: vi.fn().mockResolvedValue({ isError: false, text, json: undefined, sizeBytes: text.length, truncated: false }),
    };
    access.getOfficialMcpClient.mockReturnValue(client);
    expect(await handleExploreNodeResources(VALID)).toMatchObject({ success: false, code: 'INVALID_ARGS', error: text });
  });
  it('caps a long official error message at 2000 chars and keeps officialError', async () => {
    const longMessage = 'x'.repeat(5000);
    const result = { ok: false, message: longMessage };
    const client = {
      capabilities: vi.fn().mockResolvedValue({ reachable: true, toolCount: 1, toolNames: ['explore_node_resources'], agentTools: false, checkedAt: Date.now() }),
      callTool: vi.fn().mockResolvedValue({ isError: true, text: JSON.stringify(result), json: result, sizeBytes: 10, truncated: false }),
    };
    access.getOfficialMcpClient.mockReturnValue(client);
    const r: any = await handleExploreNodeResources(VALID);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_ERROR' });
    expect(r.error).toHaveLength(2000);
    expect(r.officialError).toEqual(result);
  });
  it('prefers a string error field over a non-string message field', async () => {
    const result = { ok: false, message: { nested: true }, error: 'plain' };
    const client = {
      capabilities: vi.fn().mockResolvedValue({ reachable: true, toolCount: 1, toolNames: ['explore_node_resources'], agentTools: false, checkedAt: Date.now() }),
      callTool: vi.fn().mockResolvedValue({ isError: false, text: JSON.stringify(result), json: result, sizeBytes: 10, truncated: false }),
    };
    access.getOfficialMcpClient.mockReturnValue(client);
    const r: any = await handleExploreNodeResources(VALID);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_ERROR', error: 'plain' });
  });
  it('surfaces truncated:true from a successful truncated result', async () => {
    const result = { ok: true, results: [{ name: '#general', value: 'C1' }] };
    const client = {
      capabilities: vi.fn().mockResolvedValue({ reachable: true, toolCount: 1, toolNames: ['explore_node_resources'], agentTools: false, checkedAt: Date.now() }),
      callTool: vi.fn().mockResolvedValue({ isError: false, text: JSON.stringify(result), json: result, sizeBytes: 10, truncated: true }),
    };
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleExploreNodeResources(VALID);
    expect(r).toMatchObject({ success: true, truncated: true });
  });
});

describe('handleListCatalog', () => {
  it('rejects an unknown top-level key and names it, before touching the API', async () => {
    const listProjects = vi.fn();
    api.getN8nApiClient.mockReturnValue({ listProjects });
    const r: any = await handleListCatalog({ kind: 'projects', limits: 5 });
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(r.error).toContain('limits');
    expect(listProjects).not.toHaveBeenCalled();
  });
  it('lists projects from the Public API and marks the personal one', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Personal', type: 'personal' }, { id: 'p2', name: 'Team A', type: 'team' }]) });
    const r = await handleListCatalog({ kind: 'projects', query: 'team' });
    expect(r).toMatchObject({ success: true, kind: 'projects', backend: 'public-api', data: { teamProjectsEnabled: true, items: [{ id: 'p2', name: 'Team A' }] } });
  });
  it('marks teamProjectsEnabled true from the Public API even when only the personal project is visible (the endpoint itself is the licence gate)', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Personal', type: 'personal' }]) });
    const r = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: true, kind: 'projects', backend: 'public-api', data: { teamProjectsEnabled: true, items: [{ id: 'p1', personal: true }] } });
  });
  it('falls back to official search_projects on 403 when configured', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    // Real search_projects output schema (docs/local/official-agent-tools-2026-08-27/all-official-tools-2026-08-27.json) uses `data`, not `projects`.
    const client = fakeClient(['search_projects'], { ok: true, data: [{ id: 'p1', name: 'Personal', type: 'personal' }] });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleListCatalog({ kind: 'projects' });
    expect(client.callTool).toHaveBeenCalledWith('search_projects', {}, { timeoutMs: 30000, idempotent: true });
    expect(r).toMatchObject({ success: true, backend: 'official-mcp', data: { teamProjectsEnabled: false, items: [{ id: 'p1', personal: true }] } });
  });
  it('uses the official teamProjectsEnabled flag when present, even with only a personal project returned', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    const client = fakeClient(['search_projects'], { ok: true, data: [{ id: 'p1', name: 'Personal', type: 'personal' }], teamProjectsEnabled: true });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: true, backend: 'official-mcp', data: { teamProjectsEnabled: true } });
  });
  it('derives teamProjectsEnabled from the item list when the official flag is absent and a team project is present', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    const client = fakeClient(['search_projects'], { ok: true, data: [{ id: 'p1', name: 'Personal', type: 'personal' }, { id: 'p2', name: 'Team A', type: 'team' }] });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: true, backend: 'official-mcp', data: { teamProjectsEnabled: true } });
  });
  it('derives teamProjectsEnabled false when the official flag is absent and only the personal project is present', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    const client = fakeClient(['search_projects'], { ok: true, data: [{ id: 'p1', name: 'Personal', type: 'personal' }] });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: true, backend: 'official-mcp', data: { teamProjectsEnabled: false } });
  });
  it('keeps kind and backend on an official-mcp fallback failure (unreachable/auth failed)', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    const client = {
      capabilities: vi.fn().mockResolvedValue({ reachable: false, error: 'OFFICIAL_MCP_AUTH_FAILED', toolCount: 0, toolNames: [], agentTools: false, checkedAt: Date.now() }),
      callTool: vi.fn(),
    };
    access.getOfficialMcpClient.mockReturnValue(client);
    const r: any = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: false, kind: 'projects', backend: 'official-mcp', code: 'OFFICIAL_MCP_AUTH_FAILED' });
    expect(client.callTool).not.toHaveBeenCalled();
  });
  it('returns the personal project only when the fallback is not configured', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)), resolvePersonalProjectId: vi.fn().mockResolvedValue('p1') });
    access.getOfficialMcpClient.mockReturnValue(null);
    expect(await handleListCatalog({ kind: 'projects' })).toMatchObject({ success: true, backend: 'public-api', data: { teamProjectsEnabled: false, items: [{ id: 'p1', personal: true }] } });
  });
  it('fails closed with an API_ERROR envelope when resolvePersonalProjectId rejects and the fallback is not configured', async () => {
    api.getN8nApiClient.mockReturnValue({
      listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)),
      resolvePersonalProjectId: vi.fn().mockRejectedValue(new Error('This instance has more projects than one listing page')),
    });
    access.getOfficialMcpClient.mockReturnValue(null);
    const r: any = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: false, kind: 'projects', backend: 'public-api', code: 'API_ERROR', error: 'This instance has more projects than one listing page' });
    expect(r.hint).toBeTruthy();
  });
  it('surfaces a non-403/404 project listing error without falling back', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Server error', 500)) });
    const r = await handleListCatalog({ kind: 'projects' });
    expect(r).toMatchObject({ success: false, kind: 'projects', code: 'API_ERROR' });
  });
  it('lists tags with a case-insensitive filter and limit', async () => {
    api.getN8nApiClient.mockReturnValue({ listTags: vi.fn().mockResolvedValue({ data: [{ id: 't1', name: 'Prod' }, { id: 't2', name: 'staging' }, { id: 't3', name: 'Production' }] }) });
    const r = await handleListCatalog({ kind: 'tags', query: 'prod', limit: 1 });
    expect(r).toMatchObject({ success: true, kind: 'tags', backend: 'public-api', data: { items: [{ id: 't1', name: 'Prod' }] } });
  });
  it('rejects unknown kinds', async () => {
    expect(await handleListCatalog({ kind: 'users' })).toMatchObject({ success: false, code: 'INVALID_ARGS' });
  });
  it('NOT_CONFIGURED without an api client', async () => {
    api.getN8nApiClient.mockReturnValue(null);
    expect(await handleListCatalog({ kind: 'tags' })).toMatchObject({ success: false, code: 'NOT_CONFIGURED' });
  });
});

describe('resolveProjectChoices', () => {
  it('resolves from the Public API', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Personal', type: 'personal' }, { id: 'p2', name: 'Team A', type: 'team' }]) });
    const r: any = await resolveProjectChoices();
    expect(r.choices).toEqual({
      backend: 'public-api',
      teamProjectsEnabled: true,
      items: [{ id: 'p1', name: 'Personal', type: 'personal', personal: true }, { id: 'p2', name: 'Team A', type: 'team', personal: false }],
    });
  });
  it('falls back to the official server on a licence refusal', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    access.getOfficialMcpClient.mockReturnValue(fakeClient(['search_projects'], { ok: true, data: [{ id: 'p1', name: 'Personal', type: 'personal' }, { id: 'p2', name: 'Team A', type: 'team' }] }));
    const r: any = await resolveProjectChoices();
    expect(r.choices).toMatchObject({ backend: 'official-mcp', teamProjectsEnabled: true, items: [{ id: 'p1', personal: true }, { id: 'p2', personal: false }] });
  });
  it('falls back to the personal project when no official client is configured', async () => {
    api.getN8nApiClient.mockReturnValue({
      listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)),
      resolvePersonalProjectId: vi.fn().mockResolvedValue('personal-1'),
    });
    access.getOfficialMcpClient.mockReturnValue(null);
    const r: any = await resolveProjectChoices();
    expect(r.choices).toEqual({
      backend: 'public-api',
      teamProjectsEnabled: false,
      items: [{ id: 'personal-1', name: 'Personal', type: 'personal', personal: true }],
    });
  });
  it('skips the Public API entirely on a url + token context', async () => {
    // getN8nApiClient falls back to the operator's own instance here, so
    // listing projects through it would read — and hand back — the wrong
    // instance's project ids. Resolution goes straight to the official server.
    const listProjects = vi.fn();
    api.getN8nApiClient.mockReturnValue({ listProjects, resolvePersonalProjectId: vi.fn() });
    access.getOfficialMcpClient.mockReturnValue(
      fakeClient(['search_projects'], { ok: true, data: [{ id: 'p9', name: 'Team B', type: 'team' }] })
    );

    const r: any = await resolveProjectChoices({ n8nApiUrl: 'https://other.test.com', n8nMcpAccessToken: 'tok' } as any);

    expect(listProjects).not.toHaveBeenCalled();
    expect(r.choices).toMatchObject({ backend: 'official-mcp', items: [{ id: 'p9', name: 'Team B' }] });
  });

  it('fails closed on a url + token context with no official client', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn(), resolvePersonalProjectId: vi.fn().mockResolvedValue('personal-1') });
    access.getOfficialMcpClient.mockReturnValue(null);

    const r: any = await resolveProjectChoices({ n8nApiUrl: 'https://other.test.com', n8nMcpAccessToken: 'tok' } as any);

    expect(r.failure).toMatchObject({ success: false, code: 'NOT_CONFIGURED', backend: 'official-mcp' });
    expect(r.failure.error).toContain('x-n8n-key');
  });

  it('returns an undecorated failure envelope when nothing can resolve projects', async () => {
    api.getN8nApiClient.mockReturnValue({
      listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)),
      resolvePersonalProjectId: vi.fn().mockRejectedValue(new Error('no personal project')),
    });
    access.getOfficialMcpClient.mockReturnValue(null);
    const r: any = await resolveProjectChoices();
    expect(r.failure).toMatchObject({ success: false, code: 'API_ERROR', backend: 'public-api' });
    expect(r.failure.kind).toBeUndefined();
  });
});

/**
 * These go through the REAL N8nOfficialMcpClient against the fake server, so the
 * envelope mapping is exercised on the wire rather than against a hand-written
 * client double.
 */
describe('callOfficialTool over the wire', () => {
  let savedMode: string | undefined;
  let fake: FakeOfficialMcp | undefined;
  let client: N8nOfficialMcpClient | undefined;

  beforeAll(() => { savedMode = process.env.WEBHOOK_SECURITY_MODE; process.env.WEBHOOK_SECURITY_MODE = 'moderate'; });
  afterAll(() => { if (savedMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE; else process.env.WEBHOOK_SECURITY_MODE = savedMode; });
  afterEach(async () => { await client?.close(); await fake?.close(); client = undefined; fake = undefined; });

  async function connect(tools: FakeTool[]) {
    fake = await startFakeOfficialMcp({ tools });
    client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    access.getOfficialMcpClient.mockReturnValue(client);
  }

  it('maps a root success:false result (no isError) to OFFICIAL_MCP_ERROR', async () => {
    await connect([{ name: 'get_workflow_history', handler: () => ({ success: false, workflowId: 'w', versions: [], count: 0, error: 'boom' }) }]);
    const r: any = await callOfficialTool(undefined, ['get_workflow_history'], { workflowId: 'w' }, 30000, 'workflow_versions', true);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_ERROR', error: 'boom', officialTool: 'get_workflow_history' });
    expect(r.officialError).toMatchObject({ success: false, workflowId: 'w' });
  });

  it('maps an execute_workflow status:error result to OFFICIAL_MCP_ERROR', async () => {
    await connect([{ name: 'execute_workflow', handler: () => ({ executionId: null, status: 'error', error: 'boom' }) }]);
    const r: any = await callOfficialTool(undefined, ['execute_workflow'], { workflowId: 'w' }, 30000, 'test_workflow', false);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_ERROR', error: 'boom' });
  });

  it('maps an execute_workflow status:error result with no error message to OFFICIAL_MCP_ERROR', async () => {
    // `error` is optional in that shape — the status alone decides, or a
    // failed dispatch that carries no message would read as a success.
    await connect([{ name: 'execute_workflow', handler: () => ({ executionId: null, status: 'error' }) }]);
    const r: any = await callOfficialTool(undefined, ['execute_workflow'], { workflowId: 'w' }, 30000, 'test_workflow', false);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_ERROR' });
    expect(r.error).toBe('execute_workflow reported status "error" without an error message');
  });

  // Precedence: tool-level failures are callOfficialTool's; the outcome of a run
  // that started fine belongs to the handler (EXECUTION_FAILED, with executionId).
  it('leaves test_workflow status:error a tool-level success for the handler to judge', async () => {
    await connect([{ name: 'test_workflow', handler: () => ({ executionId: 'e1', status: 'error', error: 'node failed' }) }]);
    const r: any = await callOfficialTool(undefined, ['test_workflow'], { workflowId: 'w' }, 30000, 'test_workflow', false);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ executionId: 'e1', status: 'error', error: 'node failed' });
  });

  it('still maps an oversized root success:false result to OFFICIAL_MCP_ERROR', async () => {
    await connect([{
      name: 'get_workflow_history',
      handler: () => 'text',
      structured: () => ({ success: false, error: 'boom', blob: 'y'.repeat(300 * 1024) }),
    }]);
    const r: any = await callOfficialTool(undefined, ['get_workflow_history'], { workflowId: 'w' }, 30000, 'workflow_versions', true);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_ERROR', error: 'boom' });
  });

  it('keeps a root success:true result a success', async () => {
    await connect([{ name: 'get_workflow_history', handler: () => ({ success: true, workflowId: 'w', versions: [{ id: 1 }], count: 1 }) }]);
    const r: any = await callOfficialTool(undefined, ['get_workflow_history'], { workflowId: 'w' }, 30000, 'workflow_versions', true);
    expect(r).toMatchObject({ success: true, data: { success: true, count: 1 } });
  });

  it('names the minimum n8n version when the instance lacks the tool', async () => {
    await connect([{ name: 'get_workflow_history' }]);
    const r: any = await callOfficialTool(undefined, ['get_workflow_versions_diff'], {}, 30000, 'workflow_versions', true);
    expect(r).toMatchObject({ success: false, code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE' });
    expect(r.error).toContain('n8n >= 2.36');
  });

  it('falls back to the default minimum version for an unmapped tool', async () => {
    await connect([{ name: 'get_workflow_history' }]);
    const r: any = await callOfficialTool(undefined, ['some_future_tool'], {}, 30000, 'future', true);
    expect(r.error).toContain('n8n >= 2.34');
  });
});
