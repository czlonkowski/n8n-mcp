/**
 * Integration Tests: handleGetWorkflow
 *
 * Tests workflow retrieval against a real n8n instance.
 * Covers successful retrieval and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { Workflow } from '../../../../src/types/n8n-api';
import { SIMPLE_WEBHOOK_WORKFLOW } from '../utils/fixtures';
import { cleanupOrphanedWorkflows } from '../utils/cleanup-helpers';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleGetWorkflow } from '../../../../src/mcp/handlers-n8n-manager';

describe('Integration: handleGetWorkflow', () => {
  let context: TestContext;
  let client: N8nApiClient;
  let mcpContext: InstanceContext;

  beforeEach(() => {
    context = createTestContext();
    client = getTestN8nClient();
    mcpContext = createMcpContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  afterAll(async () => {
    if (!process.env.CI) {
      await cleanupOrphanedWorkflows();
    }
  });

  // ======================================================================
  // Successful Retrieval
  // ======================================================================

  describe('Successful Retrieval', () => {
    it('should retrieve complete workflow data', async () => {
      // Create a workflow first
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Get Workflow - Complete Data'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created).toBeDefined();
      expect(created.id).toBeTruthy();

      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Retrieve the workflow using MCP handler
      const response = await handleGetWorkflow({ id: created.id }, mcpContext);

      // Verify MCP response structure
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const retrieved = response.data as Workflow;

      // Verify all expected fields are present
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe(workflow.name);
      expect(retrieved.nodes).toBeDefined();
      expect(retrieved.nodes).toHaveLength(workflow.nodes!.length);
      expect(retrieved.connections).toBeDefined();
      expect(retrieved.active).toBeDefined();
      expect(retrieved.createdAt).toBeDefined();
      expect(retrieved.updatedAt).toBeDefined();

      // Verify node data integrity
      const retrievedNode = retrieved.nodes[0];
      const originalNode = workflow.nodes![0];
      expect(retrievedNode.name).toBe(originalNode.name);
      expect(retrievedNode.type).toBe(originalNode.type);
      expect(retrievedNode.parameters).toBeDefined();

      // Issue #777: the heavy activeVersion payload must not be returned to the caller.
      // activeVersionId is kept so callers know whether a published version exists.
      expect((retrieved as unknown as { activeVersion?: unknown }).activeVersion).toBeUndefined();
    });
  });

  // ======================================================================
  // Error Handling
  // ======================================================================

  describe('Error Handling', () => {
    it('should return error for non-existent workflow (invalid ID)', async () => {
      const invalidId = '99999999';

      const response = await handleGetWorkflow({ id: invalidId }, mcpContext);

      // MCP handlers return success: false on error
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should return error for malformed workflow ID', async () => {
      const malformedId = 'not-a-valid-id-format';

      const response = await handleGetWorkflow({ id: malformedId }, mcpContext);

      // MCP handlers return success: false on error
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });
});
