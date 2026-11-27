import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeParser } from '@/parsers/node-parser';
import { PropertyExtractor } from '@/parsers/property-extractor';

// Mock PropertyExtractor
vi.mock('@/parsers/property-extractor');

describe('NodeParser - Output Extraction', () => {
  let parser: NodeParser;
  let mockPropertyExtractor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockPropertyExtractor = {
      extractProperties: vi.fn().mockReturnValue([]),
      extractCredentials: vi.fn().mockReturnValue([]),
      detectAIToolCapability: vi.fn().mockReturnValue(false),
      extractOperations: vi.fn().mockReturnValue([])
    };
    
    (PropertyExtractor as any).mockImplementation(function () { return mockPropertyExtractor; });
    
    parser = new NodeParser();
  });

  describe('extractOutputs method', () => {
    it('should extract outputs array from base description', () => {
      const outputs = [
        { displayName: 'Done', description: 'Final results when loop completes' },
        { displayName: 'Loop', description: 'Current batch data during iteration' }
      ];
      
      const nodeDescription = {
        name: 'splitInBatches',
        displayName: 'Split In Batches',
        outputs
      };
      
      const NodeClass = class {
        description = nodeDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(outputs);
      expect(result.outputNames).toBeUndefined();
    });

    it('should extract outputNames array from base description', () => {
      const outputNames = ['done', 'loop'];
      
      const nodeDescription = {
        name: 'splitInBatches',
        displayName: 'Split In Batches',
        outputNames
      };
      
      const NodeClass = class {
        description = nodeDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputNames).toEqual(outputNames);
      expect(result.outputs).toBeUndefined();
    });

    it('should extract both outputs and outputNames when both are present', () => {
      const outputs = [
        { displayName: 'Done', description: 'Final results when loop completes' },
        { displayName: 'Loop', description: 'Current batch data during iteration' }
      ];
      const outputNames = ['done', 'loop'];
      
      const nodeDescription = {
        name: 'splitInBatches',
        displayName: 'Split In Batches',
        outputs,
        outputNames
      };
      
      const NodeClass = class {
        description = nodeDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(outputs);
      expect(result.outputNames).toEqual(outputNames);
    });

    it('should convert single output to array format', () => {
      const singleOutput = { displayName: 'Output', description: 'Single output' };
      
      const nodeDescription = {
        name: 'singleOutputNode',
        displayName: 'Single Output Node',
        outputs: singleOutput
      };
      
      const NodeClass = class {
        description = nodeDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual([singleOutput]);
    });

    it('should convert single outputName to array format', () => {
      const nodeDescription = {
        name: 'singleOutputNode',
        displayName: 'Single Output Node',
        outputNames: 'main'
      };
      
      const NodeClass = class {
        description = nodeDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputNames).toEqual(['main']);
    });

    it('should extract outputs from versioned node when not in base description', () => {
      const versionedOutputs = [
        { displayName: 'True', description: 'Items that match condition' },
        { displayName: 'False', description: 'Items that do not match condition' }
      ];
      
      const NodeClass = class {
        description = {
          name: 'if',
          displayName: 'IF'
          // No outputs in base description
        };
        
        nodeVersions = {
          1: {
            description: {
              outputs: versionedOutputs
            }
          },
          2: {
            description: {
              outputs: versionedOutputs,
              outputNames: ['true', 'false']
            }
          }
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      // Should get outputs from latest version (2)
      expect(result.outputs).toEqual(versionedOutputs);
      expect(result.outputNames).toEqual(['true', 'false']);
    });

    it('should handle node instantiation failure gracefully', () => {
      const NodeClass = class {
        // Static description that can be accessed when instantiation fails
        static description = {
          name: 'problematic',
          displayName: 'Problematic Node'
        };
        
        constructor() {
          throw new Error('Cannot instantiate');
        }
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toBeUndefined();
      expect(result.outputNames).toBeUndefined();
    });

    it('should return empty result when no outputs found anywhere', () => {
      const nodeDescription = {
        name: 'noOutputs',
        displayName: 'No Outputs Node'
        // No outputs or outputNames
      };
      
      const NodeClass = class {
        description = nodeDescription;
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toBeUndefined();
      expect(result.outputNames).toBeUndefined();
    });

    it('should handle complex versioned node structure', () => {
      const NodeClass = class VersionedNodeType {
        baseDescription = {
          name: 'complexVersioned',
          displayName: 'Complex Versioned Node',
          defaultVersion: 3
        };
        
        nodeVersions = {
          1: {
            description: {
              outputs: [{ displayName: 'V1 Output' }]
            }
          },
          2: {
            description: {
              outputs: [
                { displayName: 'V2 Output 1' },
                { displayName: 'V2 Output 2' }
              ]
            }
          },
          3: {
            description: {
              outputs: [
                { displayName: 'V3 True', description: 'True branch' },
                { displayName: 'V3 False', description: 'False branch' }
              ],
              outputNames: ['true', 'false']
            }
          }
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      // Should use latest version (3)
      expect(result.outputs).toEqual([
        { displayName: 'V3 True', description: 'True branch' },
        { displayName: 'V3 False', description: 'False branch' }
      ]);
      expect(result.outputNames).toEqual(['true', 'false']);
    });

    it('should prefer base description outputs over versioned when both exist', () => {
      const baseOutputs = [{ displayName: 'Base Output' }];
      const versionedOutputs = [{ displayName: 'Versioned Output' }];
      
      const NodeClass = class {
        description = {
          name: 'preferBase',
          displayName: 'Prefer Base',
          outputs: baseOutputs
        };
        
        nodeVersions = {
          1: {
            description: {
              outputs: versionedOutputs
            }
          }
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(baseOutputs);
    });

    it('should handle IF node with typical output structure', () => {
      const ifOutputs = [
        { displayName: 'True', description: 'Items that match the condition' },
        { displayName: 'False', description: 'Items that do not match the condition' }
      ];
      
      const NodeClass = class {
        description = {
          name: 'if',
          displayName: 'IF',
          outputs: ifOutputs,
          outputNames: ['true', 'false']
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(ifOutputs);
      expect(result.outputNames).toEqual(['true', 'false']);
    });

    it('should handle SplitInBatches node with counterintuitive output structure', () => {
      const splitInBatchesOutputs = [
        { displayName: 'Done', description: 'Final results when loop completes' },
        { displayName: 'Loop', description: 'Current batch data during iteration' }
      ];
      
      const NodeClass = class {
        description = {
          name: 'splitInBatches',
          displayName: 'Split In Batches',
          outputs: splitInBatchesOutputs,
          outputNames: ['done', 'loop']
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(splitInBatchesOutputs);
      expect(result.outputNames).toEqual(['done', 'loop']);
      
      // Verify the counterintuitive order: done=0, loop=1
      expect(result.outputs).toBeDefined();
      expect(result.outputNames).toBeDefined();
      expect(result.outputs![0].displayName).toBe('Done');
      expect(result.outputs![1].displayName).toBe('Loop');
      expect(result.outputNames![0]).toBe('done');
      expect(result.outputNames![1]).toBe('loop');
    });

    it('should handle Switch node with multiple outputs', () => {
      const switchOutputs = [
        { displayName: 'Output 1', description: 'First branch' },
        { displayName: 'Output 2', description: 'Second branch' },
        { displayName: 'Output 3', description: 'Third branch' },
        { displayName: 'Fallback', description: 'Default branch when no conditions match' }
      ];
      
      const NodeClass = class {
        description = {
          name: 'switch',
          displayName: 'Switch',
          outputs: switchOutputs,
          outputNames: ['0', '1', '2', 'fallback']
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(switchOutputs);
      expect(result.outputNames).toEqual(['0', '1', '2', 'fallback']);
    });

    it('should handle empty outputs array', () => {
      const NodeClass = class {
        description = {
          name: 'emptyOutputs',
          displayName: 'Empty Outputs',
          outputs: [],
          outputNames: []
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual([]);
      expect(result.outputNames).toEqual([]);
    });

    it('should handle mismatched outputs and outputNames arrays', () => {
      const outputs = [
        { displayName: 'Output 1' },
        { displayName: 'Output 2' }
      ];
      const outputNames = ['first', 'second', 'third']; // One extra
      
      const NodeClass = class {
        description = {
          name: 'mismatched',
          displayName: 'Mismatched Arrays',
          outputs,
          outputNames
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toEqual(outputs);
      expect(result.outputNames).toEqual(outputNames);
    });
  });

  describe('real-world node structures', () => {
    it('should handle actual n8n SplitInBatches node structure', () => {
      // This mimics the actual structure from n8n-nodes-base
      const NodeClass = class {
        description = {
          name: 'splitInBatches',
          displayName: 'Split In Batches',
          description: 'Split data into batches and iterate over each batch',
          icon: 'fa:th-large',
          group: ['transform'],
          version: 3,
          outputs: [
            {
              displayName: 'Done',
              name: 'done',
              type: 'main',
              hint: 'Receives the final data after all batches have been processed'
            },
            {
              displayName: 'Loop',
              name: 'loop', 
              type: 'main',
              hint: 'Receives the current batch data during each iteration'
            }
          ],
          outputNames: ['done', 'loop']
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toHaveLength(2);
      expect(result.outputs).toBeDefined();
      expect(result.outputs![0].displayName).toBe('Done');
      expect(result.outputs![1].displayName).toBe('Loop');
      expect(result.outputNames).toEqual(['done', 'loop']);
    });

    it('should handle actual n8n IF node structure', () => {
      // This mimics the actual structure from n8n-nodes-base
      const NodeClass = class {
        description = {
          name: 'if',
          displayName: 'IF',
          description: 'Route items to different outputs based on conditions',
          icon: 'fa:map-signs',
          group: ['transform'],
          version: 2,
          outputs: [
            {
              displayName: 'True',
              name: 'true',
              type: 'main',
              hint: 'Items that match the condition'
            },
            {
              displayName: 'False',
              name: 'false',
              type: 'main',
              hint: 'Items that do not match the condition'
            }
          ],
          outputNames: ['true', 'false']
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toHaveLength(2);
      expect(result.outputs).toBeDefined();
      expect(result.outputs![0].displayName).toBe('True');
      expect(result.outputs![1].displayName).toBe('False');
      expect(result.outputNames).toEqual(['true', 'false']);
    });

    it('should handle single-output nodes like HTTP Request', () => {
      const NodeClass = class {
        description = {
          name: 'httpRequest',
          displayName: 'HTTP Request',
          description: 'Make HTTP requests',
          icon: 'fa:at',
          group: ['input'],
          version: 4
          // No outputs specified - single main output implied
        };
      };
      
      const result = parser.parse(NodeClass as any, 'n8n-nodes-base');
      
      expect(result.outputs).toBeUndefined();
      expect(result.outputNames).toBeUndefined();
    });
  });
});