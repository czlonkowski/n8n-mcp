/**
 * Workflow Diff Types
 * Defines the structure for partial workflow updates using diff operations
 */

import { WorkflowNode, WorkflowConnection } from './n8n-api';

// Base operation interface
export interface DiffOperation {
  type: string;
  description?: string; // Optional description for clarity
}

// Node Operations
export interface AddNodeOperation extends DiffOperation {
  type: 'addNode';
  node: Partial<WorkflowNode> & {
    name: string; // Name is required
    type: string; // Type is required
    position: [number, number]; // Position is required
  };
}

export interface RemoveNodeOperation extends DiffOperation {
  type: 'removeNode';
  nodeId?: string; // Can use either ID or name
  nodeName?: string;
}

export interface UpdateNodeOperation extends DiffOperation {
  type: 'updateNode';
  nodeId?: string; // Can use either ID or name
  nodeName?: string;
  updates: {
    [path: string]: any; // Dot notation paths like 'parameters.url'
  };
}

export interface MoveNodeOperation extends DiffOperation {
  type: 'moveNode';
  nodeId?: string;
  nodeName?: string;
  position: [number, number];
}

export interface EnableNodeOperation extends DiffOperation {
  type: 'enableNode';
  nodeId?: string;
  nodeName?: string;
}

export interface DisableNodeOperation extends DiffOperation {
  type: 'disableNode';
  nodeId?: string;
  nodeName?: string;
}

export interface PatchNodeFieldOperation extends DiffOperation {
  type: 'patchNodeField';
  nodeId?: string;
  nodeName?: string;
  fieldPath: string;          // Dot-notation path, e.g. "parameters.jsCode"
  patches: Array<{
    find: string;
    replace: string;
    replaceAll?: boolean;     // Default: false. Replace all occurrences.
    regex?: boolean;          // Default: false. Treat find as a regex pattern.
  }>;
}

// Connection Operations
export interface AddConnectionOperation extends DiffOperation {
  type: 'addConnection';
  source: string; // Node name or ID
  target: string; // Node name or ID
  sourceOutput?: string; // Default: 'main'
  targetInput?: string; // Default: 'main'
  sourceIndex?: number; // Default: 0
  targetIndex?: number; // Default: 0
  // Smart parameters for multi-output nodes (Phase 1 UX improvement)
  branch?: 'true' | 'false'; // For IF nodes: maps to sourceIndex (0=true, 1=false)
  case?: number; // For Switch/multi-output nodes: maps to sourceIndex
}

export interface RemoveConnectionOperation extends DiffOperation {
  type: 'removeConnection';
  source: string; // Node name or ID
  target: string; // Node name or ID
  sourceOutput?: string; // Default: 'main'
  targetInput?: string; // Default: 'main'
  ignoreErrors?: boolean; // If true, don't fail when connection doesn't exist (useful for cleanup)
}

export interface RewireConnectionOperation extends DiffOperation {
  type: 'rewireConnection';
  source: string;      // Source node name or ID
  from: string;        // Current target to rewire FROM
  to: string;          // New target to rewire TO
  sourceOutput?: string;  // Optional: which output to rewire (default: 'main')
  targetInput?: string;   // Optional: which input type (default: 'main')
  sourceIndex?: number;   // Optional: which source index (default: 0)
  // Smart parameters for multi-output nodes (Phase 1 UX improvement)
  branch?: 'true' | 'false'; // For IF nodes: maps to sourceIndex (0=true, 1=false)
  case?: number; // For Switch/multi-output nodes: maps to sourceIndex
}

// Workflow Metadata Operations
export interface UpdateSettingsOperation extends DiffOperation {
  type: 'updateSettings';
  settings: {
    [key: string]: any;
  };
}

export interface UpdateNameOperation extends DiffOperation {
  type: 'updateName';
  name: string;
}

/**
 * Replace the workflow's canvas groups (n8n 2.28+). Full replacement, like replaceConnections:
 * pass every group you want to keep, or an empty array to ungroup everything.
 *
 * Members are addressed by name or by ID: supply exactly one populated list per group. Sending both
 * with one of them empty is accepted (the populated one wins) because that shape is common in
 * generated payloads; sending both populated is rejected as ambiguous. n8n itself decides whether
 * the resulting shape is groupable (a connected run, no trigger inside); its rejection is returned
 * verbatim rather than second-guessed here.
 */
export interface SetNodeGroupsOperation extends DiffOperation {
  type: 'setNodeGroups';
  nodeGroups: Array<{
    id?: string;          // Generated when omitted
    name: string;
    nodeNames?: string[]; // Member node names
    nodeIds?: string[];   // Member node IDs
    description?: string; // n8n 2.32+ only; silently dropped on older instances
  }>;
}

export interface AddTagOperation extends DiffOperation {
  type: 'addTag';
  tag: string;
}

export interface RemoveTagOperation extends DiffOperation {
  type: 'removeTag';
  tag: string;
}

