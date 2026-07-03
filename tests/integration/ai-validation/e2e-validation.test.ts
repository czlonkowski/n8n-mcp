/**
 * Integration Tests: End-to-End AI Workflow Validation
 *
 * Tests complete AI workflow validation and creation flow.
 * Validates multi-error detection and workflow creation after validation.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../n8n-api/utils/test-context';
import { getTestN8nClient } from '../n8n-api/utils/n8n-client';
import { N8nApiClient } from '../../../src/services/n8n-api-client';
import { cleanupOrphanedWorkflows } from '../n8n-api/utils/cleanup-helpers';
import { createMcpContext } from '../n8n-api/utils/mcp-context';
import { InstanceContext } from '../../../src/types/instance-context';
import { handleValidateWorkflow, handleCreateWorkflow } from '../../../src/mcp/handlers-n8n-manager';
import { getNodeRepository, closeNodeRepository } from '../n8n-api/utils/node-repository';
import { NodeRepository } from '../../../src/database/node-repository';
import { ValidationResponse } from '../n8n-api/types/mcp-responses';
import {
  createChatTriggerNode,
  createAIAgentNode,
  createLanguageModelNode,
  createHTTPRequestToolNode,
  createCodeToolNode,
  createMemoryNode,
  createRespondNode,
  createAIConnection,
  createMainConnection,
  mergeConnections,
  createAIWorkflow
} from './helpers';

describe('Integration: End-to-End AI Workflow Validation', () => {
  let context: TestContext;
  let client: N8nApiClient;
  let mcpContext: InstanceContext;
  let repository: NodeRepository;

  beforeEach(async () => {
    context = createTestContext();
    client = getTestN8nClient();
    mcpContext = createMcpContext();
    repository = await getNodeRepository();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  afterAll(async () => {
    await closeNodeRepository();
    if (!process.env.CI) {
      await cleanupOrphanedWorkflows();
    }
  });

  // ======================================================================
  // TEST 1: Validate and Create Complex AI Workflow
  // ======================================================================

  it('should validate and create complex AI workflow', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'lastNode'
    });

    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const httpTool = createHTTPRequestToolNode({
      name: 'Weather API',
      toolDescription: 'Fetches current weather data from weather API',
      url: 'https://api.weather.com/current',
      method: 'GET'
    });

    const codeTool = createCodeToolNode({
      name: 'Data Processor',
      toolDescription: 'Processes and formats weather data',
      code: 'return { formatted: JSON.stringify($input.all()) };'
    });

    const memory = createMemoryNode({
      name: 'Conversation Memory',
      contextWindowLength: 10
    });

    const agent = createAIAgentNode({
      name: 'Weather Assistant',
      promptType: 'define',
      text: 'You are a weather assistant. Help users understand weather data.',
      systemMessage: 'You are an AI assistant specialized in weather information. You have access to weather APIs and can process data. Always provide clear, helpful responses.'
    });

    const respond = createRespondNode({
      name: 'Respond to User'
    });

    const workflow = createAIWorkflow(
      [chatTrigger, languageModel, httpTool, codeTool, memory, agent, respond],
      mergeConnections(
        createMainConnection('Chat Trigger', 'Weather Assistant'),
        createAIConnection('OpenAI Chat Model', 'Weather Assistant', 'ai_languageModel'),
        createAIConnection('Weather API', 'Weather Assistant', 'ai_tool'),
        createAIConnection('Data Processor', 'Weather Assistant', 'ai_tool'),
        createAIConnection('Conversation Memory', 'Weather Assistant', 'ai_memory'),
        createMainConnection('Weather Assistant', 'Respond to User')
      ),
      {
        name: createTestWorkflowName('E2E - Complex AI Workflow'),
        tags: ['mcp-integration-test', 'ai-validation', 'e2e']
      }
    );

    // Step 1: Create workflow
    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    // Step 2: Validate workflow
    const validationResponse = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(validationResponse.success).toBe(true);
    const validationData = validationResponse.data as ValidationResponse;

    // Workflow should be valid
    expect(validationData.valid).toBe(true);
    expect(validationData.errors).toBeUndefined();
    expect(validationData.summary.errorCount).toBe(0);

    // Verify all nodes detected
    expect(validationData.summary.totalNodes).toBe(7);
    expect(validationData.summary.triggerNodes).toBe(1);

    // Step 3: Since it's valid, it's already created and ready to use
    // Just verify it exists
    const retrieved = await client.getWorkflow(created.id!);
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.nodes.length).toBe(7);
  });

  // ======================================================================
  // TEST 2: Detect Multiple Validation Errors
  // ======================================================================

  it('should detect multiple validation errors', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'streaming'
    });

    const httpTool = createHTTPRequestToolNode({
      name: 'HTTP Tool',
      toolDescription: '', // ERROR: missing description
      url: '', // ERROR: missing URL
      method: 'GET'
    });

    const codeTool = createCodeToolNode({
      name: 'Code Tool',
      toolDescription: 'Short', // WARNING: too short
      code: '' // ERROR: missing code
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      promptType: 'define',
      text: '', // ERROR: missing prompt text
      // ERROR: missing language model connection
      // ERROR: has main output in streaming mode
    });

    const respond = createRespondNode({
      name: 'Respond'
    });

    const workflow = createAIWorkflow(
      [chatTrigger, httpTool, codeTool, agent, respond],
      mergeConnections(
        createMainConnection('Chat Trigger', 'AI Agent'),
        createAIConnection('HTTP Tool', 'AI Agent', 'ai_tool'),
        createAIConnection('Code Tool', 'AI Agent', 'ai_tool'),
        createMainConnection('AI Agent', 'Respond') // ERROR in streaming mode
      ),
      {
        name: createTestWorkflowName('E2E - Multiple Errors'),
        tags: ['mcp-integration-test', 'ai-validation', 'e2e']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const validationResponse = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(validationResponse.success).toBe(true);
    const validationData = validationResponse.data as ValidationResponse;

    // Should be invalid with multiple errors
    expect(validationData.valid).toBe(false);
    expect(validationData.errors).toBeDefined();
    expect(validationData.errors!.length).toBeGreaterThan(3);

    // Verify specific errors are detected
    const errorCodes = validationData.errors!.map(e => e.details?.code || e.code);

    expect(errorCodes).toContain('MISSING_LANGUAGE_MODEL'); // AI Agent
    expect(errorCodes).toContain('MISSING_PROMPT_TEXT'); // AI Agent
    expect(errorCodes).toContain('MISSING_URL'); // HTTP Tool
    expect(errorCodes).toContain('MISSING_CODE'); // Code Tool

    // Missing toolDescription on HTTP Tool is a warning (n8n runs the tool without it)
    const warningCodes = (validationData.warnings ?? []).map(w => w.details?.code || w.code);
    expect(warningCodes).toContain('MISSING_TOOL_DESCRIPTION'); // HTTP Tool

    // Should also have streaming error
    const streamingErrors = validationData.errors!.filter(e => {
      const code = e.details?.code || e.code;
      return code === 'STREAMING_WITH_MAIN_OUTPUT' ||
             code === 'STREAMING_AGENT_HAS_OUTPUT';
    });
    expect(streamingErrors.length).toBeGreaterThan(0);

    // Verify error messages are actionable
    for (const error of validationData.errors!) {
      expect(error.message).toBeDefined();
      expect(error.message.length).toBeGreaterThan(10);
      expect(error.nodeName).toBeDefined();
    }
  });

  // ======================================================================
  // TEST 3: Validate Streaming Workflow (No Main Output)
  // ======================================================================

  it('should validate streaming workflow without main output', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'streaming'
    });

    const languageModel = createLanguageModelNode('anthropic', {
      name: 'Claude Model'
    });

    const agent = createAIAgentNode({
      name: 'Streaming Agent',
      text: 'You are a helpful assistant',
      systemMessage: 'Provide helpful, streaming responses to user queries'
    });

    const workflow = createAIWorkflow(
      [chatTrigger, languageModel, agent],
      mergeConnections(
        createMainConnection('Chat Trigger', 'Streaming Agent'),
        createAIConnection('Claude Model', 'Streaming Agent', 'ai_languageModel')
        // No main output from agent - streaming mode
      ),
      {
        name: createTestWorkflowName('E2E - Streaming Workflow'),
        tags: ['mcp-integration-test', 'ai-validation', 'e2e']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const validationResponse = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(validationResponse.success).toBe(true);
    const validationData = validationResponse.data as ValidationResponse;

    expect(validationData.valid).toBe(true);
    expect(validationData.errors).toBeUndefined();
    expect(validationData.summary.errorCount).toBe(0);
  });

  // ======================================================================
  // TEST 4: Validate Non-Streaming Workflow (With Main Output)
  // ======================================================================

  it('should validate non-streaming workflow with main output', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'lastNode'
    });

    const languageModel = createLanguageModelNode('openai', {
      name: 'GPT Model'
    });

    const agent = createAIAgentNode({
      name: 'Non-Streaming Agent',
      text: 'You are a helpful assistant'
    });

    const respond = createRespondNode({
      name: 'Final Response'
    });

    const workflow = createAIWorkflow(
      [chatTrigger, languageModel, agent, respond],
      mergeConnections(
        createMainConnection('Chat Trigger', 'Non-Streaming Agent'),
        createAIConnection('GPT Model', 'Non-Streaming Agent', 'ai_languageModel'),
        createMainConnection('Non-Streaming Agent', 'Final Response')
      ),
      {
        name: createTestWorkflowName('E2E - Non-Streaming Workflow'),
        tags: ['mcp-integration-test', 'ai-validation', 'e2e']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const validationResponse = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(validationResponse.success).toBe(true);
    const validationData = validationResponse.data as ValidationResponse;

    expect(validationData.valid).toBe(true);
    expect(validationData.errors).toBeUndefined();
  });

  // ======================================================================
  // TEST 5: Test Node Type Normalization (Bug Fix Validation)
  // ======================================================================

  it('should correctly normalize node types during validation', async () => {
    // This test validates the v2.17.0 fix for node type normalization
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Model'
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'Test agent'
    });

    const httpTool = createHTTPRequestToolNode({
      name: 'API Tool',
      toolDescription: 'Calls external API',
      url: 'https://api.example.com/test'
    });

    const workflow = createAIWorkflow(
      [languageModel, agent, httpTool],
      mergeConnections(
        createAIConnection('OpenAI Model', 'AI Agent', 'ai_languageModel'),
        createAIConnection('API Tool', 'AI Agent', 'ai_tool')
      ),
      {
        name: createTestWorkflowName('E2E - Type Normalization'),
        tags: ['mcp-integration-test', 'ai-validation', 'e2e']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const validationResponse = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(validationResponse.success).toBe(true);
    const validationData = validationResponse.data as ValidationResponse;

    // Should be valid - no false "no tools connected" warning
    expect(validationData.valid).toBe(true);

    // Should NOT have false warnings about tools
    if (validationData.warnings) {
      const falseToolWarnings = validationData.warnings.filter(w =>
        w.message.toLowerCase().includes('no ai_tool') &&
        w.nodeName === 'AI Agent'
      );
      expect(falseToolWarnings.length).toBe(0);
    }
  });
});
