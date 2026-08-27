/**
 * Integration Tests: AI Agent Validation
 *
 * Tests AI Agent validation against real n8n instance.
 * These tests validate the fixes from v2.17.0 including node type normalization.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../n8n-api/utils/test-context';
import { getTestN8nClient } from '../n8n-api/utils/n8n-client';
import { N8nApiClient } from '../../../src/services/n8n-api-client';
import { cleanupOrphanedWorkflows } from '../n8n-api/utils/cleanup-helpers';
import { createMcpContext } from '../n8n-api/utils/mcp-context';
import { InstanceContext } from '../../../src/types/instance-context';
import { handleValidateWorkflow } from '../../../src/mcp/handlers-n8n-manager';
import { getNodeRepository, closeNodeRepository } from '../n8n-api/utils/node-repository';
import { NodeRepository } from '../../../src/database/node-repository';
import { ValidationResponse } from '../n8n-api/types/mcp-responses';
import {
  createAIAgentNode,
  createChatTriggerNode,
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

describe('Integration: AI Agent Validation', () => {
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
  // TEST 1: Missing Language Model
  // ======================================================================

  it('should detect missing language model in real workflow', async () => {
    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'Test prompt'
    });

    const workflow = createAIWorkflow(
      [agent],
      {},
      {
        name: createTestWorkflowName('AI Agent - Missing Model'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(false);
    expect(data.errors).toBeDefined();
    expect(data.errors!.length).toBeGreaterThan(0);

    const errorCodes = data.errors!.map(e => e.details?.code || e.code);
    expect(errorCodes).toContain('MISSING_LANGUAGE_MODEL');

    const errorMessages = data.errors!.map(e => e.message).join(' ');
    expect(errorMessages).toMatch(/language model|ai_languageModel/i);
  });

  // ======================================================================
  // TEST 2: Valid AI Agent with Language Model
  // ======================================================================

  it('should validate AI Agent with language model', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'You are a helpful assistant'
    });

    const workflow = createAIWorkflow(
      [languageModel, agent],
      mergeConnections(
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel')
      ),
      {
        name: createTestWorkflowName('AI Agent - Valid'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(true);
    expect(data.errors).toBeUndefined();
    expect(data.summary.errorCount).toBe(0);
  });

  // ======================================================================
  // TEST 3: Tool Connections Detection
  // ======================================================================

  it('should detect tool connections correctly', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const httpTool = createHTTPRequestToolNode({
      name: 'HTTP Request Tool',
      toolDescription: 'Fetches weather data from API',
      url: 'https://api.weather.com/current',
      method: 'GET'
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'You are a weather assistant'
    });

    const workflow = createAIWorkflow(
      [languageModel, httpTool, agent],
      mergeConnections(
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel'),
        createAIConnection('HTTP Request Tool', 'AI Agent', 'ai_tool')
      ),
      {
        name: createTestWorkflowName('AI Agent - With Tool'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(true);

    // Should NOT have false "no tools" warning
    if (data.warnings) {
      const toolWarnings = data.warnings.filter(w =>
        w.message.toLowerCase().includes('no ai_tool')
      );
      expect(toolWarnings.length).toBe(0);
    }
  });

  // ======================================================================
  // TEST 4: Streaming Mode Constraints (Chat Trigger)
  // ======================================================================

  it('should validate streaming mode constraints', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'streaming'
    });

    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'You are a helpful assistant'
    });

    const respond = createRespondNode({
      name: 'Respond to Webhook'
    });

    const workflow = createAIWorkflow(
      [chatTrigger, languageModel, agent, respond],
      mergeConnections(
        createMainConnection('Chat Trigger', 'AI Agent'),
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel'),
        createMainConnection('AI Agent', 'Respond to Webhook') // ERROR: streaming with main output
      ),
      {
        name: createTestWorkflowName('AI Agent - Streaming Error'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(false);
    expect(data.errors).toBeDefined();

    const streamingErrors = data.errors!.filter(e => {
      const code = e.details?.code || e.code;
      return code === 'STREAMING_WITH_MAIN_OUTPUT' ||
             code === 'STREAMING_AGENT_HAS_OUTPUT';
    });
    expect(streamingErrors.length).toBeGreaterThan(0);
  });

  // ======================================================================
  // TEST 5: AI Agent Own streamResponse Setting
  // ======================================================================

  it('should validate AI Agent own streamResponse setting', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'You are a helpful assistant',
      streamResponse: true // Agent has its own streaming enabled
    });

    const respond = createRespondNode({
      name: 'Respond to Webhook'
    });

    const workflow = createAIWorkflow(
      [languageModel, agent, respond],
      mergeConnections(
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel'),
        createMainConnection('AI Agent', 'Respond to Webhook') // ERROR: streaming with main output
      ),
      {
        name: createTestWorkflowName('AI Agent - Own Streaming'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(false);
    expect(data.errors).toBeDefined();

    const errorCodes = data.errors!.map(e => e.details?.code || e.code);
    expect(errorCodes).toContain('STREAMING_WITH_MAIN_OUTPUT');
  });

  // ======================================================================
  // TEST 6: Multiple Memory Connections
  // ======================================================================

  it('should validate memory connections', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const memory1 = createMemoryNode({
      name: 'Memory 1'
    });

    const memory2 = createMemoryNode({
      id: 'memory-2', // the helper defaults to 'memory-1'; n8n 2.36 rejects duplicate node ids
      name: 'Memory 2'
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      text: 'You are a helpful assistant'
    });

    const workflow = createAIWorkflow(
      [languageModel, memory1, memory2, agent],
      mergeConnections(
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel'),
        createAIConnection('Memory 1', 'AI Agent', 'ai_memory'),
        createAIConnection('Memory 2', 'AI Agent', 'ai_memory') // ERROR: multiple memory
      ),
      {
        name: createTestWorkflowName('AI Agent - Multiple Memory'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(false);
    expect(data.errors).toBeDefined();

    const errorCodes = data.errors!.map(e => e.details?.code || e.code);
    expect(errorCodes).toContain('MULTIPLE_MEMORY_CONNECTIONS');
  });

  // ======================================================================
  // TEST 7: Complete AI Workflow (All Components)
  // ======================================================================

  it('should validate complete AI workflow', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'lastNode' // Not streaming
    });

    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const httpTool = createHTTPRequestToolNode({
      name: 'HTTP Request Tool',
      toolDescription: 'Fetches data from external API',
      url: 'https://api.example.com/data',
      method: 'GET'
    });

    const codeTool = createCodeToolNode({
      name: 'Code Tool',
      toolDescription: 'Processes data with custom logic',
      code: 'return { result: "processed" };'
    });

    const memory = createMemoryNode({
      name: 'Window Buffer Memory',
      contextWindowLength: 5
    });

    const agent = createAIAgentNode({
      name: 'AI Agent',
      promptType: 'define',
      text: 'You are a helpful assistant with access to tools',
      systemMessage: 'You are an AI assistant that helps users with data processing and external API calls.'
    });

    const respond = createRespondNode({
      name: 'Respond to Webhook'
    });

    const workflow = createAIWorkflow(
      [chatTrigger, languageModel, httpTool, codeTool, memory, agent, respond],
      mergeConnections(
        createMainConnection('Chat Trigger', 'AI Agent'),
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel'),
        createAIConnection('HTTP Request Tool', 'AI Agent', 'ai_tool'),
        createAIConnection('Code Tool', 'AI Agent', 'ai_tool'),
        createAIConnection('Window Buffer Memory', 'AI Agent', 'ai_memory'),
        createMainConnection('AI Agent', 'Respond to Webhook')
      ),
      {
        name: createTestWorkflowName('AI Agent - Complete Workflow'),
        tags: ['mcp-integration-test', 'ai-validation']
      }
    );

    const created = await client.createWorkflow(workflow);
    context.trackWorkflow(created.id!);

    const response = await handleValidateWorkflow(
      { id: created.id },
      repository,
      mcpContext
    );

    expect(response.success).toBe(true);
    const data = response.data as ValidationResponse;

    expect(data.valid).toBe(true);
    expect(data.errors).toBeUndefined();
    expect(data.summary.errorCount).toBe(0);
  });
});
