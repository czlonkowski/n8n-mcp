/**
 * Routing tests for `n8n_test_workflow`'s `method` parameter.
 *
 * Two groups:
 *  - a routing matrix that intercepts `callOfficialTool` (the official call is
 *    the unit under test's output, not its collaborator), and
 *  - a wire group that lets the real `callOfficialTool` run against the fake
 *    official MCP server through a real `N8nOfficialMcpClient`.
 *
 * The interception is a delegating wrapper rather than a plain `vi.fn()` so the
 * same file can do both: `officialMock.override` short-circuits the call in the
 * matrix group and is left null in the wire group.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { N8nApiError } from '@/utils/n8n-errors';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import { startFakeOfficialMcp, FakeOfficialMcp, FakeTool } from '../../helpers/fake-official-mcp-server';
import { resetToolPolicyCache } from '@/mcp/tool-policy';
import { z } from 'zod';

const telemetryMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackWorkflowCreation: vi.fn(),
  trackWorkflowMutation: vi.fn(),
}));

const officialMock = vi.hoisted(() => ({
  spy: vi.fn(),
  override: null as null | ((...args: any[]) => any),
}));

const registryMock = vi.hoisted(() => ({
  getHandler: vi.fn(),
  getRegisteredTypes: vi.fn(),
  ensureRegistryInitialized: vi.fn(),
  execute: vi.fn(),
}));

const configMock = vi.hoisted(() => ({ getN8nApiConfig: vi.fn() }));

vi.mock('@/services/n8n-api-client');
vi.mock('@/services/workflow-validator');
vi.mock('@/database/node-repository');
vi.mock('@/services/workflow-versioning-service', () => ({
  WorkflowVersioningService: vi.fn().mockImplementation(() => ({
    createBackup: vi.fn().mockResolvedValue({ versionId: 'v1', versionNumber: 1, pruned: 0 }),
    getVersions: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('@/config/n8n-api', async (orig) => ({
  ...(await orig<any>()),
  getN8nApiConfig: configMock.getN8nApiConfig,
}));
vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  Logger: vi.fn().mockImplementation(() => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() })),
  LogLevel: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 },
}));
vi.mock('@/telemetry/telemetry-manager', () => ({
  telemetry: {
    trackEvent: telemetryMocks.trackEvent,
    trackWorkflowCreation: telemetryMocks.trackWorkflowCreation,
    trackWorkflowMutation: telemetryMocks.trackWorkflowMutation,
  },
}));
vi.mock('@/triggers/trigger-registry', () => ({
  TriggerRegistry: {
    getHandler: registryMock.getHandler,
    getRegisteredTypes: registryMock.getRegisteredTypes,
  },
  ensureRegistryInitialized: registryMock.ensureRegistryInitialized,
  initializeTriggerRegistry: vi.fn(),
}));
vi.mock('@/mcp/handlers-official-tools', async (orig) => {
  const actual = await orig<any>();
  return {
    ...actual,
    callOfficialTool: (...args: any[]) => {
      officialMock.spy(...args);
      return officialMock.override ? officialMock.override(...args) : actual.callOfficialTool(...args);
    },
  };
});

const REFUSAL =
  'Workflow is not available in MCP. Enable MCP access from the workflow card in the workflows list, or from the workflow settings.';

const webhookNode = {
  id: 'n1',
  name: 'Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position: [0, 0] as [number, number],
  parameters: { path: 'hook', httpMethod: 'POST' },
};
const chatNode = {
  id: 'n2',
  name: 'When chat message received',
  type: '@n8n/n8n-nodes-langchain.chatTrigger',
  typeVersion: 1,
  position: [0, 0] as [number, number],
  parameters: {},
};
const formNode = {
  id: 'n3',
  name: 'On form submission',
  type: 'n8n-nodes-base.formTrigger',
  typeVersion: 2,
  position: [0, 0] as [number, number],
  parameters: { formTitle: 'Signup' },
};
const setNode = {
  id: 'n4',
  name: 'Edit Fields',
  type: 'n8n-nodes-base.set',
  typeVersion: 3,
  position: [0, 0] as [number, number],
  parameters: {},
};

/**
 * `getN8nApiClient` keeps a module-level default client keyed on the API URL,
 * so a fresh `mockApiClient` per test would otherwise never be reached. A null
 * config drops the cached one; the real config then rebuilds it from the
 * current `N8nApiClient` mock.
 */
