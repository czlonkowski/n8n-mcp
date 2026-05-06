"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowSanitizer = void 0;
const crypto_1 = require("crypto");
class WorkflowSanitizer {
    static sanitizeWorkflow(workflow) {
        const sanitized = JSON.parse(JSON.stringify(workflow));
        if (sanitized.nodes && Array.isArray(sanitized.nodes)) {
            sanitized.nodes = sanitized.nodes.map((node) => this.sanitizeNode(node));
        }
        if (sanitized.connections) {
            sanitized.connections = this.sanitizeConnections(sanitized.connections);
        }
        delete sanitized.settings?.errorWorkflow;
        delete sanitized.staticData;
        delete sanitized.pinData;
        delete sanitized.credentials;
        delete sanitized.sharedWorkflows;
        delete sanitized.ownedBy;
        delete sanitized.createdBy;
        delete sanitized.updatedBy;
        const nodeTypes = sanitized.nodes?.map((n) => n.type) || [];
        const uniqueNodeTypes = [...new Set(nodeTypes)];
        const hasTrigger = nodeTypes.some((type) => type.includes('trigger') || type.includes('webhook'));
        const hasWebhook = nodeTypes.some((type) => type.includes('webhook'));
        const nodeCount = sanitized.nodes?.length || 0;
        let complexity = 'simple';
        if (nodeCount > 20) {
            complexity = 'complex';
        }
        else if (nodeCount > 10) {
            complexity = 'medium';
        }
        const workflowStructure = JSON.stringify({
            nodeTypes: uniqueNodeTypes.sort(),
            connections: sanitized.connections
        });
        const workflowHash = (0, crypto_1.createHash)('sha256')
            .update(workflowStructure)
            .digest('hex')
            .substring(0, 16);
        return {
            nodes: sanitized.nodes || [],
            connections: sanitized.connections || {},
            nodeCount,
            nodeTypes: uniqueNodeTypes,
            hasTrigger,
            hasWebhook,
            complexity,
            workflowHash
        };
    }
    static sanitizeTelemetryObject(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'string') {
            return this.sanitizeString(value, '');
        }
        return this.sanitizeObject(value);
    }
    static sanitizeNode(node) {
        const sanitized = { ...node };
        delete sanitized.credentials;
        if (sanitized.parameters) {
            sanitized.parameters = this.sanitizeObject(sanitized.parameters);
        }
        return sanitized;
    }
    static sanitizeObject(obj) {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item));
        }
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            const isSensitive = this.isSensitiveField(key);
            const isUrlField = key.toLowerCase().includes('url') ||
                key.toLowerCase().includes('endpoint') ||
                key.toLowerCase().includes('webhook');
            if (typeof value === 'object' && value !== null) {
                if (isSensitive && !isUrlField) {
                    sanitized[key] = '[REDACTED]';
                }
                else {
                    sanitized[key] = this.sanitizeObject(value);
                }
            }
            else if (typeof value === 'string') {
                if (isSensitive && !isUrlField) {
                    sanitized[key] = '[REDACTED]';
                }
                else {
                    sanitized[key] = this.sanitizeString(value, key);
                }
            }
            else if (isSensitive) {
                sanitized[key] = '[REDACTED]';
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    static sanitizeString(value, fieldName) {
        if (value.includes('/webhook/') || value.includes('/hook/')) {
            return 'https://[webhook-url]';
        }
        let sanitized = value;
        for (const patternDef of this.SENSITIVE_PATTERNS) {
            if (patternDef.placeholder.includes('WEBHOOK')) {
                continue;
            }
            if (patternDef.placeholder === '[REDACTED_URL_WITH_AUTH]') {
                const matches = value.match(patternDef.pattern);
                if (matches) {
                    for (const match of matches) {
                        const fullUrlMatch = value.indexOf(match);
                        if (fullUrlMatch !== -1) {
                            const afterUrl = value.substring(fullUrlMatch + match.length);
                            if (afterUrl && afterUrl.startsWith('/')) {
                                const pathPart = afterUrl.split(/[\s?&#]/)[0];
                                sanitized = sanitized.replace(match + pathPart, patternDef.placeholder + pathPart);
                            }
                            else {
                                sanitized = sanitized.replace(match, patternDef.placeholder);
                            }
                        }
                    }
                }
                continue;
            }
            sanitized = sanitized.replace(patternDef.pattern, patternDef.placeholder);
        }
        if (fieldName.toLowerCase().includes('url') ||
            fieldName.toLowerCase().includes('endpoint')) {
            if (sanitized.startsWith('http://') || sanitized.startsWith('https://')) {
                if (sanitized.includes('[REDACTED_URL_WITH_AUTH]')) {
                    return sanitized;
                }
                if (sanitized.includes('[REDACTED]')) {
                    return sanitized;
                }
                const urlParts = sanitized.split('/');
                if (urlParts.length > 2) {
                    urlParts[2] = '[domain]';
                    sanitized = urlParts.join('/');
                }
            }
        }
        return sanitized;
    }
    static isSensitiveField(fieldName) {
        const lowerFieldName = fieldName.toLowerCase();
        return this.SENSITIVE_FIELDS.some(sensitive => lowerFieldName.includes(sensitive.toLowerCase()));
    }
    static sanitizeConnections(connections) {
        if (!connections || typeof connections !== 'object') {
            return connections;
        }
        const sanitized = {};
        for (const [nodeId, nodeConnections] of Object.entries(connections)) {
            if (typeof nodeConnections === 'object' && nodeConnections !== null) {
                sanitized[nodeId] = {};
                for (const [connType, connArray] of Object.entries(nodeConnections)) {
                    if (Array.isArray(connArray)) {
                        sanitized[nodeId][connType] = connArray.map((conns) => {
                            if (Array.isArray(conns)) {
                                return conns.map((conn) => ({
                                    node: conn.node,
                                    type: conn.type,
                                    index: conn.index
                                }));
                            }
                            return conns;
                        });
                    }
                    else {
                        sanitized[nodeId][connType] = connArray;
                    }
                }
            }
            else {
                sanitized[nodeId] = nodeConnections;
            }
        }
        return sanitized;
    }
    static generateWorkflowHash(workflow) {
        const sanitized = this.sanitizeWorkflow(workflow);
        return sanitized.workflowHash;
    }
    static sanitizeWorkflowRaw(workflow) {
        const sanitized = JSON.parse(JSON.stringify(workflow));
        if (sanitized.nodes && Array.isArray(sanitized.nodes)) {
            sanitized.nodes = sanitized.nodes.map((node) => this.sanitizeNode(node));
        }
        if (sanitized.connections) {
            sanitized.connections = this.sanitizeConnections(sanitized.connections);
        }
        delete sanitized.settings?.errorWorkflow;
        delete sanitized.staticData;
        delete sanitized.pinData;
        delete sanitized.credentials;
        delete sanitized.sharedWorkflows;
        delete sanitized.ownedBy;
        delete sanitized.createdBy;
        delete sanitized.updatedBy;
        return sanitized;
    }
}
exports.WorkflowSanitizer = WorkflowSanitizer;
WorkflowSanitizer.SENSITIVE_PATTERNS = [
    { pattern: /https?:\/\/[^\s/]+\/webhook\/[^\s]+/g, placeholder: '[REDACTED_WEBHOOK]' },
    { pattern: /https?:\/\/[^\s/]+\/hook\/[^\s]+/g, placeholder: '[REDACTED_WEBHOOK]' },
    { pattern: /https?:\/\/n8n\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_N8N_HOST_URL]' },
    { pattern: /https?:\/\/[a-z]{20}\.supabase\.co(?:[/?#][^\s"'<>]*)?/gi, placeholder: '[REDACTED_SUPABASE_URL]' },
    { pattern: /https?:\/\/[^:]+:[^@]+@[^\s/]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /wss?:\/\/[^:]+:[^@]+@[^\s/]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/g, placeholder: '[REDACTED_URL_WITH_AUTH]' },
    { pattern: /Bearer\s+[^\s'"`,;}\]]+/gi, placeholder: 'Bearer [REDACTED]' },
    { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, placeholder: '[REDACTED_JWT]' },
    { pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED_SUPABASE_KEY]' },
    { pattern: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\bsk-or-(?:v1-)?[A-Za-z0-9-]{40,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b/g, placeholder: '[REDACTED_STRIPE_KEY]' },
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bghp_[A-Za-z0-9]{36,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bhf_[A-Za-z0-9]{30,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bntn_[A-Za-z0-9]{40,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bpit-[a-f0-9-]{36}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bxox[bpaors]-[A-Za-z0-9-]{10,}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bAKIA[A-Z0-9]{16}\b/g, placeholder: '[REDACTED_API_TOKEN]' },
    { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, placeholder: '[REDACTED_LLM_API_KEY]' },
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: '[REDACTED_EMAIL]' },
    { pattern: /(?<![\d-])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d-])/g, placeholder: '[REDACTED_PHONE]' },
    { pattern: /\b(?!REDACTED)[A-Za-z0-9_-]{32,}\b/g, placeholder: '[REDACTED_TOKEN]' },
    { pattern: /\b(?!REDACTED)[A-Za-z0-9_-]{20,31}\b/g, placeholder: '[REDACTED]' },
];
WorkflowSanitizer.SENSITIVE_FIELDS = [
    'apiKey',
    'api_key',
    'token',
    'secret',
    'password',
    'credential',
    'auth',
    'authorization',
    'webhook',
    'webhookUrl',
    'url',
    'endpoint',
    'host',
    'server',
    'database',
    'connectionString',
    'privateKey',
    'publicKey',
    'certificate',
];
//# sourceMappingURL=workflow-sanitizer.js.map