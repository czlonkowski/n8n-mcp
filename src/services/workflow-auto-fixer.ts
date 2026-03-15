/**
 * Workflow Auto-Fixer Service
 *
 * Automatically generates fix operations for common workflow validation errors.
 * Converts validation results into diff operations that can be applied to fix the workflow.
 */

import crypto from 'crypto';
import { WorkflowValidationResult, VALID_CONNECTION_TYPES } from './workflow-validator';
import { ExpressionFormatIssue } from './expression-format-validator';
import { NodeSimilarityService } from './node-similarity-service';
import { NodeRepository } from '../database/node-repository';
import {
  WorkflowDiffOperation,
  UpdateNodeOperation,
  ReplaceConnectionsOperation
} from '../types/workflow-diff';
import { WorkflowNode, Workflow } from '../types/n8n-api';
import { Logger } from '../utils/logger';
import { NodeVersionService } from './node-version-service';
import { BreakingChangeDetector } from './breaking-change-detector';
import { NodeMigrationService } from './node-migration-service';
import { PostUpdateValidator, PostUpdateGuidance } from './post-update-validator';

const logger = new Logger({ prefix: '[WorkflowAutoFixer]' });

export type FixConfidenceLevel = 'high' | 'medium' | 'low';
export type FixType =
  | 'expression-format'
  | 'typeversion-correction'
  | 'error-output-config'
  | 'node-type-correction'
  | 'webhook-missing-path'
  | 'typeversion-upgrade'           // Proactive version upgrades
  | 'version-migration'             // Smart version migrations with breaking changes
  | 'tool-variant-correction'       // Fix base nodes used as AI tools when Tool variant exists
  | 'connection-numeric-keys'       // "0","1" keys → main[0], main[1]
  | 'connection-invalid-type'       // type:"0" → type:"main"
  | 'connection-id-to-name'         // node ID refs → node name refs
  | 'connection-duplicate-removal'  // Dedup identical connection entries
  | 'connection-input-index';       // Out-of-bounds input index → clamped

export const CONNECTION_FIX_TYPES: FixType[] = [
  'connection-numeric-keys',
  'connection-invalid-type',
  'connection-id-to-name',
  'connection-duplicate-removal',
  'connection-input-index'
];

export interface AutoFixConfig {
  applyFixes: boolean;
  fixTypes?: FixType[];
  confidenceThreshold?: FixConfidenceLevel;
  maxFixes?: number;
}

export interface FixOperation {
  node: string;
  field: string;
  type: FixType;
  before: any;
  after: any;
  confidence: FixConfidenceLevel;
  description: string;
}

export interface AutoFixResult {
  operations: WorkflowDiffOperation[];
  fixes: FixOperation[];
  summary: string;
  stats: {
    total: number;
    byType: Record<FixType, number>;
    byConfidence: Record<FixConfidenceLevel, number>;
  };
  postUpdateGuidance?: PostUpdateGuidance[]; // NEW: AI-friendly migration guidance
}

export interface NodeFormatIssue extends ExpressionFormatIssue {
  nodeName: string;
  nodeId: string;
}

/**
 * Type guard to check if an issue has node information
 */
export function isNodeFormatIssue(issue: ExpressionFormatIssue): issue is NodeFormatIssue {
  return 'nodeName' in issue && 'nodeId' in issue &&
         typeof (issue as any).nodeName === 'string' &&
         typeof (issue as any).nodeId === 'string';
}

/**
 * Error with suggestions for node type issues
 */
export interface NodeTypeError {
  type: 'error';
  nodeId?: string;
  nodeName?: string;
  message: string;
  suggestions?: Array<{
    nodeType: string;
    confidence: number;
    reason: string;
  }>;
}

export class WorkflowAutoFixer {
  private readonly defaultConfig: AutoFixConfig = {
    applyFixes: false,
    confidenceThreshold: 'medium',
    maxFixes: 50
  };
  private similarityService: NodeSimilarityService | null = null;
  private versionService: NodeVersionService | null = null;
  private breakingChangeDetector: BreakingChangeDetector | null = null;
  private migrationService: NodeMigrationService | null = null;
  private postUpdateValidator: PostUpdateValidator | null = null;

  constructor(repository?: NodeRepository) {
    if (repository) {
      this.similarityService = new NodeSimilarityService(repository);
      this.breakingChangeDetector = new BreakingChangeDetector(repository);
      this.versionService = new NodeVersionService(repository, this.breakingChangeDetector);
      this.migrationService = new NodeMigrationService(this.versionService, this.breakingChangeDetector);
      this.postUpdateValidator = new PostUpdateValidator(this.versionService, this.breakingChangeDetector);
    }
  }

  /**
   * Generate fix operations from validation results
   */
  async generateFixes(
    workflow: Workflow,
    validationResult: WorkflowValidationResult,
    formatIssues: ExpressionFormatIssue[] = [],
    config: Partial<AutoFixConfig> = {}
  ): Promise<AutoFixResult> {
    const fullConfig = { ...this.defaultConfig, ...config };
    const operations: WorkflowDiffOperation[] = [];
    const fixes: FixOperation[] = [];
    const postUpdateGuidance: PostUpdateGuidance[] = [];

    // Create a map for quick node lookup
    const nodeMap = new Map<string, WorkflowNode>();
    workflow.nodes.forEach(node => {
      nodeMap.set(node.name, node);
      nodeMap.set(node.id, node);
    });

    // Process expression format issues (HIGH confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('expression-format')) {
      this.processExpressionFormatFixes(formatIssues, nodeMap, operations, fixes);
    }

