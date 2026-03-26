import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';

// Mock dependencies
vi.mock('@/database/node-repository');
vi.mock('@/services/enhanced-config-validator');

describe('WorkflowValidator - Loop Node Validation', () => {
  let validator: WorkflowValidator;
  let mockNodeRepository: any;
  let mockNodeValidator: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNodeRepository = {
      getNode: vi.fn()
    };

    mockNodeValidator = {
      validateWithMode: vi.fn().mockReturnValue({
        errors: [],
        warnings: []
      })
    };

    validator = new WorkflowValidator(mockNodeRepository, mockNodeValidator);
  });

  describe('validateSplitInBatchesConnection', () => {
    const createWorkflow = (connections: any) => ({
      name: 'Test Workflow',
      nodes: [
        {
          id: '1',
          name: 'Split In Batches',
          type: 'n8n-nodes-base.splitInBatches',
          position: [100, 100],
          parameters: { batchSize: 10 }
        },
        {
          id: '2', 
          name: 'Process Item',
          type: 'n8n-nodes-base.set',
          position: [300, 100],
          parameters: {}
        },
        {
          id: '3',
          name: 'Final Summary',
          type: 'n8n-nodes-base.emailSend',
          position: [500, 100],
          parameters: {}
        }
      ],
      connections
    });

    it('should detect reversed SplitInBatches connections (processing node on done output)', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      // Create a processing node with a name that matches the pattern (includes "process")
      const workflow = {
        name: 'Test Workflow',
        nodes: [
          {
            id: '1',
            name: 'Split In Batches',
            type: 'n8n-nodes-base.splitInBatches',
            position: [100, 100],
            parameters: { batchSize: 10 }
          },
          {
            id: '2', 
            name: 'Process Function', // Name matches processing pattern
            type: 'n8n-nodes-base.function', // Type also matches processing pattern
            position: [300, 100],
            parameters: {}
          }
        ],
        connections: {
          'Split In Batches': {
            main: [
              [{ node: 'Process Function', type: 'main', index: 0 }], // Done output (wrong for processing)
              []  // No loop connections
            ]
          },
          'Process Function': {
            main: [
              [{ node: 'Split In Batches', type: 'main', index: 0 }] // Loop back - confirms it's processing
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // The validator should detect the processing node name/type pattern and loop back
      const reversedErrors = result.errors.filter(e => 
        e.message?.includes('SplitInBatches outputs appear reversed')
      );
      
      expect(reversedErrors.length).toBeGreaterThanOrEqual(1);
    });

    it('should warn about processing node on done output without loop back', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      // Processing node connected to "done" output but no loop back
      const workflow = createWorkflow({
        'Split In Batches': {
          main: [
            [{ node: 'Process Item', type: 'main', index: 0 }], // Done output
            []
          ]
        }
        // No loop back from Process Item
      });

      const result = await validator.validateWorkflow(workflow as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          nodeId: '1',
          nodeName: 'Split In Batches',
          message: expect.stringContaining('connected to the "done" output (index 0) but appears to be a processing node')
        })
      );
    });

    it('should warn about final processing node on loop output', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      // Final summary node connected to "loop" output (index 1) - suspicious
      const workflow = createWorkflow({
        'Split In Batches': {
          main: [
            [],
            [{ node: 'Final Summary', type: 'main', index: 0 }] // Loop output for final node
          ]
        }
      });

      const result = await validator.validateWorkflow(workflow as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          nodeId: '1', 
          nodeName: 'Split In Batches',
          message: expect.stringContaining('connected to the "loop" output (index 1) but appears to be a post-processing node')
        })
      );
    });

    it('should warn about loop output without loop back connection', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      // Processing node on loop output but doesn't connect back
      const workflow = createWorkflow({
        'Split In Batches': {
          main: [
            [],
            [{ node: 'Process Item', type: 'main', index: 0 }] // Loop output
          ]
        }
        // Process Item doesn't connect back to Split In Batches
      });

      const result = await validator.validateWorkflow(workflow as any);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          nodeId: '1',
          nodeName: 'Split In Batches',
          message: expect.stringContaining('doesn\'t connect back to the SplitInBatches node')
        })
      );
    });

    it('should accept correct SplitInBatches connections', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      // Create a workflow with neutral node names that don't trigger patterns
      const workflow = {
        name: 'Test Workflow',
        nodes: [
          {
            id: '1',
            name: 'Split In Batches',
            type: 'n8n-nodes-base.splitInBatches',
            position: [100, 100],
            parameters: { batchSize: 10 }
          },
          {
            id: '2', 
            name: 'Data Node', // Neutral name, won't trigger processing pattern
            type: 'n8n-nodes-base.set',
            position: [300, 100],
            parameters: {}
          },
          {
            id: '3',
            name: 'Output Node', // Neutral name, won't trigger post-processing pattern
            type: 'n8n-nodes-base.noOp',
            position: [500, 100],
            parameters: {}
          }
        ],
        connections: {
          'Split In Batches': {
            main: [
              [{ node: 'Output Node', type: 'main', index: 0 }], // Done output -> neutral node
              [{ node: 'Data Node', type: 'main', index: 0 }]    // Loop output -> neutral node
            ]
          },
          'Data Node': {
            main: [
              [{ node: 'Split In Batches', type: 'main', index: 0 }] // Loop back
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should not have SplitInBatches-specific errors or warnings
      const splitErrors = result.errors.filter(e => 
        e.message?.includes('SplitInBatches') || 
        e.message?.includes('loop') ||
        e.message?.includes('done')
      );
      const splitWarnings = result.warnings.filter(w => 
        w.message?.includes('SplitInBatches') || 
        w.message?.includes('loop') ||
        w.message?.includes('done')
      );

      expect(splitErrors).toHaveLength(0);
      expect(splitWarnings).toHaveLength(0);
    });

    it('should handle complex loop structures', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const complexWorkflow = {
        name: 'Complex Loop',
        nodes: [
          {
            id: '1',
            name: 'Split In Batches',
            type: 'n8n-nodes-base.splitInBatches',
            position: [100, 100],
            parameters: {}
          },
          {
            id: '2',
            name: 'Step A', // Neutral name
            type: 'n8n-nodes-base.set',
            position: [300, 50],
            parameters: {}
          },
          {
            id: '3',
            name: 'Step B', // Neutral name 
            type: 'n8n-nodes-base.noOp',
            position: [500, 50],
            parameters: {}
          },
          {
            id: '4',
            name: 'Final Step', // More neutral name
            type: 'n8n-nodes-base.set',
            position: [300, 150],
            parameters: {}
          }
        ],
        connections: {
          'Split In Batches': {
            main: [
              [{ node: 'Final Step', type: 'main', index: 0 }], // Done -> Final (correct)
              [{ node: 'Step A', type: 'main', index: 0 }]    // Loop -> Processing (correct)
            ]
          },
          'Step A': {
            main: [
              [{ node: 'Step B', type: 'main', index: 0 }]
            ]
          },
          'Step B': {
            main: [
              [{ node: 'Split In Batches', type: 'main', index: 0 }] // Loop back (correct)
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(complexWorkflow as any);

      // Should accept this correct structure without warnings
      const loopWarnings = result.warnings.filter(w => 
        w.message?.includes('loop') || w.message?.includes('done')
      );
      expect(loopWarnings).toHaveLength(0);
    });

    it('should detect node type patterns for processing detection', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const testCases = [
        { type: 'n8n-nodes-base.function', name: 'Process Data', shouldWarn: true },
        { type: 'n8n-nodes-base.code', name: 'Transform Item', shouldWarn: true },
        { type: 'n8n-nodes-base.set', name: 'Handle Each', shouldWarn: true },
        { type: 'n8n-nodes-base.emailSend', name: 'Final Email', shouldWarn: false },
        { type: 'n8n-nodes-base.slack', name: 'Complete Notification', shouldWarn: false }
      ];

      for (const testCase of testCases) {
        const workflow = {
          name: 'Pattern Test',
          nodes: [
            {
              id: '1',
              name: 'Split In Batches',
              type: 'n8n-nodes-base.splitInBatches',
              position: [100, 100],
              parameters: {}
            },
            {
              id: '2',
              name: testCase.name,
              type: testCase.type,
              position: [300, 100],
              parameters: {}
            }
          ],
          connections: {
            'Split In Batches': {
              main: [
                [{ node: testCase.name, type: 'main', index: 0 }], // Connected to done (index 0)
                []
              ]
            }
          }
        };

        const result = await validator.validateWorkflow(workflow as any);
        
        const hasProcessingWarning = result.warnings.some(w => 
          w.message?.includes('appears to be a processing node')
        );

        if (testCase.shouldWarn) {
          expect(hasProcessingWarning).toBe(true);
        } else {
          expect(hasProcessingWarning).toBe(false);
        }
      }
    });
  });

  describe('checkForLoopBack method', () => {
    it('should detect direct loop back connection', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Direct Loop Back',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} },
          { id: '2', name: 'Process', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [[], [{ node: 'Process', type: 'main', index: 0 }]]
          },
          'Process': {
            main: [
              [{ node: 'Split In Batches', type: 'main', index: 0 }] // Direct loop back
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should not warn about missing loop back since it exists
      const missingLoopBackWarnings = result.warnings.filter(w => 
        w.message?.includes('doesn\'t connect back')
      );
      expect(missingLoopBackWarnings).toHaveLength(0);
    });

    it('should detect indirect loop back connection through multiple nodes', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Indirect Loop Back',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} },
          { id: '2', name: 'Step1', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} },
          { id: '3', name: 'Step2', type: 'n8n-nodes-base.function', position: [0, 0], parameters: {} },
          { id: '4', name: 'Step3', type: 'n8n-nodes-base.code', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [[], [{ node: 'Step1', type: 'main', index: 0 }]]
          },
          'Step1': {
            main: [
              [{ node: 'Step2', type: 'main', index: 0 }]
            ]
          },
          'Step2': {
            main: [
              [{ node: 'Step3', type: 'main', index: 0 }]
            ]
          },
          'Step3': {
            main: [
              [{ node: 'Split In Batches', type: 'main', index: 0 }] // Indirect loop back
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should not warn about missing loop back since indirect loop exists
      const missingLoopBackWarnings = result.warnings.filter(w => 
        w.message?.includes('doesn\'t connect back')
      );
      expect(missingLoopBackWarnings).toHaveLength(0);
    });

    it('should respect max depth to prevent infinite recursion', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      // Create a very deep chain that would exceed depth limit
      const nodes = [
        { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} }
      ];
      const connections: any = {
        'Split In Batches': {
          main: [[], [{ node: 'Node1', type: 'main', index: 0 }]]
        }
      };

      // Create a chain of 60 nodes (exceeds default maxDepth of 50)
      for (let i = 1; i <= 60; i++) {
        nodes.push({
          id: (i + 1).toString(),
          name: `Node${i}`,
          type: 'n8n-nodes-base.set',
          position: [0, 0],
          parameters: {}
        });

        if (i < 60) {
          connections[`Node${i}`] = {
            main: [[{ node: `Node${i + 1}`, type: 'main', index: 0 }]]
          };
        } else {
          // Last node connects back to Split In Batches
          connections[`Node${i}`] = {
            main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]]
          };
        }
      }

      const workflow = {
        name: 'Deep Chain',
        nodes,
        connections
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should warn about missing loop back because depth limit prevents detection
      const missingLoopBackWarnings = result.warnings.filter(w => 
        w.message?.includes('doesn\'t connect back')
      );
      expect(missingLoopBackWarnings).toHaveLength(1);
    });

    it('should handle circular references without infinite loops', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Circular Reference',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} },
          { id: '2', name: 'NodeA', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} },
          { id: '3', name: 'NodeB', type: 'n8n-nodes-base.function', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [[], [{ node: 'NodeA', type: 'main', index: 0 }]]
          },
          'NodeA': {
            main: [
              [{ node: 'NodeB', type: 'main', index: 0 }]
            ]
          },
          'NodeB': {
            main: [
              [{ node: 'NodeA', type: 'main', index: 0 }] // Circular reference (doesn't connect back to Split)
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should complete without hanging and warn about missing loop back
      const missingLoopBackWarnings = result.warnings.filter(w => 
        w.message?.includes('doesn\'t connect back')
      );
      expect(missingLoopBackWarnings).toHaveLength(1);
    });
  });

  describe('self-referencing connections', () => {
    it('should allow self-referencing for SplitInBatches (loop back)', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Self Reference Loop',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [
              [],
              [{ node: 'Split In Batches', type: 'main', index: 0 }] // Self-reference on loop output
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should not warn about self-reference for SplitInBatches
      const selfReferenceWarnings = result.warnings.filter(w => 
        w.message?.includes('self-referencing')
      );
      expect(selfReferenceWarnings).toHaveLength(0);
    });

    it('should warn about self-referencing for non-loop nodes', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.set',
        properties: []
      });

      const workflow = {
        name: 'Non-Loop Self Reference',
        nodes: [
          { id: '1', name: 'Set', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Set': {
            main: [
              [{ node: 'Set', type: 'main', index: 0 }] // Self-reference on regular node
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should warn about self-reference for non-loop nodes
      const selfReferenceWarnings = result.warnings.filter(w => 
        w.message?.includes('self-referencing')
      );
      expect(selfReferenceWarnings).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle missing target node gracefully', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Missing Target',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [
              [],
              [{ node: 'NonExistentNode', type: 'main', index: 0 }] // Target doesn't exist
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should have connection error for non-existent node
      const connectionErrors = result.errors.filter(e => 
        e.message?.includes('non-existent node')
      );
      expect(connectionErrors).toHaveLength(1);
    });

    it('should handle empty connections gracefully', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Empty Connections',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [
              [], // Empty done output
              []  // Empty loop output
            ]
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should not crash and should not have SplitInBatches-specific errors
      expect(result).toBeDefined();
    });

    it('should handle null/undefined connection arrays', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.splitInBatches',
        properties: []
      });

      const workflow = {
        name: 'Null Connections',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [0, 0], parameters: {} }
        ],
        connections: {
          'Split In Batches': {
            main: [
              null, // Null done output
              undefined  // Undefined loop output
            ] as any
          }
        }
      };

      const result = await validator.validateWorkflow(workflow as any);

      // Should handle gracefully without crashing
      expect(result).toBeDefined();
    });
  });

  // ─── Loop Output Edge Cases (absorbed from loop-output-edge-cases) ──

  describe('Nodes without outputs', () => {
    it('should handle nodes with null outputs gracefully', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.httpRequest', outputs: null, outputNames: null, properties: [],
      });

      const workflow = {
        name: 'No Outputs',
        nodes: [
          { id: '1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', position: [100, 100], parameters: { url: 'https://example.com' } },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: { 'HTTP Request': { main: [[{ node: 'Set', type: 'main', index: 0 }]] } },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result).toBeDefined();
      const outputErrors = result.errors.filter(e => e.message?.includes('output') && !e.message?.includes('Connection'));
      expect(outputErrors).toHaveLength(0);
    });

    it('should handle nodes with empty outputs array', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.customNode', outputs: [], outputNames: [], properties: [],
      });

      const workflow = {
        name: 'Empty Outputs',
        nodes: [{ id: '1', name: 'Custom Node', type: 'n8n-nodes-base.customNode', position: [100, 100], parameters: {} }],
        connections: { 'Custom Node': { main: [[{ node: 'Custom Node', type: 'main', index: 0 }]] } },
      };

      const result = await validator.validateWorkflow(workflow as any);
      const selfRefWarnings = result.warnings.filter(w => w.message?.includes('self-referencing'));
      expect(selfRefWarnings).toHaveLength(1);
    });
  });

  describe('Invalid connection indices', () => {
    it('should handle very large connection indices', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.switch', outputs: [{ displayName: 'Output 1' }, { displayName: 'Output 2' }], properties: [],
      });

      const workflow = {
        name: 'Large Index',
        nodes: [
          { id: '1', name: 'Switch', type: 'n8n-nodes-base.switch', position: [100, 100], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: { 'Switch': { main: [[{ node: 'Set', type: 'main', index: 999 }]] } },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result).toBeDefined();
    });
  });

  describe('Malformed connection structures', () => {
    it('should handle null connection objects', async () => {
      const workflow = {
        name: 'Null Connections',
        nodes: [{ id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} }],
        connections: { 'Split In Batches': { main: [null, [{ node: 'NonExistent', type: 'main', index: 0 }]] as any } },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result).toBeDefined();
    });

    it('should handle missing connection properties', async () => {
      const workflow = {
        name: 'Malformed Connections',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: {
          'Split In Batches': { main: [[{ node: 'Set' } as any, { type: 'main', index: 0 } as any, {} as any]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Complex output structures', () => {
    it('should handle nodes with many outputs', async () => {
      const manyOutputs = Array.from({ length: 20 }, (_, i) => ({
        displayName: `Output ${i + 1}`, name: `output${i + 1}`,
      }));

      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.complexSwitch', outputs: manyOutputs, outputNames: manyOutputs.map(o => o.name), properties: [],
      });

      const workflow = {
        name: 'Many Outputs',
        nodes: [
          { id: '1', name: 'Complex Switch', type: 'n8n-nodes-base.complexSwitch', position: [100, 100], parameters: {} },
          { id: '2', name: 'Set', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: { 'Complex Switch': { main: Array.from({ length: 20 }, () => [{ node: 'Set', type: 'main', index: 0 }]) } },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result).toBeDefined();
    });

    it('should handle mixed output types (main, error, ai_tool)', async () => {
      mockNodeRepository.getNode.mockReturnValue({
        nodeType: 'nodes-base.complexNode', outputs: [{ displayName: 'Main', type: 'main' }, { displayName: 'Error', type: 'error' }], properties: [],
      });

      const workflow = {
        name: 'Mixed Output Types',
        nodes: [
          { id: '1', name: 'Complex Node', type: 'n8n-nodes-base.complexNode', position: [100, 100], parameters: {} },
          { id: '2', name: 'Main Handler', type: 'n8n-nodes-base.set', position: [300, 50], parameters: {} },
          { id: '3', name: 'Error Handler', type: 'n8n-nodes-base.set', position: [300, 150], parameters: {} },
          { id: '4', name: 'Tool', type: 'n8n-nodes-base.httpRequest', position: [500, 100], parameters: {} },
        ],
        connections: {
          'Complex Node': {
            main: [[{ node: 'Main Handler', type: 'main', index: 0 }]],
            error: [[{ node: 'Error Handler', type: 'main', index: 0 }]],
            ai_tool: [[{ node: 'Tool', type: 'main', index: 0 }]],
          },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result).toBeDefined();
      expect(result.statistics.validConnections).toBe(3);
    });
  });

  describe('SplitInBatches specific edge cases', () => {
    it('should handle SplitInBatches with no connections', async () => {
      const workflow = {
        name: 'Isolated SplitInBatches',
        nodes: [{ id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} }],
        connections: {},
      };

      const result = await validator.validateWorkflow(workflow as any);
      const splitWarnings = result.warnings.filter(w => w.message?.includes('SplitInBatches') || w.message?.includes('loop') || w.message?.includes('done'));
      expect(splitWarnings).toHaveLength(0);
    });

    it('should handle SplitInBatches with only done output connected', async () => {
      const workflow = {
        name: 'Single Output SplitInBatches',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} },
          { id: '2', name: 'Final Action', type: 'n8n-nodes-base.emailSend', position: [300, 100], parameters: {} },
        ],
        connections: { 'Split In Batches': { main: [[{ node: 'Final Action', type: 'main', index: 0 }], []] } },
      };

      const result = await validator.validateWorkflow(workflow as any);
      const loopWarnings = result.warnings.filter(w => w.message?.includes('loop') && w.message?.includes('connect back'));
      expect(loopWarnings).toHaveLength(0);
    });

    it('should handle SplitInBatches with both outputs to same node', async () => {
      const workflow = {
        name: 'Same Target SplitInBatches',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} },
          { id: '2', name: 'Multi Purpose', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: {
          'Split In Batches': { main: [[{ node: 'Multi Purpose', type: 'main', index: 0 }], [{ node: 'Multi Purpose', type: 'main', index: 0 }]] },
          'Multi Purpose': { main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      const loopWarnings = result.warnings.filter(w => w.message?.includes('loop') && w.message?.includes('connect back'));
      expect(loopWarnings).toHaveLength(0);
    });

    it('should detect reversed outputs with processing node on done output', async () => {
      const workflow = {
        name: 'Reversed SplitInBatches with Function Node',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} },
          { id: '2', name: 'Process Function', type: 'n8n-nodes-base.function', position: [300, 100], parameters: {} },
        ],
        connections: {
          'Split In Batches': { main: [[{ node: 'Process Function', type: 'main', index: 0 }], []] },
          'Process Function': { main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      const reversedErrors = result.errors.filter(e => e.message?.includes('SplitInBatches outputs appear reversed'));
      expect(reversedErrors).toHaveLength(1);
    });

    it('should handle self-referencing nodes in loop back detection', async () => {
      const workflow = {
        name: 'Self Reference in Loop Back',
        nodes: [
          { id: '1', name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', position: [100, 100], parameters: {} },
          { id: '2', name: 'SelfRef', type: 'n8n-nodes-base.set', position: [300, 100], parameters: {} },
        ],
        connections: {
          'Split In Batches': { main: [[], [{ node: 'SelfRef', type: 'main', index: 0 }]] },
          'SelfRef': { main: [[{ node: 'SelfRef', type: 'main', index: 0 }]] },
        },
      };

      const result = await validator.validateWorkflow(workflow as any);
      expect(result.warnings.filter(w => w.message?.includes("doesn't connect back"))).toHaveLength(1);
      expect(result.warnings.filter(w => w.message?.includes('self-referencing'))).toHaveLength(1);
    });

    it('should handle many SplitInBatches nodes', async () => {
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `split${i}`, name: `Split ${i}`, type: 'n8n-nodes-base.splitInBatches',
        position: [100 + (i % 10) * 100, 100 + Math.floor(i / 10) * 100], parameters: {},
      }));

      const connections: any = {};
      for (let i = 0; i < 99; i++) {
        connections[`Split ${i}`] = { main: [[{ node: `Split ${i + 1}`, type: 'main', index: 0 }], []] };
      }

      const result = await validator.validateWorkflow({ name: 'Many SplitInBatches', nodes, connections } as any);
      expect(result).toBeDefined();
      expect(result.statistics.totalNodes).toBe(100);
    });
  });
});