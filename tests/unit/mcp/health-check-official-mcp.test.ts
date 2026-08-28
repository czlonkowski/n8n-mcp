import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';

const telemetryMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackWorkflowCreation: vi.fn(),
  trackWorkflowMutation: vi.fn(),
}));

const access = vi.hoisted(() => ({ buildOfficialMcpHealth: vi.fn() }));

// Mock dependencies
vi.mock('@/services/n8n-api-client');
vi.mock('@/services/workflow-validator');
vi.mock('@/database/node-repository');
vi.mock('@/services/workflow-versioning-service', () => ({
  WorkflowVersioningService: vi.fn().mockImplementation(() => ({
    createBackup: vi.fn().mockResolvedValue({ versionId: 'v1', versionNumber: 1, pruned: 0 }),
    getVersions: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('@/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn()
}));
vi.mock('@/services/n8n-validation', () => ({
  validateWorkflowStructure: vi.fn(),
  hasWebhookTrigger: vi.fn(),
  getWebhookUrl: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
  LogLevel: {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
  }
}));
vi.mock('@/telemetry/telemetry-manager', () => ({
  telemetry: {
    trackEvent: telemetryMocks.trackEvent,
    trackWorkflowCreation: telemetryMocks.trackWorkflowCreation,
    trackWorkflowMutation: telemetryMocks.trackWorkflowMutation,
  },
}));
vi.mock('@/mcp/official-mcp-access', async (orig) => ({
  ...(await orig<any>()),
  buildOfficialMcpHealth: access.buildOfficialMcpHealth,
}));

describe('health check officialMcp block', () => {
  let mockApiClient: any;
  let mockRepository: any;
  let mockValidator: any;
  let handlers: any;
  let getN8nApiConfig: any;
  let n8nValidation: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    telemetryMocks.trackWorkflowMutation.mockResolvedValue(undefined);

    // Setup mock API client
    mockApiClient = {
      createWorkflow: vi.fn(),
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      triggerWebhook: vi.fn(),
      getExecution: vi.fn(),
      listExecutions: vi.fn(),
      deleteExecution: vi.fn(),
      healthCheck: vi.fn(),
      createDataTable: vi.fn(),
      listDataTables: vi.fn(),
      getDataTable: vi.fn(),
      updateDataTable: vi.fn(),
      deleteDataTable: vi.fn(),
      getDataTableRows: vi.fn(),
      insertDataTableRows: vi.fn(),
      updateDataTableRows: vi.fn(),
      upsertDataTableRow: vi.fn(),
      deleteDataTableRows: vi.fn(),
    };

    // Setup mock repository
    mockRepository = {
      getNodeByType: vi.fn(),
      getAllNodes: vi.fn(),
    };

    // Setup mock validator
    mockValidator = {
      validateWorkflow: vi.fn(),
    };

    // Import mocked modules
    getN8nApiConfig = (await import('@/config/n8n-api')).getN8nApiConfig;
    n8nValidation = await import('@/services/n8n-validation');

    // Mock the API config
    vi.mocked(getN8nApiConfig).mockReturnValue({
      baseUrl: 'https://n8n.test.com',
      apiKey: 'test-key',
      timeout: 30000,
      maxRetries: 3,
    });

    // Mock validation functions
    vi.mocked(n8nValidation.validateWorkflowStructure).mockReturnValue([]);
    vi.mocked(n8nValidation.hasWebhookTrigger).mockReturnValue(false);
    vi.mocked(n8nValidation.getWebhookUrl).mockReturnValue(null);

    // Mock the N8nApiClient constructor
    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);

    // Mock WorkflowValidator constructor
    vi.mocked(WorkflowValidator).mockImplementation(() => mockValidator);

    // Mock NodeRepository constructor
    vi.mocked(NodeRepository).mockImplementation(() => mockRepository);

    // Import handlers module after setting up mocks
    handlers = await import('@/mcp/handlers-n8n-manager');
  });

  afterEach(() => {
    // Clean up singleton state by accessing the module internals (mirrors
    // handlers-n8n-manager.test.ts) — otherwise a cached defaultApiClient
    // from one test's mockApiClient leaks into the next.
    if (handlers) {
      const clientGetter = handlers.getN8nApiClient;
      if (clientGetter) {
        vi.mocked(getN8nApiConfig).mockReturnValue(null);
        clientGetter();
      }
    }
  });

  it('status mode attaches the officialMcp block without a live probe', async () => {
    mockApiClient.healthCheck.mockResolvedValue({ status: 'ok', instanceId: 'i', n8nVersion: '2.36.7', features: [] });
    access.buildOfficialMcpHealth.mockResolvedValue({ configured: false, hint: 'Set N8N_MCP_ACCESS_TOKEN to enable n8n_manage_agents' });

    const r = await handlers.handleHealthCheck();

    expect(access.buildOfficialMcpHealth).toHaveBeenCalledWith(undefined, false);
    expect(r.data).toMatchObject({ officialMcp: { configured: false } });
  });

  it('diagnostic mode probes live', async () => {
    access.buildOfficialMcpHealth.mockResolvedValue({
      configured: true,
      endpoint: 'https://n8n.test.com/mcp-server/http',
      reachable: true,
      toolCount: 54,
      agentTools: true,
    });

    // server.ts:1926 dispatches mode:'diagnostic' this way
    const r = await handlers.handleDiagnostic({ params: { arguments: { mode: 'diagnostic' } } });

    expect(access.buildOfficialMcpHealth).toHaveBeenCalledWith(undefined, true);
    expect(r.data).toMatchObject({ officialMcp: { reachable: true, toolCount: 54 } });
  });

  // buildOfficialMcpHealth is mocked here, so this proves only that the health
  // handler passes its block through and adds nothing of its own — no
  // credential field ever appears alongside it. That the block itself is
  // token-free is asserted against the real implementation in
  // official-mcp-access.test.ts.
  it('passes the officialMcp block through without adding any credential field', async () => {
    mockApiClient.healthCheck.mockResolvedValue({ status: 'ok', features: [] });
    access.buildOfficialMcpHealth.mockResolvedValue({
      configured: true,
      endpoint: 'https://n8n.test.com/mcp-server/http',
      reachable: true,
      toolCount: 54,
      agentTools: true,
      checkedAt: new Date().toISOString(),
    });

    const r = await handlers.handleHealthCheck();

    const serialized = JSON.stringify(r.data);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toMatch(/token/i);
  });
});
