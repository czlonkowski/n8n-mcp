/**
 * Workflow Validator for n8n workflows
 * Validates complete workflow structure, connections, and node configurations
 */

import crypto from 'crypto';
import { NodeRepository } from '../database/node-repository';
import { EnhancedConfigValidator, type ValidationProfile } from './enhanced-config-validator';
import { ExpressionValidator } from './expression-validator';
import { extractBracketExpressions } from '../utils/expression-utils';
import { ExpressionFormatValidator } from './expression-format-validator';
import { NodeSimilarityService, NodeSuggestion } from './node-similarity-service';
import { NodeTypeNormalizer } from '../utils/node-type-normalizer';
import { parseTypeVersion } from '../utils/typeversion';
import { Logger } from '../utils/logger';
import { validateAISpecificNodes, hasAINodes, AI_CONNECTION_TYPES } from './ai-node-validator';
import { isAIToolSubNode } from './ai-tool-validators';
import { isTriggerNode } from '../utils/node-type-utils';
import { isNonExecutableNode } from '../utils/node-classification';
import { validateConditionNodeStructure } from './n8n-validation';
import { ToolVariantGenerator } from './tool-variant-generator';
const logger = new Logger({ prefix: '[WorkflowValidator]' });

/**
 * The workflow-level "add error handling" advisory. checkWorkflowPatterns emits
 * it (advisory profiles) and generateSuggestions dedupes against it, so both
 * must reference the same literal.
 */
const ADD_ERROR_HANDLING_ADVISORY = 'Consider adding error handling to your workflow';

/**
 * All valid connection output keys in n8n workflows.
 * Any key not in this set is malformed and should be flagged.
 */
export const VALID_CONNECTION_TYPES = new Set<string>([
  'main',
  'error',
  ...AI_CONNECTION_TYPES,
  // Additional AI types from n8n-workflow NodeConnectionTypes not in AI_CONNECTION_TYPES
  'ai_agent',
  'ai_chain',
  'ai_retriever',
  'ai_reranker',
]);

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  position: [number, number];
  parameters: any;
  credentials?: any;
  disabled?: boolean;
  notes?: string;
  notesInFlow?: boolean;
  typeVersion?: number;
  continueOnFail?: boolean;
  onError?: 'continueRegularOutput' | 'continueErrorOutput' | 'stopWorkflow';
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
}

interface WorkflowConnection {
  [sourceNode: string]: {
    [outputType: string]: Array<Array<{ node: string; type: string; index: number }>>;
  };
}

interface WorkflowJson {
  name?: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection;
  settings?: any;
  staticData?: any;
  pinData?: any;
  meta?: any;
}

export interface ValidationIssue {
  type: 'error' | 'warning';
  nodeId?: string;
  nodeName?: string;
  message: string;
  details?: any;
  code?: string;
  fix?: {
    type: string;
    currentType?: string;
    suggestedType?: string;
    description?: string;
  };
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  statistics: {
    totalNodes: number;
    enabledNodes: number;
    triggerNodes: number;
    validConnections: number;
    invalidConnections: number;
    expressionsValidated: number;
  };
  suggestions: string[];
}

export class WorkflowValidator {
  private currentWorkflow: WorkflowJson | null = null;
  private similarityService: NodeSimilarityService;

  constructor(
    private nodeRepository: NodeRepository,
    private nodeValidator: typeof EnhancedConfigValidator
  ) {
    this.similarityService = new NodeSimilarityService(nodeRepository);
  }

  // Note: isStickyNote logic moved to shared utility: src/utils/node-classification.ts
  // Use isNonExecutableNode(node.type) instead

  /**
   * Validate a complete workflow
   */
  async validateWorkflow(
    workflow: WorkflowJson,
    options: {
      validateNodes?: boolean;
      validateConnections?: boolean;
      validateExpressions?: boolean;
      profile?: 'minimal' | 'runtime' | 'ai-friendly' | 'strict';
    } = {}
  ): Promise<WorkflowValidationResult> {
    // Store current workflow for access in helper methods
    this.currentWorkflow = workflow;

    const {
      validateNodes = true,
      validateConnections = true,
      validateExpressions = true,
      profile = 'runtime'
    } = options;

    const result: WorkflowValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      statistics: {
        totalNodes: 0,
        enabledNodes: 0,
        triggerNodes: 0,
        validConnections: 0,
        invalidConnections: 0,
        expressionsValidated: 0,
      },
      suggestions: []
    };

