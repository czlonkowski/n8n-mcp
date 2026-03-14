/**
 * Workflow Diff Engine
 * Applies diff operations to n8n workflows
 */

import { v4 as uuidv4 } from 'uuid';
import {
  WorkflowDiffOperation,
  WorkflowDiffRequest,
  WorkflowDiffResult,
  WorkflowDiffValidationError,
  isNodeOperation,
  isConnectionOperation,
  isMetadataOperation,
  AddNodeOperation,
  RemoveNodeOperation,
  UpdateNodeOperation,
  MoveNodeOperation,
  EnableNodeOperation,
  DisableNodeOperation,
  AddConnectionOperation,
  RemoveConnectionOperation,
  RewireConnectionOperation,
  UpdateSettingsOperation,
  UpdateNameOperation,
  AddTagOperation,
  RemoveTagOperation,
  ActivateWorkflowOperation,
  DeactivateWorkflowOperation,
  CleanStaleConnectionsOperation,
  ReplaceConnectionsOperation
} from '../types/workflow-diff';
import { Workflow, WorkflowNode, WorkflowConnection } from '../types/n8n-api';
import { Logger } from '../utils/logger';
import { validateWorkflowNode, validateWorkflowConnections } from './n8n-validation';
import { sanitizeNode, sanitizeWorkflowNodes } from './node-sanitizer';
import { isActivatableTrigger } from '../utils/node-type-utils';

const logger = new Logger({ prefix: '[WorkflowDiffEngine]' });

/**
 * Not safe for concurrent use — create a new instance per request.
 * Instance state is reset at the start of each applyDiff() call.
 */
export class WorkflowDiffEngine {
  // Track node name changes during operations for connection reference updates
  private renameMap: Map<string, string> = new Map();
  // Track warnings during operation processing
  private warnings: WorkflowDiffValidationError[] = [];
  // Track which nodes were added/updated so sanitization only runs on them
  private modifiedNodeIds = new Set<string>();
  // Track removed node names for better error messages
  private removedNodeNames = new Set<string>();
  // Track tag operations for dedicated API calls
  private tagsToAdd: string[] = [];
  private tagsToRemove: string[] = [];

  /**
   * Apply diff operations to a workflow
   */
  async applyDiff(
    workflow: Workflow,
    request: WorkflowDiffRequest
  ): Promise<WorkflowDiffResult> {
    try {
      // Reset tracking for this diff operation
      this.renameMap.clear();
      this.warnings = [];
      this.modifiedNodeIds.clear();
      this.removedNodeNames.clear();
      this.tagsToAdd = [];
      this.tagsToRemove = [];

      // Clone workflow to avoid modifying original
      const workflowCopy = JSON.parse(JSON.stringify(workflow));

      // Group operations by type for two-pass processing
      const nodeOperationTypes = ['addNode', 'removeNode', 'updateNode', 'moveNode', 'enableNode', 'disableNode'];
      const nodeOperations: Array<{ operation: WorkflowDiffOperation; index: number }> = [];
      const otherOperations: Array<{ operation: WorkflowDiffOperation; index: number }> = [];

      request.operations.forEach((operation, index) => {
        if (nodeOperationTypes.includes(operation.type)) {
          nodeOperations.push({ operation, index });
        } else {
          otherOperations.push({ operation, index });
        }
      });

      const allOperations = [...nodeOperations, ...otherOperations];
      const errors: WorkflowDiffValidationError[] = [];
      const appliedIndices: number[] = [];
      const failedIndices: number[] = [];

      // Process based on mode
      if (request.continueOnError) {
        // Best-effort mode: continue even if some operations fail
        for (const { operation, index } of allOperations) {
          const error = this.validateOperation(workflowCopy, operation);
          if (error) {
            errors.push({
              operation: index,
              message: error,
              details: operation
            });
            failedIndices.push(index);
            continue;
          }

          try {
            this.applyOperation(workflowCopy, operation);
            appliedIndices.push(index);
          } catch (error) {
            const errorMsg = `Failed to apply operation: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push({
              operation: index,
              message: errorMsg,
              details: operation
            });
            failedIndices.push(index);
          }
        }

        // Update connection references after all node renames (even in continueOnError mode)
        if (this.renameMap.size > 0 && appliedIndices.length > 0) {
          this.updateConnectionReferences(workflowCopy);
          logger.debug(`Auto-updated ${this.renameMap.size} node name references in connections (continueOnError mode)`);
        }

        // If validateOnly flag is set, return success without applying
        if (request.validateOnly) {
          return {
            success: errors.length === 0,
            message: errors.length === 0
              ? 'Validation successful. All operations are valid.'
              : `Validation completed with ${errors.length} errors.`,
            errors: errors.length > 0 ? errors : undefined,
            warnings: this.warnings.length > 0 ? this.warnings : undefined,
            applied: appliedIndices,
            failed: failedIndices
          };
        }

        const success = appliedIndices.length > 0;
        return {
          success,
          workflow: workflowCopy,
          operationsApplied: appliedIndices.length,
          message: `Applied ${appliedIndices.length} operations, ${failedIndices.length} failed (continueOnError mode)`,
          errors: errors.length > 0 ? errors : undefined,
          warnings: this.warnings.length > 0 ? this.warnings : undefined,
          applied: appliedIndices,
          failed: failedIndices,
          tagsToAdd: this.tagsToAdd.length > 0 ? this.tagsToAdd : undefined,
          tagsToRemove: this.tagsToRemove.length > 0 ? this.tagsToRemove : undefined
        };
      } else {
        // Atomic mode: all operations must succeed
        // Pass 1: Validate and apply node operations first
        for (const { operation, index } of nodeOperations) {
          const error = this.validateOperation(workflowCopy, operation);
          if (error) {
            return {
              success: false,
              errors: [{
                operation: index,
                message: error,
                details: operation
              }]
            };
          }

          try {
            this.applyOperation(workflowCopy, operation);
          } catch (error) {
            return {
              success: false,
              errors: [{
                operation: index,
                message: `Failed to apply operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
                details: operation
              }]
            };
          }
        }