    // Process typeVersion errors (MEDIUM confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('typeversion-correction')) {
      this.processTypeVersionFixes(validationResult, nodeMap, operations, fixes);
    }

    // Process error output configuration issues (MEDIUM confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('error-output-config')) {
      this.processErrorOutputFixes(validationResult, nodeMap, workflow, operations, fixes);
    }

    // Process node type corrections (HIGH confidence only)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('node-type-correction')) {
      this.processNodeTypeFixes(validationResult, nodeMap, operations, fixes);
    }

    // Process webhook path fixes (HIGH confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('webhook-missing-path')) {
      this.processWebhookPathFixes(validationResult, nodeMap, operations, fixes);
    }

    // Process tool variant corrections (HIGH confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('tool-variant-correction')) {
      this.processToolVariantFixes(validationResult, nodeMap, workflow, operations, fixes);
    }

    // Process version upgrades (HIGH/MEDIUM confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('typeversion-upgrade')) {
      await this.processVersionUpgradeFixes(workflow, nodeMap, operations, fixes, postUpdateGuidance);
    }

    // NEW: Process version migrations with breaking changes (MEDIUM/LOW confidence)
    if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('version-migration')) {
      await this.processVersionMigrationFixes(workflow, nodeMap, operations, fixes, postUpdateGuidance);
    }

    // Process connection structure fixes (HIGH/MEDIUM confidence)
    this.processConnectionFixes(workflow, validationResult, fullConfig, operations, fixes);

    // Filter by confidence threshold
    const filteredFixes = this.filterByConfidence(fixes, fullConfig.confidenceThreshold);
    const filteredOperations = this.filterOperationsByFixes(operations, filteredFixes, fixes);

    // Apply max fixes limit
    const limitedFixes = filteredFixes.slice(0, fullConfig.maxFixes);
    const limitedOperations = this.filterOperationsByFixes(filteredOperations, limitedFixes, filteredFixes);

    // Generate summary
    const stats = this.calculateStats(limitedFixes);
    const summary = this.generateSummary(stats);

    return {
      operations: limitedOperations,
      fixes: limitedFixes,
      summary,
      stats,
      postUpdateGuidance: postUpdateGuidance.length > 0 ? postUpdateGuidance : undefined
    };
  }

  /**
   * Process expression format fixes (missing = prefix)
   */
  private processExpressionFormatFixes(
    formatIssues: ExpressionFormatIssue[],
    nodeMap: Map<string, WorkflowNode>,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    // Group fixes by node to create single update operation per node
    const fixesByNode = new Map<string, ExpressionFormatIssue[]>();

    for (const issue of formatIssues) {
      // Process both errors and warnings for missing-prefix issues
      if (issue.issueType === 'missing-prefix') {
        // Use type guard to ensure we have node information
        if (!isNodeFormatIssue(issue)) {
          logger.warn('Expression format issue missing node information', {
            fieldPath: issue.fieldPath,
            issueType: issue.issueType
          });
          continue;
        }

        const nodeName = issue.nodeName;

        if (!fixesByNode.has(nodeName)) {
          fixesByNode.set(nodeName, []);
        }
        fixesByNode.get(nodeName)!.push(issue);
      }
    }

    // Create update operations for each node
    for (const [nodeName, nodeIssues] of fixesByNode) {
      const node = nodeMap.get(nodeName);
      if (!node) continue;

      const updatedParameters = JSON.parse(JSON.stringify(node.parameters || {}));

      for (const issue of nodeIssues) {
        // Apply the fix to parameters
        // The fieldPath doesn't include node name, use as is
        const fieldPath = issue.fieldPath.split('.');
        this.setNestedValue(updatedParameters, fieldPath, issue.correctedValue);

        fixes.push({
          node: nodeName,
          field: issue.fieldPath,
          type: 'expression-format',
          before: issue.currentValue,
          after: issue.correctedValue,
          confidence: 'high',
          description: issue.explanation
        });
      }

      // Create update operation
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: nodeName, // Can be name or ID
        updates: {
          parameters: updatedParameters
        }
      };
      operations.push(operation);
    }
  }

  /**
   * Process typeVersion fixes
   */
  private processTypeVersionFixes(
    validationResult: WorkflowValidationResult,
    nodeMap: Map<string, WorkflowNode>,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    for (const error of validationResult.errors) {
      if (error.message.includes('typeVersion') && error.message.includes('exceeds maximum')) {
        // Extract version info from error message
        const versionMatch = error.message.match(/typeVersion (\d+(?:\.\d+)?) exceeds maximum supported version (\d+(?:\.\d+)?)/);
        if (versionMatch) {
          const currentVersion = parseFloat(versionMatch[1]);
          const maxVersion = parseFloat(versionMatch[2]);
          const nodeName = error.nodeName || error.nodeId;

          if (!nodeName) continue;

          const node = nodeMap.get(nodeName);
          if (!node) continue;

          fixes.push({
            node: nodeName,
            field: 'typeVersion',
            type: 'typeversion-correction',
            before: currentVersion,
            after: maxVersion,
            confidence: 'medium',
            description: `Corrected typeVersion from ${currentVersion} to maximum supported ${maxVersion}`
          });

          const operation: UpdateNodeOperation = {
            type: 'updateNode',
            nodeId: nodeName,
            updates: {
              typeVersion: maxVersion
            }
          };
          operations.push(operation);
        }
      }
    }
  }

  /**
   * Process error output configuration fixes
   */
  private processErrorOutputFixes(
    validationResult: WorkflowValidationResult,
    nodeMap: Map<string, WorkflowNode>,
    workflow: Workflow,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    for (const error of validationResult.errors) {
      if (error.message.includes('onError: \'continueErrorOutput\'') &&
          error.message.includes('no error output connections')) {
        const nodeName = error.nodeName || error.nodeId;
        if (!nodeName) continue;

        const node = nodeMap.get(nodeName);
        if (!node) continue;

        // Remove the conflicting onError setting
        fixes.push({
          node: nodeName,
          field: 'onError',
          type: 'error-output-config',
          before: 'continueErrorOutput',
          after: undefined,
          confidence: 'medium',
          description: 'Removed onError setting due to missing error output connections'
        });

        const operation: UpdateNodeOperation = {
          type: 'updateNode',
          nodeId: nodeName,
          updates: {
            onError: undefined // This will remove the property
          }
        };
        operations.push(operation);
      }
    }
  }

  /**
   * Process node type corrections for unknown nodes
   */
  private processNodeTypeFixes(
    validationResult: WorkflowValidationResult,
    nodeMap: Map<string, WorkflowNode>,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    // Only process if we have the similarity service
    if (!this.similarityService) {
      return;
    }

    for (const error of validationResult.errors) {
      // Type-safe check for unknown node type errors with suggestions
      const nodeError = error as NodeTypeError;

      if (error.message?.includes('Unknown node type:') && nodeError.suggestions) {
        // Only auto-fix if we have a high-confidence suggestion (>= 0.9)
        const highConfidenceSuggestion = nodeError.suggestions.find(s => s.confidence >= 0.9);

        if (highConfidenceSuggestion && nodeError.nodeId) {
          const node = nodeMap.get(nodeError.nodeId) || nodeMap.get(nodeError.nodeName || '');

          if (node) {
            fixes.push({
              node: node.name,
              field: 'type',
              type: 'node-type-correction',
              before: node.type,
              after: highConfidenceSuggestion.nodeType,
              confidence: 'high',
              description: `Fix node type: "${node.type}" → "${highConfidenceSuggestion.nodeType}" (${highConfidenceSuggestion.reason})`
            });

            const operation: UpdateNodeOperation = {
              type: 'updateNode',
              nodeId: node.name,
              updates: {
                type: highConfidenceSuggestion.nodeType
              }
            };
            operations.push(operation);
          }
        }
      }
    }
  }

  /**
   * Process webhook path fixes for webhook nodes missing path parameter
   */
  private processWebhookPathFixes(
    validationResult: WorkflowValidationResult,
    nodeMap: Map<string, WorkflowNode>,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    for (const error of validationResult.errors) {
      // Check for webhook path required error
      if (error.message === 'Webhook path is required') {
        const nodeName = error.nodeName || error.nodeId;
        if (!nodeName) continue;

        const node = nodeMap.get(nodeName);
        if (!node) continue;

        // Only fix webhook nodes
        if (!node.type?.includes('webhook')) continue;

        // Generate a unique UUID for both path and webhookId
        const webhookId = crypto.randomUUID();

        // Check if we need to update typeVersion
        const currentTypeVersion = node.typeVersion || 1;
        const needsVersionUpdate = currentTypeVersion < 2.1;

        fixes.push({
          node: nodeName,
          field: 'path',
          type: 'webhook-missing-path',
          before: undefined,
          after: webhookId,
          confidence: 'high',
          description: needsVersionUpdate
            ? `Generated webhook path and ID: ${webhookId} (also updating typeVersion to 2.1)`
            : `Generated webhook path and ID: ${webhookId}`
        });

        // Create update operation with both path and webhookId
        // The updates object uses dot notation for nested properties
        const updates: Record<string, any> = {
          'parameters.path': webhookId,
          'webhookId': webhookId
        };

        // Only update typeVersion if it's older than 2.1
        if (needsVersionUpdate) {
          updates['typeVersion'] = 2.1;
        }

        const operation: UpdateNodeOperation = {
          type: 'updateNode',
          nodeId: nodeName,
          updates
        };
        operations.push(operation);
      }
    }
  }

  /**
   * Process tool variant corrections for base nodes incorrectly used as AI tools.
   *
   * When a base node (e.g., n8n-nodes-base.supabase) is connected via ai_tool output
   * but has a Tool variant available (e.g., n8n-nodes-base.supabaseTool), this fix
   * replaces the node type with the correct Tool variant.
   *
   * @param validationResult - Validation result containing errors to process
   * @param nodeMap - Map of node names/IDs to node objects
   * @param _workflow - Workflow object (unused, kept for API consistency with other fix methods)
   * @param operations - Array to push generated diff operations to
   * @param fixes - Array to push generated fix records to
   */
  private processToolVariantFixes(
    validationResult: WorkflowValidationResult,
    nodeMap: Map<string, WorkflowNode>,
    _workflow: Workflow,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    for (const error of validationResult.errors) {
      // Check for errors with the WRONG_NODE_TYPE_FOR_AI_TOOL code
      // ValidationIssue interface includes optional code and fix properties
      if (error.code !== 'WRONG_NODE_TYPE_FOR_AI_TOOL' || !error.fix) {
        continue;
      }

      const fix = error.fix;
      if (fix.type !== 'tool-variant-correction') {
        continue;
      }

      const nodeName = error.nodeName || error.nodeId;
      if (!nodeName) continue;

      const node = nodeMap.get(nodeName);
      if (!node) continue;

      // Create the fix record
      fixes.push({
        node: nodeName,
        field: 'type',
        type: 'tool-variant-correction',
        before: fix.currentType,
        after: fix.suggestedType,
        confidence: 'high', // This is a direct match - we know exactly which type to use
        description: fix.description || `Replace "${fix.currentType}" with Tool variant "${fix.suggestedType}"`
      });

      // Create the update operation
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: nodeName,
        updates: {
          type: fix.suggestedType
        }
      };
      operations.push(operation);

      logger.info(`Generated tool variant correction for ${nodeName}: ${fix.currentType} → ${fix.suggestedType}`);
    }
  }

  /**
   * Set a nested value in an object using a path array
   * Includes validation to prevent silent failures
   */
  private setNestedValue(obj: any, path: string[], value: any): void {
    if (!obj || typeof obj !== 'object') {
      throw new Error('Cannot set value on non-object');
    }

    if (path.length === 0) {
      throw new Error('Cannot set value with empty path');
    }

    try {
      let current = obj;

      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];

        // Handle array indices
        if (key.includes('[')) {
          const matches = key.match(/^([^[]+)\[(\d+)\]$/);
          if (!matches) {
            throw new Error(`Invalid array notation: ${key}`);
          }

          const [, arrayKey, indexStr] = matches;
          const index = parseInt(indexStr, 10);

          if (isNaN(index) || index < 0) {
            throw new Error(`Invalid array index: ${indexStr}`);
          }

          if (!current[arrayKey]) {
            current[arrayKey] = [];
          }

          if (!Array.isArray(current[arrayKey])) {
            throw new Error(`Expected array at ${arrayKey}, got ${typeof current[arrayKey]}`);
          }

          while (current[arrayKey].length <= index) {
            current[arrayKey].push({});
          }

          current = current[arrayKey][index];
        } else {
          if (current[key] === null || current[key] === undefined) {
            current[key] = {};
          }

          if (typeof current[key] !== 'object' || Array.isArray(current[key])) {
            throw new Error(`Cannot traverse through ${typeof current[key]} at ${key}`);
          }

          current = current[key];
        }
      }

      // Set the final value
      const lastKey = path[path.length - 1];

      if (lastKey.includes('[')) {
        const matches = lastKey.match(/^([^[]+)\[(\d+)\]$/);
        if (!matches) {
          throw new Error(`Invalid array notation: ${lastKey}`);
        }

        const [, arrayKey, indexStr] = matches;
        const index = parseInt(indexStr, 10);

        if (isNaN(index) || index < 0) {
          throw new Error(`Invalid array index: ${indexStr}`);
        }

        if (!current[arrayKey]) {
          current[arrayKey] = [];
        }

        if (!Array.isArray(current[arrayKey])) {
          throw new Error(`Expected array at ${arrayKey}, got ${typeof current[arrayKey]}`);
        }

        while (current[arrayKey].length <= index) {
          current[arrayKey].push(null);
        }

        current[arrayKey][index] = value;
      } else {
        current[lastKey] = value;
      }
    } catch (error) {
      logger.error('Failed to set nested value', {
        path: path.join('.'),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Filter fixes by confidence level
   */
  private filterByConfidence(
    fixes: FixOperation[],
    threshold?: FixConfidenceLevel
  ): FixOperation[] {
    if (!threshold) return fixes;

    const levels: FixConfidenceLevel[] = ['high', 'medium', 'low'];
    const thresholdIndex = levels.indexOf(threshold);

    return fixes.filter(fix => {
      const fixIndex = levels.indexOf(fix.confidence);
      return fixIndex <= thresholdIndex;
    });
  }

  /**
   * Filter operations to match filtered fixes
   */
  private filterOperationsByFixes(
    operations: WorkflowDiffOperation[],
    filteredFixes: FixOperation[],
    allFixes: FixOperation[]
  ): WorkflowDiffOperation[] {
    // fixedNodes contains node names (FixOperation.node = node.name)
    const fixedNodes = new Set(filteredFixes.map(f => f.node));
    const hasConnectionFixes = filteredFixes.some(f => CONNECTION_FIX_TYPES.includes(f.type));
    return operations.filter(op => {
      if (op.type === 'updateNode') {
        // Check both nodeName and nodeId — operations may use either
        return fixedNodes.has(op.nodeName || '') || fixedNodes.has(op.nodeId || '');
      }
      if (op.type === 'replaceConnections') {
        return hasConnectionFixes;
      }
      return true;
    });
  }

  /**
   * Calculate statistics about fixes
   */
  private calculateStats(fixes: FixOperation[]): AutoFixResult['stats'] {
    const stats: AutoFixResult['stats'] = {
      total: fixes.length,
      byType: {
        'expression-format': 0,
        'typeversion-correction': 0,
        'error-output-config': 0,
        'node-type-correction': 0,
        'webhook-missing-path': 0,
        'typeversion-upgrade': 0,
        'version-migration': 0,
        'tool-variant-correction': 0,
        'connection-numeric-keys': 0,
        'connection-invalid-type': 0,
        'connection-id-to-name': 0,
        'connection-duplicate-removal': 0,
        'connection-input-index': 0
      },
      byConfidence: {
        'high': 0,
        'medium': 0,
        'low': 0
      }
    };

    for (const fix of fixes) {
      stats.byType[fix.type]++;
      stats.byConfidence[fix.confidence]++;
    }

    return stats;
  }

  /**
   * Generate a human-readable summary
   */
  private generateSummary(stats: AutoFixResult['stats']): string {
    if (stats.total === 0) {
      return 'No fixes available';
    }

    const parts: string[] = [];

    if (stats.byType['expression-format'] > 0) {
      parts.push(`${stats.byType['expression-format']} expression format ${stats.byType['expression-format'] === 1 ? 'error' : 'errors'}`);
    }
    if (stats.byType['typeversion-correction'] > 0) {
      parts.push(`${stats.byType['typeversion-correction']} version ${stats.byType['typeversion-correction'] === 1 ? 'issue' : 'issues'}`);
    }
    if (stats.byType['error-output-config'] > 0) {
      parts.push(`${stats.byType['error-output-config']} error output ${stats.byType['error-output-config'] === 1 ? 'configuration' : 'configurations'}`);
    }
    if (stats.byType['node-type-correction'] > 0) {
      parts.push(`${stats.byType['node-type-correction']} node type ${stats.byType['node-type-correction'] === 1 ? 'correction' : 'corrections'}`);
    }
    if (stats.byType['webhook-missing-path'] > 0) {
      parts.push(`${stats.byType['webhook-missing-path']} webhook ${stats.byType['webhook-missing-path'] === 1 ? 'path' : 'paths'}`);
    }

    if (stats.byType['typeversion-upgrade'] > 0) {
      parts.push(`${stats.byType['typeversion-upgrade']} version ${stats.byType['typeversion-upgrade'] === 1 ? 'upgrade' : 'upgrades'}`);
    }
    if (stats.byType['version-migration'] > 0) {
      parts.push(`${stats.byType['version-migration']} version ${stats.byType['version-migration'] === 1 ? 'migration' : 'migrations'}`);
    }
    if (stats.byType['tool-variant-correction'] > 0) {
      parts.push(`${stats.byType['tool-variant-correction']} tool variant ${stats.byType['tool-variant-correction'] === 1 ? 'correction' : 'corrections'}`);
    }

    const connectionIssueCount =
      (stats.byType['connection-numeric-keys'] || 0) +
      (stats.byType['connection-invalid-type'] || 0) +
      (stats.byType['connection-id-to-name'] || 0) +
      (stats.byType['connection-duplicate-removal'] || 0) +
      (stats.byType['connection-input-index'] || 0);
    if (connectionIssueCount > 0) {
      parts.push(`${connectionIssueCount} connection ${connectionIssueCount === 1 ? 'issue' : 'issues'}`);
    }

    if (parts.length === 0) {
      return `Fixed ${stats.total} ${stats.total === 1 ? 'issue' : 'issues'}`;
    }

    return `Fixed ${parts.join(', ')}`;
  }

  /**
   * Process connection structure fixes.
   * Deep-clones workflow.connections, applies fixes in order:
   * numeric keys → ID-to-name → invalid type → input index → dedup
   * Emits a single ReplaceConnectionsOperation if any corrections were made.
   */
  private processConnectionFixes(
    workflow: Workflow,
    validationResult: WorkflowValidationResult,
    config: AutoFixConfig,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[]
  ): void {
    if (!workflow.connections || Object.keys(workflow.connections).length === 0) {
      return;
    }

    // Build lookup maps
    const idToNameMap = new Map<string, string>();
    const nameSet = new Set<string>();
    for (const node of workflow.nodes) {
      idToNameMap.set(node.id, node.name);
      nameSet.add(node.name);
    }

    // Deep-clone connections
    const conn: any = JSON.parse(JSON.stringify(workflow.connections));
    let anyFixed = false;

    // 1. Fix numeric source keys ("0" → main[0])
    if (!config.fixTypes || config.fixTypes.includes('connection-numeric-keys')) {
      const numericKeyResult = this.fixNumericKeys(conn);
      if (numericKeyResult.length > 0) {
        fixes.push(...numericKeyResult);
        anyFixed = true;
      }
    }

    // 2. Fix ID-to-name references (source keys and .node values)
    if (!config.fixTypes || config.fixTypes.includes('connection-id-to-name')) {
      const idToNameResult = this.fixIdToName(conn, idToNameMap, nameSet);
      if (idToNameResult.length > 0) {
        fixes.push(...idToNameResult);
        anyFixed = true;
      }
    }

    // 3. Fix invalid connection types
    if (!config.fixTypes || config.fixTypes.includes('connection-invalid-type')) {
      const invalidTypeResult = this.fixInvalidTypes(conn);
      if (invalidTypeResult.length > 0) {
        fixes.push(...invalidTypeResult);
        anyFixed = true;
      }
    }

    // 4. Fix out-of-bounds input indices
    if (!config.fixTypes || config.fixTypes.includes('connection-input-index')) {
      const inputIndexResult = this.fixInputIndices(conn, validationResult, workflow);
      if (inputIndexResult.length > 0) {
        fixes.push(...inputIndexResult);
        anyFixed = true;
      }
    }

    // 5. Dedup identical connection entries
    if (!config.fixTypes || config.fixTypes.includes('connection-duplicate-removal')) {
      const dedupResult = this.fixDuplicateConnections(conn);
      if (dedupResult.length > 0) {
        fixes.push(...dedupResult);
        anyFixed = true;
      }
    }

    if (anyFixed) {
      const op: ReplaceConnectionsOperation = {
        type: 'replaceConnections',
        connections: conn
      };
      operations.push(op);
    }
  }

  /**
   * Fix numeric connection output keys ("0", "1" → main[0], main[1])
   */
  private fixNumericKeys(conn: any): FixOperation[] {
    const fixes: FixOperation[] = [];
    const sourceNodes = Object.keys(conn);

    for (const sourceName of sourceNodes) {
      const nodeConn = conn[sourceName];
      const numericKeys = Object.keys(nodeConn).filter(k => /^\d+$/.test(k));

      if (numericKeys.length === 0) continue;

      // Ensure main array exists
      if (!nodeConn['main']) {
        nodeConn['main'] = [];
      }

      for (const numKey of numericKeys) {
        const index = parseInt(numKey, 10);
        const entries = nodeConn[numKey];

        // Extend main array if needed (fill gaps with empty arrays)
        while (nodeConn['main'].length <= index) {
          nodeConn['main'].push([]);
        }

        // Merge entries into main[index]
        const hadExisting = nodeConn['main'][index] && nodeConn['main'][index].length > 0;
        if (Array.isArray(entries)) {
          for (const outputGroup of entries) {
            if (Array.isArray(outputGroup)) {
              nodeConn['main'][index] = [
                ...nodeConn['main'][index],
                ...outputGroup
              ];
            }
          }
        }

        if (hadExisting) {
          logger.warn(`Merged numeric key "${numKey}" into existing main[${index}] on node "${sourceName}" - dedup pass will clean exact duplicates`);
        }

        fixes.push({
          node: sourceName,
          field: `connections.${sourceName}.${numKey}`,
          type: 'connection-numeric-keys',
          before: numKey,
          after: `main[${index}]`,
          confidence: hadExisting ? 'medium' : 'high',
          description: hadExisting
            ? `Merged numeric connection key "${numKey}" into existing main[${index}] on node "${sourceName}"`
            : `Converted numeric connection key "${numKey}" to main[${index}] on node "${sourceName}"`
        });

        delete nodeConn[numKey];
      }
    }

    return fixes;
  }

  /**
   * Fix node ID references in connections (replace IDs with names)
   */
  private fixIdToName(
    conn: any,
    idToNameMap: Map<string, string>,
    nameSet: Set<string>
  ): FixOperation[] {
    const fixes: FixOperation[] = [];

    // Build rename plan for source keys, then check for collisions
    const renames: Array<{ oldKey: string; newKey: string }> = [];
    const sourceKeys = Object.keys(conn);
    for (const sourceKey of sourceKeys) {
      if (idToNameMap.has(sourceKey) && !nameSet.has(sourceKey)) {
        renames.push({ oldKey: sourceKey, newKey: idToNameMap.get(sourceKey)! });
      }
    }

    // Check for collisions among renames (two IDs mapping to the same name)
    const newKeyCount = new Map<string, number>();
    for (const r of renames) {
      newKeyCount.set(r.newKey, (newKeyCount.get(r.newKey) || 0) + 1);
    }
    const safeRenames = renames.filter(r => {
      if ((newKeyCount.get(r.newKey) || 0) > 1) {
        logger.warn(`Skipping ambiguous ID-to-name rename: "${r.oldKey}" → "${r.newKey}" (multiple IDs map to same name)`);
        return false;
      }
      return true;
    });

    for (const { oldKey, newKey } of safeRenames) {
      conn[newKey] = conn[oldKey];
      delete conn[oldKey];
      fixes.push({
        node: newKey,
        field: `connections.sourceKey`,
        type: 'connection-id-to-name',
        before: oldKey,
        after: newKey,
        confidence: 'high',
        description: `Replaced node ID "${oldKey}" with name "${newKey}" as connection source key`
      });
    }

    // Fix .node values that are node IDs
    for (const sourceName of Object.keys(conn)) {
      const nodeConn = conn[sourceName];
      for (const outputKey of Object.keys(nodeConn)) {
        const outputs = nodeConn[outputKey];
        if (!Array.isArray(outputs)) continue;
        for (const outputGroup of outputs) {
          if (!Array.isArray(outputGroup)) continue;
          for (const entry of outputGroup) {
            if (entry && entry.node && idToNameMap.has(entry.node) && !nameSet.has(entry.node)) {
              const oldNode = entry.node;
              const newNode = idToNameMap.get(entry.node)!;
              entry.node = newNode;
              fixes.push({
                node: sourceName,
                field: `connections.${sourceName}.${outputKey}[].node`,
                type: 'connection-id-to-name',
                before: oldNode,
                after: newNode,
                confidence: 'high',
                description: `Replaced target node ID "${oldNode}" with name "${newNode}" in connection from "${sourceName}"`
              });
            }
          }
        }
      }
    }

    return fixes;
  }

  /**
   * Fix invalid connection types in entries (e.g., type:"0" → type:"main")
   */
  private fixInvalidTypes(conn: any): FixOperation[] {
    const fixes: FixOperation[] = [];

    for (const sourceName of Object.keys(conn)) {
      const nodeConn = conn[sourceName];
      for (const outputKey of Object.keys(nodeConn)) {
        const outputs = nodeConn[outputKey];
        if (!Array.isArray(outputs)) continue;
        for (const outputGroup of outputs) {
          if (!Array.isArray(outputGroup)) continue;
          for (const entry of outputGroup) {
            if (entry && entry.type && !VALID_CONNECTION_TYPES.has(entry.type)) {
              const oldType = entry.type;
              // Use the parent output key if it's valid, otherwise default to "main"
              const newType = VALID_CONNECTION_TYPES.has(outputKey) ? outputKey : 'main';
              entry.type = newType;
              fixes.push({
                node: sourceName,
                field: `connections.${sourceName}.${outputKey}[].type`,
                type: 'connection-invalid-type',
                before: oldType,
                after: newType,
                confidence: 'high',
                description: `Fixed invalid connection type "${oldType}" → "${newType}" in connection from "${sourceName}" to "${entry.node}"`
              });
            }
          }
        }
      }
    }

    return fixes;
  }

  /**
   * Fix out-of-bounds input indices (clamp to valid range)
   */
  private fixInputIndices(
    conn: any,
    validationResult: WorkflowValidationResult,
    workflow: Workflow
  ): FixOperation[] {
    const fixes: FixOperation[] = [];

    // Parse INPUT_INDEX_OUT_OF_BOUNDS errors from validation
    for (const error of validationResult.errors) {
      if (error.code !== 'INPUT_INDEX_OUT_OF_BOUNDS') continue;

      const targetNodeName = error.nodeName;
      if (!targetNodeName) continue;

      // Extract the bad index and input count from the error message
      const match = error.message.match(/Input index (\d+).*?has (\d+) main input/);
      if (!match) {
        logger.warn(`Could not parse INPUT_INDEX_OUT_OF_BOUNDS error for node "${targetNodeName}": ${error.message}`);
        continue;
      }

      const badIndex = parseInt(match[1], 10);
      const inputCount = parseInt(match[2], 10);

      // For multi-input nodes, clamp to max valid index; for single-input, reset to 0
      const clampedIndex = inputCount > 1 ? Math.min(badIndex, inputCount - 1) : 0;

      // Find and fix the bad index in connections
      for (const sourceName of Object.keys(conn)) {
        const nodeConn = conn[sourceName];
        for (const outputKey of Object.keys(nodeConn)) {
          const outputs = nodeConn[outputKey];
          if (!Array.isArray(outputs)) continue;
          for (const outputGroup of outputs) {
            if (!Array.isArray(outputGroup)) continue;
            for (const entry of outputGroup) {
              if (entry && entry.node === targetNodeName && entry.index === badIndex) {
                entry.index = clampedIndex;
                fixes.push({
                  node: sourceName,
                  field: `connections.${sourceName}.${outputKey}[].index`,
                  type: 'connection-input-index',
                  before: badIndex,
                  after: clampedIndex,
                  confidence: 'medium',
                  description: `Clamped input index ${badIndex} → ${clampedIndex} for target node "${targetNodeName}" (has ${inputCount} input${inputCount === 1 ? '' : 's'})`
                });
              }
            }
          }
        }
      }
    }

    return fixes;
  }

  /**
   * Remove duplicate connection entries (same node, type, index)
   */
  private fixDuplicateConnections(conn: any): FixOperation[] {
    const fixes: FixOperation[] = [];

    for (const sourceName of Object.keys(conn)) {
      const nodeConn = conn[sourceName];
      for (const outputKey of Object.keys(nodeConn)) {
        const outputs = nodeConn[outputKey];
        if (!Array.isArray(outputs)) continue;
        for (let i = 0; i < outputs.length; i++) {
          const outputGroup = outputs[i];
          if (!Array.isArray(outputGroup)) continue;

          const seen = new Set<string>();
          const deduped: any[] = [];

          for (const entry of outputGroup) {
            const key = JSON.stringify({ node: entry.node, type: entry.type, index: entry.index });
            if (seen.has(key)) {
              fixes.push({
                node: sourceName,
                field: `connections.${sourceName}.${outputKey}[${i}]`,
                type: 'connection-duplicate-removal',
                before: entry,
                after: null,
                confidence: 'high',
                description: `Removed duplicate connection from "${sourceName}" to "${entry.node}" (type: ${entry.type}, index: ${entry.index})`
              });
            } else {
              seen.add(key);
              deduped.push(entry);
            }
          }

          outputs[i] = deduped;
        }
      }
    }

    return fixes;
  }

  /**
   * Process version upgrade fixes (proactive upgrades to latest versions)
   * HIGH confidence for non-breaking upgrades, MEDIUM for upgrades with auto-migratable changes
   */
  private async processVersionUpgradeFixes(
    workflow: Workflow,
    nodeMap: Map<string, WorkflowNode>,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[],
    postUpdateGuidance: PostUpdateGuidance[]
  ): Promise<void> {
    if (!this.versionService || !this.migrationService || !this.postUpdateValidator) {
      logger.warn('Version services not initialized. Skipping version upgrade fixes.');
      return;
    }

    for (const node of workflow.nodes) {
      if (!node.typeVersion || !node.type) continue;

      const currentVersion = node.typeVersion.toString();
      const analysis = this.versionService.analyzeVersion(node.type, currentVersion);

      // Only upgrade if outdated and recommended
      if (!analysis.isOutdated || !analysis.recommendUpgrade) continue;

      // Skip if confidence is too low
      if (analysis.confidence === 'LOW') continue;

      const latestVersion = analysis.latestVersion;

      // Attempt migration
      try {
        const migrationResult = await this.migrationService.migrateNode(
          node,
          currentVersion,
          latestVersion
        );

        // Create fix operation
        fixes.push({
          node: node.name,
          field: 'typeVersion',
          type: 'typeversion-upgrade',
          before: currentVersion,
          after: latestVersion,
          confidence: analysis.hasBreakingChanges ? 'medium' : 'high',
          description: `Upgrade ${node.name} from v${currentVersion} to v${latestVersion}. ${analysis.reason}`
        });

        // Create update operation — both nodeId and nodeName needed for fix filtering
        const operation: UpdateNodeOperation = {
          type: 'updateNode',
          nodeId: node.id,
          nodeName: node.name,
          updates: {
            typeVersion: parseFloat(latestVersion),
            parameters: migrationResult.updatedNode.parameters,
            ...(migrationResult.updatedNode.webhookId && { webhookId: migrationResult.updatedNode.webhookId })
          }
        };
        operations.push(operation);

        // Generate post-update guidance
        const guidance = await this.postUpdateValidator.generateGuidance(
          node.id,
          node.name,
          node.type,
          currentVersion,
          latestVersion,
          migrationResult
        );

        postUpdateGuidance.push(guidance);

        logger.info(`Generated version upgrade fix for ${node.name}: ${currentVersion} → ${latestVersion}`, {
          appliedMigrations: migrationResult.appliedMigrations.length,
          remainingIssues: migrationResult.remainingIssues.length
        });
      } catch (error) {
        logger.error(`Failed to process version upgrade for ${node.name}`, { error });
      }
    }
  }

  /**
   * Process version migration fixes (handle breaking changes with smart migrations)
   * MEDIUM/LOW confidence for migrations requiring manual intervention
   */
  private async processVersionMigrationFixes(
    workflow: Workflow,
    nodeMap: Map<string, WorkflowNode>,
    operations: WorkflowDiffOperation[],
    fixes: FixOperation[],
    postUpdateGuidance: PostUpdateGuidance[]
  ): Promise<void> {
    // This method handles migrations that weren't covered by typeversion-upgrade
    // Focuses on nodes with complex breaking changes that need manual review

    if (!this.versionService || !this.breakingChangeDetector || !this.postUpdateValidator) {
      logger.warn('Version services not initialized. Skipping version migration fixes.');
      return;
    }

    for (const node of workflow.nodes) {
      if (!node.typeVersion || !node.type) continue;

      const currentVersion = node.typeVersion.toString();
      const latestVersion = this.versionService.getLatestVersion(node.type);

      if (!latestVersion || currentVersion === latestVersion) continue;

      // Check if this has breaking changes
      const hasBreaking = this.breakingChangeDetector.hasBreakingChanges(
        node.type,
        currentVersion,
        latestVersion
      );

      if (!hasBreaking) continue; // Already handled by typeversion-upgrade

      // Analyze the migration
      const analysis = await this.breakingChangeDetector.analyzeVersionUpgrade(
        node.type,
        currentVersion,
        latestVersion
      );

      // Only proceed if there are non-auto-migratable changes
      if (analysis.autoMigratableCount === analysis.changes.length) continue;

      // Generate guidance for manual migration
      const guidance = await this.postUpdateValidator.generateGuidance(
        node.id,
        node.name,
        node.type,
        currentVersion,
        latestVersion,
        {
          success: false,
          nodeId: node.id,
          nodeName: node.name,
          fromVersion: currentVersion,
          toVersion: latestVersion,
          appliedMigrations: [],
          remainingIssues: analysis.recommendations,
          confidence: analysis.overallSeverity === 'HIGH' ? 'LOW' : 'MEDIUM',
          updatedNode: node
        }
      );

      // Create a fix entry (won't be auto-applied, just documented)
      fixes.push({
        node: node.name,
        field: 'typeVersion',
        type: 'version-migration',
        before: currentVersion,
        after: latestVersion,
        confidence: guidance.confidence === 'HIGH' ? 'medium' : 'low',
        description: `Version migration required: ${node.name} v${currentVersion} → v${latestVersion}. ${analysis.manualRequiredCount} manual action(s) required.`
      });

      postUpdateGuidance.push(guidance);

      logger.info(`Documented version migration for ${node.name}`, {
        breakingChanges: analysis.changes.filter(c => c.isBreaking).length,
        manualRequired: analysis.manualRequiredCount
      });
    }
  }
}