    try {
      // Handle null/undefined workflow
      if (!workflow) {
        result.errors.push({
          type: 'error',
          message: 'Invalid workflow structure: workflow is null or undefined'
        });
        result.valid = false;
        return result;
      }

      // Update statistics after null check (exclude sticky notes from counts)
      const executableNodes = Array.isArray(workflow.nodes) ? workflow.nodes.filter(n => !isNonExecutableNode(n.type)) : [];
      result.statistics.totalNodes = executableNodes.length;
      result.statistics.enabledNodes = executableNodes.filter(n => !n.disabled).length;

      // Basic workflow structure validation
      this.validateWorkflowStructure(workflow, result);

      // Only continue if basic structure is valid
      if (workflow.nodes && Array.isArray(workflow.nodes) && workflow.connections && typeof workflow.connections === 'object') {
        // Validate each node if requested
        if (validateNodes && workflow.nodes.length > 0) {
          await this.validateAllNodes(workflow, result, profile);
        }

        // Validate connections if requested
        if (validateConnections) {
          this.validateConnections(workflow, result, profile);
        }

        // Validate expressions if requested
        if (validateExpressions && workflow.nodes.length > 0) {
          this.validateExpressions(workflow, result, profile);
        }

        // Check workflow patterns and best practices
        if (workflow.nodes.length > 0) {
          this.checkWorkflowPatterns(workflow, result, profile);
        }

        // Validate AI-specific nodes (AI Agent, Chat Trigger, AI tools)
        if (workflow.nodes.length > 0 && hasAINodes(workflow)) {
          const aiIssues = validateAISpecificNodes(workflow);
          // Convert AI validation issues to workflow validation format.
          // info-severity issues are advisories, not defects — route them to
          // the suggestions channel instead of upgrading them to warnings.
          for (const issue of aiIssues) {
            if (issue.severity === 'info') {
              result.suggestions.push(issue.message);
              continue;
            }

            const validationIssue: ValidationIssue = {
              type: issue.severity === 'error' ? 'error' : 'warning',
              nodeId: issue.nodeId,
              nodeName: issue.nodeName,
              message: issue.message,
              details: issue.code ? { code: issue.code } : undefined
            };

            if (issue.severity === 'error') {
              result.errors.push(validationIssue);
            } else {
              result.warnings.push(validationIssue);
            }
          }
        }

        // Add suggestions based on findings
        this.generateSuggestions(workflow, result, profile);

        // Add AI-specific recovery suggestions if there are errors
        if (result.errors.length > 0) {
          this.addErrorRecoverySuggestions(result);
        }
      }

    } catch (error) {
      logger.error('Error validating workflow:', error);
      result.errors.push({
        type: 'error',
        message: `Workflow validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate basic workflow structure
   */
  private validateWorkflowStructure(
    workflow: WorkflowJson,
    result: WorkflowValidationResult
  ): void {
    // Check for required fields
    if (!workflow.nodes) {
      result.errors.push({
        type: 'error',
        message: workflow.nodes === null ? 'nodes must be an array' : 'Workflow must have a nodes array'
      });
      return;
    }

    if (!Array.isArray(workflow.nodes)) {
      result.errors.push({
        type: 'error',
        message: 'nodes must be an array'
      });
      return;
    }

    if (!workflow.connections) {
      result.errors.push({
        type: 'error',
        message: workflow.connections === null ? 'connections must be an object' : 'Workflow must have a connections object'
      });
      return;
    }

    if (typeof workflow.connections !== 'object' || Array.isArray(workflow.connections)) {
      result.errors.push({
        type: 'error',
        message: 'connections must be an object'
      });
      return;
    }

    // Check for empty workflow - this should be a warning, not an error
    if (workflow.nodes.length === 0) {
      result.warnings.push({
        type: 'warning',
        message: 'Workflow is empty - no nodes defined'
      });
      return;
    }

    // Check for minimum viable workflow
    if (workflow.nodes.length === 1) {
      const singleNode = workflow.nodes[0];
      const normalizedType = NodeTypeNormalizer.normalizeToFullForm(singleNode.type);
      const isWebhook = normalizedType === 'nodes-base.webhook' ||
                       normalizedType === 'nodes-base.webhookTrigger';
      const isLangchainNode = normalizedType.startsWith('nodes-langchain.');

      // Langchain nodes can be validated standalone for AI tool purposes
      if (!isWebhook && !isLangchainNode) {
        result.errors.push({
          type: 'error',
          message: 'Single-node workflows are only valid for webhook endpoints. Add at least one more connected node to create a functional workflow.'
        });
      } else if (isWebhook && Object.keys(workflow.connections).length === 0) {
        result.warnings.push({
          type: 'warning',
          message: 'Webhook node has no connections. Consider adding nodes to process the webhook data.'
        });
      }
    }

    // Check for empty connections in multi-node workflows
    if (workflow.nodes.length > 1) {
      const hasEnabledNodes = workflow.nodes.some(n => !n.disabled);
      const hasConnections = Object.keys(workflow.connections).length > 0;
      
      if (hasEnabledNodes && !hasConnections) {
        result.errors.push({
          type: 'error',
          message: 'Multi-node workflow has no connections. Nodes must be connected to create a workflow. Use connections: { "Source Node Name": { "main": [[{ "node": "Target Node Name", "type": "main", "index": 0 }]] } }'
        });
      }
    }

    // Check for duplicate node names
    const nodeNames = new Set<string>();
    const nodeIds = new Set<string>();
    const nodeIdToIndex = new Map<string, number>(); // Track which node index has which ID

    for (let i = 0; i < workflow.nodes.length; i++) {
      const node = workflow.nodes[i];

      if (nodeNames.has(node.name)) {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: `Duplicate node name: "${node.name}"`
        });
      }
      nodeNames.add(node.name);

      // Missing/empty ids never collide: n8n keys nodes by name and
      // regenerates absent ids on import, so only compare non-empty ids.
      if (node.id && nodeIds.has(node.id)) {
        const firstNodeIndex = nodeIdToIndex.get(node.id);
        const firstNode = firstNodeIndex !== undefined ? workflow.nodes[firstNodeIndex] : undefined;

        result.errors.push({
          type: 'error',
          nodeId: node.id,
          message: `Duplicate node ID: "${node.id}". Node at index ${i} (name: "${node.name}", type: "${node.type}") conflicts with node at index ${firstNodeIndex} (name: "${firstNode?.name || 'unknown'}", type: "${firstNode?.type || 'unknown'}"). Each node must have a unique ID. Generate a new UUID using crypto.randomUUID() - Example: {id: "${crypto.randomUUID()}", name: "${node.name}", type: "${node.type}", ...}`
        });
      } else if (node.id) {
        nodeIds.add(node.id);
        nodeIdToIndex.set(node.id, i);
      }
    }

    // Count trigger nodes using shared trigger detection
    const triggerNodes = workflow.nodes.filter(n => isTriggerNode(n.type));
    result.statistics.triggerNodes = triggerNodes.length;

    // Check for at least one trigger node
    if (triggerNodes.length === 0 && workflow.nodes.filter(n => !n.disabled).length > 0) {
      result.warnings.push({
        type: 'warning',
        message: 'Workflow has no trigger nodes. It can only be executed manually.'
      });
    }
  }

  /**
   * Validate all nodes in the workflow
   */
  private async validateAllNodes(
    workflow: WorkflowJson,
    result: WorkflowValidationResult,
    profile: string
  ): Promise<void> {
    for (const node of workflow.nodes) {
      if (node.disabled || isNonExecutableNode(node.type)) continue;

      try {
        // Validate node name length
        if (node.name && node.name.length > 255) {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `Node name is very long (${node.name.length} characters). Consider using a shorter name for better readability.`
          });
        }

        // Validate node position
        if (!Array.isArray(node.position) || node.position.length !== 2) {
          result.errors.push({
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: 'Node position must be an array with exactly 2 numbers [x, y]'
          });
        } else {
          const [x, y] = node.position;
          if (typeof x !== 'number' || typeof y !== 'number' || 
              !isFinite(x) || !isFinite(y)) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: 'Node position values must be finite numbers'
            });
          }
        }
        // Normalize node type for database lookup (DO NOT mutate the original workflow)
        // The normalizer converts to short form (nodes-base.*) for database queries,
        // but n8n API requires full form (n8n-nodes-base.*). Never modify the input workflow.
        const normalizedType = NodeTypeNormalizer.normalizeToFullForm(node.type);

        // Get node definition using normalized type (needed for typeVersion validation)
        let nodeInfo = this.nodeRepository.getNode(normalizedType);

        // Check if this is a dynamic Tool variant (e.g., googleDriveTool, googleSheetsTool)
        // n8n creates these at runtime when ANY node is used in an AI Agent's tool slot,
        // but they don't exist in npm packages. We infer validity if the base node exists.
        // See: https://github.com/czlonkowski/n8n-mcp/issues/522
        if (!nodeInfo && ToolVariantGenerator.isToolVariantNodeType(normalizedType)) {
          const baseNodeType = ToolVariantGenerator.getBaseNodeType(normalizedType);
          if (baseNodeType) {
            const baseNodeInfo = this.nodeRepository.getNode(baseNodeType);
            if (baseNodeInfo) {
              // Valid inferred tool variant - base node exists. This is
              // informational (the config is fine), so it rides the
              // suggestions channel rather than warnings.
              result.suggestions.push(
                `Node type "${node.type}" is inferred as a dynamic AI Tool variant of "${baseNodeType}". ` +
                  `This Tool variant is created by n8n at runtime when connecting "${baseNodeInfo.displayName}" to an AI Agent.`
              );

              // Create synthetic nodeInfo for validation continuity
              nodeInfo = {
                ...baseNodeInfo,
                nodeType: normalizedType,
                displayName: `${baseNodeInfo.displayName} Tool`,
                isToolVariant: true,
                toolVariantOf: baseNodeType,
                isInferred: true
              };
            }
          }
        }

        if (!nodeInfo) {

          // Use NodeSimilarityService to find suggestions
          const suggestions = await this.similarityService.findSimilarNodes(node.type, 3);

          // Community-prefixed types may simply be absent from this server's
          // node database while installed on the target instance, so they are
          // reported as warnings. Core-prefixed and prefix-less unknowns are
          // always real failures.
          const isCommunityType = !this.isCorePackageType(normalizedType) && normalizedType.includes('.');

          let message = `Unknown node type: "${node.type}".`;
          if (isCommunityType) {
            message += ' This looks like a community node that is not in this server\'s node database — the workflow can still run on an n8n instance where the package is installed.';
          }

          if (suggestions.length > 0) {
            message += '\n\nDid you mean one of these?';
            for (const suggestion of suggestions) {
              const confidence = Math.round(suggestion.confidence * 100);
              message += `\n• ${suggestion.nodeType} (${confidence}% match)`;
              if (suggestion.displayName) {
                message += ` - ${suggestion.displayName}`;
              }
              message += `\n  → ${suggestion.reason}`;
              if (suggestion.confidence >= 0.9) {
                message += ' (can be auto-fixed)';
              }
            }
          } else if (!isCommunityType) {
            message += ' No similar nodes found. Node types must include the package prefix (e.g., "n8n-nodes-base.webhook").';
          }

          const issue: any = {
            type: isCommunityType ? 'warning' : 'error',
            nodeId: node.id,
            nodeName: node.name,
            message
          };

          // Add suggestions as metadata for programmatic access
          if (suggestions.length > 0) {
            issue.suggestions = suggestions.map(s => ({
              nodeType: s.nodeType,
              confidence: s.confidence,
              reason: s.reason
            }));
          }

          if (isCommunityType) {
            result.warnings.push(issue);
          } else {
            result.errors.push(issue);
          }
          continue;
        }

        // Validate typeVersion for ALL versioned nodes (including langchain nodes)
        // CRITICAL: This MUST run BEFORE the langchain skip below!
        // Otherwise, langchain nodes with invalid typeVersion (e.g., 99999) would pass validation
        // but fail at runtime in n8n. This was the bug fixed in v2.17.4.
        if (nodeInfo.isVersioned) {
          // Coerce nodeInfo.version (stored as TEXT in SQLite, may be a non-numeric
          // npm-style string for community nodes — see #781) to a finite number for
          // safe comparisons. If we can't, skip the min/max checks rather than silently
          // comparing against NaN.
          const maxVersion = parseTypeVersion(nodeInfo.version);
          if (maxVersion === null && nodeInfo.version != null) {
            // Stale seed data: stored version isn't a valid typeVersion. We can't
            // tell whether `node.typeVersion` is in range, so surface the gap rather
            // than silently passing it through.
            result.warnings.push({
              type: 'warning',
              nodeId: node.id,
              nodeName: node.name,
              message: `Cannot validate typeVersion for ${node.type}: stored version "${nodeInfo.version}" is not a valid typeVersion. Min/max checks were skipped — re-sync this node or verify typeVersion against the node descriptor manually.`
            });
          }

          // Check if typeVersion is missing. Use an explicit nullish check so that
          // a literal 0 isn't treated as missing, and so that NaN falls through to
          // the "invalid" branch below (where it is reported as non-finite).
          if (node.typeVersion === undefined || node.typeVersion === null) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: `Missing required property 'typeVersion'. Add typeVersion: ${maxVersion ?? 1}`
            });
          }
          // Check if typeVersion is invalid (must be a finite, non-negative number; 0 is valid)
          else if (typeof node.typeVersion !== 'number' || !Number.isFinite(node.typeVersion) || node.typeVersion < 0) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: `Invalid typeVersion: ${node.typeVersion}. Must be a finite non-negative number`
            });
          }
          // Check if typeVersion is outdated (less than latest). Old
          // typeVersions are supported by design (that is the point of
          // versioning), so this is advisory only and gated to the
          // advisory profiles.
          else if (maxVersion !== null && node.typeVersion < maxVersion) {
            if (this.isAdvisoryProfile(profile)) {
              result.suggestions.push(
                `Outdated typeVersion for node "${node.name}": ${node.typeVersion}. Latest is ${maxVersion}.`
              );
            }
          }
          // Check if typeVersion exceeds maximum supported.
          // For core packages this is a real activation failure; for community
          // packages the DB snapshot may simply be older than the installed
          // package, so only warn.
          else if (maxVersion !== null && node.typeVersion > maxVersion) {
            if (this.isCorePackageType(normalizedType)) {
              result.errors.push({
                type: 'error',
                nodeId: node.id,
                nodeName: node.name,
                message: `typeVersion ${node.typeVersion} exceeds maximum supported version ${maxVersion}`
              });
            } else {
              result.warnings.push({
                type: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `typeVersion ${node.typeVersion} exceeds maximum supported version ${maxVersion} known to this server. The community package may be newer than this server's data — verify the version exists in your installed package.`
              });
            }
          }
        }

        // Skip PARAMETER validation for langchain nodes (but NOT typeVersion validation above!)
        // Langchain nodes have dedicated AI-specific validators in validateAISpecificNodes()
        // which handle their unique parameter structures (AI connections, tool ports, etc.)
        if (normalizedType.startsWith('nodes-langchain.')) {
          continue;
        }

        // Skip PARAMETER validation for inferred tool variants (Issue #522)
        // They have a different property structure (toolDescription added at runtime)
        // that doesn't match the base node's schema. TypeVersion validation above still runs.
        if ((nodeInfo as any).isInferred) {
          continue;
        }

        // Validate node configuration
        // Add @version to parameters for displayOptions evaluation (supports _cnd operators)
        const paramsWithVersion = {
          '@version': node.typeVersion || 1,
          ...node.parameters
        };
        const nodeValidation = this.nodeValidator.validateWithMode(
          node.type,
          paramsWithVersion,
          nodeInfo.properties || [],
          'operation',
          profile as any
        );

        // Add node-specific errors and warnings
        nodeValidation.errors.forEach((error: any) => {
          result.errors.push({
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: typeof error === 'string' ? error : error.message || String(error)
          });
        });

        nodeValidation.warnings.forEach((warning: any) => {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: typeof warning === 'string' ? warning : warning.message || String(warning)
          });
        });

        // Validate If/Switch conditions structure (version-conditional)
        if (node.type === 'n8n-nodes-base.if' || node.type === 'n8n-nodes-base.switch') {
          const conditionErrors = validateConditionNodeStructure(node as any);
          for (const err of conditionErrors) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: err
            });
          }
        }

      } catch (error) {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: `Failed to validate node: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }
  }

  /**
   * Validate workflow connections
   */
  private validateConnections(
    workflow: WorkflowJson,
    result: WorkflowValidationResult,
    profile: string = 'runtime'
  ): void {
    const nodeMap = new Map(workflow.nodes.map(n => [n.name, n]));
    const nodeIdMap = new Map(workflow.nodes.map(n => [n.id, n]));

    // Check all connections
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      const sourceNode = nodeMap.get(sourceName);
      
      if (!sourceNode) {
        // Check if this is an ID being used instead of a name
        const nodeById = nodeIdMap.get(sourceName);
        if (nodeById) {
          result.errors.push({
            type: 'error',
            nodeId: nodeById.id,
            nodeName: nodeById.name,
            message: `Connection uses node ID '${sourceName}' instead of node name '${nodeById.name}'. In n8n, connections must use node names, not IDs.`
          });
        } else {
          result.errors.push({
            type: 'error',
            message: `Connection from non-existent node: "${sourceName}"`
          });
        }
        result.statistics.invalidConnections++;
        continue;
      }

      // Detect unknown output keys and validate known ones
      for (const [outputKey, outputConnections] of Object.entries(outputs)) {
        if (!VALID_CONNECTION_TYPES.has(outputKey)) {
          // Flag unknown connection output key
          let suggestion = '';
          if (/^\d+$/.test(outputKey)) {
            suggestion = ` If you meant to use output index ${outputKey}, use main[${outputKey}] instead.`;
          }
          result.errors.push({
            type: 'error',
            nodeName: sourceName,
            message: `Unknown connection output key "${outputKey}" on node "${sourceName}". Valid keys are: ${[...VALID_CONNECTION_TYPES].join(', ')}.${suggestion}`,
            code: 'UNKNOWN_CONNECTION_KEY'
          });
          result.statistics.invalidConnections++;
          continue;
        }

        if (!outputConnections || !Array.isArray(outputConnections)) continue;

        // Validate that the source node can actually output ai_tool
        if (outputKey === 'ai_tool') {
          this.validateAIToolSource(sourceNode, result);
        }

        // Validate that AI sub-nodes are not connected via main
        if (outputKey === 'main') {
          this.validateNotAISubNode(sourceNode, result);
        }

        this.validateConnectionOutputs(
          sourceName,
          outputConnections,
          nodeMap,
          nodeIdMap,
          result,
          outputKey,
          profile
        );
      }
    }

    // Trigger reachability analysis: BFS from all triggers to find unreachable nodes
    if (profile !== 'minimal') {
      this.validateTriggerReachability(workflow, result);
    } else {
      this.flagOrphanedNodes(workflow, result);
    }

    // Check for cycles (skip in minimal profile to reduce false positives).
    // Warning, not error: n8n imposes no static cycle rejection, and cycles
    // routinely terminate via mechanisms invisible to topology analysis
    // (empty-output pagination, error-retry, poll loops) — live-verified.
    if (profile !== 'minimal' && this.hasCycle(workflow)) {
      result.warnings.push({
        type: 'warning',
        message: 'Workflow contains a cycle with no recognized exit. Verify the loop can terminate (e.g. via a conditional branch, an error output, or a node that can return zero items).'
      });
    }
  }

  /**
   * Validate connection outputs
   */
  private validateConnectionOutputs(
    sourceName: string,
    outputs: Array<Array<{ node: string; type: string; index: number }>>,
    nodeMap: Map<string, WorkflowNode>,
    nodeIdMap: Map<string, WorkflowNode>,
    result: WorkflowValidationResult,
    outputType: string,
    profile: string = 'runtime'
  ): void {
    // Get source node for special validation
    const sourceNode = nodeMap.get(sourceName);

    // Main-output-specific validation: error handling config and index bounds
    if (outputType === 'main' && sourceNode) {
      this.validateErrorOutputConfiguration(sourceName, sourceNode, outputs, nodeMap, result, profile);
      this.validateOutputIndexBounds(sourceNode, outputs, result);
      this.validateConditionalBranchUsage(sourceNode, outputs, result);
    }

    outputs.forEach((outputConnections, outputIndex) => {
      if (!outputConnections) return;

      outputConnections.forEach(connection => {
        // Check for negative index
        if (connection.index < 0) {
          result.errors.push({
            type: 'error',
            message: `Invalid connection index ${connection.index} from "${sourceName}". Connection indices must be non-negative.`
          });
          result.statistics.invalidConnections++;
          return;
        }

        // Validate connection type field
        if (connection.type && !VALID_CONNECTION_TYPES.has(connection.type)) {
          let suggestion = '';
          if (/^\d+$/.test(connection.type)) {
            suggestion = ` Numeric types are not valid - use "main", "error", or an AI connection type.`;
          }
          result.errors.push({
            type: 'error',
            nodeName: sourceName,
            message: `Invalid connection type "${connection.type}" in connection from "${sourceName}" to "${connection.node}". Expected "main", "error", or an AI connection type (ai_tool, ai_languageModel, etc.).${suggestion}`,
            code: 'INVALID_CONNECTION_TYPE'
          });
          result.statistics.invalidConnections++;
          return;
        }

        // Special validation for SplitInBatches node
        // Check both full form (n8n-nodes-base.*) and short form (nodes-base.*)
        const isSplitInBatches = sourceNode && (
          sourceNode.type === 'n8n-nodes-base.splitInBatches' ||
          sourceNode.type === 'nodes-base.splitInBatches'
        );
        if (isSplitInBatches) {
          this.validateSplitInBatchesConnection(
            sourceNode,
            outputIndex,
            connection,
            nodeMap,
            result
          );
        }

        // Check for self-referencing connections
        if (connection.node === sourceName) {
          // This is only a warning for non-loop nodes (not SplitInBatches)
          if (sourceNode && !isSplitInBatches) {
            result.warnings.push({
              type: 'warning',
              message: `Node "${sourceName}" has a self-referencing connection. This can cause infinite loops.`
            });
          }
        }

        const targetNode = nodeMap.get(connection.node);
        
        if (!targetNode) {
          // Check if this is an ID being used instead of a name
          const nodeById = nodeIdMap.get(connection.node);
          if (nodeById) {
            result.errors.push({
              type: 'error',
              nodeId: nodeById.id,
              nodeName: nodeById.name,
              message: `Connection target uses node ID '${connection.node}' instead of node name '${nodeById.name}' (from ${sourceName}). In n8n, connections must use node names, not IDs.`
            });
          } else {
            result.errors.push({
              type: 'error',
              message: `Connection to non-existent node: "${connection.node}" from "${sourceName}"`
            });
          }
          result.statistics.invalidConnections++;
        } else if (targetNode.disabled) {
          result.warnings.push({
            type: 'warning',
            message: `Connection to disabled node: "${connection.node}" from "${sourceName}"`
          });
        } else {
          result.statistics.validConnections++;

          // Additional validation for AI tool connections
          if (outputType === 'ai_tool') {
            this.validateAIToolConnection(sourceName, targetNode, result);
          }

          // Input index bounds checking
          if (outputType === 'main') {
            this.validateInputIndexBounds(sourceName, targetNode, connection, result);
          }
        }
      });
    });
  }

  /**
   * Validate error output configuration
   */
  private validateErrorOutputConfiguration(
    sourceName: string,
    sourceNode: WorkflowNode,
    outputs: Array<Array<{ node: string; type: string; index: number }>>,
    nodeMap: Map<string, WorkflowNode>,
    result: WorkflowValidationResult,
    profile: string = 'runtime'
  ): void {
    // Check if node has onError: 'continueErrorOutput'
    const hasErrorOutputSetting = sourceNode.onError === 'continueErrorOutput';

    // The error output is the extra, LAST output after the node's natural main
    // outputs (index = natural count) — main[1] is a normal branch on IF/Switch/
    // SplitInBatches. Skip the mismatch checks when the count is unknown.
    const errorOutputIndex = this.getMainOutputCount(sourceNode);
    if (errorOutputIndex !== null) {
      const hasErrorConnections =
        outputs.length > errorOutputIndex &&
        outputs[errorOutputIndex] &&
        outputs[errorOutputIndex].length > 0;

      // Both mismatch checks are lint, not validity: n8n runs either config.
      // An unwired error output just drops failed items (live-verified).
      if (hasErrorOutputSetting && !hasErrorConnections && profile !== 'minimal') {
        result.warnings.push({
          type: 'warning',
          nodeId: sourceNode.id,
          nodeName: sourceNode.name,
          message: `Node has onError: 'continueErrorOutput' but the error output (main[${errorOutputIndex}]) is not connected — failed items are silently dropped. Connect an error handler to main[${errorOutputIndex}] or change onError to 'continueRegularOutput' or 'stopWorkflow'.`
        });
      }

      if (!hasErrorOutputSetting && hasErrorConnections) {
        result.warnings.push({
          type: 'warning',
          nodeId: sourceNode.id,
          nodeName: sourceNode.name,
          message: `Node has error output connections in main[${errorOutputIndex}] but missing onError: 'continueErrorOutput'. Add this property to properly handle errors.`
        });
      }
    }

    // Check for common mistake: multiple nodes in main[0] when error handling is intended
    if (outputs.length >= 1 && outputs[0] && outputs[0].length > 1) {
      // Check if any of the nodes in main[0] look like error handlers
      const potentialErrorHandlers = outputs[0].filter(conn => {
        const targetNode = nodeMap.get(conn.node);
        if (!targetNode) return false;

        const nodeName = targetNode.name.toLowerCase();
        const nodeType = targetNode.type.toLowerCase();

        // Common patterns for error handler nodes
        return nodeName.includes('error') ||
               nodeName.includes('fail') ||
               nodeName.includes('catch') ||
               nodeName.includes('exception') ||
               nodeType.includes('respondtowebhook') ||
               nodeType.includes('emailsend');
      });

      if (potentialErrorHandlers.length > 0) {
        const errorHandlerNames = potentialErrorHandlers.map(conn => `"${conn.node}"`).join(', ');
        result.errors.push({
          type: 'error',
          nodeId: sourceNode.id,
          nodeName: sourceNode.name,
          message: `Incorrect error output configuration. Nodes ${errorHandlerNames} appear to be error handlers but are in main[0] (success output) along with other nodes.\n\n` +
                   `INCORRECT (current):\n` +
                   `"${sourceName}": {\n` +
                   `  "main": [\n` +
                   `    [  // main[0] has multiple nodes mixed together\n` +
                   outputs[0].map(conn => `      {"node": "${conn.node}", "type": "${conn.type}", "index": ${conn.index}}`).join(',\n') + '\n' +
                   `    ]\n` +
                   `  ]\n` +
                   `}\n\n` +
                   `CORRECT (should be):\n` +
                   `"${sourceName}": {\n` +
                   `  "main": [\n` +
                   `    [  // main[0] = success output\n` +
                   outputs[0].filter(conn => !potentialErrorHandlers.includes(conn)).map(conn => `      {"node": "${conn.node}", "type": "${conn.type}", "index": ${conn.index}}`).join(',\n') + '\n' +
                   `    ],\n` +
                   `    [  // main[1] = error output\n` +
                   potentialErrorHandlers.map(conn => `      {"node": "${conn.node}", "type": "${conn.type}", "index": ${conn.index}}`).join(',\n') + '\n' +
                   `    ]\n` +
                   `  ]\n` +
                   `}\n\n` +
                   `Also add: "onError": "continueErrorOutput" to the "${sourceName}" node.`
        });
      }
    }
  }

  /**
   * Validate AI tool connections
   */
  private validateAIToolConnection(
    sourceName: string,
    targetNode: WorkflowNode,
    result: WorkflowValidationResult
  ): void {
    // For AI tool connections, we just need to check if this is being used as a tool
    // The source should be an AI Agent connecting to this target node as a tool
    
    // Get target node info to check if it can be used as a tool
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(targetNode.type);
    let targetNodeInfo = this.nodeRepository.getNode(normalizedType);

    // Try original type if normalization didn't help (fallback for edge cases)
    if (!targetNodeInfo && normalizedType !== targetNode.type) {
      targetNodeInfo = this.nodeRepository.getNode(targetNode.type);
    }
    
    if (targetNodeInfo && !targetNodeInfo.isAITool && targetNodeInfo.package !== 'n8n-nodes-base') {
      // It's a community node being used as a tool
      result.warnings.push({
        type: 'warning',
        nodeId: targetNode.id,
        nodeName: targetNode.name,
        message: `Community node "${targetNode.name}" is being used as an AI tool. Ensure N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true is set.`
      });
    }
  }

  /**
   * Validate that a node can actually output ai_tool connections.
   *
   * Valid ai_tool sources are:
   * 1. Langchain tool nodes (in AI_TOOL_VALIDATORS)
   * 2. Tool variant nodes (e.g., nodes-base.supabaseTool)
   *
   * If a base node (e.g., nodes-base.supabase) is used with ai_tool connection
   * but it has a Tool variant available, this is an error.
   */
  private validateAIToolSource(
    sourceNode: WorkflowNode,
    result: WorkflowValidationResult
  ): void {
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(sourceNode.type);

    // Check if it's a known langchain tool node
    if (isAIToolSubNode(normalizedType)) {
      return; // Valid - it's a langchain tool
    }

    // Get node info from repository (single lookup, reused below)
    const nodeInfo = this.nodeRepository.getNode(normalizedType);

    // Check if it's a Tool variant (ends with Tool and is in database as isToolVariant)
    if (ToolVariantGenerator.isToolVariantNodeType(normalizedType)) {
      // It looks like a Tool variant, verify it exists in database
      if (nodeInfo?.isToolVariant) {
        return; // Valid - it's a Tool variant
      }
    }

    if (!nodeInfo) {
      // Node not found in database - might be a community node or unknown
      // Don't error here, let other validation handle unknown nodes
      return;
    }

    // Check if this is a base node that has a Tool variant available
    if (nodeInfo.hasToolVariant) {
      const toolVariantType = ToolVariantGenerator.getToolVariantNodeType(normalizedType);
      const workflowToolVariantType = NodeTypeNormalizer.toWorkflowFormat(toolVariantType);

      result.errors.push({
        type: 'error',
        nodeId: sourceNode.id,
        nodeName: sourceNode.name,
        message: `Node "${sourceNode.name}" uses "${sourceNode.type}" which cannot output ai_tool connections. ` +
          `Use the Tool variant "${workflowToolVariantType}" instead for AI Agent integration.`,
        code: 'WRONG_NODE_TYPE_FOR_AI_TOOL',
        fix: {
          type: 'tool-variant-correction',
          currentType: sourceNode.type,
          suggestedType: workflowToolVariantType,
          description: `Change node type from "${sourceNode.type}" to "${workflowToolVariantType}"`
        }
      });
      return;
    }

    // Check if it's an AI-capable node (isAITool flag) but not a Tool variant
    if (nodeInfo.isAITool) {
      // This node is AI-capable, which is fine for ai_tool connections
      return;
    }

    // Node is not valid for ai_tool connections
    result.errors.push({
      type: 'error',
      nodeId: sourceNode.id,
      nodeName: sourceNode.name,
      message: `Node "${sourceNode.name}" of type "${sourceNode.type}" cannot output ai_tool connections. ` +
        `Only AI tool nodes (e.g., Calculator, HTTP Request Tool) or Tool variants (e.g., *Tool suffix nodes) can be connected to AI Agents as tools.`,
      code: 'INVALID_AI_TOOL_SOURCE'
    });
  }

  /**
   * Get the static output types for a node from the database.
   * Returns null if outputs contain expressions (dynamic) or node not found.
   */
  private getNodeOutputTypes(nodeType: string): string[] | null {
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    const nodeInfo = this.nodeRepository.getNode(normalizedType);
    if (!nodeInfo || !nodeInfo.outputs) return null;

    const outputs = nodeInfo.outputs;
    if (!Array.isArray(outputs)) return null;

    // Skip if any output is an expression (dynamic — can't determine statically)
    for (const output of outputs) {
      if (typeof output === 'string' && output.startsWith('={{')) {
        return null;
      }
    }

    return outputs;
  }

  /**
   * Validate that AI sub-nodes (nodes that only output AI connection types)
   * are not connected via "main" connections.
   */
  private validateNotAISubNode(
    sourceNode: WorkflowNode,
    result: WorkflowValidationResult
  ): void {
    const outputTypes = this.getNodeOutputTypes(sourceNode.type);
    if (!outputTypes) return; // Unknown or dynamic — skip

    // Check if the node outputs ONLY AI types (no 'main')
    const hasMainOutput = outputTypes.some(t => t === 'main');
    if (hasMainOutput) return; // Node can legitimately output main

    // All outputs are AI types — this node should not be connected via main
    const aiTypes = outputTypes.filter(t => t !== 'main');
    const expectedType = aiTypes[0] || 'ai_languageModel';

    result.errors.push({
      type: 'error',
      nodeId: sourceNode.id,
      nodeName: sourceNode.name,
      message: `Node "${sourceNode.name}" (${sourceNode.type}) is an AI sub-node that outputs "${expectedType}" connections. ` +
        `It cannot be used with "main" connections. Connect it to an AI Agent or Chain via "${expectedType}" instead.`,
      code: 'AI_SUBNODE_MAIN_CONNECTION'
    });
  }

  /**
   * Derive the short node type name (e.g., "if", "switch", "set") from a workflow node.
   */
  private getShortNodeType(sourceNode: WorkflowNode): string {
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(sourceNode.type);
    return normalizedType.replace(/^(n8n-)?nodes-base\./, '');
  }

  /**
   * Whether a normalized (short-form) node type belongs to one of the core
   * packages shipped with n8n (n8n-nodes-base / @n8n/n8n-nodes-langchain).
   */
  private isCorePackageType(normalizedType: string): boolean {
    return normalizedType.startsWith('nodes-base.') || normalizedType.startsWith('nodes-langchain.');
  }

  /**
   * Advisory profiles surface best-practice guidance (error-handling nudges,
   * outdated-typeVersion notices, maintainability notes) that fail-loud runtime
   * defaults make optional. The leaner profiles suppress it as noise.
   */
  private isAdvisoryProfile(profile: string): boolean {
    return profile === 'ai-friendly' || profile === 'strict';
  }

  /**
   * Natural (non-error) main output count for a node, from its DB description
   * with dynamic overrides for conditional nodes (IF/Filter/Switch).
   *
   * The error output added by onError: 'continueErrorOutput' is the extra,
   * LAST output, so its index equals this count. Returns null when the count
   * cannot be determined (unknown node, dynamic outputs expression, Switch
   * without determinable rules, no main outputs).
   */
  private getMainOutputCount(sourceNode: WorkflowNode): number | null {
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(sourceNode.type);
    const nodeInfo = this.nodeRepository.getNode(normalizedType);
    if (!nodeInfo || !nodeInfo.outputs) return null;
    if (!Array.isArray(nodeInfo.outputs)) return null; // Dynamic outputs (expression string)

    // outputs can be strings like "main" or objects with { type: "main" }
    const mainOutputCount = nodeInfo.outputs.filter((o: any) =>
      typeof o === 'string' ? o === 'main' : (o.type === 'main' || !o.type)
    ).length;
    if (mainOutputCount === 0) return null;

    // Override with dynamic output counts for conditional nodes
    const conditionalInfo = this.getConditionalOutputInfo(sourceNode);
    if (conditionalInfo) {
      return conditionalInfo.expectedOutputs;
    }
    if (this.getShortNodeType(sourceNode) === 'switch') {
      return null; // Switch without determinable rules
    }

    return mainOutputCount;
  }

  /**
   * Get the expected main output count for a conditional node (IF, Filter, Switch).
   * Returns null for non-conditional nodes or when the count cannot be determined.
   */
  private getConditionalOutputInfo(sourceNode: WorkflowNode): { shortType: string; expectedOutputs: number } | null {
    const shortType = this.getShortNodeType(sourceNode);

    if (shortType === 'if' || shortType === 'filter') {
      return { shortType, expectedOutputs: 2 };
    }
    if (shortType === 'switch') {
      const rules = sourceNode.parameters?.rules?.values || sourceNode.parameters?.rules;
      if (Array.isArray(rules)) {
        return { shortType, expectedOutputs: rules.length + 1 }; // rules + fallback
      }
      return null; // Cannot determine dynamic output count
    }
    return null;
  }

  /**
   * Validate that output indices don't exceed what the node type supports.
   */
  private validateOutputIndexBounds(
    sourceNode: WorkflowNode,
    outputs: Array<Array<{ node: string; type: string; index: number }>>,
    result: WorkflowValidationResult
  ): void {
    const naturalOutputCount = this.getMainOutputCount(sourceNode);
    if (naturalOutputCount === null) return; // Unknown or dynamic — skip check

    let mainOutputCount = naturalOutputCount;

    // Account for continueErrorOutput adding an extra output
    if (sourceNode.onError === 'continueErrorOutput') {
      mainOutputCount += 1;
    }

    // Check if any output index exceeds bounds
    const maxOutputIndex = outputs.length - 1;
    if (maxOutputIndex >= mainOutputCount) {
      // Only flag if there are actual connections at the out-of-bounds indices
      for (let i = mainOutputCount; i < outputs.length; i++) {
        if (outputs[i] && outputs[i].length > 0) {
          result.errors.push({
            type: 'error',
            nodeId: sourceNode.id,
            nodeName: sourceNode.name,
            message: `Output index ${i} on node "${sourceNode.name}" exceeds its output count (${mainOutputCount}). ` +
              `This node has ${mainOutputCount} main output(s) (indices 0-${mainOutputCount - 1}).`,
            code: 'OUTPUT_INDEX_OUT_OF_BOUNDS'
          });
          result.statistics.invalidConnections++;
        }
      }
    }
  }

  /**
   * Detect when a conditional node (IF, Filter, Switch) has all connections
   * crammed into main[0] with higher-index outputs empty. This usually means
   * both branches execute together on one condition, while the other branches
   * have no effect.
   */
  private validateConditionalBranchUsage(
    sourceNode: WorkflowNode,
    outputs: Array<Array<{ node: string; type: string; index: number }>>,
    result: WorkflowValidationResult
  ): void {
    const conditionalInfo = this.getConditionalOutputInfo(sourceNode);
    if (!conditionalInfo || conditionalInfo.expectedOutputs < 2) return;

    const { shortType, expectedOutputs } = conditionalInfo;

    // Check: main[0] has >= 2 connections AND all main[1+] are empty
    const main0Count = outputs[0]?.length || 0;
    if (main0Count < 2) return;

    const hasHigherIndexConnections = outputs.slice(1).some(
      conns => conns && conns.length > 0
    );
    if (hasHigherIndexConnections) return;

    // Build a context-appropriate warning message
    let message: string;
    if (shortType === 'if' || shortType === 'filter') {
      const isFilter = shortType === 'filter';
      const displayName = isFilter ? 'Filter' : 'IF';
      const trueLabel = isFilter ? 'matched' : 'true';
      const falseLabel = isFilter ? 'unmatched' : 'false';
      message = `${displayName} node "${sourceNode.name}" has ${main0Count} connections on the "${trueLabel}" branch (main[0]) ` +
        `but no connections on the "${falseLabel}" branch (main[1]). ` +
        `All ${main0Count} target nodes execute together on the "${trueLabel}" branch, ` +
        `while the "${falseLabel}" branch has no effect. ` +
        `Split connections: main[0] for ${trueLabel}, main[1] for ${falseLabel}.`;
    } else {
      message = `Switch node "${sourceNode.name}" has ${main0Count} connections on output 0 ` +
        `but no connections on any other outputs (1-${expectedOutputs - 1}). ` +
        `All ${main0Count} target nodes execute together on output 0, ` +
        `while other switch branches have no effect. ` +
        `Distribute connections across outputs to match switch rules.`;
    }

    result.warnings.push({
      type: 'warning',
      nodeId: sourceNode.id,
      nodeName: sourceNode.name,
      message,
      code: 'CONDITIONAL_BRANCH_FANOUT'
    });
  }

  /**
   * Validate that input index doesn't exceed what the target node accepts.
   */
  private validateInputIndexBounds(
    sourceName: string,
    targetNode: WorkflowNode,
    connection: { node: string; type: string; index: number },
    result: WorkflowValidationResult
  ): void {
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(targetNode.type);
    const nodeInfo = this.nodeRepository.getNode(normalizedType);
    if (!nodeInfo) return;

    const shortType = normalizedType.replace(/^(n8n-)?nodes-base\./, '');

    // Trigger nodes have 0 inputs
    if (nodeInfo.isTrigger || isTriggerNode(targetNode.type)) {
      if (connection.index >= 0) {
        result.errors.push({
          type: 'error',
          nodeName: targetNode.name,
          message: `Input index ${connection.index} on node "${targetNode.name}" exceeds its input count (0). ` +
            `Connection from "${sourceName}" targets input ${connection.index}, but trigger nodes have no main inputs.`,
          code: 'INPUT_INDEX_OUT_OF_BOUNDS'
        });
        result.statistics.invalidConnections++;
      }
      return;
    }

    // Merge/CompareDatasets: read dynamic numberInputs parameter
    if (shortType === 'merge' || shortType === 'compareDatasets') {
      const rawInputs = targetNode.parameters?.numberInputs;

      // Hard error ONLY when numberInputs is explicitly configured and exceeded.
      if (rawInputs != null && rawInputs !== '') {
        if (typeof rawInputs === 'string' && rawInputs.trim().startsWith('=')) {
          return; // Expression — input count unknown statically, skip check
        }
        const parsed = Number(rawInputs);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return; // Unparseable value — cannot verify, skip check
        }
        if (connection.index >= parsed) {
          result.errors.push({
            type: 'error',
            nodeName: targetNode.name,
            message: `Input index ${connection.index} on node "${targetNode.name}" exceeds its input count (${parsed}). ` +
              `Connection from "${sourceName}" targets input ${connection.index}, but this node has ${parsed} main input(s) (indices 0-${parsed - 1}).`,
            code: 'INPUT_INDEX_OUT_OF_BOUNDS'
          });
          result.statistics.invalidConnections++;
        }
        return;
      }

      // numberInputs absent: n8n falls back to its default (2) and silently
      // ignores connections to higher inputs — the workflow still runs
      // (live-verified), so this is a data-loss warning, not an error.
      const defaultInputs = 2;
      if (connection.index >= defaultInputs) {
        result.warnings.push({
          type: 'warning',
          nodeName: targetNode.name,
          message: `Input index ${connection.index} on node "${targetNode.name}" exceeds the default input count (${defaultInputs}) — ` +
            `numberInputs is not set, so n8n will ignore this connection and drop items from "${sourceName}". ` +
            `Set numberInputs to at least ${connection.index + 1} to use this input.`,
          code: 'MERGE_EXTRA_INPUTS_IGNORED'
        });
      }
      return;
    }

    // For all other nodes: skip input bounds check.
    // Many n8n nodes accept dynamic inputs that can't be determined from
    // metadata alone. The false positive cost outweighs the benefit.
  }

  /**
   * Flag nodes that are not referenced in any connection (source or target).
   * Used as a lightweight check when BFS reachability is not applicable.
   */
  private flagOrphanedNodes(
    workflow: WorkflowJson,
    result: WorkflowValidationResult
  ): void {
    const connectedNodes = new Set<string>();
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      connectedNodes.add(sourceName);
      for (const outputConns of Object.values(outputs)) {
        if (!Array.isArray(outputConns)) continue;
        for (const conns of outputConns) {
          if (!conns) continue;
          for (const conn of conns) {
            if (conn) connectedNodes.add(conn.node);
          }
        }
      }
    }

    for (const node of workflow.nodes) {
      if (node.disabled || isNonExecutableNode(node.type)) continue;
      if (isTriggerNode(node.type)) continue;
      if (!connectedNodes.has(node.name)) {
        result.warnings.push({
          type: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: 'Node is not connected to any other nodes'
        });
      }
    }
  }

  /**
   * BFS from all trigger nodes to detect unreachable nodes.
   * Replaces the simple "is node in any connection" check with proper graph traversal.
   */
  private validateTriggerReachability(
    workflow: WorkflowJson,
    result: WorkflowValidationResult
  ): void {
    // Build adjacency list (forward direction, plus reverse for ai_* edges)
    const adjacency = new Map<string, Set<string>>();
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      if (!adjacency.has(sourceName)) adjacency.set(sourceName, new Set());
      for (const [connectionType, outputConns] of Object.entries(outputs)) {
        if (Array.isArray(outputConns)) {
          for (const conns of outputConns) {
            if (!conns) continue;
            for (const conn of conns) {
              if (conn) {
                adjacency.get(sourceName)!.add(conn.node);
                // Also track that the target exists in the graph
                if (!adjacency.has(conn.node)) adjacency.set(conn.node, new Set());
                // AI connections are stored sub-node -> parent, so a reachable
                // parent must make its attached sub-nodes (model/memory/tool/
                // parser chains) reachable: traverse ai_* edges in reverse too.
                if (connectionType.startsWith('ai_')) {
                  adjacency.get(conn.node)!.add(sourceName);
                }
              }
            }
          }
        }
      }
    }

    // Identify trigger nodes
    const triggerNodes: string[] = [];
    for (const node of workflow.nodes) {
      if (isTriggerNode(node.type) && !node.disabled) {
        triggerNodes.push(node.name);
      }
    }

    // If no trigger nodes, fall back to simple orphaned check
    if (triggerNodes.length === 0) {
      this.flagOrphanedNodes(workflow, result);
      return;
    }

    // BFS from all trigger nodes
    const reachable = new Set<string>();
    const queue: string[] = [...triggerNodes];
    for (const t of triggerNodes) reachable.add(t);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!reachable.has(neighbor)) {
            reachable.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    // Flag unreachable nodes
    for (const node of workflow.nodes) {
      if (node.disabled || isNonExecutableNode(node.type)) continue;
      if (isTriggerNode(node.type)) continue;

      if (!reachable.has(node.name)) {
        result.warnings.push({
          type: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: 'Node is not reachable from any trigger node'
        });
      }
    }
  }

  /**
   * Check if workflow has cycles with no recognized exit mechanism.
   * A cycle is allowed when ANY node ON the cycle can route items out of it:
   * loop nodes (SplitInBatches etc.), conditional routers (IF/Switch/Filter/
   * multi-output langchain routers like textClassifier), nodes with an error
   * output configured, or nodes with multiple wired main outputs.
   */
  private hasCycle(workflow: WorkflowJson): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];
    const nodeTypeMap = new Map<string, string>();
    const nodeMap = new Map<string, WorkflowNode>();

    // Build node maps (exclude sticky notes)
    workflow.nodes.forEach(node => {
      if (!isNonExecutableNode(node.type)) {
        nodeTypeMap.set(node.name, node.type);
        nodeMap.set(node.name, node);
      }
    });

    // Known legitimate loop node types
    const loopNodeTypes = [
      'n8n-nodes-base.splitInBatches',
      'nodes-base.splitInBatches',
      'n8n-nodes-base.itemLists',
      'nodes-base.itemLists',
      'n8n-nodes-base.loop',
      'nodes-base.loop'
    ];

    // Conditional node types that can serve as loop exit conditions
    const conditionalNodeTypes = [
      'n8n-nodes-base.if',
      'nodes-base.if',
      'n8n-nodes-base.switch',
      'nodes-base.switch',
      'n8n-nodes-base.filter',
      'nodes-base.filter',
      // Multi-output langchain routers
      '@n8n/n8n-nodes-langchain.textClassifier',
      'n8n-nodes-langchain.textClassifier',
      'nodes-langchain.textClassifier',
    ];

    const isPotentialCycleExit = (nodeName: string): boolean => {
      const nodeType = nodeTypeMap.get(nodeName) || '';
      if (loopNodeTypes.includes(nodeType) || conditionalNodeTypes.includes(nodeType)) {
        return true;
      }

      const node = nodeMap.get(nodeName);
      // A configured error output routes failed items out of the loop
      if (node?.onError === 'continueErrorOutput') return true;

      // Multiple wired main outputs = the node can route items out of the
      // cycle (covers community/langchain dual-output poll and router nodes)
      const connections = workflow.connections[nodeName];
      const mainOutputs = connections?.main;
      if (Array.isArray(mainOutputs)) {
        const wiredOutputs = mainOutputs.filter(conns => Array.isArray(conns) && conns.length > 0).length;
        if (wiredOutputs > 1) return true;
      }

      // Nodes whose description declares multiple natural main outputs
      const outputCount = node ? this.getMainOutputCount(node) : null;
      return outputCount !== null && outputCount > 1;
    };

    const hasCycleDFS = (nodeName: string): boolean => {
      visited.add(nodeName);
      recursionStack.add(nodeName);
      path.push(nodeName);

      const connections = workflow.connections[nodeName];
      if (connections) {
        const allTargets: string[] = [];

        for (const outputConns of Object.values(connections)) {
          if (Array.isArray(outputConns)) {
            outputConns.flat().forEach(conn => {
              if (conn) allTargets.push(conn.node);
            });
          }
        }

        for (const target of allTargets) {
          if (!visited.has(target)) {
            if (hasCycleDFS(target)) return true;
          } else if (recursionStack.has(target)) {
            // Back edge found: the cycle is the current path segment from the
            // target onwards. Evaluate the exit condition over the WHOLE
            // cycle, not just the nodes on the first DFS path into it.
            const cycleNodes = path.slice(path.indexOf(target));
            if (!cycleNodes.some(isPotentialCycleExit)) {
              return true; // No exit mechanism anywhere on the cycle
            }
          }
        }
      }

      recursionStack.delete(nodeName);
      path.pop();
      return false;
    };

    // Check from all executable nodes (exclude sticky notes)
    for (const node of workflow.nodes) {
      if (!isNonExecutableNode(node.type) && !visited.has(node.name)) {
        if (hasCycleDFS(node.name)) return true;
      }
    }

    return false;
  }

  /**
   * Validate expressions in the workflow
   */
  private validateExpressions(
    workflow: WorkflowJson,
    result: WorkflowValidationResult,
    profile: string = 'runtime'
  ): void {
    const nodeNames = workflow.nodes.map(n => n.name);

    for (const node of workflow.nodes) {
      if (node.disabled || isNonExecutableNode(node.type)) continue;

      // Skip expression validation for langchain nodes
      // They have AI-specific validators and different expression rules
      const normalizedType = NodeTypeNormalizer.normalizeToFullForm(node.type);
      if (normalizedType.startsWith('nodes-langchain.')) {
        continue;
      }

      // Create expression context
      const context = {
        availableNodes: nodeNames.filter(n => n !== node.name),
        currentNodeName: node.name,
        hasInputData: this.nodeHasInput(node.name, workflow),
        isInLoop: false // Could be enhanced to detect loop nodes
      };

      // Validate expressions in parameters
      const exprValidation = ExpressionValidator.validateNodeExpressions(
        node.parameters,
        context
      );

      // Count actual expressions found, not just unique variables
      const expressionCount = this.countExpressionsInObject(node.parameters);
      result.statistics.expressionsValidated += expressionCount;

      // Add expression errors and warnings
      exprValidation.errors.forEach(error => {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: `Expression error: ${error}`
        });
      });

      exprValidation.warnings.forEach(warning => {
        result.warnings.push({
          type: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: `Expression warning: ${warning}`
        });
      });

      // Validate expression format (check for missing = prefix and resource locator format)
      const formatContext = {
        nodeType: node.type,
        nodeName: node.name,
        nodeId: node.id
      };

      // The validator gates the missing-cachedResultName advisory by profile
      // (ai-friendly/strict only) — it is UI-guidance, not runtime-blocking (#715).
      const formatIssues = ExpressionFormatValidator.validateNodeParameters(
        node.parameters,
        formatContext,
        profile as ValidationProfile
      );

      // Add format errors and warnings
      formatIssues.forEach(issue => {
        const formattedMessage = ExpressionFormatValidator.formatErrorMessage(issue, formatContext);

        if (issue.severity === 'error') {
          result.errors.push({
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: formattedMessage
          });
        } else {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: formattedMessage
          });
        }
      });
    }
  }

  /**
   * Count expressions in an object recursively
   */
  private countExpressionsInObject(obj: any): number {
    let count = 0;

    if (typeof obj === 'string') {
      // Count expressions in string using linear-time scan instead of
      // the lazy regex `/\{\{[\s\S]+?\}\}/g` which CodeQL flagged as
      // polynomial-ReDoS.
      count += extractBracketExpressions(obj).length;
    } else if (Array.isArray(obj)) {
      // Recursively count in arrays
      for (const item of obj) {
        count += this.countExpressionsInObject(item);
      }
    } else if (obj && typeof obj === 'object') {
      // Recursively count in objects
      for (const value of Object.values(obj)) {
        count += this.countExpressionsInObject(value);
      }
    }
    
    return count;
  }

  /**
   * Check if a node has input connections
   */
  private nodeHasInput(nodeName: string, workflow: WorkflowJson): boolean {
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      if (outputs.main) {
        for (const outputConnections of outputs.main) {
          if (outputConnections?.some(conn => conn.node === nodeName)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Check workflow patterns and best practices
   */
  private checkWorkflowPatterns(
    workflow: WorkflowJson,
    result: WorkflowValidationResult,
    profile: string = 'runtime'
  ): void {
    const advisoryProfile = this.isAdvisoryProfile(profile);

    // Missing error handling is advisory (fail-loud defaults are a valid
    // choice), so it only surfaces in the advisory profiles.
    if (advisoryProfile && workflow.nodes.length > 3 && !this.workflowHasErrorHandling(workflow)) {
      result.warnings.push({
        type: 'warning',
        message: ADD_ERROR_HANDLING_ADVISORY
      });
    }

    // Check node-level error handling properties for ALL executable nodes
    for (const node of workflow.nodes) {
      if (!isNonExecutableNode(node.type)) {
        this.checkNodeErrorHandling(node, workflow, result, profile);
      }
    }

    // Check for very long linear workflows (maintainability note only)
    if (advisoryProfile) {
      const linearChainLength = this.getLongestLinearChain(workflow);
      if (linearChainLength > 10) {
        result.suggestions.push(
          `Long linear chain detected (${linearChainLength} nodes). Consider breaking into sub-workflows.`
        );
      }
    }

    // Generate error handling suggestions based on all nodes
    this.generateErrorHandlingSuggestions(workflow, result);

    // Check for missing credentials
    for (const node of workflow.nodes) {
      if (node.credentials && Object.keys(node.credentials).length > 0) {
        for (const [credType, credConfig] of Object.entries(node.credentials)) {
          if (!credConfig || (typeof credConfig === 'object' && !('id' in credConfig))) {
            result.warnings.push({
              type: 'warning',
              nodeId: node.id,
              nodeName: node.name,
              message: `Missing credentials configuration for ${credType}`
            });
          }
        }
      }
    }

    // AI Agent advisories (no tools connected, community tools) are covered
    // by validateAISpecificNodes (exact agent type match, node name in the
    // message) and by validateAIToolConnection (per-node community-package
    // notice) — no duplicate workflow-level checks here.
  }

  /**
   * Whether the workflow has any error handling: a node-level error strategy
   * (onError/continueOnFail/retryOnFail), an Error Trigger, or a wired error
   * output. n8n stores wired error outputs at main[naturalOutputCount] and
   * never under a top-level `error` connection key.
   */
  private workflowHasErrorHandling(workflow: WorkflowJson): boolean {
    return workflow.nodes.some(node => {
      if (node.disabled) return false;
      if (node.type.toLowerCase().includes('errortrigger')) return true;
      if (node.continueOnFail === true || node.retryOnFail === true) return true;
      // 'stopWorkflow' is n8n's default fail behavior — setting it explicitly is
      // not error handling and must not suppress the workflow-level advisory.
      if (node.onError === undefined || node.onError === 'stopWorkflow') return false;
      if (node.onError !== 'continueErrorOutput') return true;

      // continueErrorOutput only routes failures somewhere when the error
      // output is actually wired
      const mainOutputs = workflow.connections[node.name]?.main;
      if (!Array.isArray(mainOutputs)) return false;
      const errorOutputIndex = this.getMainOutputCount(node);
      if (errorOutputIndex === null) {
        return mainOutputs.some(conns => Array.isArray(conns) && conns.length > 0);
      }
      const errorConnections = mainOutputs[errorOutputIndex];
      return Array.isArray(errorConnections) && errorConnections.length > 0;
    });
  }

  /**
   * Whether the node ever executes on a main branch. AI sub-nodes (ai_*-only
   * outputs) and Tool variants run inside an agent's slots, so node-level
   * error-handling advisories (onError etc.) do not apply to them.
   */
  private nodeExecutesOnMainBranch(node: WorkflowNode): boolean {
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(node.type);
    if (isAIToolSubNode(normalizedType) || ToolVariantGenerator.isToolVariantNodeType(normalizedType)) {
      return false;
    }

    const nodeInfo = this.nodeRepository.getNode(normalizedType);
    if (nodeInfo?.isToolVariant) return false;
    if (!nodeInfo || nodeInfo.outputs == null) return true; // Unknown node — assume main
    if (!Array.isArray(nodeInfo.outputs)) return true; // Dynamic outputs expression
    return nodeInfo.outputs.some((o: any) =>
      typeof o === 'string' ? o === 'main' : (o.type === 'main' || !o.type)
    );
  }

  /**
   * Get the longest linear chain in the workflow
   */
  private getLongestLinearChain(workflow: WorkflowJson): number {
    const memo = new Map<string, number>();
    const visiting = new Set<string>();

    const getChainLength = (nodeName: string): number => {
      // If we're already visiting this node, we have a cycle
      if (visiting.has(nodeName)) return 0;
      
      if (memo.has(nodeName)) return memo.get(nodeName)!;

      visiting.add(nodeName);

      let maxLength = 0;
      const connections = workflow.connections[nodeName];
      
      if (connections?.main) {
        for (const outputConnections of connections.main) {
          if (outputConnections) {
            for (const conn of outputConnections) {
              const length = getChainLength(conn.node);
              maxLength = Math.max(maxLength, length);
            }
          }
        }
      }

      visiting.delete(nodeName);
      const result = maxLength + 1;
      memo.set(nodeName, result);
      return result;
    };

    let maxChain = 0;
    for (const node of workflow.nodes) {
      if (!this.nodeHasInput(node.name, workflow)) {
        maxChain = Math.max(maxChain, getChainLength(node.name));
      }
    }

    return maxChain;
  }


  /**
   * Generate suggestions based on validation results
   */
  private generateSuggestions(
    workflow: WorkflowJson,
    result: WorkflowValidationResult,
    profile: string = 'runtime'
  ): void {
    // Suggest adding trigger if missing
    if (result.statistics.triggerNodes === 0) {
      result.suggestions.push(
        'Add a trigger node (e.g., Webhook, Schedule Trigger) to automate workflow execution'
      );
    }

    // Suggest proper connection structure for workflows with connection errors
    const hasConnectionErrors = result.errors.some(e =>
      typeof e.message === 'string' && (
        e.message.includes('connection') ||
        e.message.includes('Connection') ||
        e.message.includes('Multi-node workflow has no connections')
      )
    );
    
    if (hasConnectionErrors) {
      result.suggestions.push(
        'Example connection structure: connections: { "Manual Trigger": { "main": [[{ "node": "Set", "type": "main", "index": 0 }]] } }'
      );
      result.suggestions.push(
        'Remember: Use node NAMES (not IDs) in connections. The name is what you see in the UI, not the node type.'
      );
    }

    // Suggest error handling. Skip when checkWorkflowPatterns already warned
    // about the same gap (advisory profiles) so a workflow gets the advice once.
    const alreadyWarnedAboutErrorHandling = result.warnings.some(
      w => w.message === ADD_ERROR_HANDLING_ADVISORY
    );
    if (
      profile !== 'minimal' &&
      !alreadyWarnedAboutErrorHandling &&
      !this.workflowHasErrorHandling(workflow)
    ) {
      result.suggestions.push(
        'Add error handling using the error output of nodes or an Error Trigger node'
      );
    }

    // Suggest optimization for large workflows
    if (workflow.nodes.length > 20) {
      result.suggestions.push(
        'Consider breaking this workflow into smaller sub-workflows for better maintainability'
      );
    }

    // Suggest using Code node for complex logic
    const complexExpressionNodes = workflow.nodes.filter(node => {
      const jsonString = JSON.stringify(node.parameters);
      const expressionCount = (jsonString.match(/\{\{/g) || []).length;
      return expressionCount > 5;
    });

    if (complexExpressionNodes.length > 0) {
      result.suggestions.push(
        'Consider using a Code node for complex data transformations instead of multiple expressions'
      );
    }

    // Suggest minimum workflow structure
    if (workflow.nodes.length === 1 && Object.keys(workflow.connections).length === 0) {
      result.suggestions.push(
        'A minimal workflow needs: 1) A trigger node (e.g., Manual Trigger), 2) An action node (e.g., Set, HTTP Request), 3) A connection between them'
      );
    }
  }

  /**
   * Check node-level error handling configuration for a single node
   *
   * Validates error handling properties (onError, continueOnFail, retryOnFail)
   * and provides warnings for error-prone nodes (HTTP, webhooks, databases)
   * that lack proper error handling. Delegates webhook-specific validation
   * to checkWebhookErrorHandling() for clearer logic.
   *
   * @param node - The workflow node to validate
   * @param workflow - The complete workflow for context
   * @param result - Validation result to add errors/warnings to
   * @param profile - Validation profile (advisory warnings fire only under ai-friendly/strict)
   */
  private checkNodeErrorHandling(
    node: WorkflowNode,
    workflow: WorkflowJson,
    result: WorkflowValidationResult,
    profile: string = 'runtime'
  ): void {
    // Only skip if disabled is explicitly true (not just truthy)
    if (node.disabled === true) return;

    // Define node types that typically interact with external services (lowercase for comparison)
    const errorProneNodeTypes = [
      'httprequest',
      'webhook',
      'emailsend',
      'slack',
      'discord',
      'telegram',
      'postgres',
      'mysql',
      'mongodb',
      'redis',
      'github',
      'gitlab',
      'jira',
      'salesforce',
      'hubspot',
      'airtable',
      'googlesheets',
      'googledrive',
      'dropbox',
      's3',
      'ftp',
      'ssh',
      'mqtt',
      'kafka',
      'rabbitmq',
      'graphql',
      'openai',
      'anthropic'
    ];

    const normalizedType = node.type.toLowerCase();
    const isErrorProne = errorProneNodeTypes.some(type => normalizedType.includes(type));

    // CRITICAL: Check for node-level properties in wrong location (inside parameters)
    const nodeLevelProps = [
      // Error handling properties
      'onError', 'continueOnFail', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData',
      // Other node-level properties
      'executeOnce', 'disabled', 'notes', 'notesInFlow', 'credentials'
    ];
    const misplacedProps: string[] = [];
    
    if (node.parameters) {
      for (const prop of nodeLevelProps) {
        if (node.parameters[prop] !== undefined) {
          misplacedProps.push(prop);
        }
      }
    }
    
    if (misplacedProps.length > 0) {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: `Node-level properties ${misplacedProps.join(', ')} are in the wrong location. They must be at the node level, not inside parameters.`,
          details: {
            fix: `Move these properties from node.parameters to the node level. Example:\n` +
                 `{\n` +
                 `  "name": "${node.name}",\n` +
                 `  "type": "${node.type}",\n` +
                 `  "parameters": { /* operation-specific params */ },\n` +
                 `  "onError": "continueErrorOutput",  // ✅ Correct location\n` +
                 `  "retryOnFail": true,               // ✅ Correct location\n` +
                 `  "executeOnce": true,               // ✅ Correct location\n` +
                 `  "disabled": false,                 // ✅ Correct location\n` +
                 `  "credentials": { /* ... */ }       // ✅ Correct location\n` +
                 `}`
          }
        });
    }

    // Validate error handling properties
    
    // Check for onError property (the modern approach)
    if (node.onError !== undefined) {
        const validOnErrorValues = ['continueRegularOutput', 'continueErrorOutput', 'stopWorkflow'];
        if (!validOnErrorValues.includes(node.onError)) {
          result.errors.push({
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Invalid onError value: "${node.onError}". Must be one of: ${validOnErrorValues.join(', ')}`
          });
        }
    }

    // Check for deprecated continueOnFail
    if (node.continueOnFail !== undefined) {
        if (typeof node.continueOnFail !== 'boolean') {
          result.errors.push({
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: 'continueOnFail must be a boolean value'
          });
        } else if (node.continueOnFail === true) {
          // Warn about using deprecated property
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: 'Using deprecated "continueOnFail: true". Use "onError: \'continueRegularOutput\'" instead for better control and UI compatibility.'
          });
        }
    }

    // Check for conflicting error handling properties
    if (node.continueOnFail !== undefined && node.onError !== undefined) {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'Cannot use both "continueOnFail" and "onError" properties. Use only "onError" for modern workflows.'
        });
    }

    if (node.retryOnFail !== undefined) {
        if (typeof node.retryOnFail !== 'boolean') {
          result.errors.push({
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: 'retryOnFail must be a boolean value'
          });
        }

        // If retry is enabled, check retry configuration. An absent maxTries
        // simply means the documented default of 3 — not worth a finding.
        if (node.retryOnFail === true) {
          if (node.maxTries !== undefined) {
            if (typeof node.maxTries !== 'number' || node.maxTries < 1) {
              result.errors.push({
                type: 'error',
                nodeId: node.id,
                nodeName: node.name,
                message: 'maxTries must be a positive number when retryOnFail is enabled'
              });
            } else if (node.maxTries > 10) {
              result.warnings.push({
                type: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `maxTries is set to ${node.maxTries}. Consider if this many retries is necessary.`
              });
            }
          }

          if (node.waitBetweenTries !== undefined) {
            if (typeof node.waitBetweenTries !== 'number' || node.waitBetweenTries < 0) {
              result.errors.push({
                type: 'error',
                nodeId: node.id,
                nodeName: node.name,
                message: 'waitBetweenTries must be a non-negative number (milliseconds)'
              });
            } else if (node.waitBetweenTries > 300000) { // 5 minutes
              result.warnings.push({
                type: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `waitBetweenTries is set to ${node.waitBetweenTries}ms (${(node.waitBetweenTries/1000).toFixed(1)}s). This seems excessive.`
              });
            }
          }
        }
    }

    if (node.alwaysOutputData !== undefined && typeof node.alwaysOutputData !== 'boolean') {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'alwaysOutputData must be a boolean value'
        });
    }

    // Advisory warnings for error-prone nodes without error handling.
    // Fail-loud defaults are a valid choice, so these only fire in the
    // advisory profiles. onError applies to main-branch execution only, so
    // AI sub-nodes/Tool variants (no main output) and non-webhook triggers
    // are skipped. The branches are exclusive: one warning per node at most.
    // onError: 'stopWorkflow' is n8n's fail-loud default, not error handling
    // (consistent with workflowHasErrorHandling)
    const hasErrorHandling = (node.onError && node.onError !== 'stopWorkflow') ||
      node.continueOnFail || node.retryOnFail;
    const advisoryProfile = this.isAdvisoryProfile(profile);

    if (isErrorProne && !hasErrorHandling && advisoryProfile) {
        const nodeTypeSimple = normalizedType.split('.').pop() || normalizedType;

        // Special handling for specific node types
        if (normalizedType.includes('webhook')) {
          // Delegate to specialized webhook validation helper (webhooks are
          // triggers, so this must run before the trigger skip below)
          this.checkWebhookErrorHandling(node, normalizedType, result);
        } else if (!this.nodeExecutesOnMainBranch(node) || isTriggerNode(node.type)) {
          // onError is meaningless here — no advisory
        } else if (normalizedType.includes('httprequest')) {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: 'HTTP Request node without error handling. Consider adding "onError: \'continueRegularOutput\'" for non-critical requests or "retryOnFail: true" for transient failures.'
          });
        } else if (errorProneNodeTypes.some(db => normalizedType.includes(db) && ['postgres', 'mysql', 'mongodb'].includes(db))) {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `Database operation without error handling. Consider adding "retryOnFail: true" for connection issues or "onError: \'continueRegularOutput\'" for non-critical queries.`
          });
        } else {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `${nodeTypeSimple} node without error handling. Consider using "onError" property for better error management.`
          });
        }
    }

    // Informational: both flags together is a defined, benign combination
    if (node.continueOnFail && node.retryOnFail) {
        result.suggestions.push(
          `Node "${node.name}": both continueOnFail and retryOnFail are enabled. The node will retry first, then continue on failure.`
        );
    }

    // Validate additional node-level properties
    
    // Check executeOnce
    if (node.executeOnce !== undefined && typeof node.executeOnce !== 'boolean') {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'executeOnce must be a boolean value'
        });
    }

    // Check disabled
    if (node.disabled !== undefined && typeof node.disabled !== 'boolean') {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'disabled must be a boolean value'
        });
    }

    // Check notesInFlow
    if (node.notesInFlow !== undefined && typeof node.notesInFlow !== 'boolean') {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'notesInFlow must be a boolean value'
        });
    }

    // Check notes
    if (node.notes !== undefined && typeof node.notes !== 'string') {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'notes must be a string value'
        });
    }

    // Provide guidance for executeOnce
    if (node.executeOnce === true) {
        result.warnings.push({
          type: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: 'executeOnce is enabled. This node will execute only once regardless of input items.'
        });
    }

    // Suggest alwaysOutputData for debugging
    if ((node.continueOnFail || node.retryOnFail) && !node.alwaysOutputData) {
        if (normalizedType.includes('httprequest') || normalizedType.includes('webhook')) {
          result.suggestions.push(
            `Consider enabling alwaysOutputData on "${node.name}" to capture error responses for debugging`
          );
        }
      }

  }

  /**
   * Check webhook-specific error handling requirements
   *
   * Webhooks have special error handling behavior:
   * - respondToWebhook nodes (response nodes) don't need error handling
   * - Webhook nodes with responseNode mode need nothing: n8n auto-returns 500
   *   when the workflow errors before the Respond to Webhook node
   * - Regular webhook nodes should have error handling to prevent blocking
   *
   * @param node - The webhook node to check
   * @param normalizedType - Normalized node type for comparison
   * @param result - Validation result to add errors/warnings to
   */
  private checkWebhookErrorHandling(
    node: WorkflowNode,
    normalizedType: string,
    result: WorkflowValidationResult
  ): void {
    // respondToWebhook nodes are response nodes (endpoints), not triggers
    // They're the END of execution, not controllers of flow - skip error handling check
    if (normalizedType.includes('respondtowebhook')) {
      return;
    }

    // responseNode mode needs no onError: n8n automatically returns a 500 if
    // the workflow errors before a Respond to Webhook node executes, and
    // onError on the trigger has no effect on downstream failures.
    if (node.parameters?.responseMode === 'responseNode') {
      return;
    }

    // Regular webhook nodes without responseNode mode
    result.warnings.push({
      type: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      message: 'Webhook node without error handling. Consider adding "onError: \'continueRegularOutput\'" to prevent workflow failures from blocking webhook responses.'
    });
  }

  /**
   * Generate error handling suggestions based on all nodes
   */
  private generateErrorHandlingSuggestions(
    workflow: WorkflowJson,
    result: WorkflowValidationResult
  ): void {
    // Add general suggestions based on findings
    const nodesWithoutErrorHandling = workflow.nodes.filter(n => 
      !n.disabled && !n.onError && !n.continueOnFail && !n.retryOnFail
    ).length;

    if (nodesWithoutErrorHandling > 5 && workflow.nodes.length > 5) {
      result.suggestions.push(
        'Most nodes lack error handling. Use "onError" property for modern error handling: "continueRegularOutput" (continue on error), "continueErrorOutput" (use error output), or "stopWorkflow" (stop execution).'
      );
    }

    // Check for nodes using deprecated continueOnFail
    const nodesWithDeprecatedErrorHandling = workflow.nodes.filter(n => 
      !n.disabled && n.continueOnFail === true
    ).length;

    if (nodesWithDeprecatedErrorHandling > 0) {
      result.suggestions.push(
        'Replace "continueOnFail: true" with "onError: \'continueRegularOutput\'" for better UI compatibility and control.'
      );
    }
  }

  /**
   * Validate SplitInBatches node connections for common mistakes
   */
  private validateSplitInBatchesConnection(
    sourceNode: WorkflowNode,
    outputIndex: number,
    connection: { node: string; type: string; index: number },
    nodeMap: Map<string, WorkflowNode>,
    result: WorkflowValidationResult
  ): void {
    const targetNode = nodeMap.get(connection.node);
    if (!targetNode) return;

    // Check if connections appear to be reversed
    // Output 0 = "done", Output 1 = "loop"
    
    if (outputIndex === 0) {
      // This is the "done" output (index 0)
      // Check if target looks like it should be in the loop
      const targetType = targetNode.type.toLowerCase();
      const targetName = targetNode.name.toLowerCase();
      
      // Common patterns that suggest this node should be inside the loop
      if (targetType.includes('function') || 
          targetType.includes('code') ||
          targetType.includes('item') ||
          targetName.includes('process') ||
          targetName.includes('transform') ||
          targetName.includes('handle')) {
        
        // Check if this node connects back to the SplitInBatches
        const hasLoopBack = this.checkForLoopBack(targetNode.name, sourceNode.name, nodeMap);
        
        if (hasLoopBack) {
          result.errors.push({
            type: 'error',
            nodeId: sourceNode.id,
            nodeName: sourceNode.name,
            message: `SplitInBatches outputs appear reversed! Node "${targetNode.name}" is connected to output 0 ("done") but connects back to the loop. It should be connected to output 1 ("loop") instead. Remember: Output 0 = "done" (post-loop), Output 1 = "loop" (inside loop).`
          });
        } else {
          result.warnings.push({
            type: 'warning',
            nodeId: sourceNode.id,
            nodeName: sourceNode.name,
            message: `Node "${targetNode.name}" is connected to the "done" output (index 0) but appears to be a processing node. Consider connecting it to the "loop" output (index 1) if it should process items inside the loop.`
          });
        }
      }
    } else if (outputIndex === 1) {
      // This is the "loop" output (index 1)
      // Check if target looks like it should be after the loop
      const targetType = targetNode.type.toLowerCase();
      const targetName = targetNode.name.toLowerCase();
      
      // Common patterns that suggest this node should be after the loop
      if (targetType.includes('aggregate') ||
          targetType.includes('merge') ||
          targetType.includes('email') ||
          targetType.includes('slack') ||
          targetName.includes('final') ||
          targetName.includes('complete') ||
          targetName.includes('summary') ||
          targetName.includes('report')) {
        
        result.warnings.push({
          type: 'warning',
          nodeId: sourceNode.id,
          nodeName: sourceNode.name,
          message: `Node "${targetNode.name}" is connected to the "loop" output (index 1) but appears to be a post-processing node. Consider connecting it to the "done" output (index 0) if it should run after all iterations complete.`
        });
      }
      
      // Check if loop output doesn't eventually connect back
      const hasLoopBack = this.checkForLoopBack(targetNode.name, sourceNode.name, nodeMap);
      if (!hasLoopBack) {
        result.warnings.push({
          type: 'warning',
          nodeId: sourceNode.id,
          nodeName: sourceNode.name,
          message: `The "loop" output connects to "${targetNode.name}" but doesn't connect back to the SplitInBatches node. The last node in the loop should connect back to complete the iteration.`
        });
      }
    }
  }

  /**
   * Check if a node eventually connects back to a target node
   */
  private checkForLoopBack(
    startNode: string,
    targetNode: string,
    nodeMap: Map<string, WorkflowNode>,
    visited: Set<string> = new Set(),
    maxDepth: number = 50
  ): boolean {
    if (maxDepth <= 0) return false; // Prevent stack overflow
    if (visited.has(startNode)) return false;
    visited.add(startNode);

    const node = nodeMap.get(startNode);
    if (!node) return false;

    // Access connections from the workflow structure, not the node
    // We need to access this.currentWorkflow.connections[startNode]
    const connections = (this as any).currentWorkflow?.connections[startNode];
    if (!connections) return false;

    for (const [outputType, outputs] of Object.entries(connections)) {
      if (!Array.isArray(outputs)) continue;
      
      for (const outputConnections of outputs) {
        if (!Array.isArray(outputConnections)) continue;
        
        for (const conn of outputConnections) {
          if (conn.node === targetNode) {
            return true;
          }
          
          // Recursively check connected nodes
          if (this.checkForLoopBack(conn.node, targetNode, nodeMap, visited, maxDepth - 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Add AI-specific error recovery suggestions
   */
  private addErrorRecoverySuggestions(result: WorkflowValidationResult): void {
    // Categorize errors and provide specific recovery actions
    const errorTypes = {
      nodeType: result.errors.filter(e => e.message.includes('node type') || e.message.includes('Node type')),
      connection: result.errors.filter(e => e.message.includes('connection') || e.message.includes('Connection')),
      structure: result.errors.filter(e => e.message.includes('structure') || e.message.includes('nodes must be')),
      configuration: result.errors.filter(e => e.message.includes('property') || e.message.includes('field')),
      typeVersion: result.errors.filter(e => e.message.includes('typeVersion'))
    };

    // Add recovery suggestions based on error types
    if (errorTypes.nodeType.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Invalid node types detected. Use these patterns:',
        '   • For core nodes: "n8n-nodes-base.nodeName" (e.g., "n8n-nodes-base.webhook")',
        '   • For AI nodes: "@n8n/n8n-nodes-langchain.nodeName"',
        '   • Never use just the node name without package prefix'
      );
    }

    if (errorTypes.connection.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Connection errors detected. Fix with:',
        '   • Use node NAMES in connections, not IDs or types',
        '   • Structure: { "Source Node Name": { "main": [[{ "node": "Target Node Name", "type": "main", "index": 0 }]] } }',
        '   • Ensure all referenced nodes exist in the workflow'
      );
    }

    if (errorTypes.structure.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Workflow structure errors. Fix with:',
        '   • Ensure "nodes" is an array: "nodes": [...]',
        '   • Ensure "connections" is an object: "connections": {...}',
        '   • Add at least one node to create a valid workflow'
      );
    }

    if (errorTypes.configuration.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: Node configuration errors. Fix with:',
        "   • Check required fields using validate_node with mode='minimal' first",
        '   • Use get_node to see what fields are needed',
        '   • Ensure operation-specific fields match the node\'s requirements'
      );
    }

    if (errorTypes.typeVersion.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: TypeVersion errors. Fix with:',
        '   • Add "typeVersion": 1 (or latest version) to each node',
        '   • Use get_node to check the correct version for each node type'
      );
    }

    // Add general recovery workflow
    if (result.errors.length > 3) {
      result.suggestions.push(
        '📋 SUGGESTED WORKFLOW: Too many errors detected. Try this approach:',
        '   1. Fix structural issues first (nodes array, connections object)',
        '   2. Validate node types and fix invalid ones',
        '   3. Add required typeVersion to all nodes',
        '   4. Test connections step by step',
        "   5. Use validate_node with mode='minimal' on individual nodes to verify configuration"
      );
    }
  }
}