export interface ActivateWorkflowOperation extends DiffOperation {
  type: 'activateWorkflow';
  // No additional properties needed - just activates the workflow
}

export interface DeactivateWorkflowOperation extends DiffOperation {
  type: 'deactivateWorkflow';
  // No additional properties needed - just deactivates the workflow
}

export interface TransferWorkflowOperation extends DiffOperation {
  type: 'transferWorkflow';
  destinationProjectId: string;
}

/**
 * Move the workflow into a folder, or to the project root (n8n 2.32+).
 * n8n's PUT schema treats the field as write-only: null means project root,
 * a string means the target folder ID. Instances older than 2.32 reject the
 * field outright, which surfaces as a 400 naming parentFolderId.
 */
export interface MoveToFolderOperation extends DiffOperation {
  type: 'moveToFolder';
  parentFolderId: string | null;
}

// Connection Cleanup Operations
export interface CleanStaleConnectionsOperation extends DiffOperation {
  type: 'cleanStaleConnections';
  dryRun?: boolean; // If true, return what would be removed without applying changes
}

export interface ReplaceConnectionsOperation extends DiffOperation {
  type: 'replaceConnections';
  connections: {
    [nodeName: string]: {
      [outputName: string]: Array<Array<{
        node: string;
        type: string;
        index: number;
      }>>;
    };
  };
}

// Union type for all operations
export type WorkflowDiffOperation =
  | AddNodeOperation
  | RemoveNodeOperation
  | UpdateNodeOperation
  | PatchNodeFieldOperation
  | MoveNodeOperation
  | EnableNodeOperation
  | DisableNodeOperation
  | AddConnectionOperation
  | RemoveConnectionOperation
  | RewireConnectionOperation
  | UpdateSettingsOperation
  | UpdateNameOperation
  | SetNodeGroupsOperation
  | AddTagOperation
  | RemoveTagOperation
  | ActivateWorkflowOperation
  | DeactivateWorkflowOperation
  | CleanStaleConnectionsOperation
  | ReplaceConnectionsOperation
  | TransferWorkflowOperation
  | MoveToFolderOperation;

// Main diff request structure
export interface WorkflowDiffRequest {
  id: string; // Workflow ID
  operations: WorkflowDiffOperation[];
  validateOnly?: boolean; // If true, only validate without applying
  continueOnError?: boolean; // If true, apply valid operations even if some fail (default: false for atomic behavior)
}

// Response types
export interface WorkflowDiffValidationError {
  operation: number; // Index of the operation that failed
  message: string;
  details?: any;
}

export interface WorkflowDiffResult {
  success: boolean;
  workflow?: any; // Updated workflow if successful
  errors?: WorkflowDiffValidationError[];
  warnings?: WorkflowDiffValidationError[]; // Non-blocking warnings (e.g., parameter suggestions)
  operationsApplied?: number;
  message?: string;
  applied?: number[]; // Indices of successfully applied operations (when continueOnError is true)
  failed?: number[]; // Indices of failed operations (when continueOnError is true)
  staleConnectionsRemoved?: Array<{ from: string; to: string }>; // For cleanStaleConnections operation
  shouldActivate?: boolean; // Flag to activate workflow after update (for activateWorkflow operation)
  shouldDeactivate?: boolean; // Flag to deactivate workflow after update (for deactivateWorkflow operation)
  tagsToAdd?: string[];
  tagsToRemove?: string[];
  transferToProjectId?: string; // For transferWorkflow operation - uses dedicated API call
  /**
   * Names of canvas groups this diff authored (via setNodeGroups). The caller passes these to the
   * API client so an n8n rejection of a group the user just asked for surfaces as an error instead
   * of being silently ungrouped.
   */
  authoredGroupNames?: string[];
}

// Helper type for node reference (supports both ID and name)
export interface NodeReference {
  id?: string;
  name?: string;
}

// Utility functions type guards
export function isNodeOperation(op: WorkflowDiffOperation): op is
  AddNodeOperation | RemoveNodeOperation | UpdateNodeOperation | PatchNodeFieldOperation |
  MoveNodeOperation | EnableNodeOperation | DisableNodeOperation {
  return ['addNode', 'removeNode', 'updateNode', 'patchNodeField', 'moveNode', 'enableNode', 'disableNode'].includes(op.type);
}

export function isConnectionOperation(op: WorkflowDiffOperation): op is
  AddConnectionOperation | RemoveConnectionOperation | RewireConnectionOperation | CleanStaleConnectionsOperation | ReplaceConnectionsOperation {
  return ['addConnection', 'removeConnection', 'rewireConnection', 'cleanStaleConnections', 'replaceConnections'].includes(op.type);
}

export function isMetadataOperation(op: WorkflowDiffOperation): op is
  UpdateSettingsOperation | UpdateNameOperation | SetNodeGroupsOperation | AddTagOperation | RemoveTagOperation {
  return ['updateSettings', 'updateName', 'setNodeGroups', 'addTag', 'removeTag'].includes(op.type);
}