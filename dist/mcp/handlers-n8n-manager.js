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
exports.getInstanceCacheStatistics = getInstanceCacheStatistics;
exports.getInstanceCacheMetrics = getInstanceCacheMetrics;
exports.clearInstanceCache = clearInstanceCache;
exports.getN8nApiClient = getN8nApiClient;
exports.handleCreateWorkflow = handleCreateWorkflow;
exports.handleGetWorkflow = handleGetWorkflow;
exports.handleGetWorkflowDetails = handleGetWorkflowDetails;
exports.handleGetWorkflowStructure = handleGetWorkflowStructure;
exports.handleGetWorkflowMinimal = handleGetWorkflowMinimal;
exports.handleUpdateWorkflow = handleUpdateWorkflow;
exports.handleDeleteWorkflow = handleDeleteWorkflow;
exports.handleListWorkflows = handleListWorkflows;
exports.handleValidateWorkflow = handleValidateWorkflow;
exports.handleAutofixWorkflow = handleAutofixWorkflow;
exports.handleTestWorkflow = handleTestWorkflow;
exports.handleGetExecution = handleGetExecution;
exports.handleListExecutions = handleListExecutions;
exports.handleDeleteExecution = handleDeleteExecution;
exports.handleHealthCheck = handleHealthCheck;
exports.handleDiagnostic = handleDiagnostic;
exports.handleWorkflowVersions = handleWorkflowVersions;
exports.handleDeployTemplate = handleDeployTemplate;
exports.handleTriggerWebhookWorkflow = handleTriggerWebhookWorkflow;
exports.handleCreateTable = handleCreateTable;
exports.handleListTables = handleListTables;
exports.handleGetTable = handleGetTable;
exports.handleUpdateTable = handleUpdateTable;
exports.handleDeleteTable = handleDeleteTable;
exports.handleGetRows = handleGetRows;
exports.handleInsertRows = handleInsertRows;
exports.handleUpdateRows = handleUpdateRows;
exports.handleUpsertRows = handleUpsertRows;
exports.handleDeleteRows = handleDeleteRows;
const n8n_api_client_1 = require("../services/n8n-api-client");
const n8n_api_1 = require("../config/n8n-api");
const n8n_api_2 = require("../types/n8n-api");
const n8n_validation_1 = require("../services/n8n-validation");
const n8n_errors_1 = require("../utils/n8n-errors");
const logger_1 = require("../utils/logger");
const zod_1 = require("zod");
const workflow_validator_1 = require("../services/workflow-validator");
const enhanced_config_validator_1 = require("../services/enhanced-config-validator");
const instance_context_1 = require("../types/instance-context");
const workflow_auto_fixer_1 = require("../services/workflow-auto-fixer");
const expression_format_validator_1 = require("../services/expression-format-validator");
const workflow_versioning_service_1 = require("../services/workflow-versioning-service");
const handlers_workflow_diff_1 = require("./handlers-workflow-diff");
const telemetry_1 = require("../telemetry");
const cache_utils_1 = require("../utils/cache-utils");
const execution_processor_1 = require("../services/execution-processor");
const npm_version_checker_1 = require("../utils/npm-version-checker");
let defaultApiClient = null;
let lastDefaultConfigUrl = null;
const cacheMutex = new cache_utils_1.CacheMutex();
const instanceClients = (0, cache_utils_1.createInstanceCache)((client, key) => {
    logger_1.logger.debug('Evicting API client from cache', {
        cacheKey: key.substring(0, 8) + '...'
    });
});
function getInstanceCacheStatistics() {
    return (0, cache_utils_1.getCacheStatistics)();
}
function getInstanceCacheMetrics() {
    return cache_utils_1.cacheMetrics.getMetrics();
}
function clearInstanceCache() {
    instanceClients.clear();
    cache_utils_1.cacheMetrics.recordClear();
    cache_utils_1.cacheMetrics.updateSize(0, instanceClients.max);
}
function getN8nApiClient(context) {
    if (context?.n8nApiUrl && context?.n8nApiKey) {
        const validation = (0, instance_context_1.validateInstanceContext)(context);
        if (!validation.valid) {
            logger_1.logger.warn('Invalid instance context provided', {
                instanceId: context.instanceId,
                errors: validation.errors
            });
            return null;
        }
        const cacheKey = (0, cache_utils_1.createCacheKey)(`${context.n8nApiUrl}:${context.n8nApiKey}:${context.instanceId || ''}`);
        if (instanceClients.has(cacheKey)) {
            cache_utils_1.cacheMetrics.recordHit();
            return instanceClients.get(cacheKey) || null;
        }
        cache_utils_1.cacheMetrics.recordMiss();
        if (cacheMutex.isLocked(cacheKey)) {
            const waitTime = 100;
            const start = Date.now();
            while (cacheMutex.isLocked(cacheKey) && (Date.now() - start) < 1000) {
            }
            if (instanceClients.has(cacheKey)) {
                cache_utils_1.cacheMetrics.recordHit();
                return instanceClients.get(cacheKey) || null;
            }
        }
        const config = (0, n8n_api_1.getN8nApiConfigFromContext)(context);
        if (config) {
            logger_1.logger.info('Creating instance-specific n8n API client', {
                url: config.baseUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1'),
                instanceId: context.instanceId,
                cacheKey: cacheKey.substring(0, 8) + '...'
            });
            const client = new n8n_api_client_1.N8nApiClient(config);
            instanceClients.set(cacheKey, client);
            cache_utils_1.cacheMetrics.recordSet();
            cache_utils_1.cacheMetrics.updateSize(instanceClients.size, instanceClients.max);
            return client;
        }
        return null;
    }
    logger_1.logger.info('Falling back to environment configuration for n8n API client');
    const config = (0, n8n_api_1.getN8nApiConfig)();
    if (!config) {
        if (defaultApiClient) {
            logger_1.logger.info('n8n API configuration removed, clearing default client');
            defaultApiClient = null;
            lastDefaultConfigUrl = null;
        }
        return null;
    }
    if (!defaultApiClient || lastDefaultConfigUrl !== config.baseUrl) {
        logger_1.logger.info('n8n API client initialized from environment', { url: config.baseUrl });
        defaultApiClient = new n8n_api_client_1.N8nApiClient(config);
        lastDefaultConfigUrl = config.baseUrl;
    }
    return defaultApiClient;
}
function ensureApiConfigured(context) {
    const client = getN8nApiClient(context);
    if (!client) {
        if (context?.instanceId) {
            throw new Error(`n8n API not configured for instance ${context.instanceId}. Please provide n8nApiUrl and n8nApiKey in the instance context.`);
        }
        throw new Error('n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.');
    }
    return client;
}
const createWorkflowSchema = zod_1.z.object({
    name: zod_1.z.string(),
    nodes: zod_1.z.array(zod_1.z.any()),
    connections: zod_1.z.record(zod_1.z.any()),
    settings: zod_1.z.object({
        executionOrder: zod_1.z.enum(['v0', 'v1']).optional(),
        timezone: zod_1.z.string().optional(),
        saveDataErrorExecution: zod_1.z.enum(['all', 'none']).optional(),
        saveDataSuccessExecution: zod_1.z.enum(['all', 'none']).optional(),
        saveManualExecutions: zod_1.z.boolean().optional(),
        saveExecutionProgress: zod_1.z.boolean().optional(),
        executionTimeout: zod_1.z.number().optional(),
        errorWorkflow: zod_1.z.string().optional(),
    }).optional(),
    projectId: zod_1.z.string().optional(),
});
const updateWorkflowSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string().optional(),
    nodes: zod_1.z.array(zod_1.z.any()).optional(),
    connections: zod_1.z.record(zod_1.z.any()).optional(),
    settings: zod_1.z.any().optional(),
    createBackup: zod_1.z.boolean().optional(),
    intent: zod_1.z.string().optional(),
});
const listWorkflowsSchema = zod_1.z.object({
    limit: zod_1.z.number().min(1).max(100).optional(),
    cursor: zod_1.z.string().optional(),
    active: zod_1.z.boolean().optional(),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    projectId: zod_1.z.string().optional(),
    excludePinnedData: zod_1.z.boolean().optional(),
});
const validateWorkflowSchema = zod_1.z.object({
    id: zod_1.z.string(),
    options: zod_1.z.object({
        validateNodes: zod_1.z.boolean().optional(),
        validateConnections: zod_1.z.boolean().optional(),
        validateExpressions: zod_1.z.boolean().optional(),
        profile: zod_1.z.enum(['minimal', 'runtime', 'ai-friendly', 'strict']).optional(),
    }).optional(),
});
const autofixWorkflowSchema = zod_1.z.object({
    id: zod_1.z.string(),
    applyFixes: zod_1.z.boolean().optional().default(false),
    fixTypes: zod_1.z.array(zod_1.z.enum([
        'expression-format',
        'typeversion-correction',
        'error-output-config',
        'node-type-correction',
        'webhook-missing-path',
        'typeversion-upgrade',
        'version-migration',
        'tool-variant-correction',
        'connection-numeric-keys',
        'connection-invalid-type',
        'connection-id-to-name',
        'connection-duplicate-removal',
        'connection-input-index'
    ])).optional(),
    confidenceThreshold: zod_1.z.enum(['high', 'medium', 'low']).optional().default('medium'),
    maxFixes: zod_1.z.number().optional().default(50)
});
const testWorkflowSchema = zod_1.z.object({
    workflowId: zod_1.z.string(),
    triggerType: zod_1.z.enum(['webhook', 'form', 'chat']).optional(),
    httpMethod: zod_1.z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    webhookPath: zod_1.z.string().optional(),
    message: zod_1.z.string().optional(),
    sessionId: zod_1.z.string().optional(),
    data: zod_1.z.record(zod_1.z.unknown()).optional(),
    headers: zod_1.z.record(zod_1.z.string()).optional(),
    timeout: zod_1.z.number().optional(),
    waitForResponse: zod_1.z.boolean().optional(),
});
const listExecutionsSchema = zod_1.z.object({
    limit: zod_1.z.number().min(1).max(100).optional(),
    cursor: zod_1.z.string().optional(),
    workflowId: zod_1.z.string().optional(),
    projectId: zod_1.z.string().optional(),
    status: zod_1.z.enum(['success', 'error', 'waiting']).optional(),
    includeData: zod_1.z.boolean().optional(),
});
const workflowVersionsSchema = zod_1.z.object({
    mode: zod_1.z.enum(['list', 'get', 'rollback', 'delete', 'prune', 'truncate']),
    workflowId: zod_1.z.string().optional(),
    versionId: zod_1.z.number().optional(),
    limit: zod_1.z.number().default(10).optional(),
    validateBefore: zod_1.z.boolean().default(true).optional(),
    deleteAll: zod_1.z.boolean().default(false).optional(),
    maxVersions: zod_1.z.number().default(10).optional(),
    confirmTruncate: zod_1.z.boolean().default(false).optional(),
});
async function handleCreateWorkflow(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = createWorkflowSchema.parse(args);
        const shortFormErrors = [];
        input.nodes?.forEach((node, index) => {
            if (node.type?.startsWith('nodes-base.') || node.type?.startsWith('nodes-langchain.')) {
                const fullForm = node.type.startsWith('nodes-base.')
                    ? node.type.replace('nodes-base.', 'n8n-nodes-base.')
                    : node.type.replace('nodes-langchain.', '@n8n/n8n-nodes-langchain.');
                shortFormErrors.push(`Node ${index} ("${node.name}") uses SHORT form "${node.type}". ` +
                    `The n8n API requires FULL form. Change to "${fullForm}"`);
            }
        });
        if (shortFormErrors.length > 0) {
            telemetry_1.telemetry.trackWorkflowCreation(input, false);
            return {
                success: false,
                error: 'Node type format error: n8n API requires FULL form node types',
                details: {
                    errors: shortFormErrors,
                    hint: 'Use n8n-nodes-base.* instead of nodes-base.* for standard nodes'
                }
            };
        }
        const errors = (0, n8n_validation_1.validateWorkflowStructure)(input);
        if (errors.length > 0) {
            telemetry_1.telemetry.trackWorkflowCreation(input, false);
            return {
                success: false,
                error: 'Workflow validation failed',
                details: { errors }
            };
        }
        const workflow = await client.createWorkflow(input);
        if (!workflow || !workflow.id) {
            return {
                success: false,
                error: 'Workflow creation failed: n8n API returned an empty or invalid response. Verify your N8N_API_URL points to the correct /api/v1 endpoint and that the n8n instance supports workflow creation.',
                details: {
                    response: workflow ? { keys: Object.keys(workflow) } : null
                }
            };
        }
        telemetry_1.telemetry.trackWorkflowCreation(workflow, true);
        return {
            success: true,
            data: {
                id: workflow.id,
                name: workflow.name,
                active: workflow.active,
                nodeCount: workflow.nodes?.length || 0
            },
            message: `Workflow "${workflow.name}" created successfully with ID: ${workflow.id}. Use n8n_get_workflow with mode 'structure' to verify current state.`
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code,
                details: error.details
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleGetWorkflow(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(args);
        const workflow = await client.getWorkflow(id);
        return {
            success: true,
            data: workflow
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleGetWorkflowDetails(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(args);
        const workflow = await client.getWorkflow(id);
        const executions = await client.listExecutions({
            workflowId: id,
            limit: 10
        });
        const stats = {
            totalExecutions: executions.data.length,
            successCount: executions.data.filter(e => e.status === n8n_api_2.ExecutionStatus.SUCCESS).length,
            errorCount: executions.data.filter(e => e.status === n8n_api_2.ExecutionStatus.ERROR).length,
            lastExecutionTime: executions.data[0]?.startedAt || null
        };
        return {
            success: true,
            data: {
                workflow,
                executionStats: stats,
                hasWebhookTrigger: (0, n8n_validation_1.hasWebhookTrigger)(workflow),
                webhookPath: (0, n8n_validation_1.getWebhookUrl)(workflow)
            }
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleGetWorkflowStructure(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(args);
        const workflow = await client.getWorkflow(id);
        const simplifiedNodes = workflow.nodes.map(node => ({
            id: node.id,
            name: node.name,
            type: node.type,
            position: node.position,
            disabled: node.disabled || false
        }));
        return {
            success: true,
            data: {
                id: workflow.id,
                name: workflow.name,
                active: workflow.active,
                isArchived: workflow.isArchived,
                nodes: simplifiedNodes,
                connections: workflow.connections,
                nodeCount: workflow.nodes.length,
                connectionCount: Object.keys(workflow.connections).length
            }
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleGetWorkflowMinimal(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(args);
        const workflow = await client.getWorkflow(id);
        return {
            success: true,
            data: {
                id: workflow.id,
                name: workflow.name,
                active: workflow.active,
                isArchived: workflow.isArchived,
                tags: workflow.tags || [],
                createdAt: workflow.createdAt,
                updatedAt: workflow.updatedAt
            }
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleUpdateWorkflow(args, repository, context) {
    const startTime = Date.now();
    const sessionId = `mutation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    let workflowBefore = null;
    let userIntent = 'Full workflow update';
    try {
        const client = ensureApiConfigured(context);
        const input = updateWorkflowSchema.parse(args);
        const { id, createBackup, intent, ...updateData } = input;
        userIntent = intent || 'Full workflow update';
        if (updateData.nodes || updateData.connections) {
            const current = await client.getWorkflow(id);
            workflowBefore = JSON.parse(JSON.stringify(current));
            if (createBackup !== false) {
                try {
                    const versioningService = new workflow_versioning_service_1.WorkflowVersioningService(repository, client);
                    const backupResult = await versioningService.createBackup(id, current, {
                        trigger: 'full_update'
                    });
                    logger_1.logger.info('Workflow backup created', {
                        workflowId: id,
                        versionId: backupResult.versionId,
                        versionNumber: backupResult.versionNumber,
                        pruned: backupResult.pruned
                    });
                }
                catch (error) {
                    logger_1.logger.warn('Failed to create workflow backup', {
                        workflowId: id,
                        error: error.message
                    });
                }
            }
            const fullWorkflow = {
                ...current,
                ...updateData
            };
            const errors = (0, n8n_validation_1.validateWorkflowStructure)(fullWorkflow);
            if (errors.length > 0) {
                return {
                    success: false,
                    error: 'Workflow validation failed',
                    details: { errors }
                };
            }
        }
        const workflow = await client.updateWorkflow(id, updateData);
        if (workflowBefore) {
            trackWorkflowMutationForFullUpdate({
                sessionId,
                toolName: 'n8n_update_full_workflow',
                userIntent,
                operations: [],
                workflowBefore,
                workflowAfter: workflow,
                mutationSuccess: true,
                durationMs: Date.now() - startTime,
            }).catch(err => {
                logger_1.logger.warn('Failed to track mutation telemetry:', err);
            });
        }
        return {
            success: true,
            data: {
                id: workflow.id,
                name: workflow.name,
                active: workflow.active,
                nodeCount: workflow.nodes?.length || 0
            },
            message: `Workflow "${workflow.name}" updated successfully. Use n8n_get_workflow with mode 'structure' to verify current state.`
        };
    }
    catch (error) {
        if (workflowBefore) {
            trackWorkflowMutationForFullUpdate({
                sessionId,
                toolName: 'n8n_update_full_workflow',
                userIntent,
                operations: [],
                workflowBefore,
                workflowAfter: workflowBefore,
                mutationSuccess: false,
                mutationError: error instanceof Error ? error.message : 'Unknown error',
                durationMs: Date.now() - startTime,
            }).catch(err => {
                logger_1.logger.warn('Failed to track mutation telemetry for failed operation:', err);
            });
        }
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code,
                details: error.details
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function trackWorkflowMutationForFullUpdate(data) {
    try {
        const { telemetry } = await Promise.resolve().then(() => __importStar(require('../telemetry/telemetry-manager.js')));
        await telemetry.trackWorkflowMutation(data);
    }
    catch (error) {
        logger_1.logger.debug('Telemetry tracking failed:', error);
    }
}
async function handleDeleteWorkflow(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(args);
        const deleted = await client.deleteWorkflow(id);
        return {
            success: true,
            data: {
                id: deleted?.id || id,
                name: deleted?.name,
                deleted: true
            },
            message: `Workflow "${deleted?.name || id}" deleted successfully.`
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleListWorkflows(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = listWorkflowsSchema.parse(args || {});
        const tagsParam = input.tags && input.tags.length > 0
            ? input.tags.join(',')
            : undefined;
        const response = await client.listWorkflows({
            limit: input.limit || 100,
            cursor: input.cursor,
            active: input.active,
            tags: tagsParam,
            projectId: input.projectId,
            excludePinnedData: input.excludePinnedData ?? true
        });
        const minimalWorkflows = response.data.map(workflow => ({
            id: workflow.id,
            name: workflow.name,
            active: workflow.active,
            isArchived: workflow.isArchived,
            createdAt: workflow.createdAt,
            updatedAt: workflow.updatedAt,
            tags: workflow.tags || [],
            nodeCount: workflow.nodes?.length || 0
        }));
        return {
            success: true,
            data: {
                workflows: minimalWorkflows,
                returned: minimalWorkflows.length,
                nextCursor: response.nextCursor,
                hasMore: !!response.nextCursor,
                ...(response.nextCursor ? {
                    _note: "More workflows available. Use cursor to get next page."
                } : {})
            }
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleValidateWorkflow(args, repository, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = validateWorkflowSchema.parse(args);
        const workflowResponse = await handleGetWorkflow({ id: input.id }, context);
        if (!workflowResponse.success) {
            return workflowResponse;
        }
        const workflow = workflowResponse.data;
        const validator = new workflow_validator_1.WorkflowValidator(repository, enhanced_config_validator_1.EnhancedConfigValidator);
        const validationResult = await validator.validateWorkflow(workflow, input.options);
        const response = {
            valid: validationResult.valid,
            workflowId: workflow.id,
            workflowName: workflow.name,
            summary: {
                totalNodes: validationResult.statistics.totalNodes,
                enabledNodes: validationResult.statistics.enabledNodes,
                triggerNodes: validationResult.statistics.triggerNodes,
                validConnections: validationResult.statistics.validConnections,
                invalidConnections: validationResult.statistics.invalidConnections,
                expressionsValidated: validationResult.statistics.expressionsValidated,
                errorCount: validationResult.errors.length,
                warningCount: validationResult.warnings.length
            }
        };
        if (validationResult.errors.length > 0) {
            response.errors = validationResult.errors.map(e => ({
                node: e.nodeName || 'workflow',
                nodeName: e.nodeName,
                message: e.message,
                details: e.details
            }));
        }
        if (validationResult.warnings.length > 0) {
            response.warnings = validationResult.warnings.map(w => ({
                node: w.nodeName || 'workflow',
                nodeName: w.nodeName,
                message: w.message,
                details: w.details
            }));
        }
        if (validationResult.suggestions.length > 0) {
            response.suggestions = validationResult.suggestions;
        }
        if (validationResult.valid) {
            telemetry_1.telemetry.trackWorkflowCreation(workflow, true);
        }
        return {
            success: true,
            data: response
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleAutofixWorkflow(args, repository, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = autofixWorkflowSchema.parse(args);
        const workflowResponse = await handleGetWorkflow({ id: input.id }, context);
        if (!workflowResponse.success) {
            return workflowResponse;
        }
        const workflow = workflowResponse.data;
        const validator = new workflow_validator_1.WorkflowValidator(repository, enhanced_config_validator_1.EnhancedConfigValidator);
        const validationResult = await validator.validateWorkflow(workflow, {
            validateNodes: true,
            validateConnections: true,
            validateExpressions: true,
            profile: 'ai-friendly'
        });
        const allFormatIssues = [];
        for (const node of workflow.nodes) {
            const formatContext = {
                nodeType: node.type,
                nodeName: node.name,
                nodeId: node.id
            };
            const nodeFormatIssues = expression_format_validator_1.ExpressionFormatValidator.validateNodeParameters(node.parameters, formatContext);
            const enrichedIssues = nodeFormatIssues.map(issue => ({
                ...issue,
                nodeName: node.name,
                nodeId: node.id
            }));
            allFormatIssues.push(...enrichedIssues);
        }
        const autoFixer = new workflow_auto_fixer_1.WorkflowAutoFixer(repository);
        const fixResult = await autoFixer.generateFixes(workflow, validationResult, allFormatIssues, {
            applyFixes: input.applyFixes,
            fixTypes: input.fixTypes,
            confidenceThreshold: input.confidenceThreshold,
            maxFixes: input.maxFixes
        });
        if (fixResult.fixes.length === 0) {
            return {
                success: true,
                data: {
                    workflowId: workflow.id,
                    workflowName: workflow.name,
                    message: 'No automatic fixes available for this workflow',
                    validationSummary: {
                        errors: validationResult.errors.length,
                        warnings: validationResult.warnings.length
                    }
                }
            };
        }
        if (!input.applyFixes) {
            return {
                success: true,
                data: {
                    workflowId: workflow.id,
                    workflowName: workflow.name,
                    preview: true,
                    fixesAvailable: fixResult.fixes.length,
                    fixes: fixResult.fixes,
                    summary: fixResult.summary,
                    stats: fixResult.stats,
                    message: `${fixResult.fixes.length} fixes available. Set applyFixes=true to apply them.`
                }
            };
        }
        if (fixResult.operations.length > 0) {
            const updateResult = await (0, handlers_workflow_diff_1.handleUpdatePartialWorkflow)({
                id: workflow.id,
                operations: fixResult.operations,
                createBackup: true
            }, repository, context);
            if (!updateResult.success) {
                return {
                    success: false,
                    error: 'Failed to apply fixes',
                    details: {
                        fixes: fixResult.fixes,
                        updateError: updateResult.error
                    }
                };
            }
            return {
                success: true,
                data: {
                    workflowId: workflow.id,
                    workflowName: workflow.name,
                    fixesApplied: fixResult.fixes.length,
                    fixes: fixResult.fixes,
                    summary: fixResult.summary,
                    stats: fixResult.stats,
                    message: `Successfully applied ${fixResult.fixes.length} fixes to workflow "${workflow.name}"`
                }
            };
        }
        return {
            success: true,
            data: {
                workflowId: workflow.id,
                workflowName: workflow.name,
                message: 'No fixes needed'
            }
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleTestWorkflow(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = testWorkflowSchema.parse(args);
        const { detectTriggerFromWorkflow, ensureRegistryInitialized, TriggerRegistry, } = await Promise.resolve().then(() => __importStar(require('../triggers')));
        await ensureRegistryInitialized();
        const workflow = await client.getWorkflow(input.workflowId);
        let triggerType = input.triggerType;
        let triggerInfo;
        const detection = detectTriggerFromWorkflow(workflow);
        if (!triggerType) {
            if (detection.detected && detection.trigger) {
                triggerType = detection.trigger.type;
                triggerInfo = detection.trigger;
            }
            else {
                return {
                    success: false,
                    error: 'Workflow cannot be triggered externally',
                    details: {
                        workflowId: input.workflowId,
                        reason: detection.reason,
                        hint: 'Only workflows with webhook, form, or chat triggers can be executed via the API. Add one of these trigger nodes to your workflow.',
                    },
                };
            }
        }
        else {
            if (detection.detected && detection.trigger?.type === triggerType) {
                triggerInfo = detection.trigger;
            }
            else if (!detection.detected || detection.trigger?.type !== triggerType) {
                return {
                    success: false,
                    error: `Workflow does not have a ${triggerType} trigger`,
                    details: {
                        workflowId: input.workflowId,
                        requestedTrigger: triggerType,
                        detectedTrigger: detection.trigger?.type || 'none',
                        hint: detection.detected
                            ? `Workflow has a ${detection.trigger?.type} trigger. Either use that type or omit triggerType for auto-detection.`
                            : 'Workflow has no externally-triggerable triggers (webhook, form, or chat).',
                    },
                };
            }
        }
        const handler = TriggerRegistry.getHandler(triggerType, client, context);
        if (!handler) {
            return {
                success: false,
                error: `No handler registered for trigger type: ${triggerType}`,
                details: {
                    supportedTypes: TriggerRegistry.getRegisteredTypes(),
                },
            };
        }
        if (handler.capabilities.requiresActiveWorkflow && !workflow.active) {
            return {
                success: false,
                error: 'Workflow must be active to trigger via this method',
                details: {
                    workflowId: input.workflowId,
                    triggerType,
                    hint: 'Activate the workflow in n8n using n8n_update_partial_workflow with [{type: "activateWorkflow"}]',
                },
            };
        }
        if (triggerType === 'chat' && !input.message) {
            return {
                success: false,
                error: 'Chat trigger requires a message parameter',
                details: {
                    hint: 'Provide message="your message" for chat triggers',
                },
            };
        }
        const triggerInput = {
            workflowId: input.workflowId,
            triggerType,
            httpMethod: input.httpMethod,
            webhookPath: input.webhookPath,
            message: input.message || '',
            sessionId: input.sessionId,
            data: input.data,
            formData: input.data,
            headers: input.headers,
            timeout: input.timeout,
            waitForResponse: input.waitForResponse,
        };
        const response = await handler.execute(triggerInput, workflow, triggerInfo);
        return {
            success: response.success,
            data: response.data,
            message: response.success
                ? `Workflow triggered successfully via ${triggerType}`
                : response.error,
            executionId: response.executionId,
            workflowId: input.workflowId,
            details: {
                triggerType,
                metadata: response.metadata,
                ...(response.details || {}),
            },
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors },
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code,
                details: error.details,
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
}
async function handleGetExecution(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const schema = zod_1.z.object({
            id: zod_1.z.string(),
            mode: zod_1.z.enum(['preview', 'summary', 'filtered', 'full', 'error']).optional(),
            nodeNames: zod_1.z.array(zod_1.z.string()).optional(),
            itemsLimit: zod_1.z.number().optional(),
            includeInputData: zod_1.z.boolean().optional(),
            includeData: zod_1.z.boolean().optional(),
            errorItemsLimit: zod_1.z.number().min(0).max(100).optional(),
            includeStackTrace: zod_1.z.boolean().optional(),
            includeExecutionPath: zod_1.z.boolean().optional(),
            fetchWorkflow: zod_1.z.boolean().optional()
        });
        const params = schema.parse(args);
        const { id, mode, nodeNames, itemsLimit, includeInputData, includeData, errorItemsLimit, includeStackTrace, includeExecutionPath, fetchWorkflow } = params;
        let effectiveMode = mode;
        if (!effectiveMode && includeData !== undefined) {
            effectiveMode = includeData ? 'summary' : undefined;
        }
        const fetchFullData = effectiveMode !== undefined || includeData === true;
        const execution = await client.getExecution(id, fetchFullData);
        if (!effectiveMode && !nodeNames && itemsLimit === undefined) {
            return {
                success: true,
                data: execution
            };
        }
        let workflow;
        if (effectiveMode === 'error' && fetchWorkflow !== false && execution.workflowId) {
            try {
                workflow = await client.getWorkflow(execution.workflowId);
            }
            catch (e) {
                logger_1.logger.debug('Could not fetch workflow for error analysis', {
                    workflowId: execution.workflowId,
                    error: e instanceof Error ? e.message : 'Unknown error'
                });
            }
        }
        const filterOptions = {
            mode: effectiveMode,
            nodeNames,
            itemsLimit,
            includeInputData,
            errorItemsLimit,
            includeStackTrace,
            includeExecutionPath
        };
        const processedExecution = (0, execution_processor_1.processExecution)(execution, filterOptions, workflow);
        return {
            success: true,
            data: processedExecution
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleListExecutions(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = listExecutionsSchema.parse(args || {});
        const response = await client.listExecutions({
            limit: input.limit || 100,
            cursor: input.cursor,
            workflowId: input.workflowId,
            projectId: input.projectId,
            status: input.status,
            includeData: input.includeData || false
        });
        return {
            success: true,
            data: {
                executions: response.data,
                returned: response.data.length,
                nextCursor: response.nextCursor,
                hasMore: !!response.nextCursor,
                ...(response.nextCursor ? {
                    _note: "More executions available. Use cursor to get next page."
                } : {})
            }
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleDeleteExecution(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(args);
        await client.deleteExecution(id);
        return {
            success: true,
            message: `Execution ${id} deleted successfully`
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleHealthCheck(context) {
    const startTime = Date.now();
    try {
        const client = ensureApiConfigured(context);
        const health = await client.healthCheck();
        const packageJson = require('../../package.json');
        const mcpVersion = packageJson.version;
        const supportedN8nVersion = packageJson.dependencies?.n8n?.replace(/[^0-9.]/g, '');
        const versionCheck = await (0, npm_version_checker_1.checkNpmVersion)();
        const cacheMetricsData = getInstanceCacheMetrics();
        const responseTime = Date.now() - startTime;
        const responseData = {
            status: health.status,
            instanceId: health.instanceId,
            n8nVersion: health.n8nVersion,
            features: health.features,
            apiUrl: (0, n8n_api_1.getN8nApiConfig)()?.baseUrl,
            mcpVersion,
            supportedN8nVersion,
            versionCheck: {
                current: versionCheck.currentVersion,
                latest: versionCheck.latestVersion,
                upToDate: !versionCheck.isOutdated,
                message: (0, npm_version_checker_1.formatVersionMessage)(versionCheck),
                ...(versionCheck.updateCommand ? { updateCommand: versionCheck.updateCommand } : {})
            },
            performance: {
                responseTimeMs: responseTime,
                cacheHitRate: (cacheMetricsData.hits + cacheMetricsData.misses) > 0
                    ? ((cacheMetricsData.hits / (cacheMetricsData.hits + cacheMetricsData.misses)) * 100).toFixed(2) + '%'
                    : 'N/A',
                cachedInstances: cacheMetricsData.size
            }
        };
        responseData.nextSteps = [
            '• Create workflow: n8n_create_workflow',
            '• List workflows: n8n_list_workflows',
            '• Search nodes: search_nodes',
            '• Browse templates: search_templates'
        ];
        if (versionCheck.isOutdated && versionCheck.latestVersion) {
            responseData.updateWarning = `⚠️  n8n-mcp v${versionCheck.latestVersion} is available (you have v${versionCheck.currentVersion}). Update recommended.`;
        }
        telemetry_1.telemetry.trackEvent('health_check_completed', {
            success: true,
            responseTimeMs: responseTime,
            upToDate: !versionCheck.isOutdated,
            apiConnected: true
        });
        return {
            success: true,
            data: responseData
        };
    }
    catch (error) {
        const responseTime = Date.now() - startTime;
        telemetry_1.telemetry.trackEvent('health_check_failed', {
            success: false,
            responseTimeMs: responseTime,
            errorType: error instanceof n8n_errors_1.N8nApiError ? error.code : 'unknown'
        });
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code,
                details: {
                    apiUrl: (0, n8n_api_1.getN8nApiConfig)()?.baseUrl,
                    hint: 'Check if n8n is running and API is enabled',
                    troubleshooting: [
                        '1. Verify n8n instance is running',
                        '2. Check N8N_API_URL is correct',
                        '3. Verify N8N_API_KEY has proper permissions',
                        '4. Run n8n_health_check with mode="diagnostic" for detailed analysis'
                    ]
                }
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
function detectCloudPlatform() {
    if (process.env.RAILWAY_ENVIRONMENT)
        return 'railway';
    if (process.env.RENDER)
        return 'render';
    if (process.env.FLY_APP_NAME)
        return 'fly';
    if (process.env.HEROKU_APP_NAME)
        return 'heroku';
    if (process.env.AWS_EXECUTION_ENV)
        return 'aws';
    if (process.env.KUBERNETES_SERVICE_HOST)
        return 'kubernetes';
    if (process.env.GOOGLE_CLOUD_PROJECT)
        return 'gcp';
    if (process.env.AZURE_FUNCTIONS_ENVIRONMENT)
        return 'azure';
    return null;
}
function getModeSpecificDebug(mcpMode) {
    if (mcpMode === 'http') {
        const port = process.env.MCP_PORT || process.env.PORT || 3000;
        return {
            mode: 'HTTP Server',
            port,
            authTokenConfigured: !!(process.env.MCP_AUTH_TOKEN || process.env.AUTH_TOKEN),
            corsEnabled: true,
            serverUrl: `http://localhost:${port}`,
            healthCheckUrl: `http://localhost:${port}/health`,
            troubleshooting: [
                `1. Test server health: curl http://localhost:${port}/health`,
                '2. Check browser console for CORS errors',
                '3. Verify MCP_AUTH_TOKEN or AUTH_TOKEN if authentication enabled',
                `4. Ensure port ${port} is not in use: lsof -i :${port} (macOS/Linux) or netstat -ano | findstr :${port} (Windows)`,
                '5. Check firewall settings for port access',
                '6. Review server logs for connection errors'
            ],
            commonIssues: [
                'CORS policy blocking browser requests',
                'Port already in use by another application',
                'Authentication token mismatch',
                'Network firewall blocking connections'
            ]
        };
    }
    else {
        const configLocation = process.platform === 'darwin'
            ? '~/Library/Application Support/Claude/claude_desktop_config.json'
            : process.platform === 'win32'
                ? '%APPDATA%\\Claude\\claude_desktop_config.json'
                : '~/.config/Claude/claude_desktop_config.json';
        return {
            mode: 'Standard I/O (Claude Desktop)',
            configLocation,
            troubleshooting: [
                '1. Verify Claude Desktop config file exists and is valid JSON',
                '2. Check MCP server entry: {"mcpServers": {"n8n": {"command": "npx", "args": ["-y", "n8n-mcp"]}}}',
                '3. Restart Claude Desktop after config changes',
                '4. Check Claude Desktop logs for startup errors',
                '5. Test npx can run: npx -y n8n-mcp --version',
                '6. Verify executable permissions if using local installation'
            ],
            commonIssues: [
                'Invalid JSON in claude_desktop_config.json',
                'Incorrect command or args in MCP server config',
                'Claude Desktop not restarted after config changes',
                'npx unable to download or run package',
                'Missing execute permissions on local binary'
            ]
        };
    }
}
function getDockerDebug(isDocker) {
    if (!isDocker)
        return null;
    return {
        containerDetected: true,
        troubleshooting: [
            '1. Verify volume mounts for data/nodes.db',
            '2. Check network connectivity to n8n instance',
            '3. Ensure ports are correctly mapped',
            '4. Review container logs: docker logs <container-name>',
            '5. Verify environment variables passed to container',
            '6. Check IS_DOCKER=true is set correctly'
        ],
        commonIssues: [
            'Volume mount not persisting database',
            'Network isolation preventing n8n API access',
            'Port mapping conflicts',
            'Missing environment variables in container'
        ]
    };
}
function getCloudPlatformDebug(cloudPlatform) {
    if (!cloudPlatform)
        return null;
    const platformGuides = {
        railway: {
            name: 'Railway',
            troubleshooting: [
                '1. Check Railway environment variables are set',
                '2. Verify deployment logs in Railway dashboard',
                '3. Ensure PORT matches Railway assigned port (automatic)',
                '4. Check networking configuration for external access'
            ]
        },
        render: {
            name: 'Render',
            troubleshooting: [
                '1. Verify Render environment variables',
                '2. Check Render logs for startup errors',
                '3. Ensure health check endpoint is responding',
                '4. Verify instance type has sufficient resources'
            ]
        },
        fly: {
            name: 'Fly.io',
            troubleshooting: [
                '1. Check Fly.io logs: flyctl logs',
                '2. Verify fly.toml configuration',
                '3. Ensure volumes are properly mounted',
                '4. Check app status: flyctl status'
            ]
        },
        heroku: {
            name: 'Heroku',
            troubleshooting: [
                '1. Check Heroku logs: heroku logs --tail',
                '2. Verify Procfile configuration',
                '3. Ensure dynos are running: heroku ps',
                '4. Check environment variables: heroku config'
            ]
        },
        kubernetes: {
            name: 'Kubernetes',
            troubleshooting: [
                '1. Check pod logs: kubectl logs <pod-name>',
                '2. Verify service and ingress configuration',
                '3. Check persistent volume claims',
                '4. Verify resource limits and requests'
            ]
        },
        aws: {
            name: 'AWS',
            troubleshooting: [
                '1. Check CloudWatch logs',
                '2. Verify IAM roles and permissions',
                '3. Check security groups and networking',
                '4. Verify environment variables in service config'
            ]
        }
    };
    return platformGuides[cloudPlatform] || {
        name: cloudPlatform.toUpperCase(),
        troubleshooting: [
            '1. Check cloud platform logs',
            '2. Verify environment variables are set',
            '3. Check networking and port configuration',
            '4. Review platform-specific documentation'
        ]
    };
}
async function handleDiagnostic(request, context) {
    const startTime = Date.now();
    const verbose = request.params?.arguments?.verbose || false;
    const mcpMode = process.env.MCP_MODE || 'stdio';
    const isDocker = process.env.IS_DOCKER === 'true';
    const cloudPlatform = detectCloudPlatform();
    const envVars = {
        N8N_API_URL: process.env.N8N_API_URL || null,
        N8N_API_KEY: process.env.N8N_API_KEY ? '***configured***' : null,
        NODE_ENV: process.env.NODE_ENV || 'production',
        MCP_MODE: mcpMode,
        isDocker,
        cloudPlatform,
        nodeVersion: process.version,
        platform: process.platform
    };
    const apiConfig = (0, n8n_api_1.getN8nApiConfig)();
    const apiConfigured = apiConfig !== null;
    const apiClient = getN8nApiClient(context);
    let apiStatus = {
        configured: apiConfigured,
        connected: false,
        error: null,
        version: null
    };
    if (apiClient) {
        try {
            const health = await apiClient.healthCheck();
            apiStatus.connected = true;
            apiStatus.version = health.n8nVersion || 'unknown';
        }
        catch (error) {
            apiStatus.error = error instanceof Error ? error.message : 'Unknown error';
        }
    }
    const documentationTools = 7;
    const managementTools = apiConfigured ? 14 : 0;
    const totalTools = documentationTools + managementTools;
    const versionCheck = await (0, npm_version_checker_1.checkNpmVersion)();
    const cacheMetricsData = getInstanceCacheMetrics();
    const responseTime = Date.now() - startTime;
    const diagnostic = {
        timestamp: new Date().toISOString(),
        environment: envVars,
        apiConfiguration: {
            configured: apiConfigured,
            status: apiStatus,
            config: apiConfig ? {
                baseUrl: apiConfig.baseUrl,
                timeout: apiConfig.timeout,
                maxRetries: apiConfig.maxRetries
            } : null
        },
        versionInfo: {
            current: versionCheck.currentVersion,
            latest: versionCheck.latestVersion,
            upToDate: !versionCheck.isOutdated,
            message: (0, npm_version_checker_1.formatVersionMessage)(versionCheck),
            ...(versionCheck.updateCommand ? { updateCommand: versionCheck.updateCommand } : {})
        },
        toolsAvailability: {
            documentationTools: {
                count: documentationTools,
                enabled: true,
                description: 'Always available - node info, search, validation, etc.'
            },
            managementTools: {
                count: managementTools,
                enabled: apiConfigured,
                description: apiConfigured ?
                    'Management tools are ENABLED - create, update, execute workflows' :
                    'Management tools are DISABLED - configure N8N_API_URL and N8N_API_KEY to enable'
            },
            totalAvailable: totalTools
        },
        performance: {
            diagnosticResponseTimeMs: responseTime,
            cacheHitRate: (cacheMetricsData.hits + cacheMetricsData.misses) > 0
                ? ((cacheMetricsData.hits / (cacheMetricsData.hits + cacheMetricsData.misses)) * 100).toFixed(2) + '%'
                : 'N/A',
            cachedInstances: cacheMetricsData.size
        },
        modeSpecificDebug: getModeSpecificDebug(mcpMode)
    };
    if (apiConfigured && apiStatus.connected) {
        diagnostic.nextSteps = {
            message: '✓ API connected! Here\'s what you can do:',
            recommended: [
                {
                    action: 'n8n_list_workflows',
                    description: 'See your existing workflows',
                    timing: 'Fast (6 seconds median)'
                },
                {
                    action: 'n8n_create_workflow',
                    description: 'Create a new workflow',
                    timing: 'Typically 6-14 minutes to build'
                },
                {
                    action: 'search_nodes',
                    description: 'Discover available nodes',
                    timing: 'Fast - explore 500+ nodes'
                },
                {
                    action: 'search_templates',
                    description: 'Browse pre-built workflows',
                    timing: 'Find examples quickly'
                }
            ],
            tips: [
                '82% of users start creating workflows after diagnostics - you\'re ready to go!',
                'Most common first action: n8n_update_partial_workflow (managing existing workflows)',
                'Use n8n_validate_workflow before deploying to catch issues early'
            ]
        };
    }
    else if (apiConfigured && !apiStatus.connected) {
        diagnostic.troubleshooting = {
            issue: '⚠️ API configured but connection failed',
            error: apiStatus.error,
            steps: [
                '1. Verify n8n instance is running and accessible',
                '2. Check N8N_API_URL is correct (currently: ' + apiConfig?.baseUrl + ')',
                '3. Test URL in browser: ' + apiConfig?.baseUrl + '/healthz',
                '4. Verify N8N_API_KEY has proper permissions',
                '5. Check firewall/network settings if using remote n8n',
                '6. Try running n8n_health_check again after fixes'
            ],
            commonIssues: [
                'Wrong port number in N8N_API_URL',
                'API key doesn\'t have sufficient permissions',
                'n8n instance not running or crashed',
                'Network firewall blocking connection'
            ],
            documentation: 'https://github.com/czlonkowski/n8n-mcp?tab=readme-ov-file#n8n-management-tools-optional---requires-api-configuration'
        };
    }
    else {
        diagnostic.setupGuide = {
            message: 'n8n API not configured. You can still use documentation tools!',
            whatYouCanDoNow: {
                documentation: [
                    {
                        tool: 'search_nodes',
                        description: 'Search 500+ n8n nodes',
                        example: 'search_nodes({query: "slack"})'
                    },
                    {
                        tool: 'get_node_essentials',
                        description: 'Get node configuration details',
                        example: 'get_node_essentials({nodeType: "nodes-base.httpRequest"})'
                    },
                    {
                        tool: 'search_templates',
                        description: 'Browse workflow templates',
                        example: 'search_templates({query: "chatbot"})'
                    },
                    {
                        tool: 'validate_workflow',
                        description: 'Validate workflow JSON',
                        example: 'validate_workflow({workflow: {...}})'
                    }
                ],
                note: '14 documentation tools available without API configuration'
            },
            whatYouCannotDo: [
                '✗ Create/update workflows in n8n instance',
                '✗ List your workflows',
                '✗ Execute workflows',
                '✗ View execution results'
            ],
            howToEnable: {
                steps: [
                    '1. Get your n8n API key: [Your n8n instance]/settings/api',
                    '2. Set environment variables:',
                    '   N8N_API_URL=https://your-n8n-instance.com',
                    '   N8N_API_KEY=your_api_key_here',
                    '3. Restart the MCP server',
                    '4. Run n8n_health_check with mode="diagnostic" to verify',
                    '5. All 19 tools will be available!'
                ],
                documentation: 'https://github.com/czlonkowski/n8n-mcp?tab=readme-ov-file#n8n-management-tools-optional---requires-api-configuration'
            }
        };
    }
    if (versionCheck.isOutdated && versionCheck.latestVersion) {
        diagnostic.updateWarning = {
            message: `⚠️ Update available: v${versionCheck.currentVersion} → v${versionCheck.latestVersion}`,
            command: versionCheck.updateCommand,
            benefits: [
                'Latest bug fixes and improvements',
                'New features and tools',
                'Better performance and reliability'
            ]
        };
    }
    const dockerDebug = getDockerDebug(isDocker);
    if (dockerDebug) {
        diagnostic.dockerDebug = dockerDebug;
    }
    const cloudDebug = getCloudPlatformDebug(cloudPlatform);
    if (cloudDebug) {
        diagnostic.cloudPlatformDebug = cloudDebug;
    }
    if (verbose) {
        diagnostic.debug = {
            processEnv: Object.keys(process.env).filter(key => key.startsWith('N8N_') || key.startsWith('MCP_')),
            nodeVersion: process.version,
            platform: process.platform,
            workingDirectory: process.cwd(),
            cacheMetrics: cacheMetricsData
        };
    }
    telemetry_1.telemetry.trackEvent('diagnostic_completed', {
        success: true,
        apiConfigured,
        apiConnected: apiStatus.connected,
        toolsAvailable: totalTools,
        responseTimeMs: responseTime,
        upToDate: !versionCheck.isOutdated,
        verbose
    });
    return {
        success: true,
        data: diagnostic
    };
}
async function handleWorkflowVersions(args, repository, context) {
    try {
        const input = workflowVersionsSchema.parse(args);
        const client = context ? getN8nApiClient(context) : null;
        const versioningService = new workflow_versioning_service_1.WorkflowVersioningService(repository, client || undefined);
        switch (input.mode) {
            case 'list': {
                if (!input.workflowId) {
                    return {
                        success: false,
                        error: 'workflowId is required for list mode'
                    };
                }
                const versions = await versioningService.getVersionHistory(input.workflowId, input.limit);
                return {
                    success: true,
                    data: {
                        workflowId: input.workflowId,
                        versions,
                        count: versions.length,
                        message: `Found ${versions.length} version(s) for workflow ${input.workflowId}`
                    }
                };
            }
            case 'get': {
                if (!input.versionId) {
                    return {
                        success: false,
                        error: 'versionId is required for get mode'
                    };
                }
                const version = await versioningService.getVersion(input.versionId);
                if (!version) {
                    return {
                        success: false,
                        error: `Version ${input.versionId} not found`
                    };
                }
                return {
                    success: true,
                    data: version
                };
            }
            case 'rollback': {
                if (!input.workflowId) {
                    return {
                        success: false,
                        error: 'workflowId is required for rollback mode'
                    };
                }
                if (!client) {
                    return {
                        success: false,
                        error: 'n8n API not configured. Cannot perform rollback without API access.'
                    };
                }
                const result = await versioningService.restoreVersion(input.workflowId, input.versionId, input.validateBefore);
                return {
                    success: result.success,
                    data: result.success ? result : undefined,
                    error: result.success ? undefined : result.message,
                    details: result.success ? undefined : {
                        validationErrors: result.validationErrors
                    }
                };
            }
            case 'delete': {
                if (input.deleteAll) {
                    if (!input.workflowId) {
                        return {
                            success: false,
                            error: 'workflowId is required for deleteAll mode'
                        };
                    }
                    const result = await versioningService.deleteAllVersions(input.workflowId);
                    return {
                        success: true,
                        data: {
                            workflowId: input.workflowId,
                            deleted: result.deleted,
                            message: result.message
                        }
                    };
                }
                else {
                    if (!input.versionId) {
                        return {
                            success: false,
                            error: 'versionId is required for single version delete'
                        };
                    }
                    const result = await versioningService.deleteVersion(input.versionId);
                    return {
                        success: result.success,
                        data: result.success ? { message: result.message } : undefined,
                        error: result.success ? undefined : result.message
                    };
                }
            }
            case 'prune': {
                if (!input.workflowId) {
                    return {
                        success: false,
                        error: 'workflowId is required for prune mode'
                    };
                }
                const result = await versioningService.pruneVersions(input.workflowId, input.maxVersions || 10);
                return {
                    success: true,
                    data: {
                        workflowId: input.workflowId,
                        pruned: result.pruned,
                        remaining: result.remaining,
                        message: `Pruned ${result.pruned} old version(s), ${result.remaining} version(s) remaining`
                    }
                };
            }
            case 'truncate': {
                if (!input.confirmTruncate) {
                    return {
                        success: false,
                        error: 'confirmTruncate must be true to truncate all versions. This action cannot be undone.'
                    };
                }
                const result = await versioningService.truncateAllVersions(true);
                return {
                    success: true,
                    data: {
                        deleted: result.deleted,
                        message: result.message
                    }
                };
            }
            default:
                return {
                    success: false,
                    error: `Unknown mode: ${input.mode}`
                };
        }
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
const deployTemplateSchema = zod_1.z.object({
    templateId: zod_1.z.number().positive().int(),
    name: zod_1.z.string().optional(),
    autoUpgradeVersions: zod_1.z.boolean().default(true),
    autoFix: zod_1.z.boolean().default(true),
    stripCredentials: zod_1.z.boolean().default(true)
});
async function handleDeployTemplate(args, templateService, repository, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = deployTemplateSchema.parse(args);
        const template = await templateService.getTemplate(input.templateId, 'full');
        if (!template) {
            return {
                success: false,
                error: `Template ${input.templateId} not found`,
                details: {
                    hint: 'Use search_templates to find available templates',
                    templateUrl: `https://n8n.io/workflows/${input.templateId}`
                }
            };
        }
        const workflow = JSON.parse(JSON.stringify(template.workflow));
        if (!workflow || !workflow.nodes) {
            return {
                success: false,
                error: 'Template has invalid workflow structure',
                details: { templateId: input.templateId }
            };
        }
        const workflowName = input.name || template.name;
        const requiredCredentials = [];
        for (const node of workflow.nodes) {
            if (node.credentials && typeof node.credentials === 'object') {
                for (const [credType] of Object.entries(node.credentials)) {
                    requiredCredentials.push({
                        nodeType: node.type,
                        nodeName: node.name,
                        credentialType: credType
                    });
                }
            }
        }
        if (input.stripCredentials) {
            workflow.nodes = workflow.nodes.map((node) => {
                const { credentials, ...rest } = node;
                return rest;
            });
        }
        if (input.autoUpgradeVersions) {
            const autoFixer = new workflow_auto_fixer_1.WorkflowAutoFixer(repository);
            const validator = new workflow_validator_1.WorkflowValidator(repository, enhanced_config_validator_1.EnhancedConfigValidator);
            const validationResult = await validator.validateWorkflow(workflow, {
                validateNodes: true,
                validateConnections: false,
                validateExpressions: false,
                profile: 'runtime'
            });
            const fixResult = await autoFixer.generateFixes(workflow, validationResult, [], { fixTypes: ['typeversion-upgrade', 'typeversion-correction'] });
            if (fixResult.operations.length > 0) {
                for (const op of fixResult.operations) {
                    if (op.type === 'updateNode' && op.updates) {
                        const node = workflow.nodes.find((n) => n.id === op.nodeId || n.name === op.nodeName);
                        if (node) {
                            for (const [path, value] of Object.entries(op.updates)) {
                                if (path === 'typeVersion') {
                                    node.typeVersion = value;
                                }
                            }
                        }
                    }
                }
            }
        }
        const triggerNode = workflow.nodes.find((n) => n.type?.includes('Trigger') ||
            n.type?.includes('webhook') ||
            n.type === 'n8n-nodes-base.webhook');
        const triggerType = triggerNode?.type?.split('.').pop() || 'manual';
        const createdWorkflow = await client.createWorkflow({
            name: workflowName,
            nodes: workflow.nodes,
            connections: workflow.connections,
            settings: workflow.settings || { executionOrder: 'v1' }
        });
        const apiConfig = context ? (0, n8n_api_1.getN8nApiConfigFromContext)(context) : (0, n8n_api_1.getN8nApiConfig)();
        const baseUrl = apiConfig?.baseUrl?.replace('/api/v1', '') || '';
        let fixesApplied = [];
        let fixSummary = '';
        let autoFixStatus = 'skipped';
        if (input.autoFix) {
            try {
                const autofixResult = await handleAutofixWorkflow({
                    id: createdWorkflow.id,
                    applyFixes: true,
                    fixTypes: ['expression-format', 'typeversion-upgrade'],
                    confidenceThreshold: 'medium'
                }, repository, context);
                if (autofixResult.success && autofixResult.data) {
                    const fixData = autofixResult.data;
                    autoFixStatus = 'success';
                    if (fixData.fixesApplied && fixData.fixesApplied > 0) {
                        fixesApplied = fixData.fixes || [];
                        fixSummary = ` Auto-fixed ${fixData.fixesApplied} issue(s).`;
                    }
                }
            }
            catch (fixError) {
                autoFixStatus = 'failed';
                logger_1.logger.warn('Auto-fix failed after template deployment', {
                    workflowId: createdWorkflow.id,
                    error: fixError instanceof Error ? fixError.message : 'Unknown error'
                });
                fixSummary = ' Auto-fix failed (workflow deployed successfully).';
            }
        }
        return {
            success: true,
            data: {
                workflowId: createdWorkflow.id,
                name: createdWorkflow.name,
                active: false,
                nodeCount: workflow.nodes.length,
                triggerType,
                requiredCredentials: requiredCredentials.length > 0 ? requiredCredentials : undefined,
                url: baseUrl ? `${baseUrl}/workflow/${createdWorkflow.id}` : undefined,
                templateId: input.templateId,
                templateUrl: template.url || `https://n8n.io/workflows/${input.templateId}`,
                autoFixStatus,
                fixesApplied: fixesApplied.length > 0 ? fixesApplied : undefined
            },
            message: `Workflow "${createdWorkflow.name}" deployed successfully from template ${input.templateId}.${fixSummary} ${requiredCredentials.length > 0
                ? `Configure ${requiredCredentials.length} credential(s) in n8n to activate.`
                : ''}`
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code,
                details: error.details
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
async function handleTriggerWebhookWorkflow(args, context) {
    const triggerWebhookSchema = zod_1.z.object({
        webhookUrl: zod_1.z.string().url(),
        httpMethod: zod_1.z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
        data: zod_1.z.record(zod_1.z.unknown()).optional(),
        headers: zod_1.z.record(zod_1.z.string()).optional(),
        waitForResponse: zod_1.z.boolean().optional(),
    });
    try {
        const client = ensureApiConfigured(context);
        const input = triggerWebhookSchema.parse(args);
        const webhookRequest = {
            webhookUrl: input.webhookUrl,
            httpMethod: input.httpMethod || 'POST',
            data: input.data,
            headers: input.headers,
            waitForResponse: input.waitForResponse ?? true
        };
        const response = await client.triggerWebhook(webhookRequest);
        return {
            success: true,
            data: response,
            message: 'Webhook triggered successfully'
        };
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return {
                success: false,
                error: 'Invalid input',
                details: { errors: error.errors }
            };
        }
        if (error instanceof n8n_errors_1.N8nApiError) {
            const errorData = error.details;
            const executionId = errorData?.executionId || errorData?.id || errorData?.execution?.id;
            const workflowId = errorData?.workflowId || errorData?.workflow?.id;
            if (executionId) {
                return {
                    success: false,
                    error: (0, n8n_errors_1.formatExecutionError)(executionId, workflowId),
                    code: error.code,
                    executionId,
                    workflowId: workflowId || undefined
                };
            }
            if (error.code === 'SERVER_ERROR' || error.statusCode && error.statusCode >= 500) {
                return {
                    success: false,
                    error: (0, n8n_errors_1.formatNoExecutionError)(),
                    code: error.code
                };
            }
            return {
                success: false,
                error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
                code: error.code,
                details: error.details
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}
const dataTableFilterConditionSchema = zod_1.z.object({
    columnName: zod_1.z.string().min(1),
    condition: zod_1.z.enum(['eq', 'neq', 'like', 'ilike', 'gt', 'gte', 'lt', 'lte']),
    value: zod_1.z.any(),
});
const dataTableFilterSchema = zod_1.z.object({
    type: zod_1.z.enum(['and', 'or']).optional().default('and'),
    filters: zod_1.z.array(dataTableFilterConditionSchema).min(1, 'At least one filter condition is required'),
});
const tableIdSchema = zod_1.z.object({
    tableId: zod_1.z.string().min(1, 'tableId is required'),
});
const createTableSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Table name cannot be empty'),
    columns: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string().min(1, 'Column name cannot be empty'),
        type: zod_1.z.enum(['string', 'number', 'boolean', 'date']).optional(),
    })).optional(),
});
const listTablesSchema = zod_1.z.object({
    limit: zod_1.z.number().min(1).max(100).optional(),
    cursor: zod_1.z.string().optional(),
});
const updateTableSchema = tableIdSchema.extend({
    name: zod_1.z.string().min(1, 'New table name cannot be empty'),
});
function tryParseJson(val) {
    if (typeof val !== 'string')
        return val;
    try {
        return JSON.parse(val);
    }
    catch {
        return val;
    }
}
const coerceJsonArray = zod_1.z.preprocess(tryParseJson, zod_1.z.array(zod_1.z.record(zod_1.z.unknown())));
const coerceJsonObject = zod_1.z.preprocess(tryParseJson, zod_1.z.record(zod_1.z.unknown()));
const coerceJsonFilter = zod_1.z.preprocess(tryParseJson, dataTableFilterSchema);
const getRowsSchema = tableIdSchema.extend({
    limit: zod_1.z.number().min(1).max(100).optional(),
    cursor: zod_1.z.string().optional(),
    filter: zod_1.z.union([coerceJsonFilter, zod_1.z.string()]).optional(),
    sortBy: zod_1.z.string().optional(),
    search: zod_1.z.string().optional(),
});
const insertRowsSchema = tableIdSchema.extend({
    data: coerceJsonArray.pipe(zod_1.z.array(zod_1.z.record(zod_1.z.unknown())).min(1, 'At least one row is required')),
    returnType: zod_1.z.enum(['count', 'id', 'all']).optional(),
});
const mutateRowsSchema = tableIdSchema.extend({
    filter: coerceJsonFilter,
    data: coerceJsonObject,
    returnData: zod_1.z.boolean().optional(),
    dryRun: zod_1.z.boolean().optional(),
});
const deleteRowsSchema = tableIdSchema.extend({
    filter: coerceJsonFilter,
    returnData: zod_1.z.boolean().optional(),
    dryRun: zod_1.z.boolean().optional(),
});
function handleDataTableError(error) {
    if (error instanceof zod_1.z.ZodError) {
        return { success: false, error: 'Invalid input', details: { errors: error.errors } };
    }
    if (error instanceof n8n_errors_1.N8nApiError) {
        return {
            success: false,
            error: (0, n8n_errors_1.getUserFriendlyErrorMessage)(error),
            code: error.code,
            details: error.details,
        };
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
}
async function handleCreateTable(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = createTableSchema.parse(args);
        const dataTable = await client.createDataTable(input);
        if (!dataTable || !dataTable.id) {
            return { success: false, error: 'Data table creation failed: n8n API returned an empty or invalid response' };
        }
        return {
            success: true,
            data: { id: dataTable.id, name: dataTable.name },
            message: `Data table "${dataTable.name}" created with ID: ${dataTable.id}`,
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleListTables(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const input = listTablesSchema.parse(args || {});
        const result = await client.listDataTables(input);
        return {
            success: true,
            data: {
                tables: result.data,
                count: result.data.length,
                nextCursor: result.nextCursor || undefined,
            },
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleGetTable(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId } = tableIdSchema.parse(args);
        const dataTable = await client.getDataTable(tableId);
        return { success: true, data: dataTable };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleUpdateTable(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId, name } = updateTableSchema.parse(args);
        const dataTable = await client.updateDataTable(tableId, { name });
        const rawArgs = args;
        const hasColumns = rawArgs && typeof rawArgs === 'object' && 'columns' in rawArgs;
        return {
            success: true,
            data: dataTable,
            message: `Data table renamed to "${dataTable.name}"` +
                (hasColumns ? '. Note: columns parameter was ignored — table schema is immutable after creation via the public API' : ''),
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleDeleteTable(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId } = tableIdSchema.parse(args);
        await client.deleteDataTable(tableId);
        return { success: true, message: `Data table ${tableId} deleted successfully` };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleGetRows(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId, filter, sortBy, ...params } = getRowsSchema.parse(args);
        const queryParams = { ...params };
        if (filter) {
            queryParams.filter = typeof filter === 'string' ? filter : JSON.stringify(filter);
        }
        if (sortBy) {
            queryParams.sortBy = sortBy;
        }
        const result = await client.getDataTableRows(tableId, queryParams);
        return {
            success: true,
            data: {
                rows: result.data,
                count: result.data.length,
                nextCursor: result.nextCursor || undefined,
            },
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleInsertRows(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId, ...params } = insertRowsSchema.parse(args);
        const result = await client.insertDataTableRows(tableId, params);
        return {
            success: true,
            data: result,
            message: `Rows inserted into data table ${tableId}`,
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleUpdateRows(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId, ...params } = mutateRowsSchema.parse(args);
        const result = await client.updateDataTableRows(tableId, params);
        return {
            success: true,
            data: result,
            message: params.dryRun ? 'Dry run: rows matched (no changes applied)' : 'Rows updated successfully',
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleUpsertRows(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId, ...params } = mutateRowsSchema.parse(args);
        const result = await client.upsertDataTableRow(tableId, params);
        return {
            success: true,
            data: result,
            message: params.dryRun ? 'Dry run: upsert previewed (no changes applied)' : 'Row upserted successfully',
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
async function handleDeleteRows(args, context) {
    try {
        const client = ensureApiConfigured(context);
        const { tableId, filter, ...params } = deleteRowsSchema.parse(args);
        const queryParams = {
            filter: JSON.stringify(filter),
            ...params,
        };
        const result = await client.deleteDataTableRows(tableId, queryParams);
        return {
            success: true,
            data: result,
            message: params.dryRun ? 'Dry run: rows matched for deletion (no changes applied)' : 'Rows deleted successfully',
        };
    }
    catch (error) {
        return handleDataTableError(error);
    }
}
//# sourceMappingURL=handlers-n8n-manager.js.map