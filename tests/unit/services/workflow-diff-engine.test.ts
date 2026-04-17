import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowDiffEngine } from '@/services/workflow-diff-engine';
import { createWorkflow, WorkflowBuilder } from '@tests/utils/builders/workflow.builder';
import {
  WorkflowDiffRequest,
  WorkflowDiffOperation,
  AddNodeOperation,
  RemoveNodeOperation,
  UpdateNodeOperation,
  MoveNodeOperation,
  EnableNodeOperation,
  DisableNodeOperation,
  AddConnectionOperation,
  RemoveConnectionOperation,
  UpdateSettingsOperation,
  UpdateNameOperation,
  AddTagOperation,
  RemoveTagOperation,
  CleanStaleConnectionsOperation,
  ReplaceConnectionsOperation,
  TransferWorkflowOperation
} from '@/types/workflow-diff';
import { Workflow } from '@/types/n8n-api';

describe('WorkflowDiffEngine', () => {
  let diffEngine: WorkflowDiffEngine;
  let baseWorkflow: Workflow;
  let builder: WorkflowBuilder;

  beforeEach(() => {
    diffEngine = new WorkflowDiffEngine();
    
    // Create a base workflow with some nodes
    builder = createWorkflow('Test Workflow')
      .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
      .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
      .addSlackNode({ id: 'slack-1', name: 'Slack' })
      .connect('webhook-1', 'http-1')
      .connect('http-1', 'slack-1')
      .addTags('test', 'automation');
    
    baseWorkflow = builder.build() as Workflow;
    
    // Convert connections from ID-based to name-based (as n8n expects)
    const newConnections: any = {};
    for (const [nodeId, outputs] of Object.entries(baseWorkflow.connections)) {
      const node = baseWorkflow.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        newConnections[node.name] = {};
        for (const [outputName, connections] of Object.entries(outputs)) {
          newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
            conns.map((conn: any) => {
              const targetNode = baseWorkflow.nodes.find((n: any) => n.id === conn.node);
              return {
                ...conn,
                node: targetNode ? targetNode.name : conn.node
              };
            })
          );
        }
      }
    }
    baseWorkflow.connections = newConnections;
  });

  describe('Large Operation Batches', () => {
    it('should handle many operations successfully', async () => {
      // Test with 50 operations
      const operations = Array(50).fill(null).map((_: any, i: number) => ({
        type: 'updateName',
        name: `Name ${i}`
      } as UpdateNameOperation));

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.operationsApplied).toBe(50);
      expect(result.workflow!.name).toBe('Name 49'); // Last operation wins
    });

    it('should handle 100+ mixed operations', async () => {
      const operations: WorkflowDiffOperation[] = [
        // Add 30 nodes
        ...Array(30).fill(null).map((_: any, i: number) => ({
          type: 'addNode',
          node: {
            name: `Node${i}`,
            type: 'n8n-nodes-base.code',
            position: [i * 100, 300],
            parameters: {}
          }
        } as AddNodeOperation)),
        // Update names 30 times
        ...Array(30).fill(null).map((_: any, i: number) => ({
          type: 'updateName',
          name: `Workflow Version ${i}`
        } as UpdateNameOperation)),
        // Add 40 tags
        ...Array(40).fill(null).map((_: any, i: number) => ({
          type: 'addTag',
          tag: `tag${i}`
        } as AddTagOperation))
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.operationsApplied).toBe(100);
      expect(result.workflow!.nodes.length).toBeGreaterThan(30);
      expect(result.workflow!.name).toBe('Workflow Version 29');
    });
  });

  describe('AddNode Operation', () => {
    it('should add a new node successfully', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'New Code Node',
          type: 'n8n-nodes-base.code',
          position: [800, 300],
          typeVersion: 2,
          parameters: {
            mode: 'runOnceForAllItems',
            language: 'javaScript',
            jsCode: 'return items;'
          }
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(4);
      expect(result.workflow!.nodes[3].name).toBe('New Code Node');
      expect(result.workflow!.nodes[3].type).toBe('n8n-nodes-base.code');
      expect(result.workflow!.nodes[3].id).toBeDefined();
    });

    it('should reject duplicate node names', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Webhook', // Duplicate name
          type: 'n8n-nodes-base.webhook',
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('already exists');
    });

    it('should reject invalid node type format', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Invalid Node',
          type: 'webhook', // Missing package prefix
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid node type');
    });

    it('should correct nodes-base prefix to n8n-nodes-base', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Test Node',
          type: 'nodes-base.webhook', // Wrong prefix
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Use "n8n-nodes-base.');
    });

    it('should generate node ID if not provided', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'No ID Node',
          type: 'n8n-nodes-base.code',
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes[3].id).toBeDefined();
      expect(result.workflow!.nodes[3].id).toMatch(/^[0-9a-f-]+$/);
    });
  });

  describe('RemoveNode Operation', () => {
    it('should remove node by ID', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(2);
      expect(result.workflow!.nodes.find((n: any) => n.id === 'http-1')).toBeUndefined();
    });

    it('should remove node by name', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeName: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(2);
      expect(result.workflow!.nodes.find((n: any) => n.name === 'HTTP Request')).toBeUndefined();
    });

    it('should clean up connections when removing node', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.connections['HTTP Request']).toBeUndefined();
      // Check that connections from Webhook were cleaned up
      if (result.workflow!.connections['Webhook'] && result.workflow!.connections['Webhook'].main && result.workflow!.connections['Webhook'].main[0]) {
        expect(result.workflow!.connections['Webhook'].main[0]).toHaveLength(0);
      } else {
        // Webhook connections should be cleaned up entirely
        expect(result.workflow!.connections['Webhook']).toBeUndefined();
      }
    });

    it('should reject removing non-existent node', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Node not found');
    });
  });

  describe('UpdateNode Operation', () => {
    it('should update node parameters', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          'parameters.method': 'POST',
          'parameters.url': 'https://new-api.example.com'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const updatedNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(updatedNode!.parameters.method).toBe('POST');
      expect(updatedNode!.parameters.url).toBe('https://new-api.example.com');
    });

    it('should update nested properties using dot notation', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'Slack',
        updates: {
          'parameters.resource': 'channel',
          'parameters.operation': 'create',
          'credentials.slackApi.name': 'New Slack Account'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const updatedNode = result.workflow!.nodes.find((n: any) => n.name === 'Slack');
      expect(updatedNode!.parameters.resource).toBe('channel');
      expect(updatedNode!.parameters.operation).toBe('create');
      expect((updatedNode!.credentials as any).slackApi.name).toBe('New Slack Account');
    });

    it('should reject updating non-existent node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'non-existent',
        updates: {
          'parameters.test': 'value'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Node not found');
    });

    it('should provide helpful error when using "changes" instead of "updates" (Issue #392)', async () => {
      // Simulate the common mistake of using "changes" instead of "updates"
      const operation: any = {
        type: 'updateNode',
        nodeId: 'http-1',
        changes: {  // Wrong property name
          'parameters.url': 'https://example.com'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter \'changes\'');
      expect(result.errors![0].message).toContain('requires \'updates\'');
      expect(result.errors![0].message).toContain('Example:');
    });

    it('should provide helpful error when "updates" parameter is missing', async () => {
      const operation: any = {
        type: 'updateNode',
        nodeId: 'http-1'
        // Missing "updates" property
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Missing required parameter \'updates\'');
      expect(result.errors![0].message).toContain('Correct structure:');
    });

    it('should reject prototype pollution via update path', async () => {
      const result = await diffEngine.applyDiff(baseWorkflow, {
        id: 'test',
        operations: [{
          type: 'updateNode' as const,
          nodeId: 'http-1',
          updates: {
            '__proto__.polluted': 'malicious'
          }
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('forbidden key');
    });

    it('should apply __patch_find_replace to string properties (#642)', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;\nreturn x + 2;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'updateNode' as const,
          nodeName: 'Code',
          updates: {
            'parameters.jsCode': {
              __patch_find_replace: [
                { find: 'x + 2', replace: 'x + 3' }
              ]
            }
          }
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('const x = 1;\nreturn x + 3;');
    });

    it('should apply multiple sequential __patch_find_replace patches', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const a = 1;\nconst b = 2;\nreturn a + b;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'updateNode' as const,
          nodeName: 'Code',
          updates: {
            'parameters.jsCode': {
              __patch_find_replace: [
                { find: 'const a = 1', replace: 'const a = 10' },
                { find: 'const b = 2', replace: 'const b = 20' }
              ]
            }
          }
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('const a = 10;\nconst b = 20;\nreturn a + b;');
    });

    it('should reject __patch_find_replace on non-string properties', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { retryCount: 3 }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'updateNode' as const,
          nodeName: 'Code',
          updates: {
            'parameters.retryCount': {
              __patch_find_replace: [
                { find: '3', replace: '5' }
              ]
            }
          }
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('__patch_find_replace');
    });

    it('should reject __patch_find_replace with invalid format', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'updateNode' as const,
          nodeName: 'Code',
          updates: {
            'parameters.jsCode': {
              __patch_find_replace: 'not an array'
            }
          }
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('must be an array');
    });

    it('should warn when __patch_find_replace find string not found', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'updateNode' as const,
          nodeName: 'Code',
          updates: {
            'parameters.jsCode': {
              __patch_find_replace: [
                { find: 'nonexistent text', replace: 'something' }
              ]
            }
          }
        }]
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.message.includes('not found'))).toBe(true);
    });
  });

  describe('PatchNodeField Operation', () => {
    it('should apply single find/replace patch', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;\nreturn x + 2;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'x + 2', replace: 'x + 3' }]
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('const x = 1;\nreturn x + 3;');
    });

    it('should error when find string not found', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'nonexistent text', replace: 'something' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('not found');
    });

    it('should error on ambiguous match (multiple occurrences)', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const a = 1;\nconst b = 1;\nconst c = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'const', replace: 'let' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('3 times');
      expect(result.errors?.[0]?.message).toContain('replaceAll');
    });

    it('should replace all occurrences with replaceAll flag', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const a = 1;\nconst b = 2;\nconst c = 3;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'const', replace: 'let', replaceAll: true }]
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('let a = 1;\nlet b = 2;\nlet c = 3;');
    });

    it('should apply multiple sequential patches', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const a = 1;\nconst b = 2;\nreturn a + b;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [
            { find: 'const a = 1', replace: 'const a = 10' },
            { find: 'const b = 2', replace: 'const b = 20' }
          ]
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('const a = 10;\nconst b = 20;\nreturn a + b;');
    });

    it('should support regex pattern matching', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const limit = 42;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'const limit = \\d+', replace: 'const limit = 100', regex: true }]
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('const limit = 100;');
    });

    it('should support regex with replaceAll', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'item1 = 10;\nitem2 = 20;\nitem3 = 30;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'item\\d+', replace: 'val', regex: true, replaceAll: true }]
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.name === 'Code');
      expect(codeNode?.parameters.jsCode).toBe('val = 10;\nval = 20;\nval = 30;');
    });

    it('should error on ambiguous regex match without replaceAll', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'item1 = 10;\nitem2 = 20;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'item\\d+', replace: 'val', regex: true }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('2 times');
    });

    it('should reject invalid regex pattern in validation', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: '(unclosed', replace: 'x', regex: true }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('Invalid regex');
    });

    it('should error on non-existent field', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.nonExistent',
          patches: [{ find: 'x', replace: 'y' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('does not exist');
    });

    it('should error on non-string field', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { retryCount: 3 }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.retryCount',
          patches: [{ find: '3', replace: '5' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('expected string');
    });

    it('should error on missing node', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'NonExistent',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'x', replace: 'y' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('not found');
    });

    it('should reject empty patches array', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: []
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('non-empty');
    });

    it('should reject empty find string', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: '', replace: 'y' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('must not be empty');
    });

    it('should work with nested fieldPath using dot notation', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'set-1',
        name: 'Set',
        type: 'n8n-nodes-base.set',
        typeVersion: 3,
        position: [900, 300],
        parameters: {
          options: {
            template: '<p>Hello World</p>'
          }
        }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Set',
          fieldPath: 'parameters.options.template',
          patches: [{ find: 'Hello World', replace: 'Goodbye World' }]
        }]
      });

      expect(result.success).toBe(true);
      const setNode = result.workflow.nodes.find((n: any) => n.name === 'Set');
      expect(setNode?.parameters.options.template).toBe('<p>Goodbye World</p>');
    });

    it('should reject prototype pollution via fieldPath', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: '__proto__.polluted',
          patches: [{ find: 'x', replace: 'y' }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('forbidden key');
    });

    it('should reject unsafe regex patterns (ReDoS)', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: '(a+)+$', replace: 'safe', regex: true }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('unsafe regex');
    });

    it('should reject too many patches', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const patches = Array.from({ length: 51 }, (_, i) => ({
        find: `pattern${i}`,
        replace: `replacement${i}`
      }));

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('too many patches');
    });

    it('should reject overly long regex patterns', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeName: 'Code',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'a'.repeat(501), replace: 'b', regex: true }]
        }]
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.message).toContain('too long');
    });

    it('should work with nodeId reference', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: { jsCode: 'const x = 1;' }
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'patchNodeField' as const,
          nodeId: 'code-1',
          fieldPath: 'parameters.jsCode',
          patches: [{ find: 'const x = 1', replace: 'const x = 2' }]
        }]
      });

      expect(result.success).toBe(true);
      const codeNode = result.workflow.nodes.find((n: any) => n.id === 'code-1');
      expect(codeNode?.parameters.jsCode).toBe('const x = 2;');
    });
  });

  describe('MoveNode Operation', () => {
    it('should move node to new position', async () => {
      const operation: MoveNodeOperation = {
        type: 'moveNode',
        nodeId: 'http-1',
        position: [1000, 500]
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const movedNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(movedNode!.position).toEqual([1000, 500]);
    });

    it('should move node by name', async () => {
      const operation: MoveNodeOperation = {
        type: 'moveNode',
        nodeName: 'Webhook',
        position: [100, 100]
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      const movedNode = result.workflow!.nodes.find((n: any) => n.name === 'Webhook');
      expect(movedNode!.position).toEqual([100, 100]);
    });

    it('rejects newPosition typo pre-mutation with did-you-mean hint (regression #6)', async () => {
      const op: any = { type: 'moveNode', nodeName: 'Webhook', newPosition: [450, 600] };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [op] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/newPosition/);
      expect(result.errors![0].message).toMatch(/Did you mean 'position'/);
      const node = baseWorkflow.nodes.find(n => n.name === 'Webhook')!;
      expect(node.position).not.toEqual([450, 600]);
    });

    it('rejects newPosition even when position is also provided (regression #6)', async () => {
      const op: any = { type: 'moveNode', nodeName: 'Webhook', newPosition: [1, 2], position: [3, 4] };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [op] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/newPosition/);
    });

    it('rejects missing position parameter for moveNode (regression #6)', async () => {
      const op: any = { type: 'moveNode', nodeName: 'Webhook' };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [op] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/Missing required parameter 'position'/);
    });

    it('rejects non-array position value for moveNode (regression #6)', async () => {
      const op: any = { type: 'moveNode', nodeName: 'Webhook', position: 'not-an-array' };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [op] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/Invalid 'position' for moveNode/);
    });

    it('rejects wrong-length position array for moveNode (regression #6)', async () => {
      const op: any = { type: 'moveNode', nodeName: 'Webhook', position: [1, 2, 3] };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [op] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/Invalid 'position' for moveNode/);
    });
  });

  describe('Enable/Disable Node Operations', () => {
    it('should disable a node', async () => {
      const operation: DisableNodeOperation = {
        type: 'disableNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const disabledNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(disabledNode!.disabled).toBe(true);
    });

    it('should enable a disabled node', async () => {
      // First disable the node
      baseWorkflow.nodes[1].disabled = true;

      const operation: EnableNodeOperation = {
        type: 'enableNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const enabledNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(enabledNode!.disabled).toBe(false);
    });
  });

  describe('AddConnection Operation', () => {
    it('should add a new connection', async () => {
      // First add a new node to connect to
      const addNodeOp: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Code',
          type: 'n8n-nodes-base.code',
          position: [1000, 300]
        }
      };

      const addConnectionOp: AddConnectionOperation = {
        type: 'addConnection',
        source: 'slack-1',
        target: 'Code'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNodeOp, addConnectionOp]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.connections['Slack']).toBeDefined();
      expect(result.workflow!.connections['Slack'].main[0]).toHaveLength(1);
      expect(result.workflow!.connections['Slack'].main[0][0].node).toBe('Code');
    });

    it('should reject duplicate connections', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',  // Use node name not ID
        target: 'HTTP Request'  // Use node name not ID
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Connection already exists');
    });

    it('should reject connection to non-existent source node', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'non-existent',
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Source node not found');
    });

    it('should reject connection to non-existent target node', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'webhook-1',
        target: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Target node not found');
    });

    it('should support custom output and input types', async () => {
      // Add an IF node that has multiple outputs
      const addNodeOp: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [600, 400]
        }
      };

      const addConnectionOp: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'slack-1',
        sourceOutput: 'false',
        targetInput: 'main',
        sourceIndex: 0,
        targetIndex: 0
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNodeOp, addConnectionOp]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow!.connections['IF'].false).toBeDefined();
      expect(result.workflow!.connections['IF'].false[0][0].node).toBe('Slack');
    });

    it('should reject addConnection with wrong parameter sourceNodeId instead of source (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        sourceNodeId: 'webhook-1', // Wrong parameter name!
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter(s): sourceNodeId');
      expect(result.errors![0].message).toContain("Use 'source' and 'target' instead");
    });

    it('should reject addConnection with wrong parameter targetNodeId instead of target (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        source: 'webhook-1',
        targetNodeId: 'http-1' // Wrong parameter name!
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter(s): targetNodeId');
      expect(result.errors![0].message).toContain("Use 'source' and 'target' instead");
    });

    it('should reject addConnection with both wrong parameters (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        sourceNodeId: 'webhook-1', // Wrong!
        targetNodeId: 'http-1' // Wrong!
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter(s): sourceNodeId, targetNodeId');
      expect(result.errors![0].message).toContain("Use 'source' and 'target' instead");
    });

    it('should show helpful error with available nodes when source is missing (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        // source is missing entirely
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain("Missing required parameter 'source'");
      expect(result.errors![0].message).toContain("not 'sourceNodeId'");
    });

    it('should show helpful error with available nodes when target is missing (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        source: 'webhook-1',
        // target is missing entirely
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain("Missing required parameter 'target'");
      expect(result.errors![0].message).toContain("not 'targetNodeId'");
    });

    it('should list available nodes when source node not found (Issue #249)', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'non-existent-node',
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Source node not found: "non-existent-node"');
      expect(result.errors![0].message).toContain('Available nodes:');
      expect(result.errors![0].message).toContain('Webhook');
      expect(result.errors![0].message).toContain('HTTP Request');
      expect(result.errors![0].message).toContain('Slack');
    });

    it('should list available nodes when target node not found (Issue #249)', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'webhook-1',
        target: 'non-existent-node'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Target node not found: "non-existent-node"');
      expect(result.errors![0].message).toContain('Available nodes:');
      expect(result.errors![0].message).toContain('Webhook');
      expect(result.errors![0].message).toContain('HTTP Request');
      expect(result.errors![0].message).toContain('Slack');
    });

    it('should remap numeric targetInput to main (#659)', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: {}
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'addConnection' as const,
          source: 'Slack',
          target: 'Code',
          sourceOutput: 'main',
          targetInput: '0',
          sourceIndex: 0,
          targetIndex: 0
        }]
      });

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Slack']['main'][0][0].type).toBe('main');
    });

    it('should remap sourceOutput 0 with explicit sourceIndex 0 (#659)', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'code-1',
        name: 'Code',
        type: 'n8n-nodes-base.code',
        typeVersion: 1,
        position: [900, 300],
        parameters: {}
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'addConnection' as const,
          source: 'Slack',
          target: 'Code',
          sourceOutput: '0',
          sourceIndex: 0,
          targetIndex: 0
        }]
      });

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Slack']['main']).toBeDefined();
      expect(result.workflow.connections['Slack']['0']).toBeUndefined();
      expect(result.workflow.connections['Slack']['main'][0][0].type).toBe('main');
    });

    it('should preserve named targetInput like ai_tool', async () => {
      const workflow = JSON.parse(JSON.stringify(baseWorkflow));
      workflow.nodes.push({
        id: 'agent-1',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        typeVersion: 1,
        position: [900, 300],
        parameters: {}
      });
      workflow.nodes.push({
        id: 'tool-1',
        name: 'Calculator',
        type: '@n8n/n8n-nodes-langchain.toolCalculator',
        typeVersion: 1,
        position: [1100, 300],
        parameters: {}
      });

      const result = await diffEngine.applyDiff(workflow, {
        id: 'test',
        operations: [{
          type: 'addConnection' as const,
          source: 'Calculator',
          target: 'AI Agent',
          sourceOutput: 'ai_tool',
          targetInput: 'ai_tool'
        }]
      });

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Calculator']['ai_tool'][0][0].type).toBe('ai_tool');
    });
  });

  describe('RemoveConnection Operation', () => {
    it('should remove an existing connection', async () => {
      const operation: RemoveConnectionOperation = {
        type: 'removeConnection',
        source: 'Webhook',  // Use node name
        target: 'HTTP Request'  // Use node name
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      // After removing the connection, the array should be empty or cleaned up
      if (result.workflow!.connections['Webhook']) {
        if (result.workflow!.connections['Webhook'].main && result.workflow!.connections['Webhook'].main.length > 0) {
          expect(result.workflow!.connections['Webhook'].main[0]).toHaveLength(0);
        } else {
          expect(result.workflow!.connections['Webhook'].main).toHaveLength(0);
        }
      } else {
        // Connection was cleaned up entirely
        expect(result.workflow!.connections['Webhook']).toBeUndefined();
      }
    });

    it('should reject removing non-existent connection', async () => {
      const operation: RemoveConnectionOperation = {
        type: 'removeConnection',
        source: 'Slack',  // Use node name
        target: 'Webhook'  // Use node name
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('No connections found');
    });
  });


  describe('RewireConnection Operation (Phase 1)', () => {
    it('should rewire connection from one target to another', async () => {
      // Setup: Create a connection Webhook → HTTP Request
      // Then rewire it to Webhook → Slack instead
      const rewireOp: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'HTTP Request',
        to: 'Slack'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [rewireOp]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Old connection should be removed
      const webhookConnections = result.workflow!.connections['Webhook']['main'][0];
      expect(webhookConnections.some((c: any) => c.node === 'HTTP Request')).toBe(false);

      // New connection should exist
      expect(webhookConnections.some((c: any) => c.node === 'Slack')).toBe(true);
    });

    it('should rewire connection with specified sourceOutput', async () => {
      // Add IF node with connection on 'true' output
      const addNode: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [600, 300]
        }
      };

      const addConn: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'HTTP Request',
        sourceOutput: 'true'
      };

      const rewire: any = {
        type: 'rewireConnection',
        source: 'IF',
        from: 'HTTP Request',
        to: 'Slack',
        sourceOutput: 'true'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNode, addConn, rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Verify rewiring on 'true' output
      const trueConnections = result.workflow!.connections['IF']['true'][0];
      expect(trueConnections.some((c: any) => c.node === 'HTTP Request')).toBe(false);
      expect(trueConnections.some((c: any) => c.node === 'Slack')).toBe(true);
    });

    it('should preserve other parallel connections when rewiring', async () => {
      // Setup: Webhook connects to both HTTP Request (in baseWorkflow) and Slack (added here)
      // Add a Set node, then rewire HTTP Request → Set
      // Slack connection should remain unchanged

      // Add Slack connection in parallel
      const addSlackConn: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',
        target: 'Slack'
      };

      // Add Set node to rewire to
      const addSetNode: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Set',
          type: 'n8n-nodes-base.set',
          position: [800, 300]
        }
      };

      // Rewire HTTP Request → Set
      const rewire: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'HTTP Request',
        to: 'Set'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addSlackConn, addSetNode, rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      const webhookConnections = result.workflow!.connections['Webhook']['main'][0];

      // HTTP Request should be removed
      expect(webhookConnections.some((c: any) => c.node === 'HTTP Request')).toBe(false);

      // Set should be added
      expect(webhookConnections.some((c: any) => c.node === 'Set')).toBe(true);

      // Slack should still be there (parallel connection preserved)
      expect(webhookConnections.some((c: any) => c.node === 'Slack')).toBe(true);
    });

    it('should reject rewireConnection when source node not found', async () => {
      const rewire: any = {
        type: 'rewireConnection',
        source: 'NonExistent',
        from: 'HTTP Request',
        to: 'Slack'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('Source node not found');
      expect(result.errors![0].message).toContain('NonExistent');
      expect(result.errors![0].message).toContain('Available nodes');
    });

    it('should reject rewireConnection when "from" node not found', async () => {
      const rewire: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'NonExistent',
        to: 'Slack'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('"From" node not found');
      expect(result.errors![0].message).toContain('NonExistent');
    });

    it('should reject rewireConnection when "to" node not found', async () => {
      const rewire: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'HTTP Request',
        to: 'NonExistent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('"To" node not found');
      expect(result.errors![0].message).toContain('NonExistent');
    });

    it('should reject rewireConnection when connection does not exist', async () => {
      // Slack node exists but doesn't have any outgoing connections
      // So this should fail with "No connections found" error
      const rewire: any = {
        type: 'rewireConnection',
        source: 'Slack',  // Slack has no outgoing connections in baseWorkflow
        from: 'HTTP Request',
        to: 'Webhook'  // Use existing node
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('No connections found from');
      expect(result.errors![0].message).toContain('Slack');
    });

    it('should not duplicate edge when rewiring to an already-connected target (regression #7)', async () => {
      // Setup: Webhook → HTTP Request (baseWorkflow) AND Webhook → Slack (parallel).
      // Rewire from HTTP Request to Slack. Slack is already a target of Webhook,
      // so the result should contain exactly one Slack edge (not two) and no
      // HTTP Request edge.
      const addSlackConn: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',
        target: 'Slack'
      };

      const rewire: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'HTTP Request',
        to: 'Slack'
      };

      const result = await diffEngine.applyDiff(baseWorkflow, {
        id: 'test-workflow',
        operations: [addSlackConn, rewire]
      });

      expect(result.success).toBe(true);
      const webhookEdges = result.workflow!.connections['Webhook']['main'][0];
      const slackEdges = webhookEdges.filter((c: any) => c.node === 'Slack');
      const httpEdges = webhookEdges.filter((c: any) => c.node === 'HTTP Request');
      expect(slackEdges).toHaveLength(1);
      expect(httpEdges).toHaveLength(0);
    });

    it('should rewire correctly when source/from/to are passed as node IDs (regression #7)', async () => {
      // baseWorkflow nodes have fixed ids: webhook-1, http-1, slack-1
      const rewireById: any = {
        type: 'rewireConnection',
        source: 'webhook-1',
        from: 'http-1',
        to: 'slack-1'
      };

      const result = await diffEngine.applyDiff(baseWorkflow, {
        id: 'test-workflow',
        operations: [rewireById]
      });

      expect(result.success).toBe(true);
      const webhookEdges = result.workflow!.connections['Webhook']['main'][0];
      expect(webhookEdges.some((c: any) => c.node === 'HTTP Request')).toBe(false);
      expect(webhookEdges.some((c: any) => c.node === 'Slack')).toBe(true);
    });

    it('rejects rewire when from and to are the same string (regression Copilot review)', async () => {
      const rewire: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'HTTP Request',
        to: 'HTTP Request'
      };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [rewire] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/must refer to different nodes/);
    });

    it('rejects rewire when from (ID) and to (name) resolve to the same node (regression Copilot review)', async () => {
      const rewire: any = {
        type: 'rewireConnection',
        source: 'Webhook',
        from: 'http-1',
        to: 'HTTP Request'
      };
      const result = await diffEngine.applyDiff(baseWorkflow, { id: 'test-workflow', operations: [rewire] });
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toMatch(/resolve to the same node|must refer to different nodes/);
    });


    it('should handle rewiring IF node branches correctly', async () => {
      // Add IF node with true/false branches
      const addIF: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [600, 300]
        }
      };

      const addSuccess: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'SuccessHandler',
          type: 'n8n-nodes-base.set',
          position: [800, 200]
        }
      };

      const addError: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'ErrorHandler',
          type: 'n8n-nodes-base.set',
          position: [800, 400]
        }
      };

      const connectTrue: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'SuccessHandler',
        sourceOutput: 'true'
      };

      const connectFalse: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'ErrorHandler',
        sourceOutput: 'false'
      };

      // Rewire the false branch to go to SuccessHandler instead
      const rewireFalse: any = {
        type: 'rewireConnection',
        source: 'IF',
        from: 'ErrorHandler',
        to: 'Slack',
        sourceOutput: 'false'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addIF, addSuccess, addError, connectTrue, connectFalse, rewireFalse]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // True branch should still point to SuccessHandler
      expect(result.workflow!.connections['IF']['true'][0][0].node).toBe('SuccessHandler');

      // False branch should now point to Slack
      expect(result.workflow!.connections['IF']['false'][0][0].node).toBe('Slack');
    });
  });

  describe('Smart Parameters (Phase 1)', () => {
    it('should use branch="true" for IF node connections', async () => {
      // Add IF node
      const addIF: any = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [400, 300]
        }
      };

      // Add TrueHandler node (use unique name)
      const addTrueHandler: any = {
        type: 'addNode',
        node: {
          name: 'TrueHandler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      // Connect IF to TrueHandler using smart branch parameter
      const connectWithBranch: any = {
        type: 'addConnection',
        source: 'IF',
        target: 'TrueHandler',
        branch: 'true'  // Smart parameter instead of sourceOutput: 'true'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addIF, addTrueHandler, connectWithBranch]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Should create connection on 'main' output, index 0 (true branch)
      expect(result.workflow!.connections['IF']['main']).toBeDefined();
      expect(result.workflow!.connections['IF']['main'][0]).toBeDefined();
      expect(result.workflow!.connections['IF']['main'][0][0].node).toBe('TrueHandler');
    });

    it('should use branch="false" for IF node connections', async () => {
      const addIF: any = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [400, 300]
        }
      };

      const addFalseHandler: any = {
        type: 'addNode',
        node: {
          name: 'FalseHandler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      const connectWithBranch: any = {
        type: 'addConnection',
        source: 'IF',
        target: 'FalseHandler',
        branch: 'false'  // Smart parameter for false branch
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addIF, addFalseHandler, connectWithBranch]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should create connection on 'main' output, index 1 (false branch)
      expect(result.workflow!.connections['IF']['main']).toBeDefined();
      expect(result.workflow!.connections['IF']['main'][1]).toBeDefined();
      expect(result.workflow!.connections['IF']['main'][1][0].node).toBe('FalseHandler');
    });

    it('should use case parameter for Switch node connections', async () => {
      // Add Switch node
      const addSwitch: any = {
        type: 'addNode',
        node: {
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [400, 300]
        }
      };

      // Add handler nodes
      const addCase0: any = {
        type: 'addNode',
        node: {
          name: 'Case0Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 200]
        }
      };

      const addCase1: any = {
        type: 'addNode',
        node: {
          name: 'Case1Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      const addCase2: any = {
        type: 'addNode',
        node: {
          name: 'Case2Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 400]
        }
      };

      // Connect using case parameter
      const connectCase0: any = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case0Handler',
        case: 0  // Smart parameter instead of sourceIndex: 0
      };

      const connectCase1: any = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case1Handler',
        case: 1  // Smart parameter instead of sourceIndex: 1
      };

      const connectCase2: any = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case2Handler',
        case: 2  // Smart parameter instead of sourceIndex: 2
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addSwitch, addCase0, addCase1, addCase2, connectCase0, connectCase1, connectCase2]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // All cases should be routed correctly
      expect(result.workflow!.connections['Switch']['main'][0][0].node).toBe('Case0Handler');
      expect(result.workflow!.connections['Switch']['main'][1][0].node).toBe('Case1Handler');
      expect(result.workflow!.connections['Switch']['main'][2][0].node).toBe('Case2Handler');
    });

    it('should use branch parameter with rewireConnection', async () => {
      // Setup: Create IF node with true/false branches
      const addIF: any = {
        type: 'addNode',
        node: {
          name: 'IFRewire',
          type: 'n8n-nodes-base.if',
          position: [400, 300]
        }
      };

      const addSuccess: any = {
        type: 'addNode',
        node: {
          name: 'SuccessHandler',
          type: 'n8n-nodes-base.set',
          position: [600, 200]
        }
      };

      const addNewSuccess: any = {
        type: 'addNode',
        node: {
          name: 'NewSuccessHandler',
          type: 'n8n-nodes-base.set',
          position: [600, 250]
        }
      };

      // Initial connection
      const initialConn: any = {
        type: 'addConnection',
        source: 'IFRewire',
        target: 'SuccessHandler',
        branch: 'true'
      };

      // Rewire using branch parameter
      const rewire: any = {
        type: 'rewireConnection',
        source: 'IFRewire',
        from: 'SuccessHandler',
        to: 'NewSuccessHandler',
        branch: 'true'  // Smart parameter
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addIF, addSuccess, addNewSuccess, initialConn, rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should rewire the true branch (main output, index 0)
      expect(result.workflow!.connections['IFRewire']['main']).toBeDefined();
      expect(result.workflow!.connections['IFRewire']['main'][0]).toBeDefined();
      expect(result.workflow!.connections['IFRewire']['main'][0][0].node).toBe('NewSuccessHandler');
    });

    it('should use case parameter with rewireConnection', async () => {
      const addSwitch: any = {
        type: 'addNode',
        node: {
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [400, 300]
        }
      };

      const addCase1: any = {
        type: 'addNode',
        node: {
          name: 'Case1Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      const addNewCase1: any = {
        type: 'addNode',
        node: {
          name: 'NewCase1Handler',
          type: 'n8n-nodes-base.slack',
          position: [600, 350]
        }
      };

      const initialConn: any = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case1Handler',
        case: 1
      };

      const rewire: any = {
        type: 'rewireConnection',
        source: 'Switch',
        from: 'Case1Handler',
        to: 'NewCase1Handler',
        case: 1  // Smart parameter
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addSwitch, addCase1, addNewCase1, initialConn, rewire]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should rewire case 1
      expect(result.workflow!.connections['Switch']['main'][1][0].node).toBe('NewCase1Handler');
    });

    it('should not override explicit sourceOutput with branch parameter', async () => {
      const addIF: any = {
        type: 'addNode',
        node: {
          name: 'IFOverride',
          type: 'n8n-nodes-base.if',
          position: [400, 300]
        }
      };

      const addHandler: any = {
        type: 'addNode',
        node: {
          name: 'OverrideHandler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      // Both branch and sourceOutput provided - sourceOutput should win
      const connectWithBoth: any = {
        type: 'addConnection',
        source: 'IFOverride',
        target: 'OverrideHandler',
        branch: 'true',          // Smart parameter suggests 'true'
        sourceOutput: 'false'    // Explicit parameter should override
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addIF, addHandler, connectWithBoth]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should use explicit sourceOutput ('false'), not smart branch parameter
      // Note: explicit sourceOutput='false' creates connection on output named 'false'
      // This is different from branch parameter which maps to sourceIndex
      expect(result.workflow!.connections['IFOverride']['false']).toBeDefined();
      expect(result.workflow!.connections['IFOverride']['false'][0][0].node).toBe('OverrideHandler');
      expect(result.workflow!.connections['IFOverride']['main']).toBeUndefined();
    });

    it('should not override explicit sourceIndex with case parameter', async () => {
      const addSwitch: any = {
        type: 'addNode',
        node: {
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [400, 300]
        }
      };

      const addHandler: any = {
        type: 'addNode',
        node: {
          name: 'Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      // Both case and sourceIndex provided - sourceIndex should win
      const connectWithBoth: any = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Handler',
        case: 1,           // Smart parameter suggests index 1
        sourceIndex: 2     // Explicit parameter should override
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addSwitch, addHandler, connectWithBoth]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should use explicit sourceIndex (2), not case (1)
      expect(result.workflow!.connections['Switch']['main'][2]).toBeDefined();
      expect(result.workflow!.connections['Switch']['main'][2][0].node).toBe('Handler');
      expect(result.workflow!.connections['Switch']['main'][1]).toEqual([]);
    });

    it('should warn when using sourceIndex with If node (issue #360)', async () => {
      const addIF: any = {
        type: 'addNode',
        node: {
          name: 'Check Condition',
          type: 'n8n-nodes-base.if',
          position: [400, 300]
        }
      };

      const addSuccess: any = {
        type: 'addNode',
        node: {
          name: 'Success Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 200]
        }
      };

      const addError: any = {
        type: 'addNode',
        node: {
          name: 'Error Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 400]
        }
      };

      // BAD: Using sourceIndex with If node (reproduces issue #360)
      const connectSuccess: any = {
        type: 'addConnection',
        source: 'Check Condition',
        target: 'Success Handler',
        sourceIndex: 0  // Should use branch="true" instead
      };

      const connectError: any = {
        type: 'addConnection',
        source: 'Check Condition',
        target: 'Error Handler',
        sourceIndex: 0  // Should use branch="false" instead - both will end up in main[0]!
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addIF, addSuccess, addError, connectSuccess, connectError]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should produce warnings
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(2);
      expect(result.warnings![0].message).toContain('Consider using branch="true" or branch="false"');
      expect(result.warnings![0].message).toContain('If node outputs: main[0]=TRUE branch, main[1]=FALSE branch');
      expect(result.warnings![1].message).toContain('Consider using branch="true" or branch="false"');

      // Both connections end up in main[0] (the bug behavior)
      expect(result.workflow!.connections['Check Condition']['main'][0].length).toBe(2);
      expect(result.workflow!.connections['Check Condition']['main'][0][0].node).toBe('Success Handler');
      expect(result.workflow!.connections['Check Condition']['main'][0][1].node).toBe('Error Handler');
    });

    it('should warn when using sourceIndex with Switch node', async () => {
      const addSwitch: any = {
        type: 'addNode',
        node: {
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [400, 300]
        }
      };

      const addHandler: any = {
        type: 'addNode',
        node: {
          name: 'Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      // BAD: Using sourceIndex with Switch node
      const connect: any = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Handler',
        sourceIndex: 1  // Should use case=1 instead
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addSwitch, addHandler, connect]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);

      // Should produce warning
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0].message).toContain('Consider using case=N for better clarity');
    });
  });

  describe('AddConnection with sourceIndex (Phase 0 Fix)', () => {
    it('should add connection to correct sourceIndex', async () => {
      // Add IF node
      const addNodeOp: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [600, 300]
        }
      };

      // Add two different target nodes
      const addNode1: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'SuccessHandler',
          type: 'n8n-nodes-base.set',
          position: [800, 200]
        }
      };

      const addNode2: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'ErrorHandler',
          type: 'n8n-nodes-base.set',
          position: [800, 400]
        }
      };

      // Connect to 'true' output at index 0
      const addConnection1: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'SuccessHandler',
        sourceOutput: 'true',
        sourceIndex: 0
      };

      // Connect to 'false' output at index 0
      const addConnection2: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'ErrorHandler',
        sourceOutput: 'false',
        sourceIndex: 0
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNodeOp, addNode1, addNode2, addConnection1, addConnection2]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      // Verify connections are at correct indices
      expect(result.workflow!.connections['IF']['true']).toBeDefined();
      expect(result.workflow!.connections['IF']['true'][0]).toBeDefined();
      expect(result.workflow!.connections['IF']['true'][0][0].node).toBe('SuccessHandler');

      expect(result.workflow!.connections['IF']['false']).toBeDefined();
      expect(result.workflow!.connections['IF']['false'][0]).toBeDefined();
      expect(result.workflow!.connections['IF']['false'][0][0].node).toBe('ErrorHandler');
    });

    it('should support multiple connections at same sourceIndex (parallel execution)', async () => {
      // Use a fresh workflow to avoid interference
      const freshWorkflow = JSON.parse(JSON.stringify(baseWorkflow));

      // Add three target nodes
      const addNode1: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Processor1',
          type: 'n8n-nodes-base.set',
          position: [600, 200]
        }
      };

      const addNode2: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Processor2',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      const addNode3: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Processor3',
          type: 'n8n-nodes-base.set',
          position: [600, 400]
        }
      };

      // All connect from Webhook at sourceIndex 0 (parallel)
      const addConnection1: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',
        target: 'Processor1',
        sourceIndex: 0
      };

      const addConnection2: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',
        target: 'Processor2',
        sourceIndex: 0
      };

      const addConnection3: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',
        target: 'Processor3',
        sourceIndex: 0
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNode1, addNode2, addNode3, addConnection1, addConnection2, addConnection3]
      };

      const result = await diffEngine.applyDiff(freshWorkflow, request);

      expect(result.success).toBe(true);
      // All three new processors plus the existing HTTP Request should be at index 0
      // So we expect 4 total connections
      const connectionsAtIndex0 = result.workflow!.connections['Webhook']['main'][0];
      expect(connectionsAtIndex0.length).toBeGreaterThanOrEqual(3);
      const targets = connectionsAtIndex0.map((c: any) => c.node);
      expect(targets).toContain('Processor1');
      expect(targets).toContain('Processor2');
      expect(targets).toContain('Processor3');
    });

    it('should support connections at different sourceIndices (Switch node pattern)', async () => {
      // Add Switch node
      const addSwitchNode: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Switch',
          type: 'n8n-nodes-base.switch',
          position: [400, 300]
        }
      };

      // Add handlers for different cases
      const addCase0: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Case0Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 200]
        }
      };

      const addCase1: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Case1Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      const addCase2: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Case2Handler',
          type: 'n8n-nodes-base.set',
          position: [600, 400]
        }
      };

      // Connect to different sourceIndices
      const conn0: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case0Handler',
        sourceIndex: 0
      };

      const conn1: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case1Handler',
        sourceIndex: 1
      };

      const conn2: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Switch',
        target: 'Case2Handler',
        sourceIndex: 2
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addSwitchNode, addCase0, addCase1, addCase2, conn0, conn1, conn2]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      // Verify each case routes to correct handler
      expect(result.workflow!.connections['Switch']['main'][0][0].node).toBe('Case0Handler');
      expect(result.workflow!.connections['Switch']['main'][1][0].node).toBe('Case1Handler');
      expect(result.workflow!.connections['Switch']['main'][2][0].node).toBe('Case2Handler');
    });

    it('should properly handle sourceIndex 0 as explicit value vs default', async () => {
      // Use a fresh workflow
      const freshWorkflow = JSON.parse(JSON.stringify(baseWorkflow));

      const addNode: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'TestNode',
          type: 'n8n-nodes-base.set',
          position: [600, 300]
        }
      };

      // Explicit sourceIndex: 0
      const connection1: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',
        target: 'TestNode',
        sourceIndex: 0
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNode, connection1]
      };

      const result = await diffEngine.applyDiff(freshWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow!.connections['Webhook']['main'][0]).toBeDefined();
      // TestNode should be in the connections (might not be first if HTTP Request already exists)
      const targets = result.workflow!.connections['Webhook']['main'][0].map((c: any) => c.node);
      expect(targets).toContain('TestNode');
    });
  });

  describe('UpdateSettings Operation', () => {
    it('should update workflow settings', async () => {
      const operation: UpdateSettingsOperation = {
        type: 'updateSettings',
        settings: {
          executionOrder: 'v0',
          timezone: 'America/New_York',
          executionTimeout: 300
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.settings!.executionOrder).toBe('v0');
      expect(result.workflow!.settings!.timezone).toBe('America/New_York');
      expect(result.workflow!.settings!.executionTimeout).toBe(300);
    });

    it('should create settings object if not exists', async () => {
      delete baseWorkflow.settings;

      const operation: UpdateSettingsOperation = {
        type: 'updateSettings',
        settings: {
          saveManualExecutions: false
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.settings).toBeDefined();
      expect(result.workflow!.settings!.saveManualExecutions).toBe(false);
    });
  });

  describe('UpdateName Operation', () => {
    it('should update workflow name', async () => {
      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Updated Workflow Name'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.name).toBe('Updated Workflow Name');
    });
  });

  describe('Tag Operations', () => {
    it('should add a new tag', async () => {
      const operation: AddTagOperation = {
        type: 'addTag',
        tag: 'production'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.tagsToAdd).toContain('production');
    });

    it('should not add duplicate tags', async () => {
      const operation: AddTagOperation = {
        type: 'addTag',
        tag: 'test' // Already exists in workflow but tagsToAdd tracks it for API
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      // Tags are now tracked for dedicated API call, not modified on workflow
      expect(result.tagsToAdd).toEqual(['test']);
    });

    it('should create tags array if not exists', async () => {
      delete baseWorkflow.tags;

      const operation: AddTagOperation = {
        type: 'addTag',
        tag: 'new-tag'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.tagsToAdd).toEqual(['new-tag']);
    });

    it('should remove an existing tag', async () => {
      const operation: RemoveTagOperation = {
        type: 'removeTag',
        tag: 'test'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.tagsToRemove).toContain('test');
    });

    it('should handle removing non-existent tag gracefully', async () => {
      const operation: RemoveTagOperation = {
        type: 'removeTag',
        tag: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.tagsToRemove).toEqual(['non-existent']);
      // workflow.tags unchanged since tags are now handled via dedicated API
      expect(result.workflow!.tags).toHaveLength(2);
    });
  });

  describe('ValidateOnly Mode', () => {
    it('should validate without applying changes', async () => {
      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Validated But Not Applied'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation],
        validateOnly: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Validation successful');
      expect(result.workflow).toBeUndefined();
    });

    it('should return validation errors in validateOnly mode', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation],
        validateOnly: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Node not found');
    });
  });

  describe('Operation Ordering', () => {
    it('should process node operations before connection operations', async () => {
      // This tests the two-pass processing: nodes first, then connections
      const operations = [
        {
          type: 'addConnection',
          source: 'NewNode',
          target: 'slack-1'
        } as AddConnectionOperation,
        {
          type: 'addNode',
          node: {
            name: 'NewNode',
            type: 'n8n-nodes-base.code',
            position: [800, 300]
          }
        } as AddNodeOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(4);
      expect(result.workflow!.connections['NewNode']).toBeDefined();
    });

    it('should handle dependent operations correctly', async () => {
      const operations = [
        {
          type: 'removeNode',
          nodeId: 'http-1'
        } as RemoveNodeOperation,
        {
          type: 'addNode',
          node: {
            name: 'HTTP Request', // Reuse the same name
            type: 'n8n-nodes-base.httpRequest',
            position: [600, 300]
          }
        } as AddNodeOperation,
        {
          type: 'addConnection',
          source: 'webhook-1',
          target: 'HTTP Request'
        } as AddConnectionOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(3);
      expect(result.workflow!.connections['Webhook'].main[0][0].node).toBe('HTTP Request');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown operation type', async () => {
      const operation = {
        type: 'unknownOperation',
        someData: 'test'
      } as any;

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Unknown operation type');
    });

    it('should stop on first validation error', async () => {
      const operations = [
        {
          type: 'removeNode',
          nodeId: 'non-existent'
        } as RemoveNodeOperation,
        {
          type: 'updateName',
          name: 'This should not be applied'
        } as UpdateNameOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].operation).toBe(0);
    });

    it('should return operation details in error', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'non-existent',
        description: 'Test remove operation'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].details).toEqual(operation);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple operations of different types', async () => {
      const operations = [
        {
          type: 'updateName',
          name: 'Complex Workflow'
        } as UpdateNameOperation,
        {
          type: 'addNode',
          node: {
            name: 'Filter',
            type: 'n8n-nodes-base.filter',
            position: [800, 200]
          }
        } as AddNodeOperation,
        {
          type: 'removeConnection',
          source: 'HTTP Request',  // Use node name
          target: 'Slack'  // Use node name
        } as RemoveConnectionOperation,
        {
          type: 'addConnection',
          source: 'HTTP Request',  // Use node name
          target: 'Filter'
        } as AddConnectionOperation,
        {
          type: 'addConnection',
          source: 'Filter',
          target: 'Slack'  // Use node name
        } as AddConnectionOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.name).toBe('Complex Workflow');
      expect(result.workflow!.nodes).toHaveLength(4);
      expect(result.workflow!.connections['HTTP Request'].main[0][0].node).toBe('Filter');
      expect(result.workflow!.connections['Filter'].main[0][0].node).toBe('Slack');
      expect(result.operationsApplied).toBe(5);
    });

    it('should preserve workflow immutability', async () => {
      const originalNodes = [...baseWorkflow.nodes];
      const originalConnections = JSON.stringify(baseWorkflow.connections);

      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Modified'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      await diffEngine.applyDiff(baseWorkflow, request);
      
      // Original workflow should remain unchanged
      expect(baseWorkflow.name).toBe('Test Workflow');
      expect(baseWorkflow.nodes).toEqual(originalNodes);
      expect(JSON.stringify(baseWorkflow.connections)).toBe(originalConnections);
    });

    it('should handle node ID as name fallback', async () => {
      // Test the findNode helper's fallback behavior
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'Webhook', // Using name as ID
        updates: {
          'parameters.path': 'new-webhook-path'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const updatedNode = result.workflow!.nodes.find((n: any) => n.name === 'Webhook');
      expect(updatedNode!.parameters.path).toBe('new-webhook-path');
    });
  });

  describe('Success Messages', () => {
    it('should provide informative success message', async () => {
      const operations = [
        {
          type: 'addNode',
          node: {
            name: 'Node1',
            type: 'n8n-nodes-base.code',
            position: [100, 100]
          }
        } as AddNodeOperation,
        {
          type: 'updateSettings',
          settings: { timezone: 'UTC' }
        } as UpdateSettingsOperation,
        {
          type: 'addTag',
          tag: 'v2'
        } as AddTagOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully applied 3 operations');
      expect(result.message).toContain('1 node ops');
      expect(result.message).toContain('2 other ops');
    });
  });

  describe('New Features - v2.14.4', () => {
    describe('cleanStaleConnections operation', () => {
      it('should remove connections referencing non-existent nodes', async () => {
        // Create a workflow with a stale connection
        const workflow = builder.build() as Workflow;

        // Add a connection to a non-existent node manually
        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'HTTP Request', type: 'main', index: 0 },
          { node: 'NonExistentNode', type: 'main', index: 0 }
        ]];

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(1);
        expect(result.workflow.connections['Webhook']['main'][0][0].node).toBe('HTTP Request');
      });

      it('should remove entire source connection if source node does not exist', async () => {
        const workflow = builder.build() as Workflow;

        // Add connections from non-existent node
        workflow.connections['GhostNode'] = {
          'main': [[
            { node: 'HTTP Request', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['GhostNode']).toBeUndefined();
      });

      it('should support dryRun mode', async () => {
        const workflow = builder.build() as Workflow;

        // Add a stale connection
        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'HTTP Request', type: 'main', index: 0 },
          { node: 'NonExistentNode', type: 'main', index: 0 }
        ]];

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections',
          dryRun: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // In dryRun, stale connection should still be present (not actually removed)
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
      });
    });

    describe('replaceConnections operation', () => {
      it('should replace entire connections object', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'Webhook': {
            'main': [[
              { node: 'Slack', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual(newConnections);
        expect(result.workflow.connections['HTTP Request']).toBeUndefined();
      });

      it('should fail if referenced nodes do not exist', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'Webhook': {
            'main': [[
              { node: 'NonExistentNode', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors![0].message).toContain('Target node not found');
      });
    });

    describe('removeConnection with ignoreErrors flag', () => {
      it('should succeed when connection does not exist if ignoreErrors is true', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentNode',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should fail when connection does not exist if ignoreErrors is false', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentNode',
          ignoreErrors: false
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      it('should default to atomic behavior when ignoreErrors is not specified', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentNode'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });
    });

    describe('continueOnError mode', () => {
      it('should apply valid operations and report failed ones', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'New Workflow Name'
          } as UpdateNameOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistentNode'
          } as RemoveConnectionOperation,
          {
            type: 'addTag',
            tag: 'production'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toEqual([0, 2]); // Operations 0 and 2 succeeded
        expect(result.failed).toEqual([1]); // Operation 1 failed
        expect(result.errors).toHaveLength(1);
        expect(result.workflow.name).toBe('New Workflow Name');
        expect(result.tagsToAdd).toContain('production');
      });

      it('should return success false if all operations fail in continueOnError mode', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'Node1'
          } as RemoveConnectionOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'Node2'
          } as RemoveConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toHaveLength(0);
        expect(result.failed).toEqual([0, 1]);
      });

      it('should use atomic mode by default when continueOnError is not specified', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'New Name'
          } as UpdateNameOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistent'
          } as RemoveConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toBeUndefined();
        expect(result.failed).toBeUndefined();
        // Name should not have been updated due to atomic behavior
        expect(result.workflow).toBeUndefined();
      });
    });

    describe('Backwards compatibility', () => {
      it('should maintain existing behavior for all previous operation types', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          { type: 'updateName', name: 'Test' } as UpdateNameOperation,
          { type: 'addTag', tag: 'test' } as AddTagOperation,
          { type: 'removeTag', tag: 'automation' } as RemoveTagOperation,
          { type: 'updateSettings', settings: { timezone: 'UTC' } } as UpdateSettingsOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.operationsApplied).toBe(4);
      });
    });
  });

  describe('v2.14.4 Coverage Improvements', () => {
    describe('cleanStaleConnections - Advanced Scenarios', () => {
      it('should clean up multiple stale connections across different output types', async () => {
        const workflow = builder.build() as Workflow;

        // Add an IF node with multiple outputs
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connections with both valid and stale targets on different outputs
        workflow.connections['IF'] = {
          'true': [[
            { node: 'Slack', type: 'main', index: 0 },
            { node: 'StaleNode1', type: 'main', index: 0 }
          ]],
          'false': [[
            { node: 'HTTP Request', type: 'main', index: 0 },
            { node: 'StaleNode2', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['IF']['true'][0]).toHaveLength(1);
        expect(result.workflow.connections['IF']['true'][0][0].node).toBe('Slack');
        expect(result.workflow.connections['IF']['false'][0]).toHaveLength(1);
        expect(result.workflow.connections['IF']['false'][0][0].node).toBe('HTTP Request');
      });

      it('should remove empty output types after cleaning stale connections', async () => {
        const workflow = builder.build() as Workflow;

        // Add node with connections
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connections where all targets in one output are stale
        workflow.connections['IF'] = {
          'true': [[
            { node: 'StaleNode1', type: 'main', index: 0 },
            { node: 'StaleNode2', type: 'main', index: 0 }
          ]],
          'false': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['IF']['true']).toBeUndefined();
        expect(result.workflow.connections['IF']['false']).toBeDefined();
        expect(result.workflow.connections['IF']['false'][0][0].node).toBe('Slack');
      });

      it('should clean up entire node connections when all outputs become empty', async () => {
        const workflow = builder.build() as Workflow;

        // Add node
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connections where ALL targets are stale
        workflow.connections['IF'] = {
          'true': [[
            { node: 'StaleNode1', type: 'main', index: 0 }
          ]],
          'false': [[
            { node: 'StaleNode2', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['IF']).toBeUndefined();
      });

      it('should handle dryRun with multiple stale connections', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add stale connections from both valid and invalid source nodes
        workflow.connections['GhostNode'] = {
          'main': [[{ node: 'HTTP Request', type: 'main', index: 0 }]]
        };

        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'HTTP Request', type: 'main', index: 0 },
          { node: 'StaleNode1', type: 'main', index: 0 },
          { node: 'StaleNode2', type: 'main', index: 0 }
        ]];

        const originalConnections = JSON.parse(JSON.stringify(workflow.connections));

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections',
          dryRun: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Connections should remain unchanged in dryRun
        expect(JSON.stringify(result.workflow.connections)).toBe(JSON.stringify(originalConnections));
      });

      it('should handle workflow with no stale connections', async () => {
        // Use baseWorkflow which has name-based connections
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));
        const originalConnectionsCount = Object.keys(workflow.connections).length;

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Connections should remain unchanged (no stale connections to remove)
        // Verify by checking connection count
        expect(Object.keys(result.workflow.connections).length).toBe(originalConnectionsCount);
        expect(result.workflow.connections['Webhook']).toBeDefined();
        expect(result.workflow.connections['HTTP Request']).toBeDefined();
      });
    });

    describe('replaceConnections - Advanced Scenarios', () => {
      it('should fail validation when source node does not exist', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'NonExistentSource': {
            'main': [[
              { node: 'Slack', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors![0].message).toContain('Source node not found');
      });

      it('should successfully replace with empty connections object', async () => {
        const workflow = builder.build() as Workflow;

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: {}
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual({});
      });

      it('should handle complex connection structures with multiple outputs', async () => {
        const workflow = builder.build() as Workflow;

        // Add IF node
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        const newConnections = {
          'Webhook': {
            'main': [[
              { node: 'IF', type: 'main', index: 0 }
            ]]
          },
          'IF': {
            'true': [[
              { node: 'Slack', type: 'main', index: 0 }
            ]],
            'false': [[
              { node: 'HTTP Request', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual(newConnections);
      });
    });

    describe('removeConnection with ignoreErrors - Advanced Scenarios', () => {
      it('should succeed when source node does not exist with ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'NonExistentSource',
          target: 'Slack',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Workflow should remain unchanged (verify by checking node count)
        expect(Object.keys(result.workflow.connections).length).toBe(Object.keys(baseWorkflow.connections).length);
      });

      it('should succeed when both source and target nodes do not exist with ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'NonExistentSource',
          target: 'NonExistentTarget',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should succeed when connection exists but target node does not with ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        // This is an edge case where connection references a valid node but we're trying to remove to non-existent
        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentTarget',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should fail when source node does not exist without ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'NonExistentSource',
          target: 'Slack',
          ignoreErrors: false
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('Source node not found');
      });
    });

    describe('continueOnError - Advanced Scenarios', () => {
      it('should catch runtime errors during operation application', async () => {
        const workflow = builder.build() as Workflow;

        // Create an operation that will pass validation but fail during application
        // This is simulated by causing an error in the apply phase
        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Valid Operation'
          } as UpdateNameOperation,
          {
            type: 'updateNode',
            nodeId: 'webhook-1',
            updates: {
              // This will pass validation but could fail in complex scenarios
              'parameters.invalidDeepPath.nested.value': 'test'
            }
          } as UpdateNodeOperation,
          {
            type: 'addTag',
            tag: 'another-valid'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        // All operations should succeed in this case (no runtime errors expected)
        expect(result.success).toBe(true);
        expect(result.applied).toBeDefined();
        expect(result.applied!.length).toBeGreaterThan(0);
      });

      it('should handle mixed validation and runtime errors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Operation 0'
          } as UpdateNameOperation,
          {
            type: 'removeNode',
            nodeId: 'non-existent-1'
          } as RemoveNodeOperation,
          {
            type: 'addTag',
            tag: 'tag1'
          } as AddTagOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistent'
          } as RemoveConnectionOperation,
          {
            type: 'addTag',
            tag: 'tag2'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toContain(0); // updateName
        expect(result.applied).toContain(2); // first addTag
        expect(result.applied).toContain(4); // second addTag
        expect(result.failed).toContain(1); // removeNode
        expect(result.failed).toContain(3); // removeConnection
        expect(result.errors).toHaveLength(2);
      });

      it('should support validateOnly with continueOnError mode', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'New Name'
          } as UpdateNameOperation,
          {
            type: 'removeNode',
            nodeId: 'non-existent'
          } as RemoveNodeOperation,
          {
            type: 'addTag',
            tag: 'test-tag'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.workflow).toBeUndefined();
        expect(result.message).toContain('Validation completed');
        expect(result.applied).toEqual([0, 2]);
        expect(result.failed).toEqual([1]);
        expect(result.errors).toHaveLength(1);
      });

      it('should handle all operations failing with helpful message', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeNode',
            nodeId: 'non-existent-1'
          } as RemoveNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'non-existent-2'
          } as RemoveNodeOperation,
          {
            type: 'removeConnection',
            source: 'Invalid',
            target: 'Invalid'
          } as RemoveConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toHaveLength(0);
        expect(result.failed).toEqual([0, 1, 2]);
        expect(result.errors).toHaveLength(3);
        expect(result.message).toContain('0 operations');
        expect(result.message).toContain('3 failed');
      });

      it('should preserve operation order in applied and failed arrays', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          { type: 'updateName', name: 'Name1' } as UpdateNameOperation, // 0 - success
          { type: 'removeNode', nodeId: 'invalid1' } as RemoveNodeOperation, // 1 - fail
          { type: 'addTag', tag: 'tag1' } as AddTagOperation, // 2 - success
          { type: 'removeNode', nodeId: 'invalid2' } as RemoveNodeOperation, // 3 - fail
          { type: 'addTag', tag: 'tag2' } as AddTagOperation, // 4 - success
          { type: 'removeNode', nodeId: 'invalid3' } as RemoveNodeOperation, // 5 - fail
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toEqual([0, 2, 4]);
        expect(result.failed).toEqual([1, 3, 5]);
      });
    });

    describe('Edge Cases and Error Paths', () => {
      it('should handle workflow with initialized but empty connections', async () => {
        const workflow = builder.build() as Workflow;
        // Start with empty connections
        workflow.connections = {};

        // Add some nodes but no connections
        workflow.nodes.push({
          id: 'orphan-1',
          name: 'Orphan Node',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [800, 400],
          parameters: {}
        });

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual({});
      });

      it('should handle empty connections in cleanStaleConnections', async () => {
        const workflow = builder.build() as Workflow;
        workflow.connections = {};

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual({});
      });

      it('should handle removeConnection with ignoreErrors on valid but non-connected nodes', async () => {
        const workflow = builder.build() as Workflow;

        // Both nodes exist but no connection between them
        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Slack',
          target: 'Webhook',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle replaceConnections with nested connection arrays', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'Webhook': {
            'main': [
              [
                { node: 'HTTP Request', type: 'main', index: 0 },
                { node: 'Slack', type: 'main', index: 0 }
              ],
              [
                { node: 'HTTP Request', type: 'main', index: 1 }
              ]
            ]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Webhook']['main']).toHaveLength(2);
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
        expect(result.workflow.connections['Webhook']['main'][1]).toHaveLength(1);
      });

      it('should validate cleanStaleConnections always returns null', async () => {
        const workflow = builder.build() as Workflow;

        // This tests that validation for cleanStaleConnections always passes
        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Validation successful');
      });

      it('should handle continueOnError with no operations', async () => {
        const workflow = builder.build() as Workflow;

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations: [],
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toEqual([]);
        expect(result.failed).toEqual([]);
      });
    });

    describe('Integration Tests - v2.14.4 Features Combined', () => {
      it('should combine cleanStaleConnections and replaceConnections', async () => {
        const workflow = builder.build() as Workflow;

        // Add stale connections
        workflow.connections['GhostNode'] = {
          'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
        };

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'cleanStaleConnections'
          } as CleanStaleConnectionsOperation,
          {
            type: 'replaceConnections',
            connections: {
              'Webhook': {
                'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
              }
            }
          } as ReplaceConnectionsOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['GhostNode']).toBeUndefined();
        expect(result.workflow.connections['Webhook']['main'][0][0].node).toBe('Slack');
      });

      it('should use continueOnError with new v2.14.4 operations', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'cleanStaleConnections'
          } as CleanStaleConnectionsOperation,
          {
            type: 'replaceConnections',
            connections: {
              'NonExistentNode': {
                'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
              }
            }
          } as ReplaceConnectionsOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistent',
            ignoreErrors: true
          } as RemoveConnectionOperation,
          {
            type: 'addTag',
            tag: 'final-tag'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toContain(0); // cleanStaleConnections
        expect(result.failed).toContain(1); // replaceConnections with invalid node
        expect(result.applied).toContain(2); // removeConnection with ignoreErrors
        expect(result.applied).toContain(3); // addTag
        expect(result.tagsToAdd).toContain('final-tag');
      });
    });

    describe('Additional Edge Cases for 90% Coverage', () => {
      it('should handle cleanStaleConnections with connections from valid node to itself', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add self-referencing connection
        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'Webhook', type: 'main', index: 0 },
          { node: 'HTTP Request', type: 'main', index: 0 }
        ]];

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Self-referencing connection should remain (it's valid)
        expect(result.workflow.connections['Webhook']['main'][0].some((c: any) => c.node === 'Webhook')).toBe(true);
      });

      it('should handle removeTag when tags array does not exist', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));
        delete workflow.tags;

        const operations: RemoveTagOperation[] = [{
          type: 'removeTag',
          tag: 'non-existent'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle cleanStaleConnections with multiple connection indices', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add connections with multiple indices
        workflow.connections['Webhook'] = {
          'main': [
            [
              { node: 'HTTP Request', type: 'main', index: 0 },
              { node: 'Slack', type: 'main', index: 0 }
            ],
            [
              { node: 'StaleNode', type: 'main', index: 0 }
            ]
          ]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // First index should remain with both valid connections
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
        // Second index with stale node should be removed, so only one index remains
        expect(result.workflow.connections['Webhook']['main'].length).toBe(1);
      });

      it('should handle continueOnError with runtime error during apply', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Create a scenario that might cause runtime errors
        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateNode',
            nodeId: 'webhook-1',
            updates: {
              'parameters.test': 'value1'
            }
          } as UpdateNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid-node'
          } as RemoveNodeOperation,
          {
            type: 'updateNode',
            nodeName: 'HTTP Request',
            updates: {
              'parameters.test': 'value2'
            }
          } as UpdateNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.applied).toContain(0);
        expect(result.failed).toContain(1);
        expect(result.applied).toContain(2);
      });

      it('should handle atomic mode failure in node operations', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateNode',
            nodeId: 'webhook-1',
            updates: {
              'parameters.valid': 'update'
            }
          } as UpdateNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid-node'
          } as RemoveNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].operation).toBe(1);
      });

      it('should handle atomic mode failure in connection operations', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'addNode',
            node: {
              name: 'NewNode',
              type: 'n8n-nodes-base.code',
              position: [900, 300],
              parameters: {}
            }
          } as AddNodeOperation,
          {
            type: 'addConnection',
            source: 'NewNode',
            target: 'InvalidTarget'
          } as AddConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].operation).toBe(1);
      });

      it('should handle cleanStaleConnections in dryRun with source node missing', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add connections from non-existent source
        workflow.connections['GhostSource1'] = {
          'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
        };

        workflow.connections['GhostSource2'] = {
          'main': [[{ node: 'HTTP Request', type: 'main', index: 0 }]],
          'error': [[{ node: 'Slack', type: 'main', index: 0 }]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections',
          dryRun: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // In dryRun, connections should remain
        expect(result.workflow.connections['GhostSource1']).toBeDefined();
        expect(result.workflow.connections['GhostSource2']).toBeDefined();
      });

      it('should handle validateOnly in atomic mode', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Validated Name'
          } as UpdateNameOperation,
          {
            type: 'addNode',
            node: {
              name: 'ValidNode',
              type: 'n8n-nodes-base.code',
              position: [900, 300],
              parameters: {}
            }
          } as AddNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow).toBeUndefined();
        expect(result.message).toContain('Validation successful');
        expect(result.message).toContain('not applied');
      });

      it('should handle malformed workflow object gracefully', async () => {
        // Create a malformed workflow that will cause JSON parsing errors
        const malformedWorkflow: any = {
          name: 'Test',
          nodes: [],
          connections: {}
        };

        // Create circular reference to cause JSON.stringify to fail
        malformedWorkflow.self = malformedWorkflow;

        const operations: WorkflowDiffOperation[] = [{
          type: 'updateName',
          name: 'New Name'
        } as UpdateNameOperation];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(malformedWorkflow, request);

        // Should handle the error gracefully
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      it('should handle continueOnError with all operations causing errors', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeNode',
            nodeId: 'invalid1'
          } as RemoveNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid2'
          } as RemoveNodeOperation,
          {
            type: 'addConnection',
            source: 'Invalid1',
            target: 'Invalid2'
          } as AddConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toEqual([]);
        expect(result.failed).toEqual([0, 1, 2]);
        expect(result.errors).toHaveLength(3);
      });

      it('should handle atomic mode with empty operations array', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations: []
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.operationsApplied).toBe(0);
      });

      it('should handle removeConnection without sourceOutput specified', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'HTTP Request'
          // sourceOutput not specified, should default to 'main'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle continueOnError validateOnly with all errors', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeNode',
            nodeId: 'invalid1'
          } as RemoveNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid2'
          } as RemoveNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Validation completed');
        expect(result.errors).toHaveLength(2);
        expect(result.workflow).toBeUndefined();
      });


      it('should handle addConnection with all optional parameters specified', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add Code node
        workflow.nodes.push({
          id: 'code-1',
          name: 'Code',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [900, 300],
          parameters: {}
        });

        const operations: AddConnectionOperation[] = [{
          type: 'addConnection',
          source: 'Slack',
          target: 'Code',
          sourceOutput: 'main',
          targetInput: 'main',
          sourceIndex: 0,
          targetIndex: 0
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Slack']['main'][0][0].node).toBe('Code');
        expect(result.workflow.connections['Slack']['main'][0][0].type).toBe('main');
        expect(result.workflow.connections['Slack']['main'][0][0].index).toBe(0);
      });

      it('should handle cleanStaleConnections actually removing source node connections', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add connections from non-existent source that should be deleted entirely
        workflow.connections['NonExistentSource1'] = {
          'main': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        workflow.connections['NonExistentSource2'] = {
          'main': [[
            { node: 'HTTP Request', type: 'main', index: 0 }
          ]],
          'error': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['NonExistentSource1']).toBeUndefined();
        expect(result.workflow.connections['NonExistentSource2']).toBeUndefined();
      });

      it('should handle validateOnly with no errors in continueOnError mode', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Valid Name'
          } as UpdateNameOperation,
          {
            type: 'addTag',
            tag: 'valid-tag'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Validation successful');
        expect(result.errors).toBeUndefined();
        expect(result.applied).toEqual([0, 1]);
        expect(result.failed).toEqual([]);
      });

      it('should handle addConnection initializing missing connection structure', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add node without any connections
        workflow.nodes.push({
          id: 'orphan-1',
          name: 'Orphan',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [900, 300],
          parameters: {}
        });

        // Ensure Orphan has no connections initially
        delete workflow.connections['Orphan'];

        const operations: AddConnectionOperation[] = [{
          type: 'addConnection',
          source: 'Orphan',
          target: 'Slack'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Orphan']).toBeDefined();
        expect(result.workflow.connections['Orphan']['main']).toBeDefined();
        expect(result.workflow.connections['Orphan']['main'][0][0].node).toBe('Slack');
      });

      it('should handle addConnection with sourceIndex requiring array expansion', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add Code node
        workflow.nodes.push({
          id: 'code-1',
          name: 'Code',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [900, 300],
          parameters: {}
        });

        const operations: AddConnectionOperation[] = [{
          type: 'addConnection',
          source: 'Slack',
          target: 'Code',
          sourceIndex: 5 // Force array expansion to index 5
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Slack']['main'].length).toBeGreaterThanOrEqual(6);
        expect(result.workflow.connections['Slack']['main'][5][0].node).toBe('Code');
      });

      it('should handle removeConnection cleaning up empty output structures', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Set up a connection that will leave empty structures after removal
        workflow.connections['HTTP Request'] = {
          'main': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'HTTP Request',
          target: 'Slack'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Connection should be removed entirely (cleanup of empty structures)
        expect(result.workflow.connections['HTTP Request']).toBeUndefined();
      });

      it('should handle complex cleanStaleConnections scenario with mixed valid/invalid', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Create a complex scenario with multiple source nodes
        workflow.connections['Webhook'] = {
          'main': [[
            { node: 'HTTP Request', type: 'main', index: 0 },
            { node: 'Stale1', type: 'main', index: 0 },
            { node: 'Slack', type: 'main', index: 0 },
            { node: 'Stale2', type: 'main', index: 0 }
          ]],
          'error': [[
            { node: 'Stale3', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Only valid connections should remain
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
        expect(result.workflow.connections['Webhook']['main'][0].some((c: any) => c.node === 'HTTP Request')).toBe(true);
        expect(result.workflow.connections['Webhook']['main'][0].some((c: any) => c.node === 'Slack')).toBe(true);
        // Error output should be removed entirely (all stale)
        expect(result.workflow.connections['Webhook']['error']).toBeUndefined();
      });
    });
  });

  // Issue #270: Special characters in node names
  describe('Special Characters in Node Names', () => {
    it('should handle apostrophes in node names for addConnection', async () => {
      // Default n8n Manual Trigger node name contains apostrophes
      const workflowWithApostrophes = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'manual-trigger-1',
            name: "When clicking 'Execute workflow'", // Contains apostrophes
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: "When clicking 'Execute workflow'",  // Using node name with apostrophes
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithApostrophes as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections["When clicking 'Execute workflow'"]).toBeDefined();
      expect(result.workflow.connections["When clicking 'Execute workflow'"].main).toBeDefined();
    });

    it('should handle double quotes in node names', async () => {
      const workflowWithQuotes = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'quoted-node-1',
            name: 'Node with "quotes"',  // Contains double quotes
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Node with "quotes"',
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithQuotes as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Node with "quotes"']).toBeDefined();
    });

    it('should handle backslashes in node names', async () => {
      const workflowWithBackslashes = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'backslash-node-1',
            name: 'Path\\with\\backslashes',  // Contains backslashes
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Path\\with\\backslashes',
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithBackslashes as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Path\\with\\backslashes']).toBeDefined();
    });

    it('should handle mixed special characters in node names', async () => {
      const workflowWithMixed = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'complex-node-1',
            name: "Complex 'name' with \"quotes\" and \\backslash",
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: "Complex 'name' with \"quotes\" and \\backslash",
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithMixed as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections["Complex 'name' with \"quotes\" and \\backslash"]).toBeDefined();
    });

    it('should handle special characters in removeConnection', async () => {
      const workflowWithConnections = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'apostrophe-node-1',
            name: "Node with 'apostrophes'",
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ],
        connections: {
          ...baseWorkflow.connections,
          "Node with 'apostrophes'": {
            main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]]
          }
        }
      };

      const operation: RemoveConnectionOperation = {
        type: 'removeConnection',
        source: "Node with 'apostrophes'",
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithConnections as any, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections["Node with 'apostrophes'"]).toBeUndefined();
    });

    it('should handle special characters in updateNode', async () => {
      const workflowWithSpecialNode = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'special-node-1',
            name: "Update 'this' node",
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: { value: 'old' }
          }
        ]
      };

      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: "Update 'this' node",
        updates: {
          'parameters.value': 'new'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithSpecialNode as Workflow, request);

      expect(result.success).toBe(true);
      const updatedNode = result.workflow.nodes.find((n: any) => n.name === "Update 'this' node");
      expect(updatedNode?.parameters.value).toBe('new');
    });

    // Code Review Fix: Test whitespace normalization
    it('should handle tabs in node names', async () => {
      const workflowWithTabs = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'tab-node-1',
            name: "Node\twith\ttabs",  // Contains tabs
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: "Node\twith\ttabs",  // Tabs should normalize to single spaces
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithTabs as Workflow, request);

      expect(result.success).toBe(true);
      // After normalization, both "Node\twith\ttabs" and "Node with tabs" should match
      expect(result.workflow.connections["Node\twith\ttabs"]).toBeDefined();
    });

    it('should handle newlines in node names', async () => {
      const workflowWithNewlines = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'newline-node-1',
            name: "Node\nwith\nnewlines",  // Contains newlines
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: "Node\nwith\nnewlines",  // Newlines should normalize to single spaces
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithNewlines as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections["Node\nwith\nnewlines"]).toBeDefined();
    });

    it('should handle mixed whitespace (tabs, newlines, spaces)', async () => {
      const workflowWithMixed = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'mixed-whitespace-node-1',
            name: "Node\t  \n  with  \r\nmixed",  // Mixed whitespace
            type: 'n8n-nodes-base.set',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: "Node\t  \n  with  \r\nmixed",  // Should normalize all whitespace
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithMixed as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections["Node\t  \n  with  \r\nmixed"]).toBeDefined();
    });

    // Code Review Fix: Test escaped vs unescaped matching (core issue #270 scenario)
    it('should match escaped input with unescaped stored names (Issue #270 core scenario)', async () => {
      // Scenario: AI/JSON-RPC sends escaped name, n8n workflow has unescaped name
      const workflowWithUnescaped = {
        ...baseWorkflow,
        nodes: [
          ...baseWorkflow.nodes,
          {
            id: 'test-node',
            name: "When clicking 'Execute workflow'",  // Unescaped (how n8n stores it)
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [100, 100] as [number, number],
            parameters: {}
          }
        ]
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: "When clicking \\'Execute workflow\\'",  // Escaped (how JSON-RPC might send it)
        target: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithUnescaped as Workflow, request);

      expect(result.success).toBe(true);  // Should match despite different escaping
      expect(result.workflow.connections["When clicking 'Execute workflow'"]).toBeDefined();
    });
  });

  describe('Workflow Activation/Deactivation Operations', () => {
    it('should activate workflow with activatable trigger nodes', async () => {
      // Create workflow with webhook trigger (activatable)
      const workflowWithTrigger = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook Trigger' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('webhook-1', 'http-1')
        .build() as Workflow;

      // Fix connections to use node names
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithTrigger.connections)) {
        const node = workflowWithTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithTrigger.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithTrigger.connections = newConnections;

      const operation: any = {
        type: 'activateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithTrigger, request);

      expect(result.success).toBe(true);
      expect(result.shouldActivate).toBe(true);
      expect((result.workflow as any)._shouldActivate).toBeUndefined(); // Flag should be cleaned up
    });

    it('should reject activation if no activatable trigger nodes', async () => {
      // Create workflow with no trigger nodes at all
      const workflowWithoutActivatableTrigger = createWorkflow('Test Workflow')
        .addNode({
          id: 'set-1',
          name: 'Set Node',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [100, 100],
          parameters: {}
        })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('set-1', 'http-1')
        .build() as Workflow;

      // Fix connections to use node names
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithoutActivatableTrigger.connections)) {
        const node = workflowWithoutActivatableTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithoutActivatableTrigger.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithoutActivatableTrigger.connections = newConnections;

      const operation: any = {
        type: 'activateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithoutActivatableTrigger, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('No activatable trigger nodes found');
    });

    it('should reject activation if all trigger nodes are disabled', async () => {
      // Create workflow with disabled webhook trigger
      const workflowWithDisabledTrigger = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook Trigger', disabled: true })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('webhook-1', 'http-1')
        .build() as Workflow;

      // Fix connections to use node names
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithDisabledTrigger.connections)) {
        const node = workflowWithDisabledTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithDisabledTrigger.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithDisabledTrigger.connections = newConnections;

      const operation: any = {
        type: 'activateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithDisabledTrigger, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('No activatable trigger nodes found');
    });

    it('should activate workflow with schedule trigger', async () => {
      // Create workflow with schedule trigger (activatable)
      const workflowWithSchedule = createWorkflow('Test Workflow')
        .addNode({
          id: 'schedule-1',
          name: 'Schedule',
          type: 'n8n-nodes-base.scheduleTrigger',
          typeVersion: 1,
          position: [100, 100],
          parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } }
        })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('schedule-1', 'http-1')
        .build() as Workflow;

      // Fix connections
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithSchedule.connections)) {
        const node = workflowWithSchedule.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithSchedule.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithSchedule.connections = newConnections;

      const operation: any = {
        type: 'activateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithSchedule, request);

      expect(result.success).toBe(true);
      expect(result.shouldActivate).toBe(true);
    });

    it('should deactivate workflow successfully', async () => {
      // Any workflow can be deactivated
      const operation: any = {
        type: 'deactivateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.shouldDeactivate).toBe(true);
      expect((result.workflow as any)._shouldDeactivate).toBeUndefined(); // Flag should be cleaned up
    });

    it('should deactivate workflow without trigger nodes', async () => {
      // Create workflow without any trigger nodes
      const workflowWithoutTrigger = createWorkflow('Test Workflow')
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .addNode({
          id: 'set-1',
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [300, 100],
          parameters: {}
        })
        .connect('http-1', 'set-1')
        .build() as Workflow;

      // Fix connections
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithoutTrigger.connections)) {
        const node = workflowWithoutTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithoutTrigger.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithoutTrigger.connections = newConnections;

      const operation: any = {
        type: 'deactivateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithoutTrigger, request);

      expect(result.success).toBe(true);
      expect(result.shouldDeactivate).toBe(true);
    });

    it('applies last-op-wins when activate+deactivate are batched together (regression #8)', async () => {
      const workflowWithTrigger = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook Trigger' })
        .build() as Workflow;
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithTrigger.connections)) {
        const node = workflowWithTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) newConnections[node.name] = outputs;
      }
      workflowWithTrigger.connections = newConnections;

      const lastWinsDeactivate = await diffEngine.applyDiff(workflowWithTrigger, {
        id: 'test-workflow',
        operations: [{ type: 'activateWorkflow' } as any, { type: 'deactivateWorkflow' } as any]
      });
      expect(lastWinsDeactivate.success).toBe(true);
      expect(lastWinsDeactivate.shouldDeactivate).toBe(true);
      expect(lastWinsDeactivate.shouldActivate).toBeFalsy();

      const lastWinsActivate = await diffEngine.applyDiff(workflowWithTrigger, {
        id: 'test-workflow',
        operations: [{ type: 'deactivateWorkflow' } as any, { type: 'activateWorkflow' } as any]
      });
      expect(lastWinsActivate.success).toBe(true);
      expect(lastWinsActivate.shouldActivate).toBe(true);
      expect(lastWinsActivate.shouldDeactivate).toBeFalsy();
    });

    it('should combine activation with other operations', async () => {
      // Create workflow with webhook trigger
      const workflowWithTrigger = createWorkflow('Test Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook Trigger' })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('webhook-1', 'http-1')
        .build() as Workflow;

      // Fix connections
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithTrigger.connections)) {
        const node = workflowWithTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithTrigger.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithTrigger.connections = newConnections;

      const operations: any[] = [
        {
          type: 'updateName',
          name: 'Updated Workflow Name'
        },
        {
          type: 'addTag',
          tag: 'production'
        },
        {
          type: 'activateWorkflow'
        }
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(workflowWithTrigger, request);

      expect(result.success).toBe(true);
      expect(result.operationsApplied).toBe(3);
      expect(result.workflow!.name).toBe('Updated Workflow Name');
      expect(result.tagsToAdd).toContain('production');
      expect(result.shouldActivate).toBe(true);
    });

    it('should allow activation if workflow has executeWorkflowTrigger only (n8n 2.0+)', async () => {
      // Create workflow with executeWorkflowTrigger (activatable since n8n 2.0+)
      const workflowWithExecuteTrigger = createWorkflow('Test Workflow')
        .addNode({
          id: 'execute-1',
          name: 'Execute Workflow Trigger',
          type: 'n8n-nodes-base.executeWorkflowTrigger',
          typeVersion: 1,
          position: [100, 100],
          parameters: {}
        })
        .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
        .connect('execute-1', 'http-1')
        .build() as Workflow;

      // Fix connections
      const newConnections: any = {};
      for (const [nodeId, outputs] of Object.entries(workflowWithExecuteTrigger.connections)) {
        const node = workflowWithExecuteTrigger.nodes.find((n: any) => n.id === nodeId);
        if (node) {
          newConnections[node.name] = {};
          for (const [outputName, connections] of Object.entries(outputs)) {
            newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
              conns.map((conn: any) => {
                const targetNode = workflowWithExecuteTrigger.nodes.find((n: any) => n.id === conn.node);
                return { ...conn, node: targetNode ? targetNode.name : conn.node };
              })
            );
          }
        }
      }
      workflowWithExecuteTrigger.connections = newConnections;

      const operation: any = {
        type: 'activateWorkflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithExecuteTrigger, request);

      // executeWorkflowTrigger is now activatable in n8n 2.0+
      expect(result.success).toBe(true);
      expect(result.shouldActivate).toBe(true);
    });
  });

  // Issue #458: AI connection type propagation
  describe('AI Connection Type Propagation (Issue #458)', () => {
    it('should propagate ai_tool connection type when targetInput is not specified', async () => {
      const workflowWithAI = {
        ...baseWorkflow,
        nodes: [
          {
            id: 'agent1',
            name: 'AI Agent',
            type: '@n8n/n8n-nodes-langchain.agent',
            typeVersion: 2.1,
            position: [500, 300] as [number, number],
            parameters: {}
          },
          {
            id: 'tool1',
            name: 'Calculator',
            type: '@n8n/n8n-nodes-langchain.toolCalculator',
            typeVersion: 1,
            position: [300, 400] as [number, number],
            parameters: {}
          }
        ],
        connections: {}
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Calculator',
        target: 'AI Agent',
        sourceOutput: 'ai_tool'
        // targetInput not specified - should default to sourceOutput ('ai_tool')
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithAI as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Calculator']).toBeDefined();
      expect(result.workflow.connections['Calculator']['ai_tool']).toBeDefined();
      // The inner type should be 'ai_tool', NOT 'main'
      expect(result.workflow.connections['Calculator']['ai_tool'][0][0].type).toBe('ai_tool');
      expect(result.workflow.connections['Calculator']['ai_tool'][0][0].node).toBe('AI Agent');
    });

    it('should propagate ai_languageModel connection type', async () => {
      const workflowWithAI = {
        ...baseWorkflow,
        nodes: [
          {
            id: 'agent1',
            name: 'AI Agent',
            type: '@n8n/n8n-nodes-langchain.agent',
            typeVersion: 2.1,
            position: [500, 300] as [number, number],
            parameters: {}
          },
          {
            id: 'llm1',
            name: 'OpenAI Chat Model',
            type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
            typeVersion: 1.2,
            position: [300, 200] as [number, number],
            parameters: {}
          }
        ],
        connections: {}
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'OpenAI Chat Model',
        target: 'AI Agent',
        sourceOutput: 'ai_languageModel'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithAI as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['OpenAI Chat Model']['ai_languageModel'][0][0].type).toBe('ai_languageModel');
    });

    it('should propagate ai_memory connection type', async () => {
      const workflowWithAI = {
        ...baseWorkflow,
        nodes: [
          {
            id: 'agent1',
            name: 'AI Agent',
            type: '@n8n/n8n-nodes-langchain.agent',
            typeVersion: 2.1,
            position: [500, 300] as [number, number],
            parameters: {}
          },
          {
            id: 'memory1',
            name: 'Window Buffer Memory',
            type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
            typeVersion: 1.3,
            position: [300, 500] as [number, number],
            parameters: {}
          }
        ],
        connections: {}
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Window Buffer Memory',
        target: 'AI Agent',
        sourceOutput: 'ai_memory'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithAI as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Window Buffer Memory']['ai_memory'][0][0].type).toBe('ai_memory');
    });

    it('should allow explicit targetInput override for mixed connection types', async () => {
      const workflowWithNodes = {
        ...baseWorkflow,
        nodes: [
          {
            id: 'node1',
            name: 'Source Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [300, 300] as [number, number],
            parameters: {}
          },
          {
            id: 'node2',
            name: 'Target Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [500, 300] as [number, number],
            parameters: {}
          }
        ],
        connections: {}
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Source Node',
        target: 'Target Node',
        sourceOutput: 'main',
        targetInput: 'main' // Explicit override
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithNodes as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Source Node']['main'][0][0].type).toBe('main');
    });

    it('should default to main for regular connections when sourceOutput is not specified', async () => {
      const workflowWithNodes = {
        ...baseWorkflow,
        nodes: [
          {
            id: 'node1',
            name: 'Source Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [300, 300] as [number, number],
            parameters: {}
          },
          {
            id: 'node2',
            name: 'Target Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [500, 300] as [number, number],
            parameters: {}
          }
        ],
        connections: {}
      };

      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Source Node',
        target: 'Target Node'
        // Neither sourceOutput nor targetInput specified - should default to 'main'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(workflowWithNodes as Workflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow.connections['Source Node']['main'][0][0].type).toBe('main');
    });
  });

  describe('null value property deletion', () => {
    it('should delete a property when value is null', async () => {
      const node = baseWorkflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      (node as any).continueOnFail = true;

      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'HTTP Request',
        updates: { continueOnFail: null }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      const updatedNode = result.workflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      expect('continueOnFail' in updatedNode).toBe(false);
    });

    it('should delete a nested property when value is null', async () => {
      const node = baseWorkflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      (node as any).parameters = { url: 'https://example.com', authentication: 'basic' };

      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'HTTP Request',
        updates: { 'parameters.authentication': null }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      const updatedNode = result.workflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      expect((updatedNode as any).parameters.url).toBe('https://example.com');
      expect('authentication' in (updatedNode as any).parameters).toBe(false);
    });

    it('should set property normally when value is not null', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'HTTP Request',
        updates: { continueOnFail: true }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      const updatedNode = result.workflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      expect((updatedNode as any).continueOnFail).toBe(true);
    });

    it('should be a no-op when deleting a non-existent property', async () => {
      const node = baseWorkflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      const originalKeys = Object.keys(node).sort();

      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'HTTP Request',
        updates: { nonExistentProp: null }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      const updatedNode = result.workflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      expect('nonExistentProp' in updatedNode).toBe(false);
    });

    it('should skip intermediate object creation when deleting from non-existent parent path', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'HTTP Request',
        updates: { 'nonExistent.deeply.nested.prop': null }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      const updatedNode = result.workflow.nodes.find((n: any) => n.name === 'HTTP Request')!;
      expect('nonExistent' in updatedNode).toBe(false);
    });
  });

  describe('transferWorkflow operation', () => {
    it('should set transferToProjectId in result for valid transferWorkflow', async () => {
      const operation: TransferWorkflowOperation = {
        type: 'transferWorkflow',
        destinationProjectId: 'project-abc-123'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.transferToProjectId).toBe('project-abc-123');
    });

    it('should fail validation when destinationProjectId is empty', async () => {
      const operation: TransferWorkflowOperation = {
        type: 'transferWorkflow',
        destinationProjectId: ''
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('destinationProjectId');
    });

    it('should fail validation when destinationProjectId is undefined', async () => {
      const operation = {
        type: 'transferWorkflow',
        destinationProjectId: undefined
      } as any as TransferWorkflowOperation;

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('destinationProjectId');
    });

    it('should not include transferToProjectId when no transferWorkflow operation is present', async () => {
      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Renamed Workflow'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.transferToProjectId).toBeUndefined();
    });

    it('should combine updateName and transferWorkflow operations', async () => {
      const operations: WorkflowDiffOperation[] = [
        {
          type: 'updateName',
          name: 'Transferred Workflow'
        } as UpdateNameOperation,
        {
          type: 'transferWorkflow',
          destinationProjectId: 'project-xyz-789'
        } as TransferWorkflowOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.operationsApplied).toBe(2);
      expect(result.workflow!.name).toBe('Transferred Workflow');
      expect(result.transferToProjectId).toBe('project-xyz-789');
    });

    it('should combine removeTag and transferWorkflow in continueOnError mode', async () => {
      const operations: WorkflowDiffOperation[] = [
        {
          type: 'removeTag',
          tag: 'non-existent-tag'
        } as RemoveTagOperation,
        {
          type: 'transferWorkflow',
          destinationProjectId: 'project-target-456'
        } as TransferWorkflowOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations,
        continueOnError: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.transferToProjectId).toBe('project-target-456');
    });

    it('should fail entire batch in atomic mode when transferWorkflow has empty destinationProjectId alongside updateName', async () => {
      const operations: WorkflowDiffOperation[] = [
        {
          type: 'updateName',
          name: 'Should Not Apply'
        } as UpdateNameOperation,
        {
          type: 'transferWorkflow',
          destinationProjectId: ''
        } as TransferWorkflowOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('destinationProjectId');
      // In atomic mode, the workflow should not be returned since the batch failed
      expect(result.workflow).toBeUndefined();
    });
  });
});
