/**
 * Execution Processor Service Tests
 *
 * Comprehensive test coverage for execution filtering and processing
 */

import { describe, it, expect } from 'vitest';
import {
  generatePreview,
  filterExecutionData,
  processExecution,
} from '../../../src/services/execution-processor';
import {
  Execution,
  ExecutionStatus,
  ExecutionFilterOptions,
} from '../../../src/types/n8n-api';

/**
 * Test data factories
 */

function createMockExecution(options: {
  id?: string;
  status?: ExecutionStatus;
  nodeData?: Record<string, any>;
  hasError?: boolean;
}): Execution {
  const { id = 'test-exec-1', status = ExecutionStatus.SUCCESS, nodeData = {}, hasError = false } = options;

  return {
    id,
    workflowId: 'workflow-1',
    status,
    mode: 'manual',
    finished: true,
    startedAt: '2024-01-01T10:00:00.000Z',
    stoppedAt: '2024-01-01T10:00:05.000Z',
    data: {
      resultData: {
        runData: nodeData,
        error: hasError ? { message: 'Test error' } : undefined,
      },
    },
  };
}

function createNodeData(itemCount: number, includeError = false) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    json: {
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.random() * 100,
      nested: {
        field1: `value${i}`,
        field2: true,
      },
    },
  }));

  return [
    {
      startTime: Date.now(),
      executionTime: 123,
      data: {
        main: [items],
      },
      error: includeError ? { message: 'Node error' } : undefined,
    },
  ];
}

/**
 * Preview Mode Tests
 */
describe('ExecutionProcessor - Preview Mode', () => {
  it('should generate preview for empty execution', () => {
    const execution = createMockExecution({ nodeData: {} });
    const { preview, recommendation } = generatePreview(execution);

    expect(preview.totalNodes).toBe(0);
    expect(preview.executedNodes).toBe(0);
    expect(preview.estimatedSizeKB).toBe(0);
    expect(recommendation.canFetchFull).toBe(true);
    expect(recommendation.suggestedMode).toBe('full'); // Empty execution is safe to fetch in full
  });

  it('should generate preview with accurate item counts', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
        'Filter': createNodeData(12),
      },
    });

    const { preview } = generatePreview(execution);

    expect(preview.totalNodes).toBe(2);
    expect(preview.executedNodes).toBe(2);
    expect(preview.nodes['HTTP Request'].itemCounts.output).toBe(50);
    expect(preview.nodes['Filter'].itemCounts.output).toBe(12);
  });

  it('should extract data structure from nodes', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
      },
    });

    const { preview } = generatePreview(execution);
    const structure = preview.nodes['HTTP Request'].dataStructure;

    expect(structure).toHaveProperty('json');
    expect(structure.json).toHaveProperty('id');
    expect(structure.json).toHaveProperty('name');
    expect(structure.json).toHaveProperty('nested');
    expect(structure.json.id).toBe('number');
    expect(structure.json.name).toBe('string');
    expect(typeof structure.json.nested).toBe('object');
  });

  it('should estimate data size', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const { preview } = generatePreview(execution);

    expect(preview.estimatedSizeKB).toBeGreaterThan(0);
    expect(preview.nodes['HTTP Request'].estimatedSizeKB).toBeGreaterThan(0);
  });

  it('should detect error status in nodes', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5, true),
      },
    });

    const { preview } = generatePreview(execution);

    expect(preview.nodes['HTTP Request'].status).toBe('error');
    expect(preview.nodes['HTTP Request'].error).toBeDefined();
  });

  it('should recommend full mode for small datasets', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
      },
    });

    const { recommendation } = generatePreview(execution);

    expect(recommendation.canFetchFull).toBe(true);
    expect(recommendation.suggestedMode).toBe('full');
  });

  it('should recommend filtered mode for large datasets', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(100),
      },
    });

    const { recommendation } = generatePreview(execution);

    expect(recommendation.canFetchFull).toBe(false);
    expect(recommendation.suggestedMode).toBe('filtered');
    expect(recommendation.suggestedItemsLimit).toBeGreaterThan(0);
  });

  it('should recommend summary mode for moderate datasets', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(30),
      },
    });

    const { recommendation } = generatePreview(execution);

    expect(recommendation.canFetchFull).toBe(false);
    expect(recommendation.suggestedMode).toBe('summary');
  });
});

/**
 * Filtering Mode Tests
 */
