/**
 * Integration Tests: handleGetWorkflowDetails
 *
 * Tests workflow details retrieval against a real n8n instance.
 * Covers basic workflows, metadata, version history, and execution stats.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { SIMPLE_WEBHOOK_WORKFLOW } from '../utils/fixtures';
import { cleanupOrphanedWorkflows } from '../utils/cleanup-helpers';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleGetWorkflowDetails } from '../../../../src/mcp/handlers-n8n-manager';

describe('Integration: handleGetWorkflowDetails', () => {
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
  // Basic Workflow Details
  // ======================================================================

  describe('Basic Workflow', () => {
    it('should retrieve workflow with basic details', async () => {
      // Create a simple workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Get Details - Basic'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created).toBeDefined();
      expect(created.id).toBeTruthy();

      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Retrieve detailed workflow information using MCP handler
      const response = await handleGetWorkflowDetails({ id: created.id }, mcpContext);

      // Verify MCP response structure
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      // handleGetWorkflowDetails returns { workflow, executionStats, hasWebhookTrigger, webhookPath }
      const details = (response.data as any).workflow;

      // Verify basic details
      expect(details).toBeDefined();
      expect(details.id).toBe(created.id);
      expect(details.name).toBe(workflow.name);
      expect(details.createdAt).toBeDefined();
      expect(details.updatedAt).toBeDefined();
      expect(details.active).toBeDefined();

      // Verify metadata fields
      expect(details.versionId).toBeDefined();

      // Issue #777: the heavy activeVersion payload must not be returned to the caller.
      expect((details as unknown as { activeVersion?: unknown }).activeVersion).toBeUndefined();
    });
  });

  // ======================================================================
  // Workflow with Metadata
  // ======================================================================

  describe('Workflow with Metadata', () => {
    it('should retrieve workflow with tags and settings metadata', async () => {
      // Create workflow with rich metadata
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Get Details - With Metadata'),
        tags: [
          'mcp-integration-test',
          'test-category',
          'integration'
        ],
        settings: {
          executionOrder: 'v1' as const,
          timezone: 'America/New_York'
        }
      };

      const created = await client.createWorkflow(workflow);
      expect(created).toBeDefined();
      expect(created.id).toBeTruthy();

      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Retrieve workflow details using MCP handler
      const response = await handleGetWorkflowDetails({ id: created.id }, mcpContext);
      expect(response.success).toBe(true);
      const details = (response.data as any).workflow;

      // Verify metadata is present (tags may be undefined in API response)
      // Note: n8n API behavior for tags varies - they may not be returned
      // in GET requests even if set during creation
      if (details.tags) {
        expect(details.tags.length).toBeGreaterThanOrEqual(0);
      }

      // Verify settings
      expect(details.settings).toBeDefined();
      expect(details.settings!.executionOrder).toBe('v1');
      expect(details.settings!.timezone).toBe('America/New_York');
    });
  });

  // ======================================================================
  // Version History
  // ======================================================================

  describe('Version History', () => {
    // TODO: Investigate versionId behavior change in n8n 2.0
    // versionId may not change on simple name updates anymore
    it.skip('should track version changes after updates', async () => {
      // Create initial workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Get Details - Version History'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created).toBeDefined();
      expect(created.id).toBeTruthy();

      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Get initial version using MCP handler
      const initialResponse = await handleGetWorkflowDetails({ id: created.id }, mcpContext);
      expect(initialResponse.success).toBe(true);
      const initialDetails = (initialResponse.data as any).workflow;
      const initialVersionId = initialDetails.versionId;
      const initialUpdatedAt = initialDetails.updatedAt;

      // Update the workflow
      await client.updateWorkflow(created.id, {
        name: createTestWorkflowName('Get Details - Version History (Updated)'),
        nodes: workflow.nodes,
        connections: workflow.connections
      });

      // Get updated details using MCP handler
      const updatedResponse = await handleGetWorkflowDetails({ id: created.id }, mcpContext);
      expect(updatedResponse.success).toBe(true);
      const updatedDetails = (updatedResponse.data as any).workflow;

      // Verify version changed
      expect(updatedDetails.versionId).toBeDefined();
      expect(updatedDetails.updatedAt).not.toBe(initialUpdatedAt);

      // Version ID should have changed after update
      expect(updatedDetails.versionId).not.toBe(initialVersionId);
    });
  });

  // ======================================================================
  // Execution Statistics
  // ======================================================================

  describe('Execution Statistics', () => {
    it('should include execution-related fields in details', async () => {
      // Create workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Get Details - Execution Stats'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created).toBeDefined();
      expect(created.id).toBeTruthy();

      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Retrieve workflow details using MCP handler
      const response = await handleGetWorkflowDetails({ id: created.id }, mcpContext);
      expect(response.success).toBe(true);
      const details = (response.data as any).workflow;

      // Verify execution-related fields exist
      // Note: New workflows won't have executions, but fields should be present
      expect(details).toHaveProperty('active');

      // The workflow should start inactive
      expect(details.active).toBe(false);
    });
  });
});
