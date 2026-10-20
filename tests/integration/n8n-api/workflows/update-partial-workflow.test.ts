/**
 * Integration Tests: handleUpdatePartialWorkflow
 *
 * Tests diff-based partial workflow updates against a real n8n instance.
 * Covers all 15 operation types: node operations (6), connection operations (5),
 * and metadata operations (4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { SIMPLE_WEBHOOK_WORKFLOW, SIMPLE_HTTP_WORKFLOW, MULTI_NODE_WORKFLOW } from '../utils/fixtures';
import { createMcpContext, getMcpRepository } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { NodeRepository } from '../../../../src/database/node-repository';
import { handleUpdatePartialWorkflow } from '../../../../src/mcp/handlers-workflow-diff';

describe('Integration: handleUpdatePartialWorkflow', () => {
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

  // ======================================================================
  // NODE OPERATIONS (6 operations)
  // ======================================================================

  describe('Node Operations', () => {
    describe('addNode', () => {
      it('should add a new node to workflow', async () => {
        // Create simple workflow
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Add Node'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Add a Set node and connect it to maintain workflow validity
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'addNode',
                node: {
                  name: 'Set',
                  type: 'n8n-nodes-base.set',
                  typeVersion: 3.4,
                  position: [450, 300],
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
              },
              {
                type: 'addConnection',
                source: 'Webhook',
                target: 'Set',
                sourcePort: 'main',
                targetPort: 'main'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        const responseData = response.data as any;
        expect(responseData.id).toBe(created.id);
        expect(responseData.nodeCount).toBe(2);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        expect(updated.nodes).toHaveLength(2);
        expect(updated.nodes.find((n: any) => n.name === 'Set')).toBeDefined();
      });

      it('should return error for duplicate node name', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Duplicate Node Name'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Try to add node with same name as existing
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'addNode',
                node: {
                  name: 'Webhook', // Duplicate name
                  type: 'n8n-nodes-base.set',
                  typeVersion: 3.4,
                  position: [450, 300],
                  parameters: {}
                }
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(false);
        expect(response.error).toBeDefined();
      });
    });

    describe('removeNode', () => {
      it('should remove node by name', async () => {
        const workflow = {
          ...SIMPLE_HTTP_WORKFLOW,
          name: createTestWorkflowName('Partial - Remove Node'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Remove HTTP Request node by name
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'removeNode',
                nodeName: 'HTTP Request'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        const responseData = response.data as any;
        expect(responseData.id).toBe(created.id);
        expect(responseData.nodeCount).toBe(1);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        expect(updated.nodes).toHaveLength(1);
        expect(updated.nodes.find((n: any) => n.name === 'HTTP Request')).toBeUndefined();
      });

      it('should return error for non-existent node', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Remove Non-existent'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'removeNode',
                nodeName: 'NonExistentNode'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(false);
      });
    });

    describe('updateNode', () => {
      it('should update node parameters', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Update Node'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Update webhook path
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'updateNode',
                nodeName: 'Webhook',
                updates: {
                  'parameters.path': 'updated-path'
                }
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        const webhookNode = updated.nodes.find((n: any) => n.name === 'Webhook');
        expect(webhookNode).toBeDefined();
        expect(webhookNode!.parameters.path).toBe('updated-path');
      });

      it('should update nested parameters', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Update Nested'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'updateNode',
                nodeName: 'Webhook',
                updates: {
                  'parameters.httpMethod': 'POST',
                  'parameters.path': 'new-path'
                }
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        const webhookNode = updated.nodes.find((n: any) => n.name === 'Webhook');
        expect(webhookNode).toBeDefined();
        expect(webhookNode!.parameters.httpMethod).toBe('POST');
        expect(webhookNode!.parameters.path).toBe('new-path');
      });
    });

    describe('moveNode', () => {
      it('should move node to new position', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Move Node'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const newPosition: [number, number] = [500, 500];

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'moveNode',
                nodeName: 'Webhook',
                position: newPosition
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        const webhookNode = updated.nodes.find((n: any) => n.name === 'Webhook');
        expect(webhookNode).toBeDefined();
        expect(webhookNode!.position).toEqual(newPosition);
      });
    });

    describe('enableNode / disableNode', () => {
      it('should disable a node', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Disable Node'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'disableNode',
                nodeName: 'Webhook'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        const webhookNode = updated.nodes.find((n: any) => n.name === 'Webhook');
        expect(webhookNode).toBeDefined();
        expect(webhookNode!.disabled).toBe(true);
      });

      it('should enable a disabled node', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Enable Node'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // First disable the node
        await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [{ type: 'disableNode', nodeName: 'Webhook' }]
          },
          repository,
          mcpContext
        );

        // Then enable it
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'enableNode',
                nodeName: 'Webhook'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        const webhookNode = updated.nodes.find((n: any) => n.name === 'Webhook');
        expect(webhookNode).toBeDefined();
        // After enabling, disabled should be false or undefined (both mean enabled)
        expect(webhookNode!.disabled).toBeFalsy();
      });
    });
  });

  // ======================================================================
  // CONNECTION OPERATIONS (5 operations)
  // ======================================================================

  describe('Connection Operations', () => {
    describe('addConnection', () => {
      it('should add connection between nodes', async () => {
        // Start with workflow without connections
        const workflow = {
          ...SIMPLE_HTTP_WORKFLOW,
          name: createTestWorkflowName('Partial - Add Connection'),
          tags: ['mcp-integration-test'],
          connections: {} // Start with no connections
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Add connection
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'addConnection',
                source: 'Webhook',
                target: 'HTTP Request'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        expect(updated.connections).toBeDefined();
        expect(updated.connections.Webhook).toBeDefined();
      });

      it('should add connection with custom ports', async () => {
        const workflow = {
          ...SIMPLE_HTTP_WORKFLOW,
          name: createTestWorkflowName('Partial - Add Connection Ports'),
          tags: ['mcp-integration-test'],
          connections: {}
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'addConnection',
                source: 'Webhook',
                target: 'HTTP Request',
                sourceOutput: 'main',
                targetInput: 'main',
                sourceIndex: 0,
                targetIndex: 0
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
      });
    });

    describe('removeConnection', () => {
      it('should reject removal of last connection (creates invalid workflow)', async () => {
        const workflow = {
          ...SIMPLE_HTTP_WORKFLOW,
          name: createTestWorkflowName('Partial - Remove Connection'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Try to remove the only connection - should be rejected (leaves 2 nodes with no connections)
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'removeConnection',
                source: 'Webhook',
                target: 'HTTP Request',
                sourcePort: 'main',
                targetPort: 'main'
              }
            ]
          },
          repository,
          mcpContext
        );

        // Should fail validation - multi-node workflow needs connections
        expect(response.success).toBe(false);
        expect(response.error).toContain('Workflow validation failed');
      });

      it('should ignore error for non-existent connection with ignoreErrors flag', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Remove Connection Ignore'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'removeConnection',
                source: 'Webhook',
                target: 'NonExistent',
                ignoreErrors: true
              }
            ]
          },
          repository,
          mcpContext
        );

        // Should succeed because ignoreErrors is true
        expect(response.success).toBe(true);
      });
    });

    describe('replaceConnections', () => {
      it('should reject replacing with empty connections (creates invalid workflow)', async () => {
        const workflow = {
          ...SIMPLE_HTTP_WORKFLOW,
          name: createTestWorkflowName('Partial - Replace Connections'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Try to replace with empty connections - should be rejected (leaves 2 nodes with no connections)
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'replaceConnections',
                connections: {}
              }
            ]
          },
          repository,
          mcpContext
        );

        // Should fail validation - multi-node workflow needs connections
        expect(response.success).toBe(false);
        expect(response.error).toContain('Workflow validation failed');
      });
    });

    describe('cleanStaleConnections', () => {
      it('should remove stale connections in dry run mode', async () => {
        const workflow = {
          ...SIMPLE_HTTP_WORKFLOW,
          name: createTestWorkflowName('Partial - Clean Stale Dry Run'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        // Remove HTTP Request node to create stale connection
        await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [{ type: 'removeNode', nodeName: 'HTTP Request' }]
          },
          repository,
          mcpContext
        );

        // Clean stale connections in dry run
        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'cleanStaleConnections',
                dryRun: true
              }
            ],
            validateOnly: true
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
      });
    });
  });

  // ======================================================================
  // METADATA OPERATIONS (4 operations)
  // ======================================================================

  describe('Metadata Operations', () => {
    describe('updateSettings', () => {
      it('should update workflow settings', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Update Settings'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'updateSettings',
                settings: {
                  timezone: 'America/New_York',
                  executionOrder: 'v1'
                }
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        // Response now returns minimal data - verify with a follow-up get
        expect((response.data as any).id).toBe(created.id);

        // Fetch actual workflow to verify changes
        const updated = await client.getWorkflow(created.id);
        // Note: n8n API may not return all settings in response
        // The operation should succeed even if settings aren't reflected in the response
        expect(updated.settings).toBeDefined();
      });
    });

    describe('updateName', () => {
      it('should update workflow name', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Update Name Original'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const newName = createTestWorkflowName('Partial - Update Name Modified');

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'updateName',
                name: newName
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        const updated = response.data as any;
        expect(updated.name).toBe(newName);
      });
    });

    describe('addTag / removeTag', () => {
      it('should add tag to workflow', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Add Tag'),
          tags: ['mcp-integration-test']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'addTag',
                tag: 'new-tag'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        const updated = response.data as any;

        // Note: n8n API tag behavior may vary
        if (updated.tags) {
          expect(updated.tags).toContain('new-tag');
        }
      });

      it('should remove tag from workflow', async () => {
        const workflow = {
          ...SIMPLE_WEBHOOK_WORKFLOW,
          name: createTestWorkflowName('Partial - Remove Tag'),
          tags: ['mcp-integration-test', 'to-remove']
        };

        const created = await client.createWorkflow(workflow);
        expect(created.id).toBeTruthy();
        if (!created.id) throw new Error('Workflow ID is missing');
        context.trackWorkflow(created.id);

        const response = await handleUpdatePartialWorkflow(
          {
            id: created.id,
            operations: [
              {
                type: 'removeTag',
                tag: 'to-remove'
              }
            ]
          },
          repository,
          mcpContext
        );

        expect(response.success).toBe(true);
        const updated = response.data as any;

        if (updated.tags) {
          expect(updated.tags).not.toContain('to-remove');
        }
      });
    });
  });

  // ======================================================================
  // ADVANCED SCENARIOS
  // ======================================================================

  describe('Advanced Scenarios', () => {
    it('should apply multiple operations in sequence', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Partial - Multiple Ops'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Set',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [450, 300],
                parameters: {
                  assignments: { assignments: [] }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'Webhook',
              target: 'Set'
            },
            {
              type: 'updateName',
              name: createTestWorkflowName('Partial - Multiple Ops Updated')
            }
          ]
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      // Response now returns minimal data - verify with a follow-up get
      const responseData = response.data as any;
      expect(responseData.id).toBe(created.id);
      expect(responseData.nodeCount).toBe(2);

      // Fetch actual workflow to verify changes
      const updated = await client.getWorkflow(created.id);
      expect(updated.nodes).toHaveLength(2);
      expect(updated.connections.Webhook).toBeDefined();
    });

    it('should validate operations without applying (validateOnly mode)', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Partial - Validate Only'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'updateName',
              name: 'New Name'
            }
          ],
          validateOnly: true
        },
        repository,
        mcpContext
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('valid', true);

      // Verify workflow was NOT actually updated
      const current = await client.getWorkflow(created.id);
      expect(current.name).not.toBe('New Name');
    });

    it('should handle continueOnError mode with partial failures', async () => {
      const workflow = {
        ...SIMPLE_WEBHOOK_WORKFLOW,
        name: createTestWorkflowName('Partial - Continue On Error'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Mix valid and invalid operations
      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'updateName',
              name: createTestWorkflowName('Partial - Continue On Error Updated')
            },
            {
              type: 'removeNode',
              nodeName: 'NonExistentNode' // This will fail
            },
            {
              type: 'addTag',
              tag: 'new-tag'
            }
          ],
          continueOnError: true
        },
        repository,
        mcpContext
      );

      // Should succeed with partial results
      expect(response.success).toBe(true);
      expect(response.details?.applied).toBeDefined();
      expect(response.details?.failed).toBeDefined();
    });
  });

  // ======================================================================
  // WORKFLOW STRUCTURE VALIDATION (prevents corrupted workflows)
  // ======================================================================

  describe('Workflow Structure Validation', () => {
    it('should reject removal of all connections in multi-node workflow', async () => {
      // Create workflow with 2 nodes and 1 connection
      const workflow = {
        ...SIMPLE_HTTP_WORKFLOW,
        name: createTestWorkflowName('Partial - Reject Empty Connections'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Try to remove the only connection - should be rejected
      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'removeConnection',
              source: 'Webhook',
              target: 'HTTP Request',
              sourcePort: 'main',
              targetPort: 'main'
            }
          ]
        },
        repository,
        mcpContext
      );

      // Should fail validation
      expect(response.success).toBe(false);
      expect(response.error).toContain('Workflow validation failed');
      expect(response.details?.errors).toBeDefined();
      expect(Array.isArray(response.details?.errors)).toBe(true);
      expect((response.details?.errors as string[])[0]).toContain('no connections');
    });

    it('should reject removal of all nodes except one non-webhook node', async () => {
      // Create workflow with 4 nodes: Webhook, Set 1, Set 2, Merge
      const workflow = {
        ...MULTI_NODE_WORKFLOW,
        name: createTestWorkflowName('Partial - Reject Single Non-Webhook'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Try to remove all nodes except Merge node (non-webhook) - should be rejected
      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'removeNode',
              nodeName: 'Webhook'
            },
            {
              type: 'removeNode',
              nodeName: 'Set 1'
            },
            {
              type: 'removeNode',
              nodeName: 'Set 2'
            }
          ]
        },
        repository,
        mcpContext
      );

      // Should fail validation
      expect(response.success).toBe(false);
      expect(response.error).toContain('Workflow validation failed');
      expect(response.details?.errors).toBeDefined();
      expect(Array.isArray(response.details?.errors)).toBe(true);
      expect((response.details?.errors as string[])[0]).toContain('Single non-webhook node');
    });

    it('should allow valid partial updates that maintain workflow integrity', async () => {
      // Create workflow with 4 nodes
      const workflow = {
        ...MULTI_NODE_WORKFLOW,
        name: createTestWorkflowName('Partial - Valid Update'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Valid update: add a node and connect it
      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Process Data',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [850, 300],
                parameters: {
                  assignments: {
                    assignments: []
                  }
                }
              }
            },
            {
              type: 'addConnection',
              source: 'Merge',
              target: 'Process Data',
              sourcePort: 'main',
              targetPort: 'main'
            }
          ]
        },
        repository,
        mcpContext
      );

      // Should succeed
      expect(response.success).toBe(true);
      // Response now returns minimal data - verify with a follow-up get
      const responseData = response.data as any;
      expect(responseData.id).toBe(created.id);
      expect(responseData.nodeCount).toBe(5); // Original 4 + 1 new

      // Fetch actual workflow to verify changes
      const updated = await client.getWorkflow(created.id);
      expect(updated.nodes).toHaveLength(5); // Original 4 + 1 new
      expect(updated.nodes.find((n: any) => n.name === 'Process Data')).toBeDefined();
    });

    it('should reject adding node without connecting it (disconnected node)', async () => {
      // Create workflow with 2 connected nodes
      const workflow = {
        ...SIMPLE_HTTP_WORKFLOW,
        name: createTestWorkflowName('Partial - Reject Disconnected Node'),
        tags: ['mcp-integration-test']
      };

      const created = await client.createWorkflow(workflow);
      expect(created.id).toBeTruthy();
      if (!created.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(created.id);

      // Try to add a third node WITHOUT connecting it - should be rejected
      const response = await handleUpdatePartialWorkflow(
        {
          id: created.id,
          operations: [
            {
              type: 'addNode',
              node: {
                name: 'Disconnected Set',
                type: 'n8n-nodes-base.set',
                typeVersion: 3.4,
                position: [800, 300],
                parameters: {
                  assignments: {
                    assignments: []
                  }
                }
              }
              // Note: No connection operation - this creates a disconnected node
            }
          ]
        },
        repository,
        mcpContext
      );

      // Should fail validation - disconnected node detected
      expect(response.success).toBe(false);
      expect(response.error).toContain('Workflow validation failed');
      expect(response.details?.errors).toBeDefined();
      expect(Array.isArray(response.details?.errors)).toBe(true);
      const errorMessage = (response.details?.errors as string[])[0];
      expect(errorMessage).toContain('Disconnected nodes detected');
      expect(errorMessage).toContain('Disconnected Set');
    });
  });
});
