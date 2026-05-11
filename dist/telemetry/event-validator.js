"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryEventValidator = exports.workflowTelemetrySchema = exports.telemetryEventSchema = void 0;
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
const sanitizedString = zod_1.z.string().transform(val => {
    let sanitized = val.replace(/https?:\/\/[^\s]+/gi, '[URL]');
    sanitized = sanitized.replace(/[a-zA-Z0-9_-]{32,}/g, '[KEY]');
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
    return sanitized;
});
const eventPropertiesSchema = zod_1.z.record(zod_1.z.unknown()).transform(obj => {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (isSensitiveKey(key)) {
            continue;
        }
        if (typeof value === 'string') {
            sanitized[key] = sanitizedString.parse(value);
        }
        else if (typeof value === 'number' || typeof value === 'boolean') {
            sanitized[key] = value;
        }
        else if (value === null || value === undefined) {
            sanitized[key] = null;
        }
        else if (typeof value === 'object') {
            sanitized[key] = sanitizeNestedObject(value, 3);
        }
    }
    return sanitized;
});
exports.telemetryEventSchema = zod_1.z.object({
    user_id: zod_1.z.string().min(1).max(64),
    event: zod_1.z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    properties: eventPropertiesSchema,
    created_at: zod_1.z.string().datetime().optional()
});
const sanitizedNodeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    type: zod_1.z.string(),
    typeVersion: zod_1.z.number(),
    position: zod_1.z.tuple([zod_1.z.number(), zod_1.z.number()]),
    parameters: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    disabled: zod_1.z.boolean().optional(),
    notes: zod_1.z.string().optional(),
    notesInFlow: zod_1.z.boolean().optional(),
    continueOnFail: zod_1.z.boolean().optional(),
    retryOnFail: zod_1.z.boolean().optional(),
    maxTries: zod_1.z.number().optional(),
    waitBetweenTries: zod_1.z.number().optional(),
    alwaysOutputData: zod_1.z.boolean().optional(),
    executeOnce: zod_1.z.boolean().optional(),
    onError: zod_1.z.enum(['continueRegularOutput', 'continueErrorOutput', 'stopWorkflow']).optional(),
    webhookId: zod_1.z.string().optional(),
}).strict();
exports.workflowTelemetrySchema = zod_1.z.object({
    user_id: zod_1.z.string().min(1).max(64),
    workflow_hash: zod_1.z.string().min(1).max(64),
    node_count: zod_1.z.number().int().min(0).max(1000),
    node_types: zod_1.z.array(zod_1.z.string()).max(100),
    has_trigger: zod_1.z.boolean(),
    has_webhook: zod_1.z.boolean(),
    complexity: zod_1.z.enum(['simple', 'medium', 'complex']),
    sanitized_workflow: zod_1.z.object({
        nodes: zod_1.z.array(sanitizedNodeSchema).max(1000),
        connections: zod_1.z.record(zod_1.z.any())
    }),
    created_at: zod_1.z.string().datetime().optional()
});
const toolUsagePropertiesSchema = zod_1.z.object({
    tool: zod_1.z.string().max(100),
    success: zod_1.z.boolean(),
    duration: zod_1.z.number().min(0).max(3600000),
});
const searchQueryPropertiesSchema = zod_1.z.object({
    query: zod_1.z.string().max(100).transform(val => {
        let sanitized = val.replace(/https?:\/\/[^\s]+/gi, '[URL]');
        sanitized = sanitized.replace(/[a-zA-Z0-9_-]{32,}/g, '[KEY]');
        sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
        return sanitized;
    }),
    resultsFound: zod_1.z.number().int().min(0),
    searchType: zod_1.z.string().max(50),
    hasResults: zod_1.z.boolean(),
    isZeroResults: zod_1.z.boolean()
});
const validationDetailsPropertiesSchema = zod_1.z.object({
    nodeType: zod_1.z.string().max(100),
    errorType: zod_1.z.string().max(100),
    errorCategory: zod_1.z.string().max(50),
    details: zod_1.z.record(zod_1.z.any()).optional()
});
const performanceMetricPropertiesSchema = zod_1.z.object({
    operation: zod_1.z.string().max(100),
    duration: zod_1.z.number().min(0).max(3600000),
    isSlow: zod_1.z.boolean(),
    isVerySlow: zod_1.z.boolean(),
    metadata: zod_1.z.record(zod_1.z.any()).optional()
});
const startupErrorPropertiesSchema = zod_1.z.object({
    checkpoint: zod_1.z.string().max(100),
    errorMessage: zod_1.z.string().max(500),
    errorType: zod_1.z.string().max(100),
    checkpointsPassed: zod_1.z.array(zod_1.z.string()).max(20),
    checkpointsPassedCount: zod_1.z.number().int().min(0).max(20),
    startupDuration: zod_1.z.number().min(0).max(300000),
    platform: zod_1.z.string().max(50),
    arch: zod_1.z.string().max(50),
    nodeVersion: zod_1.z.string().max(50),
    isDocker: zod_1.z.boolean()
});
const startupCompletedPropertiesSchema = zod_1.z.object({
    version: zod_1.z.string().max(50)
});
const EVENT_SCHEMAS = {
    'tool_used': toolUsagePropertiesSchema,
    'search_query': searchQueryPropertiesSchema,
    'validation_details': validationDetailsPropertiesSchema,
    'performance_metric': performanceMetricPropertiesSchema,
    'startup_error': startupErrorPropertiesSchema,
    'startup_completed': startupCompletedPropertiesSchema,
};
function isSensitiveKey(key) {
    const sensitivePatterns = [
        'password', 'passwd', 'pwd',
        'token', 'jwt', 'bearer',
        'apikey', 'api_key', 'api-key',
        'secret', 'private',
        'credential', 'cred', 'auth',
        'url', 'uri', 'endpoint', 'host', 'hostname',
        'database', 'db', 'connection', 'conn',
        'slack', 'discord', 'telegram',
        'oauth', 'client_secret', 'client-secret', 'clientsecret',
        'access_token', 'access-token', 'accesstoken',
        'refresh_token', 'refresh-token', 'refreshtoken'
    ];
    const lowerKey = key.toLowerCase();
    if (sensitivePatterns.includes(lowerKey)) {
        return true;
    }
    if (lowerKey.includes('key') && lowerKey !== 'key') {
        const keyPatterns = ['apikey', 'api_key', 'api-key', 'secretkey', 'secret_key', 'privatekey', 'private_key'];
        if (keyPatterns.some(pattern => lowerKey.includes(pattern))) {
            return true;
        }
    }
    return sensitivePatterns.some(pattern => {
        const regex = new RegExp(`(?:^|[_-])${pattern}(?:[_-]|$)`, 'i');
        return regex.test(key) || lowerKey.includes(pattern);
    });
}
function sanitizeNestedObject(obj, maxDepth) {
    if (maxDepth <= 0 || !obj || typeof obj !== 'object') {
        return '[NESTED]';
    }
    if (Array.isArray(obj)) {
        return obj.slice(0, 10).map(item => typeof item === 'object' ? sanitizeNestedObject(item, maxDepth - 1) : item);
    }
    const sanitized = {};
    let keyCount = 0;
    for (const [key, value] of Object.entries(obj)) {
        if (keyCount++ >= 20) {
            sanitized['...'] = 'truncated';
            break;
        }
        if (isSensitiveKey(key)) {
            continue;
        }
        if (typeof value === 'string') {
            sanitized[key] = sanitizedString.parse(value);
        }
        else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeNestedObject(value, maxDepth - 1);
        }
        else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}
