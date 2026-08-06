/**
 * Types and interfaces for workflow mutation tracking
 * Purpose: Track workflow transformations to improve partial updates tooling
 */

import { DiffOperation } from '../types/workflow-diff.js';

/**
 * Intent classification for workflow mutations
 */
export enum IntentClassification {
  ADD_FUNCTIONALITY = 'add_functionality',
  MODIFY_CONFIGURATION = 'modify_configuration',
  REWIRE_LOGIC = 'rewire_logic',
  FIX_VALIDATION = 'fix_validation',
  CLEANUP = 'cleanup',
  UNKNOWN = 'unknown',
}

/**
 * Tool names that perform workflow mutations
 */
export enum MutationToolName {
  UPDATE_PARTIAL = 'n8n_update_partial_workflow',
  UPDATE_FULL = 'n8n_update_full_workflow',
}

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    type: string;
    message: string;
    severity?: string;
    location?: string;
  }>;
  warnings?: Array<{
    type: string;
    message: string;
  }>;
}

/**
 * Change metrics calculated from workflow mutation
 */
export interface MutationChangeMetrics {
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  connectionsAdded: number;
  connectionsRemoved: number;
  propertiesChanged: number;
}

/**
 * Validation improvement metrics
 */
export interface MutationValidationMetrics {
  validationImproved: boolean | null;
  errorsResolved: number;
  errorsIntroduced: number;
}

/**
 * Input data for tracking a workflow mutation
 */
export interface WorkflowMutationData {
  sessionId: string;
  toolName: MutationToolName;
  userIntent: string;
  operations: DiffOperation[];
  workflowBefore: any;
  workflowAfter: any;
  validationBefore?: ValidationResult;
  validationAfter?: ValidationResult;
  mutationSuccess: boolean;
  mutationError?: string;
  durationMs: number;
}

/**
 * Complete mutation record for database storage
 */
export interface WorkflowMutationRecord {
  id?: string;
  userId: string;
  sessionId: string;
  /**
   * Post-mutation workflow only. The pre-mutation snapshot is used locally for
   * hashing, deduplication, and change detection, then discarded — the before
   * hashes below are what identify the prior state.
   */
  workflowAfter: any;
  workflowHashBefore: string;
  workflowHashAfter: string;
  /** Structural hash (nodeTypes + connections) for cross-referencing with telemetry_workflows */
  workflowStructureHashBefore?: string;
  /** Structural hash (nodeTypes + connections) for cross-referencing with telemetry_workflows */
  workflowStructureHashAfter?: string;
  /** Computed field: true if mutation executed successfully, improved validation, and has known intent */
  isTrulySuccessful?: boolean;
  userIntent: string;
  intentClassification: IntentClassification;
  toolName: MutationToolName;
  operations: DiffOperation[];
  operationCount: number;
  operationTypes: string[];
  validationBefore?: ValidationResult;
  validationAfter?: ValidationResult;
  validationImproved: boolean | null;
  errorsResolved: number;
  errorsIntroduced: number;
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  connectionsAdded: number;
  connectionsRemoved: number;
  propertiesChanged: number;
  mutationSuccess: boolean;
  mutationError?: string;
  durationMs: number;
  createdAt?: Date;
}

/**
 * Options for mutation tracking
 */
export interface MutationTrackingOptions {
  /** Whether to track this mutation (default: true) */
  enabled?: boolean;

  /** Maximum workflow size in KB to track (default: 500) */
  maxWorkflowSizeKb?: number;

  /** Whether to validate data quality before tracking (default: true) */
  validateQuality?: boolean;

  /** Whether to sanitize workflows for PII (default: true) */
  sanitize?: boolean;
}

/**
 * Mutation tracking statistics for monitoring
 */
export interface MutationTrackingStats {
  totalMutationsTracked: number;
  successfulMutations: number;
  failedMutations: number;
  mutationsWithValidationImprovement: number;
  averageDurationMs: number;
  intentClassificationBreakdown: Record<IntentClassification, number>;
  operationTypeBreakdown: Record<string, number>;
}

/**
 * Data quality validation result
 */
export interface MutationDataQualityResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
