/**
 * Comprehensive test suite for auto-update connection references on node rename
 * Tests Issue #353: Enhancement - Auto-update connection references on node rename
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowDiffEngine } from '@/services/workflow-diff-engine';
import { createWorkflow, WorkflowBuilder } from '@tests/utils/builders/workflow.builder';
import {
  WorkflowDiffRequest,
  UpdateNodeOperation,
  AddConnectionOperation,
  RemoveConnectionOperation
} from '@/types/workflow-diff';
import { Workflow, WorkflowNode } from '@/types/n8n-api';

describe('WorkflowDiffEngine - Auto-Update Connection References on Node Rename', () => {
  let diffEngine: WorkflowDiffEngine;
  let baseWorkflow: Workflow;

  /**
   * Helper to convert ID-based connections to name-based
   * (as n8n API expects)
   */
  function convertConnectionsToNameBased(workflow: Workflow): void {
    const newConnections: any = {};
    for (const [nodeId, outputs] of Object.entries(workflow.connections)) {
      const node = workflow.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        newConnections[node.name] = {};
        for (const [outputName, connections] of Object.entries(outputs)) {
          newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
            conns.map((conn: any) => {
              const targetNode = workflow.nodes.find((n: any) => n.id === conn.node);
              return {
                ...conn,
                node: targetNode ? targetNode.name : conn.node
              };
            })
          );
        }
      }
    }
    workflow.connections = newConnections;
  }

  beforeEach(() => {
    diffEngine = new WorkflowDiffEngine();
  });

  describe('Scenario 1: Simple rename with single connection', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('webhook-1', 'http-1')
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should automatically update connection when renaming target node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          name: 'HTTP Request Renamed'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Node should be renamed
      const renamedNode = result.workflow!.nodes.find((n: WorkflowNode) => n.id === 'http-1');
      expect(renamedNode?.name).toBe('HTTP Request Renamed');

      // Connection should reference new name
      const webhookConnections = result.workflow!.connections['Webhook'];
      expect(webhookConnections).toBeDefined();
      expect(webhookConnections.main[0][0].node).toBe('HTTP Request Renamed');
    });

    it('should automatically update connection when renaming source node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'webhook-1',
        updates: {
          name: 'Webhook Renamed'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Node should be renamed
      const renamedNode = result.workflow!.nodes.find((n: WorkflowNode) => n.id === 'webhook-1');
      expect(renamedNode?.name).toBe('Webhook Renamed');

      // Connection key should use new name
      expect(result.workflow!.connections['Webhook Renamed']).toBeDefined();
      expect(result.workflow!.connections['Webhook']).toBeUndefined();
      expect(result.workflow!.connections['Webhook Renamed'].main[0][0].node).toBe('HTTP Request');
    });
  });

  describe('Scenario 2: Multiple incoming connections', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook 1' })
        .addWebhookNode({ id: 'webhook-2', name: 'Webhook 2' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('webhook-1', 'http-1')
        .connect('webhook-2', 'http-1')
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should update all incoming connections when renaming target', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          name: 'Merged HTTP Request'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Both webhook connections should reference new name
      expect(result.workflow!.connections['Webhook 1'].main[0][0].node).toBe('Merged HTTP Request');
      expect(result.workflow!.connections['Webhook 2'].main[0][0].node).toBe('Merged HTTP Request');
    });
  });

  describe('Scenario 3: Multiple outgoing connections', () => {
    beforeEach(() => {
      // Manually create workflow with IF node having two outputs
      baseWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [0, 0],
            parameters: {}
          },
          {
            id: 'http-1',
            name: 'HTTP Request 1',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 0],
            parameters: {}
          },
          {
            id: 'http-2',
            name: 'HTTP Request 2',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 100],
            parameters: {}
          }
        ],
        connections: {
          'IF': {
            main: [
              [{ node: 'HTTP Request 1', type: 'main', index: 0 }],  // output index 0
              [{ node: 'HTTP Request 2', type: 'main', index: 0 }]   // output index 1
            ]
          }
        }
      };
    });

    it('should update all outgoing connections when renaming source', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'if-1',
        updates: {
          name: 'IF Condition'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Connection key should be updated
      expect(result.workflow!.connections['IF Condition']).toBeDefined();
      expect(result.workflow!.connections['IF']).toBeUndefined();

      // Both connections should still exist
      expect(result.workflow!.connections['IF Condition'].main).toHaveLength(2);
      expect(result.workflow!.connections['IF Condition'].main[0][0].node).toBe('HTTP Request 1');
      expect(result.workflow!.connections['IF Condition'].main[1][0].node).toBe('HTTP Request 2');
    });
  });

  describe('Scenario 4: IF node branches', () => {
    beforeEach(() => {
      // Manually create workflow with IF node branches
      baseWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'if-1',
            name: 'IF',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [0, 0],
            parameters: {}
          },
          {
            id: 'http-true',
            name: 'HTTP True',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 0],
            parameters: {}
          },
          {
            id: 'http-false',
            name: 'HTTP False',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 200],
            parameters: {}
          }
        ],
        connections: {
          'IF': {
            main: [
              [{ node: 'HTTP True', type: 'main', index: 0 }],    // branch=true (index 0)
              [{ node: 'HTTP False', type: 'main', index: 0 }]    // branch=false (index 1)
            ]
          }
        }
      };
    });

    it('should update both branch connections when renaming IF node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'if-1',
        updates: {
          name: 'IF Renamed'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Connection key should be updated
      expect(result.workflow!.connections['IF Renamed']).toBeDefined();
      expect(result.workflow!.connections['IF']).toBeUndefined();

      // Both branches should still exist
      expect(result.workflow!.connections['IF Renamed'].main).toHaveLength(2);
      expect(result.workflow!.connections['IF Renamed'].main[0][0].node).toBe('HTTP True');
      expect(result.workflow!.connections['IF Renamed'].main[1][0].node).toBe('HTTP False');
    });

    it('should update branch target when renaming target node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-true',
        updates: {
          name: 'HTTP Success'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // True branch connection should reference new name
      expect(result.workflow!.connections['IF'].main[0][0].node).toBe('HTTP Success');
      // False branch should remain unchanged
      expect(result.workflow!.connections['IF'].main[1][0].node).toBe('HTTP False');
    });
  });

  describe('Scenario 5: Switch node cases', () => {
    beforeEach(() => {
      // Manually create workflow with Switch node cases
      baseWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'switch-1',
            name: 'Switch',
            type: 'n8n-nodes-base.switch',
            typeVersion: 3,
            position: [0, 0],
            parameters: {}
          },
          {
            id: 'http-case0',
            name: 'HTTP Case 0',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 0],
            parameters: {}
          },
          {
            id: 'http-case1',
            name: 'HTTP Case 1',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 100],
            parameters: {}
          },
          {
            id: 'http-case2',
            name: 'HTTP Case 2',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [200, 200],
            parameters: {}
          }
        ],
        connections: {
          'Switch': {
            main: [
              [{ node: 'HTTP Case 0', type: 'main', index: 0 }],  // case 0
              [{ node: 'HTTP Case 1', type: 'main', index: 0 }],  // case 1
              [{ node: 'HTTP Case 2', type: 'main', index: 0 }]   // case 2
            ]
          }
        }
      };
    });

    it('should update all case connections when renaming Switch node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'switch-1',
        updates: {
          name: 'Switch Renamed'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Connection key should be updated
      expect(result.workflow!.connections['Switch Renamed']).toBeDefined();
      expect(result.workflow!.connections['Switch']).toBeUndefined();

      // All three cases should still exist
      expect(result.workflow!.connections['Switch Renamed'].main).toHaveLength(3);
      expect(result.workflow!.connections['Switch Renamed'].main[0][0].node).toBe('HTTP Case 0');
      expect(result.workflow!.connections['Switch Renamed'].main[1][0].node).toBe('HTTP Case 1');
      expect(result.workflow!.connections['Switch Renamed'].main[2][0].node).toBe('HTTP Case 2');
    });

    it('should update specific case target when renamed', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-case1',
        updates: {
          name: 'HTTP Middle Case'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Case 1 connection should reference new name
      expect(result.workflow!.connections['Switch'].main[1][0].node).toBe('HTTP Middle Case');
      // Other cases should remain unchanged
      expect(result.workflow!.connections['Switch'].main[0][0].node).toBe('HTTP Case 0');
      expect(result.workflow!.connections['Switch'].main[2][0].node).toBe('HTTP Case 2');
    });
  });

  describe('Scenario 6: Error connections', () => {
    beforeEach(() => {
      // Manually create workflow with error connection
      baseWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'http-1',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: 'error-handler',
            name: 'Error Handler',
            type: 'n8n-nodes-base.code',
            typeVersion: 2,
            position: [200, 100],
            parameters: {}
          }
        ],
        connections: {
          'HTTP Request': {
            error: [
              [{ node: 'Error Handler', type: 'main', index: 0 }]
            ]
          }
        }
      };
    });

    it('should update error connections when renaming source node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          name: 'HTTP Request Renamed'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Error connection should have updated key
      expect(result.workflow!.connections['HTTP Request Renamed']).toBeDefined();
      expect(result.workflow!.connections['HTTP Request Renamed'].error[0][0].node).toBe('Error Handler');
    });

    it('should update error connections when renaming target node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'error-handler',
        updates: {
          name: 'Error Logger'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Error connection target should be updated
      expect(result.workflow!.connections['HTTP Request'].error[0][0].node).toBe('Error Logger');
    });
  });

  describe('Scenario 7: AI tool connections', () => {
    beforeEach(() => {
      // Manually create workflow with AI tool connection
      baseWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'agent-1',
            name: 'AI Agent',
            type: '@n8n/n8n-nodes-langchain.agent',
            typeVersion: 1,
            position: [0, 0],
            parameters: {}
          },
          {
            id: 'tool-1',
            name: 'HTTP Tool',
            type: '@n8n/n8n-nodes-langchain.toolHttpRequest',
            typeVersion: 1,
            position: [200, 0],
            parameters: {}
          }
        ],
        connections: {
          'AI Agent': {
            ai_tool: [
              [{ node: 'HTTP Tool', type: 'ai_tool', index: 0 }]
            ]
          }
        }
      };
    });

    it('should update AI tool connections when renaming agent', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'agent-1',
        updates: {
          name: 'AI Agent Renamed'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // AI tool connection should have updated key
      expect(result.workflow!.connections['AI Agent Renamed']).toBeDefined();
      expect(result.workflow!.connections['AI Agent Renamed'].ai_tool[0][0].node).toBe('HTTP Tool');
    });

    it('should update AI tool connections when renaming tool', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'tool-1',
        updates: {
          name: 'API Tool'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // AI tool connection target should be updated
      expect(result.workflow!.connections['AI Agent'].ai_tool[0][0].node).toBe('API Tool');
    });
  });

  describe('Scenario 8: Name collision detection', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request 1' })
        .addHttpRequestNode({ id: 'http-2', name: 'HTTP Request 2' })
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should fail when renaming to an existing node name', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          name: 'HTTP Request 2'  // Collision!
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('already exists');
      expect(result.errors![0].message).toContain('HTTP Request 2');
    });

    it('should allow renaming to same name (no-op)', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          name: 'HTTP Request 1'  // Same name
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();
    });
  });

  describe('Scenario 9: Multiple renames in single batch', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .addSlackNode({ id: 'slack-1', name: 'Slack' })
        .connect('webhook-1', 'http-1')
        .connect('http-1', 'slack-1')
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should handle multiple renames in one batch', async () => {
      const operations: UpdateNodeOperation[] = [
        {
          type: 'updateNode',
          nodeId: 'webhook-1',
          updates: { name: 'Webhook Trigger' }
        },
        {
          type: 'updateNode',
          nodeId: 'http-1',
          updates: { name: 'API Call' }
        },
        {
          type: 'updateNode',
          nodeId: 'slack-1',
          updates: { name: 'Slack Notification' }
        }
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // All nodes should be renamed
      expect(result.workflow!.nodes.find((n: WorkflowNode) => n.id === 'webhook-1')?.name).toBe('Webhook Trigger');
      expect(result.workflow!.nodes.find((n: WorkflowNode) => n.id === 'http-1')?.name).toBe('API Call');
      expect(result.workflow!.nodes.find((n: WorkflowNode) => n.id === 'slack-1')?.name).toBe('Slack Notification');

      // All connections should be updated
      expect(result.workflow!.connections['Webhook Trigger']).toBeDefined();
      expect(result.workflow!.connections['Webhook Trigger'].main[0][0].node).toBe('API Call');
      expect(result.workflow!.connections['API Call']).toBeDefined();
      expect(result.workflow!.connections['API Call'].main[0][0].node).toBe('Slack Notification');
    });
  });

  describe('Scenario 10: Chain operations - rename then add/remove connections', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .addSlackNode({ id: 'slack-1', name: 'Slack' })
        .connect('webhook-1', 'http-1')
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should handle rename followed by add connection using new name', async () => {
      const operations = [
        {
          type: 'updateNode',
          nodeId: 'http-1',
          updates: { name: 'API Call' }
        } as UpdateNodeOperation,
        {
          type: 'addConnection',
          source: 'API Call',  // Using new name
          target: 'Slack'
        } as AddConnectionOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Connection should exist with new name
      expect(result.workflow!.connections['API Call']).toBeDefined();
      expect(result.workflow!.connections['API Call'].main[0]).toContainEqual(
        expect.objectContaining({ node: 'Slack' })
      );
    });

    it('should handle rename followed by remove connection using new name', async () => {
      const operations = [
        {
          type: 'updateNode',
          nodeId: 'webhook-1',
          updates: { name: 'Webhook Trigger' }
        } as UpdateNodeOperation,
        {
          type: 'removeConnection',
          source: 'Webhook Trigger',  // Using new name
          target: 'HTTP Request'
        } as RemoveConnectionOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Connection should be removed
      expect(result.workflow!.connections['Webhook Trigger']).toBeUndefined();
    });
  });

  describe('Scenario 11: validateOnly mode', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('webhook-1', 'http-1')
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should validate rename without applying changes', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: { name: 'HTTP Request Renamed' }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation],
        validateOnly: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      // Post #744: validateOnly returns the simulated post-diff workflow snapshot
      // (a deep copy) so callers can run structural validation against it.
      expect(result.workflow).toBeDefined();

      // Original workflow should remain unchanged (the simulated workflow is a copy)
      const httpNode = baseWorkflow.nodes.find((n: WorkflowNode) => n.id === 'http-1');
      expect(httpNode?.name).toBe('HTTP Request');
      expect(baseWorkflow.connections['Webhook'].main[0][0].node).toBe('HTTP Request');
    });
  });

  describe('Scenario 12: continueOnError mode', () => {
    beforeEach(() => {
      baseWorkflow = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .addSlackNode({ id: 'slack-1', name: 'Slack' })
        .connect('webhook-1', 'http-1')
        .connect('http-1', 'slack-1')
        .build() as Workflow;
      convertConnectionsToNameBased(baseWorkflow);
    });

    it('should apply successful renames and update connections even with some failures', async () => {
      const operations: UpdateNodeOperation[] = [
        {
          type: 'updateNode',
          nodeId: 'webhook-1',
          updates: { name: 'Webhook Trigger' }
        },
        {
          type: 'updateNode',
          nodeId: 'invalid-id',  // This will fail
          updates: { name: 'Invalid' }
        },
        {
          type: 'updateNode',
          nodeId: 'slack-1',
          updates: { name: 'Slack Notification' }
        }
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations,
        continueOnError: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);  // Some operations succeeded
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBe(1);  // One failed

      // Successful renames should have updated connections
      expect(result.workflow!.connections['Webhook Trigger']).toBeDefined();
      expect(result.workflow!.connections['HTTP Request'].main[0][0].node).toBe('Slack Notification');
    });
  });

  describe('Scenario 13: Self-connections', () => {
    beforeEach(() => {
      // Create workflow where a node connects to itself (loop)
      baseWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        nodes: [
          {
            id: 'loop-1',
            name: 'Loop Node',
            type: 'n8n-nodes-base.code',
            typeVersion: 2,
            position: [0, 0],
            parameters: {}
          }
        ],
        connections: {
          'Loop Node': {
            main: [
              [{ node: 'Loop Node', type: 'main', index: 0 }]  // Self-connection
            ]
          }
        }
      };
    });

    it('should update self-connections when node is renamed', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'loop-1',
        updates: { name: 'Recursive Loop' }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Both source and target should reference new name
      expect(result.workflow!.connections['Recursive Loop']).toBeDefined();
      expect(result.workflow!.connections['Recursive Loop'].main[0][0].node).toBe('Recursive Loop');
    });
  });

  describe('Scenario 14: Real-world scenario from Issue #353', () => {
    beforeEach(() => {
      // Recreate the exact scenario from the issue
      baseWorkflow = {
        id: 'workflow123',
        name: 'POST /patients/:id/approaches',
        nodes: [
          {
            id: 'if-node',
            name: 'If',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [0, 0],
            parameters: {}
          },
          {
            id: '8546d741-1af1-4aa0-bf11-af6c926c0008',
            name: 'Return 403 Forbidden1',
            type: 'n8n-nodes-base.respondToWebhook',
            typeVersion: 1.1,
            position: [200, 100],
            parameters: {
              responseBody: '={{ {"error": "Forbidden"} }}',
              options: { responseCode: 403 }
            }
          },
          {
            id: 'return-200',
            name: 'Return 200 OK',
            type: 'n8n-nodes-base.respondToWebhook',
            typeVersion: 1.1,
            position: [200, 0],
            parameters: {
              responseBody: '={{ {"success": true} }}',
              options: { responseCode: 200 }
            }
          }
        ],
        connections: {
          'If': {
            main: [
              [{ node: 'Return 200 OK', type: 'main', index: 0 }],           // true branch
              [{ node: 'Return 403 Forbidden1', type: 'main', index: 0 }]    // false branch
            ]
          }
        }
      };
    });

    it('should successfully rename node and update connection (exact issue scenario)', async () => {
      // The exact operation from the issue
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: '8546d741-1af1-4aa0-bf11-af6c926c0008',
        updates: {
          name: 'Return 404 Not Found',
          parameters: {
            responseBody: '={{ {"error": "Not Found"} }}',
            options: { responseCode: 404 }
          }
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'workflow123',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      // This should now succeed (was failing before fix)
      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Node should be renamed
      const renamedNode = result.workflow!.nodes.find((n: WorkflowNode) => n.id === '8546d741-1af1-4aa0-bf11-af6c926c0008');
      expect(renamedNode?.name).toBe('Return 404 Not Found');

      // Parameters should be updated
      expect(renamedNode?.parameters.responseBody).toBe('={{ {"error": "Not Found"} }}');
      expect(renamedNode?.parameters.options?.responseCode).toBe(404);

      // Connection should automatically reference new name
      expect(result.workflow!.connections['If'].main[1][0].node).toBe('Return 404 Not Found');
      // True branch should remain unchanged
      expect(result.workflow!.connections['If'].main[0][0].node).toBe('Return 200 OK');

      // No validation errors should occur
      expect(result.errors).toBeUndefined();
    });
  });
});
