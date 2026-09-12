/**
 * Integration Tests: handleCreateWorkflow
 *
 * Tests workflow creation against a real n8n instance.
 * Verifies the P0 bug fix (FULL vs SHORT node type formats)
 * and covers all major workflow creation scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../utils/test-context';
import { getTestN8nClient } from '../utils/n8n-client';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { Workflow } from '../../../../src/types/n8n-api';
import {
  SIMPLE_WEBHOOK_WORKFLOW,
  SIMPLE_HTTP_WORKFLOW,
  MULTI_NODE_WORKFLOW,
  ERROR_HANDLING_WORKFLOW,
  AI_AGENT_WORKFLOW,
  EXPRESSION_WORKFLOW,
  getFixture
} from '../utils/fixtures';
import { cleanupOrphanedWorkflows } from '../utils/cleanup-helpers';
import { createMcpContext } from '../utils/mcp-context';
import { InstanceContext } from '../../../../src/types/instance-context';
import { handleCreateWorkflow } from '../../../../src/mcp/handlers-n8n-manager';

describe('Integration: handleCreateWorkflow', () => {
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

  // Global cleanup after all tests to catch any orphaned workflows
  // (e.g., from test retries or failures)
  // IMPORTANT: Skip cleanup in CI to preserve shared n8n instance workflows
  afterAll(async () => {
    if (!process.env.CI) {
      await cleanupOrphanedWorkflows();
    }
  });

  // ======================================================================
  // P0: Critical Bug Verification
  // ======================================================================

  describe('P0: Node Type Format Bug Fix', () => {
    it('should create workflow with webhook node using FULL node type format', async () => {
      // This test verifies the P0 bug fix where SHORT node type format
      // (e.g., "webhook") was incorrectly normalized to FULL format
      // causing workflow creation failures.
      //
      // The fix ensures FULL format (e.g., "n8n-nodes-base.webhook")
      // is preserved and passed to n8n API correctly.

      const workflowName = createTestWorkflowName('P0 Bug Verification - Webhook Node');
      const workflow = {
        name: workflowName,
        ...getFixture('simple-webhook')
      };

      // Create workflow using MCP handler
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Verify workflow created successfully
      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);
      expect(result.name).toBe(workflowName);
      expect((result as any).nodeCount).toBe(1);

      // Fetch actual workflow to verify details
      const workflow2 = await client.getWorkflow(result.id);
      expect(workflow2.nodes).toHaveLength(1);
      // Critical: Verify FULL node type format is preserved
      expect(workflow2.nodes[0].type).toBe('n8n-nodes-base.webhook');
      expect(workflow2.nodes[0].name).toBe('Webhook');
      expect(workflow2.nodes[0].parameters).toBeDefined();
    });
  });

  // ======================================================================
  // P1: Base Nodes (High Priority)
  // ======================================================================

  describe('P1: Base n8n Nodes', () => {
    it('should create workflow with HTTP Request node', async () => {
      const workflowName = createTestWorkflowName('HTTP Request Node');
      const workflow = {
        name: workflowName,
        ...getFixture('simple-http')
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);
      expect(result.name).toBe(workflowName);
      expect((result as any).nodeCount).toBe(2);

      // Fetch actual workflow to verify details
      const actual = await client.getWorkflow(result.id);
      expect(actual.nodes).toHaveLength(2);

      // Verify both nodes created with FULL type format
      const webhookNode = actual.nodes.find((n: any) => n.name === 'Webhook');
      const httpNode = actual.nodes.find((n: any) => n.name === 'HTTP Request');

      expect(webhookNode).toBeDefined();
      expect(webhookNode!.type).toBe('n8n-nodes-base.webhook');

      expect(httpNode).toBeDefined();
      expect(httpNode!.type).toBe('n8n-nodes-base.httpRequest');

      // Verify connections
      expect(actual.connections).toBeDefined();
      expect(actual.connections.Webhook).toBeDefined();
    });

    it('should create workflow with langchain agent node', async () => {
      const workflowName = createTestWorkflowName('Langchain Agent Node');
      const workflow = {
        name: workflowName,
        ...getFixture('ai-agent')
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);
      expect(result.name).toBe(workflowName);
      expect((result as any).nodeCount).toBe(2);

      // Fetch actual workflow to verify details
      const actual = await client.getWorkflow(result.id);
      expect(actual.nodes).toHaveLength(2);

      // Verify langchain node type format
      const agentNode = actual.nodes.find((n: any) => n.name === 'AI Agent');
      expect(agentNode).toBeDefined();
      expect(agentNode!.type).toBe('@n8n/n8n-nodes-langchain.agent');
    });

    it('should create complex multi-node workflow', async () => {
      const workflowName = createTestWorkflowName('Multi-Node Workflow');
      const workflow = {
        name: workflowName,
        ...getFixture('multi-node')
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);
      expect(result.name).toBe(workflowName);
      expect((result as any).nodeCount).toBe(4);

      // Fetch actual workflow to verify details
      const actual = await client.getWorkflow(result.id);
      expect(actual.nodes).toHaveLength(4);

      // Verify all node types preserved
      const nodeTypes = actual.nodes.map((n: any) => n.type);
      expect(nodeTypes).toContain('n8n-nodes-base.webhook');
      expect(nodeTypes).toContain('n8n-nodes-base.set');
      expect(nodeTypes).toContain('n8n-nodes-base.merge');

      // Verify complex connections
      expect(actual.connections.Webhook.main[0]).toHaveLength(2); // Branches to 2 nodes
    });
  });

  // ======================================================================
  // P2: Advanced Features (Medium Priority)
  // ======================================================================

  describe('P2: Advanced Workflow Features', () => {
    it('should create workflow with complex connections and branching', async () => {
      const workflowName = createTestWorkflowName('Complex Connections');
      const workflow = {
        name: workflowName,
        ...getFixture('multi-node')
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);

      // Fetch actual workflow to verify connections
      const actual = await client.getWorkflow(result.id);
      expect(actual.connections).toBeDefined();

      // Verify branching: Webhook -> Set 1 and Set 2
      const webhookConnections = actual.connections.Webhook.main[0]!;
      expect(webhookConnections).toHaveLength(2);

      // Verify merging: Set 1 -> Merge (port 0), Set 2 -> Merge (port 1)
      const set1Connections = actual.connections['Set 1'].main[0]!;
      const set2Connections = actual.connections['Set 2'].main[0]!;

      expect(set1Connections[0].node).toBe('Merge');
      expect(set1Connections[0].index).toBe(0);

      expect(set2Connections[0].node).toBe('Merge');
      expect(set2Connections[0].index).toBe(1);
    });

    it('should create workflow with custom settings', async () => {
      const workflowName = createTestWorkflowName('Custom Settings');
      const workflow = {
        name: workflowName,
        ...getFixture('error-handling'),
        settings: {
          executionOrder: 'v1' as const,
          timezone: 'America/New_York',
          saveDataErrorExecution: 'all' as const,
          saveDataSuccessExecution: 'all' as const,
          saveExecutionProgress: true
        }
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);

      // Fetch actual workflow to verify settings
      const actual = await client.getWorkflow(result.id);
      expect(actual.settings).toBeDefined();
      expect(actual.settings!.executionOrder).toBe('v1');
    });

    it('should create workflow with n8n expressions', async () => {
      const workflowName = createTestWorkflowName('n8n Expressions');
      const workflow = {
        name: workflowName,
        ...getFixture('expression')
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);
      expect((result as any).nodeCount).toBe(2);

      // Fetch actual workflow to verify expressions
      const actual = await client.getWorkflow(result.id);
      expect(actual.nodes).toHaveLength(2);

      // Verify Set node with expressions
      const setNode = actual.nodes.find((n: any) => n.name === 'Set Variables');
      expect(setNode).toBeDefined();
      expect(setNode!.parameters.assignments).toBeDefined();

      // Verify expressions are preserved
      const assignmentsData = setNode!.parameters.assignments as { assignments: Array<{ value: string }> };
      expect(assignmentsData.assignments).toHaveLength(3);
      expect(assignmentsData.assignments[0].value).toContain('$now');
      expect(assignmentsData.assignments[1].value).toContain('$json');
      expect(assignmentsData.assignments[2].value).toContain('$node');
    });

    it('should create workflow with error handling configuration', async () => {
      const workflowName = createTestWorkflowName('Error Handling');
      const workflow = {
        name: workflowName,
        ...getFixture('error-handling')
      };

      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(true);
      const result = response.data as Workflow;

      // Response now returns minimal data
      expect(result).toBeDefined();
      expect(result.id).toBeTruthy();
      if (!result.id) throw new Error('Workflow ID is missing');
      context.trackWorkflow(result.id);
      expect((result as any).nodeCount).toBe(3);

      // Fetch actual workflow to verify error handling
      const actual = await client.getWorkflow(result.id);
      expect(actual.nodes).toHaveLength(3);

      // Verify HTTP node with error handling
      const httpNode = actual.nodes.find((n: any) => n.name === 'HTTP Request');
      expect(httpNode).toBeDefined();
      expect(httpNode!.continueOnFail).toBe(true);
      expect(httpNode!.onError).toBe('continueErrorOutput');

      // Verify error connection
      expect(actual.connections['HTTP Request'].error).toBeDefined();
      expect(actual.connections['HTTP Request'].error[0]![0].node).toBe('Handle Error');
    });
  });

  // ======================================================================
  // Error Scenarios (P1 Priority)
  // ======================================================================

  describe('Error Scenarios', () => {
    it('should reject workflow with invalid node type (MCP validation)', async () => {
      // MCP handler correctly validates workflows before sending to n8n API.
      // Invalid node types are caught during MCP validation.
      //
      // Note: Raw n8n API would accept this and only fail at execution time,
      // but MCP handler does proper pre-validation (correct behavior).

      const workflowName = createTestWorkflowName('Invalid Node Type');
      const workflow = {
        name: workflowName,
        nodes: [
          {
            id: 'invalid-1',
            name: 'Invalid Node',
            type: 'n8n-nodes-base.nonexistentnode',
            typeVersion: 1,
            position: [250, 300] as [number, number],
            parameters: {}
          }
        ],
        connections: {},
        settings: { executionOrder: 'v1' as const }
      };

      // MCP handler rejects invalid workflows (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).toContain('validation');
    });

    it('should reject workflow with missing required node parameters (MCP validation)', async () => {
      // MCP handler validates required parameters before sending to n8n API.
      //
      // Note: Raw n8n API would accept this and only fail at execution time,
      // but MCP handler does proper pre-validation (correct behavior).

      const workflowName = createTestWorkflowName('Missing Parameters');
      const workflow = {
        name: workflowName,
        nodes: [
          {
            id: 'http-1',
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.2,
            position: [250, 300] as [number, number],
            parameters: {
              // Missing required 'url' parameter
              method: 'GET'
            }
          }
        ],
        connections: {},
        settings: { executionOrder: 'v1' as const }
      };

      // MCP handler rejects workflows with validation errors (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should reject workflow with duplicate node names (MCP validation)', async () => {
      // MCP handler validates that node names are unique.
      //
      // Note: Raw n8n API might auto-rename duplicates, but MCP handler
      // enforces unique names upfront (correct behavior).

      const workflowName = createTestWorkflowName('Duplicate Node Names');
      const workflow = {
        name: workflowName,
        nodes: [
          {
            id: 'set-1',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [250, 300] as [number, number],
            parameters: {
              assignments: { assignments: [] },
              options: {}
            }
          },
          {
            id: 'set-2',
            name: 'Set', // Duplicate name
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300] as [number, number],
            parameters: {
              assignments: { assignments: [] },
              options: {}
            }
          }
        ],
        connections: {},
        settings: { executionOrder: 'v1' as const }
      };

      // MCP handler rejects workflows with validation errors (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should reject workflow with invalid connection references (MCP validation)', async () => {
      // MCP handler validates that connection references point to existing nodes.
      //
      // Note: Raw n8n API would accept this and only fail at execution time,
      // but MCP handler does proper connection validation (correct behavior).

      const workflowName = createTestWorkflowName('Invalid Connections');
      const workflow = {
        name: workflowName,
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
          }
        ],
        connections: {
          // Connection references non-existent node
          Webhook: {
            main: [[{ node: 'NonExistent', type: 'main', index: 0 }]]
          }
        },
        settings: { executionOrder: 'v1' as const }
      };

      // MCP handler rejects workflows with invalid connections (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).toContain('validation');
    });
  });

  // ======================================================================
  // Additional Edge Cases
  // ======================================================================

  describe('Edge Cases', () => {
    it('should reject single-node non-webhook workflow (MCP validation)', async () => {
      // MCP handler enforces that single-node workflows are only valid for webhooks.
      // This is a best practice validation.

      const workflowName = createTestWorkflowName('Minimal Single Node');
      const workflow = {
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual Trigger',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300] as [number, number],
            parameters: {}
          }
        ],
        connections: {},
        settings: { executionOrder: 'v1' as const }
      };

      // MCP handler rejects single-node non-webhook workflows (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).toContain('validation');
    });

    it('should reject single-node non-trigger workflow (MCP validation)', async () => {
      // MCP handler enforces workflow best practices.
      // Single isolated nodes without connections are rejected.

      const workflowName = createTestWorkflowName('Empty Connections');
      const workflow = {
        name: workflowName,
        nodes: [
          {
            id: 'set-1',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [250, 300] as [number, number],
            parameters: {
              assignments: { assignments: [] },
              options: {}
            }
          }
        ],
        connections: {}, // Explicitly empty
        settings: { executionOrder: 'v1' as const }
      };

      // MCP handler rejects single-node workflows (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should reject single-node workflow without settings (MCP validation)', async () => {
      // MCP handler enforces workflow best practices.
      // Single-node non-webhook workflows are rejected.

      const workflowName = createTestWorkflowName('No Settings');
      const workflow = {
        name: workflowName,
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual Trigger',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300] as [number, number],
            parameters: {}
          }
        ],
        connections: {}
        // No settings property
      };

      // MCP handler rejects single-node workflows (correct behavior)
      const response = await handleCreateWorkflow({ ...workflow }, mcpContext);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });
});
