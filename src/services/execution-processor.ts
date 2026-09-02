/**
 * Execution Processor Service
 *
 * Intelligent processing and filtering of n8n execution data to enable
 * AI agents to inspect executions without exceeding token limits.
 *
 * Features:
 * - Preview mode: Show structure and counts without values
 * - Summary mode: Smart default with 2 sample items per node
 * - Filtered mode: Granular control (node filtering, item limits)
 * - Smart recommendations: Guide optimal retrieval strategy
 */

import {
  Execution,
  ExecutionMode,
  ExecutionPreview,
  NodePreview,
  ExecutionRecommendation,
  ExecutionFilterOptions,
  FilteredExecutionResponse,
  FilteredNodeData,
  ExecutionStatus,
  Workflow,
} from '../types/n8n-api';
import { logger } from '../utils/logger';
import { processErrorExecution } from './error-execution-processor';
import {
  extractConnectionBranches,
  firstRunItem,
  getRunError,
  mergeRunBranches,
  totalExecutionTime,
  type RunBranch,
} from './execution-run-data';

/**
 * Size estimation and threshold constants
 */
const THRESHOLDS = {
  CHAR_SIZE_BYTES: 2, // UTF-16 characters
  OVERHEAD_PER_OBJECT: 50, // Approximate JSON overhead
  MAX_RECOMMENDED_SIZE_KB: 100, // Threshold for "can fetch full"
  SMALL_DATASET_ITEMS: 20, // <= this is considered small
  MODERATE_DATASET_ITEMS: 50, // <= this is considered moderate
  MODERATE_DATASET_SIZE_KB: 200, // <= this is considered moderate
  MAX_DEPTH: 3, // Maximum depth for structure extraction
  MAX_ITEMS_LIMIT: 1000, // Maximum allowed itemsLimit value
} as const;

/**
 * Helper function to extract error message from various error formats
 */
function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if ('error' in error && typeof error.error === 'string') {
      return error.error;
    }
  }
  return 'Unknown error';
}

/**
 * Extract data structure (JSON schema-like) from items
 */
function extractStructure(data: unknown, maxDepth = THRESHOLDS.MAX_DEPTH, currentDepth = 0): Record<string, unknown> | string | unknown[] {
  if (currentDepth >= maxDepth) {
    return typeof data;
  }

  if (data === null || data === undefined) {
    return 'null';
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return [];
    }
    // Extract structure from first item
    return [extractStructure(data[0], maxDepth, currentDepth + 1)];
  }

  if (typeof data === 'object') {
    const structure: Record<string, unknown> = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        structure[key] = extractStructure((data as Record<string, unknown>)[key], maxDepth, currentDepth + 1);
      }
    }
    return structure;
  }

  return typeof data;
}

/**
 * Estimate size of data in KB
 */
function estimateDataSize(data: unknown): number {
  try {
    const jsonString = JSON.stringify(data);
    const sizeBytes = jsonString.length * THRESHOLDS.CHAR_SIZE_BYTES;
    return Math.ceil(sizeBytes / 1024);
  } catch (error) {
    logger.warn('Failed to estimate data size', { error });
    return 0;
  }
}

/**
 * Count items in execution data
 */
function countItems(nodeData: unknown): { input: number; output: number } {
  const counts = { input: 0, output: 0 };

  if (!nodeData || !Array.isArray(nodeData)) {
    return counts;
  }

  for (const run of nodeData) {
    for (const output of extractConnectionBranches(run?.data)) {
      counts.output += output?.length ?? 0;
    }
    for (const input of extractConnectionBranches(run?.inputOverride)) {
      counts.input += input?.length ?? 0;
    }
  }

  return counts;
}

/**
 * Generate preview for an execution
 */
export function generatePreview(execution: Execution): {
  preview: ExecutionPreview;
  recommendation: ExecutionRecommendation;
} {
  const preview: ExecutionPreview = {
    totalNodes: 0,
    executedNodes: 0,
    estimatedSizeKB: 0,
    nodes: {},
  };

  if (!execution.data?.resultData?.runData) {
    return {
      preview,
      recommendation: {
        canFetchFull: true,
        suggestedMode: 'summary',
        reason: 'No execution data available',
      },
    };
  }

  const runData = execution.data.resultData.runData;
  const nodeNames = Object.keys(runData);
  preview.totalNodes = nodeNames.length;

  let totalItemsOutput = 0;
  let largestNodeItems = 0;

  for (const nodeName of nodeNames) {
    const nodeData = runData[nodeName];
    const itemCounts = countItems(nodeData);

    // Structure of the first output item any run produced
    let dataStructure: Record<string, unknown> = {};
    const firstItem = firstRunItem(nodeData);
    if (firstItem) {
      dataStructure = extractStructure(firstItem) as Record<string, unknown>;
    }

    const nodeSize = estimateDataSize(nodeData);

    const nodePreview: NodePreview = {
      status: 'success',
      itemCounts,
      dataStructure,
      estimatedSizeKB: nodeSize,
    };

    const runError = getRunError(nodeData);
    if (runError) {
      nodePreview.status = 'error';
      nodePreview.error = extractErrorMessage(runError);
    }

    preview.nodes[nodeName] = nodePreview;
    preview.estimatedSizeKB += nodeSize;
    preview.executedNodes++;
    totalItemsOutput += itemCounts.output;
    largestNodeItems = Math.max(largestNodeItems, itemCounts.output);
  }

  // Generate recommendation
  const recommendation = generateRecommendation(
    preview.estimatedSizeKB,
    totalItemsOutput,
    largestNodeItems
  );

  return { preview, recommendation };
}