describe('ExecutionProcessor - Filtering', () => {
  it('should filter by node names', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(10),
        'Filter': createNodeData(5),
        'Set': createNodeData(3),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      nodeNames: ['HTTP Request', 'Filter'],
    };

    const result = filterExecutionData(execution, options);

    expect(result.nodes).toHaveProperty('HTTP Request');
    expect(result.nodes).toHaveProperty('Filter');
    expect(result.nodes).not.toHaveProperty('Set');
    expect(result.summary?.executedNodes).toBe(2);
  });

  it('should handle non-existent node names gracefully', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(10),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      nodeNames: ['NonExistent'],
    };

    const result = filterExecutionData(execution, options);

    expect(Object.keys(result.nodes || {})).toHaveLength(0);
    expect(result.summary?.executedNodes).toBe(0);
  });

  it('should limit items to 0 (structure only)', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      itemsLimit: 0,
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.metadata.itemsShown).toBe(0);
    expect(nodeData?.data?.metadata.truncated).toBe(true);
    expect(nodeData?.data?.metadata.totalItems).toBe(50);

    // Check that we have structure but no actual values
    const output = nodeData?.data?.output?.[0]?.[0];
    expect(output).toBeDefined();
    expect(typeof output).toBe('object');
  });

  it('should limit items to 2 (default)', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'summary',
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.metadata.itemsShown).toBe(2);
    expect(nodeData?.data?.metadata.totalItems).toBe(50);
    expect(nodeData?.data?.metadata.truncated).toBe(true);
    expect(nodeData?.data?.output?.[0]).toHaveLength(2);
  });

  it('should limit items to custom value', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      itemsLimit: 5,
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.metadata.itemsShown).toBe(5);
    expect(nodeData?.data?.metadata.truncated).toBe(true);
    expect(nodeData?.data?.output?.[0]).toHaveLength(5);
  });

  it('should not truncate when itemsLimit is -1 (unlimited)', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      itemsLimit: -1,
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.metadata.itemsShown).toBe(50);
    expect(nodeData?.data?.metadata.totalItems).toBe(50);
    expect(nodeData?.data?.metadata.truncated).toBe(false);
  });

  it('should not truncate when items are less than limit', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(3),
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      itemsLimit: 5,
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.metadata.itemsShown).toBe(3);
    expect(nodeData?.data?.metadata.truncated).toBe(false);
  });

  it('should include input data when requested', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': [
          {
            startTime: Date.now(),
            executionTime: 100,
            inputOverride: {
              main: [[{ json: { input: 'test' } }]],
            },
            data: {
              main: [[{ json: { output: 'result' } }]],
            },
          },
        ],
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
      includeInputData: true,
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.input).toBeDefined();
    expect(nodeData?.data?.input?.[0]?.[0]?.json?.input).toBe('test');
  });

  it('should not include input data by default', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': [
          {
            startTime: Date.now(),
            executionTime: 100,
            inputOverride: {
              main: [[{ json: { input: 'test' } }]],
            },
            data: {
              main: [[{ json: { output: 'result' } }]],
            },
          },
        ],
      },
    });

    const options: ExecutionFilterOptions = {
      mode: 'filtered',
    };

    const result = filterExecutionData(execution, options);
    const nodeData = result.nodes?.['HTTP Request'];

    expect(nodeData?.data?.input).toBeUndefined();
  });
});

/**
 * Mode Tests
 */
describe('ExecutionProcessor - Modes', () => {
  it('should handle preview mode', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const result = filterExecutionData(execution, { mode: 'preview' });

    expect(result.mode).toBe('preview');
    expect(result.preview).toBeDefined();
    expect(result.recommendation).toBeDefined();
    expect(result.nodes).toBeUndefined();
  });

  it('should handle summary mode', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.mode).toBe('summary');
    expect(result.summary).toBeDefined();
    expect(result.nodes).toBeDefined();
    expect(result.nodes?.['HTTP Request']?.data?.metadata.itemsShown).toBe(2);
  });

  it('should handle filtered mode', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const result = filterExecutionData(execution, {
      mode: 'filtered',
      itemsLimit: 5,
    });

    expect(result.mode).toBe('filtered');
    expect(result.summary).toBeDefined();
    expect(result.nodes?.['HTTP Request']?.data?.metadata.itemsShown).toBe(5);
  });

  it('should handle full mode', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const result = filterExecutionData(execution, { mode: 'full' });

    expect(result.mode).toBe('full');
    expect(result.nodes?.['HTTP Request']?.data?.metadata.itemsShown).toBe(50);
    expect(result.nodes?.['HTTP Request']?.data?.metadata.truncated).toBe(false);
  });
});

