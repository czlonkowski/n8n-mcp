/**
 * MCP Handler for Partial Workflow Updates
 * Handles diff-based workflow modifications
 */

import { z } from 'zod';
import { McpToolResponse } from '../types/n8n-api';
import { WorkflowDiffRequest, WorkflowDiffOperation, WorkflowDiffValidationError } from '../types/workflow-diff';
import { WorkflowDiffEngine } from '../services/workflow-diff-engine';
import { getN8nApiClient } from './handlers-n8n-manager';
import { N8nApiError, getUserFriendlyErrorMessage } from '../utils/n8n-errors';
import { logger } from '../utils/logger';
import { InstanceContext } from '../types/instance-context';
import { validateWorkflowStructure } from '../services/n8n-validation';
import { NodeRepository } from '../database/node-repository';
import { WorkflowVersioningService } from '../services/workflow-versioning-service';
import { WorkflowValidator } from '../services/workflow-validator';
import { EnhancedConfigValidator } from '../services/enhanced-config-validator';

// Cached validator instance to avoid recreating on every mutation
let cachedValidator: WorkflowValidator | null = null;

/**
 * Get or create cached workflow validator instance
 * Reuses the same validator to avoid redundant NodeSimilarityService initialization
 */
function getValidator(repository: NodeRepository): WorkflowValidator {
  if (!cachedValidator) {
    cachedValidator = new WorkflowValidator(repository, EnhancedConfigValidator);
  }
  return cachedValidator;
}

// Operation types that identify nodes by nodeId/nodeName
const NODE_TARGETING_OPERATIONS = new Set([
  'updateNode', 'removeNode', 'moveNode', 'enableNode', 'disableNode'
]);

// Zod schema for the diff request
const workflowDiffSchema = z.object({
  id: z.string(),
  operations: z.array(z.object({
    type: z.string(),
    description: z.string().optional(),
    // Node operations
    node: z.any().optional(),
    nodeId: z.string().optional(),
    nodeName: z.string().optional(),
    updates: z.any().optional(),
    position: z.tuple([z.number(), z.number()]).optional(),
    // Connection operations
    source: z.string().optional(),
    target: z.string().optional(),
    from: z.string().optional(),  // For rewireConnection
    to: z.string().optional(),    // For rewireConnection
    sourceOutput: z.union([z.string(), z.number()]).transform(String).optional(),
    targetInput: z.union([z.string(), z.number()]).transform(String).optional(),
    sourceIndex: z.number().optional(),
    targetIndex: z.number().optional(),
    // Smart parameters (Phase 1 UX improvement)
    branch: z.enum(['true', 'false']).optional(),
    case: z.number().optional(),
    ignoreErrors: z.boolean().optional(),
    // Connection cleanup operations
    dryRun: z.boolean().optional(),
    connections: z.any().optional(),
    // Metadata operations
    settings: z.any().optional(),
    name: z.string().optional(),
    tag: z.string().optional(),
    // Aliases: LLMs often use "id" instead of "nodeId" — accept both
    id: z.string().optional(),
  }).transform((op) => {
    // Normalize common field aliases for node-targeting operations:
    // - "name" → "nodeName" (LLMs confuse the updateName "name" field with node identification)
    // - "id" → "nodeId" (natural alias)
    if (NODE_TARGETING_OPERATIONS.has(op.type)) {
      if (!op.nodeName && !op.nodeId && op.name) {
        op.nodeName = op.name;
        op.name = undefined;
      }
      if (!op.nodeId && op.id) {
        op.nodeId = op.id;
        op.id = undefined;
      }
    }
    return op;
  })),
  validateOnly: z.boolean().optional(),
  continueOnError: z.boolean().optional(),
  createBackup: z.boolean().optional(),
  intent: z.string().optional(),
});

