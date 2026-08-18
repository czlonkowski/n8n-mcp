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
  SetNodeGroupsOperation,
  AddTagOperation,
  RemoveTagOperation,
  ActivateWorkflowOperation,
  DeactivateWorkflowOperation,
  CleanStaleConnectionsOperation,
  ReplaceConnectionsOperation,
  TransferWorkflowOperation,
  MoveToFolderOperation,
  PatchNodeFieldOperation
} from '../types/workflow-diff';
import { Workflow, WorkflowNode, WorkflowConnection, WorkflowNodeGroup } from '../types/n8n-api';
import { Logger } from '../utils/logger';
import { validateWorkflowNode, validateWorkflowConnections } from './n8n-validation';
import { GROUP_DESCRIPTION_MAX_LENGTH, repairNodeGroups, toWorkflowNodeGroup } from './node-groups';
import { sanitizeNode, sanitizeWorkflowNodes } from './node-sanitizer';
import { isActivatableTrigger } from '../utils/node-type-utils';

const logger = new Logger({ prefix: '[WorkflowDiffEngine]' });

// Safety limits for patchNodeField operations
const PATCH_LIMITS = {
  MAX_PATCHES: 50,           // Max patches per operation
  MAX_REGEX_LENGTH: 500,     // Max regex pattern length (chars)
  MAX_FIELD_SIZE_REGEX: 512 * 1024, // Max field size for regex operations (512KB)
};

// Keys that must never appear in property paths (prototype pollution prevention)
const DANGEROUS_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Check if a regex pattern contains constructs known to cause catastrophic backtracking.
 * Detects nested quantifiers like (a+)+, (a*)+, (a+)*, (a|b+)+ etc.
 */
function isUnsafeRegex(pattern: string): boolean {
  // Detect nested quantifiers: a quantifier applied to a group that itself contains a quantifier
  // Examples: (a+)+, (a+)*, (.*)+, (\w+)*, (a|b+)+
  // This catches the most common ReDoS patterns
  const nestedQuantifier = /\([^)]*[+*][^)]*\)[+*{]/;
  if (nestedQuantifier.test(pattern)) return true;

  // Detect overlapping alternations with quantifiers: (a|a)+, (\w|\d)+
  const overlappingAlternation = /\([^)]*\|[^)]*\)[+*{]/;
  // Only flag if alternation branches share characters (heuristic: both contain \w, ., or same literal)
  if (overlappingAlternation.test(pattern)) {
    const match = pattern.match(/\(([^)]*)\|([^)]*)\)[+*{]/);
    if (match) {
      const [, left, right] = match;
      // Flag if both branches use broad character classes
      const broadClasses = ['.', '\\w', '\\d', '\\s', '\\S', '\\W', '\\D', '[^'];
      const leftHasBroad = broadClasses.some(c => left.includes(c));
      const rightHasBroad = broadClasses.some(c => right.includes(c));
      if (leftHasBroad && rightHasBroad) return true;
    }
  }

  return false;
}

interface PathSegment {
  key: string;
  /** Segment came from bracket syntax (`items[0]`), which only an array can satisfy. */
  bracket: boolean;
}

/**
 * Split a property path into segments, understanding dot notation and bracket
 * indices: "assignments[0].value" → ["assignments", "0", "value"].
 *
 * Bracket indices must be non-negative integers. Anything else is malformed and
 * throws — treating "assignments[0]" as a literal key silently wrote a junk
 * sibling property instead of updating the array element (#950).
 */
function parsePropertyPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];

  for (const part of path.split('.')) {
    if (!part.includes('[') && !part.includes(']')) {
      if (part === '') {
        throw new Error(
          `Invalid property path "${path}": empty path segment. ` +
          `Write "parameters.url" without leading, trailing or repeated dots.`
        );
      }
      segments.push({ key: part, bracket: false });
      continue;
    }

    const match = /^([^[\]]*)((?:\[\d+\])+)$/.exec(part);
    if (!match) {
      throw new Error(
        `Invalid property path "${path}": malformed bracket index in "${part}". ` +
        `Use "items[0].name" with a non-negative integer, or the equivalent "items.0.name".`
      );
    }

    const [, base, indices] = match;
    if (base) segments.push({ key: base, bracket: false });
    for (const [, index] of indices.matchAll(/\[(\d+)\]/g)) {
      segments.push({ key: index, bracket: true });
    }
  }

  return segments;
}

/**
 * Resolve a path segment against its container, returning the key to read or
 * write. Numeric segments address array elements by index; a bracket segment
 * that does not land on an array is a caller mistake, not a new property.
 *
 * Writes additionally refuse non-index segments on arrays: keys like "-1" or
 * "length" would either be dropped on serialization or truncate the array,
 * which is the same silent corruption bracket parsing fixes (#950). Reads stay
 * permissive so an unresolvable path simply reads as undefined.
 */
function resolveSegment(
  container: any,
  segment: PathSegment,
  path: string,
  forWrite: boolean
): string | number {
  if (Array.isArray(container)) {
    if (/^\d+$/.test(segment.key)) {
      const index = Number(segment.key);
      if (index >= container.length) {
        throw new Error(
          `Invalid property path "${path}": index ${index} is out of range for an array of ${container.length} item(s).`
        );
      }
      return index;
    }

    if (forWrite) {
      throw new Error(
        `Invalid property path "${path}": "${segment.key}" is not an array index. ` +
        `Address array elements by position, e.g. "items[0].name".`
      );
    }
  }

  if (segment.bracket) {
    throw new Error(
      `Invalid property path "${path}": "[${segment.key}]" expects an array but found ${container === null ? 'null' : typeof container}.`
    );
  }

  return segment.key;
}

