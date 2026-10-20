/**
 * Error Execution Processor Service
 *
 * Specialized processor for extracting error context from failed n8n executions.
 * Designed for AI agent debugging workflows with token efficiency.
 *
 * Features:
 * - Auto-identify error nodes
 * - Extract upstream context (input data to error node)
 * - Build execution path from trigger to error
 * - Generate AI-friendly fix suggestions
 */

import {
  Execution,
  Workflow,
  ErrorAnalysis,
  ErrorSuggestion,
} from '../types/n8n-api';
import { logger } from '../utils/logger';
import {
  countRunItems,
  getRunError,
  latestStartTime,
  hasRunOutputData,
  sampleRunItems,
  totalExecutionTime,
} from './execution-run-data';

/**
 * Options for error processing
 */
export interface ErrorProcessorOptions {
  itemsLimit?: number;           // Default: 2
  includeStackTrace?: boolean;   // Default: false
  includeExecutionPath?: boolean; // Default: true
  workflow?: Workflow;           // Optional: for accurate upstream detection
}

// Constants
const MAX_STACK_LINES = 3;

/**
 * Keys that could enable prototype pollution attacks
 * These are blocked entirely from processing
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Patterns for sensitive data that should be masked in output
 * Expanded from code review recommendations
 */
const SENSITIVE_PATTERNS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'credential',
  'auth',
  'private_key',
  'privatekey',
  'bearer',
  'jwt',
  'oauth',
  'certificate',
  'passphrase',
  'access_token',
  'refresh_token',
  'session',
  'cookie',
  'authorization'
];

/**
 * Process execution for error debugging
 */
export function processErrorExecution(
  execution: Execution,
  options: ErrorProcessorOptions = {}
): ErrorAnalysis {
  const {
    itemsLimit = 2,
    includeStackTrace = false,
    includeExecutionPath = true,
    workflow
  } = options;

  const resultData = execution.data?.resultData;
  const error = resultData?.error as Record<string, unknown> | undefined;
  const runData = resultData?.runData as Record<string, any> || {};
  const lastNode = resultData?.lastNodeExecuted;

  // 1. Extract primary error info
  const primaryError = extractPrimaryError(error, lastNode, runData, includeStackTrace);

  // 2. Find and extract upstream context
  const upstreamContext = extractUpstreamContext(
    primaryError.nodeName,
    runData,
    workflow,
    itemsLimit
  );

  // 3. Build execution path if requested
  const executionPath = includeExecutionPath
    ? buildExecutionPath(primaryError.nodeName, runData, workflow)
    : undefined;

  // 4. Find additional errors (for batch failures)
  const additionalErrors = findAdditionalErrors(
    primaryError.nodeName,
    runData
  );

  // 5. Generate AI suggestions
  const suggestions = generateSuggestions(primaryError, upstreamContext);

  return {
    primaryError,
    upstreamContext,
    executionPath,
    additionalErrors: additionalErrors.length > 0 ? additionalErrors : undefined,
    suggestions: suggestions.length > 0 ? suggestions : undefined
  };
}

/**
 * Extract primary error information
 */
function extractPrimaryError(
  error: Record<string, unknown> | undefined,
  lastNode: string | undefined,
  runData: Record<string, any>,
  includeFullStackTrace: boolean
): ErrorAnalysis['primaryError'] {
  // Error info from resultData.error
  const errorNode = error?.node as Record<string, unknown> | undefined;
  const nodeName = (errorNode?.name as string) || lastNode || 'Unknown';

  // Also check runData for node-level errors
  const nodeRunData = runData[nodeName];
  const nodeError = getRunError(nodeRunData);

  const stackTrace = (error?.stack || nodeError?.stack) as string | undefined;

  return {
    message: (error?.message || nodeError?.message || 'Unknown error') as string,
    errorType: (error?.name || nodeError?.name || 'Error') as string,
    nodeName,
    nodeType: (errorNode?.type || '') as string,
    nodeId: errorNode?.id as string | undefined,
    nodeParameters: extractRelevantParameters(errorNode?.parameters),
    stackTrace: includeFullStackTrace ? stackTrace : truncateStackTrace(stackTrace)
  };
}

/**
 * Extract upstream context (input data to error node)
 */
