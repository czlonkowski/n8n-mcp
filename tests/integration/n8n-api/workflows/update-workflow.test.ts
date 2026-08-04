/**
 * Integration Tests: handleUpdateWorkflow
 *
 * Tests full workflow updates against a real n8n instance.
 * Covers various update scenarios including nodes, connections, settings, and tags.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { SIMPLE_WEBHOOK_WORKFLOW, SIMPLE_HTTP_WORKFLOW } from '../utils/fixtures';
import { cleanupOrphanedWorkflows } from '../utils/cleanup-helpers';
import { createMcpContext, getMcpRepository } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { NodeRepository } from '../../../../src/database/node-repository';
import { handleUpdateWorkflow } from '../../../../src/mcp/handlers-n8n-manager';

describe('Integration: handleUpdateWorkflow', () => {
  let context: TestContext;
  let client: N8nApiClient;
  let mcpContext: InstanceContext;
  let repository: NodeRepository;

  beforeEach(async () => {
    context = createTestContext();
    client = getTestN8nClient();
    mcpContext = createMcpContext();
    repository = await getMcpRepository();
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
  // Full Workflow Replacement
  // ======================================================================

  describe('Full Workflow Replacement', () => {
    it('should replace entire workflow with new nodes and connections', async () => {
      // Create initial simple workflow
      const initialWorkflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Full Replacement'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(initialWorkflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Replace with HTTP workflow (completely different structure)
      const replacement = {
        ...SIMPLE_HTTP_WORKFLOW,
        name: createTestWorkflowName('Update - Full Replacement (Updated)')
      };

      // Update using MCP handler
      const response = await handleUpdateWorkflow(
        {
          id: created.id,
          name: replacement.name,
          nodes: replacement.nodes,
          connections: replacement.connections
        },
        repository,
        mcpContext
      );

      // Verify MCP response - now returns minimal data
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();

      const updated = response.data as any;
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(replacement.name);
      expect(updated.nodeCount).toBe(2); // HTTP workflow has 2 nodes

      // Fetch actual workflow to verify
      const actual = await client.getWorkflow(created.id);
      expect(actual.nodes).toHaveLength(2);
    });
  });

  // ======================================================================
  // Update Nodes
  // ======================================================================

  describe('Update Nodes', () => {
    it('should update workflow nodes while preserving other properties', async () => {
      // Create workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Nodes Only'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Update nodes - add a second node
      const updatedNodes = [
        ...workflow.nodes!,
        {
          id: 'set-1',
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 3.4,
          position: [450, 300] as [number, number],
          parameters: {
            assignments: {
              assignments: [
                {
                  id: 'assign-1',
                  name: 'test',
                  value: 'value',
                  type: 'string'
                }
              ]
            }
          }
        }
      ];

      const updatedConnections = {
        Webhook: {
          main: [[{ node: 'Set', type: 'main' as const, index: 0 }]]
        }
      };

      // Update using MCP handler (n8n API requires name, nodes, connections)
      const response = await handleUpdateWorkflow(
        {
          id: created.id,
          name: workflow.name,  // Required by n8n API
          nodes: updatedNodes,
          connections: updatedConnections
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      // Response now returns minimal data
      const updated = response.data as any;
      expect(updated.nodeCount).toBe(2);

      // Fetch actual workflow to verify
      const actual = await client.getWorkflow(created.id);
      expect(actual.nodes).toHaveLength(2);
      expect(actual.nodes.find((n: any) => n.name === 'Set')).toBeDefined();
    });
  });

  // ======================================================================
  // Update Settings
  // ======================================================================
  // Note: "Update Connections" test removed - empty connections invalid for multi-node workflows
  // Connection modifications are tested in update-partial-workflow.test.ts

  describe('Update Settings', () => {
    it('should update workflow settings without affecting nodes', async () => {
      // Create workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Settings'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Fetch current workflow (n8n API requires name, nodes, connections)
      const current = await client.getWorkflow(created.id);

      // Update settings
      const response = await handleUpdateWorkflow(
        {
          id: created.id,
          name: current.name,        // Required by n8n API
          nodes: current.nodes,      // Required by n8n API
          connections: current.connections,  // Required by n8n API
          settings: {
            executionOrder: 'v1' as const,
            timezone: 'Europe/London'
          }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      // Response now returns minimal data
      const updated = response.data as any;
      expect(updated.nodeCount).toBe(1); // Nodes unchanged

      // Fetch actual workflow to verify
      const actual = await client.getWorkflow(created.id);
      expect(actual.nodes).toHaveLength(1);
    });
  });


  // ======================================================================
  // Validation Errors
  // ======================================================================

  describe('Validation Errors', () => {
    it('should return error for invalid node types', async () => {
      // Create workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Invalid Node Type'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Try to update with invalid node type
      const response = await handleUpdateWorkflow(
        {
          id: created.id,
          nodes: [
            {
              id: 'invalid-1',
              name: 'Invalid',
              type: 'invalid-node-type',
              typeVersion: 1,
              position: [250, 300],
              parameters: {}
            }
          ],
          connections: {}
        },
        repository,
        mcpContext
      );

      // Validation should fail
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should return error for non-existent workflow ID', async () => {
      const response = await handleUpdateWorkflow(
        {
          id: '99999999',
          name: 'Should Fail'
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  // ======================================================================
  // Update Name Only
  // ======================================================================

  describe('Update Name', () => {
    it('should update workflow name without affecting structure', async () => {
      // Create workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Name Original'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const newName = createTestWorkflowName('Update - Name Modified');

      // Fetch current workflow to get required fields
      const current = await client.getWorkflow(created.id);

      // Update name (n8n API requires nodes and connections too)
      const response = await handleUpdateWorkflow(
        {
          id: created.id,
          name: newName,
          nodes: current.nodes,         // Required by n8n API
          connections: current.connections  // Required by n8n API
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      // Response now returns minimal data
      const updated = response.data as any;
      expect(updated.name).toBe(newName);
      expect(updated.nodeCount).toBe(1); // Structure unchanged

      // Fetch actual workflow to verify
      const actual = await client.getWorkflow(created.id);
      expect(actual.nodes).toHaveLength(1);
    });
  });

  // ======================================================================
  // Multiple Properties Update
  // ======================================================================

  describe('Multiple Properties', () => {
    it('should update name and settings together', async () => {
      // Create workflow
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Multiple Props'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const newName = createTestWorkflowName('Update - Multiple Props (Modified)');

      // Fetch current workflow (n8n API requires nodes and connections)
      const current = await client.getWorkflow(created.id);

      // Update multiple properties
      const response = await handleUpdateWorkflow(
        {
          id: created.id,
          name: newName,
          nodes: current.nodes,             // Required by n8n API
          connections: current.connections, // Required by n8n API
          settings: {
            executionOrder: 'v1' as const,
            timezone: 'America/New_York'
          }
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      // Response now returns minimal data
      const updated = response.data as any;
      expect(updated.name).toBe(newName);

      // Fetch actual workflow to verify settings
      const actual = await client.getWorkflow(created.id);
      expect(actual.settings?.timezone).toBe('America/New_York');
    });
  });

  // ======================================================================
  // Issue #433 — GET→UPDATE round-trip + n8n API quirks
  //
  // Real-world agents and scripts commonly do:
  //   const wf = await getWorkflow(id);
  //   await updateWorkflow(id, { ...wf, name: 'New' });
  //
  // n8n's API is asymmetric:
  // - GET returns read-only fields (id, createdAt, updatedAt, versionId,
  //   description, active, tags, meta, staticData, pinData, …)
  // - PUT/PATCH rejects many of those fields (additionalProperties: false
  //   on some n8n versions; description was specifically rejected — #431)
  // - settings is required for a stable update path; empty {} is rejected
  //
  // N8nApiClient.updateWorkflow() runs cleanWorkflowForUpdate() before PUT.
  // These tests hit a live instance so regressions like #431 cannot slip by.
  // ======================================================================

  describe('GET-UPDATE Round Trip (Issue #433)', () => {
    it('should handle a workflow returned from GET when passed straight to UPDATE', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - GET round-trip'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Full GET payload — includes read-only fields the PUT schema rejects
      const fromGet = await client.getWorkflow(created.id);

      // Must not throw: cleanWorkflowForUpdate strips read-only fields
      const updated = await client.updateWorkflow(created.id, fromGet as any);

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(fromGet.name);
      expect(updated.nodes).toHaveLength(fromGet.nodes.length);
    });

    it('should handle workflow update with spread operator', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Spread operator'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const fromGet = await client.getWorkflow(created.id);
      const newName = createTestWorkflowName('Update - Spread operator (renamed)');

      // Common user pattern: spread entire GET response then override fields
      const updated = await client.updateWorkflow(created.id, {
        ...fromGet,
        name: newName,
      } as any);

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(newName);

      const actual = await client.getWorkflow(created.id);
      expect(actual.name).toBe(newName);
      expect(actual.nodes).toHaveLength(fromGet.nodes.length);
    });

    it('should handle partial settings update via nested spread', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Nested settings spread'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const fromGet = await client.getWorkflow(created.id);

      const updated = await client.updateWorkflow(created.id, {
        ...fromGet,
        settings: {
          ...fromGet.settings,
          executionOrder: 'v1' as const,
          timezone: 'UTC',
        },
      } as any);

      expect(updated.id).toBe(created.id);

      const actual = await client.getWorkflow(created.id);
      expect(actual.settings?.timezone).toBe('UTC');
      expect(actual.nodes).toHaveLength(fromGet.nodes.length);
    });
  });

  describe('n8n API Constraints (Issue #433)', () => {
    it('should strip description on update even when present on GET / payload (Issue #431)', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Description strip'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const fromGet = await client.getWorkflow(created.id);

      // description is read-only on write; client must clean it rather than 400
      const updated = await client.updateWorkflow(created.id, {
        ...fromGet,
        description: 'Agent-supplied description that n8n PUT rejects',
        name: createTestWorkflowName('Update - Description strip (ok)'),
      } as any);

      expect(updated.id).toBe(created.id);
      expect(updated.name).toContain('Description strip (ok)');
    });

    it('should auto-supply settings when omitted from the update payload', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Missing settings'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const fromGet = await client.getWorkflow(created.id);

      // Absolute required fields only — cleanWorkflowForUpdate adds settings defaults
      const updated = await client.updateWorkflow(created.id, {
        name: fromGet.name,
        nodes: fromGet.nodes,
        connections: fromGet.connections,
        // deliberately no settings
      } as any);

      expect(updated.id).toBe(created.id);
      expect(updated.nodes).toHaveLength(fromGet.nodes.length);
    });

    it('should handle all common read-only fields in a spread payload', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Read-only fields'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const fromGet = await client.getWorkflow(created.id);
      const newName = createTestWorkflowName('Update - Read-only fields (cleaned)');

      // Force-include fields that have historically broken updates when echoed
      const updated = await client.updateWorkflow(created.id, {
        ...fromGet,
        name: newName,
        createdAt: '2099-01-01T00:00:00.000Z',
        updatedAt: '2099-01-01T00:00:00.000Z',
        versionId: 'must-be-stripped',
        versionCounter: 999,
        active: true,
        isArchived: false,
        meta: { injected: true },
        staticData: { junk: true },
        pinData: { junk: true },
        description: 'must-be-stripped',
        activeVersionId: 'must-be-stripped',
        nodeGroups: [],
        availableInMCP: true,
      } as any);

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(newName);

      const actual = await client.getWorkflow(created.id);
      expect(actual.name).toBe(newName);
      expect(actual.nodes).toHaveLength(fromGet.nodes.length);
    });
  });

  describe('Minimal Updates (Issue #433)', () => {
    it('should update with only required fields (name, nodes, connections)', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Minimal required'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const current = await client.getWorkflow(created.id);

      const updated = await client.updateWorkflow(created.id, {
        name: current.name,
        nodes: current.nodes,
        connections: current.connections,
      } as any);

      expect(updated.id).toBe(created.id);
      expect(updated.nodes).toHaveLength(current.nodes.length);
    });

    it('should update with minimal changes (rename only + required graph)', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Minimal rename'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const current = await client.getWorkflow(created.id);
      const newName = createTestWorkflowName('Update - Minimal rename (done)');

      const updated = await client.updateWorkflow(created.id, {
        name: newName,
        nodes: current.nodes,
        connections: current.connections,
      } as any);

      expect(updated.name).toBe(newName);

      const actual = await client.getWorkflow(created.id);
      expect(actual.name).toBe(newName);
      expect(actual.nodes).toHaveLength(1);
    });
  });

  describe('Edge Cases — settings filtering (Issue #433)', () => {
    it('should succeed when settings contain only unknown properties (defaults applied)', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Unknown settings only'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const current = await client.getWorkflow(created.id);

      // Unknown settings are filtered; empty remainder → { executionOrder: 'v1' }
      // Note: callerPolicy is now whitelisted (n8n 1.119+); use truly unknown keys.
      const updated = await client.updateWorkflow(created.id, {
        name: current.name,
        nodes: current.nodes,
        connections: current.connections,
        settings: {
          totallyUnknownSetting: true,
          anotherGarbageField: 42,
        } as any,
      });

      expect(updated.id).toBe(created.id);
      expect(updated.nodes).toHaveLength(current.nodes.length);
    });

    it('should preserve valid settings while filtering unknown ones', async () => {
      const created = await client.createWorkflow({
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Update - Mixed settings filter'),
        tags: ['mcp-integration-test'],
      });
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const current = await client.getWorkflow(created.id);

      const updated = await client.updateWorkflow(created.id, {
        name: current.name,
        nodes: current.nodes,
        connections: current.connections,
        settings: {
          executionOrder: 'v1' as const,
          timezone: 'Europe/Berlin',
          totallyUnknownSetting: 'drop-me',
        } as any,
      });

      expect(updated.id).toBe(created.id);

      const actual = await client.getWorkflow(created.id);
      expect(actual.settings?.timezone).toBe('Europe/Berlin');
      expect((actual.settings as any)?.totallyUnknownSetting).toBeUndefined();
    });
  });
});
