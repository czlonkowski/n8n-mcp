"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowDiffEngine = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
const node_sanitizer_1 = require("./node-sanitizer");
const node_type_utils_1 = require("../utils/node-type-utils");
const logger = new logger_1.Logger({ prefix: '[WorkflowDiffEngine]' });
class WorkflowDiffEngine {
    constructor() {
        this.renameMap = new Map();
        this.warnings = [];
        this.modifiedNodeIds = new Set();
        this.removedNodeNames = new Set();
        this.tagsToAdd = [];
        this.tagsToRemove = [];
    }
    async applyDiff(workflow, request) {
        try {
            this.renameMap.clear();
            this.warnings = [];
            this.modifiedNodeIds.clear();
            this.removedNodeNames.clear();
            this.tagsToAdd = [];
            this.tagsToRemove = [];
            this.transferToProjectId = undefined;
            const workflowCopy = JSON.parse(JSON.stringify(workflow));
            const nodeOperationTypes = ['addNode', 'removeNode', 'updateNode', 'moveNode', 'enableNode', 'disableNode'];
            const nodeOperations = [];
            const otherOperations = [];
            request.operations.forEach((operation, index) => {
                if (nodeOperationTypes.includes(operation.type)) {
                    nodeOperations.push({ operation, index });
                }
                else {
                    otherOperations.push({ operation, index });
                }
            });
            const allOperations = [...nodeOperations, ...otherOperations];
            const errors = [];
            const appliedIndices = [];
            const failedIndices = [];
            if (request.continueOnError) {
                for (const { operation, index } of allOperations) {
                    const error = this.validateOperation(workflowCopy, operation);
                    if (error) {
                        errors.push({
                            operation: index,
                            message: error,
                            details: operation
                        });
                        failedIndices.push(index);
                        continue;
                    }
                    try {
                        this.applyOperation(workflowCopy, operation);
                        appliedIndices.push(index);
                    }
                    catch (error) {
                        const errorMsg = `Failed to apply operation: ${error instanceof Error ? error.message : 'Unknown error'}`;
                        errors.push({
                            operation: index,
                            message: errorMsg,
                            details: operation
                        });
                        failedIndices.push(index);
                    }
                }
                if (this.renameMap.size > 0 && appliedIndices.length > 0) {
                    this.updateConnectionReferences(workflowCopy);
                    logger.debug(`Auto-updated ${this.renameMap.size} node name references in connections (continueOnError mode)`);
                }
                if (request.validateOnly) {
                    return {
                        success: errors.length === 0,
                        message: errors.length === 0
                            ? 'Validation successful. All operations are valid.'
                            : `Validation completed with ${errors.length} errors.`,
                        errors: errors.length > 0 ? errors : undefined,
                        warnings: this.warnings.length > 0 ? this.warnings : undefined,
                        applied: appliedIndices,
                        failed: failedIndices
                    };
                }
                const shouldActivate = workflowCopy._shouldActivate === true;
                const shouldDeactivate = workflowCopy._shouldDeactivate === true;
                delete workflowCopy._shouldActivate;
                delete workflowCopy._shouldDeactivate;
                const success = appliedIndices.length > 0;
                return {
                    success,
                    workflow: workflowCopy,
                    operationsApplied: appliedIndices.length,
                    message: `Applied ${appliedIndices.length} operations, ${failedIndices.length} failed (continueOnError mode)`,
                    errors: errors.length > 0 ? errors : undefined,
                    warnings: this.warnings.length > 0 ? this.warnings : undefined,
                    applied: appliedIndices,
                    failed: failedIndices,
                    shouldActivate: shouldActivate || undefined,
                    shouldDeactivate: shouldDeactivate || undefined,
                    tagsToAdd: this.tagsToAdd.length > 0 ? this.tagsToAdd : undefined,
                    tagsToRemove: this.tagsToRemove.length > 0 ? this.tagsToRemove : undefined,
                    transferToProjectId: this.transferToProjectId || undefined
                };
            }
            else {
                for (const { operation, index } of nodeOperations) {
                    const error = this.validateOperation(workflowCopy, operation);
                    if (error) {
                        return {
                            success: false,
                            errors: [{
                                    operation: index,
                                    message: error,
                                    details: operation
                                }]
                        };
                    }
                    try {
                        this.applyOperation(workflowCopy, operation);
                    }
                    catch (error) {
                        return {
                            success: false,
                            errors: [{
                                    operation: index,
                                    message: `Failed to apply operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                    details: operation
                                }]
                        };
                    }
                }
                if (this.renameMap.size > 0) {
                    this.updateConnectionReferences(workflowCopy);
                    logger.debug(`Auto-updated ${this.renameMap.size} node name references in connections`);
                }
                for (const { operation, index } of otherOperations) {
                    const error = this.validateOperation(workflowCopy, operation);
                    if (error) {
                        return {
                            success: false,
                            errors: [{
                                    operation: index,
                                    message: error,
                                    details: operation
                                }]
                        };
                    }
                    try {
                        this.applyOperation(workflowCopy, operation);
                    }
                    catch (error) {
                        return {
                            success: false,
                            errors: [{
                                    operation: index,
                                    message: `Failed to apply operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                    details: operation
                                }]
                        };
                    }
                }
                if (this.modifiedNodeIds.size > 0) {
                    workflowCopy.nodes = workflowCopy.nodes.map((node) => {
                        if (this.modifiedNodeIds.has(node.id)) {
                            return (0, node_sanitizer_1.sanitizeNode)(node);
                        }
                        return node;
                    });
                    logger.debug(`Sanitized ${this.modifiedNodeIds.size} modified nodes`);
                }
                if (request.validateOnly) {
                    return {
                        success: true,
                        message: 'Validation successful. Operations are valid but not applied.'
                    };
                }
                const operationsApplied = request.operations.length;
                const shouldActivate = workflowCopy._shouldActivate === true;
                const shouldDeactivate = workflowCopy._shouldDeactivate === true;
                delete workflowCopy._shouldActivate;
                delete workflowCopy._shouldDeactivate;
                return {
                    success: true,
                    workflow: workflowCopy,
                    operationsApplied,
                    message: `Successfully applied ${operationsApplied} operations (${nodeOperations.length} node ops, ${otherOperations.length} other ops)`,
                    warnings: this.warnings.length > 0 ? this.warnings : undefined,
                    shouldActivate: shouldActivate || undefined,
                    shouldDeactivate: shouldDeactivate || undefined,
                    tagsToAdd: this.tagsToAdd.length > 0 ? this.tagsToAdd : undefined,
                    tagsToRemove: this.tagsToRemove.length > 0 ? this.tagsToRemove : undefined,
                    transferToProjectId: this.transferToProjectId || undefined
                };
            }
        }
        catch (error) {
            logger.error('Failed to apply diff', error);
            return {
                success: false,
                errors: [{
                        operation: -1,
                        message: `Diff engine error: ${error instanceof Error ? error.message : 'Unknown error'}`
                    }]
            };
        }
    }
    validateOperation(workflow, operation) {
        switch (operation.type) {
            case 'addNode':
                return this.validateAddNode(workflow, operation);
            case 'removeNode':
                return this.validateRemoveNode(workflow, operation);
            case 'updateNode':
                return this.validateUpdateNode(workflow, operation);
            case 'moveNode':
                return this.validateMoveNode(workflow, operation);
            case 'enableNode':
            case 'disableNode':
                return this.validateToggleNode(workflow, operation);
            case 'addConnection':
                return this.validateAddConnection(workflow, operation);
            case 'removeConnection':
                return this.validateRemoveConnection(workflow, operation);
            case 'rewireConnection':
                return this.validateRewireConnection(workflow, operation);
            case 'updateSettings':
            case 'updateName':
            case 'addTag':
            case 'removeTag':
                return null;
            case 'transferWorkflow':
                return this.validateTransferWorkflow(workflow, operation);
            case 'activateWorkflow':
                return this.validateActivateWorkflow(workflow, operation);
            case 'deactivateWorkflow':
                return this.validateDeactivateWorkflow(workflow, operation);
            case 'cleanStaleConnections':
                return this.validateCleanStaleConnections(workflow, operation);
            case 'replaceConnections':
                return this.validateReplaceConnections(workflow, operation);
            default:
                return `Unknown operation type: ${operation.type}`;
        }
    }
    applyOperation(workflow, operation) {
        switch (operation.type) {
            case 'addNode':
                this.applyAddNode(workflow, operation);
                break;
            case 'removeNode':
                this.applyRemoveNode(workflow, operation);
                break;
            case 'updateNode':
                this.applyUpdateNode(workflow, operation);
                break;
            case 'moveNode':
                this.applyMoveNode(workflow, operation);
                break;
            case 'enableNode':
                this.applyEnableNode(workflow, operation);
                break;
            case 'disableNode':
                this.applyDisableNode(workflow, operation);
                break;
            case 'addConnection':
                this.applyAddConnection(workflow, operation);
                break;
            case 'removeConnection':
                this.applyRemoveConnection(workflow, operation);
                break;
            case 'rewireConnection':
                this.applyRewireConnection(workflow, operation);
                break;
            case 'updateSettings':
                this.applyUpdateSettings(workflow, operation);
                break;
            case 'updateName':
                this.applyUpdateName(workflow, operation);
                break;
            case 'addTag':
                this.applyAddTag(workflow, operation);
                break;
            case 'removeTag':
                this.applyRemoveTag(workflow, operation);
                break;
            case 'activateWorkflow':
                this.applyActivateWorkflow(workflow, operation);
                break;
            case 'deactivateWorkflow':
                this.applyDeactivateWorkflow(workflow, operation);
                break;
            case 'cleanStaleConnections':
                this.applyCleanStaleConnections(workflow, operation);
                break;
            case 'replaceConnections':
                this.applyReplaceConnections(workflow, operation);
                break;
            case 'transferWorkflow':
                this.applyTransferWorkflow(workflow, operation);
                break;
        }
    }
    validateAddNode(workflow, operation) {
        const { node } = operation;
        const normalizedNewName = this.normalizeNodeName(node.name);
        const duplicate = workflow.nodes.find(n => this.normalizeNodeName(n.name) === normalizedNewName);
        if (duplicate) {
            return `Node with name "${node.name}" already exists (normalized name matches existing node "${duplicate.name}")`;
        }
        if (!node.type.includes('.')) {
            return `Invalid node type "${node.type}". Must include package prefix (e.g., "n8n-nodes-base.webhook")`;
        }
        if (node.type.startsWith('nodes-base.')) {
            return `Invalid node type "${node.type}". Use "n8n-nodes-base.${node.type.substring(11)}" instead`;
        }
        return null;
    }
    validateRemoveNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node) {
            return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'removeNode');
        }
        const hasConnections = Object.values(workflow.connections).some(conn => {
            return Object.values(conn).some(outputs => outputs.some(connections => connections.some(c => c.node === node.name)));
        });
        if (hasConnections || workflow.connections[node.name]) {
            logger.warn(`Removing node "${node.name}" will break existing connections`);
        }
        return null;
    }
    validateUpdateNode(workflow, operation) {
        const operationAny = operation;
        if (operationAny.changes && !operation.updates) {
            return `Invalid parameter 'changes'. The updateNode operation requires 'updates' (not 'changes'). Example: {type: "updateNode", nodeId: "abc", updates: {name: "New Name", "parameters.url": "https://example.com"}}`;
        }
        if (!operation.updates) {
            return `Missing required parameter 'updates'. The updateNode operation requires an 'updates' object. Correct structure: {type: "updateNode", nodeId: "abc-123" OR nodeName: "My Node", updates: {name: "New Name", "parameters.url": "https://example.com"}}`;
        }
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node) {
            return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'updateNode');
        }
        if (operation.updates.name && operation.updates.name !== node.name) {
            const normalizedNewName = this.normalizeNodeName(operation.updates.name);
            const normalizedCurrentName = this.normalizeNodeName(node.name);
            if (normalizedNewName !== normalizedCurrentName) {
                const collision = workflow.nodes.find(n => n.id !== node.id && this.normalizeNodeName(n.name) === normalizedNewName);
                if (collision) {
                    return `Cannot rename node "${node.name}" to "${operation.updates.name}": A node with that name already exists (id: ${collision.id.substring(0, 8)}...). Please choose a different name.`;
                }
            }
        }
        for (const [path, value] of Object.entries(operation.updates)) {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)
                && '__patch_find_replace' in value) {
                const patches = value.__patch_find_replace;
                if (!Array.isArray(patches)) {
                    return `Invalid __patch_find_replace at "${path}": must be an array of {find, replace} objects`;
                }
                for (let i = 0; i < patches.length; i++) {
                    const patch = patches[i];
                    if (!patch || typeof patch.find !== 'string' || typeof patch.replace !== 'string') {
                        return `Invalid __patch_find_replace entry at "${path}[${i}]": each entry must have "find" (string) and "replace" (string)`;
                    }
                }
                const currentValue = this.getNestedProperty(node, path);
                if (currentValue === undefined) {
                    return `Cannot apply __patch_find_replace to "${path}": property does not exist on node`;
                }
                if (typeof currentValue !== 'string') {
                    return `Cannot apply __patch_find_replace to "${path}": current value is ${typeof currentValue}, expected string`;
                }
            }
        }
        return null;
    }
    validateMoveNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node) {
            return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', 'moveNode');
        }
        return null;
    }
    validateToggleNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node) {
            const operationType = operation.type === 'enableNode' ? 'enableNode' : 'disableNode';
            return this.formatNodeNotFoundError(workflow, operation.nodeId || operation.nodeName || '', operationType);
        }
        return null;
    }
    validateAddConnection(workflow, operation) {
        const operationAny = operation;
        if (operationAny.sourceNodeId || operationAny.targetNodeId) {
            const wrongParams = [];
            if (operationAny.sourceNodeId)
                wrongParams.push('sourceNodeId');
            if (operationAny.targetNodeId)
                wrongParams.push('targetNodeId');
            return `Invalid parameter(s): ${wrongParams.join(', ')}. Use 'source' and 'target' instead. Example: {type: "addConnection", source: "Node Name", target: "Target Name"}`;
        }
        if (!operation.source) {
            return `Missing required parameter 'source'. The addConnection operation requires both 'source' and 'target' parameters. Check that you're using 'source' (not 'sourceNodeId').`;
        }
        if (!operation.target) {
            return `Missing required parameter 'target'. The addConnection operation requires both 'source' and 'target' parameters. Check that you're using 'target' (not 'targetNodeId').`;
        }
        const sourceNode = this.findNode(workflow, operation.source, operation.source);
        const targetNode = this.findNode(workflow, operation.target, operation.target);
        if (!sourceNode) {
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `Source node not found: "${operation.source}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters (apostrophes, quotes).`;
        }
        if (!targetNode) {
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `Target node not found: "${operation.target}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters (apostrophes, quotes).`;
        }
        const sourceOutput = operation.sourceOutput || 'main';
        const existing = workflow.connections[sourceNode.name]?.[sourceOutput];
        if (existing) {
            const hasConnection = existing.some(connections => connections.some(c => c.node === targetNode.name));
            if (hasConnection) {
                return `Connection already exists from "${sourceNode.name}" to "${targetNode.name}"`;
            }
        }
        return null;
    }
    validateRemoveConnection(workflow, operation) {
        if (operation.ignoreErrors) {
            return null;
        }
        const sourceNode = this.findNode(workflow, operation.source, operation.source);
        const targetNode = this.findNode(workflow, operation.target, operation.target);
        if (!sourceNode) {
            if (this.removedNodeNames.has(operation.source)) {
                return `Source node "${operation.source}" was already removed by a prior removeNode operation. Its connections were automatically cleaned up — no separate removeConnection needed.`;
            }
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `Source node not found: "${operation.source}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
        }
        if (!targetNode) {
            if (this.removedNodeNames.has(operation.target)) {
                return `Target node "${operation.target}" was already removed by a prior removeNode operation. Its connections were automatically cleaned up — no separate removeConnection needed.`;
            }
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `Target node not found: "${operation.target}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
        }
        const sourceOutput = operation.sourceOutput || 'main';
        const connections = workflow.connections[sourceNode.name]?.[sourceOutput];
        if (!connections) {
            return `No connections found from "${sourceNode.name}"`;
        }
        const hasConnection = connections.some(conns => conns.some(c => c.node === targetNode.name));
        if (!hasConnection) {
            return `No connection exists from "${sourceNode.name}" to "${targetNode.name}"`;
        }
        return null;
    }
    validateRewireConnection(workflow, operation) {
        const sourceNode = this.findNode(workflow, operation.source, operation.source);
        if (!sourceNode) {
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `Source node not found: "${operation.source}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
        }
        const fromNode = this.findNode(workflow, operation.from, operation.from);
        if (!fromNode) {
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `"From" node not found: "${operation.from}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
        }
        const toNode = this.findNode(workflow, operation.to, operation.to);
        if (!toNode) {
            const availableNodes = workflow.nodes
                .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
                .join(', ');
            return `"To" node not found: "${operation.to}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters.`;
        }
        const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);
        const connections = workflow.connections[sourceNode.name]?.[sourceOutput];
        if (!connections) {
            return `No connections found from "${sourceNode.name}" on output "${sourceOutput}"`;
        }
        if (!connections[sourceIndex]) {
            return `No connections found from "${sourceNode.name}" on output "${sourceOutput}" at index ${sourceIndex}`;
        }
        const hasConnection = connections[sourceIndex].some(c => c.node === fromNode.name);
        if (!hasConnection) {
            return `No connection exists from "${sourceNode.name}" to "${fromNode.name}" on output "${sourceOutput}" at index ${sourceIndex}"`;
        }
        return null;
    }
    applyAddNode(workflow, operation) {
        const newNode = {
            id: operation.node.id || (0, uuid_1.v4)(),
            name: operation.node.name,
            type: operation.node.type,
            typeVersion: operation.node.typeVersion || 1,
            position: operation.node.position,
            parameters: operation.node.parameters || {},
            credentials: operation.node.credentials,
            disabled: operation.node.disabled,
            notes: operation.node.notes,
            notesInFlow: operation.node.notesInFlow,
            continueOnFail: operation.node.continueOnFail,
            onError: operation.node.onError,
            retryOnFail: operation.node.retryOnFail,
            maxTries: operation.node.maxTries,
            waitBetweenTries: operation.node.waitBetweenTries,
            alwaysOutputData: operation.node.alwaysOutputData,
            executeOnce: operation.node.executeOnce
        };
        const sanitizedNode = (0, node_sanitizer_1.sanitizeNode)(newNode);
        this.modifiedNodeIds.add(sanitizedNode.id);
        workflow.nodes.push(sanitizedNode);
    }
    applyRemoveNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node)
            return;
        this.removedNodeNames.add(node.name);
        const index = workflow.nodes.findIndex(n => n.id === node.id);
        if (index !== -1) {
            workflow.nodes.splice(index, 1);
        }
        delete workflow.connections[node.name];
        for (const [sourceName, sourceConnections] of Object.entries(workflow.connections)) {
            for (const [outputName, outputConns] of Object.entries(sourceConnections)) {
                sourceConnections[outputName] = outputConns.map(connections => connections.filter(conn => conn.node !== node.name));
                const trimmed = sourceConnections[outputName];
                while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0) {
                    trimmed.pop();
                }
                if (trimmed.length === 0) {
                    delete sourceConnections[outputName];
                }
            }
            if (Object.keys(sourceConnections).length === 0) {
                delete workflow.connections[sourceName];
            }
        }
    }
    applyUpdateNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node)
            return;
        this.modifiedNodeIds.add(node.id);
        if (operation.updates.name && operation.updates.name !== node.name) {
            const oldName = node.name;
            const newName = operation.updates.name;
            this.renameMap.set(oldName, newName);
            logger.debug(`Tracking rename: "${oldName}" → "${newName}"`);
        }
        Object.entries(operation.updates).forEach(([path, value]) => {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)
                && '__patch_find_replace' in value) {
                const patches = value.__patch_find_replace;
                let current = this.getNestedProperty(node, path);
                for (const patch of patches) {
                    if (!current.includes(patch.find)) {
                        this.warnings.push({
                            operation: -1,
                            message: `__patch_find_replace: "${patch.find.substring(0, 50)}" not found in "${path}". Skipped.`
                        });
                        continue;
                    }
                    current = current.replace(patch.find, patch.replace);
                }
                this.setNestedProperty(node, path, current);
            }
            else {
                this.setNestedProperty(node, path, value);
            }
        });
        const sanitized = (0, node_sanitizer_1.sanitizeNode)(node);
        Object.assign(node, sanitized);
    }
    applyMoveNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node)
            return;
        node.position = operation.position;
    }
    applyEnableNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node)
            return;
        node.disabled = false;
    }
    applyDisableNode(workflow, operation) {
        const node = this.findNode(workflow, operation.nodeId, operation.nodeName);
        if (!node)
            return;
        node.disabled = true;
    }
    resolveSmartParameters(workflow, operation) {
        const sourceNode = this.findNode(workflow, operation.source, operation.source);
        let sourceOutput = String(operation.sourceOutput ?? 'main');
        let sourceIndex = operation.sourceIndex ?? 0;
        const numericOutput = /^\d+$/.test(sourceOutput) ? parseInt(sourceOutput, 10) : null;
        if (numericOutput !== null
            && (operation.sourceIndex === undefined || operation.sourceIndex === numericOutput)
            && operation.branch === undefined && operation.case === undefined) {
            sourceIndex = numericOutput;
            sourceOutput = 'main';
        }
        if (operation.branch !== undefined && operation.sourceIndex === undefined) {
            if (sourceNode?.type === 'n8n-nodes-base.if') {
                sourceIndex = operation.branch === 'true' ? 0 : 1;
            }
        }
        if (operation.case !== undefined && operation.sourceIndex === undefined) {
            sourceIndex = operation.case;
        }
        if (sourceNode && operation.sourceIndex !== undefined && operation.branch === undefined && operation.case === undefined) {
            if (sourceNode.type === 'n8n-nodes-base.if') {
                this.warnings.push({
                    operation: -1,
                    message: `Connection to If node "${operation.source}" uses sourceIndex=${operation.sourceIndex}. ` +
                        `Consider using branch="true" or branch="false" for better clarity. ` +
                        `If node outputs: main[0]=TRUE branch, main[1]=FALSE branch.`
                });
            }
            else if (sourceNode.type === 'n8n-nodes-base.switch') {
                this.warnings.push({
                    operation: -1,
                    message: `Connection to Switch node "${operation.source}" uses sourceIndex=${operation.sourceIndex}. ` +
                        `Consider using case=N for better clarity (case=0 for first output, case=1 for second, etc.).`
                });
            }
        }
        return { sourceOutput, sourceIndex };
    }
    applyAddConnection(workflow, operation) {
        const sourceNode = this.findNode(workflow, operation.source, operation.source);
        const targetNode = this.findNode(workflow, operation.target, operation.target);
        if (!sourceNode || !targetNode)
            return;
        const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);
        let targetInput = String(operation.targetInput ?? sourceOutput);
        if (/^\d+$/.test(targetInput)) {
            targetInput = 'main';
        }
        const targetIndex = operation.targetIndex ?? 0;
        if (!workflow.connections[sourceNode.name]) {
            workflow.connections[sourceNode.name] = {};
        }
        if (!workflow.connections[sourceNode.name][sourceOutput]) {
            workflow.connections[sourceNode.name][sourceOutput] = [];
        }
        const outputArray = workflow.connections[sourceNode.name][sourceOutput];
        while (outputArray.length <= sourceIndex) {
            outputArray.push([]);
        }
        if (!Array.isArray(outputArray[sourceIndex])) {
            outputArray[sourceIndex] = [];
        }
        outputArray[sourceIndex].push({
            node: targetNode.name,
            type: targetInput,
            index: targetIndex
        });
    }
    applyRemoveConnection(workflow, operation) {
        const sourceNode = this.findNode(workflow, operation.source, operation.source);
        const targetNode = this.findNode(workflow, operation.target, operation.target);
        if (!sourceNode || !targetNode) {
            return;
        }
        const sourceOutput = String(operation.sourceOutput ?? 'main');
        const connections = workflow.connections[sourceNode.name]?.[sourceOutput];
        if (!connections)
            return;
        workflow.connections[sourceNode.name][sourceOutput] = connections.map(conns => conns.filter(conn => conn.node !== targetNode.name));
        const outputConnections = workflow.connections[sourceNode.name][sourceOutput];
        while (outputConnections.length > 0 && outputConnections[outputConnections.length - 1].length === 0) {
            outputConnections.pop();
        }
        if (outputConnections.length === 0) {
            delete workflow.connections[sourceNode.name][sourceOutput];
        }
        if (Object.keys(workflow.connections[sourceNode.name]).length === 0) {
            delete workflow.connections[sourceNode.name];
        }
    }
    applyRewireConnection(workflow, operation) {
        const { sourceOutput, sourceIndex } = this.resolveSmartParameters(workflow, operation);
        this.applyRemoveConnection(workflow, {
            type: 'removeConnection',
            source: operation.source,
            target: operation.from,
            sourceOutput: sourceOutput,
            targetInput: operation.targetInput
        });
        this.applyAddConnection(workflow, {
            type: 'addConnection',
            source: operation.source,
            target: operation.to,
            sourceOutput: sourceOutput,
            targetInput: operation.targetInput,
            sourceIndex: sourceIndex,
            targetIndex: 0
        });
    }
    applyUpdateSettings(workflow, operation) {
        if (operation.settings && Object.keys(operation.settings).length > 0) {
            if (!workflow.settings) {
                workflow.settings = {};
            }
            Object.assign(workflow.settings, operation.settings);
        }
    }
    applyUpdateName(workflow, operation) {
        workflow.name = operation.name;
    }
    applyAddTag(workflow, operation) {
        const removeIdx = this.tagsToRemove.indexOf(operation.tag);
        if (removeIdx !== -1) {
            this.tagsToRemove.splice(removeIdx, 1);
        }
        if (!this.tagsToAdd.includes(operation.tag)) {
            this.tagsToAdd.push(operation.tag);
        }
    }
    applyRemoveTag(workflow, operation) {
        const addIdx = this.tagsToAdd.indexOf(operation.tag);
        if (addIdx !== -1) {
            this.tagsToAdd.splice(addIdx, 1);
        }
        if (!this.tagsToRemove.includes(operation.tag)) {
            this.tagsToRemove.push(operation.tag);
        }
    }
    validateActivateWorkflow(workflow, operation) {
        const activatableTriggers = workflow.nodes.filter(node => !node.disabled && (0, node_type_utils_1.isActivatableTrigger)(node.type));
        if (activatableTriggers.length === 0) {
            return 'Cannot activate workflow: No activatable trigger nodes found. Workflows must have at least one enabled trigger node (webhook, schedule, executeWorkflowTrigger, etc.).';
        }
        return null;
    }
    validateDeactivateWorkflow(workflow, operation) {
        return null;
    }
    applyActivateWorkflow(workflow, operation) {
        workflow._shouldActivate = true;
    }
    applyDeactivateWorkflow(workflow, operation) {
        workflow._shouldDeactivate = true;
    }
    validateTransferWorkflow(_workflow, operation) {
        if (!operation.destinationProjectId) {
            return 'transferWorkflow requires a non-empty destinationProjectId string';
        }
        return null;
    }
    applyTransferWorkflow(_workflow, operation) {
        this.transferToProjectId = operation.destinationProjectId;
    }
    validateCleanStaleConnections(workflow, operation) {
        return null;
    }
    validateReplaceConnections(workflow, operation) {
        const nodeNames = new Set(workflow.nodes.map(n => n.name));
        for (const [sourceName, outputs] of Object.entries(operation.connections)) {
            if (!nodeNames.has(sourceName)) {
                return `Source node not found in connections: ${sourceName}`;
            }
            for (const outputName of Object.keys(outputs)) {
                const connections = outputs[outputName];
                for (const conns of connections) {
                    for (const conn of conns) {
                        if (!nodeNames.has(conn.node)) {
                            return `Target node not found in connections: ${conn.node}`;
                        }
                    }
                }
            }
        }
        return null;
    }
    applyCleanStaleConnections(workflow, operation) {
        const nodeNames = new Set(workflow.nodes.map(n => n.name));
        const staleConnections = [];
        if (operation.dryRun) {
            for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
                if (!nodeNames.has(sourceName)) {
                    for (const [outputName, connections] of Object.entries(outputs)) {
                        for (const conns of connections) {
                            for (const conn of conns) {
                                staleConnections.push({ from: sourceName, to: conn.node });
                            }
                        }
                    }
                }
                else {
                    for (const [outputName, connections] of Object.entries(outputs)) {
                        for (const conns of connections) {
                            for (const conn of conns) {
                                if (!nodeNames.has(conn.node)) {
                                    staleConnections.push({ from: sourceName, to: conn.node });
                                }
                            }
                        }
                    }
                }
            }
            logger.info(`[DryRun] Would remove ${staleConnections.length} stale connections:`, staleConnections);
            return;
        }
        for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
            if (!nodeNames.has(sourceName)) {
                for (const [outputName, connections] of Object.entries(outputs)) {
                    for (const conns of connections) {
                        for (const conn of conns) {
                            staleConnections.push({ from: sourceName, to: conn.node });
                        }
                    }
                }
                delete workflow.connections[sourceName];
                continue;
            }
            for (const [outputName, connections] of Object.entries(outputs)) {
                const filteredConnections = connections.map(conns => conns.filter(conn => {
                    if (!nodeNames.has(conn.node)) {
                        staleConnections.push({ from: sourceName, to: conn.node });
                        return false;
                    }
                    return true;
                }));
                while (filteredConnections.length > 0 && filteredConnections[filteredConnections.length - 1].length === 0) {
                    filteredConnections.pop();
                }
                if (filteredConnections.length === 0) {
                    delete outputs[outputName];
                }
                else {
                    outputs[outputName] = filteredConnections;
                }
            }
            if (Object.keys(outputs).length === 0) {
                delete workflow.connections[sourceName];
            }
        }
        logger.info(`Removed ${staleConnections.length} stale connections`);
    }
    applyReplaceConnections(workflow, operation) {
        workflow.connections = operation.connections;
    }
    updateConnectionReferences(workflow) {
        if (this.renameMap.size === 0)
            return;
        logger.debug(`Updating connection references for ${this.renameMap.size} renamed nodes`);
        const renames = new Map(this.renameMap);
        const updatedConnections = {};
        for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
            const newSourceName = renames.get(sourceName) || sourceName;
            updatedConnections[newSourceName] = outputs;
        }
        for (const [sourceName, outputs] of Object.entries(updatedConnections)) {
            for (const [outputType, connections] of Object.entries(outputs)) {
                for (let outputIndex = 0; outputIndex < connections.length; outputIndex++) {
                    const connectionsAtIndex = connections[outputIndex];
                    for (let connIndex = 0; connIndex < connectionsAtIndex.length; connIndex++) {
                        const connection = connectionsAtIndex[connIndex];
                        if (renames.has(connection.node)) {
                            const oldTargetName = connection.node;
                            const newTargetName = renames.get(connection.node);
                            connection.node = newTargetName;
                            logger.debug(`Updated connection: ${sourceName}[${outputType}][${outputIndex}][${connIndex}].node: "${oldTargetName}" → "${newTargetName}"`);
                        }
                    }
                }
            }
        }
        workflow.connections = updatedConnections;
        logger.info(`Auto-updated ${this.renameMap.size} node name references in connections`);
    }
    normalizeNodeName(name) {
        return name
            .trim()
            .replace(/\\\\/g, '\\')
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\s+/g, ' ');
    }
    findNode(workflow, nodeId, nodeName) {
        if (nodeId) {
            const nodeById = workflow.nodes.find(n => n.id === nodeId);
            if (nodeById)
                return nodeById;
        }
        if (nodeName) {
            const normalizedSearch = this.normalizeNodeName(nodeName);
            const nodeByName = workflow.nodes.find(n => this.normalizeNodeName(n.name) === normalizedSearch);
            if (nodeByName)
                return nodeByName;
        }
        if (nodeId && !nodeName) {
            const normalizedSearch = this.normalizeNodeName(nodeId);
            const nodeByName = workflow.nodes.find(n => this.normalizeNodeName(n.name) === normalizedSearch);
            if (nodeByName)
                return nodeByName;
        }
        return null;
    }
    formatNodeNotFoundError(workflow, nodeIdentifier, operationType) {
        const availableNodes = workflow.nodes
            .map(n => `"${n.name}" (id: ${n.id.substring(0, 8)}...)`)
            .join(', ');
        return `Node not found for ${operationType}: "${nodeIdentifier}". Available nodes: ${availableNodes}. Tip: Use node ID for names with special characters (apostrophes, quotes).`;
    }
    getNestedProperty(obj, path) {
        const keys = path.split('.');
        let current = obj;
        for (const key of keys) {
            if (current == null || typeof current !== 'object')
                return undefined;
            current = current[key];
        }
        return current;
    }
    setNestedProperty(obj, path, value) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
                if (value === null)
                    return;
                current[key] = {};
            }
            current = current[key];
        }
        const finalKey = keys[keys.length - 1];
        if (value === null) {
            delete current[finalKey];
        }
        else {
            current[finalKey] = value;
        }
    }
}
exports.WorkflowDiffEngine = WorkflowDiffEngine;
//# sourceMappingURL=workflow-diff-engine.js.map