        // Update connection references after all node renames
        if (this.renameMap.size > 0) {
          this.updateConnectionReferences(workflowCopy);
          logger.debug(`Auto-updated ${this.renameMap.size} node name references in connections`);
        }

        // Pass 2: Validate and apply other operations (connections, metadata)
        for (const { operation, index } of otherOperations) {
          const error = this.validateOperation(workflowCopy, operation);
          if (error) {
            return {
              success: false,
              errors: [{
                operation: index,
                message: error,
                details: operation
              }]
            };
          }

          try {
            this.applyOperation(workflowCopy, operation);
          } catch (error) {
            return {
              success: false,
              errors: [{
                operation: index,
                message: `Failed to apply operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
                details: operation
              }]
            };
          }
        }

        // Sanitize only modified nodes to avoid breaking unrelated nodes (#592)
        if (this.modifiedNodeIds.size > 0) {
          workflowCopy.nodes = workflowCopy.nodes.map((node: WorkflowNode) => {
            if (this.modifiedNodeIds.has(node.id)) {
              return sanitizeNode(node);
            }
            return node;
          });
          logger.debug(`Sanitized ${this.modifiedNodeIds.size} modified nodes`);
        }

        // If validateOnly flag is set, return success without applying
        if (request.validateOnly) {
          return {
            success: true,
            message: 'Validation successful. Operations are valid but not applied.'
          };
        }

        const operationsApplied = request.operations.length;

        // Extract activation flags from workflow object
        const shouldActivate = (workflowCopy as any)._shouldActivate === true;
        const shouldDeactivate = (workflowCopy as any)._shouldDeactivate === true;

        // Clean up temporary flags
        delete (workflowCopy as any)._shouldActivate;
        delete (workflowCopy as any)._shouldDeactivate;

        return {
          success: true,
          workflow: workflowCopy,
          operationsApplied,
          message: `Successfully applied ${operationsApplied} operations (${nodeOperations.length} node ops, ${otherOperations.length} other ops)`,
          warnings: this.warnings.length > 0 ? this.warnings : undefined,
          shouldActivate: shouldActivate || undefined,
          shouldDeactivate: shouldDeactivate || undefined,
          tagsToAdd: this.tagsToAdd.length > 0 ? this.tagsToAdd : undefined,
          tagsToRemove: this.tagsToRemove.length > 0 ? this.tagsToRemove : undefined
        };
      }
    } catch (error) {
      logger.error('Failed to apply diff', error);
      return {
        success: false,
        errors: [{
          operation: -1,
          message: `Diff engine error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  /**
   * Validate a single operation
   */
  private validateOperation(workflow: Workflow, operation: WorkflowDiffOperation): string | null {
    switch (operation.type) {
      case 'addNode':
        return this.validateAddNode(workflow, operation);
      case 'removeNode':
        return this.validateRemoveNode(workflow, operation);
      case 'updateNode':
        return this.validateUpdateNode(workflow, operation);
      case 'moveNode':
        return this.validateMoveNode(workflow, operation);
      case 'enableNode':
      case 'disableNode':
        return this.validateToggleNode(workflow, operation);
      case 'addConnection':
        return this.validateAddConnection(workflow, operation);
      case 'removeConnection':
        return this.validateRemoveConnection(workflow, operation);
      case 'rewireConnection':
        return this.validateRewireConnection(workflow, operation as RewireConnectionOperation);
      case 'updateSettings':
      case 'updateName':
      case 'addTag':
      case 'removeTag':
        return null; // These are always valid
      case 'activateWorkflow':
        return this.validateActivateWorkflow(workflow, operation);
      case 'deactivateWorkflow':
        return this.validateDeactivateWorkflow(workflow, operation);
      case 'cleanStaleConnections':
        return this.validateCleanStaleConnections(workflow, operation);
      case 'replaceConnections':
        return this.validateReplaceConnections(workflow, operation);
      default:
        return `Unknown operation type: ${(operation as any).type}`;
    }
  }

  /**
   * Apply a single operation to the workflow
   */
  private applyOperation(workflow: Workflow, operation: WorkflowDiffOperation): void {
    switch (operation.type) {
      case 'addNode':
        this.applyAddNode(workflow, operation);
        break;
      case 'removeNode':
        this.applyRemoveNode(workflow, operation);
        break;
      case 'updateNode':
        this.applyUpdateNode(workflow, operation);
        break;
      case 'moveNode':
        this.applyMoveNode(workflow, operation);
        break;
      case 'enableNode':
        this.applyEnableNode(workflow, operation);
        break;
      case 'disableNode':
        this.applyDisableNode(workflow, operation);
        break;
      case 'addConnection':
        this.applyAddConnection(workflow, operation);
        break;
      case 'removeConnection':
        this.applyRemoveConnection(workflow, operation);
        break;
      case 'rewireConnection':
        this.applyRewireConnection(workflow, operation as RewireConnectionOperation);
        break;
      case 'updateSettings':
        this.applyUpdateSettings(workflow, operation);
        break;
      case 'updateName':
        this.applyUpdateName(workflow, operation);
        break;
      case 'addTag':
        this.applyAddTag(workflow, operation);
        break;
      case 'removeTag':
        this.applyRemoveTag(workflow, operation);
        break;
      case 'activateWorkflow':
        this.applyActivateWorkflow(workflow, operation);
        break;
      case 'deactivateWorkflow':
        this.applyDeactivateWorkflow(workflow, operation);
        break;
      case 'cleanStaleConnections':
        this.applyCleanStaleConnections(workflow, operation);
        break;
      case 'replaceConnections':
        this.applyReplaceConnections(workflow, operation);
        break;
    }
  }

  // Node operation validators
  private validateAddNode(workflow: Workflow, operation: AddNodeOperation): string | null {
    const { node } = operation;

    // Check if node with same name already exists (use normalization to prevent collisions)
    const normalizedNewName = this.normalizeNodeName(node.name);
    const duplicate = workflow.nodes.find(n =>
      this.normalizeNodeName(n.name) === normalizedNewName
    );
    if (duplicate) {
      return `Node with name "${node.name}" already exists (normalized name matches existing node "${duplicate.name}")`;
    }
    
    // Validate node type format
    if (!node.type.includes('.')) {
      return `Invalid node type "${node.type}". Must include package prefix (e.g., "n8n-nodes-base.webhook")`;
    }
    
    if (node.type.startsWith('nodes-base.')) {
      return `Invalid node type "${node.type}". Use "n8n-nodes-base.${node.type.substring(11)}" instead`;
    }
    
    return null;
  }

  private validateRemoveNode(workflow: Workflow, operation: RemoveNodeOperation): string | null {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) {
      return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'removeNode');
    }
    
    // Check if node has connections that would be broken
    const hasConnections = Object.values(workflow.connections).some(conn => {
      return Object.values(conn).some(outputs => 
        outputs.some(connections => 
          connections.some(c => c.node === node.name)
        )
      );
    });
    
    if (hasConnections || workflow.connections[node.name]) {
      // This is a warning, not an error - connections will be cleaned up
      logger.warn(`Removing node "${node.name}" will break existing connections`);
    }
    
    return null;
  }

  private validateUpdateNode(workflow: Workflow, operation: UpdateNodeOperation): string | null {
    // Check for common parameter mistake: "changes" instead of "updates" (Issue #392)
    const operationAny = operation as any;
    if (operationAny.changes && !operation.updates) {
      return `Invalid parameter 'changes'. The updateNode operation requires 'updates' (not 'changes'). Example: {type: "updateNode", nodeId: "abc", updates: {name: "New Name", "parameters.url": "https://example.com"}}`;
    }

    // Check for missing required parameter
    if (!operation.updates) {
      return `Missing required parameter 'updates'. The updateNode operation requires an 'updates' object. Correct structure: {type: "updateNode", nodeId: "abc-123" OR nodeName: "My Node", updates: {name: "New Name", "parameters.url": "https://example.com"}}`;
    }

    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) {
      return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'updateNode');
    }

    // Check for name collision if renaming
    if (operation.updates.name && operation.updates.name !== node.name) {
      const normalizedNewName = this.normalizeNodeName(operation.updates.name);
      const normalizedCurrentName = this.normalizeNodeName(node.name);

      // Only check collision if the names are actually different after normalization
      if (normalizedNewName !== normalizedCurrentName) {
        const collision = workflow.nodes.find(n =>
          n.id !== node.id && this.normalizeNodeName(n.name) === normalizedNewName
        );
        if (collision) {
          return `Cannot rename node "${node.name}" to "${operation.updates.name}": A node with that name already exists (id: ${collision.id.substring(0, 8)}...). Please choose a different name.`;
        }
      }
    }

    return null;
  }

  private validateMoveNode(workflow: Workflow, operation: MoveNodeOperation): string | null {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) {
      return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'moveNode');
    }
    return null;
  }

  private validateToggleNode(workflow: Workflow, operation: EnableNodeOperation | DisableNodeOperation): string | null {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) {
      const operationType = operation.type === 'enableNode' ? 'enableNode' : 'disableNode';
      return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', operationType);
    }
    return null;
  }

  // Connection operation validators
  private validateAddConnection(workflow: Workflow, operation: AddConnectionOperation): string | null {
    // Check for common parameter mistakes (Issue #249)
    const operationAny = operation as any;
    if (operationAny.sourceNodeId || operationAny.targetNodeId) {
      const wrongParams: string[] = [];
      if (operationAny.sourceNodeId) wrongParams.push('sourceNodeId');
      if (operationAny.targetNodeId) wrongParams.push('targetNodeId');

      return `Invalid parameter(s): ${wrongParams.join(', ')}. Use 'source' and 'target' instead. Example: {type: "addConnection", source: "Node Name", target: "Target Name"}`;
    }

    // Check for missing required parameters
    if (!operation.source) {
      return `Missing required parameter 'source'. The addConnection operation requires both 'source' and 'target' parameters. Check that you're using 'source' (not 'sourceNodeId').`;
    }
    if (!operation.target) {
      return `Missing required parameter 'target'. The addConnection operation requires both 'source' and 'target' parameters. Check that you're using 'target' (not 'targetNodeId').`;
    }

    const sourceNode = this.findNode(workflow, operation.source, operation.source);
    const targetNode = this.findNode(workflow, operation.target, operation.target);

    if (!sourceNode) {
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `Source node not found: "${operation.source}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters (apostrophes, quotes).`;
    }
    if (!targetNode) {
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `Target node not found: "${operation.target}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters (apostrophes, quotes).`;
    }

    // Check if connection already exists
    const sourceOutput = operation.sourceOutput || 'main';
    const existing = workflow.connections[sourceNode.name]?.[sourceOutput];
    if (existing) {
      const hasConnection = existing.some(connections =>
        connections.some(c => c.node === targetNode.name)
      );
      if (hasConnection) {
        return `Connection already exists from "${sourceNode.name}" to "${targetNode.name}"`;
      }
    }

    return null;
  }

  private validateRemoveConnection(workflow: Workflow, operation: RemoveConnectionOperation): string | null {
    // If ignoreErrors is true, don't validate - operation will silently succeed even if connection doesn't exist
    if (operation.ignoreErrors) {
      return null;
    }

    const sourceNode = this.findNode(workflow, operation.source, operation.source);
    const targetNode = this.findNode(workflow, operation.target, operation.target);

    if (!sourceNode) {
      if (this.removedNodeNames.has(operation.source)) {
        return `Source node "${operation.source}" was already removed by a prior removeNode operation. Its connections were automatically cleaned up — no separate removeConnection needed.`;
      }
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `Source node not found: "${operation.source}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
    }
    if (!targetNode) {
      if (this.removedNodeNames.has(operation.target)) {
        return `Target node "${operation.target}" was already removed by a prior removeNode operation. Its connections were automatically cleaned up — no separate removeConnection needed.`;
      }
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `Target node not found: "${operation.target}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
    }

    const sourceOutput = operation.sourceOutput || 'main';
    const connections = workflow.connections[sourceNode.name]?.[sourceOutput];
    if (!connections) {
      return `No connections found from "${sourceNode.name}"`;
    }

    const hasConnection = connections.some(conns =>
      conns.some(c => c.node === targetNode.name)
    );

    if (!hasConnection) {
      return `No connection exists from "${sourceNode.name}" to "${targetNode.name}"`;
    }

    return null;
  }

  private validateRewireConnection(workflow: Workflow, operation: RewireConnectionOperation): string | null {
    // Validate source node exists
    const sourceNode = this.findNode(workflow, operation.source, operation.source);
    if (!sourceNode) {
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `Source node not found: "${operation.source}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
    }

    // Validate "from" node exists (current target)
    const fromNode = this.findNode(workflow, operation.from, operation.from);
    if (!fromNode) {
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `"From" node not found: "${operation.from}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
    }

    // Validate "to" node exists (new target)
    const toNode = this.findNode(workflow, operation.to, operation.to);
    if (!toNode) {
      const availableNodes = workflow.nodes
        .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
        .join(', ');
      return `"To" node not found: "${operation.to}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
    }

    // Resolve smart parameters (branch, case) before validating connections
    const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);

    // Validate that connection from source to "from" exists at the specific index
    const connections = workflow.connections[sourceNode.name]?.[sourceOutput];
    if (!connections) {
      return `No connections found from "${sourceNode.name}" on output "${sourceOutput}"`;
    }

    if (!connections[sourceIndex]) {
      return `No connections found from "${sourceNode.name}" on output "${sourceOutput}" at index ${sourceIndex}`;
    }

    const hasConnection = connections[sourceIndex].some(c => c.node === fromNode.name);

    if (!hasConnection) {
      return `No connection exists from "${sourceNode.name}" to "${fromNode.name}" on output "${sourceOutput}" at index ${sourceIndex}"`;
    }

    return null;
  }

  // Node operation appliers
  private applyAddNode(workflow: Workflow, operation: AddNodeOperation): void {
    const newNode: WorkflowNode = {
      id: operation.node.id || uuidv4(),
      name: operation.node.name,
      type: operation.node.type,
      typeVersion: operation.node.typeVersion || 1,
      position: operation.node.position,
      parameters: operation.node.parameters || {},
      credentials: operation.node.credentials,
      disabled: operation.node.disabled,
      notes: operation.node.notes,
      notesInFlow: operation.node.notesInFlow,
      continueOnFail: operation.node.continueOnFail,
      onError: operation.node.onError,
      retryOnFail: operation.node.retryOnFail,
      maxTries: operation.node.maxTries,
      waitBetweenTries: operation.node.waitBetweenTries,
      alwaysOutputData: operation.node.alwaysOutputData,
      executeOnce: operation.node.executeOnce
    };

    // Sanitize node to ensure complete metadata (filter options, operator structure, etc.)
    const sanitizedNode = sanitizeNode(newNode);

    this.modifiedNodeIds.add(sanitizedNode.id);
    workflow.nodes.push(sanitizedNode);
  }

  private applyRemoveNode(workflow: Workflow, operation: RemoveNodeOperation): void {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) return;

    this.removedNodeNames.add(node.name);

    // Remove node from array
    const index = workflow.nodes.findIndex(n => n.id === node.id);
    if (index !== -1) {
      workflow.nodes.splice(index, 1);
    }
    
    // Remove all connections from this node
    delete workflow.connections[node.name];
    
    // Remove all connections to this node
    for (const [sourceName, sourceConnections] of Object.entries(workflow.connections)) {
      for (const [outputName, outputConns] of Object.entries(sourceConnections)) {
        sourceConnections[outputName] = outputConns.map(connections =>
          connections.filter(conn => conn.node !== node.name)
        );

        // Trim trailing empty arrays only (preserve intermediate empty arrays for positional indices)
        const trimmed = sourceConnections[outputName];
        while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0) {
          trimmed.pop();
        }

        if (trimmed.length === 0) {
          delete sourceConnections[outputName];
        }
      }

      // Clean up empty connection objects
      if (Object.keys(sourceConnections).length === 0) {
        delete workflow.connections[sourceName];
      }
    }
  }

  private applyUpdateNode(workflow: Workflow, operation: UpdateNodeOperation): void {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) return;

    this.modifiedNodeIds.add(node.id);

    // Track node renames for connection reference updates
    if (operation.updates.name && operation.updates.name !== node.name) {
      const oldName = node.name;
      const newName = operation.updates.name;
      this.renameMap.set(oldName, newName);
      logger.debug(`Tracking rename: "${oldName}" → "${newName}"`);
    }

    // Apply updates using dot notation
    Object.entries(operation.updates).forEach(([path, value]) => {
      this.setNestedProperty(node, path, value);
    });

    // Sanitize node after updates to ensure metadata is complete
    const sanitized = sanitizeNode(node);

    // Update the node in-place
    Object.assign(node, sanitized);
  }

  private applyMoveNode(workflow: Workflow, operation: MoveNodeOperation): void {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) return;
    
    node.position = operation.position;
  }

  private applyEnableNode(workflow: Workflow, operation: EnableNodeOperation): void {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) return;
    
    node.disabled = false;
  }

  private applyDisableNode(workflow: Workflow, operation: DisableNodeOperation): void {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) return;
    
    node.disabled = true;
  }

  /**
   * Resolve smart parameters (branch, case) to technical parameters
   * Phase 1 UX improvement: Semantic parameters for multi-output nodes
   */
  private resolveSmartParameters(
    workflow: Workflow,
    operation: AddConnectionOperation | RewireConnectionOperation
  ): { sourceOutput: string; sourceIndex: number } {
    const sourceNode = this.findNode(workflow, operation.source, operation.source);

    // Start with explicit values or defaults, coercing to correct types
    let sourceOutput = String(operation.sourceOutput ?? 'main');
    let sourceIndex = operation.sourceIndex ?? 0;

    // Smart parameter: branch (for IF nodes)
    // IF nodes use 'main' output with index 0 (true) or 1 (false)
    if (operation.branch !== undefined && operation.sourceIndex === undefined) {
      // Only apply if sourceIndex not explicitly set
      if (sourceNode?.type === 'n8n-nodes-base.if') {
        sourceIndex = operation.branch === 'true' ? 0 : 1;
        // sourceOutput remains 'main' (do not change it)
      }
    }

    // Smart parameter: case (for Switch nodes)
    if (operation.case !== undefined && operation.sourceIndex === undefined) {
      // Only apply if sourceIndex not explicitly set
      sourceIndex = operation.case;
    }

    // Validation: Warn if using sourceIndex with If/Switch nodes without smart parameters
    if (sourceNode && operation.sourceIndex !== undefined && operation.branch === undefined && operation.case === undefined) {
      if (sourceNode.type === 'n8n-nodes-base.if') {
        this.warnings.push({
          operation: -1,  // Not tied to specific operation index in request
          message: `Connection to If node "${operation.source}" uses sourceIndex=${operation.sourceIndex}. ` +
            `Consider using branch="true" or branch="false" for better clarity. ` +
            `If node outputs: main[0]=TRUE branch, main[1]=FALSE branch.`
        });
      } else if (sourceNode.type === 'n8n-nodes-base.switch') {
        this.warnings.push({
          operation: -1,  // Not tied to specific operation index in request
          message: `Connection to Switch node "${operation.source}" uses sourceIndex=${operation.sourceIndex}. ` +
            `Consider using case=N for better clarity (case=0 for first output, case=1 for second, etc.).`
        });
      }
    }

    return { sourceOutput, sourceIndex };
  }

  // Connection operation appliers
  private applyAddConnection(workflow: Workflow, operation: AddConnectionOperation): void {
    const sourceNode = this.findNode(workflow, operation.source, operation.source);
    const targetNode = this.findNode(workflow, operation.target, operation.target);
    if (!sourceNode || !targetNode) return;

    // Resolve smart parameters (branch, case) to technical parameters
    const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);

    // Use nullish coalescing to properly handle explicit 0 values
    // Default targetInput to sourceOutput to preserve connection type for AI connections (ai_tool, ai_memory, etc.)
    // Coerce to string to handle numeric values passed as sourceOutput/targetInput
    const targetInput = String(operation.targetInput ?? sourceOutput);
    const targetIndex = operation.targetIndex ?? 0;

    // Initialize source node connections object
    if (!workflow.connections[sourceNode.name]) {
      workflow.connections[sourceNode.name] = {};
    }

    // Initialize output type array
    if (!workflow.connections[sourceNode.name][sourceOutput]) {
      workflow.connections[sourceNode.name][sourceOutput] = [];
    }

    // Get reference to output array for clarity
    const outputArray = workflow.connections[sourceNode.name][sourceOutput];

    // Ensure we have connection arrays up to and including the target sourceIndex
    while (outputArray.length <= sourceIndex) {
      outputArray.push([]);
    }

    // Defensive: Verify the slot is an array (should always be true after while loop)
    if (!Array.isArray(outputArray[sourceIndex])) {
      outputArray[sourceIndex] = [];
    }

    // Add connection to the correct sourceIndex
    outputArray[sourceIndex].push({
      node: targetNode.name,
      type: targetInput,
      index: targetIndex
    });
  }

  private applyRemoveConnection(workflow: Workflow, operation: RemoveConnectionOperation): void {
    const sourceNode = this.findNode(workflow, operation.source, operation.source);
    const targetNode = this.findNode(workflow, operation.target, operation.target);
    if (!sourceNode || !targetNode) {
      return;
    }
    
    const sourceOutput = String(operation.sourceOutput ?? 'main');
    const connections = workflow.connections[sourceNode.name]?.[sourceOutput];
    if (!connections) return;

    // Remove connection from all indices
    workflow.connections[sourceNode.name][sourceOutput] = connections.map(conns =>
      conns.filter(conn => conn.node !== targetNode.name)
    );

    // Remove trailing empty arrays only (preserve intermediate empty arrays to maintain indices)
    const outputConnections = workflow.connections[sourceNode.name][sourceOutput];
    while (outputConnections.length > 0 && outputConnections[outputConnections.length - 1].length === 0) {
      outputConnections.pop();
    }

    if (outputConnections.length === 0) {
      delete workflow.connections[sourceNode.name][sourceOutput];
    }
    
    if (Object.keys(workflow.connections[sourceNode.name]).length === 0) {
      delete workflow.connections[sourceNode.name];
    }
  }

  /**
   * Rewire a connection from one target to another
   * This is a semantic wrapper around removeConnection + addConnection
   * that provides clear intent: "rewire connection from X to Y"
   *
   * @param workflow - Workflow to modify
   * @param operation - Rewire operation specifying source, from, and to
   */
  private applyRewireConnection(workflow: Workflow, operation: RewireConnectionOperation): void {
    // Resolve smart parameters (branch, case) to technical parameters
    const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);

    // First, remove the old connection (source → from)
    this.applyRemoveConnection(workflow, {
      type: 'removeConnection',
      source: operation.source,
      target: operation.from,
      sourceOutput: sourceOutput,
      targetInput: operation.targetInput
    });

    // Then, add the new connection (source → to)
    this.applyAddConnection(workflow, {
      type: 'addConnection',
      source: operation.source,
      target: operation.to,
      sourceOutput: sourceOutput,
      targetInput: operation.targetInput,
      sourceIndex: sourceIndex,
      targetIndex: 0 // Default target index for new connection
    });
  }

  // Metadata operation appliers
  private applyUpdateSettings(workflow: Workflow, operation: UpdateSettingsOperation): void {
    // Only create/update settings if operation provides actual properties
    // This prevents creating empty settings objects that would be rejected by n8n API
    if (operation.settings && Object.keys(operation.settings).length > 0) {
      if (!workflow.settings) {
        workflow.settings = {};
      }
      Object.assign(workflow.settings, operation.settings);
    }
  }

  private applyUpdateName(workflow: Workflow, operation: UpdateNameOperation): void {
    workflow.name = operation.name;
  }

  private applyAddTag(workflow: Workflow, operation: AddTagOperation): void {
    // Track for dedicated API call instead of modifying workflow.tags directly
    // Reconcile: if previously marked for removal, cancel the removal instead
    const removeIdx = this.tagsToRemove.indexOf(operation.tag);
    if (removeIdx !== -1) {
      this.tagsToRemove.splice(removeIdx, 1);
    }
    if (!this.tagsToAdd.includes(operation.tag)) {
      this.tagsToAdd.push(operation.tag);
    }
  }

  private applyRemoveTag(workflow: Workflow, operation: RemoveTagOperation): void {
    // Track for dedicated API call instead of modifying workflow.tags directly
    // Reconcile: if previously marked for addition, cancel the addition instead
    const addIdx = this.tagsToAdd.indexOf(operation.tag);
    if (addIdx !== -1) {
      this.tagsToAdd.splice(addIdx, 1);
    }
    if (!this.tagsToRemove.includes(operation.tag)) {
      this.tagsToRemove.push(operation.tag);
    }
  }

  // Workflow activation operation validators
  private validateActivateWorkflow(workflow: Workflow, operation: ActivateWorkflowOperation): string | null {
    // Check if workflow has at least one activatable trigger
    // NOTE: Since n8n 2.0, executeWorkflowTrigger is activatable and MUST be activated to work
    const activatableTriggers = workflow.nodes.filter(
      node => !node.disabled && isActivatableTrigger(node.type)
    );

    if (activatableTriggers.length === 0) {
      return 'Cannot activate workflow: No activatable trigger nodes found. Workflows must have at least one enabled trigger node (webhook, schedule, executeWorkflowTrigger, etc.).';
    }

    return null;
  }

  private validateDeactivateWorkflow(workflow: Workflow, operation: DeactivateWorkflowOperation): string | null {
    // Deactivation is always valid - any workflow can be deactivated
    return null;
  }

  // Workflow activation operation appliers
  private applyActivateWorkflow(workflow: Workflow, operation: ActivateWorkflowOperation): void {
    // Set flag in workflow object to indicate activation intent
    // The handler will call the API method after workflow update
    (workflow as any)._shouldActivate = true;
  }

  private applyDeactivateWorkflow(workflow: Workflow, operation: DeactivateWorkflowOperation): void {
    // Set flag in workflow object to indicate deactivation intent
    // The handler will call the API method after workflow update
    (workflow as any)._shouldDeactivate = true;
  }

  // Connection cleanup operation validators
  private validateCleanStaleConnections(workflow: Workflow, operation: CleanStaleConnectionsOperation): string | null {
    // This operation is always valid - it just cleans up what it finds
    return null;
  }

  private validateReplaceConnections(workflow: Workflow, operation: ReplaceConnectionsOperation): string | null {
    // Validate that all referenced nodes exist
    const nodeNames = new Set(workflow.nodes.map(n => n.name));

    for (const [sourceName, outputs] of Object.entries(operation.connections)) {
      if (!nodeNames.has(sourceName)) {
        return `Source node not found in connections: ${sourceName}`;
      }

      // outputs is the value from Object.entries, need to iterate its keys
      for (const outputName of Object.keys(outputs)) {
        const connections = outputs[outputName];
        for (const conns of connections) {
          for (const conn of conns) {
            if (!nodeNames.has(conn.node)) {
              return `Target node not found in connections: ${conn.node}`;
            }
          }
        }
      }
    }

    return null;
  }

  // Connection cleanup operation appliers
  private applyCleanStaleConnections(workflow: Workflow, operation: CleanStaleConnectionsOperation): void {
    const nodeNames = new Set(workflow.nodes.map(n => n.name));
    const staleConnections: Array<{ from: string; to: string }> = [];

    // If dryRun, only identify stale connections without removing them
    if (operation.dryRun) {
      for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
        if (!nodeNames.has(sourceName)) {
          for (const [outputName, connections] of Object.entries(outputs)) {
            for (const conns of connections) {
              for (const conn of conns) {
                staleConnections.push({ from: sourceName, to: conn.node });
              }
            }
          }
        } else {
          for (const [outputName, connections] of Object.entries(outputs)) {
            for (const conns of connections) {
              for (const conn of conns) {
                if (!nodeNames.has(conn.node)) {
                  staleConnections.push({ from: sourceName, to: conn.node });
                }
              }
            }
          }
        }
      }
      logger.info(`[DryRun] Would remove ${staleConnections.length} stale connections:`, staleConnections);
      return;
    }

    // Actually remove stale connections
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      // If source node doesn't exist, mark all connections as stale
      if (!nodeNames.has(sourceName)) {
        for (const [outputName, connections] of Object.entries(outputs)) {
          for (const conns of connections) {
            for (const conn of conns) {
              staleConnections.push({ from: sourceName, to: conn.node });
            }
          }
        }
        delete workflow.connections[sourceName];
        continue;
      }

      // Check each connection
      for (const [outputName, connections] of Object.entries(outputs)) {
        const filteredConnections = connections.map(conns =>
          conns.filter(conn => {
            if (!nodeNames.has(conn.node)) {
              staleConnections.push({ from: sourceName, to: conn.node });
              return false;
            }
            return true;
          })
        );

        // Trim trailing empty arrays only (preserve intermediate for positional indices)
        while (filteredConnections.length > 0 && filteredConnections[filteredConnections.length - 1].length === 0) {
          filteredConnections.pop();
        }

        if (filteredConnections.length === 0) {
          delete outputs[outputName];
        } else {
          outputs[outputName] = filteredConnections;
        }
      }

      // Clean up empty output objects
      if (Object.keys(outputs).length === 0) {
        delete workflow.connections[sourceName];
      }
    }

    logger.info(`Removed ${staleConnections.length} stale connections`);
  }

  private applyReplaceConnections(workflow: Workflow, operation: ReplaceConnectionsOperation): void {
    workflow.connections = operation.connections;
  }

  /**
   * Update all connection references when nodes are renamed.
   * This method is called after node operations to ensure connection integrity.
   *
   * Updates:
   * - Connection object keys (source node names)
   * - Connection target.node values (target node names)
   * - All output types (main, error, ai_tool, ai_languageModel, etc.)
   *
   * @param workflow - The workflow to update
   */
  private updateConnectionReferences(workflow: Workflow): void {
    if (this.renameMap.size === 0) return;

    logger.debug(`Updating connection references for ${this.renameMap.size} renamed nodes`);

    // Create a mapping of all renames (old → new)
    const renames = new Map(this.renameMap);

    // Step 1: Update connection object keys (source node names)
    const updatedConnections: WorkflowConnection = {};
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
      // Check if this source node was renamed
      const newSourceName = renames.get(sourceName) || sourceName;
      updatedConnections[newSourceName] = outputs;
    }

    // Step 2: Update target node references within connections
    for (const [sourceName, outputs] of Object.entries(updatedConnections)) {
      // Iterate through all output types (main, error, ai_tool, ai_languageModel, etc.)
      for (const [outputType, connections] of Object.entries(outputs)) {
        // connections is Array<Array<{node, type, index}>>
        for (let outputIndex = 0; outputIndex < connections.length; outputIndex++) {
          const connectionsAtIndex = connections[outputIndex];
          for (let connIndex = 0; connIndex < connectionsAtIndex.length; connIndex++) {
            const connection = connectionsAtIndex[connIndex];
            // Check if target node was renamed
            if (renames.has(connection.node)) {
              const newTargetName = renames.get(connection.node)!;
              connection.node = newTargetName;
              logger.debug(`Updated connection: ${sourceName}[${outputType}][${outputIndex}][${connIndex}].node: "${connection.node}" → "${newTargetName}"`);
            }
          }
        }
      }
    }

    // Replace workflow connections with updated connections
    workflow.connections = updatedConnections;

    logger.info(`Auto-updated ${this.renameMap.size} node name references in connections`);
  }

  // Helper methods

  /**
   * Normalize node names to handle special characters and escaping differences.
   * Fixes issue #270: apostrophes and other special characters in node names.
   *
   * ⚠️ WARNING: Normalization can cause collisions between names that differ only in:
   * - Leading/trailing whitespace
   * - Multiple consecutive spaces vs single spaces
   * - Escaped vs unescaped quotes/backslashes
   * - Different types of whitespace (tabs, newlines, spaces)
   *
   * Examples of names that normalize to the SAME value:
   * - "Node 'test'" === "Node  'test'" (multiple spaces)
   * - "Node 'test'" === "Node\t'test'" (tab vs space)
   * - "Node 'test'" === "Node \\'test\\'" (escaped quotes)
   * - "Path\\to\\file" === "Path\\\\to\\\\file" (escaped backslashes)
   *
   * Best Practice: For node names with special characters, prefer using node IDs
   * to avoid ambiguity. Use n8n_get_workflow_structure() to get node IDs.
   *
   * @param name - The node name to normalize
   * @returns Normalized node name for safe comparison
   */
  private normalizeNodeName(name: string): string {
    return name
      .trim()                    // Remove leading/trailing whitespace
      .replace(/\\\\/g, '\\')    // FIRST: Unescape backslashes: \\ -> \ (must be first to handle multiply-escaped chars)
      .replace(/\\'/g, "'")      // THEN: Unescape single quotes: \' -> '
      .replace(/\\"/g, '"')      // THEN: Unescape double quotes: \" -> "
      .replace(/\s+/g, ' ');     // FINALLY: Normalize all whitespace (spaces, tabs, newlines) to single space
  }

  /**
   * Find a node by ID or name in the workflow.
   * Uses string normalization to handle special characters (Issue #270).
   *
   * @param workflow - The workflow to search in
   * @param nodeId - Optional node ID to search for
   * @param nodeName - Optional node name to search for
   * @returns The found node or null
   */
  private findNode(workflow: Workflow, nodeId?: string, nodeName?: string): WorkflowNode | null {
    // Try to find by ID first (exact match, no normalization needed for UUIDs)
    if (nodeId) {
      const nodeById = workflow.nodes.find(n => n.id === nodeId);
      if (nodeById) return nodeById;
    }

    // Try to find by name with normalization (handles special characters)
    if (nodeName) {
      const normalizedSearch = this.normalizeNodeName(nodeName);
      const nodeByName = workflow.nodes.find(n =>
        this.normalizeNodeName(n.name) === normalizedSearch
      );
      if (nodeByName) return nodeByName;
    }

    // Fallback: If nodeId provided but not found, try treating it as a name
    // This allows operations to work with either IDs or names flexibly
    if (nodeId && !nodeName) {
      const normalizedSearch = this.normalizeNodeName(nodeId);
      const nodeByName = workflow.nodes.find(n =>
        this.normalizeNodeName(n.name) === normalizedSearch
      );
      if (nodeByName) return nodeByName;
    }

    return null;
  }

  /**
   * Format a consistent "node not found" error message with helpful context.
   * Shows available nodes with IDs and tips about using node IDs for special characters.
   *
   * @param workflow - The workflow being validated
   * @param nodeIdentifier - The node ID or name that wasn't found
   * @param operationType - The operation being performed (e.g., "removeNode", "updateNode")
   * @returns Formatted error message with available nodes and helpful tips
   */
  private formatNodeNotFoundError(
    workflow: Workflow,
    nodeIdentifier: string,
    operationType: string
  ): string {
    const availableNodes = workflow.nodes
      .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
      .join(', ');
    return `Node not found for ${operationType}: "${nodeIdentifier}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters (apostrophes, quotes).`;
  }

  private setNestedProperty(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  }
}