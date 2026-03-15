"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUpdatePartialWorkflow = handleUpdatePartialWorkflow;
const zod_1 = require("zod");
const workflow_diff_engine_1 = require("../services/workflow-diff-engine");
const handlers_n8n_manager_1 = require("./handlers-n8n-manager");
const n8n_errors_1 = require("../utils/n8n-errors");
const logger_1 = require("../utils/logger");
const n8n_validation_1 = require("../services/n8n-validation");
const workflow_versioning_service_1 = require("../services/workflow-versioning-service");
const workflow_validator_1 = require("../services/workflow-validator");
const enhanced_config_validator_1 = require("../services/enhanced-config-validator");
let cachedValidator = null;
function getValidator(repository) {
    if (!cachedValidator) {
        cachedValidator = new workflow_validator_1.WorkflowValidator(repository, enhanced_config_validator_1.EnhancedConfigValidator);
    }
    return cachedValidator;
}
const NODE_TARGETING_OPERATIONS = new Set([
    'updateNode', 'removeNode', 'moveNode', 'enableNode', 'disableNode'
]);
const workflowDiffSchema = zod_1.z.object({
    id: zod_1.z.string(),
    operations: zod_1.z.array(zod_1.z.object({
        type: zod_1.z.string(),
        description: zod_1.z.string().optional(),
        node: zod_1.z.any().optional(),
        nodeId: zod_1.z.string().optional(),
        nodeName: zod_1.z.string().optional(),
        updates: zod_1.z.any().optional(),
        position: zod_1.z.tuple([zod_1.z.number(), zod_1.z.number()]).optional(),
        source: zod_1.z.string().optional(),
        target: zod_1.z.string().optional(),
        from: zod_1.z.string().optional(),
        to: zod_1.z.string().optional(),
        sourceOutput: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform(String).optional(),
        targetInput: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform(String).optional(),
        sourceIndex: zod_1.z.number().optional(),
        targetIndex: zod_1.z.number().optional(),
        branch: zod_1.z.enum(['true', 'false']).optional(),
        case: zod_1.z.number().optional(),
        ignoreErrors: zod_1.z.boolean().optional(),
        dryRun: zod_1.z.boolean().optional(),
        connections: zod_1.z.any().optional(),
        settings: zod_1.z.any().optional(),
        name: zod_1.z.string().optional(),
        tag: zod_1.z.string().optional(),
        id: zod_1.z.string().optional(),
    }).transform((op) => {
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
    validateOnly: zod_1.z.boolean().optional(),
    continueOnError: zod_1.z.boolean().optional(),
    createBackup: zod_1.z.boolean().optional(),
    intent: zod_1.z.string().optional(),
});
async function handleUpdatePartialWorkflow(args, repository, context) {
    const startTime = Date.now();
    const sessionId = `mutation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    let workflowBefore = null;
    let validationBefore = null;
    let validationAfter = null;
    try {
        if (process.env.DEBUG_MCP === 'true') {
            logger_1.logger.debug('Workflow diff request received', {
                argsType: typeof args,
                hasWorkflowId: args && typeof args === 'object' && 'workflowId' in args,
                operationCount: args && typeof args === 'object' && 'operations' in args ?
                    args.operations?.length : 0
            });
        }
        const input = workflowDiffSchema.parse(args);
        const client = (0, handlers_n8n_manager_1.getN8nApiClient)(context);
        if (!client) {
            return {
                success: false,
                error: 'n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.'
            };
        }
        let workflow;
        try {
            workflow = await client.getWorkflow(input.id);
            workflowBefore = JSON.parse(JSON.stringify(workflow));
            try {
                const validator = getValidator(repository);
                validationBefore = await validator.validateWorkflow(workflowBefore, {
                    validateNodes: true,
                    validateConnections: true,
                    validateExpressions: true,
                    profile: 'runtime'
                });
            }
            catch (validationError) {
                logger_1.logger.debug('Pre-mutation validation failed (non-blocking):', validationError);
                validationBefore = {
                    valid: false,
                    errors: [{ type: 'validation_error', message: 'Validation failed' }]
                };
            }
        }
        catch (error) {
            if (error instanceof n8n_errors_1.N8nApiError) {
                return {
                    success: false,
                    error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                    code: error.code
                };
            }
            throw error;
        }
        if (input.createBackup !== false && !input.validateOnly) {
            try {
                const versioningService = new workflow_versioning_service_1.WorkflowVersioningService(repository, client);
                const backupResult = await versioningService.createBackup(input.id, workflow, {
                    trigger: 'partial_update',
                    operations: input.operations
                });
                logger_1.logger.info('Workflow backup created', {
                    workflowId: input.id,
                    versionId: backupResult.versionId,
                    versionNumber: backupResult.versionNumber,
                    pruned: backupResult.pruned
                });
            }
            catch (error) {
                logger_1.logger.warn('Failed to create workflow backup', {
                    workflowId: input.id,
                    error: error.message
                });
            }
        }
        const diffEngine = new workflow_diff_engine_1.WorkflowDiffEngine();
        const diffRequest = input;
        const diffResult = await diffEngine.applyDiff(workflow, diffRequest);
        if (!diffResult.success) {
            if (diffRequest.continueOnError && diffResult.workflow && diffResult.operationsApplied && diffResult.operationsApplied > 0) {
                logger_1.logger.info(`continueOnError mode: Applying ${diffResult.operationsApplied} successful operations despite ${diffResult.failed?.length || 0} failures`);
            }
            else {
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
        if (diffResult.workflow) {
            const structureErrors = (0, n8n_validation_1.validateWorkflowStructure)(diffResult.workflow);
            if (structureErrors.length > 0) {
                const skipValidation = process.env.SKIP_WORKFLOW_VALIDATION === 'true';
                logger_1.logger.warn('Workflow structure validation failed after applying diff operations', {
                    workflowId: input.id,
                    errors: structureErrors,
                    blocking: !skipValidation
                });
                const errorTypes = new Set();
                structureErrors.forEach(err => {
                    if (err.includes('operator') || err.includes('singleValue'))
                        errorTypes.add('operator_issues');
                    if (err.includes('connection') || err.includes('referenced'))
                        errorTypes.add('connection_issues');
                    if (err.includes('Missing') || err.includes('missing'))
                        errorTypes.add('missing_metadata');
                    if (err.includes('branch') || err.includes('output'))
                        errorTypes.add('branch_mismatch');
                });
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
                if (recoverySteps.length === 0) {
                    recoverySteps.push('Review the validation errors listed above');
                    recoverySteps.push('Fix issues using updateNode or cleanStaleConnections operations');
                    recoverySteps.push('Run validate_workflow again to verify fixes');
                }
                const errorMessage = structureErrors.length === 1
                    ? `Workflow validation failed: ${structureErrors[0]}`
                    : `Workflow validation failed with ${structureErrors.length} structural issues`;
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
                logger_1.logger.info('Workflow validation skipped (SKIP_WORKFLOW_VALIDATION=true): Allowing workflow with validation warnings to proceed', {
                    workflowId: input.id,
                    warningCount: structureErrors.length
                });
            }
        }
        try {
            const updatedWorkflow = await client.updateWorkflow(input.id, diffResult.workflow);
            let tagWarnings = [];
            if (diffResult.tagsToAdd?.length || diffResult.tagsToRemove?.length) {
                try {
                    const existingTags = Array.isArray(updatedWorkflow.tags)
                        ? updatedWorkflow.tags.map((t) => typeof t === 'object' ? { id: t.id, name: t.name } : { id: '', name: t })
                        : [];
                    const allTags = await client.listTags();
                    const tagMap = new Map();
                    for (const t of allTags.data) {
                        if (t.id)
                            tagMap.set(t.name.toLowerCase(), t.id);
                    }
                    for (const tagName of (diffResult.tagsToAdd || [])) {
                        if (!tagMap.has(tagName.toLowerCase())) {
                            try {
                                const newTag = await client.createTag({ name: tagName });
                                if (newTag.id)
                                    tagMap.set(tagName.toLowerCase(), newTag.id);
                            }
                            catch (createErr) {
                                tagWarnings.push(`Failed to create tag "${tagName}": ${createErr instanceof Error ? createErr.message : 'Unknown error'}`);
                            }
                        }
                    }
                    const currentTagIds = new Set();
                    for (const et of existingTags) {
                        if (et.id) {
                            currentTagIds.add(et.id);
                        }
                        else {
                            const resolved = tagMap.get(et.name.toLowerCase());
                            if (resolved)
                                currentTagIds.add(resolved);
                        }
                    }
                    for (const tagName of (diffResult.tagsToAdd || [])) {
                        const tagId = tagMap.get(tagName.toLowerCase());
                        if (tagId)
                            currentTagIds.add(tagId);
                    }
                    for (const tagName of (diffResult.tagsToRemove || [])) {
                        const tagId = tagMap.get(tagName.toLowerCase());
                        if (tagId)
                            currentTagIds.delete(tagId);
                    }
                    await client.updateWorkflowTags(input.id, Array.from(currentTagIds));
                }
                catch (tagError) {
                    tagWarnings.push(`Tag update failed: ${tagError instanceof Error ? tagError.message : 'Unknown error'}`);
                    logger_1.logger.warn('Tag operations failed (non-blocking)', tagError);
                }
            }
            let finalWorkflow = updatedWorkflow;
            let activationMessage = '';
            try {
                const validator = getValidator(repository);
                validationAfter = await validator.validateWorkflow(finalWorkflow, {
                    validateNodes: true,
                    validateConnections: true,
                    validateExpressions: true,
                    profile: 'runtime'
                });
            }
            catch (validationError) {
                logger_1.logger.debug('Post-mutation validation failed (non-blocking):', validationError);
                validationAfter = {
                    valid: false,
                    errors: [{ type: 'validation_error', message: 'Validation failed' }]
                };
            }
            if (diffResult.shouldActivate) {
                try {
                    finalWorkflow = await client.activateWorkflow(input.id);
                    activationMessage = ' Workflow activated.';
                }
                catch (activationError) {
                    logger_1.logger.error('Failed to activate workflow after update', activationError);
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
            }
            else if (diffResult.shouldDeactivate) {
                try {
                    finalWorkflow = await client.deactivateWorkflow(input.id);
                    activationMessage = ' Workflow deactivated.';
                }
                catch (deactivationError) {
                    logger_1.logger.error('Failed to deactivate workflow after update', deactivationError);
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
                    logger_1.logger.debug('Failed to track mutation telemetry:', err);
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
        }
        catch (error) {
            if (workflowBefore && !input.validateOnly) {
                trackWorkflowMutation({
                    sessionId,
                    toolName: 'n8n_update_partial_workflow',
                    userIntent: input.intent || 'Partial workflow update',
                    operations: input.operations,
                    workflowBefore,
                    workflowAfter: workflowBefore,
                    validationBefore,
                    validationAfter: validationBefore,
                    mutationSuccess: false,
                    mutationError: error instanceof Error ? error.message : 'Unknown error',
                    durationMs: Date.now() - startTime,
                }).catch(err => {
                    logger_1.logger.warn('Failed to track mutation telemetry for failed operation:', err);
                });
            }
            if (error instanceof n8n_errors_1.N8nApiError) {
                return {
                    success: false,
                    error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                    code: error.code,
                    details: error.details
                };
            }
            throw error;
        }
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: {
                    errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
                }
            };
        }
        logger_1.logger.error('Failed to update partial workflow', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
function mergeWarnings(diffWarnings, tagWarnings) {
    const merged = [
        ...(diffWarnings || []),
        ...tagWarnings.map(w => ({ operation: -1, message: w }))
    ];
    return merged.length > 0 ? merged : undefined;
}
function inferIntentFromOperations(operations) {
    if (!operations || operations.length === 0) {
        return 'Partial workflow update';
    }
    const opTypes = operations.map((op) => op.type);
    const opCount = operations.length;
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
    const typeSet = new Set(opTypes);
    const summary = [];
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
async function trackWorkflowMutation(data) {
    try {
        if (!data.userIntent ||
            data.userIntent === 'Partial workflow update' ||
            data.userIntent.length < 10) {
            data.userIntent = inferIntentFromOperations(data.operations);
        }
        const { telemetry } = await Promise.resolve().then(() => __importStar(require('../telemetry/telemetry-manager.js')));
        await telemetry.trackWorkflowMutation(data);
    }
    catch (error) {
        logger_1.logger.debug('Telemetry tracking failed:', error);
    }
}
//# sourceMappingURL=handlers-workflow-diff.js.map