/**
 * Integration Tests: AI Tool Validation
 *
 * Tests AI tool node validation against real n8n instance.
 * Covers HTTP Request Tool, Code Tool, Vector Store Tool, Workflow Tool, Calculator Tool.
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
  createHTTPRequestToolNode,
  createCodeToolNode,
  createVectorStoreToolNode,
  createWorkflowToolNode,
  createCalculatorToolNode,
  createAIWorkflow
} from './helpers';

describe('Integration: AI Tool Validation', () => {
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
  // HTTP Request Tool Tests
  // ======================================================================

  describe('HTTP Request Tool', () => {
    it('should warn (not error) on missing toolDescription', async () => {
      const httpTool = createHTTPRequestToolNode({
        name: 'HTTP Request Tool',
        toolDescription: '', // Missing - n8n still runs the tool
        url: 'https://api.example.com/data',
        method: 'GET'
      });

      const workflow = createAIWorkflow(
        [httpTool],
        {},
        {
          name: createTestWorkflowName('HTTP Tool - No Description'),
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

      const errorCodes = (data.errors ?? []).map(e => e.details?.code || e.code);
      expect(errorCodes).not.toContain('MISSING_TOOL_DESCRIPTION');

      const warningCodes = (data.warnings ?? []).map(w => w.details?.code || w.code);
      expect(warningCodes).toContain('MISSING_TOOL_DESCRIPTION');
    });

    it('should detect missing URL', async () => {
      const httpTool = createHTTPRequestToolNode({
        name: 'HTTP Request Tool',
        toolDescription: 'Fetches data from API',
        url: '', // Missing
        method: 'GET'
      });

      const workflow = createAIWorkflow(
        [httpTool],
        {},
        {
          name: createTestWorkflowName('HTTP Tool - No URL'),
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
      expect(errorCodes).toContain('MISSING_URL');
    });

    it('should validate valid HTTP Request Tool', async () => {
      const httpTool = createHTTPRequestToolNode({
        name: 'HTTP Request Tool',
        toolDescription: 'Fetches weather data from the weather API',
        url: 'https://api.weather.com/current',
        method: 'GET'
      });

      const workflow = createAIWorkflow(
        [httpTool],
        {},
        {
          name: createTestWorkflowName('HTTP Tool - Valid'),
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
  });

  // ======================================================================
  // Code Tool Tests
  // ======================================================================

  describe('Code Tool', () => {
    it('should detect missing code', async () => {
      const codeTool = createCodeToolNode({
        name: 'Code Tool',
        toolDescription: 'Processes data with custom logic',
        code: '' // Missing
      });

      const workflow = createAIWorkflow(
        [codeTool],
        {},
        {
          name: createTestWorkflowName('Code Tool - No Code'),
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
      expect(errorCodes).toContain('MISSING_CODE');
    });

    it('should validate valid Code Tool', async () => {
      const codeTool = createCodeToolNode({
        name: 'Code Tool',
        toolDescription: 'Calculates the sum of two numbers',
        code: 'return { sum: Number(a) + Number(b) };'
      });

      const workflow = createAIWorkflow(
        [codeTool],
        {},
        {
          name: createTestWorkflowName('Code Tool - Valid'),
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
  });

  // ======================================================================
  // Vector Store Tool Tests
  // ======================================================================

  describe('Vector Store Tool', () => {
    it('should warn (not error) on missing toolDescription', async () => {
      const vectorTool = createVectorStoreToolNode({
        name: 'Vector Store Tool',
        toolDescription: '' // Missing - n8n still runs the tool
      });

      const workflow = createAIWorkflow(
        [vectorTool],
        {},
        {
          name: createTestWorkflowName('Vector Tool - No Description'),
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

      const errorCodes = (data.errors ?? []).map(e => e.details?.code || e.code);
      expect(errorCodes).not.toContain('MISSING_TOOL_DESCRIPTION');

      const warningCodes = (data.warnings ?? []).map(w => w.details?.code || w.code);
      expect(warningCodes).toContain('MISSING_TOOL_DESCRIPTION');
    });

    it('should validate valid Vector Store Tool', async () => {
      const vectorTool = createVectorStoreToolNode({
        name: 'Vector Store Tool',
        toolDescription: 'Searches documentation in vector database'
      });

      const workflow = createAIWorkflow(
        [vectorTool],
        {},
        {
          name: createTestWorkflowName('Vector Tool - Valid'),
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
  });

  // ======================================================================
  // Workflow Tool Tests
  // ======================================================================

  describe('Workflow Tool', () => {
    it('should detect missing workflowId', async () => {
      const workflowTool = createWorkflowToolNode({
        name: 'Workflow Tool',
        toolDescription: 'Executes a sub-workflow',
        workflowId: '' // Missing
      });

      const workflow = createAIWorkflow(
        [workflowTool],
        {},
        {
          name: createTestWorkflowName('Workflow Tool - No ID'),
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
      expect(errorCodes).toContain('MISSING_WORKFLOW_ID');
    });

    it('should validate valid Workflow Tool', async () => {
      const workflowTool = createWorkflowToolNode({
        name: 'Workflow Tool',
        toolDescription: 'Processes customer data through validation workflow',
        workflowId: '123'
      });

      const workflow = createAIWorkflow(
        [workflowTool],
        {},
        {
          name: createTestWorkflowName('Workflow Tool - Valid'),
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
  });

  // ======================================================================
  // Calculator Tool Tests
  // ======================================================================

  describe('Calculator Tool', () => {
    it('should validate Calculator Tool (no configuration needed)', async () => {
      const calcTool = createCalculatorToolNode({
        name: 'Calculator'
      });

      const workflow = createAIWorkflow(
        [calcTool],
        {},
        {
          name: createTestWorkflowName('Calculator Tool - Valid'),
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

      // Calculator has no required configuration
      expect(data.valid).toBe(true);
      expect(data.errors).toBeUndefined();
    });
  });
});
