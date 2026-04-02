import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import {
  N8nApiError,
  N8nAuthenticationError,
  N8nNotFoundError,
  N8nValidationError,
  N8nRateLimitError,
  N8nServerError,
} from '@/utils/n8n-errors';
import { ExecutionStatus } from '@/types/n8n-api';

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

describe('handlers-n8n-manager', () => {
  let mockApiClient: any;
  let mockRepository: any;
  let mockValidator: any;
  let handlers: any;
  let getN8nApiConfig: any;
  let n8nValidation: any;

  // Helper function to create test data
  const createTestWorkflow = (overrides = {}) => ({
    id: 'test-workflow-id',
    name: 'Test Workflow',
    active: true,
    nodes: [
      {
        id: 'node1',
        name: 'Start',
        type: 'n8n-nodes-base.start',
        typeVersion: 1,
        position: [100, 100],
        parameters: {},
      },
    ],
    connections: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tags: [],
    settings: {},
    ...overrides,
  });

  const createTestExecution = (overrides = {}) => ({
    id: 'exec-123',
    workflowId: 'test-workflow-id',
    status: ExecutionStatus.SUCCESS,
    startedAt: '2024-01-01T00:00:00Z',
    stoppedAt: '2024-01-01T00:01:00Z',
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    
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
    // Clean up singleton state by accessing the module internals
    if (handlers) {
      // Access the module's internal state via the getN8nApiClient function
      const clientGetter = handlers.getN8nApiClient;
      if (clientGetter) {
        // Force reset by setting config to null first
        vi.mocked(getN8nApiConfig).mockReturnValue(null);
        clientGetter();
      }
    }
  });

  describe('getN8nApiClient', () => {
    it('should create new client when config is available', () => {
      const client = handlers.getN8nApiClient();
      expect(client).toBe(mockApiClient);
      expect(N8nApiClient).toHaveBeenCalledWith({
        baseUrl: 'https://n8n.test.com',
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 3,
      });
    });

    it('should return null when config is not available', () => {
      vi.mocked(getN8nApiConfig).mockReturnValue(null);
      const client = handlers.getN8nApiClient();
      expect(client).toBeNull();
    });

    it('should reuse existing client when config has not changed', () => {
      // First call creates the client
      const client1 = handlers.getN8nApiClient();
      
      // Second call should reuse the same client
      const client2 = handlers.getN8nApiClient();
      
      expect(client1).toBe(client2);
      expect(N8nApiClient).toHaveBeenCalledTimes(1);
    });

    it('should create new client when config URL changes', () => {
      // First call with initial config
      const client1 = handlers.getN8nApiClient();
      expect(N8nApiClient).toHaveBeenCalledTimes(1);
      
      // Change the config URL
      vi.mocked(getN8nApiConfig).mockReturnValue({
        baseUrl: 'https://different.test.com',
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 3,
      });
      
      // Second call should create a new client
      const client2 = handlers.getN8nApiClient();
      expect(N8nApiClient).toHaveBeenCalledTimes(2);
      
      // Verify the second call used the new config
      expect(N8nApiClient).toHaveBeenNthCalledWith(2, {
        baseUrl: 'https://different.test.com',
        apiKey: 'test-key',
        timeout: 30000,
        maxRetries: 3,
      });
    });
  });

  describe('handleCreateWorkflow', () => {
    it('should create workflow successfully', async () => {
      const testWorkflow = createTestWorkflow();
      const input = {
        name: 'Test Workflow',
        nodes: testWorkflow.nodes,
        connections: testWorkflow.connections,
      };

      mockApiClient.createWorkflow.mockResolvedValue(testWorkflow);

      const result = await handlers.handleCreateWorkflow(input);

      expect(result).toEqual({
        success: true,
        data: {
          id: 'test-workflow-id',
          name: 'Test Workflow',
          active: true,
          nodeCount: 1,
        },
        message: 'Workflow "Test Workflow" created successfully with ID: test-workflow-id. Use n8n_get_workflow with mode \'structure\' to verify current state.',
      });

      // Should send input as-is to API (n8n expects FULL form: n8n-nodes-base.*)
      expect(mockApiClient.createWorkflow).toHaveBeenCalledWith(input);
      expect(n8nValidation.validateWorkflowStructure).toHaveBeenCalledWith(input);
    });

    it('should handle validation errors', async () => {
      const input = { invalid: 'data' };

      const result = await handlers.handleCreateWorkflow(input);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });

    it('should handle workflow structure validation failures', async () => {
      const input = {
        name: 'Test Workflow',
        nodes: [],
        connections: {},
      };

      vi.mocked(n8nValidation.validateWorkflowStructure).mockReturnValue([
        'Workflow must have at least one node',
      ]);

      const result = await handlers.handleCreateWorkflow(input);

      expect(result).toEqual({
        success: false,
        error: 'Workflow validation failed',
        details: { errors: ['Workflow must have at least one node'] },
      });
    });

    it('should handle API errors', async () => {
      const input = {
        name: 'Test Workflow',
        nodes: [{
          id: 'node1',
          name: 'Start',
          type: 'n8n-nodes-base.start',
          typeVersion: 1,
          position: [100, 100],
          parameters: {}
        }],
        connections: {},
      };

      const apiError = new N8nValidationError('Invalid workflow data', {
        field: 'nodes',
        message: 'Node configuration invalid',
      });
      mockApiClient.createWorkflow.mockRejectedValue(apiError);

      const result = await handlers.handleCreateWorkflow(input);

      expect(result).toEqual({
        success: false,
        error: 'Invalid request: Invalid workflow data',
        code: 'VALIDATION_ERROR',
        details: { field: 'nodes', message: 'Node configuration invalid' },
      });
    });

    it('should handle API not configured error', async () => {
      vi.mocked(getN8nApiConfig).mockReturnValue(null);

      const result = await handlers.handleCreateWorkflow({ name: 'Test', nodes: [], connections: {} });

      expect(result).toEqual({
        success: false,
        error: 'n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.',
      });
    });

    describe('SHORT form detection', () => {
      it('should detect and reject nodes-base.* SHORT form', async () => {
        const input = {
          name: 'Test Workflow',
          nodes: [{
            id: 'node1',
            name: 'Webhook',
            type: 'nodes-base.webhook',
            typeVersion: 1,
            position: [100, 100],
            parameters: {}
          }],
          connections: {}
        };

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Node type format error: n8n API requires FULL form node types');
        expect(result.details.errors).toHaveLength(1);
        expect(result.details.errors[0]).toContain('Node 0');
        expect(result.details.errors[0]).toContain('Webhook');
        expect(result.details.errors[0]).toContain('nodes-base.webhook');
        expect(result.details.errors[0]).toContain('n8n-nodes-base.webhook');
        expect(result.details.errors[0]).toContain('SHORT form');
        expect(result.details.errors[0]).toContain('FULL form');
        expect(result.details.hint).toBe('Use n8n-nodes-base.* instead of nodes-base.* for standard nodes');
      });

      it('should detect and reject nodes-langchain.* SHORT form', async () => {
        const input = {
          name: 'AI Workflow',
          nodes: [{
            id: 'ai1',
            name: 'AI Agent',
            type: 'nodes-langchain.agent',
            typeVersion: 1,
            position: [100, 100],
            parameters: {}
          }],
          connections: {}
        };

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Node type format error: n8n API requires FULL form node types');
        expect(result.details.errors).toHaveLength(1);
        expect(result.details.errors[0]).toContain('Node 0');
        expect(result.details.errors[0]).toContain('AI Agent');
        expect(result.details.errors[0]).toContain('nodes-langchain.agent');
        expect(result.details.errors[0]).toContain('@n8n/n8n-nodes-langchain.agent');
        expect(result.details.errors[0]).toContain('SHORT form');
        expect(result.details.errors[0]).toContain('FULL form');
        expect(result.details.hint).toBe('Use n8n-nodes-base.* instead of nodes-base.* for standard nodes');
      });

      it('should detect multiple SHORT form nodes', async () => {
        const input = {
          name: 'Test Workflow',
          nodes: [
            {
              id: 'node1',
              name: 'Webhook',
              type: 'nodes-base.webhook',
              typeVersion: 1,
              position: [100, 100],
              parameters: {}
            },
            {
              id: 'node2',
              name: 'HTTP Request',
              type: 'nodes-base.httpRequest',
              typeVersion: 1,
              position: [200, 100],
              parameters: {}
            },
            {
              id: 'node3',
              name: 'AI Agent',
              type: 'nodes-langchain.agent',
              typeVersion: 1,
              position: [300, 100],
              parameters: {}
            }
          ],
          connections: {}
        };

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Node type format error: n8n API requires FULL form node types');
        expect(result.details.errors).toHaveLength(3);
        expect(result.details.errors[0]).toContain('Node 0');
        expect(result.details.errors[0]).toContain('Webhook');
        expect(result.details.errors[0]).toContain('n8n-nodes-base.webhook');
        expect(result.details.errors[1]).toContain('Node 1');
        expect(result.details.errors[1]).toContain('HTTP Request');
        expect(result.details.errors[1]).toContain('n8n-nodes-base.httpRequest');
        expect(result.details.errors[2]).toContain('Node 2');
        expect(result.details.errors[2]).toContain('AI Agent');
        expect(result.details.errors[2]).toContain('@n8n/n8n-nodes-langchain.agent');
      });

      it('should allow FULL form n8n-nodes-base.* without error', async () => {
        const testWorkflow = createTestWorkflow({
          nodes: [{
            id: 'node1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [100, 100],
            parameters: {}
          }]
        });

        const input = {
          name: 'Test Workflow',
          nodes: testWorkflow.nodes,
          connections: {}
        };

        mockApiClient.createWorkflow.mockResolvedValue(testWorkflow);

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(true);
        expect(mockApiClient.createWorkflow).toHaveBeenCalledWith(input);
      });

      it('should allow FULL form @n8n/n8n-nodes-langchain.* without error', async () => {
        const testWorkflow = createTestWorkflow({
          nodes: [{
            id: 'ai1',
            name: 'AI Agent',
            type: '@n8n/n8n-nodes-langchain.agent',
            typeVersion: 1,
            position: [100, 100],
            parameters: {}
          }]
        });

        const input = {
          name: 'AI Workflow',
          nodes: testWorkflow.nodes,
          connections: {}
        };

        mockApiClient.createWorkflow.mockResolvedValue(testWorkflow);

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(true);
        expect(mockApiClient.createWorkflow).toHaveBeenCalledWith(input);
      });

      it('should detect SHORT form in mixed FULL/SHORT workflow', async () => {
        const input = {
          name: 'Mixed Workflow',
          nodes: [
            {
              id: 'node1',
              name: 'Start',
              type: 'n8n-nodes-base.start', // FULL form - correct
              typeVersion: 1,
              position: [100, 100],
              parameters: {}
            },
            {
              id: 'node2',
              name: 'Webhook',
              type: 'nodes-base.webhook', // SHORT form - error
              typeVersion: 1,
              position: [200, 100],
              parameters: {}
            }
          ],
          connections: {}
        };

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Node type format error: n8n API requires FULL form node types');
        expect(result.details.errors).toHaveLength(1);
        expect(result.details.errors[0]).toContain('Node 1');
        expect(result.details.errors[0]).toContain('Webhook');
        expect(result.details.errors[0]).toContain('nodes-base.webhook');
      });

      it('should handle nodes with null type gracefully', async () => {
        const input = {
          name: 'Test Workflow',
          nodes: [{
            id: 'node1',
            name: 'Unknown',
            type: null,
            typeVersion: 1,
            position: [100, 100],
            parameters: {}
          }],
          connections: {}
        };

        // Should pass SHORT form detection (null doesn't start with 'nodes-base.')
        // Will fail at structure validation or API call
        vi.mocked(n8nValidation.validateWorkflowStructure).mockReturnValue([
          'Node type is required'
        ]);

        const result = await handlers.handleCreateWorkflow(input);

        // Should fail at validation, not SHORT form detection
        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow validation failed');
      });

      it('should handle nodes with undefined type gracefully', async () => {
        const input = {
          name: 'Test Workflow',
          nodes: [{
            id: 'node1',
            name: 'Unknown',
            // type is undefined
            typeVersion: 1,
            position: [100, 100],
            parameters: {}
          }],
          connections: {}
        };

        // Should pass SHORT form detection (undefined doesn't start with 'nodes-base.')
        // Will fail at structure validation or API call
        vi.mocked(n8nValidation.validateWorkflowStructure).mockReturnValue([
          'Node type is required'
        ]);

        const result = await handlers.handleCreateWorkflow(input);

        // Should fail at validation, not SHORT form detection
        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow validation failed');
      });

      it('should handle empty nodes array gracefully', async () => {
        const input = {
          name: 'Empty Workflow',
          nodes: [],
          connections: {}
        };

        // Should pass SHORT form detection (no nodes to check)
        vi.mocked(n8nValidation.validateWorkflowStructure).mockReturnValue([
          'Workflow must have at least one node'
        ]);

        const result = await handlers.handleCreateWorkflow(input);

        // Should fail at validation, not SHORT form detection
        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow validation failed');
      });

      it('should handle nodes array with undefined nodes gracefully', async () => {
        const input = {
          name: 'Test Workflow',
          nodes: undefined,
          connections: {}
        };

        const result = await handlers.handleCreateWorkflow(input);

        // Should fail at Zod validation (nodes is required in schema)
        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid input');
        expect(result.details).toHaveProperty('errors');
      });

      it('should provide correct index in error message for multiple nodes', async () => {
        const input = {
          name: 'Test Workflow',
          nodes: [
            {
              id: 'node1',
              name: 'Start',
              type: 'n8n-nodes-base.start', // FULL form - OK
              typeVersion: 1,
              position: [100, 100],
              parameters: {}
            },
            {
              id: 'node2',
              name: 'Process',
              type: 'n8n-nodes-base.set', // FULL form - OK
              typeVersion: 1,
              position: [200, 100],
              parameters: {}
            },
            {
              id: 'node3',
              name: 'Webhook',
              type: 'nodes-base.webhook', // SHORT form - index 2
              typeVersion: 1,
              position: [300, 100],
              parameters: {}
            }
          ],
          connections: {}
        };

        const result = await handlers.handleCreateWorkflow(input);

        expect(result.success).toBe(false);
        expect(result.details.errors).toHaveLength(1);
        expect(result.details.errors[0]).toContain('Node 2'); // Zero-indexed
        expect(result.details.errors[0]).toContain('Webhook');
      });
    });

    it('should pass projectId to API when provided', async () => {
      const testWorkflow = createTestWorkflow();
      const input = {
        name: 'Test Workflow',
        nodes: testWorkflow.nodes,
        connections: testWorkflow.connections,
        projectId: 'project-abc-123',
      };

      mockApiClient.createWorkflow.mockResolvedValue(testWorkflow);

      const result = await handlers.handleCreateWorkflow(input);

      expect(result.success).toBe(true);
      expect(mockApiClient.createWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-abc-123',
        })
      );
    });
  });

  describe('handleGetWorkflow', () => {
    it('should get workflow successfully', async () => {
      const testWorkflow = createTestWorkflow();
      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);

      const result = await handlers.handleGetWorkflow({ id: 'test-workflow-id' });

      expect(result).toEqual({
        success: true,
        data: testWorkflow,
      });
      expect(mockApiClient.getWorkflow).toHaveBeenCalledWith('test-workflow-id');
    });

    it('should handle not found error', async () => {
      const notFoundError = new N8nNotFoundError('Workflow', 'non-existent');
      mockApiClient.getWorkflow.mockRejectedValue(notFoundError);

      const result = await handlers.handleGetWorkflow({ id: 'non-existent' });

      expect(result).toEqual({
        success: false,
        error: 'Workflow with ID non-existent not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle invalid input', async () => {
      const result = await handlers.handleGetWorkflow({ notId: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
    });
  });

  describe('handleGetWorkflowDetails', () => {
    it('should get workflow details with execution stats', async () => {
      const testWorkflow = createTestWorkflow();
      const testExecutions = [
        createTestExecution({ status: ExecutionStatus.SUCCESS }),
        createTestExecution({ status: ExecutionStatus.ERROR }),
        createTestExecution({ status: ExecutionStatus.SUCCESS }),
      ];

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockApiClient.listExecutions.mockResolvedValue({
        data: testExecutions,
        nextCursor: null,
      });

      const result = await handlers.handleGetWorkflowDetails({ id: 'test-workflow-id' });

      expect(result).toEqual({
        success: true,
        data: {
          workflow: testWorkflow,
          executionStats: {
            totalExecutions: 3,
            successCount: 2,
            errorCount: 1,
            lastExecutionTime: '2024-01-01T00:00:00Z',
          },
          hasWebhookTrigger: false,
          webhookPath: null,
        },
      });
    });

    it('should handle workflow with webhook trigger', async () => {
      const testWorkflow = createTestWorkflow({
        nodes: [
          {
            id: 'webhook1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [100, 100],
            parameters: { path: 'test-webhook' },
          },
        ],
      });

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockApiClient.listExecutions.mockResolvedValue({ data: [], nextCursor: null });
      vi.mocked(n8nValidation.hasWebhookTrigger).mockReturnValue(true);
      vi.mocked(n8nValidation.getWebhookUrl).mockReturnValue('/webhook/test-webhook');

      const result = await handlers.handleGetWorkflowDetails({ id: 'test-workflow-id' });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('hasWebhookTrigger', true);
      expect(result.data).toHaveProperty('webhookPath', '/webhook/test-webhook');
    });
  });

  describe('handleDeleteWorkflow', () => {
    it('should delete workflow successfully', async () => {
      const testWorkflow = createTestWorkflow();
      mockApiClient.deleteWorkflow.mockResolvedValue(testWorkflow);

      const result = await handlers.handleDeleteWorkflow({ id: 'test-workflow-id' });

      expect(result).toEqual({
        success: true,
        data: {
          id: 'test-workflow-id',
          name: 'Test Workflow',
          deleted: true,
        },
        message: 'Workflow "Test Workflow" deleted successfully.',
      });
      expect(mockApiClient.deleteWorkflow).toHaveBeenCalledWith('test-workflow-id');
    });

    it('should handle invalid input', async () => {
      const result = await handlers.handleDeleteWorkflow({ notId: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });

    it('should handle N8nApiError', async () => {
      const apiError = new N8nNotFoundError('Workflow', 'non-existent-id');
      mockApiClient.deleteWorkflow.mockRejectedValue(apiError);

      const result = await handlers.handleDeleteWorkflow({ id: 'non-existent-id' });

      expect(result).toEqual({
        success: false,
        error: 'Workflow with ID non-existent-id not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Database connection failed');
      mockApiClient.deleteWorkflow.mockRejectedValue(genericError);

      const result = await handlers.handleDeleteWorkflow({ id: 'test-workflow-id' });

      expect(result).toEqual({
        success: false,
        error: 'Database connection failed',
      });
    });

    it('should handle API not configured error', async () => {
      vi.mocked(getN8nApiConfig).mockReturnValue(null);

      const result = await handlers.handleDeleteWorkflow({ id: 'test-workflow-id' });

      expect(result).toEqual({
        success: false,
        error: 'n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.',
      });
    });
  });

  describe('handleListWorkflows', () => {
    it('should list workflows with minimal data', async () => {
      const workflows = [
        createTestWorkflow({ id: 'wf1', name: 'Workflow 1', nodes: [{}, {}] }),
        createTestWorkflow({ id: 'wf2', name: 'Workflow 2', active: false, nodes: [{}, {}, {}] }),
      ];

      mockApiClient.listWorkflows.mockResolvedValue({
        data: workflows,
        nextCursor: 'next-page-cursor',
      });

      const result = await handlers.handleListWorkflows({
        limit: 50,
        active: true,
      });

      expect(result).toEqual({
        success: true,
        data: {
          workflows: [
            {
              id: 'wf1',
              name: 'Workflow 1',
              active: true,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              tags: [],
              nodeCount: 2,
            },
            {
              id: 'wf2',
              name: 'Workflow 2',
              active: false,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              tags: [],
              nodeCount: 3,
            },
          ],
          returned: 2,
          nextCursor: 'next-page-cursor',
          hasMore: true,
          _note: 'More workflows available. Use cursor to get next page.',
        },
      });
    });

    it('should handle invalid input with ZodError', async () => {
      const result = await handlers.handleListWorkflows({
        limit: 'invalid',  // Should be a number
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });

    it('should handle N8nApiError', async () => {
      const apiError = new N8nAuthenticationError('Invalid API key');
      mockApiClient.listWorkflows.mockRejectedValue(apiError);

      const result = await handlers.handleListWorkflows({});

      expect(result).toEqual({
        success: false,
        error: 'Failed to authenticate with n8n. Please check your API key.',
        code: 'AUTHENTICATION_ERROR',
      });
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Network timeout');
      mockApiClient.listWorkflows.mockRejectedValue(genericError);

      const result = await handlers.handleListWorkflows({});

      expect(result).toEqual({
        success: false,
        error: 'Network timeout',
      });
    });

    it('should handle workflows without isArchived field gracefully', async () => {
      const workflows = [
        createTestWorkflow({ id: 'wf1', name: 'Workflow 1' }),
      ];
      // Remove isArchived field to test undefined handling
      delete (workflows[0] as any).isArchived;

      mockApiClient.listWorkflows.mockResolvedValue({
        data: workflows,
        nextCursor: null,
      });

      const result = await handlers.handleListWorkflows({});

      expect(result.success).toBe(true);
      expect(result.data.workflows[0]).toHaveProperty('isArchived');
    });

    it('should convert tags array to comma-separated string', async () => {
      const workflows = [
        createTestWorkflow({ id: 'wf1', name: 'Workflow 1', tags: ['tag1', 'tag2'] }),
      ];

      mockApiClient.listWorkflows.mockResolvedValue({
        data: workflows,
        nextCursor: null,
      });

      const result = await handlers.handleListWorkflows({
        tags: ['production', 'active'],
      });

      expect(result.success).toBe(true);
      expect(mockApiClient.listWorkflows).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: 'production,active',
        })
      );
    });

    it('should handle empty tags array', async () => {
      const workflows = [
        createTestWorkflow({ id: 'wf1', name: 'Workflow 1' }),
      ];

      mockApiClient.listWorkflows.mockResolvedValue({
        data: workflows,
        nextCursor: null,
      });

      const result = await handlers.handleListWorkflows({
        tags: [],
      });

      expect(result.success).toBe(true);
      expect(mockApiClient.listWorkflows).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: undefined,
        })
      );
    });
  });

  describe('handleValidateWorkflow', () => {
    it('should validate workflow from n8n instance', async () => {
      const testWorkflow = createTestWorkflow();
      const mockNodeRepository = {} as any; // Mock repository

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockValidator.validateWorkflow.mockResolvedValue({
        valid: true,
        errors: [],
        warnings: [
          {
            nodeName: 'node1',
            message: 'Consider using newer version',
            details: { currentVersion: 1, latestVersion: 2 },
          },
        ],
        suggestions: ['Add error handling to workflow'],
        statistics: {
          totalNodes: 1,
          enabledNodes: 1,
          triggerNodes: 1,
          validConnections: 0,
          invalidConnections: 0,
          expressionsValidated: 0,
        },
      });

      const result = await handlers.handleValidateWorkflow(
        { id: 'test-workflow-id', options: { validateNodes: true } },
        mockNodeRepository
      );

      expect(result).toEqual({
        success: true,
        data: {
          valid: true,
          workflowId: 'test-workflow-id',
          workflowName: 'Test Workflow',
          summary: {
            totalNodes: 1,
            enabledNodes: 1,
            triggerNodes: 1,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0,
            errorCount: 0,
            warningCount: 1,
          },
          warnings: [
            {
              node: 'node1',
              nodeName: 'node1',
              message: 'Consider using newer version',
              details: { currentVersion: 1, latestVersion: 2 },
            },
          ],
          suggestions: ['Add error handling to workflow'],
        },
      });
    });
  });

  describe('handleHealthCheck', () => {
    it('should check health successfully', async () => {
      const healthData = {
        status: 'ok',
        instanceId: 'n8n-instance-123',
        n8nVersion: '1.0.0',
        features: ['webhooks', 'api'],
      };

      mockApiClient.healthCheck.mockResolvedValue(healthData);

      const result = await handlers.handleHealthCheck();

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        status: 'ok',
        instanceId: 'n8n-instance-123',
        n8nVersion: '1.0.0',
        features: ['webhooks', 'api'],
        apiUrl: 'https://n8n.test.com',
      });
    });

    it('should handle API errors', async () => {
      const apiError = new N8nServerError('Service unavailable');
      mockApiClient.healthCheck.mockRejectedValue(apiError);

      const result = await handlers.handleHealthCheck();

      expect(result).toEqual({
        success: false,
        error: 'Service unavailable',
        code: 'SERVER_ERROR',
        details: {
          apiUrl: 'https://n8n.test.com',
          hint: 'Check if n8n is running and API is enabled',
          troubleshooting: [
            '1. Verify n8n instance is running',
            '2. Check N8N_API_URL is correct',
            '3. Verify N8N_API_KEY has proper permissions',
            '4. Run n8n_health_check with mode="diagnostic" for detailed analysis',
          ],
        },
      });
    });
  });

  describe('handleDiagnostic', () => {
    it('should provide diagnostic information', async () => {
      const healthData = {
        status: 'ok',
        n8nVersion: '1.0.0',
      };
      mockApiClient.healthCheck.mockResolvedValue(healthData);

      // Set environment variables for the test
      process.env.N8N_API_URL = 'https://n8n.test.com';
      process.env.N8N_API_KEY = 'test-key';

      const result = await handlers.handleDiagnostic({ params: { arguments: {} } });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        environment: {
          N8N_API_URL: 'https://n8n.test.com',
          N8N_API_KEY: '***configured***',
        },
        apiConfiguration: {
          configured: true,
          status: {
            configured: true,
            connected: true,
            version: '1.0.0',
          },
        },
        toolsAvailability: {
          documentationTools: {
            count: 7,
            enabled: true,
          },
          managementTools: {
            count: 14,
            enabled: true,
          },
          totalAvailable: 21,
        },
      });

      // Clean up env vars
      process.env.N8N_API_URL = undefined as any;
      process.env.N8N_API_KEY = undefined as any;
    });
  });

  describe('Error handling', () => {
    it('should handle authentication errors', async () => {
      const authError = new N8nAuthenticationError('Invalid API key');
      mockApiClient.getWorkflow.mockRejectedValue(authError);

      const result = await handlers.handleGetWorkflow({ id: 'test-id' });

      expect(result).toEqual({
        success: false,
        error: 'Failed to authenticate with n8n. Please check your API key.',
        code: 'AUTHENTICATION_ERROR',
      });
    });

    it('should handle rate limit errors', async () => {
      const rateLimitError = new N8nRateLimitError(60);
      mockApiClient.listWorkflows.mockRejectedValue(rateLimitError);

      const result = await handlers.handleListWorkflows({});

      expect(result).toEqual({
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMIT_ERROR',
      });
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Something went wrong');
      mockApiClient.createWorkflow.mockRejectedValue(genericError);

      const result = await handlers.handleCreateWorkflow({
        name: 'Test',
        nodes: [],
        connections: {},
      });

      expect(result).toEqual({
        success: false,
        error: 'Something went wrong',
      });
    });
  });

  describe('handleTriggerWebhookWorkflow', () => {
    it('should trigger webhook successfully', async () => {
      const webhookResponse = {
        status: 200,
        statusText: 'OK',
        data: { result: 'success' },
        headers: {}
      };

      mockApiClient.triggerWebhook.mockResolvedValue(webhookResponse);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test-123',
        httpMethod: 'POST',
        data: { test: 'data' }
      });

      expect(result).toEqual({
        success: true,
        data: webhookResponse,
        message: 'Webhook triggered successfully'
      });
    });

    it('should extract execution ID from webhook error response', async () => {
      const apiError = new N8nServerError('Workflow execution failed');
      apiError.details = {
        executionId: 'exec_abc123',
        workflowId: 'wf_xyz789'
      };

      mockApiClient.triggerWebhook.mockRejectedValue(apiError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test-123',
        httpMethod: 'POST'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow wf_xyz789 execution exec_abc123 failed');
      expect(result.error).toContain('n8n_get_execution');
      expect(result.error).toContain("mode: 'preview'");
      expect(result.executionId).toBe('exec_abc123');
      expect(result.workflowId).toBe('wf_xyz789');
    });

    it('should extract execution ID without workflow ID', async () => {
      const apiError = new N8nServerError('Execution failed');
      apiError.details = {
        executionId: 'exec_only_123'
      };

      mockApiClient.triggerWebhook.mockRejectedValue(apiError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test-123',
        httpMethod: 'GET'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution exec_only_123 failed');
      expect(result.error).toContain('n8n_get_execution');
      expect(result.error).toContain("mode: 'preview'");
      expect(result.executionId).toBe('exec_only_123');
      expect(result.workflowId).toBeUndefined();
    });

    it('should handle execution ID as "id" field', async () => {
      const apiError = new N8nServerError('Error');
      apiError.details = {
        id: 'exec_from_id_field',
        workflowId: 'wf_test'
      };

      mockApiClient.triggerWebhook.mockRejectedValue(apiError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test',
        httpMethod: 'POST'
      });

      expect(result.error).toContain('exec_from_id_field');
      expect(result.executionId).toBe('exec_from_id_field');
    });

    it('should provide generic guidance when no execution ID is available', async () => {
      const apiError = new N8nServerError('Server error without execution context');
      apiError.details = {}; // No execution ID

      mockApiClient.triggerWebhook.mockRejectedValue(apiError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test',
        httpMethod: 'POST'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow failed to execute');
      expect(result.error).toContain('n8n_list_executions');
      expect(result.error).toContain('n8n_get_execution');
      expect(result.error).toContain("mode='preview'");
      expect(result.executionId).toBeUndefined();
    });

    it('should use standard error message for authentication errors', async () => {
      const authError = new N8nAuthenticationError('Invalid API key');
      mockApiClient.triggerWebhook.mockRejectedValue(authError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test',
        httpMethod: 'POST'
      });

      expect(result).toEqual({
        success: false,
        error: 'Failed to authenticate with n8n. Please check your API key.',
        code: 'AUTHENTICATION_ERROR',
        details: undefined
      });
    });

    it('should use standard error message for validation errors', async () => {
      const validationError = new N8nValidationError('Invalid webhook URL');
      mockApiClient.triggerWebhook.mockRejectedValue(validationError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test',
        httpMethod: 'POST'
      });

      expect(result.error).toBe('Invalid request: Invalid webhook URL');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle invalid input with Zod validation error', async () => {
      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'not-a-url',
        httpMethod: 'INVALID_METHOD'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });

    it('should not include "contact support" in error messages', async () => {
      const apiError = new N8nServerError('Test error');
      apiError.details = { executionId: 'test_exec' };

      mockApiClient.triggerWebhook.mockRejectedValue(apiError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test',
        httpMethod: 'POST'
      });

      expect(result.error?.toLowerCase()).not.toContain('contact support');
      expect(result.error?.toLowerCase()).not.toContain('try again later');
    });

    it('should always recommend preview mode in error messages', async () => {
      const apiError = new N8nServerError('Error');
      apiError.details = { executionId: 'test_123' };

      mockApiClient.triggerWebhook.mockRejectedValue(apiError);

      const result = await handlers.handleTriggerWebhookWorkflow({
        webhookUrl: 'https://n8n.test.com/webhook/test',
        httpMethod: 'POST'
      });

      expect(result.error).toMatch(/mode:\s*'preview'/);
    });
  });

  describe('handleUpdateWorkflow - credential preservation', () => {
    function mockCurrentWorkflow(nodes: any[]): void {
      const workflow = createTestWorkflow({ id: 'wf-1', active: false, nodes });
      mockApiClient.getWorkflow.mockResolvedValue(workflow);
      mockApiClient.updateWorkflow.mockResolvedValue({ ...workflow, updatedAt: '2024-01-02' });
    }

    function getSentNodes(): any[] {
      return mockApiClient.updateWorkflow.mock.calls[0][1].nodes;
    }

    it('should preserve credentials from current workflow when update nodes omit them', async () => {
      mockCurrentWorkflow([
        {
          id: 'node-1', name: 'Postgres', type: 'n8n-nodes-base.postgres',
          typeVersion: 2, position: [100, 100],
          parameters: { operation: 'executeQuery', query: 'SELECT 1' },
          credentials: { postgresApi: { id: 'cred-123', name: 'My Postgres' } },
        },
        {
          id: 'node-2', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4, position: [300, 100],
          parameters: { url: 'https://example.com' },
          credentials: { httpBasicAuth: { id: 'cred-456', name: 'Basic Auth' } },
        },
        {
          id: 'node-3', name: 'Set', type: 'n8n-nodes-base.set',
          typeVersion: 3, position: [500, 100], parameters: {},
        },
      ]);

      await handlers.handleUpdateWorkflow(
        {
          id: 'wf-1',
          nodes: [
            {
              id: 'node-1', name: 'Postgres', type: 'n8n-nodes-base.postgres',
              typeVersion: 2, position: [100, 100],
              parameters: { operation: 'executeQuery', query: 'SELECT * FROM users' },
            },
            {
              id: 'node-2', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest',
              typeVersion: 4, position: [300, 100],
              parameters: { url: 'https://example.com/v2' },
            },
            {
              id: 'node-3', name: 'Set', type: 'n8n-nodes-base.set',
              typeVersion: 3, position: [500, 100], parameters: { mode: 'manual' },
            },
          ],
          connections: {},
        },
        mockRepository,
      );

      const sentNodes = getSentNodes();
      expect(sentNodes[0].credentials).toEqual({ postgresApi: { id: 'cred-123', name: 'My Postgres' } });
      expect(sentNodes[1].credentials).toEqual({ httpBasicAuth: { id: 'cred-456', name: 'Basic Auth' } });
      expect(sentNodes[2].credentials).toBeUndefined();
    });

    it('should not overwrite user-provided credentials', async () => {
      mockCurrentWorkflow([
        {
          id: 'node-1', name: 'Postgres', type: 'n8n-nodes-base.postgres',
          typeVersion: 2, position: [100, 100], parameters: {},
          credentials: { postgresApi: { id: 'cred-old', name: 'Old Postgres' } },
        },
      ]);

      await handlers.handleUpdateWorkflow(
        {
          id: 'wf-1',
          nodes: [
            {
              id: 'node-1', name: 'Postgres', type: 'n8n-nodes-base.postgres',
              typeVersion: 2, position: [100, 100], parameters: {},
              credentials: { postgresApi: { id: 'cred-new', name: 'New Postgres' } },
            },
          ],
          connections: {},
        },
        mockRepository,
      );

      const sentNodes = getSentNodes();
      expect(sentNodes[0].credentials).toEqual({ postgresApi: { id: 'cred-new', name: 'New Postgres' } });
    });

    it('should match nodes by name when ids differ', async () => {
      mockCurrentWorkflow([
        {
          id: 'server-id-1', name: 'Gmail', type: 'n8n-nodes-base.gmail',
          typeVersion: 2, position: [100, 100], parameters: {},
          credentials: { gmailOAuth2: { id: 'cred-gmail', name: 'Gmail' } },
        },
      ]);

      await handlers.handleUpdateWorkflow(
        {
          id: 'wf-1',
          nodes: [
            {
              id: 'client-id-different', name: 'Gmail', type: 'n8n-nodes-base.gmail',
              typeVersion: 2, position: [100, 100],
              parameters: { resource: 'message' },
            },
          ],
          connections: {},
        },
        mockRepository,
      );

      const sentNodes = getSentNodes();
      expect(sentNodes[0].credentials).toEqual({ gmailOAuth2: { id: 'cred-gmail', name: 'Gmail' } });
    });

    it('should treat empty credentials object as missing and carry forward', async () => {
      mockCurrentWorkflow([
        { id: 'node-1', name: 'Postgres', type: 'n8n-nodes-base.postgres', typeVersion: 2, position: [100, 100], parameters: {}, credentials: { postgresApi: { id: 'cred-123', name: 'My Postgres' } } },
      ]);

      await handlers.handleUpdateWorkflow(
        {
          id: 'wf-1',
          nodes: [
            { id: 'node-1', name: 'Postgres', type: 'n8n-nodes-base.postgres', typeVersion: 2, position: [100, 100], parameters: {}, credentials: {} },
          ],
          connections: {},
        },
        mockRepository,
      );

      const sentNodes = getSentNodes();
      expect(sentNodes[0].credentials).toEqual({ postgresApi: { id: 'cred-123', name: 'My Postgres' } });
    });
  });
});