/**
 * AI Node Validator
 *
 * Implements validation logic for AI Agent, Chat Trigger, and Basic LLM Chain nodes
 * from docs/FINAL_AI_VALIDATION_SPEC.md
 *
 * Key Features:
 * - Reverse connection mapping (AI connections flow TO the consumer)
 * - AI Agent comprehensive validation (prompt types, fallback models, streaming mode)
 * - Chat Trigger validation (streaming mode constraints)
 * - Integration with AI tool validators
 */

import { NodeTypeNormalizer } from '../utils/node-type-normalizer';
import {
  WorkflowNode,
  WorkflowJson,
  ReverseConnection,
  ValidationIssue,
  isAIToolSubNode,
  validateAIToolSubNode
} from './ai-tool-validators';

// Re-export types for test files
export type {
  WorkflowNode,
  WorkflowJson,
  ReverseConnection,
  ValidationIssue
} from './ai-tool-validators';

// Validation constants
const MIN_SYSTEM_MESSAGE_LENGTH = 20;
const MAX_ITERATIONS_WARNING_THRESHOLD = 50;

/**
 * AI Connection Types
 * From spec lines 551-596
 */
export const AI_CONNECTION_TYPES = [
  'ai_languageModel',
  'ai_memory',
  'ai_tool',
  'ai_embedding',
  'ai_vectorStore',
  'ai_document',
  'ai_textSplitter',
  'ai_outputParser'
] as const;

/**
 * Build Reverse Connection Map
 *
 * CRITICAL: AI connections flow TO the consumer node (reversed from standard n8n pattern)
 * This utility maps which nodes connect TO each node, essential for AI validation.
 *
 * From spec lines 551-596
 *
 * @example
 * Standard n8n: [Source] --main--> [Target]
 * workflow.connections["Source"]["main"] = [[{node: "Target", ...}]]
 *
 * AI pattern: [Language Model] --ai_languageModel--> [AI Agent]
 * workflow.connections["Language Model"]["ai_languageModel"] = [[{node: "AI Agent", ...}]]
 *
 * Reverse map: reverseMap.get("AI Agent") = [{sourceName: "Language Model", type: "ai_languageModel", ...}]
 */
export function buildReverseConnectionMap(
  workflow: WorkflowJson
): Map<string, ReverseConnection[]> {
  const map = new Map<string, ReverseConnection[]>();

  // Iterate through all connections
  for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
    // Validate source name is not empty
    if (!sourceName || typeof sourceName !== 'string' || sourceName.trim() === '') {
      continue;
    }

    if (!outputs || typeof outputs !== 'object') continue;

    // Iterate through all output types (main, error, ai_tool, ai_languageModel, etc.)
    for (const [outputType, connections] of Object.entries(outputs)) {
      if (!Array.isArray(connections)) continue;

      // Flatten nested arrays and process each connection
      const connArray = connections.flat().filter(c => c);

      for (const conn of connArray) {
        if (!conn || !conn.node) continue;

        // Validate target node name is not empty
        if (typeof conn.node !== 'string' || conn.node.trim() === '') {
          continue;
        }

        // Initialize array for target node if not exists
        if (!map.has(conn.node)) {
          map.set(conn.node, []);
        }

        // Add reverse connection entry
        map.get(conn.node)!.push({
          sourceName: sourceName,
          sourceType: outputType,
          type: outputType,
          index: conn.index ?? 0
        });
      }
    }
  }

  return map;
}

/**
 * Get AI connections TO a specific node
 */
export function getAIConnections(
  nodeName: string,
  reverseConnections: Map<string, ReverseConnection[]>,
  connectionType?: string
): ReverseConnection[] {
  const incoming = reverseConnections.get(nodeName) || [];

  if (connectionType) {
    return incoming.filter(c => c.type === connectionType);
  }

  return incoming.filter(c => AI_CONNECTION_TYPES.includes(c.type as any));
}

