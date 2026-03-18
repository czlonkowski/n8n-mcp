"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processErrorExecution = processErrorExecution;
const logger_1 = require("../utils/logger");
const MAX_STACK_LINES = 3;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_PATTERNS = [
    'password',
    'secret',
    'token',
    'apikey',
    'api_key',
    'credential',
    'auth',
    'private_key',
    'privatekey',
    'bearer',
    'jwt',
    'oauth',
    'certificate',
    'passphrase',
    'access_token',
    'refresh_token',
    'session',
    'cookie',
    'authorization'
];
function processErrorExecution(execution, options = {}) {
    const { itemsLimit = 2, includeStackTrace = false, includeExecutionPath = true, workflow } = options;
    const resultData = execution.data?.resultData;
    const error = resultData?.error;
    const runData = resultData?.runData || {};
    const lastNode = resultData?.lastNodeExecuted;
    const primaryError = extractPrimaryError(error, lastNode, runData, includeStackTrace);
    const upstreamContext = extractUpstreamContext(primaryError.nodeName, runData, workflow, itemsLimit);
    const executionPath = includeExecutionPath
        ? buildExecutionPath(primaryError.nodeName, runData, workflow)
        : undefined;
    const additionalErrors = findAdditionalErrors(primaryError.nodeName, runData);
    const suggestions = generateSuggestions(primaryError, upstreamContext);
    return {
        primaryError,
        upstreamContext,
        executionPath,
        additionalErrors: additionalErrors.length > 0 ? additionalErrors : undefined,
        suggestions: suggestions.length > 0 ? suggestions : undefined
    };
}
function extractPrimaryError(error, lastNode, runData, includeFullStackTrace) {
    const errorNode = error?.node;
    const nodeName = errorNode?.name || lastNode || 'Unknown';
    const nodeRunData = runData[nodeName];
    const nodeError = nodeRunData?.[0]?.error;
    const stackTrace = (error?.stack || nodeError?.stack);
    return {
        message: (error?.message || nodeError?.message || 'Unknown error'),
        errorType: (error?.name || nodeError?.name || 'Error'),
        nodeName,
        nodeType: (errorNode?.type || ''),
        nodeId: errorNode?.id,
        nodeParameters: extractRelevantParameters(errorNode?.parameters),
        stackTrace: includeFullStackTrace ? stackTrace : truncateStackTrace(stackTrace)
    };
}
function extractUpstreamContext(errorNodeName, runData, workflow, itemsLimit = 2) {
    if (workflow) {
        const upstreamNode = findUpstreamNode(errorNodeName, workflow);
        if (upstreamNode) {
            const context = extractNodeOutput(upstreamNode, runData, itemsLimit);
            if (context) {
                const nodeInfo = workflow.nodes.find(n => n.name === upstreamNode);
                if (nodeInfo) {
                    context.nodeType = nodeInfo.type;
                }
                return context;
            }
        }
    }
    const successfulNodes = Object.entries(runData)
        .filter(([name, data]) => {
        if (name === errorNodeName)
            return false;
        const runs = data;
        return runs?.[0]?.data?.main?.[0]?.length > 0 && !runs?.[0]?.error;
    })
        .map(([name, data]) => ({
        name,
        executionTime: data?.[0]?.executionTime || 0,
        startTime: data?.[0]?.startTime || 0
    }))
        .sort((a, b) => b.startTime - a.startTime);
    if (successfulNodes.length > 0) {
        const upstreamName = successfulNodes[0].name;
        return extractNodeOutput(upstreamName, runData, itemsLimit);
    }
    return undefined;
}
function findUpstreamNode(targetNode, workflow) {
    for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
        const connections = outputs;
        const mainOutputs = connections?.main || [];
        for (const outputBranch of mainOutputs) {
            if (!Array.isArray(outputBranch))
                continue;
            for (const connection of outputBranch) {
                if (connection?.node === targetNode) {
                    return sourceName;
                }
            }
        }
    }
    return undefined;
}
function findAllUpstreamNodes(targetNode, workflow, visited = new Set()) {
    const path = [];
    let currentNode = targetNode;
    while (currentNode && !visited.has(currentNode)) {
        visited.add(currentNode);
        const upstream = findUpstreamNode(currentNode, workflow);
        if (upstream) {
            path.unshift(upstream);
            currentNode = upstream;
        }
        else {
            break;
        }
    }
    return path;
}
function extractNodeOutput(nodeName, runData, itemsLimit) {
    const nodeData = runData[nodeName];
    if (!nodeData?.[0]?.data?.main?.[0])
        return undefined;
    const items = nodeData[0].data.main[0];
    const rawSamples = items.slice(0, itemsLimit);
    const sanitizedSamples = rawSamples.map((item) => sanitizeData(item));
    return {
        nodeName,
        nodeType: '',
        itemCount: items.length,
        sampleItems: sanitizedSamples,
        dataStructure: extractStructure(items[0])
    };
}
function buildExecutionPath(errorNodeName, runData, workflow) {
    const path = [];
    if (workflow) {
        const upstreamNodes = findAllUpstreamNodes(errorNodeName, workflow);
        for (const nodeName of upstreamNodes) {
            const nodeData = runData[nodeName];
            const runs = nodeData;
            const hasError = runs?.[0]?.error;
            const itemCount = runs?.[0]?.data?.main?.[0]?.length || 0;
            path.push({
                nodeName,
                status: hasError ? 'error' : (runs ? 'success' : 'skipped'),
                itemCount,
                executionTime: runs?.[0]?.executionTime
            });
        }
        const errorNodeData = runData[errorNodeName];
        path.push({
            nodeName: errorNodeName,
            status: 'error',
            itemCount: 0,
            executionTime: errorNodeData?.[0]?.executionTime
        });
    }
    else {
        const nodesByTime = Object.entries(runData)
            .map(([name, data]) => ({
            name,
            data: data,
            startTime: data?.[0]?.startTime || 0
        }))
            .sort((a, b) => a.startTime - b.startTime);
        for (const { name, data } of nodesByTime) {
            path.push({
                nodeName: name,
                status: data?.[0]?.error ? 'error' : 'success',
                itemCount: data?.[0]?.data?.main?.[0]?.length || 0,
                executionTime: data?.[0]?.executionTime
            });
        }
    }
    return path;
}
function findAdditionalErrors(primaryErrorNode, runData) {
    const additional = [];
    for (const [nodeName, data] of Object.entries(runData)) {
        if (nodeName === primaryErrorNode)
            continue;
        const runs = data;
        const error = runs?.[0]?.error;
        if (error) {
            additional.push({
                nodeName,
                message: error.message || 'Unknown error'
            });
        }
    }
    return additional;
}
function generateSuggestions(error, upstream) {
    const suggestions = [];
    const message = error.message.toLowerCase();
    if (message.includes('required') || message.includes('must be provided') || message.includes('is required')) {
        suggestions.push({
            type: 'fix',
            title: 'Missing Required Field',
            description: `Check "${error.nodeName}" parameters for required fields. Error indicates a mandatory value is missing.`,
            confidence: 'high'
        });
    }
    if (upstream?.itemCount === 0) {
        suggestions.push({
            type: 'investigate',
            title: 'No Input Data',
            description: `"${error.nodeName}" received 0 items from "${upstream.nodeName}". Check upstream node's filtering or data source.`,
            confidence: 'high'
        });
    }
    if (message.includes('auth') || message.includes('credentials') ||
        message.includes('401') || message.includes('unauthorized') ||
        message.includes('forbidden') || message.includes('403')) {
        suggestions.push({
            type: 'fix',
            title: 'Authentication Issue',
            description: 'Verify credentials are configured correctly. Check API key permissions and expiration.',
            confidence: 'high'
        });
    }
    if (message.includes('rate limit') || message.includes('429') ||
        message.includes('too many requests') || message.includes('throttle')) {
        suggestions.push({
            type: 'workaround',
            title: 'Rate Limited',
            description: 'Add delay between requests or reduce batch size. Consider using retry with exponential backoff.',
            confidence: 'high'
        });
    }
    if (message.includes('econnrefused') || message.includes('enotfound') ||
        message.includes('etimedout') || message.includes('network') ||
        message.includes('connect')) {
        suggestions.push({
            type: 'investigate',
            title: 'Network/Connection Error',
            description: 'Check if the external service is reachable. Verify URL, firewall rules, and DNS resolution.',
            confidence: 'high'
        });
    }
    if (message.includes('json') || message.includes('parse error') ||
        message.includes('unexpected token') || message.includes('syntax error')) {
        suggestions.push({
            type: 'fix',
            title: 'Invalid JSON Format',
            description: 'Check the data format. Ensure JSON is properly structured with correct syntax.',
            confidence: 'high'
        });
    }
    if (message.includes('not found') || message.includes('undefined') ||
        message.includes('cannot read property') || message.includes('does not exist')) {
        suggestions.push({
            type: 'investigate',
            title: 'Missing Data Field',
            description: 'A referenced field does not exist in the input data. Check data structure and field names.',
            confidence: 'medium'
        });
    }
    if (message.includes('type') && (message.includes('expected') || message.includes('invalid'))) {
        suggestions.push({
            type: 'fix',
            title: 'Data Type Mismatch',
            description: 'Input data type does not match expected type. Check if strings/numbers/arrays are used correctly.',
            confidence: 'medium'
        });
    }
    if (message.includes('timeout') || message.includes('timed out')) {
        suggestions.push({
            type: 'workaround',
            title: 'Operation Timeout',
            description: 'The operation took too long. Consider increasing timeout, reducing data size, or optimizing the query.',
            confidence: 'high'
        });
    }
    if (message.includes('permission') || message.includes('access denied') || message.includes('not allowed')) {
        suggestions.push({
            type: 'fix',
            title: 'Permission Denied',
            description: 'The operation lacks required permissions. Check user roles, API scopes, or resource access settings.',
            confidence: 'high'
        });
    }
    if (error.errorType === 'NodeOperationError' && suggestions.length === 0) {
        suggestions.push({
            type: 'investigate',
            title: 'Node Configuration Issue',
            description: `Review "${error.nodeName}" parameters and operation settings. Validate against the node's requirements.`,
            confidence: 'medium'
        });
    }
    return suggestions;
}
function isSensitiveKey(key) {
    const lowerKey = key.toLowerCase();
    return SENSITIVE_PATTERNS.some(pattern => lowerKey.includes(pattern));
}
function sanitizeData(data, depth = 0, maxDepth = 10) {
    if (depth >= maxDepth) {
        return '[max depth reached]';
    }
    if (data === null || data === undefined) {
        return data;
    }
    if (typeof data !== 'object') {
        if (typeof data === 'string' && data.length > 500) {
            return '[truncated]';
        }
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(item => sanitizeData(item, depth + 1, maxDepth));
    }
    const sanitized = {};
    const obj = data;
    for (const [key, value] of Object.entries(obj)) {
        if (DANGEROUS_KEYS.has(key)) {
            logger_1.logger.warn(`Blocked potentially dangerous key: ${key}`);
            continue;
        }
        if (isSensitiveKey(key)) {
            sanitized[key] = '[REDACTED]';
            continue;
        }
        sanitized[key] = sanitizeData(value, depth + 1, maxDepth);
    }
    return sanitized;
}
function extractRelevantParameters(params) {
    if (!params || typeof params !== 'object')
        return undefined;
    const sanitized = sanitizeData(params);
    if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
        return undefined;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
function truncateStackTrace(stack) {
    if (!stack)
        return undefined;
    const lines = stack.split('\n');
    if (lines.length <= MAX_STACK_LINES)
        return stack;
    return lines.slice(0, MAX_STACK_LINES).join('\n') + `\n... (${lines.length - MAX_STACK_LINES} more lines)`;
}
function extractStructure(item, depth = 0, maxDepth = 3) {
    if (depth >= maxDepth)
        return { _type: typeof item };
    if (item === null || item === undefined) {
        return { _type: 'null' };
    }
    if (Array.isArray(item)) {
        if (item.length === 0)
            return { _type: 'array', _length: 0 };
        return {
            _type: 'array',
            _length: item.length,
            _itemStructure: extractStructure(item[0], depth + 1, maxDepth)
        };
    }
    if (typeof item === 'object') {
        const structure = {};
        for (const [key, value] of Object.entries(item)) {
            structure[key] = extractStructure(value, depth + 1, maxDepth);
        }
        return structure;
    }
    return { _type: typeof item };
}
//# sourceMappingURL=error-execution-processor.js.map