/**
 * Intent classifier for workflow mutations
 * Analyzes operations to determine the intent/pattern of the mutation
 */

import { DiffOperation } from '../types/workflow-diff.js';
import { IntentClassification } from './mutation-types.js';

/**
 * Classifies the intent of a workflow mutation based on operations performed
 */
export class IntentClassifier {
  /**
   * Classify mutation intent from operations and optional user intent text
   */
  classify(operations: DiffOperation[], userIntent?: string): IntentClassification {
    if (operations.length === 0) {
      return IntentClassification.UNKNOWN;
    }

    // First, try to classify from user intent text if provided
    if (userIntent) {
      const textClassification = this.classifyFromText(userIntent);
      if (textClassification !== IntentClassification.UNKNOWN) {
        return textClassification;
      }
    }

    // Fall back to operation pattern analysis
    return this.classifyFromOperations(operations);
  }

  /**
   * Classify from user intent text using keyword matching
   */
  private classifyFromText(intent: string): IntentClassification {
    const lowerIntent = intent.toLowerCase();

    // Fix validation errors
    if (
      lowerIntent.includes('fix') ||
      lowerIntent.includes('resolve') ||
      lowerIntent.includes('correct') ||
      lowerIntent.includes('repair') ||
      lowerIntent.includes('error')
    ) {
      return IntentClassification.FIX_VALIDATION;
    }

    // Add new functionality
    if (
      lowerIntent.includes('add') ||
      lowerIntent.includes('create') ||
      lowerIntent.includes('insert') ||
      lowerIntent.includes('new node')
    ) {
      return IntentClassification.ADD_FUNCTIONALITY;
    }

    // Modify configuration
    if (
      lowerIntent.includes('update') ||
      lowerIntent.includes('change') ||
      lowerIntent.includes('modify') ||
      lowerIntent.includes('configure') ||
      lowerIntent.includes('set')
    ) {
      return IntentClassification.MODIFY_CONFIGURATION;
    }

    // Rewire logic
    if (
      lowerIntent.includes('connect') ||
      lowerIntent.includes('reconnect') ||
      lowerIntent.includes('rewire') ||
      lowerIntent.includes('reroute') ||
      lowerIntent.includes('link')
    ) {
      return IntentClassification.REWIRE_LOGIC;
    }

    // Cleanup
    if (
      lowerIntent.includes('remove') ||
      lowerIntent.includes('delete') ||
      lowerIntent.includes('clean') ||
      lowerIntent.includes('disable')
    ) {
      return IntentClassification.CLEANUP;
    }

    return IntentClassification.UNKNOWN;
  }

  /**
   * Classify from operation patterns
   */
  private classifyFromOperations(operations: DiffOperation[]): IntentClassification {
    const opTypes = operations.map((op) => op.type);
    const opTypeSet = new Set(opTypes);

    // Pattern: Adding nodes and connections (add functionality)
    if (opTypeSet.has('addNode') && opTypeSet.has('addConnection')) {
      return IntentClassification.ADD_FUNCTIONALITY;
    }

    // Pattern: Only adding nodes (add functionality)
    if (opTypeSet.has('addNode') && !opTypeSet.has('removeNode')) {
      return IntentClassification.ADD_FUNCTIONALITY;
    }

    // Pattern: Removing nodes or connections (cleanup)
    if (opTypeSet.has('removeNode') || opTypeSet.has('removeConnection')) {
      return IntentClassification.CLEANUP;
    }

    // Pattern: Disabling nodes (cleanup)
    if (opTypeSet.has('disableNode')) {
      return IntentClassification.CLEANUP;
    }

    // Pattern: Rewiring connections
    if (
      opTypeSet.has('rewireConnection') ||
      opTypeSet.has('replaceConnections') ||
      (opTypeSet.has('addConnection') && opTypeSet.has('removeConnection'))
    ) {
      return IntentClassification.REWIRE_LOGIC;
    }

    // Pattern: Only updating nodes (modify configuration)
    if (opTypeSet.has('updateNode') && opTypes.every((t) => t === 'updateNode')) {
      return IntentClassification.MODIFY_CONFIGURATION;
    }

    // Pattern: Updating settings or metadata (modify configuration)
    if (
      opTypeSet.has('updateSettings') ||
      opTypeSet.has('updateName') ||
      opTypeSet.has('setNodeGroups') ||
      opTypeSet.has('addTag') ||
      opTypeSet.has('removeTag')
    ) {
      return IntentClassification.MODIFY_CONFIGURATION;
    }

    // Pattern: Mix of updates with some additions/removals (modify configuration)
    if (opTypeSet.has('updateNode')) {
      return IntentClassification.MODIFY_CONFIGURATION;
    }

    // Pattern: Moving nodes (modify configuration)
    if (opTypeSet.has('moveNode')) {
      return IntentClassification.MODIFY_CONFIGURATION;
    }

    // Pattern: Enabling nodes (could be fixing)
    if (opTypeSet.has('enableNode')) {
      return IntentClassification.FIX_VALIDATION;
    }

    // Pattern: Clean stale connections (cleanup)
    if (opTypeSet.has('cleanStaleConnections')) {
      return IntentClassification.CLEANUP;
    }

    return IntentClassification.UNKNOWN;
  }

  /**
   * Get confidence score for classification (0-1)
   * Higher score means more confident in the classification
   */
  getConfidence(
    classification: IntentClassification,
    operations: DiffOperation[],
    userIntent?: string
  ): number {
    // High confidence if user intent matches operation pattern
    if (userIntent && this.classifyFromText(userIntent) === classification) {
      return 0.9;
    }

    // Medium-high confidence for clear operation patterns
    if (classification !== IntentClassification.UNKNOWN) {
      const opTypes = new Set(operations.map((op) => op.type));

      // Very clear patterns get high confidence
      if (
        classification === IntentClassification.ADD_FUNCTIONALITY &&
        opTypes.has('addNode')
      ) {
        return 0.8;
      }

      if (
        classification === IntentClassification.CLEANUP &&
        (opTypes.has('removeNode') || opTypes.has('removeConnection'))
      ) {
        return 0.8;
      }

      if (
        classification === IntentClassification.REWIRE_LOGIC &&
        opTypes.has('rewireConnection')
      ) {
        return 0.8;
      }

      // Other patterns get medium confidence
      return 0.6;
    }

    // Low confidence for unknown classification
    return 0.3;
  }

  /**
   * Get human-readable description of the classification
   */
  getDescription(classification: IntentClassification): string {
    switch (classification) {
      case IntentClassification.ADD_FUNCTIONALITY:
        return 'Adding new nodes or functionality to the workflow';
      case IntentClassification.MODIFY_CONFIGURATION:
        return 'Modifying configuration of existing nodes';
      case IntentClassification.REWIRE_LOGIC:
        return 'Changing workflow execution flow by rewiring connections';
      case IntentClassification.FIX_VALIDATION:
        return 'Fixing validation errors or issues';
      case IntentClassification.CLEANUP:
        return 'Removing or disabling nodes and connections';
      case IntentClassification.UNKNOWN:
        return 'Unknown or complex mutation pattern';
      default:
        return 'Unclassified mutation';
    }
  }
}

/**
 * Singleton instance for easy access
 */
export const intentClassifier = new IntentClassifier();