/**
 * Validate AI Agent Node
 * From spec lines 3-549
 *
 * Validates:
 * - Language model connections (1 or 2 if fallback)
 * - Output parser connection + hasOutputParser flag
 * - Prompt type configuration (auto vs define)
 * - System message recommendations
 * - Streaming mode constraints (CRITICAL)
 * - Memory connections (0-1)
 * - Tool connections
 * - maxIterations validation
 */
export function validateAIAgent(
  node: WorkflowNode,
  reverseConnections: Map<string, ReverseConnection[]>,
  workflow: WorkflowJson
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const incoming = reverseConnections.get(node.name) || [];

  // 1. Validate language model connections (REQUIRED: 1 or 2 if fallback)
  const languageModelConnections = incoming.filter(c => c.type === 'ai_languageModel');

  if (languageModelConnections.length === 0) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" requires an ai_languageModel connection. Connect a language model node (e.g., OpenAI Chat Model, Anthropic Chat Model).`,
      code: 'MISSING_LANGUAGE_MODEL'
    });
  } else if (languageModelConnections.length > 2) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has ${languageModelConnections.length} ai_languageModel connections. Maximum is 2 (for fallback model support).`,
      code: 'TOO_MANY_LANGUAGE_MODELS'
    });
  } else if (languageModelConnections.length === 2) {
    // Check if fallback is enabled
    if (!node.parameters.needsFallback) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" has 2 language models but needsFallback is not enabled. Set needsFallback=true or remove the second model.`,
        code: 'MULTIPLE_LANGUAGE_MODELS_NO_FALLBACK'
      });
    }
  } else if (languageModelConnections.length === 1 && node.parameters.needsFallback === true) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has needsFallback=true but only 1 language model connected. Connect a second model for fallback or disable needsFallback.`,
      code: 'FALLBACK_MISSING_SECOND_MODEL'
    });
  }

  // 2. Validate output parser configuration
  const outputParserConnections = incoming.filter(c => c.type === 'ai_outputParser');

  if (node.parameters.hasOutputParser === true) {
    if (outputParserConnections.length === 0) {
      // n8n does not enforce this connection: the agent runs and returns a
      // plain string, silently skipping structured output
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" has hasOutputParser=true but no ai_outputParser connection. The agent will run but return a plain string - connect an output parser or set hasOutputParser=false.`,
        code: 'MISSING_OUTPUT_PARSER'
      });
    }
  } else if (outputParserConnections.length > 0) {
    issues.push({
      severity: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has an output parser connected but hasOutputParser is not true. Set hasOutputParser=true to enable output parsing.`
    });
  }

  if (outputParserConnections.length > 1) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has ${outputParserConnections.length} output parsers. Only 1 is allowed.`,
      code: 'MULTIPLE_OUTPUT_PARSERS'
    });
  }

  // 3. Validate prompt type configuration
  if (node.parameters.promptType === 'define') {
    if (!node.parameters.text || node.parameters.text.trim() === '') {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" has promptType="define" but the text field is empty. Provide a custom prompt or switch to promptType="auto".`,
        code: 'MISSING_PROMPT_TEXT'
      });
    }
  }

  // 4. Check system message (RECOMMENDED)
  if (!node.parameters.systemMessage) {
    issues.push({
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has no systemMessage. Consider adding one to define the agent's role, capabilities, and constraints.`
    });
  } else if (node.parameters.systemMessage.trim().length < MIN_SYSTEM_MESSAGE_LENGTH) {
    issues.push({
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" systemMessage is very short (minimum ${MIN_SYSTEM_MESSAGE_LENGTH} characters recommended). Provide more detail about the agent's role and capabilities.`
    });
  }

  // 5. Validate streaming mode constraints (CRITICAL)
  // From spec lines 753-879: AI Agent with streaming MUST NOT have main output connections
  const isStreamingTarget = checkIfStreamingTarget(node, workflow, reverseConnections);
  const hasOwnStreamingEnabled = node.parameters?.options?.streamResponse === true;

  if (isStreamingTarget || hasOwnStreamingEnabled) {
    // Check if AI Agent has any main output connections
    const agentMainOutput = workflow.connections[node.name]?.main;
    if (agentMainOutput && agentMainOutput.flat().some((c: any) => c)) {
      const streamSource = isStreamingTarget
        ? 'connected from Chat Trigger with responseMode="streaming"'
        : 'has streamResponse=true in options';
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" is in streaming mode (${streamSource}) but has outgoing main connections. Remove all main output connections - streaming responses flow back through the Chat Trigger.`,
        code: 'STREAMING_WITH_MAIN_OUTPUT'
      });
    }
  }

  // 6. Validate memory connections (0-1 allowed)
  const memoryConnections = incoming.filter(c => c.type === 'ai_memory');

  if (memoryConnections.length > 1) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has ${memoryConnections.length} ai_memory connections. Only 1 memory is allowed.`,
      code: 'MULTIPLE_MEMORY_CONNECTIONS'
    });
  }

  // 7. Validate tool connections
  const toolConnections = incoming.filter(c => c.type === 'ai_tool');

  if (toolConnections.length === 0) {
    issues.push({
      severity: 'info',
      nodeId: node.id,
      nodeName: node.name,
      message: `AI Agent "${node.name}" has no ai_tool connections. Consider adding tools to enhance the agent's capabilities.`
    });
  }

  // 8. Validate maxIterations if specified
  if (node.parameters.maxIterations !== undefined) {
    if (typeof node.parameters.maxIterations !== 'number') {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" has invalid maxIterations type. Must be a number.`,
        code: 'INVALID_MAX_ITERATIONS_TYPE'
      });
    } else if (node.parameters.maxIterations < 1) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" has maxIterations=${node.parameters.maxIterations}. Must be at least 1.`,
        code: 'MAX_ITERATIONS_TOO_LOW'
      });
    } else if (node.parameters.maxIterations > MAX_ITERATIONS_WARNING_THRESHOLD) {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `AI Agent "${node.name}" has maxIterations=${node.parameters.maxIterations}. Very high iteration counts (>${MAX_ITERATIONS_WARNING_THRESHOLD}) may cause long execution times and high costs.`
      });
    }
  }

  return issues;
}

