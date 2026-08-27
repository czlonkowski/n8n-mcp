import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));
const access = vi.hoisted(() => ({ getOfficialMcpClient: vi.fn() }));
vi.mock('@/mcp/official-mcp-access', async (orig) => ({ ...(await orig<any>()), getOfficialMcpClient: access.getOfficialMcpClient }));
const api = vi.hoisted(() => ({ getN8nApiClient: vi.fn() }));
vi.mock('@/mcp/handlers-n8n-manager', () => ({ getN8nApiClient: api.getN8nApiClient }));
import { handleExploreNodeResources } from '@/mcp/handlers-official-tools';

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
});