function extractUpstreamContext(
  errorNodeName: string,
  runData: Record<string, any>,
  workflow?: Workflow,
  itemsLimit: number = 2
): ErrorAnalysis['upstreamContext'] | undefined {
  // Strategy 1: Use workflow connections if available
  if (workflow) {
    const upstreamNode = findUpstreamNode(errorNodeName, workflow);
    if (upstreamNode) {
      const context = extractNodeOutput(upstreamNode, runData, itemsLimit);
      if (context) {
        // Enrich with node type from workflow
        const nodeInfo = workflow.nodes.find(n => n.name === upstreamNode);
        if (nodeInfo) {
          context.nodeType = nodeInfo.type;
        }
        return context;
      }
    }
  }

  // Strategy 2: Heuristic - find node that produced data most recently before error
  const successfulNodes = Object.entries(runData)
    .filter(([name, data]) => {
      if (name === errorNodeName) return false;
      const runs = data as any[];
      return countRunItems(runs) > 0 && !getRunError(runs);
    })
    .map(([name, data]) => ({
      name,
      executionTime: totalExecutionTime(data) ?? 0,
      // The most recent run decides recency for a node that ran more than once
      startTime: latestStartTime(data)
    }))
    .sort((a, b) => b.startTime - a.startTime);

  if (successfulNodes.length > 0) {
    const upstreamName = successfulNodes[0].name;
    return extractNodeOutput(upstreamName, runData, itemsLimit);
  }

  return undefined;
}

/**
 * Find upstream node using workflow connections
 * Connections format: { sourceNode: { main: [[{node: targetNode, type, index}]] } }
 */
function findUpstreamNode(
  targetNode: string,
  workflow: Workflow
): string | undefined {
  for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
    const connections = outputs as Record<string, any>;
    const mainOutputs = connections?.main || [];

    for (const outputBranch of mainOutputs) {
      if (!Array.isArray(outputBranch)) continue;
      for (const connection of outputBranch) {
        if (connection?.node === targetNode) {
          return sourceName;
        }
      }
    }
  }
  return undefined;
}

/**
 * Find all upstream nodes (for building complete path)
 */
function findAllUpstreamNodes(
  targetNode: string,
  workflow: Workflow,
  visited: Set<string> = new Set()
): string[] {
  const path: string[] = [];
  let currentNode = targetNode;

  while (currentNode && !visited.has(currentNode)) {
    visited.add(currentNode);
    const upstream = findUpstreamNode(currentNode, workflow);
    if (upstream) {
      path.unshift(upstream);
      currentNode = upstream;
    } else {
      break;
    }
  }

  return path;
}

/**
 * Extract node output with sampling and sanitization
 */
function extractNodeOutput(
  nodeName: string,
  runData: Record<string, any>,
  itemsLimit: number
): ErrorAnalysis['upstreamContext'] | undefined {
  const nodeData = runData[nodeName];
  if (!hasRunOutputData(nodeData)) return undefined;

  // Merge only the samples; the count covers every port and comes from a pass that copies nothing.
  const items = sampleRunItems(nodeData, Math.max(itemsLimit, 1));

  // Sanitize sample items to remove sensitive data
  const rawSamples = items.slice(0, itemsLimit);
  const sanitizedSamples = rawSamples.map((item: unknown) => sanitizeData(item));

  return {
    nodeName,
    nodeType: '', // Will be enriched if workflow available
    itemCount: countRunItems(nodeData),
    sampleItems: sanitizedSamples,
    dataStructure: extractStructure(items[0])
  };
}

/**
 * Build execution path leading to error
 */
