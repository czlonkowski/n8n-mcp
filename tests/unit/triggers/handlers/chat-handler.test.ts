/**
 * Unit tests for ChatHandler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatHandler } from '../../../../src/triggers/handlers/chat-handler';
import { N8nApiClient } from '../../../../src/services/n8n-api-client';
import { InstanceContext } from '../../../../src/types/instance-context';
import { Workflow } from '../../../../src/types/n8n-api';
import { DetectedTrigger } from '../../../../src/triggers/types';
import axios from 'axios';

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
    validateWebhookUrl: vi.fn(async () => ({ valid: true, reason: '' })),
  },
}));

// Mock buildTriggerUrl
vi.mock('../../../../src/triggers/trigger-detector', () => ({
  buildTriggerUrl: vi.fn((baseUrl: string, trigger: any, mode: string) => {
    return `${baseUrl}/webhook/${trigger.webhookPath}`;
  }),
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
  name: 'Chat Workflow',
  active: true,
  nodes: [
    {
      id: 'chat-node',
      name: 'Chat',
      type: '@n8n/n8n-nodes-langchain.chatTrigger',
      typeVersion: 1,
      position: [0, 0],
      parameters: {
        path: 'ai-chat',
      },
    },
  ],
  connections: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  settings: {},
  staticData: undefined,
} as Workflow);

describe('ChatHandler', () => {
  let mockClient: N8nApiClient;
  let handler: ChatHandler;

  beforeEach(async () => {
    mockClient = createMockClient();
    handler = new ChatHandler(mockClient);
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
      data: { response: 'Chat response' },
    });
  });

  describe('initialization', () => {
    it('should have correct trigger type', () => {
      expect(handler.triggerType).toBe('chat');
    });

    it('should have correct capabilities', () => {
      expect(handler.capabilities.requiresActiveWorkflow).toBe(true);
      expect(handler.capabilities.canPassInputData).toBe(true);
    });
  });

  describe('input validation', () => {
    it('should validate correct chat input', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello AI!',
        sessionId: 'session-123',
      };

      const result = handler.validate(input);
      expect(result).toEqual(input);
    });

    it('should validate minimal input without sessionId', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello AI!',
      };

      const result = handler.validate(input);
      expect(result.workflowId).toBe('workflow-123');
      expect(result.message).toBe('Hello AI!');
      expect(result.sessionId).toBeUndefined();
    });

    it('should reject invalid trigger type', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'webhook',
        message: 'Hello',
      };

      expect(() => handler.validate(input)).toThrow();
    });

    it('should reject missing message', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat',
      };

      expect(() => handler.validate(input)).toThrow();
    });

    it('should accept optional fields', () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
        data: { context: 'value' },
        headers: { 'X-Custom': 'header' },
        timeout: 60000,
        waitForResponse: false,
      };

      const result = handler.validate(input);
      expect(result.data).toEqual({ context: 'value' });
      expect(result.headers).toEqual({ 'X-Custom': 'header' });
      expect(result.timeout).toBe(60000);
      expect(result.waitForResponse).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute chat with provided sessionId', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello AI!',
        sessionId: 'custom-session',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: expect.objectContaining({
            action: 'sendMessage',
            sessionId: 'custom-session',
            chatInput: 'Hello AI!',
          }),
        })
      );
    });

    it('should generate sessionId when not provided', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello AI!',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      // Session IDs are `session_{timestamp}_{UUIDv4}`. UUIDs contain
      // hyphens, so the charset is `[a-f0-9-]`.
      expect(response.metadata?.sessionId).toMatch(/^session_\d+_[a-f0-9-]+$/);
    });

    it('should use trigger info to build chat URL', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello AI!',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'custom-chat',
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('/webhook/custom-chat'),
        })
      );
    });

    it('should use workflow ID as fallback when no trigger info', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello AI!',
      };
      const workflow = createWorkflow();

      await handler.execute(input, workflow);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('/webhook/workflow-123'),
        })
      );
    });

    it('should return error when base URL not available', async () => {
      const handlerNoContext = new ChatHandler(mockClient, {} as InstanceContext);

      // Mock getN8nApiConfig to return null
      const { getN8nApiConfig } = await import('../../../../src/config/n8n-api');
      vi.mocked(getN8nApiConfig).mockReturnValue(null as any);

      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
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
        triggerType: 'chat' as const,
        message: 'Hello',
      };
      const workflow = createWorkflow();

      const response = await handler.execute(input, workflow);

      expect(response.success).toBe(false);
      expect(response.error).toContain('SSRF protection');
      expect(response.error).toContain('Private IP address not allowed');
    });

    it('should include additional data in payload', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
        data: {
          userId: 'user-456',
          context: 'support',
        },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'sendMessage',
            chatInput: 'Hello',
            userId: 'user-456',
            context: 'support',
          }),
        })
      );
    });

    it('should pass custom headers', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token',
        },
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
            'Authorization': 'Bearer token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should use custom timeout when provided', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
        timeout: 90000,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
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
        triggerType: 'chat' as const,
        message: 'Hello',
        waitForResponse: true,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
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
        triggerType: 'chat' as const,
        message: 'Hello',
        waitForResponse: false,
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
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
        triggerType: 'chat' as const,
        message: 'Hello AI!',
        sessionId: 'session-123',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      vi.mocked(axios.request).mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: { response: 'AI reply', tokens: 150 },
      });

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(true);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
      expect(response.data).toEqual({ response: 'AI reply', tokens: 150 });
      expect(response.metadata?.duration).toBeGreaterThanOrEqual(0);
      expect(response.metadata?.sessionId).toBe('session-123');
      expect(response.metadata?.webhookPath).toBe('ai-chat');
    });

    it('should handle API errors gracefully', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      const apiError = new Error('Chat execution failed');
      vi.mocked(axios.request).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Chat execution failed');
    });

    it('should extract execution ID from error response', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      const apiError: any = new Error('Execution error');
      apiError.response = {
        data: {
          executionId: 'exec-789',
          error: 'Node failed',
        },
      };
      vi.mocked(axios.request).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(false);
      expect(response.executionId).toBe('exec-789');
      expect(response.details).toEqual({
        executionId: 'exec-789',
        error: 'Node failed',
      });
    });

    it('should handle error with code', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      const apiError: any = new Error('Timeout error');
      apiError.code = 'ETIMEDOUT';
      vi.mocked(axios.request).mockRejectedValue(apiError);

      const response = await handler.execute(input, workflow, triggerInfo);

      expect(response.success).toBe(false);
      expect(response.code).toBe('ETIMEDOUT');
    });

    it('should validate status codes less than 500', async () => {
      const input = {
        workflowId: 'workflow-123',
        triggerType: 'chat' as const,
        message: 'Hello',
      };
      const workflow = createWorkflow();
      const triggerInfo: DetectedTrigger = {
        type: 'chat',
        node: workflow.nodes[0],
        webhookPath: 'ai-chat',
      };

      await handler.execute(input, workflow, triggerInfo);

      expect(axios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          validateStatus: expect.any(Function),
        })
      );

      const config = vi.mocked(axios.request).mock.calls[0][0];
      expect(config.validateStatus!(200)).toBe(true);
      expect(config.validateStatus!(404)).toBe(true);
      expect(config.validateStatus!(499)).toBe(true);
      expect(config.validateStatus!(500)).toBe(false);
      expect(config.validateStatus!(503)).toBe(false);
    });
  });
});
