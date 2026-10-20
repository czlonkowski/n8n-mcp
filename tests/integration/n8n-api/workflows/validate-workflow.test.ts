/**
 * Integration Tests: handleValidateWorkflow
 *
 * Tests workflow validation against a real n8n instance.
 * Covers validation profiles, validation types, and error detection.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { SIMPLE_WEBHOOK_WORKFLOW } from '../utils/fixtures';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleValidateWorkflow } from '../../../../src/mcp/handlers-n8n-manager';
import { getNodeRepository, closeNodeRepository } from '../utils/node-repository';
import { NodeRepository } from '../../../../src/database/node-repository';
import { ValidationResponse } from '../types/mcp-responses';

describe('Integration: handleValidateWorkflow', () => {
  let context: TestContext;
  let client: N8nApiClient;
  let mcpContext: InstanceContext;
  let repository: NodeRepository;

  beforeEach(async () => {
    context = createTestContext();
    client = getTestN8nClient();
    mcpContext = createMcpContext();
    repository = await getNodeRepository();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  afterAll(async () => {
    await closeNodeRepository();
  });

  // ======================================================================
  // Valid Workflow - All Profiles
  // ======================================================================

  describe('Valid Workflow', () => {
    it('should validate valid workflow with default profile (runtime)', async () => {
      // Create valid workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Valid Default'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      // Validate with default profile
      const response = await handleValidateWorkflow(
        { id: created.id },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as ValidationResponse;

      // Verify response structure
      expect(data.valid).toBe(true);
      expect(data.errors).toBeUndefined(); // Only present if errors exist
      expect(data.summary).toBeDefined();
      expect(data.summary.errorCount).toBe(0);
    });

    it('should validate with strict profile', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Valid Strict'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: { profile: 'strict' }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;
      expect(data.valid).toBe(true);
    });

    it('should validate with ai-friendly profile', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Valid AI Friendly'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: { profile: 'ai-friendly' }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;
      expect(data.valid).toBe(true);
    });

    it('should validate with minimal profile', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Valid Minimal'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: { profile: 'minimal' }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;
      expect(data.valid).toBe(true);
    });
  });

  // ======================================================================
  // Invalid Workflow - Error Detection
  // ======================================================================

  describe('Invalid Workflow Detection', () => {
    it('should detect invalid node type', async () => {
      // Create workflow with invalid node type
      const workflow = {
        name: createTestWorkflowName('Validate - Invalid Node Type'),
        nodes: [
          {
            id: 'invalid-1',
            name: 'Invalid Node',
            type: 'invalid-node-type',
            typeVersion: 1,
            position: [250, 300] as [number, number],
            parameters: {}
          }
        ],
        connections: {},
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        { id: created.id },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Should detect error
      expect(data.valid).toBe(false);
      expect(data.errors).toBeDefined();
      expect(data.errors.length).toBeGreaterThan(0);
      expect(data.summary.errorCount).toBeGreaterThan(0);

      // Error should mention invalid node type
      const errorMessages = data.errors.map((e: any) => e.message).join(' ');
      expect(errorMessages).toMatch(/invalid-node-type|not found|unknown/i);
    });

    it('should detect missing required connections', async () => {
      // Create workflow with 2 nodes but no connections
      const workflow = {
        name: createTestWorkflowName('Validate - Missing Connections'),
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              httpMethod: 'GET',
              path: 'test'
            }
          },
          {
            id: 'set-1',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300] as [number, number],
            parameters: {
              assignments: {
                assignments: []
              }
            }
          }
        ],
        connections: {}, // Empty connections - Set node is unreachable
        settings: {},
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        { id: created.id },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Multi-node workflow with empty connections should produce warning/error
      // (depending on validation profile)
      expect(data.valid).toBe(false);
    });
  });

  // ======================================================================
  // Selective Validation
  // ======================================================================

  describe('Selective Validation', () => {
    it('should validate nodes only (skip connections)', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Nodes Only'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: {
            validateNodes: true,
            validateConnections: false,
            validateExpressions: false
          }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;
      expect(data.valid).toBe(true);
    });

    it('should validate connections only (skip nodes)', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Connections Only'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: {
            validateNodes: false,
            validateConnections: true,
            validateExpressions: false
          }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;
      expect(data.valid).toBe(true);
    });

    it('should validate expressions only', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Expressions Only'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: {
            validateNodes: false,
            validateConnections: false,
            validateExpressions: true
          }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      // Expression validation may pass even if workflow has other issues
      expect(response.data).toBeDefined();
    });
  });

  // ======================================================================
  // Error Handling
  // ======================================================================

  describe('Error Handling', () => {
    it('should handle non-existent workflow ID', async () => {
      const response = await handleValidateWorkflow(
        { id: '99999999' },
        repository,
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should handle invalid profile parameter', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Invalid Profile'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        {
          id: created.id,
          options: { profile: 'invalid-profile' as any }
        },
        repository,
        mcpContext
      );

      // Should either fail validation or use default profile
      expect(response.success).toBe(false);
    });
  });

  // ======================================================================
  // Response Format Verification
  // ======================================================================

  describe('Response Format', () => {
    it('should return complete validation response structure', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Validate - Response Format'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      context.trackWorkflow(created.id!);

      const response = await handleValidateWorkflow(
        { id: created.id },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      const data = response.data as any;

      // Verify required fields
      expect(data).toHaveProperty('workflowId');
      expect(data).toHaveProperty('workflowName');
      expect(data).toHaveProperty('valid');
      expect(data).toHaveProperty('summary');

      // errors and warnings only present if they exist
      // For valid workflow, they should be undefined
      if (data.errors) {
        expect(Array.isArray(data.errors)).toBe(true);
      }
      if (data.warnings) {
        expect(Array.isArray(data.warnings)).toBe(true);
      }

      // Verify summary structure
      expect(data.summary).toHaveProperty('errorCount');
      expect(data.summary).toHaveProperty('warningCount');
      expect(data.summary).toHaveProperty('totalNodes');
      expect(data.summary).toHaveProperty('enabledNodes');
      expect(data.summary).toHaveProperty('triggerNodes');

      // Verify types
      expect(typeof data.valid).toBe('boolean');
      expect(typeof data.summary.errorCount).toBe('number');
      expect(typeof data.summary.warningCount).toBe('number');
    });
  });
});