/**
 * Generate smart recommendation based on data characteristics
 */
function generateRecommendation(
  totalSizeKB: number,
  totalItems: number,
  largestNodeItems: number
): ExecutionRecommendation {
  // Can safely fetch full data
  if (totalSizeKB <= THRESHOLDS.MAX_RECOMMENDED_SIZE_KB && totalItems <= THRESHOLDS.SMALL_DATASET_ITEMS) {
    return {
      canFetchFull: true,
      suggestedMode: 'full',
      reason: `Small dataset (${totalSizeKB}KB, ${totalItems} items). Safe to fetch full data.`,
    };
  }

  // Moderate size - use summary
  if (totalSizeKB <= THRESHOLDS.MODERATE_DATASET_SIZE_KB && totalItems <= THRESHOLDS.MODERATE_DATASET_ITEMS) {
    return {
      canFetchFull: false,
      suggestedMode: 'summary',
      suggestedItemsLimit: 2,
      reason: `Moderate dataset (${totalSizeKB}KB, ${totalItems} items). Summary mode recommended.`,
    };
  }

  // Large dataset - filter with limits
  const suggestedLimit = Math.max(1, Math.min(5, Math.floor(100 / largestNodeItems)));

  return {
    canFetchFull: false,
    suggestedMode: 'filtered',
    suggestedItemsLimit: suggestedLimit,
    reason: `Large dataset (${totalSizeKB}KB, ${totalItems} items). Use filtered mode with itemsLimit: ${suggestedLimit}.`,
  };
}

/**
 * Truncate items array with metadata
 */
function truncateItems(
  items: RunBranch[],
  limit: number,
  knownTotal?: number
): {
  truncated: RunBranch[];
  metadata: { totalItems: number; itemsShown: number; truncated: boolean };
} {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      truncated: items || [],
      metadata: {
        totalItems: knownTotal ?? 0,
        itemsShown: 0,
        truncated: (knownTotal ?? 0) > 0,
      },
    };
  }

  // `knownTotal` lets the caller pass branches merged only up to the limit.
  let totalItems = knownTotal ?? 0;
  if (knownTotal === undefined) {
    for (const output of items) {
      if (Array.isArray(output)) {
        totalItems += output.length;
      }
    }
  }

  // Special case: limit = 0 means structure only
  if (limit === 0) {
    const structureOnly = items.map(output => {
      if (output === null) return null;
      if (!Array.isArray(output) || output.length === 0) {
        return [];
      }
      return [extractStructure(output[0])];
    });

    return {
      truncated: structureOnly,
      metadata: {
        totalItems,
        itemsShown: 0,
        truncated: totalItems > 0,
      },
    };
  }

  // Limit = -1 means unlimited
  if (limit < 0) {
    return {
      truncated: items,
      metadata: {
        totalItems,
        itemsShown: totalItems,
        truncated: false,
      },
    };
  }

  // Apply limit
  const result: RunBranch[] = [];
  let itemsShown = 0;

  for (const output of items) {
    if (!Array.isArray(output)) {
      result.push(output);
      continue;
    }

    if (itemsShown >= limit) {
      break;
    }

    const remaining = limit - itemsShown;
    const toTake = Math.min(remaining, output.length);
    result.push(output.slice(0, toTake));
    itemsShown += toTake;
  }

  return {
    truncated: result,
    metadata: {
      totalItems,
      itemsShown,
      truncated: itemsShown < totalItems,
    },
  };
}

/**
 * Filter execution data based on options
 */