/**
 * Check if AI Agent is a streaming target
 * Helper function to determine if an AI Agent is receiving streaming input from Chat Trigger
 */
function checkIfStreamingTarget(
  node: WorkflowNode,
  workflow: WorkflowJson,
  reverseConnections: Map<string, ReverseConnection[]>
): boolean {
  const incoming = reverseConnections.get(node.name) || [];

  // Check if any incoming main connection is from a Chat Trigger with streaming enabled
  const mainConnections = incoming.filter(c => c.type === 'main');

  for (const conn of mainConnections) {
    const sourceNode = workflow.nodes.find(n => n.name === conn.sourceName);
    if (!sourceNode) continue;

    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(sourceNode.type);
    if (normalizedType === 'nodes-langchain.chatTrigger') {
      const responseMode = sourceNode.parameters?.options?.responseMode || 'lastNode';
      if (responseMode === 'streaming') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate Chat Trigger Node
 * From spec lines 753-879
 *
 * Critical validations:
 * - responseMode="streaming" requires AI Agent target
 * - AI Agent with streaming MUST NOT have main output connections
 * - responseMode="lastNode" validation
 */
export function validateChatTrigger(
  node: WorkflowNode,
  workflow: WorkflowJson,
  reverseConnections: Map<string, ReverseConnection[]>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const responseMode = node.parameters?.options?.responseMode || 'lastNode';

  // Get outgoing main connections from Chat Trigger
  const outgoingMain = workflow.connections[node.name]?.main;
  if (!outgoingMain || outgoingMain.length === 0 || !outgoingMain[0] || outgoingMain[0].length === 0) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Chat Trigger "${node.name}" has no outgoing connections. Connect it to an AI Agent or workflow.`,
      code: 'MISSING_CONNECTIONS'
    });
    return issues;
  }

  const firstConnection = outgoingMain[0][0];
  if (!firstConnection) {
    return issues;
  }

  const targetNode = workflow.nodes.find(n => n.name === firstConnection.node);
  if (!targetNode) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Chat Trigger "${node.name}" connects to non-existent node "${firstConnection.node}".`,
      code: 'INVALID_TARGET_NODE'
    });
    return issues;
  }

  const targetType = NodeTypeNormalizer.normalizeToFullForm(targetNode.type);

  // Validate streaming mode
  if (responseMode === 'streaming') {
    // CRITICAL: Streaming mode only works with AI Agent
    if (targetType !== 'nodes-langchain.agent') {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `Chat Trigger "${node.name}" has responseMode="streaming" but connects to "${targetNode.name}" (${targetType}). Streaming mode only works with AI Agent. Change responseMode to "lastNode" or connect to an AI Agent.`,
        code: 'STREAMING_WRONG_TARGET'
      });
    } else {
      // CRITICAL: Check AI Agent has NO main output connections
      const agentMainOutput = workflow.connections[targetNode.name]?.main;
      if (agentMainOutput && agentMainOutput.flat().some((c: any) => c)) {
        issues.push({
          severity: 'error',
          nodeId: targetNode.id,
          nodeName: targetNode.name,
          message: `AI Agent "${targetNode.name}" is in streaming mode but has outgoing main connections. In streaming mode, the AI Agent must NOT have main output connections - responses stream back through the Chat Trigger.`,
          code: 'STREAMING_AGENT_HAS_OUTPUT'
        });
      }
    }
  }

  // Validate lastNode mode
  if (responseMode === 'lastNode') {
    // lastNode mode requires a workflow that ends somewhere
    // Just informational - this is the default and works with any workflow
    if (targetType === 'nodes-langchain.agent') {
      issues.push({
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Chat Trigger "${node.name}" uses responseMode="lastNode" with AI Agent. Consider using responseMode="streaming" for better user experience with real-time responses.`
      });
    }
  }

  return issues;
}

/**
 * Validate Basic LLM Chain Node
 * From spec - simplified AI chain without agent loop
 *
 * Similar to AI Agent but simpler:
 * - Requires 1 language model (or 2 when needsFallback is enabled)
 * - Can have 0-1 memory
 * - No tools (not an agent)
 */
export function validateBasicLLMChain(
  node: WorkflowNode,
  reverseConnections: Map<string, ReverseConnection[]>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const incoming = reverseConnections.get(node.name) || [];

  // 1. Validate language model connections (REQUIRED: 1, or 2 with needsFallback)
  const languageModelConnections = incoming.filter(c => c.type === 'ai_languageModel');

  if (languageModelConnections.length === 0) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Basic LLM Chain "${node.name}" requires an ai_languageModel connection. Connect a language model node.`,
      code: 'MISSING_LANGUAGE_MODEL'
    });
  } else if (languageModelConnections.length > 2) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Basic LLM Chain "${node.name}" has ${languageModelConnections.length} ai_languageModel connections. Maximum is 2 (for fallback model support).`,
      code: 'MULTIPLE_LANGUAGE_MODELS'
    });
  } else if (languageModelConnections.length === 2 && !node.parameters.needsFallback) {
    // n8n uses only the first model when needsFallback is off - not fatal
    issues.push({
      severity: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      message: `Basic LLM Chain "${node.name}" has 2 language models but needsFallback is not enabled. n8n will only use the first model. Set needsFallback=true or remove the second model.`,
      code: 'MULTIPLE_LANGUAGE_MODELS_NO_FALLBACK'
    });
  }

  // 2. Validate memory connections (0-1 allowed)
  const memoryConnections = incoming.filter(c => c.type === 'ai_memory');

  if (memoryConnections.length > 1) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Basic LLM Chain "${node.name}" has ${memoryConnections.length} ai_memory connections. Only 1 memory is allowed.`,
      code: 'MULTIPLE_MEMORY_CONNECTIONS'
    });
  }

  // 3. Check for tool connections (not supported)
  const toolConnections = incoming.filter(c => c.type === 'ai_tool');

  if (toolConnections.length > 0) {
    issues.push({
      severity: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Basic LLM Chain "${node.name}" has ai_tool connections. Basic LLM Chain does not support tools. Use AI Agent if you need tool support.`,
      code: 'TOOLS_NOT_SUPPORTED'
    });
  }

  // 4. Validate prompt configuration
  if (node.parameters.promptType === 'define') {
    if (!node.parameters.text || node.parameters.text.trim() === '') {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `Basic LLM Chain "${node.name}" has promptType="define" but the text field is empty.`,
        code: 'MISSING_PROMPT_TEXT'
      });
    }
  }

  return issues;
}

/**
 * Validate all AI-specific nodes in a workflow
 *
 * This is the main entry point called by WorkflowValidator
 */
export function validateAISpecificNodes(
  workflow: WorkflowJson
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Build reverse connection map (critical for AI validation)
  const reverseConnectionMap = buildReverseConnectionMap(workflow);

  for (const node of workflow.nodes) {
    if (node.disabled) continue;

    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(node.type);

    // Validate AI Agent nodes
    if (normalizedType === 'nodes-langchain.agent') {
      const nodeIssues = validateAIAgent(node, reverseConnectionMap, workflow);
      issues.push(...nodeIssues);
    }

    // Validate Chat Trigger nodes
    if (normalizedType === 'nodes-langchain.chatTrigger') {
      const nodeIssues = validateChatTrigger(node, workflow, reverseConnectionMap);
      issues.push(...nodeIssues);
    }

    // Validate Basic LLM Chain nodes
    if (normalizedType === 'nodes-langchain.chainLlm') {
      const nodeIssues = validateBasicLLMChain(node, reverseConnectionMap);
      issues.push(...nodeIssues);
    }

    // Validate AI tool sub-nodes (13 types)
    if (isAIToolSubNode(normalizedType)) {
      const nodeIssues = validateAIToolSubNode(
        node,
        normalizedType,
        reverseConnectionMap,
        workflow
      );
      issues.push(...nodeIssues);
    }
  }

  return issues;
}

/**
 * Check if a workflow contains any AI nodes
 * Useful for skipping AI validation when not needed
 */
export function hasAINodes(workflow: WorkflowJson): boolean {
  const aiNodeTypes = [
    'nodes-langchain.agent',
    'nodes-langchain.chatTrigger',
    'nodes-langchain.chainLlm',
  ];

  return workflow.nodes.some(node => {
    const normalized = NodeTypeNormalizer.normalizeToFullForm(node.type);
    return aiNodeTypes.includes(normalized) || isAIToolSubNode(normalized);
  });
}

/**
 * Helper: Get AI node type category
 */
export function getAINodeCategory(nodeType: string): string | null {
  const normalized = NodeTypeNormalizer.normalizeToFullForm(nodeType);

  if (normalized === 'nodes-langchain.agent') return 'AI Agent';
  if (normalized === 'nodes-langchain.chatTrigger') return 'Chat Trigger';
  if (normalized === 'nodes-langchain.chainLlm') return 'Basic LLM Chain';
  if (isAIToolSubNode(normalized)) return 'AI Tool';

  // Check for AI component nodes
  if (normalized.startsWith('nodes-langchain.')) {
    if (normalized.includes('openAi') || normalized.includes('anthropic') || normalized.includes('googleGemini')) {
      return 'Language Model';
    }
    if (normalized.includes('memory') || normalized.includes('buffer')) {
      return 'Memory';
    }
    if (normalized.includes('vectorStore') || normalized.includes('pinecone') || normalized.includes('qdrant')) {
      return 'Vector Store';
    }
    if (normalized.includes('embedding')) {
      return 'Embeddings';
    }
    return 'AI Component';
  }

  return null;
}
