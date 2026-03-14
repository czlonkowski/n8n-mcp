/**
 * AI Tool Sub-Node Validators
 *
 * Implements validation logic for all 13 AI tool sub-nodes from
 * docs/FINAL_AI_VALIDATION_SPEC.md
 *
 * Each validator checks configuration requirements, connections, and
 * parameters specific to that tool type.
 */

import { NodeTypeNormalizer } from '../utils/node-type-normalizer';

// Validation constants
const MIN_DESCRIPTION_LENGTH_SHORT = 10;
const MIN_DESCRIPTION_LENGTH_MEDIUM = 15;
const MIN_DESCRIPTION_LENGTH_LONG = 20;
const MAX_ITERATIONS_WARNING_THRESHOLD = 50;
const MAX_TOPK_WARNING_THRESHOLD = 20;

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  position: [number, number];
  parameters: any;
  credentials?: any;
  disabled?: boolean;
  typeVersion?: number;
}

/**
 * Get tool description from node, checking all possible property locations.
 * Different n8n tool types store descriptions in different places:
 * - toolDescription: HTTP Request Tool, Vector Store Tool
 * - description: Workflow Tool, Code Tool, AI Agent Tool
 * - options.description: SerpApi, Wikipedia, SearXNG
 */
function getToolDescription(node: WorkflowNode): string | undefined {
  return (
    node.parameters.toolDescription ||
    node.parameters.description ||
    node.parameters.options?.description
  );
}

export interface WorkflowJson {
  name?: string;
  nodes: WorkflowNode[];
  connections: Record<string, any>;
  settings?: any;
}

export interface ReverseConnection {
  sourceName: string;
  sourceType: string;
  type: string;  // main, ai_tool, ai_languageModel, etc.
  index: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  nodeId?: string;
  nodeName?: string;
  message: string;
  code?: string;
}

/**
 * 1. HTTP Request Tool Validator
 * From spec lines 883-1123
 */
export function validateHTTPRequestTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `HTTP Request Tool "${node.name}" has no toolDescription. Add a clear description to help the LLM know when to use this API.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  } else if (getToolDescription(node)!.trim().length < MIN_DESCRIPTION_LENGTH_MEDIUM) {
    issues.push({
      severity: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      message: `HTTP Request Tool "${node.name}" toolDescription is too short (minimum ${MIN_DESCRIPTION_LENGTH_MEDIUM} characters). Explain what API this calls and when to use it.`
    });
  }

  // 2. Check URL (REQUIRED)
  if (!node.parameters.url) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `HTTP Request Tool "${node.name}" has no URL. Add the API endpoint URL.`,
      code: 'MISSING_URL'
    });
  } else {
    // Validate URL protocol (must be http or https)
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
    } catch (e) {
      // URL parsing failed - invalid format
      // Only warn if it's not an n8n expression
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

  // 3. Validate placeholders match definitions
  if (node.parameters.url || node.parameters.body || node.parameters.headers) {
    const placeholderRegex = /\{([^}]+)\}/g;
    const placeholders = new Set<string>();

    // Extract placeholders from URL, body, headers
    [node.parameters.url, node.parameters.body, JSON.stringify(node.parameters.headers || {})].forEach(text => {
      if (text) {
        let match;
        while ((match = placeholderRegex.exec(text)) !== null) {
          placeholders.add(match[1]);
        }
      }
    });

    // If placeholders exist in URL/body/headers
    if (placeholders.size > 0) {
      const definitions = node.parameters.placeholderDefinitions?.values || [];
      const definedNames = new Set(definitions.map((d: any) => d.name));

      // If no placeholderDefinitions at all, warn
      if (!node.parameters.placeholderDefinitions) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: `HTTP Request Tool "${node.name}" uses placeholders but has no placeholderDefinitions. Add definitions to describe the expected inputs.`
        });
      } else {
        // Has placeholderDefinitions, check each placeholder
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

        // Check for defined but unused placeholders
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

  // 4. Validate authentication
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

  // 5. Validate HTTP method
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

  // 6. Validate body for POST/PUT/PATCH
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

/**
 * 2. Code Tool Validator
 * From spec lines 1125-1393
 */
export function validateCodeTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED) - check all possible locations
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Code Tool "${node.name}" has no toolDescription. Add one to help the LLM understand the tool's purpose.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Check jsCode exists (REQUIRED)
  if (!node.parameters.jsCode || node.parameters.jsCode.trim().length === 0) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Code Tool "${node.name}" code is empty. Add the JavaScript code to execute.`,
      code: 'MISSING_CODE'
    });
  }

  // 3. Recommend input/output schema
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