export function filterExecutionData(
  execution: Execution,
  options: ExecutionFilterOptions,
  workflow?: Workflow
): FilteredExecutionResponse {
  const mode = options.mode || 'summary';

  // Validate and bound itemsLimit
  let itemsLimit = options.itemsLimit !== undefined ? options.itemsLimit : 2;
  if (itemsLimit !== -1) { // -1 means unlimited
    if (itemsLimit < 0) {
      logger.warn('Invalid itemsLimit, defaulting to 2', { provided: itemsLimit });
      itemsLimit = 2;
    }
    if (itemsLimit > THRESHOLDS.MAX_ITEMS_LIMIT) {
      logger.warn(`itemsLimit capped at ${THRESHOLDS.MAX_ITEMS_LIMIT}`, { provided: itemsLimit });
      itemsLimit = THRESHOLDS.MAX_ITEMS_LIMIT;
    }
  }

  const includeInputData = options.includeInputData || false;
  const nodeNamesFilter = options.nodeNames;

  // Calculate duration
  const duration = execution.stoppedAt && execution.startedAt
    ? new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime()
    : undefined;

  const response: FilteredExecutionResponse = {
    id: execution.id,
    workflowId: execution.workflowId,
    status: execution.status,
    mode,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    duration,
    finished: execution.finished,
  };

  // Handle preview mode
  if (mode === 'preview') {
    const { preview, recommendation } = generatePreview(execution);
    response.preview = preview;
    response.recommendation = recommendation;
    return response;
  }

  // Handle error mode
  if (mode === 'error') {
    const errorAnalysis = processErrorExecution(execution, {
      itemsLimit: options.errorItemsLimit ?? 2,
      includeStackTrace: options.includeStackTrace ?? false,
      includeExecutionPath: options.includeExecutionPath !== false,
      workflow
    });

    const runData = execution.data?.resultData?.runData || {};
    const executedNodes = Object.keys(runData).length;

    response.errorInfo = errorAnalysis;
    response.summary = {
      totalNodes: executedNodes,
      executedNodes,
      totalItems: 0,
      hasMoreData: false
    };

    if (execution.data?.resultData?.error) {
      response.error = execution.data.resultData.error as Record<string, unknown>;
    }

    return response;
  }

  // Handle no data case
  if (!execution.data?.resultData?.runData) {
    response.summary = {
      totalNodes: 0,
      executedNodes: 0,
      totalItems: 0,
      hasMoreData: false,
    };
    response.nodes = {};

    if (execution.data?.resultData?.error) {
      response.error = execution.data.resultData.error;
    }

    return response;
  }

  const runData = execution.data.resultData.runData;
  let nodeNames = Object.keys(runData);

  // Apply node name filter
  if (nodeNamesFilter && nodeNamesFilter.length > 0) {
    nodeNames = nodeNames.filter(name => nodeNamesFilter.includes(name));
  }

  // Process nodes
  const processedNodes: Record<string, FilteredNodeData> = {};
  let totalItems = 0;
  let hasMoreData = false;

  for (const nodeName of nodeNames) {
    const nodeData = runData[nodeName];

    if (!Array.isArray(nodeData) || nodeData.length === 0) {
      processedNodes[nodeName] = {
        itemsInput: 0,
        itemsOutput: 0,
        status: 'success',
      };
      continue;
    }

    // Every field aggregates across all runs of the node.
    const itemCounts = countItems(nodeData);
    totalItems += itemCounts.output;

    const nodeResult: FilteredNodeData = {
      executionTime: totalExecutionTime(nodeData),
      itemsInput: itemCounts.input,
      itemsOutput: itemCounts.output,
      status: 'success',
    };

    const runError = getRunError(nodeData);
    if (runError) {
      nodeResult.status = 'error';
      nodeResult.error = extractErrorMessage(runError);
    }

    // Merge only as many items per branch as will be shown; the counts above supply the totals.
    // Structure-only (limit 0) still needs the first item of each branch.
    const maxPerBranch = mode === 'full' || itemsLimit < 0 ? -1 : Math.max(itemsLimit, 1);
    const outputData = mergeRunBranches(nodeData, 'data', maxPerBranch);

    if (mode === 'full') {
      nodeResult.data = {
        output: outputData,
        metadata: {
          totalItems: itemCounts.output,
          itemsShown: itemCounts.output,
          truncated: false,
        },
      };
    } else {
      // Summary or filtered mode - apply item limits
      const { truncated, metadata } = truncateItems(outputData, itemsLimit, itemCounts.output);

      if (metadata.truncated) {
        hasMoreData = true;
      }

      nodeResult.data = {
        output: truncated,
        metadata,
      };
    }

    if (includeInputData && itemCounts.input > 0) {
      const inputData = mergeRunBranches(nodeData, 'inputOverride', maxPerBranch);
      if (mode === 'full') {
        nodeResult.data.input = inputData;
      } else {
        const { truncated, metadata } = truncateItems(inputData, itemsLimit, itemCounts.input);
        if (metadata.truncated) {
          hasMoreData = true;
        }
        nodeResult.data.input = truncated;
        nodeResult.data.inputMetadata = metadata;
      }
    }

    processedNodes[nodeName] = nodeResult;
  }

  // Add summary
  response.summary = {
    totalNodes: Object.keys(runData).length,
    executedNodes: nodeNames.length,
    totalItems,
    hasMoreData,
  };

  response.nodes = processedNodes;

  // Include error if present
  if (execution.data?.resultData?.error) {
    response.error = execution.data.resultData.error;
  }

  return response;
}

/**
 * Process execution based on mode and options
 * Main entry point for the service
 */
export function processExecution(
  execution: Execution,
  options: ExecutionFilterOptions = {},
  workflow?: Workflow
): FilteredExecutionResponse | Execution {
  // Legacy behavior: if no mode specified and no filtering options, return original
  if (!options.mode && !options.nodeNames && options.itemsLimit === undefined) {
    return execution;
  }

  return filterExecutionData(execution, options, workflow);
}
