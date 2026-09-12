import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowAutoFixer } from '@/services/workflow-auto-fixer';
import { NodeRepository } from '@/database/node-repository';
import type { WorkflowValidationResult } from '@/services/workflow-validator';
import type { Workflow, WorkflowNode } from '@/types/n8n-api';

vi.mock('@/database/node-repository');
vi.mock('@/services/node-similarity-service');

describe('WorkflowAutoFixer - Connection Fixes', () => {
  let autoFixer: WorkflowAutoFixer;
  let mockRepository: NodeRepository;

  const createMockWorkflow = (
    nodes: WorkflowNode[],
    connections: any = {}
  ): Workflow => ({
    id: 'test-workflow',
    name: 'Test Workflow',
    active: false,
    nodes,
    connections,
    settings: {},
    createdAt: '',
    updatedAt: ''
  });

  const createMockNode = (id: string, name: string, type: string = 'n8n-nodes-base.noOp'): WorkflowNode => ({
    id,
    name,
    type,
    typeVersion: 1,
    position: [0, 0],
    parameters: {}
  });

  const emptyValidation: WorkflowValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    statistics: {
      totalNodes: 0,
      enabledNodes: 0,
      triggerNodes: 0,
      validConnections: 0,
      invalidConnections: 0,
      expressionsValidated: 0
    },
    suggestions: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = new NodeRepository({} as any);
    vi.spyOn(mockRepository, 'getNodeVersions').mockReturnValue([]);
    autoFixer = new WorkflowAutoFixer(mockRepository);
  });

  describe('Numeric Keys', () => {
    it('should convert single numeric key to main[index]', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            '0': [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-numeric-keys');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].before).toBe('0');
      expect(connFixes[0].after).toBe('main[0]');

      // Verify replaceConnections operation
      const replaceOp = result.operations.find(op => op.type === 'replaceConnections');
      expect(replaceOp).toBeDefined();
      const connOp = replaceOp as any;
      expect(connOp.connections.Node1['main']).toBeDefined();
      expect(connOp.connections.Node1['0']).toBeUndefined();
    });

    it('should convert multiple numeric keys', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2'), createMockNode('id3', 'Node3')],
        {
          Node1: {
            '0': [[{ node: 'Node2', type: 'main', index: 0 }]],
            '1': [[{ node: 'Node3', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-numeric-keys');
      expect(connFixes).toHaveLength(2);
    });

    // A null branch is n8n's own "nothing wired to this output" and survives into a fetched
    // workflow (#1096); spreading it threw "nodeConn.main[index] is not iterable" out of
    // n8n_autofix_workflow, which the handler's catch-all returned as an opaque error.
    it('merges a numeric key into a null main branch instead of throwing', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2'), createMockNode('id3', 'Node3')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 0 }], null],
            '1': [[{ node: 'Node3', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);

      const connFixes = result.fixes.filter(f => f.type === 'connection-numeric-keys');
      expect(connFixes).toHaveLength(1);
      // The null slot held nothing, so this is a conversion, not a merge into existing entries.
      expect(connFixes[0].confidence).toBe('high');

      const replaceOp = result.operations.find(op => op.type === 'replaceConnections') as any;
      expect(replaceOp.connections.Node1['main'][1]).toEqual([{ node: 'Node3', type: 'main', index: 0 }]);
      expect(replaceOp.connections.Node1['1']).toBeUndefined();
    });

    it('should merge with existing main entries', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2'), createMockNode('id3', 'Node3')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]],
            '1': [[{ node: 'Node3', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const replaceOp = result.operations.find(op => op.type === 'replaceConnections') as any;
      expect(replaceOp.connections.Node1['main']).toHaveLength(2);
      expect(replaceOp.connections.Node1['main'][0]).toEqual([{ node: 'Node2', type: 'main', index: 0 }]);
      expect(replaceOp.connections.Node1['main'][1]).toEqual([{ node: 'Node3', type: 'main', index: 0 }]);
    });

    it('should handle sparse numeric keys with gap filling', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2'), createMockNode('id3', 'Node3')],
        {
          Node1: {
            '0': [[{ node: 'Node2', type: 'main', index: 0 }]],
            '3': [[{ node: 'Node3', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const replaceOp = result.operations.find(op => op.type === 'replaceConnections') as any;
      expect(replaceOp.connections.Node1['main']).toHaveLength(4);
      expect(replaceOp.connections.Node1['main'][1]).toEqual([]);
      expect(replaceOp.connections.Node1['main'][2]).toEqual([]);
    });
  });

  describe('Invalid Type', () => {
    it('should fix numeric type to "main"', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: '0', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-invalid-type');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].before).toBe('0');
      expect(connFixes[0].after).toBe('main');
    });

    it('should use parent output key for AI connection types', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            ai_tool: [[{ node: 'Node2', type: '0', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-invalid-type');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].after).toBe('ai_tool');
    });
  });

  describe('ID-to-Name', () => {
    it('should replace source key when it matches a node ID', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('abc-123', 'Node1'), createMockNode('def-456', 'Node2')],
        {
          'abc-123': {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-id-to-name');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].before).toBe('abc-123');
      expect(connFixes[0].after).toBe('Node1');

      const replaceOp = result.operations.find(op => op.type === 'replaceConnections') as any;
      expect(replaceOp.connections['Node1']).toBeDefined();
      expect(replaceOp.connections['abc-123']).toBeUndefined();
    });

    it('should replace target node value when it matches a node ID', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('abc-123', 'Node1'), createMockNode('def-456', 'Node2')],
        {
          Node1: {
            main: [[{ node: 'def-456', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-id-to-name');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].before).toBe('def-456');
      expect(connFixes[0].after).toBe('Node2');
    });

    it('should NOT fix when key matches both an ID and a name', async () => {
      // Node with name that looks like an ID of another node
      const workflow = createMockWorkflow(
        [createMockNode('abc-123', 'abc-123'), createMockNode('def-456', 'Node2')],
        {
          'abc-123': {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-id-to-name');
      expect(connFixes).toHaveLength(0);
    });
  });

  describe('Dedup', () => {
    it('should remove exact duplicate connections', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[
              { node: 'Node2', type: 'main', index: 0 },
              { node: 'Node2', type: 'main', index: 0 },
            ]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-duplicate-removal');
      expect(connFixes).toHaveLength(1);

      const replaceOp = result.operations.find(op => op.type === 'replaceConnections') as any;
      expect(replaceOp.connections.Node1.main[0]).toHaveLength(1);
    });

    it('should keep near-duplicates with different index', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[
              { node: 'Node2', type: 'main', index: 0 },
              { node: 'Node2', type: 'main', index: 1 },
            ]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-duplicate-removal');
      expect(connFixes).toHaveLength(0);
    });
  });

  describe('Input Index', () => {
    it('should reset to 0 for single-input nodes', async () => {
      const validation: WorkflowValidationResult = {
        ...emptyValidation,
        errors: [{
          type: 'error',
          nodeName: 'Node2',
          message: 'Input index 3 on node "Node2" exceeds its input count (1). Connection from "Node1" targets input 3, but this node has 1 main input(s) (indices 0-0).',
          code: 'INPUT_INDEX_OUT_OF_BOUNDS'
        }]
      };

      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2', 'n8n-nodes-base.httpRequest')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 3 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, validation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-input-index');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].before).toBe(3);
      expect(connFixes[0].after).toBe(0);
      expect(connFixes[0].confidence).toBe('medium');
    });

    it('should clamp for Merge nodes', async () => {
      const validation: WorkflowValidationResult = {
        ...emptyValidation,
        errors: [{
          type: 'error',
          nodeName: 'MergeNode',
          message: 'Input index 5 on node "MergeNode" exceeds its input count (2). Connection from "Node1" targets input 5, but this node has 2 main input(s) (indices 0-1).',
          code: 'INPUT_INDEX_OUT_OF_BOUNDS'
        }]
      };

      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'MergeNode', 'n8n-nodes-base.merge')],
        {
          Node1: {
            main: [[{ node: 'MergeNode', type: 'main', index: 5 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, validation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-input-index');
      expect(connFixes).toHaveLength(1);
      expect(connFixes[0].before).toBe(5);
      expect(connFixes[0].after).toBe(1); // clamped to max valid index
    });

    it('should not fix valid indices', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-input-index');
      expect(connFixes).toHaveLength(0);
    });
  });

  describe('Combined', () => {
    it('should fix multiple issues in one workflow', async () => {
      const workflow = createMockWorkflow(
        [
          createMockNode('id1', 'Node1'),
          createMockNode('id2', 'Node2'),
          createMockNode('id3', 'Node3')
        ],
        {
          Node1: {
            '0': [[
              { node: 'Node2', type: '0', index: 0 },
              { node: 'Node2', type: '0', index: 0 }, // duplicate
            ]]
          },
          'id3': { // ID instead of name
            main: [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      expect(result.fixes.length).toBeGreaterThan(0);
      expect(result.operations.find(op => op.type === 'replaceConnections')).toBeDefined();

      // Should have numeric key, invalid type, dedup, and id-to-name fixes
      const types = new Set(result.fixes.map(f => f.type));
      expect(types.has('connection-numeric-keys')).toBe(true);
      expect(types.has('connection-id-to-name')).toBe(true);
    });

    it('should be idempotent (no fixes on valid connections)', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connectionFixTypes = [
        'connection-numeric-keys',
        'connection-invalid-type',
        'connection-id-to-name',
        'connection-duplicate-removal',
        'connection-input-index'
      ];
      const connFixes = result.fixes.filter(f => connectionFixTypes.includes(f.type));
      expect(connFixes).toHaveLength(0);
      expect(result.operations.find(op => op.type === 'replaceConnections')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty connections', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1')],
        {}
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      expect(result.operations.find(op => op.type === 'replaceConnections')).toBeUndefined();
    });

    it('should respect fixTypes filtering', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            '0': [[{ node: 'Node2', type: '0', index: 0 }]]
          }
        }
      );

      // Only allow numeric key fixes, not invalid type fixes
      const result = await autoFixer.generateFixes(workflow, emptyValidation, [], {
        fixTypes: ['connection-numeric-keys']
      });

      const numericFixes = result.fixes.filter(f => f.type === 'connection-numeric-keys');
      const typeFixes = result.fixes.filter(f => f.type === 'connection-invalid-type');
      expect(numericFixes.length).toBeGreaterThan(0);
      expect(typeFixes).toHaveLength(0);
    });

    it('should filter replaceConnections from operations when confidence threshold filters all connection fixes', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 5 }]]
          }
        }
      );

      const validation: WorkflowValidationResult = {
        ...emptyValidation,
        errors: [{
          type: 'error',
          nodeName: 'Node2',
          message: 'Input index 5 on node "Node2" exceeds its input count (1). Connection from "Node1" targets input 5, but this node has 1 main input(s) (indices 0-0).',
          code: 'INPUT_INDEX_OUT_OF_BOUNDS'
        }]
      };

      // Input index fixes are medium confidence. Filter to high only.
      const result = await autoFixer.generateFixes(workflow, validation, [], {
        confidenceThreshold: 'high'
      });

      // Medium confidence fixes should be filtered out
      const connFixes = result.fixes.filter(f => f.type === 'connection-input-index');
      expect(connFixes).toHaveLength(0);
      expect(result.operations.find(op => op.type === 'replaceConnections')).toBeUndefined();
    });

    it('should include connection issues in summary', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            '0': [[{ node: 'Node2', type: 'main', index: 0 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      expect(result.summary).toContain('connection');
    });

    it('should handle non-existent target nodes gracefully', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1')],
        {
          Node1: {
            '0': [[{ node: 'NonExistent', type: 'main', index: 0 }]]
          }
        }
      );

      // Should not throw
      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      expect(result.fixes.some(f => f.type === 'connection-numeric-keys')).toBe(true);
    });

    it('should skip unparseable INPUT_INDEX_OUT_OF_BOUNDS errors gracefully', async () => {
      const validation: WorkflowValidationResult = {
        ...emptyValidation,
        errors: [{
          type: 'error',
          nodeName: 'Node2',
          message: 'Something unexpected about input indices',
          code: 'INPUT_INDEX_OUT_OF_BOUNDS'
        }]
      };

      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 5 }]]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, validation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-input-index');
      expect(connFixes).toHaveLength(0);
    });

    it('should fix both source keys and target .node values as IDs in the same workflow', async () => {
      const workflow = createMockWorkflow(
        [
          createMockNode('abc-123', 'Node1'),
          createMockNode('def-456', 'Node2'),
          createMockNode('ghi-789', 'Node3')
        ],
        {
          'abc-123': {  // source key is ID
            main: [[{ node: 'def-456', type: 'main', index: 0 }]]  // target .node is also ID
          },
          Node2: {
            main: [[{ node: 'ghi-789', type: 'main', index: 0 }]]  // another target ID
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const connFixes = result.fixes.filter(f => f.type === 'connection-id-to-name');

      // Should fix: source key abc-123 → Node1, target def-456 → Node2, target ghi-789 → Node3
      expect(connFixes).toHaveLength(3);

      const replaceOp = result.operations.find(op => op.type === 'replaceConnections') as any;
      expect(replaceOp.connections['Node1']).toBeDefined();
      expect(replaceOp.connections['abc-123']).toBeUndefined();

      // Verify target .node values were also replaced
      const node1Conns = replaceOp.connections['Node1'].main[0];
      expect(node1Conns[0].node).toBe('Node2');

      const node2Conns = replaceOp.connections['Node2'].main[0];
      expect(node2Conns[0].node).toBe('Node3');
    });

    it('should lower confidence to medium when merging numeric key into non-empty main slot', async () => {
      const workflow = createMockWorkflow(
        [createMockNode('id1', 'Node1'), createMockNode('id2', 'Node2'), createMockNode('id3', 'Node3')],
        {
          Node1: {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]],
            '0': [[{ node: 'Node3', type: 'main', index: 0 }]]  // conflicts with existing main[0]
          }
        }
      );

      const result = await autoFixer.generateFixes(workflow, emptyValidation, []);
      const numericFixes = result.fixes.filter(f => f.type === 'connection-numeric-keys');
      expect(numericFixes).toHaveLength(1);
      expect(numericFixes[0].confidence).toBe('medium');
      expect(numericFixes[0].description).toContain('Merged');
    });
  });
});
