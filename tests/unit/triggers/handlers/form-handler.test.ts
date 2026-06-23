/**
 * Unit tests for FormHandler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormHandler } from '../../../../src/triggers/handlers/form-handler';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { InstanceContext } from '../../../../src/types/instance-context';
import { Workflow } from '../../../../src/types/n8n-api';
import { DetectedTrigger } from '../../../../src/triggers/types';
import axios from 'axios';
import FormData from 'form-data';

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

// Mock axios
vi.mock('axios');

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
  name: 'Form Workflow',
  active: true,
  nodes: [
    {
      id: 'form-node',
      name: 'Form Trigger',
      type: 'n8n-nodes-base.formTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        path: 'contact-form',
      },
    },
  ],
  connections: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  settings: {},
  staticData: undefined,
} as Workflow);

describe('FormHandler', () => {
  let mockClient: N8nApiClient;
  let handler: FormHandler;

  beforeEach(async () => {
    mockClient = createMockClient();
    handler = new FormHandler(mockClient);
    vi.clearAllMocks();

    // Reset SSRFProtection mock
    const { SSRFProtection } = await import('../../../../src/utils/ssrf-protection');
    vi.mocked(SSRFProtection.validateWebhookUrl).mockResolvedValue({
      valid: true,
      reason: '',
    });

    // Reset axios mock
    vi.mocked(axios.request).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: { success: true, message: 'Form submitted' },
    });
  });

  describe('initialization', () => {
    it('should have correct trigger type', () => {
      expect(handler.triggerType).toBe('form');
    });

    it('should have correct capabilities', () => {
      expect(handler.capabilities.requiresActiveWorkflow).toBe(true);
      expect(handler.capabilities.canPassInputData).toBe(true);
    });
  });

  describe('input validation', () => {
    it('should validate correct form input', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: {
          name: 'John Doe',
          email: 'john@example.com',
        },
      };

      const result = handler.validate(input);
      expect(result).toEqual(input);
    });

    it('should validate minimal input without formData', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
      };

      const result = handler.validate(input);
      expect(result.workflowId).toBe('workflow-123');
      expect(result.triggerType).toBe('form');
      expect(result.formData).toBeUndefined();
    });

    it('should reject invalid trigger type', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
      };

      expect(() => handler.validate(input)).toThrow();
    });

    it('should accept optional fields', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: { field: 'value' },
        data: { extra: 'data' },
        headers: { 'X-Custom': 'header' },
        timeout: 60000,
        waitForResponse: false,
      };

      const result = handler.validate(input);
      expect(result.formData).toEqual({ field: 'value' });
      expect(result.data).toEqual({ extra: 'data' });
      expect(result.headers).toEqual({ 'X-Custom': 'header' });
      expect(result.timeout).toBe(60000);
      expect(result.waitForResponse).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute form with provided formData using multipart/form-data', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          message: 'Hello',
        },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        })
      );
      // Verify FormData is used
      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.data).toBeInstanceOf(FormData);
      // Verify multipart/form-data content type is set via FormData headers
      expect(config.headers).toEqual(
        expect.objectContaining({
          'content-type': expect.stringContaining('multipart/form-data'),
        })
      );
    });

    it('should use form path from trigger info', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: { field: 'value' },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: {
          id: 'form-node',
          name: 'Form',
          type: 'n8n-nodes-base.formTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: { path: 'custom-form' },
        },
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('/form/custom-form'),
        })
      );
    });

    it('should use workflow ID as fallback path', async () => {
      const input = {
        workflowId: 'workflow-456',
        triggerType: 'form' as const,
        formData: { field: 'value' },
      };
      const workflow = createWorkflow();

      await handler.execute(input, workflow);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('/form/workflow-456'),
        })
      );
    });

    it('should merge formData and data with formData taking precedence', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        data: {
          field1: 'from data',
          field2: 'from data',
        },
        formData: {
          field2: 'from formData',
          field3: 'from formData',
        },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      // Verify FormData is used and contains merged data
      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.data).toBeInstanceOf(FormData);
    });

    it('should return error when base URL not available', async () => {
      const handlerNoContext = new FormHandler(mockClient, {} as InstanceContext);

      // Mock getN8nApiConfig to return null
      const { getN8nApiConfig } = await import('../../../../src/config/n8n-api');
      vi.mocked(getN8nApiConfig).mockReturnValue(null as any);

      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
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
        triggerType: 'form' as const,
      };
      const workflow = createWorkflow();

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.error).toContain('SSRF protection');
      expect(response.error).toContain('Private IP address not allowed');
    });

    it('should pass custom headers with multipart/form-data', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: { field: 'value' },
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token',
        },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.headers).toEqual(
        expect.objectContaining({
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token',
          // FormData sets multipart/form-data with boundary
          'content-type': expect.stringContaining('multipart/form-data'),
        })
      );
    });

    it('should use custom timeout when provided', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        timeout: 90000,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 90000,
        })
      );
    });

    it('should use default timeout of 120000ms when waiting for response', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        waitForResponse: true,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 120000,
        })
      );
    });

    it('should use timeout of 30000ms when not waiting for response', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        waitForResponse: false,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should return response with status and metadata', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: { name: 'Test' },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      vi.mocked(axios.request).mockResolvedValue({
        status: 201,
        statusText: 'Created',
        data: { id: 'submission-123', status: 'processed' },
      });

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      expect(response.status).toBe(201);
      expect(response.statusText).toBe('Created');
      expect(response.data).toEqual({ id: 'submission-123', status: 'processed' });
      expect(response.metadata?.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle API errors gracefully', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      const apiError = new Error('Form submission failed');
      vi.mocked(axios.request).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Form submission failed');
    });

    it('should extract execution ID from error response', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      const apiError: any = new Error('Execution error');
      apiError.response = {
        data: {
          id: 'exec-111',
          error: 'Validation failed',
        },
      };
      vi.mocked(axios.request).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(false);
      expect(response.executionId).toBe('exec-111');
      // Details include original error data plus form field info and hint
      expect(response.details).toEqual(
        expect.objectContaining({
          id: 'exec-111',
          error: 'Validation failed',
          formFields: expect.any(Array),
          hint: expect.any(String),
        })
      );
    });

    it('should handle error with code', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      const apiError: any = new Error('Connection timeout');
      apiError.code = 'ECONNABORTED';
      vi.mocked(axios.request).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(false);
      expect(response.code).toBe('ECONNABORTED');
    });

    it('should validate status codes less than 500', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          validateStatus: expect.any(Function),
        })
      );

      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.validateStatus!(200)).toBe(true);
      expect(config.validateStatus!(400)).toBe(true);
      expect(config.validateStatus!(499)).toBe(true);
      expect(config.validateStatus!(500)).toBe(false);
      expect(config.validateStatus!(502)).toBe(false);
    });

    it('should handle empty formData', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: {},
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      // Even empty formData is sent as FormData
      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.data).toBeInstanceOf(FormData);
    });

    it('should handle complex form data types via FormData', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'form' as const,
        formData: {
          name: 'Test User',
          age: 30,
          active: true,
          tags: ['tag1', 'tag2'],
          metadata: { key: 'value' },
        },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      };

      await handler.execute(input, workflow, triggerInfo);

      // Complex data types are serialized in FormData
      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.data).toBeInstanceOf(FormData);
    });

    it('should disable redirect-following on outbound request', async () => {
      const workflow = createWorkflow();
      const input = {
        triggerType: 'form' as const,
        workflowId: workflow.id!,
        formData: { name: 'Alice' },
      };
      const triggerInfo: DetectedTrigger = {
        type: 'form',
        node: workflow.nodes[0],
      } as any;

      await handler.execute(input, workflow, triggerInfo);

      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.maxRedirects).toBe(0);
    });
  });
});