/**
 * Edge Cases
 */
describe('ExecutionProcessor - Edge Cases', () => {
  it('should handle execution with no data', () => {
    const execution: Execution = {
      id: 'test-1',
      workflowId: 'workflow-1',
      status: ExecutionStatus.SUCCESS,
      mode: 'manual',
      finished: true,
      startedAt: '2024-01-01T10:00:00.000Z',
      stoppedAt: '2024-01-01T10:00:05.000Z',
    };

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.summary?.totalNodes).toBe(0);
    expect(result.summary?.executedNodes).toBe(0);
  });

  it('should handle execution with error', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
      },
      hasError: true,
    });

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.error).toBeDefined();
  });

  it('should handle empty node data arrays', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': [],
      },
    });

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.nodes?.['HTTP Request']).toBeDefined();
    expect(result.nodes?.['HTTP Request'].itemsOutput).toBe(0);
  });

  it('should handle nested data structures', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': [
          {
            startTime: Date.now(),
            executionTime: 100,
            data: {
              main: [[{
                json: {
                  deeply: {
                    nested: {
                      structure: {
                        value: 'test',
                        array: [1, 2, 3],
                      },
                    },
                  },
                },
              }]],
            },
          },
        ],
      },
    });

    const { preview } = generatePreview(execution);
    const structure = preview.nodes['HTTP Request'].dataStructure;

    expect(structure.json.deeply).toBeDefined();
    expect(typeof structure.json.deeply).toBe('object');
  });

  it('should calculate duration correctly', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
      },
    });

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.duration).toBe(5000); // 5 seconds
  });

  it('should handle execution without stop time', () => {
    const execution: Execution = {
      id: 'test-1',
      workflowId: 'workflow-1',
      status: ExecutionStatus.WAITING,
      mode: 'manual',
      finished: false,
      startedAt: '2024-01-01T10:00:00.000Z',
      data: {
        resultData: {
          runData: {},
        },
      },
    };

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.duration).toBeUndefined();
    expect(result.finished).toBe(false);
  });
});

/**
 * processExecution Tests
 */
describe('ExecutionProcessor - processExecution', () => {
  it('should return original execution when no options provided', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
      },
    });

    const result = processExecution(execution, {});

    expect(result).toBe(execution);
  });

  it('should process when mode is specified', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
      },
    });

    const result = processExecution(execution, { mode: 'preview' });

    expect(result).not.toBe(execution);
    expect((result as any).mode).toBe('preview');
  });

  it('should process when filtering options are provided', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(5),
        'Filter': createNodeData(3),
      },
    });

    const result = processExecution(execution, { nodeNames: ['HTTP Request'] });

    expect(result).not.toBe(execution);
    expect((result as any).nodes).toHaveProperty('HTTP Request');
    expect((result as any).nodes).not.toHaveProperty('Filter');
  });
});

/**
 * Summary Statistics Tests
 */
describe('ExecutionProcessor - Summary Statistics', () => {
  it('should calculate hasMoreData correctly', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(50),
      },
    });

    const result = filterExecutionData(execution, {
      mode: 'summary',
      itemsLimit: 2,
    });

    expect(result.summary?.hasMoreData).toBe(true);
  });

  it('should set hasMoreData to false when all data is included', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(2),
      },
    });

    const result = filterExecutionData(execution, {
      mode: 'summary',
      itemsLimit: 5,
    });

    expect(result.summary?.hasMoreData).toBe(false);
  });

  it('should count total items correctly across multiple nodes', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request': createNodeData(10),
        'Filter': createNodeData(5),
        'Set': createNodeData(3),
      },
    });

    const result = filterExecutionData(execution, { mode: 'summary' });

    expect(result.summary?.totalItems).toBe(18);
  });
});

/**
 * AI Agent sub-node connection type tests
 *
 * LangChain AI Agent sub-nodes (Chat Model, Output Parser, Tool, Memory,
 * Embeddings, etc.) connect to their parent Agent node via special `ai_*`
 * connection types instead of `main`. Their task data therefore lives at
 * `run.data.ai_languageModel`, `run.data.ai_outputParser`, `run.data.ai_tool`,
 * etc. rather than `run.data.main`.
 */
