import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';

// Mock dependencies
vi.mock('@/database/node-repository');
vi.mock('@/services/enhanced-config-validator');
vi.mock('@/services/expression-validator');
vi.mock('@/utils/logger');

describe('WorkflowValidator - Connection Validation (#620)', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: NodeRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNodeRepository = new NodeRepository({} as any) as any;

    if (!mockNodeRepository.getAllNodes) {
      mockNodeRepository.getAllNodes = vi.fn();
    }
    if (!mockNodeRepository.getNode) {
      mockNodeRepository.getNode = vi.fn();
    }

    const nodeTypes: Record<string, any> = {
      'nodes-base.webhook': {
        type: 'nodes-base.webhook',
        displayName: 'Webhook',
        package: 'n8n-nodes-base',
        isTrigger: true,
        outputs: ['main'],
        properties: [],
      },
      'nodes-base.manualTrigger': {
        type: 'nodes-base.manualTrigger',
        displayName: 'Manual Trigger',
        package: 'n8n-nodes-base',
        isTrigger: true,
        outputs: ['main'],
        properties: [],
      },
      'nodes-base.set': {
        type: 'nodes-base.set',
        displayName: 'Set',
        package: 'n8n-nodes-base',
        outputs: ['main'],
        properties: [],
      },
      'nodes-base.code': {
        type: 'nodes-base.code',
        displayName: 'Code',
        package: 'n8n-nodes-base',
        outputs: ['main'],
        properties: [],
      },
      'nodes-base.if': {
        type: 'nodes-base.if',
        displayName: 'IF',
        package: 'n8n-nodes-base',
        outputs: ['main', 'main'],
        properties: [],
      },
      'nodes-base.filter': {
        type: 'nodes-base.filter',
        displayName: 'Filter',
        package: 'n8n-nodes-base',
        outputs: ['main', 'main'],
        properties: [],
      },
      'nodes-base.switch': {
        type: 'nodes-base.switch',
        displayName: 'Switch',
        package: 'n8n-nodes-base',
        outputs: ['main', 'main', 'main', 'main'],
        properties: [],
      },
      'nodes-base.googleSheets': {
        type: 'nodes-base.googleSheets',
        displayName: 'Google Sheets',
        package: 'n8n-nodes-base',
        outputs: ['main'],
        properties: [],
      },
      'nodes-base.merge': {
        type: 'nodes-base.merge',
        displayName: 'Merge',
        package: 'n8n-nodes-base',
        outputs: ['main'],
        properties: [],
      },
      'nodes-langchain.agent': {
        type: 'nodes-langchain.agent',
        displayName: 'AI Agent',
        package: '@n8n/n8n-nodes-langchain',
        isAITool: true,
        outputs: ['main'],
        properties: [],
      },
    };

    vi.mocked(mockNodeRepository.getNode).mockImplementation((nodeType: string) => {
      return nodeTypes[nodeType] || null;
    });
    vi.mocked(mockNodeRepository.getAllNodes).mockReturnValue(Object.values(nodeTypes));

    validator = new WorkflowValidator(
      mockNodeRepository,
      EnhancedConfigValidator as any
    );
  });

  describe('Unknown output keys (P0)', () => {
    it('should flag numeric string key "1" with index suggestion', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Save to Google Sheets', type: 'n8n-nodes-base.googleSheets', position: [200, 0], parameters: {} },
          { id: '3', name: 'Format Error', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Success Response', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Save to Google Sheets', type: 'main', index: 0 }]]
          },
          'Save to Google Sheets': {
            '1': [[{ node: 'Format Error', type: '0', index: 0 }]],
            main: [[{ node: 'Success Response', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unknownKeyError = result.errors.find(e => e.code === 'UNKNOWN_CONNECTION_KEY');
      expect(unknownKeyError).toBeDefined();
      expect(unknownKeyError!.message).toContain('Unknown connection output key "1"');
      expect(unknownKeyError!.message).toContain('use main[1] instead');
      expect(unknownKeyError!.nodeName).toBe('Save to Google Sheets');
    });

    it('should flag random string key "output"', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            output: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unknownKeyError = result.errors.find(e => e.code === 'UNKNOWN_CONNECTION_KEY');
      expect(unknownKeyError).toBeDefined();
      expect(unknownKeyError!.message).toContain('Unknown connection output key "output"');
      // Should NOT have index suggestion for non-numeric key
      expect(unknownKeyError!.message).not.toContain('use main[');
    });

    it('should accept valid keys: main, error, ai_tool', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unknownKeyErrors = result.errors.filter(e => e.code === 'UNKNOWN_CONNECTION_KEY');
      expect(unknownKeyErrors).toHaveLength(0);
    });

    it('should accept AI connection types as valid keys', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Chat Trigger', type: 'n8n-nodes-base.chatTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'AI Agent', type: 'nodes-langchain.agent', position: [200, 0], parameters: {} },
          { id: '3', name: 'LLM', type: 'nodes-langchain.lmChatOpenAi', position: [200, 200], parameters: {} },
        ],
        connections: {
          'Chat Trigger': {
            main: [[{ node: 'AI Agent', type: 'main', index: 0 }]]
          },
          'LLM': {
            ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unknownKeyErrors = result.errors.filter(e => e.code === 'UNKNOWN_CONNECTION_KEY');
      expect(unknownKeyErrors).toHaveLength(0);
    });

    it('should flag multiple unknown keys on the same node', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set1', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Set2', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            '0': [[{ node: 'Set1', type: 'main', index: 0 }]],
            '1': [[{ node: 'Set2', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unknownKeyErrors = result.errors.filter(e => e.code === 'UNKNOWN_CONNECTION_KEY');
      expect(unknownKeyErrors).toHaveLength(2);
    });
  });

  describe('Invalid type field (P0)', () => {
    it('should flag numeric type "0" in connection target', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Sheets', type: 'n8n-nodes-base.googleSheets', position: [200, 0], parameters: {} },
          { id: '3', name: 'Error Handler', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Sheets', type: 'main', index: 0 }]]
          },
          'Sheets': {
            main: [[{ node: 'Error Handler', type: '0', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const typeError = result.errors.find(e => e.code === 'INVALID_CONNECTION_TYPE');
      expect(typeError).toBeDefined();
      expect(typeError!.message).toContain('Invalid connection type "0"');
      expect(typeError!.message).toContain('Numeric types are not valid');
    });

    it('should flag invented type "output"', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            main: [[{ node: 'Set', type: 'output', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const typeError = result.errors.find(e => e.code === 'INVALID_CONNECTION_TYPE');
      expect(typeError).toBeDefined();
      expect(typeError!.message).toContain('Invalid connection type "output"');
    });

    it('should accept valid type "main"', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const typeErrors = result.errors.filter(e => e.code === 'INVALID_CONNECTION_TYPE');
      expect(typeErrors).toHaveLength(0);
    });

    it('should accept AI connection types in type field', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Chat Trigger', type: 'n8n-nodes-base.chatTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'AI Agent', type: 'nodes-langchain.agent', position: [200, 0], parameters: {} },
          { id: '3', name: 'Memory', type: 'nodes-langchain.memoryBufferWindow', position: [200, 200], parameters: {} },
        ],
        connections: {
          'Chat Trigger': {
            main: [[{ node: 'AI Agent', type: 'main', index: 0 }]]
          },
          'Memory': {
            ai_memory: [[{ node: 'AI Agent', type: 'ai_memory', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const typeErrors = result.errors.filter(e => e.code === 'INVALID_CONNECTION_TYPE');
      expect(typeErrors).toHaveLength(0);
    });

    it('should catch the real-world example from issue #620', async () => {
      // Exact reproduction of the bug reported in the issue
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Save to Google Sheets', type: 'n8n-nodes-base.googleSheets', position: [200, 0], parameters: {} },
          { id: '3', name: 'Format AI Integration Error', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Webhook Success Response', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Save to Google Sheets', type: 'main', index: 0 }]]
          },
          'Save to Google Sheets': {
            '1': [[{ node: 'Format AI Integration Error', type: '0', index: 0 }]],
            main: [[{ node: 'Webhook Success Response', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should detect both bugs
      const unknownKeyError = result.errors.find(e => e.code === 'UNKNOWN_CONNECTION_KEY');
      expect(unknownKeyError).toBeDefined();
      expect(unknownKeyError!.message).toContain('"1"');
      expect(unknownKeyError!.message).toContain('use main[1] instead');

      // The type "0" error won't appear since the "1" key is unknown and skipped,
      // but the error count should reflect the invalid connection
      expect(result.statistics.invalidConnections).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Output index bounds checking (P1)', () => {
    it('should flag Code node with main[1] (only has 1 output)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
          { id: '3', name: 'Success', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Error', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            main: [
              [{ node: 'Success', type: 'main', index: 0 }],
              [{ node: 'Error', type: 'main', index: 0 }]  // main[1] - out of bounds
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const boundsError = result.errors.find(e => e.code === 'OUTPUT_INDEX_OUT_OF_BOUNDS');
      expect(boundsError).toBeDefined();
      expect(boundsError!.message).toContain('Output index 1');
      expect(boundsError!.message).toContain('Code');
    });

    it('should accept IF node with main[0] and main[1] (2 outputs)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'IF', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'True', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'False', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          },
          'IF': {
            main: [
              [{ node: 'True', type: 'main', index: 0 }],
              [{ node: 'False', type: 'main', index: 0 }]
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const boundsErrors = result.errors.filter(e => e.code === 'OUTPUT_INDEX_OUT_OF_BOUNDS');
      expect(boundsErrors).toHaveLength(0);
    });

    it('should flag IF node with main[2] (only 2 outputs)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'IF', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'True', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'False', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
          { id: '5', name: 'Extra', type: 'n8n-nodes-base.set', position: [400, 400], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'IF', type: 'main', index: 0 }]]
          },
          'IF': {
            main: [
              [{ node: 'True', type: 'main', index: 0 }],
              [{ node: 'False', type: 'main', index: 0 }],
              [{ node: 'Extra', type: 'main', index: 0 }]  // main[2] - out of bounds
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const boundsError = result.errors.find(e => e.code === 'OUTPUT_INDEX_OUT_OF_BOUNDS');
      expect(boundsError).toBeDefined();
      expect(boundsError!.message).toContain('Output index 2');
    });

    it('should allow extra output when onError is continueErrorOutput', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {}, onError: 'continueErrorOutput' as const },
          { id: '3', name: 'Success', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Error', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            main: [
              [{ node: 'Success', type: 'main', index: 0 }],
              [{ node: 'Error', type: 'main', index: 0 }]  // Error output - allowed with continueErrorOutput
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const boundsErrors = result.errors.filter(e => e.code === 'OUTPUT_INDEX_OUT_OF_BOUNDS');
      expect(boundsErrors).toHaveLength(0);
    });

    it('should skip bounds check for unknown node types', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Custom', type: 'n8n-nodes-community.customNode', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set1', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Set2', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Custom', type: 'main', index: 0 }]]
          },
          'Custom': {
            main: [
              [{ node: 'Set1', type: 'main', index: 0 }],
              [{ node: 'Set2', type: 'main', index: 0 }]
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const boundsErrors = result.errors.filter(e => e.code === 'OUTPUT_INDEX_OUT_OF_BOUNDS');
      expect(boundsErrors).toHaveLength(0);
    });
  });

  describe('Input index bounds checking (P1)', () => {
    it('should accept regular node with index 0', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const inputErrors = result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS');
      expect(inputErrors).toHaveLength(0);
    });

    it('should flag regular node with index 1 (only 1 input)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 1 }]]  // index 1 - out of bounds
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const inputError = result.errors.find(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS');
      expect(inputError).toBeDefined();
      expect(inputError!.message).toContain('Input index 1');
      expect(inputError!.message).toContain('Code');
    });

    it('should accept Merge node with index 1 (has 2 inputs)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set1', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set2', type: 'n8n-nodes-base.set', position: [200, 200], parameters: {} },
          { id: '4', name: 'Merge', type: 'n8n-nodes-base.merge', position: [400, 100], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Set1', type: 'main', index: 0 }, { node: 'Set2', type: 'main', index: 0 }]]
          },
          'Set1': {
            main: [[{ node: 'Merge', type: 'main', index: 0 }]]
          },
          'Set2': {
            main: [[{ node: 'Merge', type: 'main', index: 1 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const inputErrors = result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS');
      expect(inputErrors).toHaveLength(0);
    });

    it('should skip bounds check for unknown node types', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Custom', type: 'n8n-nodes-community.unknownNode', position: [200, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Custom', type: 'main', index: 5 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const inputErrors = result.errors.filter(e => e.code === 'INPUT_INDEX_OUT_OF_BOUNDS');
      expect(inputErrors).toHaveLength(0);
    });
  });

  describe('Trigger reachability analysis (P2)', () => {
    it('should flag nodes in disconnected subgraph as unreachable', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Connected', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          // Disconnected subgraph - two nodes connected to each other but not reachable from trigger
          { id: '3', name: 'Island1', type: 'n8n-nodes-base.code', position: [0, 300], parameters: {} },
          { id: '4', name: 'Island2', type: 'n8n-nodes-base.set', position: [200, 300], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Connected', type: 'main', index: 0 }]]
          },
          'Island1': {
            main: [[{ node: 'Island2', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Both Island1 and Island2 should be flagged as unreachable
      const unreachable = result.warnings.filter(w => w.message.includes('not reachable from any trigger'));
      expect(unreachable.length).toBe(2);
      expect(unreachable.some(w => w.nodeName === 'Island1')).toBe(true);
      expect(unreachable.some(w => w.nodeName === 'Island2')).toBe(true);
    });

    it('should pass when all nodes are reachable from trigger', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Code', type: 'n8n-nodes-base.code', position: [200, 0], parameters: {} },
          { id: '3', name: 'Set', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Code', type: 'main', index: 0 }]]
          },
          'Code': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unreachable = result.warnings.filter(w => w.message.includes('not reachable'));
      expect(unreachable).toHaveLength(0);
    });

    it('should flag single orphaned node as unreachable', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Orphaned', type: 'n8n-nodes-base.code', position: [500, 500], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unreachable = result.warnings.filter(w => w.message.includes('not reachable') && w.nodeName === 'Orphaned');
      expect(unreachable).toHaveLength(1);
    });

    it('should not flag disabled nodes', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Disabled', type: 'n8n-nodes-base.code', position: [500, 500], parameters: {}, disabled: true },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unreachable = result.warnings.filter(w => w.nodeName === 'Disabled');
      expect(unreachable).toHaveLength(0);
    });

    it('should not flag sticky notes', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Note', type: 'n8n-nodes-base.stickyNote', position: [500, 500], parameters: {} },
        ],
        connections: {
          'Webhook': {
            main: [[{ node: 'Set', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      const unreachable = result.warnings.filter(w => w.nodeName === 'Note');
      expect(unreachable).toHaveLength(0);
    });

    it('should use simple orphan check when no triggers exist', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Set1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} },
          { id: '2', name: 'Set2', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'Orphan', type: 'n8n-nodes-base.code', position: [500, 500], parameters: {} },
        ],
        connections: {
          'Set1': {
            main: [[{ node: 'Set2', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Orphan should still be flagged with the simple "not connected" message
      const orphanWarning = result.warnings.find(w => w.nodeName === 'Orphan');
      expect(orphanWarning).toBeDefined();
      expect(orphanWarning!.message).toContain('not connected to any other nodes');
    });
  });

  describe('Conditional branch fan-out detection (CONDITIONAL_BRANCH_FANOUT)', () => {
    it('should warn when IF node has both branches in main[0]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'TrueTarget', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'FalseTarget', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': {
            main: [[{ node: 'TrueTarget', type: 'main', index: 0 }, { node: 'FalseTarget', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeDefined();
      expect(warning!.nodeName).toBe('Route');
      expect(warning!.message).toContain('2 connections on the "true" branch');
      expect(warning!.message).toContain('"false" branch has no effect');
    });

    it('should not warn when IF node has correct true/false split', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'TrueTarget', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'FalseTarget', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': {
            main: [
              [{ node: 'TrueTarget', type: 'main', index: 0 }],
              [{ node: 'FalseTarget', type: 'main', index: 0 }]
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeUndefined();
    });

    it('should not warn when IF has fan-out on main[0] AND connections on main[1]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'TrueA', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'TrueB', type: 'n8n-nodes-base.set', position: [400, 100], parameters: {} },
          { id: '5', name: 'FalseTarget', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': {
            main: [
              [{ node: 'TrueA', type: 'main', index: 0 }, { node: 'TrueB', type: 'main', index: 0 }],
              [{ node: 'FalseTarget', type: 'main', index: 0 }]
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeUndefined();
    });

    it('should warn when Switch node has all connections on main[0]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'MySwitch', type: 'n8n-nodes-base.switch', position: [200, 0], parameters: { rules: { values: [{ value: 'a' }, { value: 'b' }] } } },
          { id: '3', name: 'TargetA', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'TargetB', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
          { id: '5', name: 'TargetC', type: 'n8n-nodes-base.set', position: [400, 400], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'MySwitch', type: 'main', index: 0 }]] },
          'MySwitch': {
            main: [[{ node: 'TargetA', type: 'main', index: 0 }, { node: 'TargetB', type: 'main', index: 0 }, { node: 'TargetC', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeDefined();
      expect(warning!.nodeName).toBe('MySwitch');
      expect(warning!.message).toContain('3 connections on output 0');
      expect(warning!.message).toContain('other switch branches have no effect');
    });

    it('should not warn when Switch node has no rules parameter (indeterminate outputs)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'MySwitch', type: 'n8n-nodes-base.switch', position: [200, 0], parameters: {} },
          { id: '3', name: 'TargetA', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'TargetB', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'MySwitch', type: 'main', index: 0 }]] },
          'MySwitch': {
            main: [[{ node: 'TargetA', type: 'main', index: 0 }, { node: 'TargetB', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeUndefined();
    });

    it('should not warn when regular node has fan-out on main[0]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'MySet', type: 'n8n-nodes-base.set', position: [200, 0], parameters: {} },
          { id: '3', name: 'TargetA', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'TargetB', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'MySet', type: 'main', index: 0 }]] },
          'MySet': {
            main: [[{ node: 'TargetA', type: 'main', index: 0 }, { node: 'TargetB', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeUndefined();
    });

    it('should not warn when IF has only 1 connection on main[0] with empty main[1]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'Route', type: 'n8n-nodes-base.if', position: [200, 0], parameters: {} },
          { id: '3', name: 'TrueOnly', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'Route', type: 'main', index: 0 }]] },
          'Route': {
            main: [[{ node: 'TrueOnly', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeUndefined();
    });

    it('should warn for Filter node with both branches in main[0]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0], parameters: {} },
          { id: '2', name: 'MyFilter', type: 'n8n-nodes-base.filter', position: [200, 0], parameters: {} },
          { id: '3', name: 'Matched', type: 'n8n-nodes-base.set', position: [400, 0], parameters: {} },
          { id: '4', name: 'Unmatched', type: 'n8n-nodes-base.set', position: [400, 200], parameters: {} },
        ],
        connections: {
          'Trigger': { main: [[{ node: 'MyFilter', type: 'main', index: 0 }]] },
          'MyFilter': {
            main: [[{ node: 'Matched', type: 'main', index: 0 }, { node: 'Unmatched', type: 'main', index: 0 }]]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);
      const warning = result.warnings.find(w => w.code === 'CONDITIONAL_BRANCH_FANOUT');
      expect(warning).toBeDefined();
      expect(warning!.nodeName).toBe('MyFilter');
      expect(warning!.message).toContain('"matched" branch');
      expect(warning!.message).toContain('"unmatched" branch has no effect');
    });
  });

  // ─── Error Output Validation (absorbed from workflow-validator-error-outputs) ──

  describe('Error Output Configuration', () => {
    it('should detect incorrect configuration - multiple nodes in same array', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Validate Input', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [-400, 64], parameters: {} },
          { id: '2', name: 'Filter URLs', type: 'n8n-nodes-base.filter', typeVersion: 2.2, position: [-176, 64], parameters: {} },
          { id: '3', name: 'Error Response1', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [-160, 240], parameters: {} },
        ],
        connections: {
          'Validate Input': {
            main: [[
              { node: 'Filter URLs', type: 'main', index: 0 },
              { node: 'Error Response1', type: 'main', index: 0 },
            ]],
          },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.message.includes('Incorrect error output configuration') &&
        e.message.includes('Error Response1') &&
        e.message.includes('appear to be error handlers but are in main[0]'),
      )).toBe(true);
      const errorMsg = result.errors.find(e => e.message.includes('Incorrect error output configuration'));
      expect(errorMsg?.message).toContain('INCORRECT (current)');
      expect(errorMsg?.message).toContain('CORRECT (should be)');
    });

    it('should validate correct configuration - separate arrays', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Validate Input', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [-400, 64], parameters: {}, onError: 'continueErrorOutput' },
          { id: '2', name: 'Filter URLs', type: 'n8n-nodes-base.filter', typeVersion: 2.2, position: [-176, 64], parameters: {} },
          { id: '3', name: 'Error Response1', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [-160, 240], parameters: {} },
        ],
        connections: {
          'Validate Input': {
            main: [
              [{ node: 'Filter URLs', type: 'main', index: 0 }],
              [{ node: 'Error Response1', type: 'main', index: 0 }],
            ],
          },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
    });

    it('should detect onError without error connections', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [100, 100], parameters: {}, onError: 'continueErrorOutput' },
          { id: '2', name: 'Process Data', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: {
          'HTTP Request': { main: [[{ node: 'Process Data', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e =>
        e.nodeName === 'HTTP Request' &&
        e.message.includes("has onError: 'continueErrorOutput' but no error output connections"),
      )).toBe(true);
    });

    it('should warn about error connections without onError', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [100, 100], parameters: {} },
          { id: '2', name: 'Process Data', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Error Handler', type: 'n8n-nodes-base.set', position: [300, 300], parameters: {} },
        ],
        connections: {
          'HTTP Request': {
            main: [
              [{ node: 'Process Data', type: 'main', index: 0 }],
              [{ node: 'Error Handler', type: 'main', index: 0 }],
            ],
          },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.some(w =>
        w.nodeName === 'HTTP Request' &&
        w.message.includes('error output connections in main[1] but missing onError'),
      )).toBe(true);
    });
  });

  describe('Error Handler Detection', () => {
    it('should detect error handler nodes by name', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'API Call', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {} },
          { id: '2', name: 'Process Success', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Handle Error', type: 'n8n-nodes-base.set', position: [300, 300], parameters: {} },
        ],
        connections: {
          'API Call': { main: [[{ node: 'Process Success', type: 'main', index: 0 }, { node: 'Handle Error', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Handle Error') && e.message.includes('appear to be error handlers'))).toBe(true);
    });

    it('should detect error handler nodes by type', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} },
          { id: '2', name: 'Process', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', position: [300, 300], parameters: {} },
        ],
        connections: {
          'Webhook': { main: [[{ node: 'Process', type: 'main', index: 0 }, { node: 'Respond', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Respond') && e.message.includes('appear to be error handlers'))).toBe(true);
    });

    it('should not flag non-error nodes in main[0]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', position: [100, 100], parameters: {} },
          { id: '2', name: 'First Process', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Second Process', type: 'n8n-nodes-base.set', position: [300, 200], parameters: {} },
        ],
        connections: {
          'Start': { main: [[{ node: 'First Process', type: 'main', index: 0 }, { node: 'Second Process', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
    });
  });

  describe('Complex Error Patterns', () => {
    it('should handle multiple error handlers correctly in main[1]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, onError: 'continueErrorOutput' },
          { id: '2', name: 'Process', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Log Error', type: 'n8n-nodes-base.set', position: [300, 200], parameters: {} },
          { id: '4', name: 'Send Error Email', type: 'n8n-nodes-base.emailSend', position: [300, 300], parameters: {} },
        ],
        connections: {
          'HTTP Request': {
            main: [
              [{ node: 'Process', type: 'main', index: 0 }],
              [{ node: 'Log Error', type: 'main', index: 0 }, { node: 'Send Error Email', type: 'main', index: 0 }],
            ],
          },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
    });

    it('should detect mixed success and error handlers in main[0]', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'API Request', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {} },
          { id: '2', name: 'Transform Data', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Store Data', type: 'n8n-nodes-base.set', position: [500, 100], parameters: {} },
          { id: '4', name: 'Error Notification', type: 'n8n-nodes-base.emailSend', position: [300, 300], parameters: {} },
        ],
        connections: {
          'API Request': {
            main: [[
              { node: 'Transform Data', type: 'main', index: 0 },
              { node: 'Store Data', type: 'main', index: 0 },
              { node: 'Error Notification', type: 'main', index: 0 },
            ]],
          },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e =>
        e.message.includes('Error Notification') && e.message.includes('appear to be error handlers but are in main[0]'),
      )).toBe(true);
    });

    it('should handle nested error handling (error handlers with their own errors)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Primary API', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, onError: 'continueErrorOutput' },
          { id: '2', name: 'Success Handler', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Error Logger', type: 'n8n-nodes-base.httpRequest', position: [300, 200], parameters: {}, onError: 'continueErrorOutput' },
          { id: '4', name: 'Fallback Error', type: 'n8n-nodes-base.set', position: [500, 250], parameters: {} },
        ],
        connections: {
          'Primary API': { main: [[{ node: 'Success Handler', type: 'main', index: 0 }], [{ node: 'Error Logger', type: 'main', index: 0 }]] },
          'Error Logger': { main: [[], [{ node: 'Fallback Error', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
    });

    it('should handle workflows with only error outputs (no success path)', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Risky Operation', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {}, onError: 'continueErrorOutput' },
          { id: '2', name: 'Error Handler Only', type: 'n8n-nodes-base.set', position: [300, 200], parameters: {} },
        ],
        connections: {
          'Risky Operation': { main: [[], [{ node: 'Error Handler Only', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
      expect(result.errors.some(e => e.message.includes("has onError: 'continueErrorOutput' but no error output connections"))).toBe(false);
    });

    it('should not flag legitimate parallel processing nodes', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Data Source', type: 'n8n-nodes-base.webhook', position: [100, 100], parameters: {} },
          { id: '2', name: 'Process A', type: 'n8n-nodes-base.set', position: [300, 50], parameters: {} },
          { id: '3', name: 'Process B', type: 'n8n-nodes-base.set', position: [300, 150], parameters: {} },
          { id: '4', name: 'Transform Data', type: 'n8n-nodes-base.set', position: [300, 250], parameters: {} },
        ],
        connections: {
          'Data Source': { main: [[{ node: 'Process A', type: 'main', index: 0 }, { node: 'Process B', type: 'main', index: 0 }, { node: 'Transform Data', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e => e.message.includes('Incorrect error output configuration'))).toBe(false);
    });

    it('should detect all variations of error-related node names', async () => {
      const workflow = {
        nodes: [
          { id: '1', name: 'Source', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: {} },
          { id: '2', name: 'Handle Failure', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
          { id: '3', name: 'Catch Exception', type: 'n8n-nodes-base.set', position: [300, 200], parameters: {} },
          { id: '4', name: 'Success Path', type: 'n8n-nodes-base.set', position: [500, 100], parameters: {} },
        ],
        connections: {
          'Source': { main: [[{ node: 'Handle Failure', type: 'main', index: 0 }, { node: 'Catch Exception', type: 'main', index: 0 }, { node: 'Success Path', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.errors.some(e =>
        e.message.includes('Handle Failure') && e.message.includes('Catch Exception') && e.message.includes('appear to be error handlers but are in main[0]'),
      )).toBe(true);
    });
  });
});
