"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowAutoFixer = exports.CONNECTION_FIX_TYPES = void 0;
exports.isNodeFormatIssue = isNodeFormatIssue;
const uuid_1 = require("uuid");
const workflow_validator_1 = require("./workflow-validator");
const node_similarity_service_1 = require("./node-similarity-service");
const logger_1 = require("../utils/logger");
const node_version_service_1 = require("./node-version-service");
const breaking_change_detector_1 = require("./breaking-change-detector");
const node_migration_service_1 = require("./node-migration-service");
const post_update_validator_1 = require("./post-update-validator");
const logger = new logger_1.Logger({ prefix: '[WorkflowAutoFixer]' });
exports.CONNECTION_FIX_TYPES = [
    'connection-numeric-keys',
    'connection-invalid-type',
    'connection-id-to-name',
    'connection-duplicate-removal',
    'connection-input-index'
];
function isNodeFormatIssue(issue) {
    return 'nodeName' in issue && 'nodeId' in issue &&
        typeof issue.nodeName === 'string' &&
        typeof issue.nodeId === 'string';
}
class WorkflowAutoFixer {
    constructor(repository) {
        this.defaultConfig = {
            applyFixes: false,
            confidenceThreshold: 'medium',
            maxFixes: 50
        };
        this.similarityService = null;
        this.versionService = null;
        this.breakingChangeDetector = null;
        this.migrationService = null;
        this.postUpdateValidator = null;
        if (repository) {
            this.similarityService = new node_similarity_service_1.NodeSimilarityService(repository);
            this.breakingChangeDetector = new breaking_change_detector_1.BreakingChangeDetector(repository);
            this.versionService = new node_version_service_1.NodeVersionService(repository, this.breakingChangeDetector);
            this.migrationService = new node_migration_service_1.NodeMigrationService(this.versionService, this.breakingChangeDetector);
            this.postUpdateValidator = new post_update_validator_1.PostUpdateValidator(this.versionService, this.breakingChangeDetector);
        }
    }
    async generateFixes(workflow, validationResult, formatIssues = [], config = {}) {
        const fullConfig = { ...this.defaultConfig, ...config };
        const operations = [];
        const fixes = [];
        const postUpdateGuidance = [];
        const nodeMap = new Map();
        workflow.nodes.forEach(node => {
            nodeMap.set(node.name, node);
            nodeMap.set(node.id, node);
        });
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('expression-format')) {
            this.processExpressionFormatFixes(formatIssues, nodeMap, operations, fixes);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('typeversion-correction')) {
            this.processTypeVersionFixes(validationResult, nodeMap, operations, fixes);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('error-output-config')) {
            this.processErrorOutputFixes(validationResult, nodeMap, workflow, operations, fixes);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('node-type-correction')) {
            this.processNodeTypeFixes(validationResult, nodeMap, operations, fixes);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('webhook-missing-path')) {
            this.processWebhookPathFixes(validationResult, nodeMap, operations, fixes, workflow);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('tool-variant-correction')) {
            this.processToolVariantFixes(validationResult, nodeMap, workflow, operations, fixes);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('typeversion-upgrade')) {
            await this.processVersionUpgradeFixes(workflow, nodeMap, operations, fixes, postUpdateGuidance);
        }
        if (!fullConfig.fixTypes || fullConfig.fixTypes.includes('version-migration')) {
            await this.processVersionMigrationFixes(workflow, nodeMap, operations, fixes, postUpdateGuidance);
        }
        this.processConnectionFixes(workflow, validationResult, fullConfig, operations, fixes);
        const filteredFixes = this.filterByConfidence(fixes, fullConfig.confidenceThreshold);
        const filteredOperations = this.filterOperationsByFixes(operations, filteredFixes, fixes);
        const limitedFixes = filteredFixes.slice(0, fullConfig.maxFixes);
        const limitedOperations = this.filterOperationsByFixes(filteredOperations, limitedFixes, filteredFixes);
        const stats = this.calculateStats(limitedFixes);
        const summary = this.generateSummary(stats);
        return {
            operations: limitedOperations,
            fixes: limitedFixes,
            summary,
            stats,
            postUpdateGuidance: postUpdateGuidance.length > 0 ? postUpdateGuidance : undefined
        };
    }
    processExpressionFormatFixes(formatIssues, nodeMap, operations, fixes) {
        const fixesByNode = new Map();
        for (const issue of formatIssues) {
            if (issue.issueType === 'missing-prefix') {
                if (!isNodeFormatIssue(issue)) {
                    logger.warn('Expression format issue missing node information', {
                        fieldPath: issue.fieldPath,
                        issueType: issue.issueType
                    });
                    continue;
                }
                const nodeName = issue.nodeName;
                if (!fixesByNode.has(nodeName)) {
                    fixesByNode.set(nodeName, []);
                }
                fixesByNode.get(nodeName).push(issue);
            }
        }
        for (const [nodeName, nodeIssues] of fixesByNode) {
            const node = nodeMap.get(nodeName);
            if (!node)
                continue;
            const updatedParameters = JSON.parse(JSON.stringify(node.parameters || {}));
            for (const issue of nodeIssues) {
                const fieldPath = issue.fieldPath.split('.');
                this.setNestedValue(updatedParameters, fieldPath, issue.correctedValue);
                fixes.push({
                    node: nodeName,
                    field: issue.fieldPath,
                    type: 'expression-format',
                    before: issue.currentValue,
                    after: issue.correctedValue,
                    confidence: 'high',
                    description: issue.explanation
                });
            }
            const operation = {
                type: 'updateNode',
                nodeId: nodeName,
                updates: {
                    parameters: updatedParameters
                }
            };
            operations.push(operation);
        }
    }
    processTypeVersionFixes(validationResult, nodeMap, operations, fixes) {
        for (const error of validationResult.errors) {
            if (error.message.includes('typeVersion') && error.message.includes('exceeds maximum')) {
                const versionMatch = error.message.match(/typeVersion (\d+(?:\.\d+)?) exceeds maximum supported version (\d+(?:\.\d+)?)/);
                if (versionMatch) {
                    const currentVersion = parseFloat(versionMatch[1]);
                    const maxVersion = parseFloat(versionMatch[2]);
                    const nodeName = error.nodeName || error.nodeId;
                    if (!nodeName)
                        continue;
                    const node = nodeMap.get(nodeName);
                    if (!node)
                        continue;
                    fixes.push({
                        node: nodeName,
                        field: 'typeVersion',
                        type: 'typeversion-correction',
                        before: currentVersion,
                        after: maxVersion,
                        confidence: 'medium',
                        description: `Corrected typeVersion from ${currentVersion} to maximum supported ${maxVersion}`
                    });
                    const operation = {
                        type: 'updateNode',
                        nodeId: nodeName,
                        updates: {
                            typeVersion: maxVersion
                        }
                    };
                    operations.push(operation);
                }
            }
        }
    }
    processErrorOutputFixes(validationResult, nodeMap, workflow, operations, fixes) {
        for (const error of validationResult.errors) {
            if (error.message.includes('onError: \'continueErrorOutput\'') &&
                error.message.includes('no error output connections')) {
                const nodeName = error.nodeName || error.nodeId;
                if (!nodeName)
                    continue;
                const node = nodeMap.get(nodeName);
                if (!node)
                    continue;
                fixes.push({
                    node: nodeName,
                    field: 'onError',
                    type: 'error-output-config',
                    before: 'continueErrorOutput',
                    after: undefined,
                    confidence: 'medium',
                    description: 'Removed onError setting due to missing error output connections'
                });
                const operation = {
                    type: 'updateNode',
                    nodeId: nodeName,
                    updates: {
                        onError: undefined
                    }
                };
                operations.push(operation);
            }
        }
    }
    processNodeTypeFixes(validationResult, nodeMap, operations, fixes) {
        if (!this.similarityService) {
            return;
        }
        for (const error of validationResult.errors) {
            const nodeError = error;
            if (error.message?.includes('Unknown node type:') && nodeError.suggestions) {
                const highConfidenceSuggestion = nodeError.suggestions.find(s => s.confidence >= 0.9);
                if (highConfidenceSuggestion && nodeError.nodeId) {
                    const node = nodeMap.get(nodeError.nodeId) || nodeMap.get(nodeError.nodeName || '');
                    if (node) {
                        fixes.push({
                            node: node.name,
                            field: 'type',
                            type: 'node-type-correction',
                            before: node.type,
                            after: highConfidenceSuggestion.nodeType,
                            confidence: 'high',
                            description: `Fix node type: "${node.type}" → "${highConfidenceSuggestion.nodeType}" (${highConfidenceSuggestion.reason})`
                        });
                        const operation = {
                            type: 'updateNode',
                            nodeId: node.name,
                            updates: {
                                type: highConfidenceSuggestion.nodeType
                            }
                        };
                        operations.push(operation);
                    }
                }
            }
        }
    }
    deriveStableWebhookId(workflowId, nodeId) {
        const seed = `${workflowId ?? 'new'}::${nodeId}`;
        return (0, uuid_1.v5)(seed, WorkflowAutoFixer.WEBHOOK_ID_NAMESPACE);
    }
    processWebhookPathFixes(validationResult, nodeMap, operations, fixes, workflow) {
        for (const error of validationResult.errors) {
            if (error.message === 'Webhook path is required') {
                const nodeName = error.nodeName || error.nodeId;
                if (!nodeName)
                    continue;
                const node = nodeMap.get(nodeName);
                if (!node)
                    continue;
                if (!node.type?.includes('webhook'))
                    continue;
                const webhookId = this.deriveStableWebhookId(workflow.id, node.id || nodeName);
                const currentTypeVersion = node.typeVersion || 1;
                const needsVersionUpdate = currentTypeVersion < 2.1;
                fixes.push({
                    node: nodeName,
                    field: 'path',
                    type: 'webhook-missing-path',
                    before: undefined,
                    after: webhookId,
                    confidence: 'high',
                    description: needsVersionUpdate
                        ? `Generated webhook path and ID: ${webhookId} (also updating typeVersion to 2.1)`
                        : `Generated webhook path and ID: ${webhookId}`
                });
                const updates = {
                    'parameters.path': webhookId,
                    'webhookId': webhookId
                };
                if (needsVersionUpdate) {
                    updates['typeVersion'] = 2.1;
                }
                const operation = {
                    type: 'updateNode',
                    nodeId: nodeName,
                    updates
                };
                operations.push(operation);
            }
        }
    }
    processToolVariantFixes(validationResult, nodeMap, _workflow, operations, fixes) {
        for (const error of validationResult.errors) {
            if (error.code !== 'WRONG_NODE_TYPE_FOR_AI_TOOL' || !error.fix) {
                continue;
            }
            const fix = error.fix;
            if (fix.type !== 'tool-variant-correction') {
                continue;
            }
            const nodeName = error.nodeName || error.nodeId;
            if (!nodeName)
                continue;
            const node = nodeMap.get(nodeName);
            if (!node)
                continue;
            fixes.push({
                node: nodeName,
                field: 'type',
                type: 'tool-variant-correction',
                before: fix.currentType,
                after: fix.suggestedType,
                confidence: 'high',
                description: fix.description || `Replace "${fix.currentType}" with Tool variant "${fix.suggestedType}"`
            });
            const operation = {
                type: 'updateNode',
                nodeId: nodeName,
                updates: {
                    type: fix.suggestedType
                }
            };
            operations.push(operation);
            logger.info(`Generated tool variant correction for ${nodeName}: ${fix.currentType} → ${fix.suggestedType}`);
        }
    }
    setNestedValue(obj, path, value) {
        if (!obj || typeof obj !== 'object') {
            throw new Error('Cannot set value on non-object');
        }
        if (path.length === 0) {
            throw new Error('Cannot set value with empty path');
        }
        try {
            let current = obj;
            for (let i = 0; i < path.length - 1; i++) {
                const key = path[i];
                if (key.includes('[')) {
                    const matches = key.match(/^([^[]+)\[(\d+)\]$/);
                    if (!matches) {
                        throw new Error(`Invalid array notation: ${key}`);
                    }
                    const [, arrayKey, indexStr] = matches;
                    const index = parseInt(indexStr, 10);
                    if (isNaN(index) || index < 0) {
                        throw new Error(`Invalid array index: ${indexStr}`);
                    }
                    if (!current[arrayKey]) {
                        current[arrayKey] = [];
                    }
                    if (!Array.isArray(current[arrayKey])) {
                        throw new Error(`Expected array at ${arrayKey}, got ${typeof current[arrayKey]}`);
                    }
                    while (current[arrayKey].length <= index) {
                        current[arrayKey].push({});
                    }
                    current = current[arrayKey][index];
                }
                else {
                    if (current[key] === null || current[key] === undefined) {
                        current[key] = {};
                    }
                    if (typeof current[key] !== 'object' || Array.isArray(current[key])) {
                        throw new Error(`Cannot traverse through ${typeof current[key]} at ${key}`);
                    }
                    current = current[key];
                }
            }
            const lastKey = path[path.length - 1];
            if (lastKey.includes('[')) {
                const matches = lastKey.match(/^([^[]+)\[(\d+)\]$/);
                if (!matches) {
                    throw new Error(`Invalid array notation: ${lastKey}`);
                }
                const [, arrayKey, indexStr] = matches;
                const index = parseInt(indexStr, 10);
                if (isNaN(index) || index < 0) {
                    throw new Error(`Invalid array index: ${indexStr}`);
                }
                if (!current[arrayKey]) {
                    current[arrayKey] = [];
                }
                if (!Array.isArray(current[arrayKey])) {
                    throw new Error(`Expected array at ${arrayKey}, got ${typeof current[arrayKey]}`);
                }
                while (current[arrayKey].length <= index) {
                    current[arrayKey].push(null);
                }
                current[arrayKey][index] = value;
            }
            else {
                current[lastKey] = value;
            }
        }
        catch (error) {
            logger.error('Failed to set nested value', {
                path: path.join('.'),
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    filterByConfidence(fixes, threshold) {
        if (!threshold)
            return fixes;
        const levels = ['high', 'medium', 'low'];
        const thresholdIndex = levels.indexOf(threshold);
        return fixes.filter(fix => {
            const fixIndex = levels.indexOf(fix.confidence);
            return fixIndex <= thresholdIndex;
        });
    }
    filterOperationsByFixes(operations, filteredFixes, allFixes) {
        const fixedNodes = new Set(filteredFixes.map(f => f.node));
        const hasConnectionFixes = filteredFixes.some(f => exports.CONNECTION_FIX_TYPES.includes(f.type));
        return operations.filter(op => {
            if (op.type === 'updateNode') {
                return fixedNodes.has(op.nodeName || '') || fixedNodes.has(op.nodeId || '');
            }
            if (op.type === 'replaceConnections') {
                return hasConnectionFixes;
            }
            return true;
        });
    }
    calculateStats(fixes) {
        const stats = {
            total: fixes.length,
            byType: {
                'expression-format': 0,
                'typeversion-correction': 0,
                'error-output-config': 0,
                'node-type-correction': 0,
                'webhook-missing-path': 0,
                'typeversion-upgrade': 0,
                'version-migration': 0,
                'tool-variant-correction': 0,
                'connection-numeric-keys': 0,
                'connection-invalid-type': 0,
                'connection-id-to-name': 0,
                'connection-duplicate-removal': 0,
                'connection-input-index': 0
            },
            byConfidence: {
                'high': 0,
                'medium': 0,
                'low': 0
            }
        };
        for (const fix of fixes) {
            stats.byType[fix.type]++;
            stats.byConfidence[fix.confidence]++;
        }
        return stats;
    }
    generateSummary(stats) {
        if (stats.total === 0) {
            return 'No fixes available';
        }
        const parts = [];
        if (stats.byType['expression-format'] > 0) {
            parts.push(`${stats.byType['expression-format']} expression format ${stats.byType['expression-format'] === 1 ? 'error' : 'errors'}`);
        }
        if (stats.byType['typeversion-correction'] > 0) {
            parts.push(`${stats.byType['typeversion-correction']} version ${stats.byType['typeversion-correction'] === 1 ? 'issue' : 'issues'}`);
        }
        if (stats.byType['error-output-config'] > 0) {
            parts.push(`${stats.byType['error-output-config']} error output ${stats.byType['error-output-config'] === 1 ? 'configuration' : 'configurations'}`);
        }
        if (stats.byType['node-type-correction'] > 0) {
            parts.push(`${stats.byType['node-type-correction']} node type ${stats.byType['node-type-correction'] === 1 ? 'correction' : 'corrections'}`);
        }
        if (stats.byType['webhook-missing-path'] > 0) {
            parts.push(`${stats.byType['webhook-missing-path']} webhook ${stats.byType['webhook-missing-path'] === 1 ? 'path' : 'paths'}`);
        }
        if (stats.byType['typeversion-upgrade'] > 0) {
            parts.push(`${stats.byType['typeversion-upgrade']} version ${stats.byType['typeversion-upgrade'] === 1 ? 'upgrade' : 'upgrades'}`);
        }
        if (stats.byType['version-migration'] > 0) {
            parts.push(`${stats.byType['version-migration']} version ${stats.byType['version-migration'] === 1 ? 'migration' : 'migrations'}`);
        }
        if (stats.byType['tool-variant-correction'] > 0) {
            parts.push(`${stats.byType['tool-variant-correction']} tool variant ${stats.byType['tool-variant-correction'] === 1 ? 'correction' : 'corrections'}`);
        }
        const connectionIssueCount = (stats.byType['connection-numeric-keys'] || 0) +
            (stats.byType['connection-invalid-type'] || 0) +
            (stats.byType['connection-id-to-name'] || 0) +
            (stats.byType['connection-duplicate-removal'] || 0) +
            (stats.byType['connection-input-index'] || 0);
        if (connectionIssueCount > 0) {
            parts.push(`${connectionIssueCount} connection ${connectionIssueCount === 1 ? 'issue' : 'issues'}`);
        }
        if (parts.length === 0) {
            return `Fixed ${stats.total} ${stats.total === 1 ? 'issue' : 'issues'}`;
        }
        return `Fixed ${parts.join(', ')}`;
    }
    processConnectionFixes(workflow, validationResult, config, operations, fixes) {
        if (!workflow.connections || Object.keys(workflow.connections).length === 0) {
            return;
        }
        const idToNameMap = new Map();
        const nameSet = new Set();
        for (const node of workflow.nodes) {
            idToNameMap.set(node.id, node.name);
            nameSet.add(node.name);
        }
        const conn = JSON.parse(JSON.stringify(workflow.connections));
        let anyFixed = false;
        if (!config.fixTypes || config.fixTypes.includes('connection-numeric-keys')) {
            const numericKeyResult = this.fixNumericKeys(conn);
            if (numericKeyResult.length > 0) {
                fixes.push(...numericKeyResult);
                anyFixed = true;
            }
        }
        if (!config.fixTypes || config.fixTypes.includes('connection-id-to-name')) {
            const idToNameResult = this.fixIdToName(conn, idToNameMap, nameSet);
            if (idToNameResult.length > 0) {
                fixes.push(...idToNameResult);
                anyFixed = true;
            }
        }
        if (!config.fixTypes || config.fixTypes.includes('connection-invalid-type')) {
            const invalidTypeResult = this.fixInvalidTypes(conn);
            if (invalidTypeResult.length > 0) {
                fixes.push(...invalidTypeResult);
                anyFixed = true;
            }
        }
        if (!config.fixTypes || config.fixTypes.includes('connection-input-index')) {
            const inputIndexResult = this.fixInputIndices(conn, validationResult, workflow);
            if (inputIndexResult.length > 0) {
                fixes.push(...inputIndexResult);
                anyFixed = true;
            }
        }
        if (!config.fixTypes || config.fixTypes.includes('connection-duplicate-removal')) {
            const dedupResult = this.fixDuplicateConnections(conn);
            if (dedupResult.length > 0) {
                fixes.push(...dedupResult);
                anyFixed = true;
            }
        }
        if (anyFixed) {
            const op = {
                type: 'replaceConnections',
                connections: conn
            };
            operations.push(op);
        }
    }
    fixNumericKeys(conn) {
        const fixes = [];
        const sourceNodes = Object.keys(conn);
        for (const sourceName of sourceNodes) {
            const nodeConn = conn[sourceName];
            const numericKeys = Object.keys(nodeConn).filter(k => /^\d+$/.test(k));
            if (numericKeys.length === 0)
                continue;
            if (!nodeConn['main']) {
                nodeConn['main'] = [];
            }
            for (const numKey of numericKeys) {
                const index = parseInt(numKey, 10);
                const entries = nodeConn[numKey];
                while (nodeConn['main'].length <= index) {
                    nodeConn['main'].push([]);
                }
                const hadExisting = nodeConn['main'][index] && nodeConn['main'][index].length > 0;
                if (Array.isArray(entries)) {
                    for (const outputGroup of entries) {
                        if (Array.isArray(outputGroup)) {
                            nodeConn['main'][index] = [
                                ...nodeConn['main'][index],
                                ...outputGroup
                            ];
                        }
                    }
                }
                if (hadExisting) {
                    logger.warn(`Merged numeric key "${numKey}" into existing main[${index}] on node "${sourceName}" - dedup pass will clean exact duplicates`);
                }
                fixes.push({
                    node: sourceName,
                    field: `connections.${sourceName}.${numKey}`,
                    type: 'connection-numeric-keys',
                    before: numKey,
                    after: `main[${index}]`,
                    confidence: hadExisting ? 'medium' : 'high',
                    description: hadExisting
                        ? `Merged numeric connection key "${numKey}" into existing main[${index}] on node "${sourceName}"`
                        : `Converted numeric connection key "${numKey}" to main[${index}] on node "${sourceName}"`
                });
                delete nodeConn[numKey];
            }
        }
        return fixes;
    }
    fixIdToName(conn, idToNameMap, nameSet) {
        const fixes = [];
        const renames = [];
        const sourceKeys = Object.keys(conn);
        for (const sourceKey of sourceKeys) {
            if (idToNameMap.has(sourceKey) && !nameSet.has(sourceKey)) {
                renames.push({ oldKey: sourceKey, newKey: idToNameMap.get(sourceKey) });
            }
        }
        const newKeyCount = new Map();
        for (const r of renames) {
            newKeyCount.set(r.newKey, (newKeyCount.get(r.newKey) || 0) + 1);
        }
        const safeRenames = renames.filter(r => {
            if ((newKeyCount.get(r.newKey) || 0) > 1) {
                logger.warn(`Skipping ambiguous ID-to-name rename: "${r.oldKey}" → "${r.newKey}" (multiple IDs map to same name)`);
                return false;
            }
            return true;
        });
        for (const { oldKey, newKey } of safeRenames) {
            conn[newKey] = conn[oldKey];
            delete conn[oldKey];
            fixes.push({
                node: newKey,
                field: `connections.sourceKey`,
                type: 'connection-id-to-name',
                before: oldKey,
                after: newKey,
                confidence: 'high',
                description: `Replaced node ID "${oldKey}" with name "${newKey}" as connection source key`
            });
        }
        for (const sourceName of Object.keys(conn)) {
            const nodeConn = conn[sourceName];
            for (const outputKey of Object.keys(nodeConn)) {
                const outputs = nodeConn[outputKey];
                if (!Array.isArray(outputs))
                    continue;
                for (const outputGroup of outputs) {
                    if (!Array.isArray(outputGroup))
                        continue;
                    for (const entry of outputGroup) {
                        if (entry && entry.node && idToNameMap.has(entry.node) && !nameSet.has(entry.node)) {
                            const oldNode = entry.node;
                            const newNode = idToNameMap.get(entry.node);
                            entry.node = newNode;
                            fixes.push({
                                node: sourceName,
                                field: `connections.${sourceName}.${outputKey}[].node`,
                                type: 'connection-id-to-name',
                                before: oldNode,
                                after: newNode,
                                confidence: 'high',
                                description: `Replaced target node ID "${oldNode}" with name "${newNode}" in connection from "${sourceName}"`
                            });
                        }
                    }
                }
            }
        }
        return fixes;
    }
    fixInvalidTypes(conn) {
        const fixes = [];
        for (const sourceName of Object.keys(conn)) {
            const nodeConn = conn[sourceName];
            for (const outputKey of Object.keys(nodeConn)) {
                const outputs = nodeConn[outputKey];
                if (!Array.isArray(outputs))
                    continue;
                for (const outputGroup of outputs) {
                    if (!Array.isArray(outputGroup))
                        continue;
                    for (const entry of outputGroup) {
                        if (entry && entry.type && !workflow_validator_1.VALID_CONNECTION_TYPES.has(entry.type)) {
                            const oldType = entry.type;
                            const newType = workflow_validator_1.VALID_CONNECTION_TYPES.has(outputKey) ? outputKey : 'main';
                            entry.type = newType;
                            fixes.push({
                                node: sourceName,
                                field: `connections.${sourceName}.${outputKey}[].type`,
                                type: 'connection-invalid-type',
                                before: oldType,
                                after: newType,
                                confidence: 'high',
                                description: `Fixed invalid connection type "${oldType}" → "${newType}" in connection from "${sourceName}" to "${entry.node}"`
                            });
                        }
                    }
                }
            }
        }
        return fixes;
    }
    fixInputIndices(conn, validationResult, workflow) {
        const fixes = [];
        for (const error of validationResult.errors) {
            if (error.code !== 'INPUT_INDEX_OUT_OF_BOUNDS')
                continue;
            const targetNodeName = error.nodeName;
            if (!targetNodeName)
                continue;
            const match = error.message.match(/Input index (\d+).*?has (\d+) main input/);
            if (!match) {
                logger.warn(`Could not parse INPUT_INDEX_OUT_OF_BOUNDS error for node "${targetNodeName}": ${error.message}`);
                continue;
            }
            const badIndex = parseInt(match[1], 10);
            const inputCount = parseInt(match[2], 10);
            const clampedIndex = inputCount > 1 ? Math.min(badIndex, inputCount - 1) : 0;
            for (const sourceName of Object.keys(conn)) {
                const nodeConn = conn[sourceName];
                for (const outputKey of Object.keys(nodeConn)) {
                    const outputs = nodeConn[outputKey];
                    if (!Array.isArray(outputs))
                        continue;
                    for (const outputGroup of outputs) {
                        if (!Array.isArray(outputGroup))
                            continue;
                        for (const entry of outputGroup) {
                            if (entry && entry.node === targetNodeName && entry.index === badIndex) {
                                entry.index = clampedIndex;
                                fixes.push({
                                    node: sourceName,
                                    field: `connections.${sourceName}.${outputKey}[].index`,
                                    type: 'connection-input-index',
                                    before: badIndex,
                                    after: clampedIndex,
                                    confidence: 'medium',
                                    description: `Clamped input index ${badIndex} → ${clampedIndex} for target node "${targetNodeName}" (has ${inputCount} input${inputCount === 1 ? '' : 's'})`
                                });
                            }
                        }
                    }
                }
            }
        }
        return fixes;
    }
    fixDuplicateConnections(conn) {
        const fixes = [];
        for (const sourceName of Object.keys(conn)) {
            const nodeConn = conn[sourceName];
            for (const outputKey of Object.keys(nodeConn)) {
                const outputs = nodeConn[outputKey];
                if (!Array.isArray(outputs))
                    continue;
                for (let i = 0; i < outputs.length; i++) {
                    const outputGroup = outputs[i];
                    if (!Array.isArray(outputGroup))
                        continue;
                    const seen = new Set();
                    const deduped = [];
                    for (const entry of outputGroup) {
                        const key = JSON.stringify({ node: entry.node, type: entry.type, index: entry.index });
                        if (seen.has(key)) {
                            fixes.push({
                                node: sourceName,
                                field: `connections.${sourceName}.${outputKey}[${i}]`,
                                type: 'connection-duplicate-removal',
                                before: entry,
                                after: null,
                                confidence: 'high',
                                description: `Removed duplicate connection from "${sourceName}" to "${entry.node}" (type: ${entry.type}, index: ${entry.index})`
                            });
                        }
                        else {
                            seen.add(key);
                            deduped.push(entry);
                        }
                    }
                    outputs[i] = deduped;
                }
            }
        }
        return fixes;
    }
    async processVersionUpgradeFixes(workflow, nodeMap, operations, fixes, postUpdateGuidance) {
        if (!this.versionService || !this.migrationService || !this.postUpdateValidator) {
            logger.warn('Version services not initialized. Skipping version upgrade fixes.');
            return;
        }
        for (const node of workflow.nodes) {
            if (!node.typeVersion || !node.type)
                continue;
            const currentVersion = node.typeVersion.toString();
            const analysis = this.versionService.analyzeVersion(node.type, currentVersion);
            if (!analysis.isOutdated || !analysis.recommendUpgrade)
                continue;
            if (analysis.confidence === 'LOW')
                continue;
            const latestVersion = analysis.latestVersion;
            try {
                const migrationResult = await this.migrationService.migrateNode(node, currentVersion, latestVersion);
                fixes.push({
                    node: node.name,
                    field: 'typeVersion',
                    type: 'typeversion-upgrade',
                    before: currentVersion,
                    after: latestVersion,
                    confidence: analysis.hasBreakingChanges ? 'medium' : 'high',
                    description: `Upgrade ${node.name} from v${currentVersion} to v${latestVersion}. ${analysis.reason}`
                });
                const operation = {
                    type: 'updateNode',
                    nodeId: node.id,
                    nodeName: node.name,
                    updates: {
                        typeVersion: parseFloat(latestVersion),
                        parameters: migrationResult.updatedNode.parameters,
                        ...(migrationResult.updatedNode.webhookId && { webhookId: migrationResult.updatedNode.webhookId })
                    }
                };
                operations.push(operation);
                const guidance = await this.postUpdateValidator.generateGuidance(node.id, node.name, node.type, currentVersion, latestVersion, migrationResult);
                postUpdateGuidance.push(guidance);
                logger.info(`Generated version upgrade fix for ${node.name}: ${currentVersion} → ${latestVersion}`, {
                    appliedMigrations: migrationResult.appliedMigrations.length,
                    remainingIssues: migrationResult.remainingIssues.length
                });
            }
            catch (error) {
                logger.error(`Failed to process version upgrade for ${node.name}`, { error });
            }
        }
    }
    async processVersionMigrationFixes(workflow, nodeMap, operations, fixes, postUpdateGuidance) {
        if (!this.versionService || !this.breakingChangeDetector || !this.postUpdateValidator) {
            logger.warn('Version services not initialized. Skipping version migration fixes.');
            return;
        }
        for (const node of workflow.nodes) {
            if (!node.typeVersion || !node.type)
                continue;
            const currentVersion = node.typeVersion.toString();
            const latestVersion = this.versionService.getLatestVersion(node.type);
            if (!latestVersion || currentVersion === latestVersion)
                continue;
            const hasBreaking = this.breakingChangeDetector.hasBreakingChanges(node.type, currentVersion, latestVersion);
            if (!hasBreaking)
                continue;
            const analysis = await this.breakingChangeDetector.analyzeVersionUpgrade(node.type, currentVersion, latestVersion);
            if (analysis.autoMigratableCount === analysis.changes.length)
                continue;
            const guidance = await this.postUpdateValidator.generateGuidance(node.id, node.name, node.type, currentVersion, latestVersion, {
                success: false,
                nodeId: node.id,
                nodeName: node.name,
                fromVersion: currentVersion,
                toVersion: latestVersion,
                appliedMigrations: [],
                remainingIssues: analysis.recommendations,
                confidence: analysis.overallSeverity === 'HIGH' ? 'LOW' : 'MEDIUM',
                updatedNode: node
            });
            fixes.push({
                node: node.name,
                field: 'typeVersion',
                type: 'version-migration',
                before: currentVersion,
                after: latestVersion,
                confidence: guidance.confidence === 'HIGH' ? 'medium' : 'low',
                description: `Version migration required: ${node.name} v${currentVersion} → v${latestVersion}. ${analysis.manualRequiredCount} manual action(s) required.`
            });
            postUpdateGuidance.push(guidance);
            logger.info(`Documented version migration for ${node.name}`, {
                breakingChanges: analysis.changes.filter(c => c.isBreaking).length,
                manualRequired: analysis.manualRequiredCount
            });
        }
    }
}
exports.WorkflowAutoFixer = WorkflowAutoFixer;
WorkflowAutoFixer.WEBHOOK_ID_NAMESPACE = '6d8f5c4a-7b1e-4d2f-9a3c-8e5b1d2f6a7c';
//# sourceMappingURL=workflow-auto-fixer.js.map