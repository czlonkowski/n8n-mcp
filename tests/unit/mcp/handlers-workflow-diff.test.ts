import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUpdatePartialWorkflow } from '@/mcp/handlers-workflow-diff';
import { WorkflowDiffEngine } from '@/services/workflow-diff-engine';
import { N8nApiClient } from '@/services/n8n-api-client';
import {
  N8nApiError,
  N8nAuthenticationError,
  N8nNotFoundError,
  N8nValidationError,
  N8nRateLimitError,
  N8nServerError,
} from '@/utils/n8n-errors';
import { z } from 'zod';

// Mock dependencies
vi.mock('@/services/workflow-diff-engine');
vi.mock('@/services/n8n-api-client');
vi.mock('@/config/n8n-api');
vi.mock('@/utils/logger');
vi.mock('@/mcp/handlers-n8n-manager', () => ({
  getN8nApiClient: vi.fn(),
}));

// Import mocked modules
import { getN8nApiClient } from '@/mcp/handlers-n8n-manager';
import { logger } from '@/utils/logger';
import type { NodeRepository } from '@/database/node-repository';

describe('handlers-workflow-diff', () => {
  let mockApiClient: any;
  let mockDiffEngine: any;
  let mockRepository: NodeRepository;

  // Helper function to create test workflow
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
      {
        id: 'node2',
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 3,
        position: [300, 100],
        parameters: { url: 'https://api.test.com' },
      },
    ],
    connections: {
      'Start': {
        main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]],
      },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tags: [],
    settings: {},
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock API client
    mockApiClient = {
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      listTags: vi.fn().mockResolvedValue({ data: [] }),
      createTag: vi.fn(),
      updateWorkflowTags: vi.fn().mockResolvedValue([]),
      transferWorkflow: vi.fn().mockResolvedValue(undefined),
    };

    // Setup mock diff engine
    mockDiffEngine = {
      applyDiff: vi.fn(),
    };

    // Setup mock repository
    mockRepository = {} as NodeRepository;

    // Mock the API client getter
    vi.mocked(getN8nApiClient).mockReturnValue(mockApiClient);

    // Mock WorkflowDiffEngine constructor
    vi.mocked(WorkflowDiffEngine).mockImplementation(() => mockDiffEngine);

    // Set up default environment
    process.env.DEBUG_MCP = 'false';
  });

  describe('handleUpdatePartialWorkflow', () => {
    it('should apply diff operations successfully', async () => {
      const testWorkflow = createTestWorkflow();
      const updatedWorkflow = {
        ...testWorkflow,
        nodes: [
          ...testWorkflow.nodes,
          {
            id: 'node3',
            name: 'New Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [500, 100],
            parameters: {},
          },
        ],
        connections: {
          ...testWorkflow.connections,
          'HTTP Request': {
            main: [[{ node: 'New Node', type: 'main', index: 0 }]],
          },
        },
      };

      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          {
            type: 'addNode',
            node: {
              id: 'node3',
              name: 'New Node',
              type: 'n8n-nodes-base.set',
              typeVersion: 1,
              position: [500, 100],
              parameters: {},
            },
          },
        ],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: updatedWorkflow,
        operationsApplied: 1,
        message: 'Successfully applied 1 operation',
        errors: [],
        applied: [0],
        failed: [],
      });
      mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result).toEqual({
        success: true,
        saved: true,
        data: {
          id: 'test-workflow-id',
          name: 'Test Workflow',
          active: true,
          nodeCount: 3,
          operationsApplied: 1,
        },
        message: 'Workflow "Test Workflow" updated successfully. Applied 1 operations. Use n8n_get_workflow with mode \'structure\' to verify current state.',
        details: {
          applied: [0],
          failed: [],
          errors: [],
          warnings: undefined,
        },
      });

      expect(mockApiClient.getWorkflow).toHaveBeenCalledWith('test-workflow-id');
      expect(mockDiffEngine.applyDiff).toHaveBeenCalledWith(testWorkflow, diffRequest);
      expect(mockApiClient.updateWorkflow).toHaveBeenCalledWith('test-workflow-id', updatedWorkflow);
    });

    it('should handle validation-only mode', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          {
            type: 'updateNode',
            nodeId: 'node2',
            updates: { name: 'Updated HTTP Request' },
          },
        ],
        validateOnly: true,
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: testWorkflow,
        operationsApplied: 1,
        message: 'Validation successful',
        errors: [],
        warnings: []
      });

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result).toEqual({
        success: true,
        message: 'Validation successful',
        data: {
          valid: true,
          operationsToApply: 1,
        },
        details: {
          warnings: []
        }
      });

      expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
    });

    it('should handle multiple operations', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          {
            type: 'updateNode',
            nodeId: 'node1',
            updates: { name: 'Updated Start' },
          },
          {
            type: 'addNode',
            node: {
              id: 'node3',
              name: 'Set Node',
              type: 'n8n-nodes-base.set',
              typeVersion: 1,
              position: [500, 100],
              parameters: {},
            },
          },
          {
            type: 'addConnection',
            source: 'node2',
            target: 'node3',
            sourceOutput: 'main',
            targetInput: 'main',
          },
        ],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: {
          ...testWorkflow,
          nodes: [
            { ...testWorkflow.nodes[0], name: 'Updated Start' },
            testWorkflow.nodes[1],
            {
              id: 'node3',
              name: 'Set Node',
              type: 'n8n-nodes-base.set',
              typeVersion: 1,
              position: [500, 100],
              parameters: {},
            }
          ],
          connections: {
            'Updated Start': testWorkflow.connections['Start'],
            'HTTP Request': {
              main: [[{ node: 'Set Node', type: 'main', index: 0 }]],
            },
          },
        },
        operationsApplied: 3,
        message: 'Successfully applied 3 operations',
        errors: [],
        applied: [0, 1, 2],
        failed: [],
      });
      mockApiClient.updateWorkflow.mockResolvedValue({ ...testWorkflow });

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Applied 3 operations');
    });

    it('should handle diff application failures', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          {
            type: 'updateNode',
            nodeId: 'non-existent-node',
            updates: { name: 'Updated' },
          },
        ],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: false,
        workflow: null,
        operationsApplied: 0,
        message: 'Failed to apply operations',
        errors: ['Node "non-existent-node" not found'],
        applied: [],
        failed: [0],
      });

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result).toEqual({
        success: false,
        saved: false,
        operationsApplied: 0,
        error: 'Failed to apply diff operations',
        details: {
          errors: ['Node "non-existent-node" not found'],
          warnings: undefined,
          applied: [],
          failed: [0],
        },
      });

      expect(mockApiClient.updateWorkflow).not.toHaveBeenCalled();
    });

    it('should handle API not configured error', async () => {
      vi.mocked(getN8nApiClient).mockReturnValue(null);

      const result = await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.',
      });
    });

    it('should handle workflow not found error', async () => {
      const notFoundError = new N8nNotFoundError('Workflow', 'non-existent');
      mockApiClient.getWorkflow.mockRejectedValue(notFoundError);

      const result = await handleUpdatePartialWorkflow({
        id: 'non-existent',
        operations: [],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'Workflow with ID non-existent not found',
        code: 'NOT_FOUND',
      });
    });

    it('should handle API errors during update', async () => {
      const testWorkflow = createTestWorkflow();
      const validationError = new N8nValidationError('Invalid workflow structure', {
        field: 'connections',
        message: 'Invalid connection configuration',
      });

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: testWorkflow,
        operationsApplied: 1,
        message: 'Success',
        errors: [],
      });
      mockApiClient.updateWorkflow.mockRejectedValue(validationError);

      const result = await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [{ type: 'updateNode', nodeId: 'node1', updates: {} }],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'Invalid request: Invalid workflow structure',
        code: 'VALIDATION_ERROR',
        details: {
          field: 'connections',
          message: 'Invalid connection configuration',
        },
      });
    });

    it('should handle input validation errors', async () => {
      const invalidInput = {
        id: 'test-id',
        operations: [
          {
            // Missing required 'type' field
            nodeId: 'node1',
            updates: {},
          },
        ],
      };

      const result = await handleUpdatePartialWorkflow(invalidInput, mockRepository);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
      expect(result.details?.errors).toBeInstanceOf(Array);
    });

    it('should handle complex operation types', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          {
            type: 'moveNode',
            nodeId: 'node2',
            position: [400, 200],
          },
          {
            type: 'removeConnection',
            source: 'node1',
            target: 'node2',
            sourceOutput: 'main',
            targetInput: 'main',
          },
          {
            type: 'updateSettings',
            settings: {
              executionOrder: 'v1',
              timezone: 'America/New_York',
            },
          },
          {
            type: 'addTag',
            tag: 'automated',
          },
        ],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: { ...testWorkflow, settings: { executionOrder: 'v1' } },
        operationsApplied: 4,
        message: 'Successfully applied 4 operations',
        errors: [],
      });
      mockApiClient.updateWorkflow.mockResolvedValue({ ...testWorkflow });

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result.success).toBe(true);
      expect(mockDiffEngine.applyDiff).toHaveBeenCalledWith(testWorkflow, diffRequest);
    });

    it('should handle debug logging when enabled', async () => {
      process.env.DEBUG_MCP = 'true';
      const testWorkflow = createTestWorkflow();

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: testWorkflow,
        operationsApplied: 1,
        message: 'Success',
        errors: [],
      });
      mockApiClient.updateWorkflow.mockResolvedValue(testWorkflow);

      await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [{ type: 'updateNode', nodeId: 'node1', updates: {} }],
      }, mockRepository);

      expect(logger.debug).toHaveBeenCalledWith(
        'Workflow diff request received',
        expect.objectContaining({
          argsType: 'object',
          operationCount: 1,
        })
      );
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Something went wrong');
      mockApiClient.getWorkflow.mockRejectedValue(genericError);

      const result = await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'Something went wrong',
      });
      expect(logger.error).toHaveBeenCalledWith('Failed to update partial workflow', genericError);
    });

    it('should handle authentication errors', async () => {
      const authError = new N8nAuthenticationError('Invalid API key');
      mockApiClient.getWorkflow.mockRejectedValue(authError);

      const result = await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'Failed to authenticate with n8n. Please check your API key.',
        code: 'AUTHENTICATION_ERROR',
      });
    });

    it('should handle rate limit errors', async () => {
      const rateLimitError = new N8nRateLimitError(60);
      mockApiClient.getWorkflow.mockRejectedValue(rateLimitError);

      const result = await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMIT_ERROR',
      });
    });

    it('should handle server errors', async () => {
      const serverError = new N8nServerError('Internal server error');
      mockApiClient.getWorkflow.mockRejectedValue(serverError);

      const result = await handleUpdatePartialWorkflow({
        id: 'test-id',
        operations: [],
      }, mockRepository);

      expect(result).toEqual({
        success: false,
        error: 'Internal server error',
        code: 'SERVER_ERROR',
      });
    });

    it('should validate operation structure', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          {
            type: 'updateNode',
            nodeId: 'node1',
            nodeName: 'Start', // Both nodeId and nodeName provided
            updates: { name: 'New Start' },
            description: 'Update start node name',
          },
          {
            type: 'addConnection',
            source: 'node1',
            target: 'node2',
            sourceOutput: 'main',
            targetInput: 'main',
            sourceIndex: 0,
            targetIndex: 0,
          },
        ],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: testWorkflow,
        operationsApplied: 2,
        message: 'Success',
        errors: [],
      });
      mockApiClient.updateWorkflow.mockResolvedValue(testWorkflow);

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result.success).toBe(true);
      expect(mockDiffEngine.applyDiff).toHaveBeenCalledWith(testWorkflow, diffRequest);
    });

    it('should handle empty operations array', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: true,
        workflow: testWorkflow,
        operationsApplied: 0,
        message: 'No operations to apply',
        errors: [],
      });
      mockApiClient.updateWorkflow.mockResolvedValue(testWorkflow);

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Applied 0 operations');
    });

    it('should handle partial diff application', async () => {
      const testWorkflow = createTestWorkflow();
      const diffRequest = {
        id: 'test-workflow-id',
        operations: [
          { type: 'updateNode', nodeId: 'node1', updates: { name: 'Updated' } },
          { type: 'updateNode', nodeId: 'invalid-node', updates: { name: 'Fail' } },
          { type: 'addTag', tag: 'test' },
        ],
      };

      mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
      mockDiffEngine.applyDiff.mockResolvedValue({
        success: false,
        workflow: null,
        operationsApplied: 1,
        message: 'Partially applied operations',
        errors: ['Operation 2 failed: Node "invalid-node" not found'],
      });

      const result = await handleUpdatePartialWorkflow(diffRequest, mockRepository);

      expect(result).toEqual({
        success: false,
        saved: false,
        operationsApplied: 1,
        error: 'Failed to apply diff operations',
        details: {
          errors: ['Operation 2 failed: Node "invalid-node" not found'],
          warnings: undefined,
          applied: undefined,
          failed: undefined,
        },
      });
    });

    describe('Workflow Activation/Deactivation', () => {
      it('should activate workflow after successful update', async () => {
        const testWorkflow = createTestWorkflow({ active: false });
        const updatedWorkflow = { ...testWorkflow, active: false };
        const activatedWorkflow = { ...testWorkflow, active: true };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldActivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.activateWorkflow = vi.fn().mockResolvedValue(activatedWorkflow);

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'activateWorkflow' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          id: 'test-workflow-id',
          name: 'Test Workflow',
          active: true,
          nodeCount: 2,
          operationsApplied: 1,
        });
        expect(result.message).toContain('Workflow activated');
        expect((result.data as any).active).toBe(true);
        expect(mockApiClient.activateWorkflow).toHaveBeenCalledWith('test-workflow-id');
      });

      it('should deactivate workflow after successful update', async () => {
        const testWorkflow = createTestWorkflow({ active: true });
        const updatedWorkflow = { ...testWorkflow, active: true };
        const deactivatedWorkflow = { ...testWorkflow, active: false };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldDeactivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.deactivateWorkflow = vi.fn().mockResolvedValue(deactivatedWorkflow);

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'deactivateWorkflow' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          id: 'test-workflow-id',
          name: 'Test Workflow',
          active: false,
          nodeCount: 2,
          operationsApplied: 1,
        });
        expect(result.message).toContain('Workflow deactivated');
        expect((result.data as any).active).toBe(false);
        expect(mockApiClient.deactivateWorkflow).toHaveBeenCalledWith('test-workflow-id');
      });

      it('should handle activation failure after successful update', async () => {
        const testWorkflow = createTestWorkflow({ active: false });
        const updatedWorkflow = { ...testWorkflow, active: false };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldActivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.activateWorkflow = vi.fn().mockRejectedValue(new Error('Activation failed: No trigger nodes'));

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'activateWorkflow' }],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow updated successfully but activation failed');
        expect(result.details).toEqual({
          workflowUpdated: true,
          activationError: 'Activation failed: No trigger nodes',
        });
      });

      it('should handle deactivation failure after successful update', async () => {
        const testWorkflow = createTestWorkflow({ active: true });
        const updatedWorkflow = { ...testWorkflow, active: true };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldDeactivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.deactivateWorkflow = vi.fn().mockRejectedValue(new Error('Deactivation failed'));

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'deactivateWorkflow' }],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow updated successfully but deactivation failed');
        expect(result.details).toEqual({
          workflowUpdated: true,
          deactivationError: 'Deactivation failed',
        });
      });

      it('should update workflow without activation when shouldActivate is false', async () => {
        const testWorkflow = createTestWorkflow({ active: false });
        const updatedWorkflow = { ...testWorkflow, active: false };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldActivate: false,
          shouldDeactivate: false,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.activateWorkflow = vi.fn();
        mockApiClient.deactivateWorkflow = vi.fn();

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'updateName', name: 'Updated' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(result.message).not.toContain('activated');
        expect(result.message).not.toContain('deactivated');
        expect(mockApiClient.activateWorkflow).not.toHaveBeenCalled();
        expect(mockApiClient.deactivateWorkflow).not.toHaveBeenCalled();
      });

      it('should handle non-Error activation failures', async () => {
        const testWorkflow = createTestWorkflow({ active: false });
        const updatedWorkflow = { ...testWorkflow, active: false };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldActivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.activateWorkflow = vi.fn().mockRejectedValue('String error');

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'activateWorkflow' }],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow updated successfully but activation failed');
        expect(result.details).toEqual({
          workflowUpdated: true,
          activationError: 'Unknown error',
        });
      });

      it('should handle non-Error deactivation failures', async () => {
        const testWorkflow = createTestWorkflow({ active: true });
        const updatedWorkflow = { ...testWorkflow, active: true };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          shouldDeactivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.deactivateWorkflow = vi.fn().mockRejectedValue({ code: 'UNKNOWN' });

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'deactivateWorkflow' }],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Workflow updated successfully but deactivation failed');
        expect(result.details).toEqual({
          workflowUpdated: true,
          deactivationError: 'Unknown error',
        });
      });
    });

    describe('Tag Operations via Dedicated API', () => {
      it('should create a new tag and associate it with the workflow', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          tagsToAdd: ['new-tag'],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.listTags.mockResolvedValue({ data: [] });
        mockApiClient.createTag.mockResolvedValue({ id: 'tag-123', name: 'new-tag' });

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'addTag', tag: 'new-tag' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(mockApiClient.createTag).toHaveBeenCalledWith({ name: 'new-tag' });
        expect(mockApiClient.updateWorkflowTags).toHaveBeenCalledWith('test-workflow-id', ['tag-123']);
      });

      it('should use existing tag ID when tag already exists', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          tagsToAdd: ['existing-tag'],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.listTags.mockResolvedValue({ data: [{ id: 'tag-456', name: 'existing-tag' }] });

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'addTag', tag: 'existing-tag' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(mockApiClient.createTag).not.toHaveBeenCalled();
        expect(mockApiClient.updateWorkflowTags).toHaveBeenCalledWith('test-workflow-id', ['tag-456']);
      });

      it('should remove a tag from the workflow', async () => {
        const testWorkflow = createTestWorkflow({
          tags: [{ id: 'tag-789', name: 'old-tag' }],
        });
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          tagsToRemove: ['old-tag'],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.listTags.mockResolvedValue({ data: [{ id: 'tag-789', name: 'old-tag' }] });

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'removeTag', tag: 'old-tag' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(mockApiClient.updateWorkflowTags).toHaveBeenCalledWith('test-workflow-id', []);
      });

      it('should produce warning on tag creation failure without failing the operation', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          tagsToAdd: ['fail-tag'],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.listTags.mockResolvedValue({ data: [] });
        mockApiClient.createTag.mockRejectedValue(new Error('Tag creation failed'));

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'addTag', tag: 'fail-tag' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(result.saved).toBe(true);
        // Tag creation failure should produce a warning, not block the update
        const warnings = (result.details as any)?.warnings;
        expect(warnings).toBeDefined();
        expect(warnings.some((w: any) => w.message.includes('Failed to create tag'))).toBe(true);
      });

      it('should not call tag APIs when no tag operations are present', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'updateName', name: 'New Name' }],
        }, mockRepository);

        expect(mockApiClient.listTags).not.toHaveBeenCalled();
        expect(mockApiClient.createTag).not.toHaveBeenCalled();
        expect(mockApiClient.updateWorkflowTags).not.toHaveBeenCalled();
      });
    });

    describe('Project Transfer via Dedicated API', () => {
      it('should call transferWorkflow when diffResult has transferToProjectId', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          transferToProjectId: 'project-abc-123',
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'transferWorkflow', destinationProjectId: 'project-abc-123' }],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(mockApiClient.transferWorkflow).toHaveBeenCalledWith('test-workflow-id', 'project-abc-123');
        expect(result.message).toContain('transferred to project');
      });

      it('should NOT call transferWorkflow when transferToProjectId is absent', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'updateName', name: 'New Name' }],
        }, mockRepository);

        expect(mockApiClient.transferWorkflow).not.toHaveBeenCalled();
      });

      it('should return success false with saved true when transfer fails', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          transferToProjectId: 'project-bad-id',
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.transferWorkflow.mockRejectedValue(new Error('Project not found'));

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'transferWorkflow', destinationProjectId: 'project-bad-id' }],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.saved).toBe(true);
        expect(result.error).toBe('Workflow updated successfully but project transfer failed');
        expect(result.details).toEqual({
          workflowUpdated: true,
          transferError: 'Project not found',
        });
      });

      it('should return Unknown error when non-Error value is thrown during transfer', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
          transferToProjectId: 'project-unknown',
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.transferWorkflow.mockRejectedValue('string error');

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{ type: 'transferWorkflow', destinationProjectId: 'project-unknown' }],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.saved).toBe(true);
        expect(result.details).toEqual({
          workflowUpdated: true,
          transferError: 'Unknown error',
        });
      });

      it('should call transferWorkflow BEFORE activateWorkflow', async () => {
        const testWorkflow = createTestWorkflow({ active: false });
        const updatedWorkflow = { ...testWorkflow, active: false };
        const activatedWorkflow = { ...testWorkflow, active: true };

        const callOrder: string[] = [];

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 2,
          message: 'Success',
          errors: [],
          transferToProjectId: 'project-target',
          shouldActivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.transferWorkflow.mockImplementation(async () => {
          callOrder.push('transfer');
        });
        mockApiClient.activateWorkflow = vi.fn().mockImplementation(async () => {
          callOrder.push('activate');
          return activatedWorkflow;
        });

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [
            { type: 'transferWorkflow', destinationProjectId: 'project-target' },
            { type: 'activateWorkflow' },
          ],
        }, mockRepository);

        expect(result.success).toBe(true);
        expect(mockApiClient.transferWorkflow).toHaveBeenCalledWith('test-workflow-id', 'project-target');
        expect(mockApiClient.activateWorkflow).toHaveBeenCalledWith('test-workflow-id');
        expect(callOrder).toEqual(['transfer', 'activate']);
      });

      it('should skip activation when transfer fails', async () => {
        const testWorkflow = createTestWorkflow({ active: false });
        const updatedWorkflow = { ...testWorkflow, active: false };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 2,
          message: 'Success',
          errors: [],
          transferToProjectId: 'project-fail',
          shouldActivate: true,
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);
        mockApiClient.transferWorkflow.mockRejectedValue(new Error('Transfer denied'));
        mockApiClient.activateWorkflow = vi.fn();

        const result = await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [
            { type: 'transferWorkflow', destinationProjectId: 'project-fail' },
            { type: 'activateWorkflow' },
          ],
        }, mockRepository);

        expect(result.success).toBe(false);
        expect(result.saved).toBe(true);
        expect(result.error).toBe('Workflow updated successfully but project transfer failed');
        expect(mockApiClient.activateWorkflow).not.toHaveBeenCalled();
      });
    });

    describe('field name normalization', () => {
      it('should normalize "name" to "nodeName" for updateNode operations', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{
            type: 'updateNode',
            name: 'HTTP Request',  // LLMs often use "name" instead of "nodeName"
            updates: { 'parameters.url': 'https://new-url.com' },
          }],
        }, mockRepository);

        // Verify the diff engine received nodeName (normalized from name)
        expect(mockDiffEngine.applyDiff).toHaveBeenCalled();
        const diffArgs = mockDiffEngine.applyDiff.mock.calls[0][1];
        expect(diffArgs.operations[0].nodeName).toBe('HTTP Request');
      });

      it('should normalize "id" to "nodeId" for removeNode operations', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{
            type: 'removeNode',
            id: 'node2',  // LLMs may use "id" instead of "nodeId"
          }],
        }, mockRepository);

        // Verify the diff engine received nodeId (normalized from id)
        expect(mockDiffEngine.applyDiff).toHaveBeenCalled();
        const diffArgs = mockDiffEngine.applyDiff.mock.calls[0][1];
        expect(diffArgs.operations[0].nodeId).toBe('node2');
      });

      it('should NOT normalize "name" for updateName operations', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{
            type: 'updateName',
            name: 'New Workflow Name',  // This is the correct field for updateName
          }],
        }, mockRepository);

        // Verify "name" stays as "name" (not moved to nodeName) for updateName
        expect(mockDiffEngine.applyDiff).toHaveBeenCalled();
        const diffArgs = mockDiffEngine.applyDiff.mock.calls[0][1];
        expect(diffArgs.operations[0].name).toBe('New Workflow Name');
        expect(diffArgs.operations[0].nodeName).toBeUndefined();
      });

      it('should prefer explicit "nodeName" over "name" alias', async () => {
        const testWorkflow = createTestWorkflow();
        const updatedWorkflow = { ...testWorkflow };

        mockApiClient.getWorkflow.mockResolvedValue(testWorkflow);
        mockDiffEngine.applyDiff.mockResolvedValue({
          success: true,
          workflow: updatedWorkflow,
          operationsApplied: 1,
          message: 'Success',
          errors: [],
        });
        mockApiClient.updateWorkflow.mockResolvedValue(updatedWorkflow);

        await handleUpdatePartialWorkflow({
          id: 'test-workflow-id',
          operations: [{
            type: 'updateNode',
            nodeName: 'HTTP Request',  // Explicit nodeName provided
            name: 'Should Be Ignored',  // Should NOT override nodeName
            updates: { 'parameters.url': 'https://new-url.com' },
          }],
        }, mockRepository);

        expect(mockDiffEngine.applyDiff).toHaveBeenCalled();
        const diffArgs = mockDiffEngine.applyDiff.mock.calls[0][1];
        expect(diffArgs.operations[0].nodeName).toBe('HTTP Request');
      });
    });
  });
});