function countOccurrences(str: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

// Fields that hold plain JavaScript: the Code node's jsCode and the legacy
// Function/FunctionItem nodes' functionCode. Python lives in pythonCode.
const JS_CODE_FIELD_NAMES = new Set(['jsCode', 'functionCode']);

// Parses (never executes) code as an async function body, matching n8n's own
// wrapping of Code-node JS — so top-level return/await are valid.
const AsyncFunctionCtor = (async () => {}).constructor as new (...args: string[]) => unknown;

// Parsing is synchronous on the event loop; a 60 MiB body costs ~1s. Real
// Code-node sources are kilobytes — beyond this the code is never parsed,
// so oversized input cannot become a DoS lever (Codex review on #1014).
const MAX_SYNTAX_CHECKED_LENGTH = 1_000_000;

type JsSyntaxCheck =
  | { status: 'valid' }
  | { status: 'invalid'; message: string }
  // Could not judge the code either way: oversized, or the parser gave up
  // with a non-SyntaxError (a CSP EvalError, a RangeError from pathological
  // nesting). Distinct from 'valid' so a checkably-valid field cannot be
  // patched into an unverifiable blob unnoticed (Codex review on #1014).
  | { status: 'uncheckable'; reason: string };

function checkJsSyntax(code: string): JsSyntaxCheck {
  if (code.length > MAX_SYNTAX_CHECKED_LENGTH) {
    return { status: 'uncheckable', reason: `code exceeds ${MAX_SYNTAX_CHECKED_LENGTH} characters` };
  }
  try {
    new AsyncFunctionCtor(code);
    return { status: 'valid' };
  } catch (error) {
    if (error instanceof SyntaxError) return { status: 'invalid', message: error.message };
    return { status: 'uncheckable', reason: `the parser gave up (${error instanceof Error ? error.name : 'unknown error'})` };
  }
}

// jsCode/functionCode are noDataExpression fields: n8n strips one leading "="
// before executing them (node-helpers), so an "=" value is NOT an expression
// there — parse what will actually run (Codex review on #1014).
function stripExpressionPrefix(value: string): string {
  return value.startsWith('=') ? value.slice(1) : value;
}

/**
 * After a find/replace patch lands on a JavaScript code field, parse the result
 * so a patch that leaves broken code fails the operation instead of saving it
 * (#1012 expansion). Throws before the caller writes, keeping the operation
 * atomic. Only regressions the patch introduced are blocked: when the field
 * was already unparseable before patching, an incremental repair must be able
 * to pass through still-broken states.
 */
function assertPatchedJsSyntax(operation: string, fieldPath: string, patched: string, original: string): void {
  const fieldName = fieldPath.split('.').pop() ?? '';
  if (!JS_CODE_FIELD_NAMES.has(fieldName)) return;

  const patchedCheck = checkJsSyntax(stripExpressionPrefix(patched));
  if (patchedCheck.status === 'valid') return;

  // The gate: judge only against a baseline we could actually judge. A field
  // that was already invalid stays patchable (incremental repair), and an
  // uncheckable baseline gives no standard to hold the patch to.
  if (checkJsSyntax(stripExpressionPrefix(original)).status !== 'valid') return;

  if (patchedCheck.status === 'invalid') {
    throw new Error(
      `${operation}: patches would leave "${fieldPath}" with invalid JavaScript (${patchedCheck.message}). ` +
      `The workflow was not modified. If several dependent edits pass through an invalid intermediate state, ` +
      `apply them as one operation — only the final result of the patches array is checked.`
    );
  }

  throw new Error(
    `${operation}: could not verify the JavaScript syntax of "${fieldPath}" after patching (${patchedCheck.reason}). ` +
    `The workflow was not modified. To set the field anyway, replace its full value with an updateNode operation, ` +
    `which is not syntax-checked.`
  );
}

function operationReferencesAddedNode(
  operation: WorkflowDiffOperation,
  addedNode: AddNodeOperation['node']
): boolean {
  if (operation.type === 'addConnection') {
    return operation.source === addedNode.name
      || operation.source === addedNode.id
      || operation.target === addedNode.name
      || operation.target === addedNode.id;
  }

  if (operation.type === 'rewireConnection') {
    return operation.source === addedNode.name
      || operation.source === addedNode.id
      || operation.from === addedNode.name
      || operation.from === addedNode.id
      || operation.to === addedNode.name
      || operation.to === addedNode.id;
  }

  return false;
}

/**
 * Build execution order for diff operations.
 *
 * Operations execute in the order the caller provided so each one validates
 * against the workflow state at its position in the sequence (#788). The only
 * exception is the legacy "add node and connect it in the same batch" pattern,
 * where an addConnection / rewireConnection references a node added later in
 * the batch — we hoist that addNode to just before its first earlier reference
 * so the connection op still resolves. Other operation kinds are never
 * reordered; if a caller emits `removeConnection X→Y` before `addNode X`,
 * it now fails as it should.
 */
function buildExecutionEntries(operations: WorkflowDiffOperation[]) {
  const entries = operations.map((operation, index) => ({ operation, index }));

  for (let currentIndex = 0; currentIndex < entries.length; currentIndex++) {
    const entry = entries[currentIndex];
    if (entry.operation.type !== 'addNode') continue;
    const addedNode = entry.operation.node;

    const referencedBeforeAdd = entries.findIndex((candidate, candidateIndex) =>
      candidateIndex < currentIndex
      && isConnectionOperation(candidate.operation)
      && operationReferencesAddedNode(candidate.operation, addedNode)
    );

    if (referencedBeforeAdd === -1) continue;

    entries.splice(currentIndex, 1);
    entries.splice(referencedBeforeAdd, 0, entry);
  }

  return entries;
}

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
  // Track transfer operation for dedicated API call
  private transferToProjectId: string | undefined;
  // Canvas groups authored by this diff — the caller must not let n8n silently reject them
  private authoredGroupNames = new Set<string>();

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
      this.transferToProjectId = undefined;
      this.authoredGroupNames.clear();

      // Clone workflow to avoid modifying original
      const workflowCopy = JSON.parse(JSON.stringify(workflow));

      const operationEntries = buildExecutionEntries(request.operations);
      const nodeOperationCount = request.operations.filter(isNodeOperation).length;
      const otherOperationCount = request.operations.length - nodeOperationCount;
      const errors: WorkflowDiffValidationError[] = [];
      const appliedIndices: number[] = [];
      const failedIndices: number[] = [];

      // Process based on mode
      if (request.continueOnError) {
        // Best-effort mode: continue even if some operations fail
        for (const { operation, index } of operationEntries) {
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
            this.flushPendingRenames(workflowCopy);
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

        this.finalizeNodeGroups(workflowCopy);

        // If validateOnly flag is set, return success without applying.
        // Include workflowCopy so the caller can run structural validation against
        // the simulated post-diff result (#744).
        if (request.validateOnly) {
          return {
            success: errors.length === 0,
            workflow: workflowCopy,
            message: errors.length === 0
              ? 'Validation successful. All operations are valid.'
              : `Validation completed with ${errors.length} errors.`,
            errors: errors.length > 0 ? errors : undefined,
            warnings: this.warnings.length > 0 ? this.warnings : undefined,
            applied: appliedIndices,
            failed: failedIndices,
            authoredGroupNames: this.authoredGroupNamesOrUndefined()
          };
        }

        // Extract and clean up activation flags (same as atomic mode)
        const shouldActivate = (workflowCopy as any)._shouldActivate === true;
        const shouldDeactivate = (workflowCopy as any)._shouldDeactivate === true;
        delete (workflowCopy as any)._shouldActivate;
        delete (workflowCopy as any)._shouldDeactivate;

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
          shouldActivate: shouldActivate || undefined,
          shouldDeactivate: shouldDeactivate || undefined,
          tagsToAdd: this.tagsToAdd.length > 0 ? this.tagsToAdd : undefined,
          tagsToRemove: this.tagsToRemove.length > 0 ? this.tagsToRemove : undefined,
          transferToProjectId: this.transferToProjectId || undefined,
          authoredGroupNames: this.authoredGroupNamesOrUndefined()
        };
      } else {
        // Atomic mode: all operations must succeed
        for (const { operation, index } of operationEntries) {
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
            this.flushPendingRenames(workflowCopy);
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

        this.finalizeNodeGroups(workflowCopy);

        // If validateOnly flag is set, return success without applying.
        // Include the post-diff workflowCopy so the caller (handlers-workflow-diff)
        // can run structural validation against the simulated result — without it
        // both validate and apply paths cannot agree on validity (#744).
        if (request.validateOnly) {
          return {
            success: true,
            workflow: workflowCopy,
            message: 'Validation successful. Operations are valid but not applied.',
            warnings: this.warnings.length > 0 ? this.warnings : undefined,
            authoredGroupNames: this.authoredGroupNamesOrUndefined()
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
          message: `Successfully applied ${operationsApplied} operations (${nodeOperationCount} node ops, ${otherOperationCount} other ops)`,
          warnings: this.warnings.length > 0 ? this.warnings : undefined,
          shouldActivate: shouldActivate || undefined,
          shouldDeactivate: shouldDeactivate || undefined,
          tagsToAdd: this.tagsToAdd.length > 0 ? this.tagsToAdd : undefined,
          tagsToRemove: this.tagsToRemove.length > 0 ? this.tagsToRemove : undefined,
          transferToProjectId: this.transferToProjectId || undefined,
          authoredGroupNames: this.authoredGroupNamesOrUndefined()
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
      case 'patchNodeField':
        return this.validatePatchNodeField(workflow, operation as PatchNodeFieldOperation);
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
      case 'setNodeGroups':
        return this.validateSetNodeGroups(workflow, operation as SetNodeGroupsOperation);
      case 'transferWorkflow':
        return this.validateTransferWorkflow(workflow, operation as TransferWorkflowOperation);
      case 'moveToFolder':
        return this.validateMoveToFolder(workflow, operation as MoveToFolderOperation);
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
      case 'patchNodeField':
        this.applyPatchNodeField(workflow, operation as PatchNodeFieldOperation);
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
      case 'setNodeGroups':
        this.applySetNodeGroups(workflow, operation as SetNodeGroupsOperation);
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
      case 'transferWorkflow':
        this.applyTransferWorkflow(workflow, operation as TransferWorkflowOperation);
        break;
      case 'moveToFolder':
        this.applyMoveToFolder(workflow, operation as MoveToFolderOperation);
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

    // Node IDs are referenced by canvas groups (and n8n's own pinned data), so a rewrite here
    // would silently orphan them. Renaming is fine; re-identifying is not.
    if ('id' in operation.updates && operation.updates.id !== node.id) {
      return `Cannot change the id of node "${node.name}": node IDs are immutable because canvas groups and pinned data reference them. Remove and re-add the node instead.`;
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

    for (const [path, value] of Object.entries(operation.updates)) {
      try {
        parsePropertyPath(path);
      } catch (error) {
        return error instanceof Error ? error.message : `Invalid property path "${path}"`;
      }

      // Validate __patch_find_replace syntax (#642)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)
          && '__patch_find_replace' in value) {
        const patches = value.__patch_find_replace;
        if (!Array.isArray(patches)) {
          return `Invalid __patch_find_replace at "${path}": must be an array of {find, replace} objects`;
        }
        for (let i = 0; i < patches.length; i++) {
          const patch = patches[i];
          if (!patch || typeof patch.find !== 'string' || typeof patch.replace !== 'string') {
            return `Invalid __patch_find_replace entry at "${path}[${i}]": each entry must have "find" (string) and "replace" (string)`;
          }
        }
        // node was already found above — reuse it
        const currentValue = this.getNestedProperty(node, path);
        if (currentValue === undefined) {
          return `Cannot apply __patch_find_replace to "${path}": property does not exist on node`;
        }
        if (typeof currentValue !== 'string') {
          return `Cannot apply __patch_find_replace to "${path}": current value is ${typeof currentValue}, expected string`;
        }
      }
    }

    return null;
  }

  private validatePatchNodeField(workflow: Workflow, operation: PatchNodeFieldOperation): string | null {
    if (!operation.nodeId && !operation.nodeName) {
      return `patchNodeField requires either "nodeId" or "nodeName"`;
    }

    if (!operation.fieldPath || typeof operation.fieldPath !== 'string') {
      return `patchNodeField requires a "fieldPath" string (e.g., "parameters.jsCode")`;
    }

    let pathSegments: PathSegment[];
    try {
      pathSegments = parsePropertyPath(operation.fieldPath);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : `invalid fieldPath "${operation.fieldPath}"`;
      return `patchNodeField: ${reason}`;
    }

    // Prototype pollution protection
    if (pathSegments.some(s => DANGEROUS_PATH_KEYS.has(s.key))) {
      return `patchNodeField: fieldPath "${operation.fieldPath}" contains a forbidden key (__proto__, constructor, or prototype)`;
    }

    // Same reason updateNode refuses it: canvas groups and pinned data reference the node id, so
    // rewriting it here would orphan them. Only the node's OWN id is protected — a nested id such
    // as `parameters.assignments.assignments[0].id` is ordinary node data.
    if (pathSegments[0].key === 'id') {
      return `Cannot patch the id of a node: node IDs are immutable because canvas groups and pinned data reference them. Remove and re-add the node instead.`;
    }

    if (!Array.isArray(operation.patches) || operation.patches.length === 0) {
      return `patchNodeField requires a non-empty "patches" array of {find, replace} objects`;
    }

    // Resource limit: max patches per operation
    if (operation.patches.length > PATCH_LIMITS.MAX_PATCHES) {
      return `patchNodeField: too many patches (${operation.patches.length}). Maximum is ${PATCH_LIMITS.MAX_PATCHES} per operation. Split into multiple operations if needed.`;
    }

    for (let i = 0; i < operation.patches.length; i++) {
      const patch = operation.patches[i];
      if (!patch || typeof patch.find !== 'string' || typeof patch.replace !== 'string') {
        return `Invalid patch entry at index ${i}: each entry must have "find" (string) and "replace" (string)`;
      }
      if (patch.find.length === 0) {
        return `Invalid patch entry at index ${i}: "find" must not be empty`;
      }
      if (patch.regex) {
        // Resource limit: max regex pattern length
        if (patch.find.length > PATCH_LIMITS.MAX_REGEX_LENGTH) {
          return `Regex pattern at patch index ${i} is too long (${patch.find.length} chars). Maximum is ${PATCH_LIMITS.MAX_REGEX_LENGTH} characters.`;
        }
        try {
          new RegExp(patch.find);
        } catch (e) {
          return `Invalid regex pattern at patch index ${i}: ${e instanceof Error ? e.message : 'invalid regex'}`;
        }
        // ReDoS protection: reject patterns with nested quantifiers
        if (isUnsafeRegex(patch.find)) {
          return `Potentially unsafe regex pattern at patch index ${i}: nested quantifiers or overlapping alternations can cause excessive backtracking. Simplify the pattern or use literal matching (regex: false).`;
        }
      }
    }

    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) {
      return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'patchNodeField');
    }

    const currentValue = this.getNestedProperty(node, operation.fieldPath);
    if (currentValue === undefined) {
      return `Cannot apply patchNodeField to "${operation.fieldPath}": property does not exist on node "${node.name}"`;
    }
    if (typeof currentValue !== 'string') {
      return `Cannot apply patchNodeField to "${operation.fieldPath}": current value is ${typeof currentValue}, expected string`;
    }

    // Resource limit: cap field size for regex operations
    const hasRegex = operation.patches.some(p => p.regex);
    if (hasRegex && typeof currentValue === 'string' && currentValue.length > PATCH_LIMITS.MAX_FIELD_SIZE_REGEX) {
      return `Field "${operation.fieldPath}" is too large for regex operations (${Math.round(currentValue.length / 1024)}KB). Maximum is ${PATCH_LIMITS.MAX_FIELD_SIZE_REGEX / 1024}KB. Use literal matching (regex: false) for large fields.`;
    }

    return null;
  }

  private validateMoveNode(workflow: Workflow, operation: MoveNodeOperation): string | null {
    // Catch common parameter typos before any mutation (QA #6). Previously
    // `newPosition` was silently accepted, position ended up undefined, and
    // the only signal was a cryptic `position Required` from the final
    // workflow-shape check — no mention of which op produced it. Reject
    // even when `position` is also set, so callers don't carry a misleading
    // alias through into their configs.
    const operationAny = operation as any;
    if (operationAny.newPosition !== undefined) {
      return `Invalid parameter 'newPosition' for moveNode. Did you mean 'position'? Example: {type: "moveNode", nodeName: "My Node", position: [450, 600]}`;
    }

    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) {
      return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'moveNode');
    }

    if (!operation.position) {
      return `Missing required parameter 'position' for moveNode. Example: {type: "moveNode", nodeName: "${node.name}", position: [450, 600]}`;
    }
    if (!Array.isArray(operation.position) || operation.position.length !== 2 ||
        typeof operation.position[0] !== 'number' || typeof operation.position[1] !== 'number') {
      return `Invalid 'position' for moveNode. Must be [x, y] with two numbers. Got: ${JSON.stringify(operation.position)}`;
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

    // Check if connection already exists at the specific (sourceOutput, sourceIndex) slot.
    // Resolving smart parameters here matches applyAddConnection's behavior so a duplicate
    // is only flagged when the resolved triple (source, sourceOutput, sourceIndex, target)
    // matches an existing edge. Without this, a Switch/IF node that already has an edge
    // from output 0 to target T would falsely block adding output 1 → T (#738).
    // silent: true so warnings are emitted by the apply phase only (avoids duplicates).
    const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation, { silent: true });
    const existing = workflow.connections[sourceNode.name]?.[sourceOutput];
    if (existing) {
      const slot = existing[sourceIndex];
      if (Array.isArray(slot) && slot.some(c => c.node === targetNode.name)) {
        return `Connection already exists from "${sourceNode.name}" (output "${sourceOutput}", index ${sourceIndex}) to "${targetNode.name}"`;
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
    // Reject from === to up front. If both resolve to the same node, the
    // apply would remove source→from and then skip the add (because "to" is
    // already present — which is "from"), leaving source disconnected.
    // Safer to fail the op than to silently drop the edge.
    if (operation.from === operation.to) {
      return `rewireConnection: "from" and "to" must refer to different nodes (got "${operation.from}" for both).`;
    }

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

    // Resolve smart parameters (branch, case) before validating connections.
    // silent: true so warnings are emitted by the apply phase only (avoids duplicates).
    const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation, { silent: true });

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

    // Capture (but do not yet commit) a potential rename. The renameMap drives
    // the per-op flushPendingRenames() that rewrites connection references, so
    // a stale entry from a failed updateNode would corrupt every later op in
    // continueOnError mode. Commit only after the updates loop + sanitization
    // complete and node.name actually changed.
    const pendingRename = operation.updates.name && operation.updates.name !== node.name
      ? { oldName: node.name, newName: operation.updates.name }
      : undefined;

    // Apply updates to a draft: a path that throws halfway through the object
    // (e.g. after auto-creating an intermediate) would otherwise leave the node
    // half-updated, and in continueOnError mode a later operation would persist
    // that state. The draft is swapped in only once every update succeeded.
    const draft: WorkflowNode = JSON.parse(JSON.stringify(node));

    // Apply updates using dot notation
    this.orderUpdateEntries(operation.updates).forEach(([path, value]) => {
      // Handle __patch_find_replace for surgical string edits (#642)
      // Format and type validation already passed in validateUpdateNode()
      if (value !== null && typeof value === 'object' && !Array.isArray(value)
          && '__patch_find_replace' in value) {
        const patches = value.__patch_find_replace as Array<{ find: string; replace: string }>;
        const original = this.getNestedProperty(draft, path) as string;
        let current = original;
        for (const patch of patches) {
          if (!current.includes(patch.find)) {
            this.warnings.push({
              operation: -1,
              message: `__patch_find_replace: "${patch.find.substring(0, 50)}" not found in "${path}". Skipped.`
            });
            continue;
          }
          // Function replacer keeps the replacement verbatim — a bare string would
          // read "$&", "$'" etc. in it as JS replacement patterns (#1012).
          current = current.replace(patch.find, () => patch.replace);
        }
        assertPatchedJsSyntax('__patch_find_replace', path, current, original);
        this.setNestedProperty(draft, path, current);
      } else {
        this.setNestedProperty(draft, path, value);
      }
    });

    // Sanitize the draft after updates to ensure metadata is complete, then swap
    // it in without replacing the node object itself — the workflow arrays and
    // the rename bookkeeping hold this reference.
    const sanitized = sanitizeNode(draft);
    for (const key of Object.keys(node)) {
      if (!Object.prototype.hasOwnProperty.call(sanitized, key)) {
        delete (node as any)[key];
      }
    }
    Object.assign(node, sanitized);

    // Commit the rename only after updates+sanitization succeeded and the
    // rename actually landed on the node. Guards against phantom rename
    // entries when an earlier update path threw (Copilot review on #789).
    if (pendingRename && node.name === pendingRename.newName) {
      this.renameMap.set(pendingRename.oldName, pendingRename.newName);
      logger.debug(`Tracking rename: "${pendingRename.oldName}" → "${pendingRename.newName}"`);
    }
  }

  /**
   * Order the updates of one operation so that removals of elements of the same
   * array run from the highest index down. Splicing "items[0]" before "items[1]"
   * would shift the array under the second removal and drop the wrong element.
   * Every other entry keeps its position.
   */
  private orderUpdateEntries(updates: Record<string, any>): Array<[string, any]> {
    const entries = Object.entries(updates);
    const removalsByParent = new Map<string, Array<{ position: number; index: number }>>();

    entries.forEach(([path, value], position) => {
      if (value !== null && value !== undefined) return;

      const segments = parsePropertyPath(path);
      const lastSegment = segments[segments.length - 1];
      if (!/^\d+$/.test(lastSegment.key)) return;

      const parent = segments.slice(0, -1).map(s => s.key).join('.');
      const removals = removalsByParent.get(parent) ?? [];
      removals.push({ position, index: Number(lastSegment.key) });
      removalsByParent.set(parent, removals);
    });

    const ordered = [...entries];
    for (const removals of removalsByParent.values()) {
      if (removals.length < 2) continue;
      const descending = [...removals].sort((a, b) => b.index - a.index);
      removals.forEach(({ position }, i) => {
        ordered[position] = entries[descending[i].position];
      });
    }

    return ordered;
  }

  private applyPatchNodeField(workflow: Workflow, operation: PatchNodeFieldOperation): void {
    const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
    if (!node) return;

    this.modifiedNodeIds.add(node.id);

    const original = this.getNestedProperty(node, operation.fieldPath) as string;
    let current = original;

    for (let i = 0; i < operation.patches.length; i++) {
      const patch = operation.patches[i];

      if (patch.regex) {
        const globalRegex = new RegExp(patch.find, 'g');
        const matches = current.match(globalRegex);

        if (!matches || matches.length === 0) {
          throw new Error(
            `patchNodeField: regex pattern "${patch.find}" not found in "${operation.fieldPath}" (patch index ${i}). ` +
            `Use n8n_get_workflow to inspect the current value.`
          );
        }

        if (matches.length > 1 && !patch.replaceAll) {
          throw new Error(
            `patchNodeField: regex pattern "${patch.find}" matches ${matches.length} times in "${operation.fieldPath}" (patch index ${i}). ` +
            `Set "replaceAll": true to replace all occurrences, or refine the pattern to match exactly once.`
          );
        }

        const regex = patch.replaceAll ? globalRegex : new RegExp(patch.find);
        current = current.replace(regex, patch.replace);
      } else {
        const occurrences = countOccurrences(current, patch.find);

        if (occurrences === 0) {
          throw new Error(
            `patchNodeField: "${patch.find.substring(0, 80)}" not found in "${operation.fieldPath}" (patch index ${i}). ` +
            `Ensure the find string exactly matches the current content (including whitespace and newlines). ` +
            `Use n8n_get_workflow to inspect the current value.`
          );
        }

        if (occurrences > 1 && !patch.replaceAll) {
          throw new Error(
            `patchNodeField: "${patch.find.substring(0, 80)}" found ${occurrences} times in "${operation.fieldPath}" (patch index ${i}). ` +
            `Set "replaceAll": true to replace all occurrences, or use a more specific find string that matches exactly once.`
          );
        }

        // split/join inserts the replacement verbatim; String.replace would read
        // "$&", "$'" and friends in it as JS replacement patterns (#1012). Safe
        // for the single-occurrence case too: the checks above leave exactly one.
        current = current.split(patch.find).join(patch.replace);
      }
    }

    assertPatchedJsSyntax('patchNodeField', operation.fieldPath, current, original);
    this.setNestedProperty(node, operation.fieldPath, current);

    // Sanitize node after updates
    const sanitized = sanitizeNode(node);
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
    operation: AddConnectionOperation | RewireConnectionOperation,
    options: { silent?: boolean } = {}
  ): { sourceOutput: string; sourceIndex: number } {
    const sourceNode = this.findNode(workflow, operation.source, operation.source);

    // Start with explicit values or defaults, coercing to correct types
    let sourceOutput = String(operation.sourceOutput ?? 'main');
    let sourceIndex = operation.sourceIndex ?? 0;

    // Remap numeric sourceOutput (e.g., "0", "1") to "main" with sourceIndex (#537, #659)
    // Skip when smart parameters (branch, case) are present — they take precedence
    const numericOutput = /^\d+$/.test(sourceOutput) ? parseInt(sourceOutput, 10) : null;
    if (numericOutput !== null
        && (operation.sourceIndex === undefined || operation.sourceIndex === numericOutput)
        && operation.branch === undefined && operation.case === undefined) {
      sourceIndex = numericOutput;
      sourceOutput = 'main';
    }

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

    // Validation: Warn if using sourceIndex with If/Switch nodes without smart parameters.
    // Suppressed when called from validate path so warnings don't double-fire (apply phase
    // calls this same helper and is responsible for the user-facing warning).
    if (!options.silent && sourceNode && operation.sourceIndex !== undefined && operation.branch === undefined && operation.case === undefined) {
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
    let targetInput = String(operation.targetInput ?? sourceOutput);
    // Remap numeric targetInput (e.g., "0") to "main" — connection types are named strings (#659)
    if (/^\d+$/.test(targetInput)) {
      targetInput = 'main';
    }
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
    // Resolve all three node refs up front so downstream calls never operate on
    // half-resolved inputs. This prevents the silent-corruption case where an
    // un-resolvable "from" caused removeConnection to no-op while addConnection
    // still appended a duplicate edge to "to". Fail loudly instead.
    const sourceNode = this.findNode(workflow, operation.source, operation.source);
    const fromNode = this.findNode(workflow, operation.from, operation.from);
    const toNode = this.findNode(workflow, operation.to, operation.to);
    if (!sourceNode || !fromNode || !toNode) {
      throw new Error(
        `rewireConnection: unresolved node reference(s). ` +
        `source=${JSON.stringify(operation.source)} (${sourceNode ? 'ok' : 'missing'}), ` +
        `from=${JSON.stringify(operation.from)} (${fromNode ? 'ok' : 'missing'}), ` +
        `to=${JSON.stringify(operation.to)} (${toNode ? 'ok' : 'missing'}). ` +
        `Available nodes: ${workflow.nodes.map(n => `"${n.name}" (${n.id})`).join(', ')}`
      );
    }

    // Catch the case where "from" and "to" are different strings (one ID, one
    // name) that resolve to the same node. The string-level guard in the
    // validator only covers identical inputs; this covers the aliased case.
    if (fromNode.id === toNode.id) {
      throw new Error(
        `rewireConnection: "from" and "to" resolve to the same node "${fromNode.name}" (id: ${fromNode.id}). ` +
        `A rewire requires a distinct target.`
      );
    }

    // Resolve smart parameters (branch, case) to technical parameters
    const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);

    // Count edges to "from" across ALL sourceIndex slots on this output,
    // because `applyRemoveConnection` filters by target node name across the
    // entire output (not just the specific sourceIndex). A per-slot count
    // would throw spuriously when multiple edges to "from" existed.
    const totalFromEdges = (): number => {
      const slots = workflow.connections[sourceNode.name]?.[sourceOutput] ?? [];
      return slots.reduce((acc, slot) => acc + (slot ?? []).filter(c => c.node === fromNode.name).length, 0);
    };
    const fromEdgesBefore = totalFromEdges();
    const toAlreadyPresent = (workflow.connections[sourceNode.name]?.[sourceOutput]?.[sourceIndex] ?? [])
      .some(c => c.node === toNode.name);

    // Remove source → from using resolved names (not raw op strings, which may
    // be IDs that the inner apply would have to re-resolve).
    this.applyRemoveConnection(workflow, {
      type: 'removeConnection',
      source: sourceNode.name,
      target: fromNode.name,
      sourceOutput: sourceOutput,
      targetInput: operation.targetInput
    });

    // Skip the add if "to" was already connected at this slot — otherwise a
    // rewire where "to" is already a target would silently duplicate the edge.
    if (!toAlreadyPresent) {
      this.applyAddConnection(workflow, {
        type: 'addConnection',
        source: sourceNode.name,
        target: toNode.name,
        sourceOutput: sourceOutput,
        targetInput: operation.targetInput,
        sourceIndex: sourceIndex,
        targetIndex: 0
      });
    }

    // Invariant: all edges to "from" on this output must now be gone, since
    // applyRemoveConnection strips every match. If any remain, the map is
    // corrupted — refuse to commit. The diff engine's atomic rollback
    // surfaces the throw to the caller.
    const fromEdgesAfter = totalFromEdges();
    if (fromEdgesBefore > 0 && fromEdgesAfter !== 0) {
      throw new Error(
        `rewireConnection invariant violated: "${sourceNode.name}" → "${fromNode.name}" ` +
        `edges should have been removed (had ${fromEdgesBefore}, still have ${fromEdgesAfter}). ` +
        `Refusing to commit a corrupted connection map.`
      );
    }
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

  /**
   * Validate a canvas-group replacement.
   *
   * Only checks that cannot be wrong on any n8n version: references resolve, names are usable and
   * unique, no node is claimed twice, no group is empty. Whether the members form a groupable shape
   * (connected run, no trigger) is n8n's call — it validates on write and names the offending group,
   * and a local reimplementation of those rules would drift from the running instance.
   *
   * References resolve against the workflow as it stands at this point in the batch, so a group
   * covering a node added by a later operation must come after it.
   */
  private validateSetNodeGroups(workflow: Workflow, operation: SetNodeGroupsOperation): string | null {
    const groups = operation.nodeGroups;
    if (!Array.isArray(groups)) {
      return `setNodeGroups requires a "nodeGroups" array. Pass every group you want to keep, or [] to ungroup everything. Example: {type: "setNodeGroups", nodeGroups: [{name: "Enrich lead", nodeNames: ["Fetch company", "Score lead"]}]}`;
    }

    const seenNames = new Set<string>();
    const claimedNodes = new Map<string, string>();

    for (const group of groups) {
      if (!group || typeof group !== 'object') {
        return `setNodeGroups: every entry must be an object like {name: "Enrich lead", nodeNames: ["Fetch company", "Score lead"]}`;
      }

      const name = typeof group.name === 'string' ? group.name.trim() : '';
      if (!name) {
        return `setNodeGroups: every group needs a non-empty "name"`;
      }
      if (seenNames.has(name)) {
        return `setNodeGroups: duplicate group name "${name}". n8n requires group names to be unique.`;
      }
      seenNames.add(name);

      // This operation's payload is unvalidated (`z.any()` in the tool schema), so every field is
      // checked here. Without it a non-string member reaches normalizeNodeName() and a non-string
      // id reaches toWorkflowNodeGroup(), each throwing a bare "trim is not a function" instead of
      // a message the caller can act on.
      if (group.id !== undefined && (typeof group.id !== 'string' || !group.id.trim())) {
        return `setNodeGroups: group "${name}" has a non-string "id". Omit it to have one generated.`;
      }

      if (group.description !== undefined) {
        if (typeof group.description !== 'string') {
          return `setNodeGroups: group "${name}" has a non-string "description"`;
        }
        if (group.description.trim().length > GROUP_DESCRIPTION_MAX_LENGTH) {
          return `setNodeGroups: group "${name}" has a description of ${group.description.trim().length} characters; n8n allows at most ${GROUP_DESCRIPTION_MAX_LENGTH}.`;
        }
      }

      const hasNames = Array.isArray(group.nodeNames) && group.nodeNames.length > 0;
      const hasIds = Array.isArray(group.nodeIds) && group.nodeIds.length > 0;
      if (hasNames === hasIds) {
        return hasNames
          ? `setNodeGroups: group "${name}" sets both "nodeNames" and "nodeIds" — use one or the other`
          : `setNodeGroups: group "${name}" needs members in "nodeNames" (or "nodeIds")`;
      }

      const members = hasIds ? group.nodeIds! : group.nodeNames!;
      // findIndex, not find: a member that IS `undefined` would make find() return undefined and
      // skip the very guard meant to catch it.
      const badIndex = members.findIndex(member => typeof member !== 'string' || !member.trim());
      if (badIndex !== -1) {
        return `setNodeGroups: group "${name}" has a member that is not a node ${hasIds ? 'ID' : 'name'} (${JSON.stringify(members[badIndex])})`;
      }

      const resolvedMembers = this.resolveGroupMembers(workflow, group);
      if (typeof resolvedMembers === 'string') return resolvedMembers;

      for (const node of resolvedMembers) {
        const owner = claimedNodes.get(node.id);
        // Listing a node twice inside one group is a harmless duplicate — the member set is the
        // same either way, and applySetNodeGroups dedupes it. Only a claim by a DIFFERENT group
        // is a conflict n8n would reject.
        if (owner && owner !== name) {
          return `setNodeGroups: node "${node.name}" is in both "${owner}" and "${name}" — a node can only belong to one group`;
        }
        claimedNodes.set(node.id, name);
      }
    }

    return null;
  }

  /**
   * Resolve a group's members to nodes, or return an error message.
   * IDs match exactly and names match normalized — unlike findNode(), an unresolved ID is never
   * retried as a name, because these fields say which one they are.
   */
  private resolveGroupMembers(
    workflow: Workflow,
    group: SetNodeGroupsOperation['nodeGroups'][number]
  ): WorkflowNode[] | string {
    const label = group.name?.trim() || group.id || 'unnamed group';
    const resolved: WorkflowNode[] = [];

    // Non-emptiness, matching validateSetNodeGroups exactly: an empty `nodeIds` next to a populated
    // `nodeNames` must resolve by name, not silently produce a memberless group.
    if (Array.isArray(group.nodeIds) && group.nodeIds.length > 0) {
      for (const nodeId of group.nodeIds) {
        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) {
          return `setNodeGroups: group "${label}" references node ID "${nodeId}", which is not in the workflow. ${this.formatNodeNotFoundError(workflow, nodeId, 'setNodeGroups')}`;
        }
        resolved.push(node);
      }
      return resolved;
    }

    for (const nodeName of group.nodeNames ?? []) {
      const normalized = this.normalizeNodeName(nodeName);
      const node = workflow.nodes.find(n => this.normalizeNodeName(n.name) === normalized);
      if (!node) {
        return `setNodeGroups: group "${label}" references node "${nodeName}", which is not in the workflow. ${this.formatNodeNotFoundError(workflow, nodeName, 'setNodeGroups')}`;
      }
      resolved.push(node);
    }
    return resolved;
  }

  private applySetNodeGroups(workflow: Workflow, operation: SetNodeGroupsOperation): void {
    const groups: WorkflowNodeGroup[] = [];

    for (const group of operation.nodeGroups) {
      const members = this.resolveGroupMembers(workflow, group);
      // Unreachable: validateSetNodeGroups resolved the same members first. If the two ever
      // disagree, fail loudly rather than write a group validation never approved.
      if (typeof members === 'string') throw new Error(members);

      const resolved = toWorkflowNodeGroup({
        id: group.id,
        name: group.name,
        // Deduped: a node listed twice in one group is a typo, not a different member set.
        nodeIds: [...new Set(members.map(node => node.id))],
        description: group.description
      });
      groups.push(resolved);
      this.authoredGroupNames.add(resolved.name);
    }

    workflow.nodeGroups = groups;
  }

  private authoredGroupNamesOrUndefined(): string[] | undefined {
    return this.authoredGroupNames.size > 0 ? [...this.authoredGroupNames] : undefined;
  }

  /**
   * Reconcile canvas groups with the finished graph, once, before returning.
   *
   * Runs at the end rather than inside removeNode so a node removed and re-added within the same
   * batch keeps its membership, and so a group is judged against the final graph instead of an
   * intermediate one.
   */
  private finalizeNodeGroups(workflow: Workflow): void {
    if (!Array.isArray(workflow.nodeGroups) || workflow.nodeGroups.length === 0) return;

    // Deliberately WITHOUT authoredGroups, unlike the client's pre-write repair. There, a group
    // referencing a node that does not exist is a mistake in the request. Here the only way an
    // authored group can lose a member is that the same batch removed it — an explicit instruction,
    // not a typo — so pruning with a warning is the honest outcome. A group naming a node that was
    // never in the workflow is already rejected by validateSetNodeGroups, before this runs.
    const { nodeGroups, issues } = repairNodeGroups(workflow);
    workflow.nodeGroups = nodeGroups;

    for (const issue of issues) {
      // -1: the adjustment belongs to the batch as a whole, not one operation.
      this.warnings.push({ operation: -1, message: issue.message });
    }
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
    // Activate / deactivate flags are mutually exclusive — clear the opposite
    // so a batch like [activateWorkflow, deactivateWorkflow] ends with
    // last-op-wins semantics instead of first-wins (QA #8).
    (workflow as any)._shouldActivate = true;
    (workflow as any)._shouldDeactivate = false;
  }

  private applyDeactivateWorkflow(workflow: Workflow, operation: DeactivateWorkflowOperation): void {
    (workflow as any)._shouldDeactivate = true;
    (workflow as any)._shouldActivate = false;
  }

  /**
   * Folder move (n8n 2.32+) — rides the regular PUT body as write-only
   * `parentFolderId`: null means project root, a string names the target
   * folder. Whether the folder exists is n8n's call on write.
   */
  private validateMoveToFolder(_workflow: Workflow, operation: MoveToFolderOperation): string | null {
    const target = operation.parentFolderId;
    if (target !== null && (typeof target !== 'string' || target.trim().length === 0)) {
      return 'moveToFolder requires parentFolderId to be a non-empty folder ID string, or null for the project root';
    }
    return null;
  }

  private applyMoveToFolder(workflow: Workflow, operation: MoveToFolderOperation): void {
    const target = operation.parentFolderId;
    workflow.parentFolderId = target === null ? null : target.trim();
  }

  // Transfer operation — uses dedicated API call (PUT /workflows/{id}/transfer)
  private validateTransferWorkflow(_workflow: Workflow, operation: TransferWorkflowOperation): string | null {
    if (!operation.destinationProjectId) {
      return 'transferWorkflow requires a non-empty destinationProjectId string';
    }
    return null;
  }

  private applyTransferWorkflow(_workflow: Workflow, operation: TransferWorkflowOperation): void {
    this.transferToProjectId = operation.destinationProjectId;
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
  private flushPendingRenames(workflow: Workflow): void {
    if (this.renameMap.size === 0) return;

    this.updateConnectionReferences(workflow);
    logger.debug(`Auto-updated ${this.renameMap.size} node name references in connections`);
    this.renameMap.clear();
  }

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
              const oldTargetName = connection.node;
              const newTargetName = renames.get(connection.node)!;
              connection.node = newTargetName;
              logger.debug(`Updated connection: ${sourceName}[${outputType}][${outputIndex}][${connIndex}].node: "${oldTargetName}" → "${newTargetName}"`);
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
    // Single-pass unescape so sequential replacements can't feed into each
    // other. Previously we did three separate `.replace()` calls — but
    // `\\` → `\` first could produce a backslash that the next pass
    // (`\'` → `'`) treated as an escape sequence, silently dropping a
    // backslash in inputs like `\\\\'` (correct normalization: `\\'`,
    // buggy sequential result: `\'`). Addresses CodeQL js/double-escaping.
    return name
      .trim()
      .replace(/\\([\\'"])/g, '$1')
      .replace(/\s+/g, ' ');
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

  private getNestedProperty(obj: any, path: string): any {
    let current = obj;
    try {
      for (const segment of parsePropertyPath(path)) {
        if (DANGEROUS_PATH_KEYS.has(segment.key)) return undefined;
        if (current == null || typeof current !== 'object') return undefined;
        const key = resolveSegment(current, segment, path, false);
        current = current[key];
      }
    } catch {
      // Malformed or unsatisfiable path — the property does not exist.
      return undefined;
    }
    return current;
  }

  private setNestedProperty(obj: any, path: string, value: any): void {
    const segments = parsePropertyPath(path);
    let current = obj;

    // Prototype pollution protection (eager: throw before any write).
    if (segments.some(s => DANGEROUS_PATH_KEYS.has(s.key))) {
      throw new Error(`Invalid property path: "${path}" contains a forbidden key`);
    }

    for (let i = 0; i < segments.length - 1; i++) {
      const key = resolveSegment(current, segments[i], path, true);
      // Per-iteration guard. Redundant with the eager check above (which
      // already throws), but kept so CodeQL's `js/prototype-pollution-utility`
      // dataflow sees the write site is guarded at the point of assignment.
      if (typeof key === 'string' && DANGEROUS_PATH_KEYS.has(key)) {
        throw new Error(`Invalid property path: "${path}" contains a forbidden key`);
      }
      if (!Object.prototype.hasOwnProperty.call(current, key)
          || typeof current[key] !== 'object'
          || current[key] === null) {
        // null or undefined signals deletion — if parent path doesn't exist there's nothing to delete
        if (value === null || value === undefined) return;
        current[key] = {};
      }
      current = current[key];
    }

    const finalKey = resolveSegment(current, segments[segments.length - 1], path, true);
    // Same CodeQL-visible guard at the final write site.
    if (typeof finalKey === 'string' && DANGEROUS_PATH_KEYS.has(finalKey)) {
      throw new Error(`Invalid property path: "${path}" contains a forbidden key`);
    }
    // Both null and undefined remove the property. undefined is accepted because
    // workflow-auto-fixer.ts already uses `{prop: undefined}` to signal removal
    // (see processErrorOutputFixes), so treating only null as the deletion marker
    // left those fixes silently inert at the diff-engine layer.
    if (value === null || value === undefined) {
      // A numeric key only resolves against an array, where deleting in place
      // would leave a hole that serializes back to n8n as a null element.
      if (typeof finalKey === 'number') {
        current.splice(finalKey, 1);
      } else {
        delete current[finalKey];
      }
    } else {
      current[finalKey] = value;
    }
  }
}