class TelemetryEventValidator {
    constructor() {
        this.validationErrors = 0;
        this.validationSuccesses = 0;
    }
    validateEvent(event) {
        try {
            const specificSchema = EVENT_SCHEMAS[event.event];
            if (specificSchema) {
                const validatedProperties = specificSchema.safeParse(event.properties);
                if (!validatedProperties.success) {
                    logger_1.logger.debug(`Event validation failed for ${event.event}:`, validatedProperties.error.errors);
                    this.validationErrors++;
                    return null;
                }
                event.properties = validatedProperties.data;
            }
            const validated = exports.telemetryEventSchema.parse(event);
            this.validationSuccesses++;
            return validated;
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                logger_1.logger.debug('Event validation error:', error.errors);
            }
            else {
                logger_1.logger.debug('Unexpected validation error:', error);
            }
            this.validationErrors++;
            return null;
        }
    }
    validateWorkflow(workflow) {
        try {
            const validated = exports.workflowTelemetrySchema.parse(workflow);
            this.validationSuccesses++;
            return validated;
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                logger_1.logger.debug('Workflow validation error:', error.errors);
            }
            else {
                logger_1.logger.debug('Unexpected workflow validation error:', error);
            }
            this.validationErrors++;
            return null;
        }
    }
    getStats() {
        return {
            errors: this.validationErrors,
            successes: this.validationSuccesses,
            total: this.validationErrors + this.validationSuccesses,
            errorRate: this.validationErrors / (this.validationErrors + this.validationSuccesses) || 0
        };
    }
    resetStats() {
        this.validationErrors = 0;
        this.validationSuccesses = 0;
    }
}
exports.TelemetryEventValidator = TelemetryEventValidator;
//# sourceMappingURL=event-validator.js.map