function resetDefaultApiClient(handlers: any) {
  configMock.getN8nApiConfig.mockReturnValue(null);
  handlers.getN8nApiClient();
  configMock.getN8nApiConfig.mockReturnValue({
    baseUrl: 'https://n8n.test.com',
    apiKey: 'test-key',
    timeout: 30000,
    maxRetries: 3,
  });
}

describe('n8n_test_workflow method routing', () => {
  let handlers: any;
  let mockApiClient: any;

  const useWorkflow = (nodes: any[], overrides: Record<string, unknown> = {}) =>
    mockApiClient.getWorkflow.mockResolvedValue({
      id: 'w',
      name: 'Test Workflow',
      active: true,
      nodes,
      connections: {},
      settings: {},
      ...overrides,
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    officialMock.override = null;
    delete process.env.DISABLED_TOOL_OPERATIONS;
    delete process.env.DISABLED_TOOLS;
    resetToolPolicyCache();

    mockApiClient = {
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn().mockResolvedValue({ id: 'w' }),
      healthCheck: vi.fn(),
    };
    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);
    vi.mocked(WorkflowValidator).mockImplementation(() => ({ validateWorkflow: vi.fn() }) as any);
    vi.mocked(NodeRepository).mockImplementation(() => ({}) as any);

    registryMock.ensureRegistryInitialized.mockResolvedValue(undefined);
    registryMock.getRegisteredTypes.mockReturnValue(['webhook', 'form', 'chat']);
    registryMock.execute.mockResolvedValue({
      success: true,
      data: { received: true },
      executionId: 'legacy-exec',
      metadata: { duration: 5 },
    });
    registryMock.getHandler.mockReturnValue({
      capabilities: { requiresActiveWorkflow: false },
      execute: registryMock.execute,
    });

    handlers = await import('@/mcp/handlers-n8n-manager');
    resetDefaultApiClient(handlers);
    useWorkflow([webhookNode, setNode]);
  });

  afterEach(() => {
    delete process.env.DISABLED_TOOL_OPERATIONS;
    delete process.env.DISABLED_TOOLS;
    resetToolPolicyCache();
  });

  // ---------------------------------------------------------------- prepare

  it('routes prepare to prepare_workflow_pin_data as an idempotent 30s call', async () => {
    officialMock.override = async () => ({
      success: true,
      action: 'test_workflow',
      officialTool: 'prepare_workflow_pin_data',
      data: { nodeSchemasToGenerate: {}, coverage: { total: 0 } },
    });

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare' });

    expect(officialMock.spy).toHaveBeenCalledWith(
      undefined,
      ['prepare_workflow_pin_data'],
      { workflowId: 'w' },
      30000,
      'test_workflow',
      true
    );
    expect(r).toMatchObject({ success: true, method: 'prepare', backend: 'official-mcp' });
    // prepare needs no trigger analysis, so it must not spend a workflow GET.
    expect(mockApiClient.getWorkflow).not.toHaveBeenCalled();
  });

  it('runs prepare without a Public API key configured', async () => {
    // Official-only deployment: N8N_MCP_ACCESS_TOKEN + url, no N8N_API_KEY.
    // prepare never touches the Public API, so it must not demand one.
    configMock.getN8nApiConfig.mockReturnValue(null);
    handlers.getN8nApiClient();
    officialMock.override = async () => ({ success: true, data: { coverage: { total: 0 } } });

    const r = await handlers.handleTestWorkflow(
      { workflowId: 'w', method: 'prepare' },
      { n8nApiUrl: 'https://n8n.test.com', n8nMcpAccessToken: 'tok' }
    );

    expect(r).toMatchObject({ success: true, method: 'prepare', backend: 'official-mcp' });
    expect(officialMock.spy).toHaveBeenCalled();
  });

  // ----------------------------------------------------------------- pinned

  it('refuses pinned without pinData and names the prepare method', async () => {
    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'pinned' });
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', method: 'pinned' });
    expect(r.error).toContain('method: prepare');
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('refuses pinned with an empty pinData object', async () => {
    // Nothing pinned means every credentialed/HTTP node in the workflow runs
    // for real — refused like a missing pinData rather than forwarded.
    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'pinned', pinData: {} });
    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', method: 'pinned' });
    expect(r.error).toContain('method: prepare');
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('pinned converts timeoutMs to a shorter server-side timeout and auto-fills the trigger node', async () => {
    officialMock.override = async () => ({
      success: true,
      action: 'test_workflow',
      officialTool: 'test_workflow',
      data: { executionId: 'e1', status: 'success' },
    });
    const pinData = { Webhook: [{ json: { a: 1 } }] };

    const r = await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'pinned',
      pinData,
      timeoutMs: 120000,
    });

    expect(officialMock.spy).toHaveBeenCalledWith(
      undefined,
      ['test_workflow'],
      { workflowId: 'w', pinData, triggerNodeName: 'Webhook', timeout: 115 },
      120000,
      'test_workflow',
      false
    );
    expect(r).toMatchObject({
      success: true,
      method: 'pinned',
      backend: 'official-mcp',
      executionId: 'e1',
    });
  });

  it('pinned defaults to a 300s client deadline and a 295s server timeout', async () => {
    officialMock.override = async () => ({ success: true, data: { executionId: 'e1', status: 'success' } });

    await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'pinned',
      pinData: { Webhook: [] },
      triggerNodeName: 'Explicit Node',
    });

    const [, , officialArgs, timeoutMs] = officialMock.spy.mock.calls[0];
    expect(officialArgs).toMatchObject({ triggerNodeName: 'Explicit Node', timeout: 295 });
    expect(timeoutMs).toBe(300000);
  });

  it('maps a pinned run that ended badly to EXECUTION_FAILED, keeping the executionId', async () => {
    officialMock.override = async () => ({
      success: true,
      action: 'test_workflow',
      officialTool: 'test_workflow',
      data: { executionId: 'e9', status: 'error', error: 'node failed' },
    });

    const r = await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'pinned',
      pinData: { Webhook: [] },
    });

    expect(r).toMatchObject({
      success: false,
      code: 'EXECUTION_FAILED',
      error: 'node failed',
      executionId: 'e9',
      method: 'pinned',
      backend: 'official-mcp',
    });
  });

  it('warns when the legacy timeout is passed alongside an official method', async () => {
    officialMock.override = async () => ({ success: true, data: { executionId: 'e1', status: 'success' } });

    const r = await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'pinned',
      pinData: { Webhook: [] },
      timeout: 600000,
    });

    expect(r).toMatchObject({ success: true, method: 'pinned' });
    expect(r.warnings).toContain(
      'timeout applies to the HTTP trigger path only; use timeoutMs for method prepare/pinned/direct'
    );
  });

  it('describes a bad run status when the official result carries no error text', async () => {
    officialMock.override = async () => ({
      success: true,
      data: { executionId: 'e9', status: 'crashed' },
    });

    const r = await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'pinned',
      pinData: { Webhook: [] },
    });

    expect(r).toMatchObject({ success: false, code: 'EXECUTION_FAILED', error: 'Run finished with status crashed' });
  });

  // ----------------------------------------------------------------- direct

  it('direct maps message to chatInput with the detected trigger node name', async () => {
    useWorkflow([chatNode, setNode]);
    officialMock.override = async () => ({ success: true, data: { executionId: 'e2', status: 'started' } });

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct', message: 'hi' });

    expect(officialMock.spy.mock.calls[0][2]).toEqual({
      workflowId: 'w',
      executionMode: 'manual',
      triggerNodeName: 'When chat message received',
      inputs: { chatInput: 'hi' },
    });
    expect(r).toMatchObject({ success: true, method: 'direct', backend: 'official-mcp', executionId: 'e2' });
    expect(r.hint).toContain('n8n_executions');
  });

  it('direct maps data to formData for a form trigger', async () => {
    useWorkflow([formNode, setNode]);
    officialMock.override = async () => ({ success: true, data: { executionId: 'e3', status: 'started' } });

    await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct', data: { email: 'a@b.c' } });

    expect(officialMock.spy.mock.calls[0][2]).toEqual({
      workflowId: 'w',
      executionMode: 'manual',
      triggerNodeName: 'On form submission',
      inputs: { formData: { email: 'a@b.c' } },
    });
  });

  it('direct maps data/headers/httpMethod to webhookData and only uses production when asked', async () => {
    officialMock.override = async () => ({ success: true, data: { executionId: 'e4', status: 'started' } });

    await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct', data: { x: 1 } });
    expect(officialMock.spy.mock.calls[0][2]).toMatchObject({
      executionMode: 'manual',
      inputs: { webhookData: { method: 'POST', body: { x: 1 } } },
    });

    await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'direct',
      executionMode: 'production',
      data: { x: 1 },
      headers: { 'x-token': 't' },
      httpMethod: 'PUT',
    });
    expect(officialMock.spy.mock.calls[1][2]).toMatchObject({
      executionMode: 'production',
      inputs: { webhookData: { method: 'PUT', body: { x: 1 }, headers: { 'x-token': 't' } } },
    });
  });

  it('an explicit triggerNodeName decides the inputs shape over the first detected trigger', async () => {
    // Detection returns the webhook first; the caller names the form node.
    useWorkflow([webhookNode, formNode]);
    officialMock.override = async () => ({ success: true, data: { executionId: 'e5', status: 'started' } });

    await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'direct',
      triggerNodeName: 'On form submission',
      data: { email: 'a@b.c' },
    });

    expect(officialMock.spy.mock.calls[0][2]).toEqual({
      workflowId: 'w',
      executionMode: 'manual',
      triggerNodeName: 'On form submission',
      inputs: { formData: { email: 'a@b.c' } },
    });
  });

  it('direct refuses inputs when no trigger node is known', async () => {
    useWorkflow([setNode]);

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct', data: { x: 1 } });

    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', method: 'direct' });
    expect(r.error).toContain('triggerNodeName is required');
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('direct refuses an explicit triggerNodeName that matches no node in the workflow', async () => {
    useWorkflow([webhookNode, setNode]);

    const r = await handlers.handleTestWorkflow({
      workflowId: 'w',
      method: 'direct',
      triggerNodeName: 'Nope',
    });

    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', method: 'direct', backend: 'official-mcp' });
    expect(r.error).toContain('triggerNodeName "Nope" is not a node of workflow w');
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('direct without inputs sends no inputs and no auto-filled trigger node', async () => {
    officialMock.override = async () => ({ success: true, data: { executionId: 'e6', status: 'started' } });

    await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct' });

    expect(officialMock.spy.mock.calls[0][2]).toEqual({ workflowId: 'w', executionMode: 'manual' });
  });

  // ------------------------------------------------------------------- auto

  it('auto runs the existing trigger path when a trigger is detected', async () => {
    const r = await handlers.handleTestWorkflow({ workflowId: 'w' });

    expect(registryMock.execute).toHaveBeenCalledTimes(1);
    expect(officialMock.spy).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      success: true,
      method: 'trigger',
      backend: 'public-api',
      executionId: 'legacy-exec',
    });
  });

  it('auto never executes through the official server when no trigger is detected', async () => {
    useWorkflow([setNode]);

    // No official credentials at all.
    const withoutClient = await handlers.handleTestWorkflow({ workflowId: 'w' });
    expect(withoutClient).toMatchObject({
      success: false,
      error: 'Workflow cannot be triggered externally',
      method: 'auto',
    });
    expect(withoutClient.details.hint).toContain('method: direct');
    expect(withoutClient.details.hint).toContain('method: pinned');
    expect(withoutClient.details.hint).toContain('N8N_MCP_ACCESS_TOKEN');

    // Official credentials present alongside the Public API key for the same
    // instance: still the legacy error, never a direct run.
    const withClient = await handlers.handleTestWorkflow(
      { workflowId: 'w' },
      { n8nApiUrl: 'https://n8n.test.com', n8nApiKey: 'key', n8nMcpAccessToken: 'tok' }
    );
    expect(withClient).toMatchObject({ success: false, error: 'Workflow cannot be triggered externally' });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('labels a thrown API error with the method and backend it was on', async () => {
    // The workflow read for pinned/direct throws for a mistyped workflowId;
    // the caller still has to be told which route the call was on.
    mockApiClient.getWorkflow.mockRejectedValue(
      new N8nApiError('Workflow not found', 404, 'NOT_FOUND')
    );

    const r = await handlers.handleTestWorkflow({
      workflowId: 'nope',
      method: 'pinned',
      pinData: { Webhook: [{ json: {} }] },
    });

    expect(r).toMatchObject({ success: false, method: 'pinned', backend: 'official-mcp', code: 'NOT_FOUND' });
  });

  it('labels an invalid-input envelope with the requested method', async () => {
    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'nonsense' });
    expect(r).toMatchObject({ success: false, error: 'Invalid input', method: 'nonsense', backend: 'public-api' });
  });

  // ------------------------------------------------- context/instance mismatch

  it('refuses pinned with NOT_CONFIGURED when context names an instance via url + token but no key', async () => {
    const context = { n8nApiUrl: 'https://other-instance.test.com', n8nMcpAccessToken: 'tok' };

    const r = await handlers.handleTestWorkflow(
      { workflowId: 'w', method: 'pinned', pinData: { Webhook: [{ json: {} }] } },
      context
    );

    expect(r).toMatchObject({ success: false, code: 'NOT_CONFIGURED', method: 'pinned', backend: 'official-mcp' });
    expect(mockApiClient.getWorkflow).not.toHaveBeenCalled();
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('refuses direct with NOT_CONFIGURED when context names an instance via url + token but no key', async () => {
    const context = { n8nApiUrl: 'https://other-instance.test.com', n8nMcpAccessToken: 'tok' };

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct' }, context);

    expect(r).toMatchObject({ success: false, code: 'NOT_CONFIGURED', method: 'direct', backend: 'official-mcp' });
    expect(mockApiClient.getWorkflow).not.toHaveBeenCalled();
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('refuses auto and trigger too — the HTTP trigger path runs on the same Public API client', async () => {
    const context = { n8nApiUrl: 'https://other-instance.test.com', n8nMcpAccessToken: 'tok' };

    const auto = await handlers.handleTestWorkflow({ workflowId: 'w' }, context);
    expect(auto).toMatchObject({ success: false, code: 'NOT_CONFIGURED', method: 'auto', backend: 'public-api' });

    const trigger = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'trigger' }, context);
    expect(trigger).toMatchObject({ success: false, code: 'NOT_CONFIGURED', method: 'trigger', backend: 'public-api' });

    expect(mockApiClient.getWorkflow).not.toHaveBeenCalled();
    expect(registryMock.execute).not.toHaveBeenCalled();
  });

  it('lets a plain prepare through on a url + token context but refuses it with exposeToMcp', async () => {
    const context = { n8nApiUrl: 'https://other-instance.test.com', n8nMcpAccessToken: 'tok' };
    officialMock.override = async () => ({ success: true, data: { coverage: { total: 0 } } });

    const plain = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare' }, context);
    expect(plain).toMatchObject({ success: true, method: 'prepare', backend: 'official-mcp' });

    // exposeToMcp would write through the Public API client, which on this
    // context is the operator's own instance — refused before the official call.
    officialMock.spy.mockClear();
    const consenting = await handlers.handleTestWorkflow(
      { workflowId: 'w', method: 'prepare', exposeToMcp: true },
      context
    );
    expect(consenting).toMatchObject({ success: false, code: 'NOT_CONFIGURED', method: 'prepare', backend: 'official-mcp' });
    expect(officialMock.spy).not.toHaveBeenCalled();
    expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------- exposure

  it('reports a not-exposed refusal without writing anything', async () => {
    officialMock.override = async () => ({
      success: false,
      action: 'test_workflow',
      code: 'OFFICIAL_MCP_ERROR',
      error: REFUSAL,
      officialError: { error: REFUSAL },
    });

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare' });

    expect(r).toMatchObject({
      success: false,
      code: 'WORKFLOW_NOT_EXPOSED',
      method: 'prepare',
      backend: 'official-mcp',
    });
    expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
  });

  it('enables Available in MCP once and retries when exposeToMcp is set', async () => {
    mockApiClient.getWorkflow.mockResolvedValue({
      id: 'w',
      name: 'Test Workflow',
      active: true,
      nodes: [webhookNode],
      connections: {},
      settings: { executionOrder: 'v1' },
    });
    let calls = 0;
    officialMock.override = async () => {
      calls += 1;
      return calls === 1
        ? { success: false, code: 'OFFICIAL_MCP_ERROR', error: REFUSAL, officialError: { error: REFUSAL } }
        : { success: true, data: { coverage: { total: 1 } } };
    };

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare', exposeToMcp: true });

    expect(mockApiClient.updateWorkflow).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateWorkflow.mock.calls[0][1].settings).toMatchObject({
      executionOrder: 'v1',
      availableInMCP: true,
    });
    expect(r).toMatchObject({ success: true, exposedToMcp: true, method: 'prepare', backend: 'official-mcp' });
  });

  // ----------------------------------------------------------------- policy

  it('refuses auto once it resolves to the disabled trigger operation', async () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_test_workflow:trigger';
    resetToolPolicyCache();
    officialMock.override = async () => ({ success: true, data: {} });

    const auto = await handlers.handleTestWorkflow({ workflowId: 'w' });
    expect(auto).toMatchObject({ success: false, code: 'OPERATION_DISABLED', method: 'trigger' });
    expect(registryMock.execute).not.toHaveBeenCalled();

    const explicit = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'trigger' });
    expect(explicit).toMatchObject({ success: false, code: 'OPERATION_DISABLED' });

    // The read path stays open.
    const prepare = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare' });
    expect(prepare).toMatchObject({ success: true, method: 'prepare' });
  });
});

