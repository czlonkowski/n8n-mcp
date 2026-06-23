/**
 * Unit tests for BaseTriggerHandler
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseTriggerHandler } from '../../../../src/triggers/handlers/base-handler';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { InstanceContext } from '../../../../src/types/instance-context';
import { Workflow } from '../../../../src/types/n8n-api';
import { TriggerType, TriggerResponse, TriggerHandlerCapabilities, BaseTriggerInput } from '../../../../src/triggers/types';
import { z } from 'zod';

// Mock getN8nApiConfig
vi.mock('../../../../src/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn(() => ({
    baseUrl: 'https://env-n8n.example.com/api/v1',
    apiKey: 'env-api-key',
  })),
}));

// Create a concrete implementation for testing
class TestHandler extends BaseTriggerHandler {
  readonly triggerType: TriggerType = 'webhook';
  readonly capabilities: TriggerHandlerCapabilities = {
    requiresActiveWorkflow: true,
    canPassInputData: true,
  };
  readonly inputSchema = z.object({
    workflowId: z.string(),
    triggerType: z.literal('webhook'),
  });

  async execute(
    input: BaseTriggerInput,
    workflow: Workflow
  ): Promise<TriggerResponse> {
    return {
      success: true,
      triggerType: this.triggerType,
      workflowId: input.workflowId,
      data: { test: 'data' },
      metadata: { duration: 100 },
    };
  }
}

// Create mock client
const createMockClient = (): N8nApiClient => ({
  getWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  triggerWebhook: vi.fn(),
  getExecution: vi.fn(),
  listExecutions: vi.fn(),
  deleteExecution: vi.fn(),
} as unknown as N8nApiClient);

describe('BaseTriggerHandler', () => {
  let mockClient: N8nApiClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with client only', () => {
      const handler = new TestHandler(mockClient);
      expect(handler).toBeDefined();
      expect(handler.triggerType).toBe('webhook');
    });

    it('should initialize with client and context', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://test.n8n.com/api/v1',
        n8nApiKey: 'test-key',
        sessionId: 'test-session',
      };
      const handler = new TestHandler(mockClient, context);
      expect(handler).toBeDefined();
    });
  });

  describe('validate', () => {
    it('should validate correct input', () => {
      const handler = new TestHandler(mockClient);
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };

      const result = handler.validate(input);
      expect(result).toEqual(input);
    });

    it('should throw ZodError for invalid input', () => {
      const handler = new TestHandler(mockClient);
      const input = {
        workflowId: 123, // Wrong type
        triggerType: 'webhook',
      };

      expect(() => handler.validate(input)).toThrow();
    });

    it('should throw ZodError for missing required fields', () => {
      const handler = new TestHandler(mockClient);
      const input = {
        triggerType: 'webhook',
        // Missing workflowId
      };

      expect(() => handler.validate(input)).toThrow();
    });
  });

  describe('getBaseUrl', () => {
    it('should return base URL from context', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://context.n8n.com/api/v1',
        n8nApiKey: 'context-key',
        sessionId: 'test-session',
      };
      const handler = new TestHandler(mockClient, context);

      const baseUrl = (handler as any).getBaseUrl();
      expect(baseUrl).toBe('https://context.n8n.com');
    });

    it('should strip trailing slash and /api/v1 from context URL', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://context.n8n.com/api/v1/',
        n8nApiKey: 'context-key',
        sessionId: 'test-session',
      };
      const handler = new TestHandler(mockClient, context);

      const baseUrl = (handler as any).getBaseUrl();
      expect(baseUrl).toBe('https://context.n8n.com');
    });

    it('should return base URL from environment config when no context', () => {
      const handler = new TestHandler(mockClient);

      const baseUrl = (handler as any).getBaseUrl();
      expect(baseUrl).toBe('https://env-n8n.example.com');
    });

    it('should prefer context over environment config', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://context.n8n.com/api/v1',
        n8nApiKey: 'context-key',
        sessionId: 'test-session',
      };
      const handler = new TestHandler(mockClient, context);

      const baseUrl = (handler as any).getBaseUrl();
      expect(baseUrl).toBe('https://context.n8n.com');
    });
  });

  describe('getApiKey', () => {
    it('should return API key from context', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://context.n8n.com/api/v1',
        n8nApiKey: 'context-api-key',
        sessionId: 'test-session',
      };
      const handler = new TestHandler(mockClient, context);

      const apiKey = (handler as any).getApiKey();
      expect(apiKey).toBe('context-api-key');
    });

    it('should return API key from environment config when no context', () => {
      const handler = new TestHandler(mockClient);

      const apiKey = (handler as any).getApiKey();
      expect(apiKey).toBe('env-api-key');
    });

    it('should prefer context over environment config', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://context.n8n.com/api/v1',
        n8nApiKey: 'context-key',
        sessionId: 'test-session',
      };
      const handler = new TestHandler(mockClient, context);

      const apiKey = (handler as any).getApiKey();
      expect(apiKey).toBe('context-key');
    });
  });

  describe('GHSA-jxx9-px88-pj69 — multi-tenant env fallback refused', () => {
    const originalMultiTenant = process.env.ENABLE_MULTI_TENANT;

    beforeEach(() => {
      process.env.ENABLE_MULTI_TENANT = 'true';
    });

    afterEach(() => {
      if (originalMultiTenant === undefined) {
        delete process.env.ENABLE_MULTI_TENANT;
      } else {
        process.env.ENABLE_MULTI_TENANT = originalMultiTenant;
      }
    });

    it('getBaseUrl returns undefined when no context in multi-tenant mode', () => {
      const handler = new TestHandler(mockClient);
      const baseUrl = (handler as any).getBaseUrl();
      expect(baseUrl).toBeUndefined();
    });

    it('getApiKey returns undefined when no context in multi-tenant mode', () => {
      const handler = new TestHandler(mockClient);
      const apiKey = (handler as any).getApiKey();
      expect(apiKey).toBeUndefined();
    });

    it('getBaseUrl still returns context URL in multi-tenant mode', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://tenant.n8n.com/api/v1',
        n8nApiKey: 'tenant-key',
        sessionId: 'tenant-session',
      };
      const handler = new TestHandler(mockClient, context);
      expect((handler as any).getBaseUrl()).toBe('https://tenant.n8n.com');
    });

    it('getApiKey still returns context key in multi-tenant mode', () => {
      const context: InstanceContext = {
        n8nApiUrl: 'https://tenant.n8n.com/api/v1',
        n8nApiKey: 'tenant-key',
        sessionId: 'tenant-session',
      };
      const handler = new TestHandler(mockClient, context);
      expect((handler as any).getApiKey()).toBe('tenant-key');
    });
  });

  describe('normalizeResponse', () => {
    it('should create normalized success response', () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const startTime = Date.now() - 150;
      const result = { data: 'test-result' };

      const response = (handler as any).normalizeResponse(result, input, startTime);

      expect(response.success).toBe(true);
      expect(response.triggerType).toBe('webhook');
      expect(response.workflowId).toBe('workflow-123');
      expect(response.data).toEqual(result);
      expect(response.metadata.duration).toBeGreaterThanOrEqual(150);
    });

    it('should merge extra fields into response', () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const startTime = Date.now();
      const result = { data: 'test' };
      const extra = {
        executionId: 'exec-123',
        status: 200,
      };

      const response = (handler as any).normalizeResponse(result, input, startTime, extra);

      expect(response.executionId).toBe('exec-123');
      expect(response.status).toBe(200);
    });

    it('should calculate duration correctly', () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const startTime = Date.now() - 500;

      const response = (handler as any).normalizeResponse({}, input, startTime);

      expect(response.metadata.duration).toBeGreaterThanOrEqual(500);
      expect(response.metadata.duration).toBeLessThan(1000);
    });
  });

  describe('errorResponse', () => {
    it('should create error response', () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const startTime = Date.now() - 200;

      const response = (handler as any).errorResponse(
        input,
        'Test error message',
        startTime
      );

      expect(response.success).toBe(false);
      expect(response.triggerType).toBe('webhook');
      expect(response.workflowId).toBe('workflow-123');
      expect(response.error).toBe('Test error message');
      expect(response.metadata.duration).toBeGreaterThanOrEqual(200);
    });

    it('should merge extra error details', () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const startTime = Date.now();
      const extra = {
        code: 'ERR_TEST',
        details: { reason: 'test reason' },
      };

      const response = (handler as any).errorResponse(
        input,
        'Error',
        startTime,
        extra
      );

      expect(response.code).toBe('ERR_TEST');
      expect(response.details).toEqual({ reason: 'test reason' });
    });

    it('should calculate error duration correctly', () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const startTime = Date.now() - 750;

      const response = (handler as any).errorResponse(input, 'Error', startTime);

      expect(response.metadata.duration).toBeGreaterThanOrEqual(750);
      expect(response.metadata.duration).toBeLessThan(1500);
    });
  });

  describe('execute', () => {
    it('should execute successfully', async () => {
      const handler = new TestHandler(mockClient);
      const input: BaseTriggerInput = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };
      const workflow: Workflow = {
        id: 'workflow-123',
        name: 'Test Workflow',
        active: true,
        nodes: [],
        connections: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {},
        staticData: undefined,
      } as Workflow;

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(true);
      expect(response.workflowId).toBe('workflow-123');
      expect(response.data).toEqual({ test: 'data' });
    });
  });
});
