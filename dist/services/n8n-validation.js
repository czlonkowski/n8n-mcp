"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultWorkflowSettings = exports.workflowSettingsSchema = exports.workflowConnectionSchema = exports.workflowNodeSchema = void 0;
exports.validateWorkflowNode = validateWorkflowNode;
exports.validateWorkflowConnections = validateWorkflowConnections;
exports.validateWorkflowSettings = validateWorkflowSettings;
exports.cleanWorkflowForCreate = cleanWorkflowForCreate;
exports.cleanWorkflowForUpdate = cleanWorkflowForUpdate;
exports.validateWorkflowStructure = validateWorkflowStructure;
exports.hasWebhookTrigger = hasWebhookTrigger;
exports.validateFilterBasedNodeMetadata = validateFilterBasedNodeMetadata;
exports.validateOperatorStructure = validateOperatorStructure;
exports.getWebhookUrl = getWebhookUrl;
exports.getWorkflowStructureExample = getWorkflowStructureExample;
exports.getWorkflowFixSuggestions = getWorkflowFixSuggestions;
const zod_1 = require("zod");
const node_type_utils_1 = require("../utils/node-type-utils");
const node_classification_1 = require("../utils/node-classification");
exports.workflowNodeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    type: zod_1.z.string(),
    typeVersion: zod_1.z.number(),
    position: zod_1.z.tuple([zod_1.z.number(), zod_1.z.number()]),
    parameters: zod_1.z.record(zod_1.z.unknown()),
    credentials: zod_1.z.record(zod_1.z.unknown()).optional(),
    disabled: zod_1.z.boolean().optional(),
    notes: zod_1.z.string().optional(),
    notesInFlow: zod_1.z.boolean().optional(),
    continueOnFail: zod_1.z.boolean().optional(),
    retryOnFail: zod_1.z.boolean().optional(),
    maxTries: zod_1.z.number().optional(),
    waitBetweenTries: zod_1.z.number().optional(),
    alwaysOutputData: zod_1.z.boolean().optional(),
    executeOnce: zod_1.z.boolean().optional(),
});
const connectionArraySchema = zod_1.z.array(zod_1.z.array(zod_1.z.object({
    node: zod_1.z.string(),
    type: zod_1.z.string(),
    index: zod_1.z.number(),
})));
exports.workflowConnectionSchema = zod_1.z.record(zod_1.z.object({
    main: connectionArraySchema.optional(),
    error: connectionArraySchema.optional(),
    ai_tool: connectionArraySchema.optional(),
    ai_languageModel: connectionArraySchema.optional(),
    ai_memory: connectionArraySchema.optional(),
    ai_embedding: connectionArraySchema.optional(),
    ai_vectorStore: connectionArraySchema.optional(),
}).catchall(connectionArraySchema));
exports.workflowSettingsSchema = zod_1.z.object({
    executionOrder: zod_1.z.enum(['v0', 'v1']).default('v1'),
    timezone: zod_1.z.string().optional(),
    saveDataErrorExecution: zod_1.z.enum(['all', 'none']).default('all'),
    saveDataSuccessExecution: zod_1.z.enum(['all', 'none']).default('all'),
    saveManualExecutions: zod_1.z.boolean().default(true),
    saveExecutionProgress: zod_1.z.boolean().default(true),
    executionTimeout: zod_1.z.number().optional(),
    errorWorkflow: zod_1.z.string().optional(),
    callerPolicy: zod_1.z.enum(['any', 'workflowsFromSameOwner', 'workflowsFromAList']).optional(),
    availableInMCP: zod_1.z.boolean().optional(),
});
exports.defaultWorkflowSettings = {
    executionOrder: 'v1',
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
};
function validateWorkflowNode(node) {
    return exports.workflowNodeSchema.parse(node);
}
function validateWorkflowConnections(connections) {
    return exports.workflowConnectionSchema.parse(connections);
}
function validateWorkflowSettings(settings) {
    return exports.workflowSettingsSchema.parse(settings);
}
function cleanWorkflowForCreate(workflow) {
    const { id, createdAt, updatedAt, versionId, meta, active, tags, ...cleanedWorkflow } = workflow;
    if (!cleanedWorkflow.settings || Object.keys(cleanedWorkflow.settings).length === 0) {
        cleanedWorkflow.settings = exports.defaultWorkflowSettings;
    }
    return cleanedWorkflow;
}
function cleanWorkflowForUpdate(workflow) {
    const { id, createdAt, updatedAt, versionId, versionCounter, meta, staticData, pinData, tags, description, isArchived, usedCredentials, sharedWithProjects, triggerCount, shared, active, activeVersionId, activeVersion, ...cleanedWorkflow } = workflow;
    const ALL_KNOWN_SETTINGS_PROPERTIES = new Set([
        'saveExecutionProgress',
        'saveManualExecutions',
        'saveDataErrorExecution',
        'saveDataSuccessExecution',
        'executionTimeout',
        'errorWorkflow',
        'timezone',
        'executionOrder',
        'callerPolicy',
        'callerIds',
        'timeSavedPerExecution',
        'availableInMCP',
    ]);
    if (cleanedWorkflow.settings && typeof cleanedWorkflow.settings === 'object') {
        const filteredSettings = {};
        for (const [key, value] of Object.entries(cleanedWorkflow.settings)) {
            if (ALL_KNOWN_SETTINGS_PROPERTIES.has(key)) {
                filteredSettings[key] = value;
            }
        }
        if (Object.keys(filteredSettings).length > 0) {
            cleanedWorkflow.settings = filteredSettings;
        }
        else {
            cleanedWorkflow.settings = { executionOrder: 'v1' };
        }
    }
    else {
        cleanedWorkflow.settings = { executionOrder: 'v1' };
    }
    return cleanedWorkflow;
}
function validateWorkflowStructure(workflow) {
    const errors = [];
    if (!workflow.name) {
        errors.push('Workflow name is required');
    }
    if (!workflow.nodes || workflow.nodes.length === 0) {
        errors.push('Workflow must have at least one node');
    }
    if (workflow.nodes && workflow.nodes.length > 0) {
        const hasExecutableNodes = workflow.nodes.some(node => !(0, node_classification_1.isNonExecutableNode)(node.type));
        if (!hasExecutableNodes) {
            errors.push('Workflow must have at least one executable node. Sticky notes alone cannot form a valid workflow.');
        }
    }
    if (!workflow.connections) {
        errors.push('Workflow connections are required');
    }
    if (workflow.nodes && workflow.nodes.length === 1) {
        const singleNode = workflow.nodes[0];
        const isWebhookOnly = singleNode.type === 'n8n-nodes-base.webhook' ||
            singleNode.type === 'n8n-nodes-base.webhookTrigger';
        if (!isWebhookOnly) {
            errors.push(`Single non-webhook node workflow is invalid. Current node: "${singleNode.name}" (${singleNode.type}). Add another node using: {type: 'addNode', node: {name: 'Process Data', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [450, 300], parameters: {}}}`);
        }
    }
    if (workflow.nodes && workflow.nodes.length > 1 && workflow.connections) {
        const executableNodes = workflow.nodes.filter(node => !(0, node_classification_1.isNonExecutableNode)(node.type));
        const connectionCount = Object.keys(workflow.connections).length;
        if (connectionCount === 0 && executableNodes.length > 1) {
            const nodeNames = executableNodes.slice(0, 2).map(n => n.name);
            errors.push(`Multi-node workflow has no connections between nodes. Add a connection using: {type: 'addConnection', source: '${nodeNames[0]}', target: '${nodeNames[1]}', sourcePort: 'main', targetPort: 'main'}`);
        }
        else if (connectionCount > 0 || executableNodes.length > 1) {
            const connectedNodes = new Set();
            Object.entries(workflow.connections).forEach(([sourceName, connection]) => {
                connectedNodes.add(sourceName);
                const connectionRecord = connection;
                Object.values(connectionRecord).forEach((connData) => {
                    if (connData && Array.isArray(connData)) {
                        connData.forEach((outputs) => {
                            if (Array.isArray(outputs)) {
                                outputs.forEach((target) => {
                                    if (target?.node) {
                                        connectedNodes.add(target.node);
                                    }
                                });
                            }
                        });
                    }
                });
            });
            const disconnectedNodes = workflow.nodes.filter(node => {
                if ((0, node_classification_1.isNonExecutableNode)(node.type)) {
                    return false;
                }
                const isConnected = connectedNodes.has(node.name);
                const isNodeTrigger = (0, node_type_utils_1.isTriggerNode)(node.type);
                if (isNodeTrigger) {
                    const hasOutgoingConnections = !!workflow.connections?.[node.name];
                    const hasInboundConnections = isConnected;
                    return !hasOutgoingConnections && !hasInboundConnections;
                }
                return !isConnected;
            });
            if (disconnectedNodes.length > 0) {
                const disconnectedList = disconnectedNodes.map(n => `"${n.name}" (${n.type})`).join(', ');
                const firstDisconnected = disconnectedNodes[0];
                const suggestedSource = workflow.nodes.find(n => connectedNodes.has(n.name))?.name || workflow.nodes[0].name;
                errors.push(`Disconnected nodes detected: ${disconnectedList}. Each node must have at least one connection. Add a connection: {type: 'addConnection', source: '${suggestedSource}', target: '${firstDisconnected.name}', sourcePort: 'main', targetPort: 'main'}`);
            }
        }
    }
    if (workflow.nodes) {
        workflow.nodes.forEach((node, index) => {
            try {
                validateWorkflowNode(node);
                if (node.type.startsWith('nodes-base.')) {
                    errors.push(`Invalid node type "${node.type}" at index ${index}. Use "n8n-nodes-base.${node.type.substring(11)}" instead.`);
                }
                else if (!node.type.includes('.')) {
                    errors.push(`Invalid node type "${node.type}" at index ${index}. Node types must include package prefix (e.g., "n8n-nodes-base.webhook").`);
                }
            }
            catch (error) {
                errors.push(`Invalid node at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    if (workflow.nodes) {
        workflow.nodes.forEach((node, index) => {
            const filterErrors = validateFilterBasedNodeMetadata(node);
            if (filterErrors.length > 0) {
                errors.push(...filterErrors.map(err => `Node "${node.name}" (index ${index}): ${err}`));
            }
        });
    }
    if (workflow.connections) {
        try {
            validateWorkflowConnections(workflow.connections);
        }
        catch (error) {
            errors.push(`Invalid connections: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    if (workflow.active === true && workflow.nodes && workflow.nodes.length > 0) {
        const activatableTriggers = workflow.nodes.filter(node => !node.disabled && (0, node_type_utils_1.isActivatableTrigger)(node.type));
        if (activatableTriggers.length === 0) {
            errors.push('Cannot activate workflow: No activatable trigger nodes found. ' +
                'Workflows must have at least one enabled trigger node (webhook, schedule, executeWorkflowTrigger, etc.).');
        }
    }
    if (workflow.nodes && workflow.connections) {
        const switchNodes = workflow.nodes.filter(n => {
            if (n.type !== 'n8n-nodes-base.switch')
                return false;
            const mode = n.parameters?.mode;
            return !mode || mode === 'rules';
        });
        for (const switchNode of switchNodes) {
            const params = switchNode.parameters;
            const rules = params?.rules?.rules || [];
            const nodeConnections = workflow.connections[switchNode.name];
            if (rules.length > 0 && nodeConnections?.main) {
                const outputBranches = nodeConnections.main.length;
                if (outputBranches !== rules.length) {
                    const ruleNames = rules.map((r, i) => r.outputKey ? `"${r.outputKey}" (index ${i})` : `Rule ${i}`).join(', ');
                    errors.push(`Switch node "${switchNode.name}" has ${rules.length} rules [${ruleNames}] ` +
                        `but only ${outputBranches} output branch${outputBranches !== 1 ? 'es' : ''} in connections. ` +
                        `Each rule needs its own output branch. When connecting to Switch outputs, specify sourceIndex: ` +
                        rules.map((_, i) => i).join(', ') +
                        ` (or use case parameter for clarity).`);
                }
                const nonEmptyBranches = nodeConnections.main.filter((branch) => branch.length > 0).length;
                if (nonEmptyBranches < rules.length) {
                    const emptyIndices = nodeConnections.main
                        .map((branch, i) => branch.length === 0 ? i : -1)
                        .filter((i) => i !== -1 && i < rules.length);
                    if (emptyIndices.length > 0) {
                        const ruleInfo = emptyIndices.map((i) => {
                            const rule = rules[i];
                            return rule.outputKey ? `"${rule.outputKey}" (index ${i})` : `Rule ${i}`;
                        }).join(', ');
                        errors.push(`Switch node "${switchNode.name}" has unconnected output${emptyIndices.length !== 1 ? 's' : ''}: ${ruleInfo}. ` +
                            `Add connection${emptyIndices.length !== 1 ? 's' : ''} using sourceIndex: ${emptyIndices.join(' or ')}.`);
                    }
                }
            }
        }
    }
    if (workflow.nodes && workflow.connections) {
        const nodeNames = new Set(workflow.nodes.map(node => node.name));
        const nodeIds = new Set(workflow.nodes.map(node => node.id));
        const nodeIdToName = new Map(workflow.nodes.map(node => [node.id, node.name]));
        Object.entries(workflow.connections).forEach(([sourceName, connection]) => {
            if (!nodeNames.has(sourceName)) {
                if (nodeIds.has(sourceName)) {
                    const correctName = nodeIdToName.get(sourceName);
                    errors.push(`Connection uses node ID '${sourceName}' but must use node name '${correctName}'. Change connections.${sourceName} to connections['${correctName}']`);
                }
                else {
                    errors.push(`Connection references non-existent node: ${sourceName}`);
                }
            }
            const connectionRecord = connection;
            Object.values(connectionRecord).forEach((connData) => {
                if (connData && Array.isArray(connData)) {
                    connData.forEach((outputs, outputIndex) => {
                        if (Array.isArray(outputs)) {
                            outputs.forEach((target, targetIndex) => {
                                if (!target?.node)
                                    return;
                                if (!nodeNames.has(target.node)) {
                                    if (nodeIds.has(target.node)) {
                                        const correctName = nodeIdToName.get(target.node);
                                        errors.push(`Connection target uses node ID '${target.node}' but must use node name '${correctName}' (from ${sourceName}[${outputIndex}][${targetIndex}])`);
                                    }
                                    else {
                                        errors.push(`Connection references non-existent target node: ${target.node} (from ${sourceName}[${outputIndex}][${targetIndex}])`);
                                    }
                                }
                            });
                        }
                    });
                }
            });
        });
    }
    return errors;
}
function hasWebhookTrigger(workflow) {
    return workflow.nodes.some(node => node.type === 'n8n-nodes-base.webhook' ||
        node.type === 'n8n-nodes-base.webhookTrigger');
}
function validateFilterBasedNodeMetadata(node) {
    const errors = [];
    const isIFNode = node.type === 'n8n-nodes-base.if' && node.typeVersion >= 2.2;
    const isSwitchNode = node.type === 'n8n-nodes-base.switch' && node.typeVersion >= 3.2;
    if (!isIFNode && !isSwitchNode) {
        return errors;
    }
    if (isIFNode) {
        const conditions = node.parameters.conditions;
        if (!conditions?.options) {
            errors.push('Missing required "conditions.options". ' +
                'IF v2.2+ requires: {version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict"}');
        }
        else {
            const requiredFields = {
                version: 2,
                leftValue: '',
                caseSensitive: 'boolean',
                typeValidation: 'strict'
            };
            for (const [field, expectedValue] of Object.entries(requiredFields)) {
                if (!(field in conditions.options)) {
                    errors.push(`Missing required field "conditions.options.${field}". ` +
                        `Expected value: ${typeof expectedValue === 'string' ? `"${expectedValue}"` : expectedValue}`);
                }
            }
        }
        if (conditions?.conditions && Array.isArray(conditions.conditions)) {
            conditions.conditions.forEach((condition, i) => {
                const operatorErrors = validateOperatorStructure(condition.operator, `conditions.conditions[${i}].operator`);
                errors.push(...operatorErrors);
            });
        }
    }
    if (isSwitchNode) {
        const rules = node.parameters.rules;
        if (rules?.rules && Array.isArray(rules.rules)) {
            rules.rules.forEach((rule, ruleIndex) => {
                if (!rule.conditions?.options) {
                    errors.push(`Missing required "rules.rules[${ruleIndex}].conditions.options". ` +
                        'Switch v3.2+ requires: {version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict"}');
                }
                else {
                    const requiredFields = {
                        version: 2,
                        leftValue: '',
                        caseSensitive: 'boolean',
                        typeValidation: 'strict'
                    };
                    for (const [field, expectedValue] of Object.entries(requiredFields)) {
                        if (!(field in rule.conditions.options)) {
                            errors.push(`Missing required field "rules.rules[${ruleIndex}].conditions.options.${field}". ` +
                                `Expected value: ${typeof expectedValue === 'string' ? `"${expectedValue}"` : expectedValue}`);
                        }
                    }
                }
                if (rule.conditions?.conditions && Array.isArray(rule.conditions.conditions)) {
                    rule.conditions.conditions.forEach((condition, condIndex) => {
                        const operatorErrors = validateOperatorStructure(condition.operator, `rules.rules[${ruleIndex}].conditions.conditions[${condIndex}].operator`);
                        errors.push(...operatorErrors);
                    });
                }
            });
        }
    }
    return errors;
}
function validateOperatorStructure(operator, path) {
    const errors = [];
    if (!operator || typeof operator !== 'object') {
        errors.push(`${path}: operator is missing or not an object`);
        return errors;
    }
    if (!operator.type) {
        errors.push(`${path}: missing required field "type". ` +
            'Must be a data type: "string", "number", "boolean", "dateTime", "array", or "object"');
    }
    else {
        const validTypes = ['string', 'number', 'boolean', 'dateTime', 'array', 'object'];
        if (!validTypes.includes(operator.type)) {
            errors.push(`${path}: invalid type "${operator.type}". ` +
                `Type must be a data type (${validTypes.join(', ')}), not an operation name. ` +
                'Did you mean to use the "operation" field?');
        }
    }
    if (!operator.operation) {
        errors.push(`${path}: missing required field "operation". ` +
            'Operation specifies the comparison type (e.g., "equals", "contains", "isNotEmpty")');
    }
    if (operator.operation) {
        const unaryOperators = ['isEmpty', 'isNotEmpty', 'true', 'false', 'isNumeric'];
        const isUnary = unaryOperators.includes(operator.operation);
        if (isUnary) {
            if (operator.singleValue !== true) {
                errors.push(`${path}: unary operator "${operator.operation}" requires "singleValue: true". ` +
                    'Unary operators do not use rightValue.');
            }
        }
        else {
            if (operator.singleValue === true) {
                errors.push(`${path}: binary operator "${operator.operation}" should not have "singleValue: true". ` +
                    'Only unary operators (isEmpty, isNotEmpty, true, false, isNumeric) need this property.');
            }
        }
    }
    return errors;
}
function getWebhookUrl(workflow) {
    const webhookNode = workflow.nodes.find(node => node.type === 'n8n-nodes-base.webhook' ||
        node.type === 'n8n-nodes-base.webhookTrigger');
    if (!webhookNode || !webhookNode.parameters) {
        return null;
    }
    const path = webhookNode.parameters.path;
    if (!path) {
        return null;
    }
    return path;
}
function getWorkflowStructureExample() {
    return `
Minimal Workflow Example:
{
  "name": "My Workflow",
  "nodes": [
    {
      "id": "manual-trigger-1",
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [250, 300],
      "parameters": {}
    },
    {
      "id": "set-1",
      "name": "Set Data",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [450, 300],
      "parameters": {
        "mode": "manual",
        "assignments": {
          "assignments": [{
            "id": "1",
            "name": "message",
            "value": "Hello World",
            "type": "string"
          }]
        }
      }
    }
  ],
  "connections": {
    "Manual Trigger": {
      "main": [[{
        "node": "Set Data",
        "type": "main",
        "index": 0
      }]]
    }
  }
}

IMPORTANT: In connections, use the node NAME (e.g., "Manual Trigger"), NOT the node ID or type!`;
}
function getWorkflowFixSuggestions(errors) {
    const suggestions = [];
    if (errors.some(e => e.includes('empty connections'))) {
        suggestions.push('Add connections between your nodes. Each node (except endpoints) should connect to another node.');
        suggestions.push('Connection format: connections: { "Source Node Name": { "main": [[{ "node": "Target Node Name", "type": "main", "index": 0 }]] } }');
    }
    if (errors.some(e => e.includes('Single-node workflows'))) {
        suggestions.push('Add at least one more node to process data. Common patterns: Trigger → Process → Output');
        suggestions.push('Examples: Manual Trigger → Set, Webhook → HTTP Request, Schedule Trigger → Database Query');
    }
    if (errors.some(e => e.includes('node ID') && e.includes('instead of node name'))) {
        suggestions.push('Replace node IDs with node names in connections. The name is what appears in the node header.');
        suggestions.push('Wrong: connections: { "set-1": {...} }, Right: connections: { "Set Data": {...} }');
    }
    return suggestions;
}
//# sourceMappingURL=n8n-validation.js.map