export async function handleUpdatePartialWorkflow(
  args: unknown,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  const startTime = Date.now();
  const sessionId = `mutation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  let workflowBefore: any = null;
  let validationBefore: any = null;
  let validationAfter: any = null;

  try {
    // Debug logging (only in debug mode)
    if (process.env.DEBUG_MCP === 'true') {
      logger.debug('Workflow diff request received', {
        argsType: typeof args,
        hasWorkflowId: args && typeof args === 'object' && 'workflowId' in args,
        operationCount: args && typeof args === 'object' && 'operations' in args ?
          (args as any).operations?.length : 0
      });
    }

    // Validate input
    const input = workflowDiffSchema.parse(args);

    // Get API client
    const client = getN8nApiClient(context);
    if (!client) {
      return {
        success: false,
        error: 'n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.'
      };
    }

    // Fetch current workflow
    let workflow;
    try {
      workflow = await client.getWorkflow(input.id);
      // Store original workflow for telemetry
      workflowBefore = JSON.parse(JSON.stringify(workflow));

      // Validate workflow BEFORE mutation (for telemetry)
      try {
        const validator = getValidator(repository);
        validationBefore = await validator.validateWorkflow(workflowBefore, {
          validateNodes: true,
          validateConnections: true,
          validateExpressions: true,
          profile: 'runtime'
        });
      } catch (validationError) {
        logger.debug('Pre-mutation validation failed (non-blocking):', validationError);
        // Don't block mutation on validation errors
        validationBefore = {
          valid: false,
          errors: [{ type: 'validation_error', message: 'Validation failed' }]
        };
      }
    } catch (error) {
      if (error instanceof N8nApiError) {
        return {
          success: false,
          error: getUserFriendlyErrorMessage(error),
          code: error.code
        };
      }
      throw error;
    }

    // Create backup before modifying workflow (default: true)
    if (input.createBackup !== false && !input.validateOnly) {
      try {
        const versioningService = new WorkflowVersioningService(repository, client);
        const backupResult = await versioningService.createBackup(input.id, workflow, {
          trigger: 'partial_update',
          operations: input.operations
        });

        logger.info('Workflow backup created', {
          workflowId: input.id,
          versionId: backupResult.versionId,
          versionNumber: backupResult.versionNumber,
          pruned: backupResult.pruned
        });
      } catch (error: any) {
        logger.warn('Failed to create workflow backup', {
          workflowId: input.id,
          error: error.message
        });
        // Continue with update even if backup fails (non-blocking)
      }
    }

    // Apply diff operations
    const diffEngine = new WorkflowDiffEngine();
    const diffRequest = input as WorkflowDiffRequest;
    const diffResult = await diffEngine.applyDiff(workflow, diffRequest);

    // Check if this is a complete failure or partial success in continueOnError mode
    if (!diffResult.success) {
      // In continueOnError mode, partial success is still valuable
      if (diffRequest.continueOnError && diffResult.workflow && diffResult.operationsApplied && diffResult.operationsApplied > 0) {
        logger.info(`continueOnError mode: Applying ${diffResult.operationsApplied} successful operations despite ${diffResult.failed?.length || 0} failures`);
        // Continue to update workflow with partial changes
      } else {
        // Complete failure - return error
        return {
          success: false,
          saved: false,
          error: 'Failed to apply diff operations',
          operationsApplied: diffResult.operationsApplied,
          details: {
            errors: diffResult.errors,
            warnings: diffResult.warnings,
            applied: diffResult.applied,
            failed: diffResult.failed
          }
        };
      }
    }
    
    // If validateOnly, return validation result
    if (input.validateOnly) {
      return {
        success: true,
        message: diffResult.message,
        data: {
          valid: true,
          operationsToApply: input.operations.length
        },
        details: {
          warnings: diffResult.warnings
        }
      };
    }

    // Validate final workflow structure after applying all operations
    // This prevents creating workflows that pass operation-level validation
    // but fail workflow-level validation (e.g., UI can't render them)
    //
    // Validation can be skipped for specific integration tests that need to test
    // n8n API behavior with edge case workflows by setting SKIP_WORKFLOW_VALIDATION=true
    if (diffResult.workflow) {
      const structureErrors = validateWorkflowStructure(diffResult.workflow);
      if (structureErrors.length > 0) {
        const skipValidation = process.env.SKIP_WORKFLOW_VALIDATION === 'true';

        logger.warn('Workflow structure validation failed after applying diff operations', {
          workflowId: input.id,
          errors: structureErrors,
          blocking: !skipValidation
        });

        // Analyze error types to provide targeted recovery guidance
        const errorTypes = new Set<string>();
        structureErrors.forEach(err => {
          if (err.includes('operator') || err.includes('singleValue')) errorTypes.add('operator_issues');
          if (err.includes('connection') || err.includes('referenced')) errorTypes.add('connection_issues');
          if (err.includes('Missing') || err.includes('missing')) errorTypes.add('missing_metadata');
          if (err.includes('branch') || err.includes('output')) errorTypes.add('branch_mismatch');
        });

        // Build recovery guidance based on error types
        const recoverySteps = [];
        if (errorTypes.has('operator_issues')) {
          recoverySteps.push('Operator structure issue detected. Use validate_node_operation to check specific nodes.');
          recoverySteps.push('Binary operators (equals, contains, greaterThan, etc.) must NOT have singleValue:true');
          recoverySteps.push('Unary operators (isEmpty, isNotEmpty, true, false) REQUIRE singleValue:true');
        }
        if (errorTypes.has('connection_issues')) {
          recoverySteps.push('Connection validation failed. Check all node connections reference existing nodes.');
          recoverySteps.push('Use cleanStaleConnections operation to remove connections to non-existent nodes.');
        }
        if (errorTypes.has('missing_metadata')) {
          recoverySteps.push('Missing metadata detected. Ensure filter-based nodes (IF v2.2+, Switch v3.2+) have complete conditions.options.');
          recoverySteps.push('Required options: {version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict"}');
        }
        if (errorTypes.has('branch_mismatch')) {
          recoverySteps.push('Branch count mismatch. Ensure Switch nodes have outputs for all rules (e.g., 3 rules = 3 output branches).');
        }

        // Add generic recovery steps if no specific guidance
        if (recoverySteps.length === 0) {
          recoverySteps.push('Review the validation errors listed above');
          recoverySteps.push('Fix issues using updateNode or cleanStaleConnections operations');
          recoverySteps.push('Run validate_workflow again to verify fixes');
        }

        const errorMessage = structureErrors.length === 1
          ? `Workflow validation failed: ${structureErrors[0]}`
          : `Workflow validation failed with ${structureErrors.length} structural issues`;

        // If validation is not skipped, return error and block the save
        if (!skipValidation) {
          return {
            success: false,
            saved: false,
            error: errorMessage,
            details: {
              errors: structureErrors,
              errorCount: structureErrors.length,
              operationsApplied: diffResult.operationsApplied,
              applied: diffResult.applied,
              recoveryGuidance: recoverySteps,
              note: 'Operations were applied but created an invalid workflow structure. The workflow was NOT saved to n8n to prevent UI rendering errors.',
              autoSanitizationNote: 'Auto-sanitization runs on modified nodes during updates to fix operator structures and add missing metadata. However, it cannot fix all issues (e.g., broken connections, branch mismatches). Use the recovery guidance above to resolve remaining issues.'
            }
          };
        }
        // Validation skipped: log warning but continue (for specific integration tests)
        logger.info('Workflow validation skipped (SKIP_WORKFLOW_VALIDATION=true): Allowing workflow with validation warnings to proceed', {
          workflowId: input.id,
          warningCount: structureErrors.length
        });
      }
    }

    // Update workflow via API
    try {
      const updatedWorkflow = await client.updateWorkflow(input.id, diffResult.workflow!);

      // Handle tag operations via dedicated API (#599)
      let tagWarnings: string[] = [];
      if (diffResult.tagsToAdd?.length || diffResult.tagsToRemove?.length) {
        try {
          // Get existing tags from the updated workflow
          const existingTags: Array<{ id: string; name: string }> = Array.isArray(updatedWorkflow.tags)
            ? updatedWorkflow.tags.map((t: any) => typeof t === 'object' ? { id: t.id, name: t.name } : { id: '', name: t })
            : [];

          // Resolve tag names to IDs
          const allTags = await client.listTags();
          const tagMap = new Map<string, string>();
          for (const t of allTags.data) {
            if (t.id) tagMap.set(t.name.toLowerCase(), t.id);
          }

          // Create any tags that don't exist yet
          for (const tagName of (diffResult.tagsToAdd || [])) {
            if (!tagMap.has(tagName.toLowerCase())) {
              try {
                const newTag = await client.createTag({ name: tagName });
                if (newTag.id) tagMap.set(tagName.toLowerCase(), newTag.id);
              } catch (createErr) {
                tagWarnings.push(`Failed to create tag "${tagName}": ${createErr instanceof Error ? createErr.message : 'Unknown error'}`);
              }
            }
          }

          // Compute final tag set — resolve string-type tags via tagMap
          const currentTagIds = new Set<string>();
          for (const et of existingTags) {
            if (et.id) {
              currentTagIds.add(et.id);
            } else {
              const resolved = tagMap.get(et.name.toLowerCase());
              if (resolved) currentTagIds.add(resolved);
            }
          }

          for (const tagName of (diffResult.tagsToAdd || [])) {
            const tagId = tagMap.get(tagName.toLowerCase());
            if (tagId) currentTagIds.add(tagId);
          }

          for (const tagName of (diffResult.tagsToRemove || [])) {
            const tagId = tagMap.get(tagName.toLowerCase());
            if (tagId) currentTagIds.delete(tagId);
          }

          // Update workflow tags via dedicated API
          await client.updateWorkflowTags(input.id, Array.from(currentTagIds));
        } catch (tagError) {
          tagWarnings.push(`Tag update failed: ${tagError instanceof Error ? tagError.message : 'Unknown error'}`);
          logger.warn('Tag operations failed (non-blocking)', tagError);
        }
      }

      // Handle activation/deactivation if requested
      let finalWorkflow = updatedWorkflow;
      let activationMessage = '';

      // Validate workflow AFTER mutation (for telemetry)
      try {
        const validator = getValidator(repository);
        validationAfter = await validator.validateWorkflow(finalWorkflow, {
          validateNodes: true,
          validateConnections: true,
          validateExpressions: true,
          profile: 'runtime'
        });
      } catch (validationError) {
        logger.debug('Post-mutation validation failed (non-blocking):', validationError);
        // Don't block on validation errors
        validationAfter = {
          valid: false,
          errors: [{ type: 'validation_error', message: 'Validation failed' }]
        };
      }

      if (diffResult.shouldActivate) {
        try {
          finalWorkflow = await client.activateWorkflow(input.id);
          activationMessage = ' Workflow activated.';
        } catch (activationError) {
          logger.error('Failed to activate workflow after update', activationError);
          return {
            success: false,
            saved: true,
            error: 'Workflow updated successfully but activation failed',
            details: {
              workflowUpdated: true,
              activationError: activationError instanceof Error ? activationError.message : 'Unknown error'
            }
          };
        }
      } else if (diffResult.shouldDeactivate) {
        try {
          finalWorkflow = await client.deactivateWorkflow(input.id);
          activationMessage = ' Workflow deactivated.';
        } catch (deactivationError) {
          logger.error('Failed to deactivate workflow after update', deactivationError);
          return {
            success: false,
            saved: true,
            error: 'Workflow updated successfully but deactivation failed',
            details: {
              workflowUpdated: true,
              deactivationError: deactivationError instanceof Error ? deactivationError.message : 'Unknown error'
            }
          };
        }
      }

      // Track successful mutation
      if (workflowBefore && !input.validateOnly) {
        trackWorkflowMutation({
          sessionId,
          toolName: 'n8n_update_partial_workflow',
          userIntent: input.intent || 'Partial workflow update',
          operations: input.operations,
          workflowBefore,
          workflowAfter: finalWorkflow,
          validationBefore,
          validationAfter,
          mutationSuccess: true,
          durationMs: Date.now() - startTime,
        }).catch(err => {
          logger.debug('Failed to track mutation telemetry:', err);
        });
      }

      return {
        success: true,
        saved: true,
        data: {
          id: finalWorkflow.id,
          name: finalWorkflow.name,
          active: finalWorkflow.active,
          nodeCount: finalWorkflow.nodes?.length || 0,
          operationsApplied: diffResult.operationsApplied
        },
        message: `Workflow "${finalWorkflow.name}" updated successfully. Applied ${diffResult.operationsApplied} operations.${activationMessage} Use n8n_get_workflow with mode 'structure' to verify current state.`,
        details: {
          applied: diffResult.applied,
          failed: diffResult.failed,
          errors: diffResult.errors,
          warnings: mergeWarnings(diffResult.warnings, tagWarnings)
        }
      };
    } catch (error) {
      // Track failed mutation
      if (workflowBefore && !input.validateOnly) {
        trackWorkflowMutation({
          sessionId,
          toolName: 'n8n_update_partial_workflow',
          userIntent: input.intent || 'Partial workflow update',
          operations: input.operations,
          workflowBefore,
          workflowAfter: workflowBefore, // No change since it failed
          validationBefore,
          validationAfter: validationBefore, // Same as before since mutation failed
          mutationSuccess: false,
          mutationError: error instanceof Error ? error.message : 'Unknown error',
          durationMs: Date.now() - startTime,
        }).catch(err => {
          logger.warn('Failed to track mutation telemetry for failed operation:', err);
        });
      }

      if (error instanceof N8nApiError) {
        return {
          success: false,
          error: getUserFriendlyErrorMessage(error),
          code: error.code,
          details: error.details as Record<string, unknown> | undefined
        };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: {
          errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        }
      };
    }

    logger.error('Failed to update partial workflow', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Merge diff engine warnings with tag operation warnings into a single array.
 * Returns undefined when there are no warnings to keep the response clean.
 */
function mergeWarnings(
  diffWarnings: WorkflowDiffValidationError[] | undefined,
  tagWarnings: string[]
): WorkflowDiffValidationError[] | undefined {
  const merged: WorkflowDiffValidationError[] = [
    ...(diffWarnings || []),
    ...tagWarnings.map(w => ({ operation: -1, message: w }))
  ];
  return merged.length > 0 ? merged : undefined;
}

/**
 * Infer intent from operations when not explicitly provided
 */
function inferIntentFromOperations(operations: any[]): string {
  if (!operations || operations.length === 0) {
    return 'Partial workflow update';
  }

  const opTypes = operations.map((op) => op.type);
  const opCount = operations.length;

  // Single operation - be specific
  if (opCount === 1) {
    const op = operations[0];
    switch (op.type) {
      case 'addNode':
        return `Add ${op.node?.type || 'node'}`;
      case 'removeNode':
        return `Remove node ${op.nodeName || op.nodeId || ''}`.trim();
      case 'updateNode':
        return `Update node ${op.nodeName || op.nodeId || ''}`.trim();
      case 'addConnection':
        return `Connect ${op.source || 'node'} to ${op.target || 'node'}`;
      case 'removeConnection':
        return `Disconnect ${op.source || 'node'} from ${op.target || 'node'}`;
      case 'rewireConnection':
        return `Rewire ${op.source || 'node'} from ${op.from || ''} to ${op.to || ''}`.trim();
      case 'updateName':
        return `Rename workflow to "${op.name || ''}"`;
      case 'activateWorkflow':
        return 'Activate workflow';
      case 'deactivateWorkflow':
        return 'Deactivate workflow';
      default:
        return `Workflow ${op.type}`;
    }
  }

  // Multiple operations - summarize pattern
  const typeSet = new Set(opTypes);
  const summary: string[] = [];

  if (typeSet.has('addNode')) {
    const count = opTypes.filter((t) => t === 'addNode').length;
    summary.push(`add ${count} node${count > 1 ? 's' : ''}`);
  }
  if (typeSet.has('removeNode')) {
    const count = opTypes.filter((t) => t === 'removeNode').length;
    summary.push(`remove ${count} node${count > 1 ? 's' : ''}`);
  }
  if (typeSet.has('updateNode')) {
    const count = opTypes.filter((t) => t === 'updateNode').length;
    summary.push(`update ${count} node${count > 1 ? 's' : ''}`);
  }
  if (typeSet.has('addConnection') || typeSet.has('rewireConnection')) {
    summary.push('modify connections');
  }
  if (typeSet.has('updateName') || typeSet.has('updateSettings')) {
    summary.push('update metadata');
  }

  return summary.length > 0
    ? `Workflow update: ${summary.join(', ')}`
    : `Workflow update: ${opCount} operations`;
}

/**
 * Track workflow mutation for telemetry
 */
async function trackWorkflowMutation(data: any): Promise<void> {
  try {
    // Enhance intent if it's missing or generic
    if (
      !data.userIntent ||
      data.userIntent === 'Partial workflow update' ||
      data.userIntent.length < 10
    ) {
      data.userIntent = inferIntentFromOperations(data.operations);
    }

    const { telemetry } = await import('../telemetry/telemetry-manager.js');
    await telemetry.trackWorkflowMutation(data);
  } catch (error) {
    logger.debug('Telemetry tracking failed:', error);
  }
}

