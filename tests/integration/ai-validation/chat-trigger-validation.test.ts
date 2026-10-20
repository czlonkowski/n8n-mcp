/**
 * Integration Tests: Chat Trigger Validation
 *
 * Tests Chat Trigger validation against real n8n instance.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createTestContext, TestContext, createTestWorkflowName } from '../n8n-api/utils/test-context';
import { getTestN8nClient } from '../n8n-api/utils/n8n-client';
import { N8nApiClient } from '../../../src/services/n8n-api-client';
import { createMcpContext } from '../n8n-api/utils/mcp-context';
import { InstanceContext } from '../../../src/types/instance-context';
import { handleValidateWorkflow } from '../../../src/mcp/handlers-n8n-manager';
import { getNodeRepository, closeNodeRepository } from '../n8n-api/utils/node-repository';
import { NodeRepository } from '../../../src/database/node-repository';
import { ValidationResponse } from '../n8n-api/types/mcp-responses';
import {
  createChatTriggerNode,
  createAIAgentNode,
  createLanguageModelNode,
  createRespondNode,
  createAIConnection,
  createMainConnection,
  mergeConnections,
  createAIWorkflow
} from './helpers';
import { WorkflowNode } from '../../../src/types/n8n-api';

describe('Integration: Chat Trigger Validation', () => {
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
  });

  // ======================================================================
  // TEST 1: Streaming to Non-AI-Agent
  // ======================================================================

  it('should detect streaming to non-AI-Agent', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'streaming'
    });

    // Regular node (not AI Agent)
    const regularNode: WorkflowNode = {
      id: 'set-1',
      name: 'Set',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [450, 300],
      parameters: {
        assignments: {
          assignments: []
        }
      }
    };

    const workflow = createAIWorkflow(
      [chatTrigger, regularNode],
      createMainConnection('Chat Trigger', 'Set'),
      {
        name: createTestWorkflowName('Chat Trigger - Wrong Target'),
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
    expect(errorCodes).toContain('STREAMING_WRONG_TARGET');

    const errorMessages = data.errors!.map(e => e.message).join(' ');
    expect(errorMessages).toMatch(/streaming.*AI Agent/i);
  });

  // ======================================================================
  // TEST 2: Missing Connections
  // ======================================================================

  it('should detect missing connections', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger'
    });

    const workflow = createAIWorkflow(
      [chatTrigger],
      {}, // No connections
      {
        name: createTestWorkflowName('Chat Trigger - No Connections'),
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
    expect(errorCodes).toContain('MISSING_CONNECTIONS');
  });

  // ======================================================================
  // TEST 3: Valid Streaming Setup
  // ======================================================================

  it('should validate valid streaming setup', async () => {
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
      // No main output connections - streaming mode
    });

    const workflow = createAIWorkflow(
      [chatTrigger, languageModel, agent],
      mergeConnections(
        createMainConnection('Chat Trigger', 'AI Agent'),
        createAIConnection('OpenAI Chat Model', 'AI Agent', 'ai_languageModel')
        // NO main output from AI Agent
      ),
      {
        name: createTestWorkflowName('Chat Trigger - Valid Streaming'),
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
  // TEST 4: LastNode Mode (Default)
  // ======================================================================

  it('should validate lastNode mode with AI Agent', async () => {
    const chatTrigger = createChatTriggerNode({
      name: 'Chat Trigger',
      responseMode: 'lastNode'
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
        createMainConnection('AI Agent', 'Respond to Webhook')
      ),
      {
        name: createTestWorkflowName('Chat Trigger - LastNode Mode'),
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

    // Should be valid (lastNode mode allows main output)
    expect(data.valid).toBe(true);

    // May have info suggestion about using streaming
    if (data.info) {
      const streamingSuggestion = data.info.find((i: any) =>
        i.message.toLowerCase().includes('streaming')
      );
      // This is optional - just checking the suggestion exists if present
      if (streamingSuggestion) {
        expect(streamingSuggestion.severity).toBe('info');
      }
    }
  });

  // ======================================================================
  // TEST 5: Streaming Agent with Output Connection (Error)
  // ======================================================================

  it('should detect streaming agent with output connection', async () => {
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
        createMainConnection('AI Agent', 'Respond to Webhook') // ERROR in streaming mode
      ),
      {
        name: createTestWorkflowName('Chat Trigger - Streaming With Output'),
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

    // Should detect streaming agent has output
    const streamingErrors = data.errors!.filter(e => {
      const code = e.details?.code || e.code;
      return code === 'STREAMING_AGENT_HAS_OUTPUT' ||
             e.message.toLowerCase().includes('streaming');
    });
    expect(streamingErrors.length).toBeGreaterThan(0);
  });
});