describe('ExecutionProcessor - AI Agent sub-node connection types', () => {
  it('should extract itemsOutput from ai_languageModel connection data', () => {
    const execution = createMockExecution({
      nodeData: {
        'OpenAI Chat Model': [
          {
            startTime: Date.now(),
            executionTime: 850,
            data: {
              ai_languageModel: [[{ json: { response: { generations: [[{ text: 'hi' }]] }, tokenUsage: { totalTokens: 42 } } }]],
            },
          },
        ],
      },
    });

    const result = filterExecutionData(execution, { mode: 'full' });
    const nodeData = result.nodes?.['OpenAI Chat Model'];

    expect(nodeData?.itemsOutput).toBe(1);
    expect(nodeData?.data?.output?.[0]?.[0]?.json?.tokenUsage?.totalTokens).toBe(42);
  });

  it('should extract itemsOutput from ai_outputParser connection data', () => {
    const execution = createMockExecution({
      nodeData: {
        'Structured Output Parser': [
          {
            startTime: Date.now(),
            executionTime: 5,
            data: {
              ai_outputParser: [[{ json: { output: { category: 'buyer_request' } } }]],
            },
          },
        ],
      },
    });

    const result = filterExecutionData(execution, { mode: 'summary' });
    const nodeData = result.nodes?.['Structured Output Parser'];

    expect(nodeData?.itemsOutput).toBe(1);
    expect(nodeData?.data?.output?.[0]?.[0]?.json?.output?.category).toBe('buyer_request');
  });

  it('should extract itemsOutput from ai_tool connection data', () => {
    const execution = createMockExecution({
      nodeData: {
        'HTTP Request Tool': [
          {
            startTime: Date.now(),
            executionTime: 200,
            data: {
              ai_tool: [[{ json: { result: 'tool output' } }]],
            },
          },
        ],
      },
    });

    const result = filterExecutionData(execution, { mode: 'filtered', itemsLimit: -1 });
    const nodeData = result.nodes?.['HTTP Request Tool'];

    expect(nodeData?.itemsOutput).toBe(1);
    expect(nodeData?.data?.output?.[0]?.[0]?.json?.result).toBe('tool output');
  });

  it('should include ai_* nodes in preview mode item counts and structure', () => {
    const execution = createMockExecution({
      nodeData: {
        'OpenAI Chat Model': [
          {
            startTime: Date.now(),
            executionTime: 850,
            data: {
              ai_languageModel: [[{ json: { tokenUsage: { totalTokens: 10 } } }]],
            },
          },
        ],
      },
    });

    const { preview } = generatePreview(execution);
    const nodePreview = preview.nodes['OpenAI Chat Model'];

    expect(nodePreview.itemCounts.output).toBe(1);
    expect(nodePreview.dataStructure).toHaveProperty('json');
  });

  it('should extract input data from inputOverride for ai_* connection types', () => {
    const execution = createMockExecution({
      nodeData: {
        'OpenAI Chat Model': [
          {
            startTime: Date.now(),
            executionTime: 850,
            inputOverride: {
              ai_languageModel: [[{ json: { messages: ['System: hi'] } }]],
            },
            data: {
              ai_languageModel: [[{ json: { tokenUsage: { totalTokens: 10 } } }]],
            },
          },
        ],
      },
    });

    const result = filterExecutionData(execution, { mode: 'full', includeInputData: true });
    const nodeData = result.nodes?.['OpenAI Chat Model'];

    expect(nodeData?.itemsInput).toBe(1);
    expect(nodeData?.data?.input?.[0]?.[0]?.json?.messages?.[0]).toBe('System: hi');
  });

  it('should not conflate ai_* and main data when both happen to be present', () => {
    const execution = createMockExecution({
      nodeData: {
        'Mixed Node': [
          {
            startTime: Date.now(),
            executionTime: 10,
            data: {
              main: [[{ json: { a: 1 } }]],
              ai_tool: [[{ json: { b: 2 } }]],
            },
          },
        ],
      },
    });

    const result = filterExecutionData(execution, { mode: 'full' });
    const nodeData = result.nodes?.['Mixed Node'];

    // Both branches should be counted/included since a node's task data
    // could in principle populate more than one connection type.
    expect(nodeData?.itemsOutput).toBe(2);
  });
});