function buildExecutionPath(
  errorNodeName: string,
  runData: Record<string, any>,
  workflow?: Workflow
): ErrorAnalysis['executionPath'] {
  const path: ErrorAnalysis['executionPath'] = [];

  // If we have workflow, trace connections backward for ordered path
  if (workflow) {
    const upstreamNodes = findAllUpstreamNodes(errorNodeName, workflow);

    // Add upstream nodes
    for (const nodeName of upstreamNodes) {
      const nodeData = runData[nodeName];
      const runs = nodeData as any[] | undefined;
      const hasError = getRunError(runs);
      const itemCount = countRunItems(runs);

      path.push({
        nodeName,
        status: hasError ? 'error' : (runs ? 'success' : 'skipped'),
        itemCount,
        executionTime: totalExecutionTime(runs)
      });
    }

    // Add error node
    const errorNodeData = runData[errorNodeName];
    path.push({
      nodeName: errorNodeName,
      status: 'error',
      itemCount: 0,
      executionTime: totalExecutionTime(errorNodeData)
    });
  } else {
    // Without workflow, list all executed nodes by execution order (best effort)
    const nodesByTime = Object.entries(runData)
      .map(([name, data]) => ({
        name,
        data: data as any[],
        startTime: latestStartTime(data)
      }))
      .sort((a, b) => a.startTime - b.startTime);

    for (const { name, data } of nodesByTime) {
      path.push({
        nodeName: name,
        status: getRunError(data) ? 'error' : 'success',
        itemCount: countRunItems(data),
        executionTime: totalExecutionTime(data)
      });
    }
  }

  return path;
}

/**
 * Find additional error nodes (for batch/parallel failures)
 */
function findAdditionalErrors(
  primaryErrorNode: string,
  runData: Record<string, any>
): Array<{ nodeName: string; message: string }> {
  const additional: Array<{ nodeName: string; message: string }> = [];

  for (const [nodeName, data] of Object.entries(runData)) {
    if (nodeName === primaryErrorNode) continue;

    const runs = data as any[];
    const error = getRunError(runs);
    if (error) {
      additional.push({
        nodeName,
        message: error.message || 'Unknown error'
      });
    }
  }

  return additional;
}

/**
 * Generate AI-friendly error suggestions based on patterns
 */
function generateSuggestions(
  error: ErrorAnalysis['primaryError'],
  upstream?: ErrorAnalysis['upstreamContext']
): ErrorSuggestion[] {
  const suggestions: ErrorSuggestion[] = [];
  const message = error.message.toLowerCase();

  // Pattern: Missing required field
  if (message.includes('required') || message.includes('must be provided') || message.includes('is required')) {
    suggestions.push({
      type: 'fix',
      title: 'Missing Required Field',
      description: `Check "${error.nodeName}" parameters for required fields. Error indicates a mandatory value is missing.`,
      confidence: 'high'
    });
  }

  // Pattern: Empty input
  if (upstream?.itemCount === 0) {
    suggestions.push({
      type: 'investigate',
      title: 'No Input Data',
      description: `"${error.nodeName}" received 0 items from "${upstream.nodeName}". Check upstream node's filtering or data source.`,
      confidence: 'high'
    });
  }

  // Pattern: Authentication error
  if (message.includes('auth') || message.includes('credentials') ||
      message.includes('401') || message.includes('unauthorized') ||
      message.includes('forbidden') || message.includes('403')) {
    suggestions.push({
      type: 'fix',
      title: 'Authentication Issue',
      description: 'Verify credentials are configured correctly. Check API key permissions and expiration.',
      confidence: 'high'
    });
  }

  // Pattern: Rate limiting
  if (message.includes('rate limit') || message.includes('429') ||
      message.includes('too many requests') || message.includes('throttle')) {
    suggestions.push({
      type: 'workaround',
      title: 'Rate Limited',
      description: 'Add delay between requests or reduce batch size. Consider using retry with exponential backoff.',
      confidence: 'high'
    });
  }

  // Pattern: Connection error
  if (message.includes('econnrefused') || message.includes('enotfound') ||
      message.includes('etimedout') || message.includes('network') ||
      message.includes('connect')) {
    suggestions.push({
      type: 'investigate',
      title: 'Network/Connection Error',
      description: 'Check if the external service is reachable. Verify URL, firewall rules, and DNS resolution.',
      confidence: 'high'
    });
  }

  // Pattern: Invalid JSON
  if (message.includes('json') || message.includes('parse error') ||
      message.includes('unexpected token') || message.includes('syntax error')) {
    suggestions.push({
      type: 'fix',
      title: 'Invalid JSON Format',
      description: 'Check the data format. Ensure JSON is properly structured with correct syntax.',
      confidence: 'high'
    });
  }

  // Pattern: Field not found / invalid path
  if (message.includes('not found') || message.includes('undefined') ||
      message.includes('cannot read property') || message.includes('does not exist')) {
    suggestions.push({
      type: 'investigate',
      title: 'Missing Data Field',
      description: 'A referenced field does not exist in the input data. Check data structure and field names.',
      confidence: 'medium'
    });
  }

  // Pattern: Type error
  if (message.includes('type') && (message.includes('expected') || message.includes('invalid'))) {
    suggestions.push({
      type: 'fix',
      title: 'Data Type Mismatch',
      description: 'Input data type does not match expected type. Check if strings/numbers/arrays are used correctly.',
      confidence: 'medium'
    });
  }

  // Pattern: Timeout
  if (message.includes('timeout') || message.includes('timed out')) {
    suggestions.push({
      type: 'workaround',
      title: 'Operation Timeout',
      description: 'The operation took too long. Consider increasing timeout, reducing data size, or optimizing the query.',
      confidence: 'high'
    });
  }

  // Pattern: Permission denied
  if (message.includes('permission') || message.includes('access denied') || message.includes('not allowed')) {
    suggestions.push({
      type: 'fix',
      title: 'Permission Denied',
      description: 'The operation lacks required permissions. Check user roles, API scopes, or resource access settings.',
      confidence: 'high'
    });
  }

  // Generic NodeOperationError guidance
  if (error.errorType === 'NodeOperationError' && suggestions.length === 0) {
    suggestions.push({
      type: 'investigate',
      title: 'Node Configuration Issue',
      description: `Review "${error.nodeName}" parameters and operation settings. Validate against the node's requirements.`,
      confidence: 'medium'
    });
  }

  return suggestions;
}

