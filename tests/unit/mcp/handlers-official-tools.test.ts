import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
const access = vi.hoisted(() => ({ getOfficialMcpClient: vi.fn() }));
vi.mock('@/mcp/official-mcp-access', async (orig) => ({ ...(await orig<any>()), getOfficialMcpClient: access.getOfficialMcpClient }));
const api = vi.hoisted(() => ({ getN8nApiClient: vi.fn() }));
vi.mock('@/mcp/handlers-n8n-manager', () => ({ getN8nApiClient: api.getN8nApiClient }));
import { handleExploreNodeResources, handleListCatalog } from '@/mcp/handlers-official-tools';
import { N8nApiError } from '@/utils/n8n-errors';

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
  it('forwards the validated args and returns data verbatim', async () => {
    const client = fakeClient(['explore_node_resources']); access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleExploreNodeResources({ ...VALID, filter: 'gen', timeoutMs: 60000 });
    expect(client.callTool).toHaveBeenCalledWith('explore_node_resources', { ...VALID, filter: 'gen' }, { timeoutMs: 60000 });
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
  it('lists projects from the Public API and marks the personal one', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Personal', type: 'personal' }, { id: 'p2', name: 'Team A', type: 'team' }]) });
    const r = await handleListCatalog({ kind: 'projects', query: 'team' });
    expect(r).toMatchObject({ success: true, kind: 'projects', backend: 'public-api', data: { teamProjectsEnabled: true, items: [{ id: 'p2', name: 'Team A' }] } });
  });
  it('falls back to official search_projects on 403 when configured', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)) });
    // Real search_projects output schema (docs/local/official-agent-tools-2026-08-27/all-official-tools-2026-08-27.json) uses `data`, not `projects`.
    const client = fakeClient(['search_projects'], { ok: true, data: [{ id: 'p1', name: 'Personal', type: 'personal' }] });
    access.getOfficialMcpClient.mockReturnValue(client);
    const r = await handleListCatalog({ kind: 'projects' });
    expect(client.callTool).toHaveBeenCalledWith('search_projects', {}, { timeoutMs: 30000 });
    expect(r).toMatchObject({ success: true, backend: 'official-mcp', data: { items: [{ id: 'p1', personal: true }] } });
  });
  it('returns the personal project only when the fallback is not configured', async () => {
    api.getN8nApiClient.mockReturnValue({ listProjects: vi.fn().mockRejectedValue(new N8nApiError('Forbidden', 403)), resolvePersonalProjectId: vi.fn().mockResolvedValue('p1') });
    access.getOfficialMcpClient.mockReturnValue(null);
    expect(await handleListCatalog({ kind: 'projects' })).toMatchObject({ success: true, backend: 'public-api', data: { teamProjectsEnabled: false, items: [{ id: 'p1', personal: true }] } });
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
