/**
 * Core mutation tracker for workflow transformations
 * Coordinates validation, classification, and metric calculation
 */

import { DiffOperation } from '../types/workflow-diff.js';
import {
  WorkflowMutationData,
  WorkflowMutationRecord,
  MutationChangeMetrics,
  MutationValidationMetrics,
  IntentClassification,
} from './mutation-types.js';
import { intentClassifier } from './intent-classifier.js';
import { mutationValidator } from './mutation-validator.js';
import { intentSanitizer } from './intent-sanitizer.js';
import { WorkflowSanitizer } from './workflow-sanitizer.js';
import { logger } from '../utils/logger.js';

/**
 * Tracks workflow mutations and prepares data for telemetry
 */
export class MutationTracker {
  private recentMutations: Array<{
    hashBefore: string;
    hashAfter: string;
    operations: DiffOperation[];
  }> = [];

  private readonly RECENT_MUTATIONS_LIMIT = 100;

  /**
   * Process and prepare mutation data for tracking
   */
  async processMutation(data: WorkflowMutationData, userId: string): Promise<WorkflowMutationRecord | null> {
    try {
      // Validate data quality
      if (!this.validateMutationData(data)) {
        logger.debug('Mutation data validation failed');
        return null;
      }

      // Sanitize workflows to remove credentials and sensitive data
      const workflowBefore = WorkflowSanitizer.sanitizeWorkflowRaw(data.workflowBefore);
      const workflowAfter = WorkflowSanitizer.sanitizeWorkflowRaw(data.workflowAfter);

      // SECURITY (GHSA-8g7g-hmwm-6rv2): redact caller-supplied operations,
      // validation results, and error messages before storing in the telemetry record.
      const sanitizedOperations = WorkflowSanitizer.sanitizeTelemetryObject<DiffOperation[]>(
        data.operations
      );
      const sanitizedValidationBefore = WorkflowSanitizer.sanitizeTelemetryObject(
        data.validationBefore
      );
      const sanitizedValidationAfter = WorkflowSanitizer.sanitizeTelemetryObject(
        data.validationAfter
      );
      const sanitizedMutationError = WorkflowSanitizer.sanitizeTelemetryObject<string | undefined>(
        data.mutationError
      );

      // Sanitize user intent
      const sanitizedIntent = intentSanitizer.sanitize(data.userIntent);

      // Check if should be excluded
      if (mutationValidator.shouldExclude(data)) {
        logger.debug('Mutation excluded from tracking based on quality criteria');
        return null;
      }

      // Check for duplicates
      if (
        mutationValidator.isDuplicate(
          workflowBefore,
          workflowAfter,
          data.operations,
          this.recentMutations
        )
      ) {
        logger.debug('Duplicate mutation detected, skipping tracking');
        return null;
      }

      // Generate hashes
      const hashBefore = mutationValidator.hashWorkflow(workflowBefore);
      const hashAfter = mutationValidator.hashWorkflow(workflowAfter);

      // Generate structural hashes for cross-referencing with telemetry_workflows
      const structureHashBefore = WorkflowSanitizer.generateWorkflowHash(workflowBefore);
      const structureHashAfter = WorkflowSanitizer.generateWorkflowHash(workflowAfter);

      // Classify intent
      const intentClassification = intentClassifier.classify(data.operations, sanitizedIntent);

      // Calculate metrics
      const changeMetrics = this.calculateChangeMetrics(data.operations);
      const validationMetrics = this.calculateValidationMetrics(
        data.validationBefore,
        data.validationAfter
      );

      // Create mutation record
      const record: WorkflowMutationRecord = {
        userId,
        sessionId: data.sessionId,
        workflowBefore,
        workflowAfter,
        workflowHashBefore: hashBefore,
        workflowHashAfter: hashAfter,
        workflowStructureHashBefore: structureHashBefore,
        workflowStructureHashAfter: structureHashAfter,
        userIntent: sanitizedIntent,
        intentClassification,
        toolName: data.toolName,
        operations: sanitizedOperations,
        operationCount: data.operations.length,
        operationTypes: this.extractOperationTypes(data.operations),
        validationBefore: sanitizedValidationBefore,
        validationAfter: sanitizedValidationAfter,
        ...validationMetrics,
        ...changeMetrics,
        mutationSuccess: data.mutationSuccess,
        mutationError: sanitizedMutationError,
        durationMs: data.durationMs,
      };

      // Store in recent mutations for deduplication
      this.addToRecentMutations(hashBefore, hashAfter, data.operations);

      return record;
    } catch (error) {
      logger.error('Error processing mutation:', error);
      return null;
    }
  }