// Helper functions

/**
 * Check if a key contains sensitive patterns
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_PATTERNS.some(pattern => lowerKey.includes(pattern));
}

/**
 * Recursively sanitize data by removing dangerous keys and masking sensitive values
 *
 * @param data - The data to sanitize
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum recursion depth (default: 10)
 * @returns Sanitized data with sensitive values masked
 */
function sanitizeData(data: unknown, depth = 0, maxDepth = 10): unknown {
  // Prevent infinite recursion
  if (depth >= maxDepth) {
    return '[max depth reached]';
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle primitives
  if (typeof data !== 'object') {
    // Truncate long strings
    if (typeof data === 'string' && data.length > 500) {
      return '[truncated]';
    }
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item, depth + 1, maxDepth));
  }

  // Handle objects
  const sanitized: Record<string, unknown> = {};
  const obj = data as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    // Block prototype pollution attempts
    if (DANGEROUS_KEYS.has(key)) {
      logger.warn(`Blocked potentially dangerous key: ${key}`);
      continue;
    }

    // Mask sensitive fields
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Recursively sanitize nested values
    sanitized[key] = sanitizeData(value, depth + 1, maxDepth);
  }

  return sanitized;
}

/**
 * Extract relevant parameters (filtering sensitive data)
 */
function extractRelevantParameters(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== 'object') return undefined;

  const sanitized = sanitizeData(params);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return undefined;
  }

  return Object.keys(sanitized).length > 0 ? sanitized as Record<string, unknown> : undefined;
}

/**
 * Truncate stack trace to first few lines
 */
function truncateStackTrace(stack?: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  if (lines.length <= MAX_STACK_LINES) return stack;
  return lines.slice(0, MAX_STACK_LINES).join('\n') + `\n... (${lines.length - MAX_STACK_LINES} more lines)`;
}

/**
 * Extract data structure from an item
 */
function extractStructure(item: unknown, depth = 0, maxDepth = 3): Record<string, unknown> {
  if (depth >= maxDepth) return { _type: typeof item };

  if (item === null || item === undefined) {
    return { _type: 'null' };
  }

  if (Array.isArray(item)) {
    if (item.length === 0) return { _type: 'array', _length: 0 };
    return {
      _type: 'array',
      _length: item.length,
      _itemStructure: extractStructure(item[0], depth + 1, maxDepth)
    };
  }

  if (typeof item === 'object') {
    const structure: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      structure[key] = extractStructure(value, depth + 1, maxDepth);
    }
    return structure;
  }

  return { _type: typeof item };
}
