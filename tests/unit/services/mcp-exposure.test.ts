import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import * as dns from 'dns/promises';
import {
  NOT_EXPOSED_PREFIX,
  WORKFLOW_NOT_EXPOSED_HINT,
  PUBLIC_API_CONTEXT_HINT,
  isNotExposedResponse,
  enableWorkflowMcpExposure,
  withMcpExposure,
  publicApiMatchesContext,
} from '@/services/mcp-exposure';
import { N8nApiClient } from '@/services/n8n-api-client';
import { clearVersionCache } from '@/services/n8n-version';
import { resetToolPolicyCache } from '@/mcp/tool-policy';
import { McpToolResponse } from '@/types/n8n-api';

vi.mock('dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('axios');
vi.mock('@/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));

// n8n 2.36.7's refusal, verbatim.
const REFUSAL = 'Workflow is not available in MCP. Enable MCP access from the workflow card in the workflows list, or from the workflow settings.';

const refused: McpToolResponse = { success: false, action: 'x', code: 'OFFICIAL_MCP_ERROR', error: REFUSAL, officialError: { error: REFUSAL } };
const ok: McpToolResponse = { success: true, action: 'x', backend: 'official-mcp', data: { fine: true } };

beforeEach(() => {
  delete process.env.DISABLED_TOOLS;
  delete process.env.DISABLED_TOOL_OPERATIONS;
  resetToolPolicyCache();
});

afterEach(() => {
  delete process.env.DISABLED_TOOLS;
  delete process.env.DISABLED_TOOL_OPERATIONS;
  resetToolPolicyCache();
});

describe('isNotExposedResponse', () => {
  it('matches every refusal shape n8n uses, on failure envelopes', () => {
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: REFUSAL, officialError: REFUSAL })).toBe(true);
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: REFUSAL, officialError: { error: REFUSAL } })).toBe(true);
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: REFUSAL, officialError: { success: false, workflowId: 'w', versions: [], count: 0, error: REFUSAL } })).toBe(true);
  });

  it('matches the prefix on response.error alone', () => {
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: REFUSAL })).toBe(true);
  });

  it('tolerates leading whitespace before the prefix', () => {
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: `\n  ${REFUSAL}` })).toBe(true);
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: 'x', officialError: { error: ` ${REFUSAL}` } })).toBe(true);
  });

  it('is a prefix match, not a substring match', () => {
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: 'Some unrelated text that is not available in MCP land' })).toBe(false);
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_ERROR', error: `Upstream said: ${REFUSAL}` })).toBe(false);
  });

  it('never matches a success envelope', () => {
    expect(isNotExposedResponse({ success: true, data: { success: false, error: REFUSAL } })).toBe(false);
    expect(isNotExposedResponse({ success: true, data: { versions: [] } })).toBe(false);
  });

  it('does not match unrelated failures', () => {
    expect(isNotExposedResponse({ success: false, code: 'OFFICIAL_MCP_AUTH_FAILED', error: 'n8n rejected the MCP access token' })).toBe(false);
  });

  it('exports the exact prefix n8n uses', () => {
    expect(REFUSAL.startsWith(NOT_EXPOSED_PREFIX)).toBe(true);
  });
});

describe('publicApiMatchesContext', () => {
  it('matches with no context', () => {
    expect(publicApiMatchesContext(undefined)).toBe(true);
    expect(publicApiMatchesContext(null)).toBe(true);
  });

  it('matches with url and key both set', () => {
    expect(publicApiMatchesContext({ n8nApiUrl: 'https://a.example', n8nApiKey: 'k' })).toBe(true);
  });

  it('matches with only a key (no url)', () => {
    expect(publicApiMatchesContext({ n8nApiKey: 'k' })).toBe(true);
  });

  it('does not match with only a url (no key)', () => {
    expect(publicApiMatchesContext({ n8nApiUrl: 'https://a.example' })).toBe(false);
  });

  it('does not match with url and an MCP token but no key', () => {
    expect(publicApiMatchesContext({ n8nApiUrl: 'https://a.example', n8nMcpAccessToken: 't' })).toBe(false);
  });
});

