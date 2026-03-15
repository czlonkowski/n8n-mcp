"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_TOOL_VALIDATORS = void 0;
exports.validateHTTPRequestTool = validateHTTPRequestTool;
exports.validateCodeTool = validateCodeTool;
exports.validateVectorStoreTool = validateVectorStoreTool;
exports.validateWorkflowTool = validateWorkflowTool;
exports.validateAIAgentTool = validateAIAgentTool;
exports.validateMCPClientTool = validateMCPClientTool;
exports.validateCalculatorTool = validateCalculatorTool;
exports.validateThinkTool = validateThinkTool;
exports.validateSerpApiTool = validateSerpApiTool;
exports.validateWikipediaTool = validateWikipediaTool;
exports.validateSearXngTool = validateSearXngTool;
exports.validateWolframAlphaTool = validateWolframAlphaTool;
exports.isAIToolSubNode = isAIToolSubNode;
exports.validateAIToolSubNode = validateAIToolSubNode;
const node_type_normalizer_1 = require("../utils/node-type-normalizer");
const MIN_DESCRIPTION_LENGTH_SHORT = 10;
const MIN_DESCRIPTION_LENGTH_MEDIUM = 15;
const MIN_DESCRIPTION_LENGTH_LONG = 20;
const MAX_ITERATIONS_WARNING_THRESHOLD = 50;
const MAX_TOPK_WARNING_THRESHOLD = 20;
function getToolDescription(node) {
    return (node.parameters.toolDescription ||
        node.parameters.description ||
        node.parameters.options?.description);
}
function validateHTTPRequestTool(node) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `HTTP Request Tool "${node.name}" has no toolDescription. Add a clear description to help the LLM know when to use this API.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    else if (getToolDescription(node).trim().length < MIN_DESCRIPTION_LENGTH_MEDIUM) {
        issues.push({
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `HTTP Request Tool "${node.name}" toolDescription is too short (minimum ${MIN_DESCRIPTION_LENGTH_MEDIUM} characters). Explain what API this calls and when to use it.`
        });
    }
    if (!node.parameters.url) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `HTTP Request Tool "${node.name}" has no URL. Add the API endpoint URL.`,
            code: 'MISSING_URL'
        });
    }
    else {
        try {
            const urlObj = new URL(node.parameters.url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                issues.push({
                    severity: 'error',
                    nodeId: node.id,
                    nodeName: node.name,
                    message: `HTTP Request Tool "${node.name}" has invalid URL protocol "${urlObj.protocol}". Use http:// or https:// only.`,
                    code: 'INVALID_URL_PROTOCOL'
                });
            }
        }
        catch (e) {
            if (!node.parameters.url.includes('{{')) {
                issues.push({
                    severity: 'warning',
                    nodeId: node.id,
                    nodeName: node.name,
                    message: `HTTP Request Tool "${node.name}" has potentially invalid URL format. Ensure it's a valid URL or n8n expression.`
                });
            }
        }
    }
    if (node.parameters.url || node.parameters.body || node.parameters.headers) {
        const placeholderRegex = /\{([^}]+)\}/g;
        const placeholders = new Set();
        [node.parameters.url, node.parameters.body, JSON.stringify(node.parameters.headers || {})].forEach(text => {
            if (text) {
                let match;
                while ((match = placeholderRegex.exec(text)) !== null) {
                    placeholders.add(match[1]);
                }
            }
        });
        if (placeholders.size > 0) {
            const definitions = node.parameters.placeholderDefinitions?.values || [];
            const definedNames = new Set(definitions.map((d) => d.name));
            if (!node.parameters.placeholderDefinitions) {
                issues.push({
                    severity: 'warning',
                    nodeId: node.id,
                    nodeName: node.name,
                    message: `HTTP Request Tool "${node.name}" uses placeholders but has no placeholderDefinitions. Add definitions to describe the expected inputs.`
                });
            }
            else {
                for (const placeholder of placeholders) {
                    if (!definedNames.has(placeholder)) {
                        issues.push({
                            severity: 'error',
                            nodeId: node.id,
                            nodeName: node.name,
                            message: `HTTP Request Tool "${node.name}" Placeholder "${placeholder}" in URL but it's not defined in placeholderDefinitions.`,
                            code: 'UNDEFINED_PLACEHOLDER'
                        });
                    }
                }
                for (const def of definitions) {
                    if (!placeholders.has(def.name)) {
                        issues.push({
                            severity: 'warning',
                            nodeId: node.id,
                            nodeName: node.name,
                            message: `HTTP Request Tool "${node.name}" defines placeholder "${def.name}" but doesn't use it.`
                        });
                    }
                }
            }
        }
    }
    if (node.parameters.authentication === 'predefinedCredentialType' &&
        (!node.credentials || Object.keys(node.credentials).length === 0)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `HTTP Request Tool "${node.name}" requires credentials but none are configured.`,
            code: 'MISSING_CREDENTIALS'
        });
    }
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (node.parameters.method && !validMethods.includes(node.parameters.method.toUpperCase())) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `HTTP Request Tool "${node.name}" has invalid HTTP method "${node.parameters.method}". Use one of: ${validMethods.join(', ')}.`,
            code: 'INVALID_HTTP_METHOD'
        });
    }
    if (['POST', 'PUT', 'PATCH'].includes(node.parameters.method?.toUpperCase())) {
        if (!node.parameters.body && !node.parameters.jsonBody) {
            issues.push({
                severity: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `HTTP Request Tool "${node.name}" uses ${node.parameters.method} but has no body. Consider adding a body or using GET instead.`
            });
        }
    }
    return issues;
}
function validateCodeTool(node) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Code Tool "${node.name}" has no toolDescription. Add one to help the LLM understand the tool's purpose.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (!node.parameters.jsCode || node.parameters.jsCode.trim().length === 0) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Code Tool "${node.name}" code is empty. Add the JavaScript code to execute.`,
            code: 'MISSING_CODE'
        });
    }
    if (!node.parameters.inputSchema && !node.parameters.specifyInputSchema) {
        issues.push({
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `Code Tool "${node.name}" has no input schema. Consider adding one to validate LLM inputs.`
        });
    }
    return issues;
}
function validateVectorStoreTool(node, reverseConnections, workflow) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Vector Store Tool "${node.name}" has no toolDescription. Add one to explain what data it searches.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (node.parameters.topK !== undefined) {
        if (typeof node.parameters.topK !== 'number' || node.parameters.topK < 1) {
            issues.push({
                severity: 'error',
                nodeId: node.id,
                nodeName: node.name,
                message: `Vector Store Tool "${node.name}" has invalid topK value. Must be a positive number.`,
                code: 'INVALID_TOPK'
            });
        }
        else if (node.parameters.topK > MAX_TOPK_WARNING_THRESHOLD) {
            issues.push({
                severity: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `Vector Store Tool "${node.name}" has topK=${node.parameters.topK}. Large values (>${MAX_TOPK_WARNING_THRESHOLD}) may overwhelm the LLM context. Consider reducing to 10 or less.`
            });
        }
    }
    return issues;
}
function validateWorkflowTool(node, reverseConnections) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Workflow Tool "${node.name}" has no toolDescription. Add one to help the LLM know when to use this tool.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (!node.parameters.workflowId) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Workflow Tool "${node.name}" has no workflowId. Select a workflow to execute.`,
            code: 'MISSING_WORKFLOW_ID'
        });
    }
    return issues;
}
function validateAIAgentTool(node, reverseConnections) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `AI Agent Tool "${node.name}" has no toolDescription. Add one to help the LLM know when to use this tool.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (node.parameters.maxIterations !== undefined) {
        if (typeof node.parameters.maxIterations !== 'number' || node.parameters.maxIterations < 1) {
            issues.push({
                severity: 'error',
                nodeId: node.id,
                nodeName: node.name,
                message: `AI Agent Tool "${node.name}" has invalid maxIterations. Must be a positive number.`,
                code: 'INVALID_MAX_ITERATIONS'
            });
        }
        else if (node.parameters.maxIterations > MAX_ITERATIONS_WARNING_THRESHOLD) {
            issues.push({
                severity: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `AI Agent Tool "${node.name}" has maxIterations=${node.parameters.maxIterations}. Large values (>${MAX_ITERATIONS_WARNING_THRESHOLD}) may lead to long execution times.`
            });
        }
    }
    return issues;
}
function validateMCPClientTool(node) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `MCP Client Tool "${node.name}" has no toolDescription. Add one to help the LLM know when to use this tool.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (!node.parameters.serverUrl) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `MCP Client Tool "${node.name}" has no serverUrl. Configure the MCP server URL.`,
            code: 'MISSING_SERVER_URL'
        });
    }
    return issues;
}
function validateCalculatorTool(_node) {
    return [];
}
function validateThinkTool(_node) {
    return [];
}
function validateSerpApiTool(node) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `SerpApi Tool "${node.name}" has no toolDescription. Add one to explain when to use Google search.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (!node.credentials || !node.credentials.serpApiApi) {
        issues.push({
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `SerpApi Tool "${node.name}" requires SerpApi credentials. Configure your API key.`
        });
    }
    return issues;
}
function validateWikipediaTool(node) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `Wikipedia Tool "${node.name}" has no toolDescription. Add one to explain when to use Wikipedia.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (node.parameters.language) {
        const validLanguageCodes = /^[a-z]{2,3}$/;
        if (!validLanguageCodes.test(node.parameters.language)) {
            issues.push({
                severity: 'warning',
                nodeId: node.id,
                nodeName: node.name,
                message: `Wikipedia Tool "${node.name}" has potentially invalid language code "${node.parameters.language}". Use ISO 639 codes (e.g., "en", "es", "fr").`
            });
        }
    }
    return issues;
}
function validateSearXngTool(node) {
    const issues = [];
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `SearXNG Tool "${node.name}" has no toolDescription. Add one to explain when to use SearXNG.`,
            code: 'MISSING_TOOL_DESCRIPTION'
        });
    }
    if (!node.parameters.baseUrl) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `SearXNG Tool "${node.name}" has no baseUrl. Configure your SearXNG instance URL.`,
            code: 'MISSING_BASE_URL'
        });
    }
    return issues;
}
function validateWolframAlphaTool(node) {
    const issues = [];
    if (!node.credentials || (!node.credentials.wolframAlpha && !node.credentials.wolframAlphaApi)) {
        issues.push({
            severity: 'error',
            nodeId: node.id,
            nodeName: node.name,
            message: `WolframAlpha Tool "${node.name}" requires Wolfram|Alpha API credentials. Configure your App ID.`,
            code: 'MISSING_CREDENTIALS'
        });
    }
    if (!getToolDescription(node)) {
        issues.push({
            severity: 'info',
            nodeId: node.id,
            nodeName: node.name,
            message: `WolframAlpha Tool "${node.name}" has no custom description. Add one to explain when to use Wolfram|Alpha for computational queries.`
        });
    }
    return issues;
}
exports.AI_TOOL_VALIDATORS = {
    'nodes-langchain.toolHttpRequest': validateHTTPRequestTool,
    'nodes-langchain.toolCode': validateCodeTool,
    'nodes-langchain.toolVectorStore': validateVectorStoreTool,
    'nodes-langchain.toolWorkflow': validateWorkflowTool,
    'nodes-langchain.agentTool': validateAIAgentTool,
    'nodes-langchain.mcpClientTool': validateMCPClientTool,
    'nodes-langchain.toolCalculator': validateCalculatorTool,
    'nodes-langchain.toolThink': validateThinkTool,
    'nodes-langchain.toolSerpApi': validateSerpApiTool,
    'nodes-langchain.toolWikipedia': validateWikipediaTool,
    'nodes-langchain.toolSearXng': validateSearXngTool,
    'nodes-langchain.toolWolframAlpha': validateWolframAlphaTool,
};
function isAIToolSubNode(nodeType) {
    const normalized = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
    return normalized in exports.AI_TOOL_VALIDATORS;
}
function validateAIToolSubNode(node, nodeType, reverseConnections, workflow) {
    const normalized = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
    switch (normalized) {
        case 'nodes-langchain.toolHttpRequest':
            return validateHTTPRequestTool(node);
        case 'nodes-langchain.toolCode':
            return validateCodeTool(node);
        case 'nodes-langchain.toolVectorStore':
            return validateVectorStoreTool(node, reverseConnections, workflow);
        case 'nodes-langchain.toolWorkflow':
            return validateWorkflowTool(node);
        case 'nodes-langchain.agentTool':
            return validateAIAgentTool(node, reverseConnections);
        case 'nodes-langchain.mcpClientTool':
            return validateMCPClientTool(node);
        case 'nodes-langchain.toolCalculator':
            return validateCalculatorTool(node);
        case 'nodes-langchain.toolThink':
            return validateThinkTool(node);
        case 'nodes-langchain.toolSerpApi':
            return validateSerpApiTool(node);
        case 'nodes-langchain.toolWikipedia':
            return validateWikipediaTool(node);
        case 'nodes-langchain.toolSearXng':
            return validateSearXngTool(node);
        case 'nodes-langchain.toolWolframAlpha':
            return validateWolframAlphaTool(node);
        default:
            return [];
    }
}
//# sourceMappingURL=ai-tool-validators.js.map