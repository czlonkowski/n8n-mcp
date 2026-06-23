/**
 * Unit tests for WebhookHandler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookHandler } from '../../../../src/triggers/handlers/webhook-handler';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { InstanceContext } from '../../../../src/types/instance-context';
import { Workflow, WebhookRequest } from '../../../../src/types/n8n-api';
import { DetectedTrigger } from '../../../../src/triggers/types';

// Mock getN8nApiConfig
vi.mock('../../../../src/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn(() => ({
    baseUrl: 'https://test.n8n.com/api/v1',
    apiKey: 'test-api-key',
  })),
}));

// Mock SSRFProtection
vi.mock('../../../../src/utils/ssrf-protection', () => ({
  SSRFProtection: {
    validateWebhookUrl: vi.fn(async () => ({
      valid: true,
      reason: '',
      address: '8.8.8.8',
      family: 4,
    })),
    createPinnedAgents: vi.fn(() => ({ httpAgent: {}, httpsAgent: {} })),
  },
}));

// Mock buildTriggerUrl
vi.mock('../../../../src/triggers/trigger-detector', () => ({
  buildTriggerUrl: vi.fn((baseUrl: string, trigger: any, mode: string) => {
    return `${baseUrl}/webhook/${trigger.webhookPath}`;
  }),
}));

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

// Create test workflow
const createWorkflow = (): Workflow => ({
  id: 'workflow-123',
  name: 'Test Workflow',
  active: true,
  nodes: [
    {
      id: 'webhook-node',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        path: 'test-webhook',
        httpMethod: 'POST',
      },
    },
  ],
  connections: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  settings: {},
  staticData: undefined,
} as Workflow);

describe('WebhookHandler', () => {
  let mockClient: N8nApiClient;
  let handler: WebhookHandler;

  beforeEach(async () => {
    mockClient = createMockClient();
    handler = new WebhookHandler(mockClient);
    vi.clearAllMocks();

    // Import and reset mock
    const { SSRFProtection } = await import('../../../../src/utils/ssrf-protection');
    vi.mocked(SSRFProtection.validateWebhookUrl).mockResolvedValue({
      valid: true,
      reason: '',
    });
  });

  describe('initialization', () => {
    it('should have correct trigger type', () => {
      expect(handler.triggerType).toBe('webhook');
    });

    it('should have correct capabilities', () => {
      expect(handler.capabilities.requiresActiveWorkflow).toBe(true);
      expect(handler.capabilities.canPassInputData).toBe(true);
      expect(handler.capabilities.supportedMethods).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
    });
  });

  describe('input validation', () => {
    it('should validate correct webhook input', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        httpMethod: 'POST' as const,
        webhookPath: 'test-path',
      };

      const result = handler.validate(input);
      expect(result).toEqual(input);
    });

    it('should validate minimal input', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
      };

      const result = handler.validate(input);
      expect(result.workflowId).toBe('workflow-123');
      expect(result.triggerType).toBe('webhook');
    });

    it('should reject invalid trigger type', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat',
      };

      expect(() => handler.validate(input)).toThrow();
    });

    it('should reject invalid HTTP method', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
        httpMethod: 'PATCH',
      };

      expect(() => handler.validate(input)).toThrow();
    });

    it('should accept optional fields', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        data: { key: 'value' },
        headers: { 'X-Custom': 'header' },
        timeout: 60000,
        waitForResponse: false,
      };

      const result = handler.validate(input);
      expect(result.data).toEqual({ key: 'value' });
      expect(result.headers).toEqual({ 'X-Custom': 'header' });
      expect(result.timeout).toBe(60000);
      expect(result.waitForResponse).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute webhook with provided path', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'custom-path',
        httpMethod: 'POST' as const,
        data: { test: 'data' },
      };
      const workflow = createWorkflow();

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: { result: 'success' },
      });

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(true);
      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrl: expect.stringContaining('/webhook/custom-path'),
          httpMethod: 'POST',
          data: { test: 'data' },
        })
      );
    });

    it('should use trigger info when no explicit path provided', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'webhook',
        node: workflow.nodes[0],
        webhookPath: 'detected-path',
        httpMethod: 'GET',
      };

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: { result: 'success' },
      });

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      expect(mockClient.triggerWebhook).toHaveBeenCalled();
    });

    it('should return error when no webhook path available', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
      };
      const workflow = createWorkflow();

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.error).toContain('No webhook path available');
    });

    it('should return error when base URL not available', async () => {
      const handlerNoContext = new WebhookHandler(mockClient, {} as InstanceContext);

      // Mock getN8nApiConfig to return null
      const { getN8nApiConfig } = await import('../../../../src/config/n8n-api');
      vi.mocked(getN8nApiConfig).mockReturnValue(null as any);

      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test',
      };
      const workflow = createWorkflow();

      const response = await handlerNoContext.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Cannot determine n8n base URL');
    });

    it('should handle SSRF protection rejection', async () => {
      const { SSRFProtection } = await import('../../../../src/utils/ssrf-protection');
      vi.mocked(SSRFProtection.validateWebhookUrl).mockResolvedValue({
        valid: false,
        reason: 'Private IP address not allowed',
      });

      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
      };
      const workflow = createWorkflow();

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.error).toContain('SSRF protection');
      expect(response.error).toContain('Private IP address not allowed');
    });

    it('should use default POST method when not specified', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
      };
      const workflow = createWorkflow();

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: {},
      });

      await handler.execute(input, workflow);

      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'POST',
        })
      );
    });

    it('should pass custom headers', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token',
        },
      };
      const workflow = createWorkflow();

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: {},
      });

      await handler.execute(input, workflow);

      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'X-Custom-Header': 'custom-value',
            'Authorization': 'Bearer token',
          },
        })
      );
    });

    it('should set waitForResponse from input', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
        waitForResponse: false,
      };
      const workflow = createWorkflow();

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 202,
        statusText: 'Accepted',
        data: {},
      });

      await handler.execute(input, workflow);

      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          waitForResponse: false,
        })
      );
    });

    it('should default waitForResponse to true', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
      };
      const workflow = createWorkflow();

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: {},
      });

      await handler.execute(input, workflow);

      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          waitForResponse: true,
        })
      );
    });

    it('should return response with status and metadata', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
        httpMethod: 'POST' as const,
      };
      const workflow = createWorkflow();

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: { result: 'webhook response' },
      });

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(true);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
      expect(response.data).toEqual({ status: 200, statusText: 'OK', data: { result: 'webhook response' } });
      expect(response.metadata?.duration).toBeGreaterThanOrEqual(0);
      expect(response.metadata?.webhookPath).toBe('test-path');
      expect(response.metadata?.httpMethod).toBe('POST');
    });

    it('should handle API errors gracefully', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
      };
      const workflow = createWorkflow();

      const apiError = new Error('Webhook execution failed');
      vi.mocked(mockClient.triggerWebhook).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Webhook execution failed');
    });

    it('should extract execution ID from error details', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
      };
      const workflow = createWorkflow();

      const apiError: any = new Error('Execution error');
      apiError.details = {
        executionId: 'exec-456',
        message: 'Node execution failed',
      };
      vi.mocked(mockClient.triggerWebhook).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.executionId).toBe('exec-456');
      expect(response.details).toEqual({
        executionId: 'exec-456',
        message: 'Node execution failed',
      });
    });

    it('should support all HTTP methods', async () => {
      const workflow = createWorkflow();
      const methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE'> = ['GET', 'POST', 'PUT', 'DELETE'];

      for (const method of methods) {
        vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
          status: 200,
          statusText: 'OK',
          data: {},
        });

        const input = {
          workflowId: 'workflow-123',
          triggerType: 'webhook' as const,
          webhookPath: 'test-path',
          httpMethod: method,
        };

        const response = await handler.execute(input, workflow);

        expect(response.success).toBe(true);
        expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
          expect.objectContaining({
            httpMethod: method,
          })
        );
      }
    });

    it('should use httpMethod from trigger info when not in input', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'webhook',
        node: workflow.nodes[0],
        webhookPath: 'detected-path',
        httpMethod: 'PUT',
      };

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: {},
      });

      await handler.execute(input, workflow, triggerInfo);

      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'PUT',
        })
      );
    });

    it('should prefer input httpMethod over trigger info', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook' as const,
        webhookPath: 'test-path',
        httpMethod: 'DELETE' as const,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'webhook',
        node: workflow.nodes[0],
        webhookPath: 'detected-path',
        httpMethod: 'GET',
      };

      vi.mocked(mockClient.triggerWebhook).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: {},
      });

      await handler.execute(input, workflow, triggerInfo);

      expect(mockClient.triggerWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: 'DELETE',
        })
      );
    });
  });
});