// ---------------------------------------------------------------------------
// Wire group: real callOfficialTool + real client against the fake server.
// ---------------------------------------------------------------------------

describe('n8n_test_workflow over the wire', () => {
  let handlers: any;
  let mockApiClient: any;
  let fake: FakeOfficialMcp | undefined;
  let savedMode: string | undefined;

  beforeAll(() => {
    savedMode = process.env.WEBHOOK_SECURITY_MODE;
    // 'permissive': the official-MCP client's own endpoint check (async
    // validateWebhookUrl) treats a resolved 127.x address as localhost and
    // allows it under 'moderate' too, but validateInstanceContext's sync URL
    // check (used once contexts below carry n8nApiKey, for I-1 coverage)
    // only skips the private-IP-range check in 'permissive' mode.
    process.env.WEBHOOK_SECURITY_MODE = 'permissive';
  });
  afterAll(() => {
    if (savedMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE;
    else process.env.WEBHOOK_SECURITY_MODE = savedMode;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    officialMock.override = null;
    mockApiClient = {
      getWorkflow: vi.fn().mockResolvedValue({
        id: 'w',
        name: 'Test Workflow',
        active: true,
        nodes: [webhookNode, setNode],
        connections: {},
        settings: {},
      }),
      updateWorkflow: vi.fn().mockResolvedValue({ id: 'w' }),
      healthCheck: vi.fn(),
    };
    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);
    handlers = await import('@/mcp/handlers-n8n-manager');
    resetDefaultApiClient(handlers);
  });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  /**
   * `n8nApiKey` is included so `publicApiMatchesContext` matches and the
   * consent write / pinned / direct trigger-detection read run against the
   * same (mocked) instance the official call targets — `getN8nApiClient`
   * builds an instance-specific client here, but `N8nApiClient` is
   * class-mocked to `mockApiClient` regardless of construction args, and
   * `validateInstanceContext` accepts the fake server's 127.0.0.1 origin.
   */
  async function contextFor(tools: FakeTool[]) {
    fake = await startFakeOfficialMcp({ tools });
    return { n8nApiUrl: new URL(fake.url).origin, n8nApiKey: 'test-key', n8nMcpAccessToken: 'tok' };
  }

  it('turns n8n\'s refusal into WORKFLOW_NOT_EXPOSED', async () => {
    const context = await contextFor([
      { name: 'prepare_workflow_pin_data', isError: true, handler: () => ({ error: REFUSAL }) },
    ]);

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare' }, context);

    expect(r).toMatchObject({
      success: false,
      code: 'WORKFLOW_NOT_EXPOSED',
      method: 'prepare',
      backend: 'official-mcp',
    });
    expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
  });

  // The real prepare_workflow_pin_data advertises a success-only output schema
  // and answers the refusal with `structuredContent: { error: … }`. Enforcing
  // that schema client-side turned the refusal into a transport error, so
  // exposeToMcp could never fire — the refusal must survive to the handler.
  it('reads the refusal through a structuredContent payload the tool\'s output schema forbids', async () => {
    const context = await contextFor([
      {
        name: 'prepare_workflow_pin_data',
        outputSchema: { nodeSchemasToGenerate: z.object({}).passthrough() },
        isError: true,
        handler: () => REFUSAL,
        structured: () => ({ error: REFUSAL }),
      },
    ]);

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'prepare' }, context);

    expect(r).toMatchObject({
      success: false,
      code: 'WORKFLOW_NOT_EXPOSED',
      method: 'prepare',
      backend: 'official-mcp',
    });
    expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
  });

  // The end-to-end consent flip: n8n refuses, n8n-mcp writes availableInMCP
  // through the REST API, then re-sends the same tool call. Everything but the
  // REST write happens over the wire against the fake server, so this covers
  // the refusal parsing, the retry, and the fact that the retry is a second
  // real tools/call rather than a replayed local result.
  it('flips Available in MCP and re-sends the call over the wire when exposeToMcp is set', async () => {
    let prepareCalls = 0;
    const context = await contextFor([
      {
        name: 'prepare_workflow_pin_data',
        outputSchema: { nodeSchemasToGenerate: z.object({}).passthrough() },
        // isError/structured are evaluated per call, so the tool can refuse
        // once and then succeed - matching what n8n does after the flip.
        isError: () => prepareCalls === 1,
        handler: () => (++prepareCalls === 1 ? REFUSAL : 'prepared'),
        structured: () =>
          prepareCalls === 1
            ? { error: REFUSAL }
            : { nodeSchemasToGenerate: {}, coverage: { total: 1 } },
      },
    ]);

    const r = await handlers.handleTestWorkflow(
      { workflowId: 'w', method: 'prepare', exposeToMcp: true },
      context
    );

    expect(r).toMatchObject({
      success: true,
      exposedToMcp: true,
      method: 'prepare',
      backend: 'official-mcp',
    });
    // Exactly one consent write, carrying availableInMCP without dropping the
    // workflow's existing settings.
    expect(mockApiClient.updateWorkflow).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateWorkflow.mock.calls[0][1].settings).toMatchObject({ availableInMCP: true });
    // Two tools/call POSTs reached the fake: the refused one and the retry.
    expect(fake!.toolCalls).toEqual(['prepare_workflow_pin_data', 'prepare_workflow_pin_data']);
  });

  it('lifts the executionId out of a successful pinned run', async () => {
    const context = await contextFor([
      { name: 'test_workflow', handler: () => ({ executionId: 'e1', status: 'success' }) },
    ]);

    const r = await handlers.handleTestWorkflow(
      { workflowId: 'w', method: 'pinned', pinData: { Webhook: [{ json: {} }] } },
      context
    );
    expect(r).toMatchObject({
      success: true,
      method: 'pinned',
      backend: 'official-mcp',
      executionId: 'e1',
    });
  });

  it('turns a pinned run that ended badly into EXECUTION_FAILED', async () => {
    // Precedence over the real client: test_workflow's status is the outcome of
    // a run that started fine, so callOfficialTool reports a success and the
    // handler is the one that fails it.
    const context = await contextFor([
      { name: 'test_workflow', handler: () => ({ executionId: 'e9', status: 'error', error: 'node failed' }) },
    ]);

    const r = await handlers.handleTestWorkflow(
      { workflowId: 'w', method: 'pinned', pinData: { Webhook: [{ json: {} }] } },
      context
    );

    expect(r).toMatchObject({
      success: false,
      code: 'EXECUTION_FAILED',
      error: 'node failed',
      executionId: 'e9',
      method: 'pinned',
      backend: 'official-mcp',
    });
  });

  it('maps a failed execute_workflow dispatch to OFFICIAL_MCP_ERROR', async () => {
    const context = await contextFor([
      { name: 'execute_workflow', handler: () => ({ executionId: null, status: 'error', error: 'boom' }) },
    ]);

    const r = await handlers.handleTestWorkflow({ workflowId: 'w', method: 'direct' }, context);

    expect(r).toMatchObject({
      success: false,
      code: 'OFFICIAL_MCP_ERROR',
      error: 'boom',
      method: 'direct',
      backend: 'official-mcp',
    });
  });
});