describe('withMcpExposure', () => {
  const base = { workflowId: 'w', action: 'x', toolName: 'n8n_test_workflow' as const };

  it('refuses NOT_CONFIGURED, before any write, when context names an instance via url + token but no key', async () => {
    const api = { getWorkflow: vi.fn(), updateWorkflow: vi.fn() };
    const call = vi.fn().mockResolvedValue(refused);
    const r = await withMcpExposure(
      { ...base, apiClient: api as any, exposeToMcp: true, context: { n8nApiUrl: 'https://a.example', n8nMcpAccessToken: 't' } },
      call
    );
    expect(r).toMatchObject({ success: false, code: 'NOT_CONFIGURED', error: PUBLIC_API_CONTEXT_HINT });
    expect(api.getWorkflow).not.toHaveBeenCalled();
    expect(api.updateWorkflow).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('passes a success through untouched and calls once', async () => {
    const call = vi.fn().mockResolvedValue(ok);
    expect(await withMcpExposure({ ...base, apiClient: {} as any }, call)).toEqual(ok);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('passes an unrelated failure through untouched', async () => {
    const other = { success: false, code: 'OFFICIAL_MCP_ERROR', error: 'boom' } as McpToolResponse;
    const call = vi.fn().mockResolvedValue(other);
    expect(await withMcpExposure({ ...base, apiClient: {} as any }, call)).toEqual(other);
  });

  it('returns WORKFLOW_NOT_EXPOSED without writing when exposeToMcp is not true', async () => {
    const api = { getWorkflow: vi.fn(), updateWorkflow: vi.fn() };
    const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: false }, vi.fn().mockResolvedValue(refused));
    expect(r).toMatchObject({ success: false, code: 'WORKFLOW_NOT_EXPOSED', action: 'x', hint: WORKFLOW_NOT_EXPOSED_HINT });
    expect(r.exposedToMcp).toBeUndefined();
    expect(api.getWorkflow).not.toHaveBeenCalled();
    expect(api.updateWorkflow).not.toHaveBeenCalled();
  });

  it('enables, retries once and marks exposedToMcp when exposeToMcp is true', async () => {
    const api = { getWorkflow: vi.fn().mockResolvedValue({ id: 'w', name: 'n', nodes: [], connections: {}, settings: {} }), updateWorkflow: vi.fn().mockResolvedValue({}) };
    const call = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce(ok);
    const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, call);
    expect(api.updateWorkflow).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ success: true, exposedToMcp: true, data: { fine: true } });
  });

  it('surfaces a second refusal without looping and keeps exposedToMcp true', async () => {
    const api = { getWorkflow: vi.fn().mockResolvedValue({ id: 'w', settings: {} }), updateWorkflow: vi.fn().mockResolvedValue({}) };
    const call = vi.fn().mockResolvedValue(refused);
    const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ success: false, code: 'WORKFLOW_NOT_EXPOSED', exposedToMcp: true });
    expect(r.hint).toContain('still refused');
  });

  it('fails closed when the Public API is not configured and exposeToMcp is true', async () => {
    const r = await withMcpExposure({ ...base, apiClient: null, exposeToMcp: true }, vi.fn().mockResolvedValue(refused));
    expect(r).toMatchObject({ success: false, code: 'NOT_CONFIGURED' });
  });

  it('reports the enable failure', async () => {
    const api = { getWorkflow: vi.fn().mockRejectedValue(new Error('boom')), updateWorkflow: vi.fn() };
    const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, vi.fn().mockResolvedValue(refused));
    expect(r).toMatchObject({ success: false, code: 'EXPOSE_FAILED' });
    expect(r.error).toContain('boom');
  });

  it('surfaces the write warnings on the retried success', async () => {
    const api = {
      getWorkflow: vi.fn().mockResolvedValue({ id: 'w', settings: {} }),
      updateWorkflow: vi.fn().mockImplementation(async (_id: string, _wf: unknown, options: any) => {
        options?.onWarning?.('Node group "A" lost 1 member');
        return {};
      }),
    };
    const call = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce(ok);
    const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, call);
    expect(r).toMatchObject({ success: true, exposedToMcp: true });
    expect(r.warnings).toEqual(['Node group "A" lost 1 member']);
  });

  describe('server policy gates', () => {
    it('refuses the consent write when n8n_update_partial_workflow is disabled', async () => {
      process.env.DISABLED_TOOLS = 'n8n_update_partial_workflow';
      resetToolPolicyCache();
      const api = { getWorkflow: vi.fn(), updateWorkflow: vi.fn() };
      const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, vi.fn().mockResolvedValue(refused));
      expect(r).toMatchObject({ success: false, code: 'OPERATION_DISABLED' });
      expect(api.getWorkflow).not.toHaveBeenCalled();
      expect(api.updateWorkflow).not.toHaveBeenCalled();
    });

    it('refuses the consent write when the calling tool\'s expose operation is disabled', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_test_workflow:expose';
      resetToolPolicyCache();
      const api = { getWorkflow: vi.fn(), updateWorkflow: vi.fn() };
      const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, vi.fn().mockResolvedValue(refused));
      expect(r).toMatchObject({ success: false, code: 'OPERATION_DISABLED' });
      expect(api.getWorkflow).not.toHaveBeenCalled();
      expect(api.updateWorkflow).not.toHaveBeenCalled();
    });

    it('leaves a different tool\'s expose rule alone', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:expose';
      resetToolPolicyCache();
      const api = { getWorkflow: vi.fn().mockResolvedValue({ id: 'w', settings: {} }), updateWorkflow: vi.fn().mockResolvedValue({}) };
      const call = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce(ok);
      const r = await withMcpExposure({ ...base, apiClient: api as any, exposeToMcp: true }, call);
      expect(r).toMatchObject({ success: true, exposedToMcp: true });
      expect(api.updateWorkflow).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * The consent write through the REAL N8nApiClient, so the PUT body is the one
 * cleanWorkflowForUpdate actually produces (proving availableInMCP survives it
 * and that no read-only field is sent back).
 */
describe('enableWorkflowMcpExposure through the real N8nApiClient', () => {
  let client: N8nApiClient;
  let mockAxiosInstance: any;

  const storedWorkflow = {
    id: 'wf-1',
    name: 'Exposed test',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    versionId: 'v-9',
    tags: [{ id: 't1', name: 'ops' }],
    nodes: [{ id: 'n1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0] as [number, number], parameters: {} }],
    connections: { Start: { main: [[]] } },
    settings: { executionOrder: 'v1', timezone: 'UTC' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearVersionCache();

    vi.mocked(dns.lookup).mockImplementation(async () => ({ address: '8.8.8.8', family: 4 }) as any);

    mockAxiosInstance = {
      defaults: { baseURL: 'https://n8n.example.com/api/v1' },
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    };
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
    // The version probe goes through the module-level axios, not the instance.
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { status: 'ok' } } as any);

    client = new N8nApiClient({ baseUrl: 'https://n8n.example.com', apiKey: 'k' });
  });

  it('PUTs a complete update body with availableInMCP added and read-only fields stripped', async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: storedWorkflow });
    mockAxiosInstance.put.mockResolvedValue({ data: { ...storedWorkflow } });

    const { warnings } = await enableWorkflowMcpExposure(client, 'wf-1');

    expect(warnings).toEqual([]);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows/wf-1');
    expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);

    const [path, body] = mockAxiosInstance.put.mock.calls[0];
    expect(path).toBe('/workflows/wf-1');
    expect(body.name).toBe('Exposed test');
    expect(body.nodes).toEqual(storedWorkflow.nodes);
    expect(body.connections).toEqual(storedWorkflow.connections);
    expect(body.settings).toEqual({ executionOrder: 'v1', timezone: 'UTC', availableInMCP: true });
    for (const stripped of ['id', 'createdAt', 'updatedAt', 'active', 'tags', 'versionId']) {
      expect(body).not.toHaveProperty(stripped);
    }
  });

  it('returns the non-fatal warnings the write reports', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { ...storedWorkflow, nodeGroups: [{ id: 'g1', name: 'Group A', nodeIds: ['n1', 'deleted-node'] }] },
    });
    mockAxiosInstance.put.mockResolvedValue({ data: { ...storedWorkflow } });

    const { warnings } = await enableWorkflowMcpExposure(client, 'wf-1');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Group A');
    expect(mockAxiosInstance.put.mock.calls[0][1].settings.availableInMCP).toBe(true);
  });

  it('never clears an existing availableInMCP flag', async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: { ...storedWorkflow, settings: { executionOrder: 'v1', availableInMCP: true } } });
    mockAxiosInstance.put.mockResolvedValue({ data: { ...storedWorkflow } });

    await enableWorkflowMcpExposure(client, 'wf-1');
    expect(mockAxiosInstance.put.mock.calls[0][1].settings.availableInMCP).toBe(true);
  });
});
