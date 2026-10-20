/**
 * Routing tests for `n8n_workflow_versions`' `source` parameter and the new
 * `diff` mode.
 *
 * Two groups, mirroring `handlers-test-workflow.test.ts`:
 *  - a routing matrix that intercepts `callOfficialTool`, and
 *  - a wire group that lets the real `callOfficialTool` run against the fake
 *    official MCP server through a real `N8nOfficialMcpClient`.
 *
 * `officialMock.override` short-circuits the call in the matrix group and is
 * left null in the wire group.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { NodeRepository } from '@/database/node-repository';
import { startFakeOfficialMcp, FakeOfficialMcp, FakeTool } from '../../helpers/fake-official-mcp-server';
import { resetToolPolicyCache } from '@/mcp/tool-policy';
import { VERSION_OWNERSHIP_ERROR_PREFIX } from '@/services/workflow-versioning-service';

const telemetryMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackWorkflowCreation: vi.fn(),
  trackWorkflowMutation: vi.fn(),
}));

const officialMock = vi.hoisted(() => ({
  spy: vi.fn(),
  override: null as null | ((...args: any[]) => any),
}));

const versioningMock = vi.hoisted(() => ({
  getVersionHistory: vi.fn(),
  getVersion: vi.fn(),
  restoreVersion: vi.fn(),
  deleteVersion: vi.fn(),
  deleteAllVersions: vi.fn(),
  pruneVersions: vi.fn(),
  compareVersions: vi.fn(),
}));

const configMock = vi.hoisted(() => ({ getN8nApiConfig: vi.fn() }));

vi.mock('@/services/n8n-api-client');
vi.mock('@/database/node-repository');
// Method names mirror the real WorkflowVersioningService (getVersionHistory /
// getVersion / restoreVersion / deleteVersion / deleteAllVersions /
// pruneVersions / compareVersions).
vi.mock('@/services/workflow-versioning-service', async (orig) => ({
  ...(await orig<any>()),
  // vi.fn(impl), not .mockImplementation(): clearAllMocks() in beforeEach
  // strips a mockImplementation but keeps the constructor argument.
  WorkflowVersioningService: vi.fn(() => versioningMock),
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

const LOCAL_DIFF = {
  versionId1: 1,
  versionId2: 2,
  version1Number: 1,
  version2Number: 2,
  addedNodes: ['node-2'],
  removedNodes: [],
  modifiedNodes: [],
  connectionChanges: 0,
  settingChanges: null,
  nodeGroupChanges: 0,
};

/**
 * `getN8nApiClient` keeps a module-level default client keyed on the API URL,
 * so a fresh `mockApiClient` per test would otherwise never be reached.
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

describe('n8n_workflow_versions source routing', () => {
  let handlers: any;
  let mockApiClient: any;
  let repository: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    officialMock.override = null;
    delete process.env.DISABLED_TOOL_OPERATIONS;
    delete process.env.DISABLED_TOOLS;
    resetToolPolicyCache();

    versioningMock.getVersionHistory.mockResolvedValue([]);
    versioningMock.getVersion.mockResolvedValue({ id: 1, workflowId: 'w', versionNumber: 1 });
    versioningMock.restoreVersion.mockResolvedValue({
      success: true,
      message: 'restored',
      workflowId: 'w',
      toVersionId: 1,
      backupCreated: true,
    });
    versioningMock.deleteVersion.mockResolvedValue({ success: true, message: 'deleted' });
    versioningMock.deleteAllVersions.mockResolvedValue({ deleted: 2, message: 'deleted 2' });
    versioningMock.pruneVersions.mockResolvedValue({ pruned: 1, remaining: 9 });
    versioningMock.compareVersions.mockResolvedValue(LOCAL_DIFF);

    mockApiClient = {
      getWorkflow: vi.fn().mockResolvedValue({ id: 'w', name: 'W', nodes: [], connections: {}, settings: {} }),
      updateWorkflow: vi.fn().mockResolvedValue({ id: 'w' }),
      healthCheck: vi.fn(),
    };
    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);
    vi.mocked(NodeRepository).mockImplementation(() => ({}) as any);
    repository = {};

    handlers = await import('@/mcp/handlers-n8n-manager');
    resetDefaultApiClient(handlers);
  });

  afterEach(() => {
    delete process.env.DISABLED_TOOL_OPERATIONS;
    delete process.env.DISABLED_TOOLS;
    resetToolPolicyCache();
  });

  // ------------------------------------------------------------------ local

  it('defaults to local and labels the response with source, backend and mode', async () => {
    const r = await handlers.handleWorkflowVersions({ mode: 'list', workflowId: 'w' }, repository);

    expect(r).toMatchObject({ success: true, source: 'local', backend: 'n8n-mcp', mode: 'list' });
    expect(versioningMock.getVersionHistory).toHaveBeenCalledWith('w', undefined);
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('local diff compares two stored versions scoped to the workflow', async () => {
    const r = await handlers.handleWorkflowVersions(
      { mode: 'diff', workflowId: 'w', versionId: 1, toVersionId: 2 },
      repository
    );

    expect(versioningMock.compareVersions).toHaveBeenCalledWith(1, 2, 'w');
    expect(r).toMatchObject({
      success: true,
      source: 'local',
      backend: 'n8n-mcp',
      mode: 'diff',
      data: { addedNodes: ['node-2'], format: 'n8n-mcp' },
    });
  });

  it('local diff accepts numeric strings for the version ids', async () => {
    await handlers.handleWorkflowVersions(
      { mode: 'diff', workflowId: 'w', versionId: '1', toVersionId: '2' },
      repository
    );

    expect(versioningMock.compareVersions).toHaveBeenCalledWith(1, 2, 'w');
  });

  it('local diff refuses a non-integer id and names the field', async () => {
    const r = await handlers.handleWorkflowVersions(
      { mode: 'diff', workflowId: 'w', versionId: 'abc', toVersionId: 2 },
      repository
    );

    expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', source: 'local', backend: 'n8n-mcp' });
    expect(r.error).toContain('versionId');
    expect(versioningMock.compareVersions).not.toHaveBeenCalled();
  });

  it('local diff refuses ids Number() would silently reinterpret', async () => {
    // `Number('0x10')` is 16 and `Number('1e3')` is 1000 — an id in either
    // shape would address a different snapshot instead of being refused.
    for (const versionId of ['0x10', '1e3', '1.5', '  ', '+1']) {
      const r = await handlers.handleWorkflowVersions(
        { mode: 'diff', workflowId: 'w', versionId, toVersionId: 2 },
        repository
      );
      expect(r).toMatchObject({ success: false, code: 'INVALID_ARGS', source: 'local', backend: 'n8n-mcp' });
      expect(r.error).toContain('versionId');
    }
    expect(versioningMock.compareVersions).not.toHaveBeenCalled();
  });

  it('local diff still accepts a padded decimal id', async () => {
    await handlers.handleWorkflowVersions(
      { mode: 'diff', workflowId: 'w', versionId: ' 12 ', toVersionId: '-3' },
      repository
    );
    expect(versioningMock.compareVersions).toHaveBeenCalledWith(12, -3, 'w');
  });

  it('local diff requires both ids and the workflow id', async () => {
    const missingTo = await handlers.handleWorkflowVersions(
      { mode: 'diff', workflowId: 'w', versionId: 1 },
      repository
    );
    expect(missingTo).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(missingTo.error).toContain('toVersionId');

    const missingWorkflow = await handlers.handleWorkflowVersions(
      { mode: 'diff', versionId: 1, toVersionId: 2 },
      repository
    );
    expect(missingWorkflow).toMatchObject({ success: false });
    expect(missingWorkflow.error).toContain('workflowId');
    expect(versioningMock.compareVersions).not.toHaveBeenCalled();
  });

  it('local diff reports an ownership mismatch with the service message', async () => {
    const ownershipError = `Version 2 ${VERSION_OWNERSHIP_ERROR_PREFIX} w`;
    versioningMock.compareVersions.mockRejectedValue(new Error(ownershipError));

    const r = await handlers.handleWorkflowVersions(
      { mode: 'diff', workflowId: 'w', versionId: 1, toVersionId: 2 },
      repository
    );

    expect(r).toMatchObject({
      success: false,
      code: 'INVALID_ARGS',
      error: ownershipError,
      source: 'local',
    });
  });

  it('local get accepts a numeric string version id', async () => {
    await handlers.handleWorkflowVersions({ mode: 'get', versionId: '42' }, repository);
    expect(versioningMock.getVersion).toHaveBeenCalledWith(42);
  });

  // ----------------------------------------------------------------- native

  it('native list caps limit at 50 and forwards the offset', async () => {
    officialMock.override = async () => ({ success: true, data: { success: true, versions: [], count: 0 } });

    const r = await handlers.handleWorkflowVersions(
      { mode: 'list', source: 'native', workflowId: 'w', limit: 100, offset: 20 },
      repository
    );

    expect(officialMock.spy).toHaveBeenCalledWith(
      undefined,
      ['get_workflow_history'],
      { workflowId: 'w', limit: 50, offset: 20 },
      30000,
      'workflow_versions',
      true
    );
    expect(r).toMatchObject({ success: true, source: 'native', backend: 'official-mcp', mode: 'list' });
    expect(versioningMock.getVersionHistory).not.toHaveBeenCalled();
  });

  it('native list clamps limit to a whole number in [1, 50]', async () => {
    officialMock.override = async () => ({ success: true, data: { success: true, versions: [], count: 0 } });

    await handlers.handleWorkflowVersions(
      { mode: 'list', source: 'native', workflowId: 'w', limit: 0, offset: 3 },
      repository
    );
    expect(officialMock.spy.mock.calls[0][2]).toEqual({ workflowId: 'w', limit: 1, offset: 3 });

    await handlers.handleWorkflowVersions(
      { mode: 'list', source: 'native', workflowId: 'w', limit: 7.9 },
      repository
    );
    expect(officialMock.spy.mock.calls[1][2]).toEqual({ workflowId: 'w', limit: 7, offset: 0 });
  });

  it('native get sends the version id as a string', async () => {
    officialMock.override = async () => ({ success: true, data: { success: true, versionId: '7' } });

    await handlers.handleWorkflowVersions(
      { mode: 'get', source: 'native', workflowId: 'w', versionId: 7 },
      repository
    );

    const [, aliases, args, , , idempotent] = officialMock.spy.mock.calls[0];
    expect(aliases).toEqual(['get_workflow_version']);
    expect(args).toEqual({ workflowId: 'w', versionId: '7' });
    expect(idempotent).toBe(true);
  });

  it('native diff maps the ids onto fromVersionId/toVersionId and labels the format', async () => {
    officialMock.override = async () => ({ success: true, data: { success: true, nodesAdded: [] } });

    const r = await handlers.handleWorkflowVersions(
      { mode: 'diff', source: 'native', workflowId: 'w', versionId: 'v1', toVersionId: 'v2' },
      repository
    );

    const [, aliases, args] = officialMock.spy.mock.calls[0];
    expect(aliases).toEqual(['get_workflow_versions_diff']);
    expect(args).toEqual({ workflowId: 'w', fromVersionId: 'v1', toVersionId: 'v2' });
    expect(r).toMatchObject({ success: true, source: 'native', mode: 'diff', data: { format: 'n8n' } });
    expect(versioningMock.compareVersions).not.toHaveBeenCalled();
  });

  it('native rollback restores without pre-validation and says so', async () => {
    officialMock.override = async () => ({
      success: true,
      data: { success: true, restoredFromVersionId: '12', newVersionId: '13' },
    });

    const r = await handlers.handleWorkflowVersions(
      { mode: 'rollback', source: 'native', workflowId: 'w', versionId: 12, validateBefore: true },
      repository
    );

    // One call only: the official version payload cannot be validated, so no
    // get_workflow_version round-trip happens first.
    expect(officialMock.spy).toHaveBeenCalledTimes(1);
    expect(officialMock.spy).toHaveBeenCalledWith(
      undefined,
      ['restore_workflow_version'],
      { workflowId: 'w', versionId: '12' },
      30000,
      'workflow_versions',
      false
    );
    expect(r).toMatchObject({
      success: true,
      source: 'native',
      backend: 'official-mcp',
      mode: 'rollback',
      validation: 'not available for native versions',
    });
    expect(versioningMock.restoreVersion).not.toHaveBeenCalled();
  });

  it('a failed native rollback carries no validation note', async () => {
    officialMock.override = async () => ({
      success: false,
      code: 'OFFICIAL_MCP_ERROR',
      error: 'version not found',
    });

    const r = await handlers.handleWorkflowVersions(
      { mode: 'rollback', source: 'native', workflowId: 'w', versionId: 'nope' },
      repository
    );

    expect(r).toMatchObject({ success: false, source: 'native', mode: 'rollback' });
    expect(r.validation).toBeUndefined();
  });

  it('native delete and prune are refused without an official call', async () => {
    for (const mode of ['delete', 'prune']) {
      const r = await handlers.handleWorkflowVersions(
        { mode, source: 'native', workflowId: 'w', versionId: 1 },
        repository
      );
      expect(r).toMatchObject({
        success: false,
        code: 'MODE_NOT_SUPPORTED_FOR_SOURCE',
        source: 'native',
        backend: 'official-mcp',
        mode,
      });
    }
    expect(officialMock.spy).not.toHaveBeenCalled();
    expect(versioningMock.deleteVersion).not.toHaveBeenCalled();
    expect(versioningMock.pruneVersions).not.toHaveBeenCalled();
  });

  it('native modes require a workflowId and a version id where the tool needs one', async () => {
    const noWorkflow = await handlers.handleWorkflowVersions({ mode: 'list', source: 'native' }, repository);
    expect(noWorkflow).toMatchObject({ success: false, code: 'INVALID_ARGS', source: 'native' });
    expect(noWorkflow.error).toContain('workflowId');

    const noVersion = await handlers.handleWorkflowVersions(
      { mode: 'get', source: 'native', workflowId: 'w' },
      repository
    );
    expect(noVersion).toMatchObject({ success: false, code: 'INVALID_ARGS' });
    expect(noVersion.error).toContain('versionId');

    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('reports a not-exposed refusal without writing anything', async () => {
    officialMock.override = async () => ({
      success: false,
      action: 'workflow_versions',
      code: 'OFFICIAL_MCP_ERROR',
      error: REFUSAL,
      officialError: { success: false, workflowId: 'w', versions: [], count: 0, error: REFUSAL },
    });

    const r = await handlers.handleWorkflowVersions(
      { mode: 'list', source: 'native', workflowId: 'w' },
      repository
    );

    expect(r).toMatchObject({
      success: false,
      code: 'WORKFLOW_NOT_EXPOSED',
      source: 'native',
      backend: 'official-mcp',
      mode: 'list',
    });
    expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
  });

  it('enables Available in MCP once and retries when exposeToMcp is set', async () => {
    mockApiClient.getWorkflow.mockResolvedValue({
      id: 'w',
      name: 'W',
      nodes: [],
      connections: {},
      settings: { executionOrder: 'v1' },
    });
    let calls = 0;
    officialMock.override = async () => {
      calls += 1;
      return calls === 1
        ? { success: false, code: 'OFFICIAL_MCP_ERROR', error: REFUSAL, officialError: { error: REFUSAL } }
        : { success: true, data: { success: true, versions: [], count: 0 } };
    };

    const r = await handlers.handleWorkflowVersions(
      { mode: 'list', source: 'native', workflowId: 'w', exposeToMcp: true },
      repository
    );

    expect(mockApiClient.updateWorkflow).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateWorkflow.mock.calls[0][1].settings).toMatchObject({
      executionOrder: 'v1',
      availableInMCP: true,
    });
    expect(r).toMatchObject({ success: true, exposedToMcp: true, source: 'native', backend: 'official-mcp' });
  });
});

// ---------------------------------------------------------------------------
// Wire group: real callOfficialTool + real client against the fake server.
// ---------------------------------------------------------------------------

describe('n8n_workflow_versions over the wire', () => {
  let handlers: any;
  let mockApiClient: any;
  let repository: any;
  let fake: FakeOfficialMcp | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    officialMock.override = null;
    mockApiClient = {
      getWorkflow: vi.fn().mockResolvedValue({ id: 'w', name: 'W', nodes: [], connections: {}, settings: {} }),
      updateWorkflow: vi.fn().mockResolvedValue({ id: 'w' }),
      healthCheck: vi.fn(),
    };
    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);
    repository = {};
    handlers = await import('@/mcp/handlers-n8n-manager');
    resetDefaultApiClient(handlers);
  });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  async function contextFor(tools: FakeTool[]) {
    fake = await startFakeOfficialMcp({ tools });
    return { n8nApiUrl: new URL(fake.url).origin, n8nMcpAccessToken: 'tok' };
  }

  it('turns the version-history refusal envelope into WORKFLOW_NOT_EXPOSED', async () => {
    // get_workflow_history reports the refusal as a root `success: false`
    // payload WITHOUT `isError` — the shape callOfficialTool has to fail.
    const context = await contextFor([
      {
        name: 'get_workflow_history',
        handler: () => ({ success: false, workflowId: 'w', versions: [], count: 0, error: REFUSAL }),
      },
    ]);

    const r = await handlers.handleWorkflowVersions(
      { mode: 'list', source: 'native', workflowId: 'w' },
      repository,
      context
    );

    expect(r).toMatchObject({
      success: false,
      code: 'WORKFLOW_NOT_EXPOSED',
      source: 'native',
      backend: 'official-mcp',
      mode: 'list',
    });
    expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
  });

  it('returns n8n\'s own diff payload labelled as the n8n format', async () => {
    const context = await contextFor([
      {
        name: 'get_workflow_versions_diff',
        handler: () => ({
          success: true,
          workflowId: 'w',
          fromVersionId: 'v1',
          toVersionId: 'v2',
          nodesAdded: [{ id: 'n1', name: 'Set', type: 'n8n-nodes-base.set' }],
          nodesRemoved: [],
          nodesModified: [],
          connectionsAdded: [],
          connectionsRemoved: [],
        }),
      },
    ]);

    const r = await handlers.handleWorkflowVersions(
      { mode: 'diff', source: 'native', workflowId: 'w', versionId: 'v1', toVersionId: 'v2' },
      repository,
      context
    );

    expect(r).toMatchObject({
      success: true,
      source: 'native',
      backend: 'official-mcp',
      mode: 'diff',
      data: { format: 'n8n', fromVersionId: 'v1', toVersionId: 'v2' },
    });
    expect((r.data as any).nodesAdded).toHaveLength(1);
  });
});
