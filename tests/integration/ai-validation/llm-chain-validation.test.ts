/**
 * Integration Tests: Basic LLM Chain Validation
 *
 * Tests Basic LLM Chain validation against real n8n instance.
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
  createBasicLLMChainNode,
  createLanguageModelNode,
  createMemoryNode,
  createAIConnection,
  mergeConnections,
  createAIWorkflow
} from './helpers';
import { WorkflowNode } from '../../../src/types/n8n-api';

describe('Integration: Basic LLM Chain Validation', () => {
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

  it('should detect missing language model', async () => {
    const llmChain = createBasicLLMChainNode({
      name: 'Basic LLM Chain',
      promptType: 'define',
      text: 'Test prompt'
    });

    const workflow = createAIWorkflow(
      [llmChain],
      {}, // No connections
      {
        name: createTestWorkflowName('LLM Chain - Missing Model'),
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
    expect(errorCodes).toContain('MISSING_LANGUAGE_MODEL');
  });

  // ======================================================================
  // TEST 2: Missing Prompt Text (promptType=define)
  // ======================================================================

  it('should detect missing prompt text', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const llmChain = createBasicLLMChainNode({
      name: 'Basic LLM Chain',
      promptType: 'define',
      text: '' // Empty prompt text
    });

    const workflow = createAIWorkflow(
      [languageModel, llmChain],
      createAIConnection('OpenAI Chat Model', 'Basic LLM Chain', 'ai_languageModel'),
      {
        name: createTestWorkflowName('LLM Chain - Missing Prompt'),
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
    expect(errorCodes).toContain('MISSING_PROMPT_TEXT');
  });

  // ======================================================================
  // TEST 3: Valid Complete LLM Chain
  // ======================================================================

  it('should validate complete LLM Chain', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    const llmChain = createBasicLLMChainNode({
      name: 'Basic LLM Chain',
      promptType: 'define',
      text: 'You are a helpful assistant. Answer the following: {{ $json.question }}'
    });

    const workflow = createAIWorkflow(
      [languageModel, llmChain],
      createAIConnection('OpenAI Chat Model', 'Basic LLM Chain', 'ai_languageModel'),
      {
        name: createTestWorkflowName('LLM Chain - Valid'),
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
  // TEST 4: LLM Chain with Memory
  // ======================================================================

  it('should validate LLM Chain with memory', async () => {
    const languageModel = createLanguageModelNode('anthropic', {
      name: 'Anthropic Chat Model'
    });

    const memory = createMemoryNode({
      name: 'Window Buffer Memory',
      contextWindowLength: 10
    });

    const llmChain = createBasicLLMChainNode({
      name: 'Basic LLM Chain',
      promptType: 'auto'
    });

    const workflow = createAIWorkflow(
      [languageModel, memory, llmChain],
      mergeConnections(
        createAIConnection('Anthropic Chat Model', 'Basic LLM Chain', 'ai_languageModel'),
        createAIConnection('Window Buffer Memory', 'Basic LLM Chain', 'ai_memory')
      ),
      {
        name: createTestWorkflowName('LLM Chain - With Memory'),
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
  });

  // ======================================================================
  // TEST 5: LLM Chain with Multiple Language Models (Error)
  // ======================================================================

  it('should detect more than 2 language models', async () => {
    // 2 models is valid (fallback support); only >2 is an error
    const languageModel1 = createLanguageModelNode('openai', {
      id: 'model-1',
      name: 'OpenAI Chat Model 1'
    });

    const languageModel2 = createLanguageModelNode('anthropic', {
      id: 'model-2',
      name: 'Anthropic Chat Model'
    });

    const languageModel3 = createLanguageModelNode('openai', {
      id: 'model-3',
      name: 'OpenAI Chat Model 2'
    });

    const llmChain = createBasicLLMChainNode({
      name: 'Basic LLM Chain',
      promptType: 'define',
      text: 'Test prompt'
    });

    const workflow = createAIWorkflow(
      [languageModel1, languageModel2, languageModel3, llmChain],
      mergeConnections(
        createAIConnection('OpenAI Chat Model 1', 'Basic LLM Chain', 'ai_languageModel'),
        createAIConnection('Anthropic Chat Model', 'Basic LLM Chain', 'ai_languageModel'),
        createAIConnection('OpenAI Chat Model 2', 'Basic LLM Chain', 'ai_languageModel') // ERROR: >2 models
      ),
      {
        name: createTestWorkflowName('LLM Chain - Multiple Models'),
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
    expect(errorCodes).toContain('MULTIPLE_LANGUAGE_MODELS');
  });

  // ======================================================================
  // TEST 6: LLM Chain with Tools (Error - not supported)
  // ======================================================================

  it('should detect tools connection (not supported)', async () => {
    const languageModel = createLanguageModelNode('openai', {
      name: 'OpenAI Chat Model'
    });

    // Manually create a tool node
    const toolNode: WorkflowNode = {
      id: 'tool-1',
      name: 'Calculator',
      type: '@n8n/n8n-nodes-langchain.toolCalculator',
      typeVersion: 1,
      position: [250, 400],
      parameters: {}
    };

    const llmChain = createBasicLLMChainNode({
      name: 'Basic LLM Chain',
      promptType: 'define',
      text: 'Calculate something'
    });

    const workflow = createAIWorkflow(
      [languageModel, toolNode, llmChain],
      mergeConnections(
        createAIConnection('OpenAI Chat Model', 'Basic LLM Chain', 'ai_languageModel'),
        createAIConnection('Calculator', 'Basic LLM Chain', 'ai_tool') // ERROR: tools not supported
      ),
      {
        name: createTestWorkflowName('LLM Chain - With Tools'),
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
    expect(errorCodes).toContain('TOOLS_NOT_SUPPORTED');

    const errorMessages = data.errors!.map(e => e.message).join(' ');
    expect(errorMessages).toMatch(/AI Agent/i); // Should suggest using AI Agent
  });
});
