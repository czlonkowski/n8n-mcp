/**
 * Workflow Validator for n8n workflows
 * Validates complete workflow structure, connections, and node configurations
 */

import crypto from 'crypto';
import { NodeRepository } from '../database/node-repository';
import { EnhancedConfigValidator } from './enhanced-config-validator';
import { ExpressionValidator } from './expression-validator';
import { extractBracketExpressions } from '../utils/expression-utils';
import { ExpressionFormatValidator } from './expression-format-validator';
import { NodeSimilarityService, NodeSuggestion } from './node-similarity-service';
import { NodeTypeNormalizer } from '../utils/node-type-normalizer';
import { Logger } from '../utils/logger';
import { validateAISpecificNodes, hasAINodes, AI_CONNECTION_TYPES } from './ai-node-validator';
import { isAIToolSubNode } from './ai-tool-validators';
import { isTriggerNode } from '../utils/node-type-utils';
import { isNonExecutableNode } from '../utils/node-classification';
import { validateConditionNodeStructure } from './n8n-validation';
import { ToolVariantGenerator } from './tool-variant-generator';
const logger = new Logger({ prefix: '[WorkflowValidator]' });

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
          // Convert AI validation issues to workflow validation format
          for (const issue of aiIssues) {
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
        this.generateSuggestions(workflow, result);

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

      if (nodeIds.has(node.id)) {
        const firstNodeIndex = nodeIdToIndex.get(node.id);
        const firstNode = firstNodeIndex !== undefined ? workflow.nodes[firstNodeIndex] : undefined;

        result.errors.push({
          type: 'error',
          nodeId: node.id,
          message: `Duplicate node ID: "${node.id}". Node at index ${i} (name: "${node.name}", type: "${node.type}") conflicts with node at index ${firstNodeIndex} (name: "${firstNode?.name || 'unknown'}", type: "${firstNode?.type || 'unknown'}"). Each node must have a unique ID. Generate a new UUID using crypto.randomUUID() - Example: {id: "${crypto.randomUUID()}", name: "${node.name}", type: "${node.type}", ...}`
        });
      } else {
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
              // Valid inferred tool variant - base node exists
              result.warnings.push({
                type: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `Node type "${node.type}" is inferred as a dynamic AI Tool variant of "${baseNodeType}". ` +
                  `This Tool variant is created by n8n at runtime when connecting "${baseNodeInfo.displayName}" to an AI Agent.`,
                code: 'INFERRED_TOOL_VARIANT'
              });

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

          let message = `Unknown node type: "${node.type}".`;

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
          } else {
            message += ' No similar nodes found. Node types must include the package prefix (e.g., "n8n-nodes-base.webhook").';
          }

          const error: any = {
            type: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message
          };

          // Add suggestions as metadata for programmatic access
          if (suggestions.length > 0) {
            error.suggestions = suggestions.map(s => ({
              nodeType: s.nodeType,
              confidence: s.confidence,
              reason: s.reason
            }));
          }

          result.errors.push(error);
          continue;
        }

        // Validate typeVersion for ALL versioned nodes (including langchain nodes)
        // CRITICAL: This MUST run BEFORE the langchain skip below!
        // Otherwise, langchain nodes with invalid typeVersion (e.g., 99999) would pass validation
        // but fail at runtime in n8n. This was the bug fixed in v2.17.4.
        if (nodeInfo.isVersioned) {
          // Check if typeVersion is missing
          if (!node.typeVersion) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: `Missing required property 'typeVersion'. Add typeVersion: ${nodeInfo.version || 1}`
            });
          }
          // Check if typeVersion is invalid (must be non-negative number, version 0 is valid)
          else if (typeof node.typeVersion !== 'number' || node.typeVersion < 0) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: `Invalid typeVersion: ${node.typeVersion}. Must be a non-negative number`
            });
          }
          // Check if typeVersion is outdated (less than latest)
          else if (nodeInfo.version && node.typeVersion < nodeInfo.version) {
            result.warnings.push({
              type: 'warning',
              nodeId: node.id,
              nodeName: node.name,
              message: `Outdated typeVersion: ${node.typeVersion}. Latest is ${nodeInfo.version}`
            });
          }
          // Check if typeVersion exceeds maximum supported
          else if (nodeInfo.version && node.typeVersion > nodeInfo.version) {
            result.errors.push({
              type: 'error',
              nodeId: node.id,
              nodeName: node.name,
              message: `typeVersion ${node.typeVersion} exceeds maximum supported version ${nodeInfo.version}`
            });
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
          outputKey
        );
      }
    }

    // Trigger reachability analysis: BFS from all triggers to find unreachable nodes
    if (profile !== 'minimal') {
      this.validateTriggerReachability(workflow, result);
    } else {
      this.flagOrphanedNodes(workflow, result);
    }

    // Check for cycles (skip in minimal profile to reduce false positives)
    if (profile !== 'minimal' && this.hasCycle(workflow)) {
      result.errors.push({
        type: 'error',
        message: 'Workflow contains a cycle (infinite loop)'
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
    outputType: string
  ): void {
    // Get source node for special validation
    const sourceNode = nodeMap.get(sourceName);

    // Main-output-specific validation: error handling config and index bounds
    if (outputType === 'main' && sourceNode) {
      this.validateErrorOutputConfiguration(sourceName, sourceNode, outputs, nodeMap, result);
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
    result: WorkflowValidationResult
  ): void {
    // Check if node has onError: 'continueErrorOutput'
    const hasErrorOutputSetting = sourceNode.onError === 'continueErrorOutput';
    const hasErrorConnections = outputs.length > 1 && outputs[1] && outputs[1].length > 0;

    // Validate mismatch between onError setting and connections
    if (hasErrorOutputSetting && !hasErrorConnections) {
      result.errors.push({
        type: 'error',
        nodeId: sourceNode.id,
        nodeName: sourceNode.name,
        message: `Node has onError: 'continueErrorOutput' but no error output connections in main[1]. Add error handler connections to main[1] or change onError to 'continueRegularOutput' or 'stopWorkflow'.`
      });
    }

    if (!hasErrorOutputSetting && hasErrorConnections) {
      result.warnings.push({
        type: 'warning',
        nodeId: sourceNode.id,
        nodeName: sourceNode.name,
        message: `Node has error output connections in main[1] but missing onError: 'continueErrorOutput'. Add this property to properly handle errors.`
      });
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
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(sourceNode.type);
    const nodeInfo = this.nodeRepository.getNode(normalizedType);
    if (!nodeInfo || !nodeInfo.outputs) return;

    // Count main outputs from node description
    let mainOutputCount: number;
    if (Array.isArray(nodeInfo.outputs)) {
      // outputs can be strings like "main" or objects with { type: "main" }
      mainOutputCount = nodeInfo.outputs.filter((o: any) =>
        typeof o === 'string' ? o === 'main' : (o.type === 'main' || !o.type)
      ).length;
    } else {
      return; // Dynamic outputs (expression string), skip check
    }

    if (mainOutputCount === 0) return;

    // Override with dynamic output counts for conditional nodes
    const conditionalInfo = this.getConditionalOutputInfo(sourceNode);
    if (conditionalInfo) {
      mainOutputCount = conditionalInfo.expectedOutputs;
    } else if (this.getShortNodeType(sourceNode) === 'switch') {
      // Switch without determinable rules -- skip bounds check
      return;
    }

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

    // Merge/CompareDatasets: read dynamic numberInputs parameter (defaults to 2)
    if (shortType === 'merge' || shortType === 'compareDatasets') {
      const rawInputs = targetNode.parameters?.numberInputs;
      const parsed = rawInputs ? Number(rawInputs) : 2;
      const mainInputCount = Number.isFinite(parsed) ? parsed : 2;

      if (connection.index >= mainInputCount) {
        result.errors.push({
          type: 'error',
          nodeName: targetNode.name,
          message: `Input index ${connection.index} on node "${targetNode.name}" exceeds its input count (${mainInputCount}). ` +
            `Connection from "${sourceName}" targets input ${connection.index}, but this node has ${mainInputCount} main input(s) (indices 0-${mainInputCount - 1}).`,
          code: 'INPUT_INDEX_OUT_OF_BOUNDS'
        });
        result.statistics.invalidConnections++;
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
    // Build adjacency list (forward direction)
    const adjacency = new Map<string, Set<string>>();
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      if (!adjacency.has(sourceName)) adjacency.set(sourceName, new Set());
      for (const outputConns of Object.values(outputs)) {
        if (Array.isArray(outputConns)) {
          for (const conns of outputConns) {
            if (!conns) continue;
            for (const conn of conns) {
              if (conn) {
                adjacency.get(sourceName)!.add(conn.node);
                // Also track that the target exists in the graph
                if (!adjacency.has(conn.node)) adjacency.set(conn.node, new Set());
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
   * Check if workflow has cycles
   * Allow legitimate loops for SplitInBatches and similar loop nodes
   */
  private hasCycle(workflow: WorkflowJson): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const nodeTypeMap = new Map<string, string>();
    
    // Build node type map (exclude sticky notes)
    workflow.nodes.forEach(node => {
      if (!isNonExecutableNode(node.type)) {
        nodeTypeMap.set(node.name, node.type);
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
    ];

    const hasCycleDFS = (nodeName: string, pathFromLoopNode: boolean = false, pathFromConditionalNode: boolean = false): boolean => {
      visited.add(nodeName);
      recursionStack.add(nodeName);

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

        const currentNodeType = nodeTypeMap.get(nodeName);
        const isLoopNode = loopNodeTypes.includes(currentNodeType || '');
        const isConditionalNode = conditionalNodeTypes.includes(currentNodeType || '');

        for (const target of allTargets) {
          if (!visited.has(target)) {
            if (hasCycleDFS(target, pathFromLoopNode || isLoopNode, pathFromConditionalNode || isConditionalNode)) return true;
          } else if (recursionStack.has(target)) {
            // Allow cycles that involve legitimate loop nodes
            const targetNodeType = nodeTypeMap.get(target);
            const isTargetLoopNode = loopNodeTypes.includes(targetNodeType || '');

            // Allow cycles involving loop nodes or conditional exit nodes (IF/Switch/Filter)
            if (isTargetLoopNode || pathFromLoopNode || isLoopNode || pathFromConditionalNode || isConditionalNode) {
              continue; // Allow this cycle
            }

            return true; // Reject other cycles
          }
        }
      }

      recursionStack.delete(nodeName);
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

      const formatIssues = ExpressionFormatValidator.validateNodeParameters(
        node.parameters,
        formatContext
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
    // Check for error handling (n8n uses main[1] for error outputs, not outputs.error)
    const hasErrorHandling = Object.values(workflow.connections).some(
      outputs => outputs.main && outputs.main.length > 1 && outputs.main[1] && outputs.main[1].length > 0
    );

    // Only suggest error handling in stricter profiles
    if (!hasErrorHandling && workflow.nodes.length > 3 && profile !== 'minimal') {
      result.warnings.push({
        type: 'warning',
        message: 'Consider adding error handling to your workflow'
      });
    }

    // Check node-level error handling properties for ALL executable nodes
    for (const node of workflow.nodes) {
      if (!isNonExecutableNode(node.type)) {
        this.checkNodeErrorHandling(node, workflow, result);
      }
    }

    // Check for very long linear workflows
    const linearChainLength = this.getLongestLinearChain(workflow);
    if (linearChainLength > 10) {
      result.warnings.push({
        type: 'warning',
        message: `Long linear chain detected (${linearChainLength} nodes). Consider breaking into sub-workflows.`
      });
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

    // Check for AI Agent workflows
    const aiAgentNodes = workflow.nodes.filter(n =>
      n.type.toLowerCase().includes('agent') ||
      n.type.includes('langchain.agent')
    );

    if (aiAgentNodes.length > 0) {
      // Check if AI agents have tools connected
      // Tools connect TO the agent, so we need to find connections where the target is the agent
      for (const agentNode of aiAgentNodes) {
        // Search all connections to find ones targeting this agent via ai_tool
        const hasToolConnected = Object.values(workflow.connections).some(sourceOutputs => {
          const aiToolConnections = sourceOutputs.ai_tool;
          if (!aiToolConnections) return false;
          return aiToolConnections.flat().some(conn => conn && conn.node === agentNode.name);
        });

        if (!hasToolConnected) {
          result.warnings.push({
            type: 'warning',
            nodeId: agentNode.id,
            nodeName: agentNode.name,
            message: 'AI Agent has no tools connected. Consider adding tools to enhance agent capabilities.'
          });
        }
      }
      
      // Check for community nodes used as tools
      const hasAIToolConnections = Object.values(workflow.connections).some(
        outputs => outputs.ai_tool && outputs.ai_tool.length > 0
      );
      
      if (hasAIToolConnections) {
        result.suggestions.push(
          'For community nodes used as AI tools, ensure N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true is set'
        );
      }
    }
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
    result: WorkflowValidationResult
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

    // Suggest error handling
    if (!Object.values(workflow.connections).some(o => o.error)) {
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
   */
  private checkNodeErrorHandling(
    node: WorkflowNode,
    workflow: WorkflowJson,
    result: WorkflowValidationResult
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

        // If retry is enabled, check retry configuration
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
          } else {
            // maxTries defaults to 3 if not specified
            result.warnings.push({
              type: 'warning',
              nodeId: node.id,
              nodeName: node.name,
              message: 'retryOnFail is enabled but maxTries is not specified. Default is 3 attempts.'
            });
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

    // Warnings for error-prone nodes without error handling
    const hasErrorHandling = node.onError || node.continueOnFail || node.retryOnFail;
    
    if (isErrorProne && !hasErrorHandling) {
        const nodeTypeSimple = normalizedType.split('.').pop() || normalizedType;
        
        // Special handling for specific node types
        if (normalizedType.includes('httprequest')) {
          result.warnings.push({
            type: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: 'HTTP Request node without error handling. Consider adding "onError: \'continueRegularOutput\'" for non-critical requests or "retryOnFail: true" for transient failures.'
          });
        } else if (normalizedType.includes('webhook')) {
          // Delegate to specialized webhook validation helper
          this.checkWebhookErrorHandling(node, normalizedType, result);
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

    // Check for problematic combinations
    if (node.continueOnFail && node.retryOnFail) {
        result.warnings.push({
          type: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: 'Both continueOnFail and retryOnFail are enabled. The node will retry first, then continue on failure.'
        });
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
   * Webhooks have special error handling requirements:
   * - respondToWebhook nodes (response nodes) don't need error handling
   * - Webhook nodes with responseNode mode REQUIRE onError to ensure responses
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

    // Check for responseNode mode specifically
    // responseNode mode requires onError to ensure response is sent even on error
    if (node.parameters?.responseMode === 'responseNode') {
      if (!node.onError && !node.continueOnFail) {
        result.errors.push({
          type: 'error',
          nodeId: node.id,
          nodeName: node.name,
          message: 'responseNode mode requires onError: "continueRegularOutput"'
        });
      }
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
        '   • Check required fields using validate_node_minimal first',
        '   • Use get_node_essentials to see what fields are needed',
        '   • Ensure operation-specific fields match the node\'s requirements'
      );
    }

    if (errorTypes.typeVersion.length > 0) {
      result.suggestions.unshift(
        '🔧 RECOVERY: TypeVersion errors. Fix with:',
        '   • Add "typeVersion": 1 (or latest version) to each node',
        '   • Use get_node_info to check the correct version for each node type'
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
        '   5. Use validate_node_minimal on individual nodes to verify configuration'
      );
    }
  }
}