/**
 * 3. Vector Store Tool Validator
 * From spec lines 1395-1620
 */
export function validateVectorStoreTool(
  node: WorkflowNode,
  reverseConnections: Map<string, ReverseConnection[]>,
  workflow: WorkflowJson
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Vector Store Tool "${node.name}" has no toolDescription. Add one to explain what data it searches.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Validate topK parameter if specified
  if (node.parameters.topK !== undefined) {
    if (typeof node.parameters.topK !== 'number' || node.parameters.topK < 1) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `Vector Store Tool "${node.name}" has invalid topK value. Must be a positive number.`,
        code: 'INVALID_TOPK'
      });
    } else if (node.parameters.topK > MAX_TOPK_WARNING_THRESHOLD) {
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

/**
 * 4. Workflow Tool Validator
 * From spec lines 1622-1831 (already complete in spec)
 */
export function validateWorkflowTool(node: WorkflowNode, reverseConnections?: Map<string, ReverseConnection[]>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Workflow Tool "${node.name}" has no toolDescription. Add one to help the LLM know when to use this tool.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Check workflowId (REQUIRED)
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

/**
 * 5. AI Agent Tool Validator
 * From spec lines 1882-2122
 */
export function validateAIAgentTool(
  node: WorkflowNode,
  reverseConnections: Map<string, ReverseConnection[]>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent Tool "${node.name}" has no toolDescription. Add one to help the LLM know when to use this tool.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Validate maxIterations if specified
  if (node.parameters.maxIterations !== undefined) {
    if (typeof node.parameters.maxIterations !== 'number' || node.parameters.maxIterations < 1) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent Tool "${node.name}" has invalid maxIterations. Must be a positive number.`,
        code: 'INVALID_MAX_ITERATIONS'
      });
    } else if (node.parameters.maxIterations > MAX_ITERATIONS_WARNING_THRESHOLD) {
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

/**
 * 6. MCP Client Tool Validator
 * From spec lines 2124-2534 (already complete in spec)
 */
export function validateMCPClientTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `MCP Client Tool "${node.name}" has no toolDescription. Add one to help the LLM know when to use this tool.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Check serverUrl (REQUIRED)
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

/**
 * 7-8. Simple Tools (Calculator, Think) Validators
 * From spec lines 1868-2009
 */
export function validateCalculatorTool(_node: WorkflowNode): ValidationIssue[] {
  // Calculator Tool has a built-in description - no validation needed
  return [];
}

export function validateThinkTool(_node: WorkflowNode): ValidationIssue[] {
  // Think Tool has a built-in description - no validation needed
  return [];
}

/**
 * 9-12. Search Tools Validators
 * From spec lines 1833-2139
 */
export function validateSerpApiTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `SerpApi Tool "${node.name}" has no toolDescription. Add one to explain when to use Google search.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Check credentials (RECOMMENDED)
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

export function validateWikipediaTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Wikipedia Tool "${node.name}" has no toolDescription. Add one to explain when to use Wikipedia.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Validate language if specified
  if (node.parameters.language) {
    const validLanguageCodes = /^[a-z]{2,3}$/;  // ISO 639 codes
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

export function validateSearXngTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check toolDescription (REQUIRED)
  if (!getToolDescription(node)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `SearXNG Tool "${node.name}" has no toolDescription. Add one to explain when to use SearXNG.`,
      code: 'MISSING_TOOL_DESCRIPTION'
    });
  }

  // 2. Check baseUrl (REQUIRED)
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

export function validateWolframAlphaTool(node: WorkflowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check credentials (REQUIRED)
  if (!node.credentials || (!node.credentials.wolframAlpha && !node.credentials.wolframAlphaApi)) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `WolframAlpha Tool "${node.name}" requires Wolfram|Alpha API credentials. Configure your App ID.`,
      code: 'MISSING_CREDENTIALS'
    });
  }

  // 2. Check description (INFO)
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

/**
 * Helper: Map node types to validator functions
 */
export const AI_TOOL_VALIDATORS = {
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
} as const;

/**
 * Check if a node type is an AI tool sub-node
 */
export function isAIToolSubNode(nodeType: string): boolean {
  const normalized = NodeTypeNormalizer.normalizeToFullForm(nodeType);
  return normalized in AI_TOOL_VALIDATORS;
}

/**
 * Validate an AI tool sub-node with the appropriate validator
 */
export function validateAIToolSubNode(
  node: WorkflowNode,
  nodeType: string,
  reverseConnections: Map<string, ReverseConnection[]>,
  workflow: WorkflowJson
): ValidationIssue[] {
  const normalized = NodeTypeNormalizer.normalizeToFullForm(nodeType);

  // Route to appropriate validator based on node type
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