  /**
   * Validate mutation data
   */
  private validateMutationData(data: WorkflowMutationData): boolean {
    const validationResult = mutationValidator.validate(data);

    if (!validationResult.valid) {
      logger.warn('Mutation data validation failed:', validationResult.errors);
      return false;
    }

    if (validationResult.warnings.length > 0) {
      logger.debug('Mutation data validation warnings:', validationResult.warnings);
    }

    return true;
  }

  /**
   * Calculate change metrics from operations
   */
  private calculateChangeMetrics(operations: DiffOperation[]): MutationChangeMetrics {
    const metrics: MutationChangeMetrics = {
      nodesAdded: 0,
      nodesRemoved: 0,
      nodesModified: 0,
      connectionsAdded: 0,
      connectionsRemoved: 0,
      propertiesChanged: 0,
    };

    for (const op of operations) {
      switch (op.type) {
        case 'addNode':
          metrics.nodesAdded++;
          break;
        case 'removeNode':
          metrics.nodesRemoved++;
          break;
        case 'updateNode':
          metrics.nodesModified++;
          if ('updates' in op && op.updates) {
            metrics.propertiesChanged += Object.keys(op.updates as any).length;
          }
          break;
        case 'addConnection':
          metrics.connectionsAdded++;
          break;
        case 'removeConnection':
          metrics.connectionsRemoved++;
          break;
        case 'rewireConnection':
          // Rewiring is effectively removing + adding
          metrics.connectionsRemoved++;
          metrics.connectionsAdded++;
          break;
        case 'replaceConnections':
          // Count how many connections are being replaced
          if ('connections' in op && op.connections) {
            metrics.connectionsRemoved++;
            metrics.connectionsAdded++;
          }
          break;
        case 'updateSettings':
          if ('settings' in op && op.settings) {
            metrics.propertiesChanged += Object.keys(op.settings as any).length;
          }
          break;
        case 'moveNode':
        case 'enableNode':
        case 'disableNode':
        case 'updateName':
        case 'addTag':
        case 'removeTag':
        case 'activateWorkflow':
        case 'deactivateWorkflow':
        case 'cleanStaleConnections':
          // These don't directly affect node/connection counts
          // but count as property changes
          metrics.propertiesChanged++;
          break;
      }
    }

    return metrics;
  }


  /**
   * Calculate validation improvement metrics
   */
  private calculateValidationMetrics(
    validationBefore: any,
    validationAfter: any
  ): MutationValidationMetrics {
    // If validation data is missing, return nulls
    if (!validationBefore || !validationAfter) {
      return {
        validationImproved: null,
        errorsResolved: 0,
        errorsIntroduced: 0,
      };
    }

    const errorsBefore = validationBefore.errors?.length || 0;
    const errorsAfter = validationAfter.errors?.length || 0;

    const errorsResolved = Math.max(0, errorsBefore - errorsAfter);
    const errorsIntroduced = Math.max(0, errorsAfter - errorsBefore);

    const validationImproved = errorsBefore > errorsAfter;

    return {
      validationImproved,
      errorsResolved,
      errorsIntroduced,
    };
  }

  /**
   * Extract unique operation types from operations
   */
  private extractOperationTypes(operations: DiffOperation[]): string[] {
    const types = new Set(operations.map((op) => op.type));
    return Array.from(types);
  }

  /**
   * Add mutation to recent list for deduplication
   */
  private addToRecentMutations(
    hashBefore: string,
    hashAfter: string,
    operations: DiffOperation[]
  ): void {
    this.recentMutations.push({ hashBefore, hashAfter, operations });

    // Keep only recent mutations
    if (this.recentMutations.length > this.RECENT_MUTATIONS_LIMIT) {
      this.recentMutations.shift();
    }
  }

  /**
   * Clear recent mutations (useful for testing)
   */
  clearRecentMutations(): void {
    this.recentMutations = [];
  }

  /**
   * Get statistics about tracked mutations
   */
  getRecentMutationsCount(): number {
    return this.recentMutations.length;
  }
}

/**
 * Singleton instance for easy access
 */
export const mutationTracker = new MutationTracker();
