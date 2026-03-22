import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { N8nApiClient, N8nApiClientConfig } from '../../../src/services/n8n-api-client';
import { ExecutionStatus } from '../../../src/types/n8n-api';
import {
  N8nApiError,
  N8nAuthenticationError,
  N8nNotFoundError,
  N8nValidationError,
  N8nRateLimitError,
  N8nServerError,
} from '../../../src/utils/n8n-errors';
import * as n8nValidation from '../../../src/services/n8n-validation';
import { logger } from '../../../src/utils/logger';
import * as dns from 'dns/promises';

// Mock DNS module for SSRF protection
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

// Mock dependencies
vi.mock('axios');
vi.mock('../../../src/utils/logger');

// Mock the validation functions
vi.mock('../../../src/services/n8n-validation', () => ({
  cleanWorkflowForCreate: vi.fn((workflow) => workflow),
  cleanWorkflowForUpdate: vi.fn((workflow) => workflow),
}));

// We don't need to mock n8n-errors since we want the actual error transformation to work

describe('N8nApiClient', () => {
  let client: N8nApiClient;
  let mockAxiosInstance: any;
  
  const defaultConfig: N8nApiClientConfig = {
    baseUrl: 'https://n8n.example.com',
    apiKey: 'test-api-key',
    timeout: 30000,
    maxRetries: 3,
  };
  
  // Helper to create a proper axios error
  const createAxiosError = (config: any) => {
    const error = new Error(config.message || 'Request failed') as any;
    error.isAxiosError = true;
    error.config = {};
    if (config.response) {
      error.response = config.response;
    }
    if (config.request) {
      error.request = config.request;
    }
    return error;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock DNS lookup for SSRF protection
    vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
      // Simulate real DNS behavior for test URLs
      if (hostname === 'localhost') {
        return { address: '127.0.0.1', family: 4 } as any;
      }
      // For hostnames that look like IPs, return as-is
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipv4Regex.test(hostname)) {
        return { address: hostname, family: 4 } as any;
      }
      // For real hostnames (like n8n.example.com), return a public IP
      return { address: '8.8.8.8', family: 4 } as any;
    });

    // Create mock axios instance
    mockAxiosInstance = {
      defaults: { baseURL: 'https://n8n.example.com/api/v1' },
      interceptors: {
        request: { use: vi.fn() },
        response: { 
          use: vi.fn((onFulfilled, onRejected) => {
            // Store the interceptor handlers for later use
            mockAxiosInstance._responseInterceptor = { onFulfilled, onRejected };
            return 0;
          }) 
        },
      },
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      _responseInterceptor: null,
    };

    // Mock axios.create to return our mock instance
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { status: 'ok' } });
    
    // Helper function to simulate axios error with interceptor
    mockAxiosInstance.simulateError = async (method: string, errorConfig: any) => {
      const axiosError = createAxiosError(errorConfig);
      
      mockAxiosInstance[method].mockImplementation(async () => {
        if (mockAxiosInstance._responseInterceptor?.onRejected) {
          // Pass error through the interceptor and ensure it's properly handled
          try {
            // The interceptor returns a rejected promise with the transformed error
            const transformedError = await mockAxiosInstance._responseInterceptor.onRejected(axiosError);
            // This shouldn't happen as onRejected should throw
            return Promise.reject(transformedError);
          } catch (error) {
            // This is the expected path - interceptor throws the transformed error
            return Promise.reject(error);
          }
        }
        return Promise.reject(axiosError);
      });
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with default configuration', () => {
      client = new N8nApiClient(defaultConfig);
      
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://n8n.example.com/api/v1',
        timeout: 30000,
        headers: {
          'X-N8N-API-KEY': 'test-api-key',
          'Content-Type': 'application/json',
        },
      });
    });

    it('should handle baseUrl without /api/v1', () => {
      client = new N8nApiClient({
        ...defaultConfig,
        baseUrl: 'https://n8n.example.com/',
      });
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://n8n.example.com/api/v1',
        })
      );
    });

    it('should handle baseUrl with /api/v1', () => {
      client = new N8nApiClient({
        ...defaultConfig,
        baseUrl: 'https://n8n.example.com/api/v1',
      });
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://n8n.example.com/api/v1',
        })
      );
    });

    it('should use custom timeout', () => {
      client = new N8nApiClient({
        ...defaultConfig,
        timeout: 60000,
      });
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should setup request and response interceptors', () => {
      client = new N8nApiClient(defaultConfig);
      
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should check health using healthz endpoint', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      const result = await client.healthCheck();
      
      expect(axios.get).toHaveBeenCalledWith(
        'https://n8n.example.com/healthz',
        {
          timeout: 5000,
          validateStatus: expect.any(Function),
        }
      );
      expect(result).toEqual({ status: 'ok', features: {} });
    });

    it('should fallback to workflow list when healthz fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('healthz not found'));
      mockAxiosInstance.get.mockResolvedValue({ data: [] });

      const result = await client.healthCheck();
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows', { params: { limit: 1 } });
      expect(result).toEqual({ status: 'ok', features: {} });
    });

    it('should throw error when both health checks fail', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('healthz not found'));
      mockAxiosInstance.get.mockRejectedValue(new Error('API error'));

      await expect(client.healthCheck()).rejects.toThrow();
    });
  });

  describe('createWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should create workflow successfully', async () => {
      const workflow = {
        name: 'Test Workflow',
        nodes: [],
        connections: {},
      };
      const createdWorkflow = { ...workflow, id: '123' };
      
      mockAxiosInstance.post.mockResolvedValue({ data: createdWorkflow });
      
      const result = await client.createWorkflow(workflow);
      
      expect(n8nValidation.cleanWorkflowForCreate).toHaveBeenCalledWith(workflow);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows', workflow);
      expect(result).toEqual(createdWorkflow);
    });

    it('should handle creation error', async () => {
      const workflow = { name: 'Test', nodes: [], connections: {} };
      const error = { 
        message: 'Request failed',
        response: { status: 400, data: { message: 'Invalid workflow' } } 
      };
      
      await mockAxiosInstance.simulateError('post', error);
      
      try {
        await client.createWorkflow(workflow);
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toBe('Invalid workflow');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('getWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should get workflow successfully', async () => {
      const workflow = { id: '123', name: 'Test', nodes: [], connections: {} };
      mockAxiosInstance.get.mockResolvedValue({ data: workflow });
      
      const result = await client.getWorkflow('123');
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows/123');
      expect(result).toEqual(workflow);
    });

    it('should handle 404 error', async () => {
      const error = { 
        message: 'Request failed',
        response: { status: 404, data: { message: 'Not found' } } 
      };
      await mockAxiosInstance.simulateError('get', error);
      
      try {
        await client.getWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).message.toLowerCase()).toContain('not found');
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });
  });

  describe('updateWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should update workflow using PUT method', async () => {
      const workflow = { name: 'Updated', nodes: [], connections: {} };
      const updatedWorkflow = { ...workflow, id: '123' };
      
      mockAxiosInstance.put.mockResolvedValue({ data: updatedWorkflow });
      
      const result = await client.updateWorkflow('123', workflow);
      
      expect(n8nValidation.cleanWorkflowForUpdate).toHaveBeenCalledWith(workflow);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/workflows/123', workflow);
      expect(result).toEqual(updatedWorkflow);
    });

    it('should fallback to PATCH when PUT is not supported', async () => {
      const workflow = { name: 'Updated', nodes: [], connections: {} };
      const updatedWorkflow = { ...workflow, id: '123' };
      
      mockAxiosInstance.put.mockRejectedValue({ response: { status: 405 } });
      mockAxiosInstance.patch.mockResolvedValue({ data: updatedWorkflow });
      
      const result = await client.updateWorkflow('123', workflow);
      
      expect(mockAxiosInstance.put).toHaveBeenCalled();
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/workflows/123', workflow);
      expect(result).toEqual(updatedWorkflow);
    });

    it('should handle update error', async () => {
      const workflow = { name: 'Updated', nodes: [], connections: {} };
      const error = { 
        message: 'Request failed',
        response: { status: 400, data: { message: 'Invalid update' } } 
      };
      
      await mockAxiosInstance.simulateError('put', error);
      
      try {
        await client.updateWorkflow('123', workflow);
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toBe('Invalid update');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('deleteWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should delete workflow successfully', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });

      await client.deleteWorkflow('123');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/workflows/123');
    });

    it('should handle deletion error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 404, data: { message: 'Not found' } }
      };
      await mockAxiosInstance.simulateError('delete', error);

      try {
        await client.deleteWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).message.toLowerCase()).toContain('not found');
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });
  });

  describe('activateWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should activate workflow successfully', async () => {
      const workflow = { id: '123', name: 'Test', active: false, nodes: [], connections: {} };
      const activatedWorkflow = { ...workflow, active: true };
      mockAxiosInstance.post.mockResolvedValue({ data: activatedWorkflow });

      const result = await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/activate', {});
      expect(result).toEqual(activatedWorkflow);
      expect(result.active).toBe(true);
    });

    it('should handle activation error - no trigger nodes', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Workflow must have at least one trigger node' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.activateWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toContain('trigger node');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });

    it('should handle activation error - workflow not found', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 404, data: { message: 'Workflow not found' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.activateWorkflow('non-existent');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).message.toLowerCase()).toContain('not found');
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });

    it('should handle activation error - workflow already active', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Workflow is already active' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.activateWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toContain('already active');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });

    it('should handle server error during activation', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 500, data: { message: 'Internal server error' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.activateWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).message).toBe('Internal server error');
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });
  });

  describe('deactivateWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should deactivate workflow successfully', async () => {
      const workflow = { id: '123', name: 'Test', active: true, nodes: [], connections: {} };
      const deactivatedWorkflow = { ...workflow, active: false };
      mockAxiosInstance.post.mockResolvedValue({ data: deactivatedWorkflow });

      const result = await client.deactivateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/deactivate', {});
      expect(result).toEqual(deactivatedWorkflow);
      expect(result.active).toBe(false);
    });

    it('should handle deactivation error - workflow not found', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 404, data: { message: 'Workflow not found' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.deactivateWorkflow('non-existent');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).message.toLowerCase()).toContain('not found');
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });

    it('should handle deactivation error - workflow already inactive', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Workflow is already inactive' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.deactivateWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toContain('already inactive');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });

    it('should handle server error during deactivation', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 500, data: { message: 'Internal server error' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.deactivateWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).message).toBe('Internal server error');
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });

    it('should handle authentication error during deactivation', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 401, data: { message: 'Invalid API key' } }
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.deactivateWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nAuthenticationError);
        expect((err as N8nAuthenticationError).message).toBe('Invalid API key');
        expect((err as N8nAuthenticationError).statusCode).toBe(401);
      }
    });
  });

  describe('listWorkflows', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should list workflows with default params', async () => {
      const response = { data: [], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });
      
      const result = await client.listWorkflows();
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows', { params: {} });
      expect(result).toEqual(response);
    });

    it('should list workflows with custom params', async () => {
      const params = { limit: 10, active: true, tags: 'test,production' };
      const response = { data: [], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });

      const result = await client.listWorkflows(params);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows', { params });
      expect(result).toEqual(response);
    });
  });

  describe('Response Format Validation (PR #367)', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    describe('listWorkflows - validation', () => {
      it('should handle modern format with data and nextCursor', async () => {
        const response = { data: [{ id: '1', name: 'Test' }], nextCursor: 'abc123' };
        mockAxiosInstance.get.mockResolvedValue({ data: response });

        const result = await client.listWorkflows();

        expect(result).toEqual(response);
        expect(result.data).toHaveLength(1);
        expect(result.nextCursor).toBe('abc123');
      });

      it('should wrap legacy array format and log warning', async () => {
        const workflows = [{ id: '1', name: 'Test' }];
        mockAxiosInstance.get.mockResolvedValue({ data: workflows });

        const result = await client.listWorkflows();

        expect(result).toEqual({ data: workflows, nextCursor: null });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('n8n API returned array directly')
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('workflows')
        );
      });

      it('should throw error on null response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: null });

        await expect(client.listWorkflows()).rejects.toThrow(
          'Invalid response from n8n API for workflows: response is not an object'
        );
      });

      it('should throw error on undefined response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: undefined });

        await expect(client.listWorkflows()).rejects.toThrow(
          'Invalid response from n8n API for workflows: response is not an object'
        );
      });

      it('should throw error on string response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: 'invalid' });

        await expect(client.listWorkflows()).rejects.toThrow(
          'Invalid response from n8n API for workflows: response is not an object'
        );
      });

      it('should throw error on number response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: 42 });

        await expect(client.listWorkflows()).rejects.toThrow(
          'Invalid response from n8n API for workflows: response is not an object'
        );
      });

      it('should throw error on invalid structure with different keys', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { items: [], total: 10 } });

        await expect(client.listWorkflows()).rejects.toThrow(
          'Invalid response from n8n API for workflows: expected {data: [], nextCursor?: string}, got object with keys: [items, total]'
        );
      });

      it('should throw error when data is not an array', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { data: 'invalid' } });

        await expect(client.listWorkflows()).rejects.toThrow(
          'Invalid response from n8n API for workflows: expected {data: [], nextCursor?: string}'
        );
      });

      it('should limit exposed keys to first 5 when many keys present', async () => {
        const manyKeys = { items: [], total: 10, page: 1, limit: 20, hasMore: true, metadata: {} };
        mockAxiosInstance.get.mockResolvedValue({ data: manyKeys });

        try {
          await client.listWorkflows();
          expect.fail('Should have thrown error');
        } catch (error: any) {
          expect(error.message).toContain('items, total, page, limit, hasMore...');
          expect(error.message).not.toContain('metadata');
        }
      });
    });

    describe('listExecutions - validation', () => {
      it('should handle modern format with data and nextCursor', async () => {
        const response = { data: [{ id: '1' }], nextCursor: 'abc123' };
        mockAxiosInstance.get.mockResolvedValue({ data: response });

        const result = await client.listExecutions();

        expect(result).toEqual(response);
      });

      it('should wrap legacy array format and log warning', async () => {
        const executions = [{ id: '1' }];
        mockAxiosInstance.get.mockResolvedValue({ data: executions });

        const result = await client.listExecutions();

        expect(result).toEqual({ data: executions, nextCursor: null });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('executions')
        );
      });

      it('should throw error on null response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: null });

        await expect(client.listExecutions()).rejects.toThrow(
          'Invalid response from n8n API for executions: response is not an object'
        );
      });

      it('should throw error on invalid structure', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { items: [] } });

        await expect(client.listExecutions()).rejects.toThrow(
          'Invalid response from n8n API for executions'
        );
      });

      it('should throw error when data is not an array', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { data: 'invalid' } });

        await expect(client.listExecutions()).rejects.toThrow(
          'Invalid response from n8n API for executions'
        );
      });
    });

    describe('listCredentials - validation', () => {
      it('should handle modern format with data and nextCursor', async () => {
        const response = { data: [{ id: '1' }], nextCursor: 'abc123' };
        mockAxiosInstance.get.mockResolvedValue({ data: response });

        const result = await client.listCredentials();

        expect(result).toEqual(response);
      });

      it('should wrap legacy array format and log warning', async () => {
        const credentials = [{ id: '1' }];
        mockAxiosInstance.get.mockResolvedValue({ data: credentials });

        const result = await client.listCredentials();

        expect(result).toEqual({ data: credentials, nextCursor: null });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('credentials')
        );
      });

      it('should throw error on null response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: null });

        await expect(client.listCredentials()).rejects.toThrow(
          'Invalid response from n8n API for credentials: response is not an object'
        );
      });

      it('should throw error on invalid structure', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { items: [] } });

        await expect(client.listCredentials()).rejects.toThrow(
          'Invalid response from n8n API for credentials'
        );
      });

      it('should throw error when data is not an array', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { data: 'invalid' } });

        await expect(client.listCredentials()).rejects.toThrow(
          'Invalid response from n8n API for credentials'
        );
      });
    });

    describe('listTags - validation', () => {
      it('should handle modern format with data and nextCursor', async () => {
        const response = { data: [{ id: '1' }], nextCursor: 'abc123' };
        mockAxiosInstance.get.mockResolvedValue({ data: response });

        const result = await client.listTags();

        expect(result).toEqual(response);
      });

      it('should wrap legacy array format and log warning', async () => {
        const tags = [{ id: '1' }];
        mockAxiosInstance.get.mockResolvedValue({ data: tags });

        const result = await client.listTags();

        expect(result).toEqual({ data: tags, nextCursor: null });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('tags')
        );
      });

      it('should throw error on null response', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: null });

        await expect(client.listTags()).rejects.toThrow(
          'Invalid response from n8n API for tags: response is not an object'
        );
      });

      it('should throw error on invalid structure', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { items: [] } });

        await expect(client.listTags()).rejects.toThrow(
          'Invalid response from n8n API for tags'
        );
      });

      it('should throw error when data is not an array', async () => {
        mockAxiosInstance.get.mockResolvedValue({ data: { data: 'invalid' } });

        await expect(client.listTags()).rejects.toThrow(
          'Invalid response from n8n API for tags'
        );
      });
    });
  });

  describe('getExecution', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should get execution without data', async () => {
      const execution = { id: '123', status: 'success' };
      mockAxiosInstance.get.mockResolvedValue({ data: execution });
      
      const result = await client.getExecution('123');
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/executions/123', {
        params: { includeData: false },
      });
      expect(result).toEqual(execution);
    });

    it('should get execution with data', async () => {
      const execution = { id: '123', status: 'success', data: {} };
      mockAxiosInstance.get.mockResolvedValue({ data: execution });
      
      const result = await client.getExecution('123', true);
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/executions/123', {
        params: { includeData: true },
      });
      expect(result).toEqual(execution);
    });
  });

  describe('listExecutions', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should list executions with filters', async () => {
      const params = { workflowId: '123', status: ExecutionStatus.SUCCESS, limit: 50 };
      const response = { data: [], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });
      
      const result = await client.listExecutions(params);
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/executions', { params });
      expect(result).toEqual(response);
    });
  });

  describe('deleteExecution', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should delete execution successfully', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });
      
      await client.deleteExecution('123');
      
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/executions/123');
    });
  });

  describe('triggerWebhook', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should trigger webhook with GET method', async () => {
      const webhookRequest = {
        webhookUrl: 'https://n8n.example.com/webhook/abc-123',
        httpMethod: 'GET' as const,
        data: { key: 'value' },
        waitForResponse: true,
      };
      
      const response = {
        status: 200,
        statusText: 'OK',
        data: { result: 'success' },
        headers: {},
      };
      
      vi.mocked(axios.create).mockReturnValue({
        request: vi.fn().mockResolvedValue(response),
      } as any);
      
      const result = await client.triggerWebhook(webhookRequest);
      
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://n8n.example.com/',
        validateStatus: expect.any(Function),
      });
      
      expect(result).toEqual(response);
    });

    it('should trigger webhook with POST method', async () => {
      const webhookRequest = {
        webhookUrl: 'https://n8n.example.com/webhook/abc-123',
        httpMethod: 'POST' as const,
        data: { key: 'value' },
        headers: { 'Custom-Header': 'test' },
        waitForResponse: false,
      };
      
      const response = {
        status: 201,
        statusText: 'Created',
        data: { id: '456' },
        headers: {},
      };
      
      const mockWebhookClient = {
        request: vi.fn().mockResolvedValue(response),
      };
      
      vi.mocked(axios.create).mockReturnValue(mockWebhookClient as any);
      
      const result = await client.triggerWebhook(webhookRequest);
      
      expect(mockWebhookClient.request).toHaveBeenCalledWith({
        method: 'POST',
        url: '/webhook/abc-123',
        headers: {
          'Custom-Header': 'test',
          'X-N8N-API-KEY': undefined,
        },
        data: { key: 'value' },
        params: undefined,
        timeout: 30000,
      });
      
      expect(result).toEqual(response);
    });

    it('should handle webhook trigger error', async () => {
      const webhookRequest = {
        webhookUrl: 'https://n8n.example.com/webhook/abc-123',
        httpMethod: 'POST' as const,
        data: {},
      };
      
      vi.mocked(axios.create).mockReturnValue({
        request: vi.fn().mockRejectedValue(new Error('Webhook failed')),
      } as any);
      
      await expect(client.triggerWebhook(webhookRequest)).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should handle authentication error (401)', async () => {
      const error = { 
        message: 'Request failed',
        response: { 
          status: 401, 
          data: { message: 'Invalid API key' } 
        } 
      };
      await mockAxiosInstance.simulateError('get', error);
      
      try {
        await client.getWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nAuthenticationError);
        expect((err as N8nAuthenticationError).message).toBe('Invalid API key');
        expect((err as N8nAuthenticationError).statusCode).toBe(401);
      }
    });

    it('should handle rate limit error (429)', async () => {
      const error = { 
        message: 'Request failed',
        response: { 
          status: 429, 
          data: { message: 'Rate limit exceeded' },
          headers: { 'retry-after': '60' }
        } 
      };
      await mockAxiosInstance.simulateError('get', error);
      
      try {
        await client.getWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nRateLimitError);
        expect((err as N8nRateLimitError).message).toContain('Rate limit exceeded');
        expect((err as N8nRateLimitError).statusCode).toBe(429);
        expect(((err as N8nRateLimitError).details as any)?.retryAfter).toBe(60);
      }
    });

    it('should handle server error (500)', async () => {
      const error = { 
        message: 'Request failed',
        response: { 
          status: 500, 
          data: { message: 'Internal server error' } 
        } 
      };
      await mockAxiosInstance.simulateError('get', error);
      
      try {
        await client.getWorkflow('123');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).message).toBe('Internal server error');
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });

    it('should handle network error', async () => {
      const error = { 
        message: 'Network error',
        request: {} 
      };
      await mockAxiosInstance.simulateError('get', error);
      
      await expect(client.getWorkflow('123')).rejects.toThrow(N8nApiError);
    });
  });

  describe('credential management', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should list credentials', async () => {
      const response = { data: [], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });
      
      const result = await client.listCredentials({ limit: 10 });
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/credentials', { 
        params: { limit: 10 } 
      });
      expect(result).toEqual(response);
    });

    it('should get credential', async () => {
      const credential = { id: '123', name: 'Test Credential' };
      mockAxiosInstance.get.mockResolvedValue({ data: credential });
      
      const result = await client.getCredential('123');
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/credentials/123');
      expect(result).toEqual(credential);
    });

    it('should create credential', async () => {
      const credential = { name: 'New Credential', type: 'httpHeader' };
      const created = { ...credential, id: '123' };
      mockAxiosInstance.post.mockResolvedValue({ data: created });
      
      const result = await client.createCredential(credential);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/credentials', credential);
      expect(result).toEqual(created);
    });

    it('should update credential', async () => {
      const updates = { name: 'Updated Credential' };
      const updated = { id: '123', ...updates };
      mockAxiosInstance.patch.mockResolvedValue({ data: updated });
      
      const result = await client.updateCredential('123', updates);
      
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/credentials/123', updates);
      expect(result).toEqual(updated);
    });

    it('should delete credential', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });
      
      await client.deleteCredential('123');
      
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/credentials/123');
    });
  });

  describe('tag management', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should list tags', async () => {
      const response = { data: [], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });
      
      const result = await client.listTags();
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/tags', { params: {} });
      expect(result).toEqual(response);
    });

    it('should create tag', async () => {
      const tag = { name: 'New Tag' };
      const created = { ...tag, id: '123' };
      mockAxiosInstance.post.mockResolvedValue({ data: created });
      
      const result = await client.createTag(tag);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/tags', tag);
      expect(result).toEqual(created);
    });

    it('should update tag', async () => {
      const updates = { name: 'Updated Tag' };
      const updated = { id: '123', ...updates };
      mockAxiosInstance.patch.mockResolvedValue({ data: updated });
      
      const result = await client.updateTag('123', updates);
      
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/tags/123', updates);
      expect(result).toEqual(updated);
    });

    it('should delete tag', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });
      
      await client.deleteTag('123');
      
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/tags/123');
    });
  });

  describe('source control management', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should get source control status', async () => {
      const status = { connected: true, branch: 'main' };
      mockAxiosInstance.get.mockResolvedValue({ data: status });
      
      const result = await client.getSourceControlStatus();
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/source-control/status');
      expect(result).toEqual(status);
    });

    it('should pull source control changes', async () => {
      const pullResult = { pulled: 5, conflicts: 0 };
      mockAxiosInstance.post.mockResolvedValue({ data: pullResult });
      
      const result = await client.pullSourceControl(true);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/source-control/pull', { 
        force: true 
      });
      expect(result).toEqual(pullResult);
    });

    it('should push source control changes', async () => {
      const pushResult = { pushed: 3 };
      mockAxiosInstance.post.mockResolvedValue({ data: pushResult });
      
      const result = await client.pushSourceControl('Update workflows', ['workflow1.json']);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/source-control/push', {
        message: 'Update workflows',
        fileNames: ['workflow1.json'],
      });
      expect(result).toEqual(pushResult);
    });
  });

  describe('variable management', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should get variables', async () => {
      const variables = [{ id: '1', key: 'VAR1', value: 'value1' }];
      mockAxiosInstance.get.mockResolvedValue({ data: { data: variables } });
      
      const result = await client.getVariables();
      
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/variables');
      expect(result).toEqual(variables);
    });

    it('should return empty array when variables API not available', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));
      
      const result = await client.getVariables();
      
      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Variables API not available, returning empty array'
      );
    });

    it('should create variable', async () => {
      const variable = { key: 'NEW_VAR', value: 'new value' };
      const created = { ...variable, id: '123' };
      mockAxiosInstance.post.mockResolvedValue({ data: created });
      
      const result = await client.createVariable(variable);
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/variables', variable);
      expect(result).toEqual(created);
    });

    it('should update variable', async () => {
      const updates = { value: 'updated value' };
      const updated = { id: '123', key: 'VAR1', ...updates };
      mockAxiosInstance.patch.mockResolvedValue({ data: updated });
      
      const result = await client.updateVariable('123', updates);
      
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/variables/123', updates);
      expect(result).toEqual(updated);
    });

    it('should delete variable', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });
      
      await client.deleteVariable('123');
      
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/variables/123');
    });
  });

  describe('transferWorkflow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should transfer workflow successfully via PUT', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: undefined });

      await client.transferWorkflow('123', 'project-456');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/workflows/123/transfer',
        { destinationProjectId: 'project-456' }
      );
    });

    it('should throw N8nNotFoundError on 404', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 404, data: { message: 'Workflow not found' } }
      };
      await mockAxiosInstance.simulateError('put', error);

      try {
        await client.transferWorkflow('123', 'project-456');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).message.toLowerCase()).toContain('not found');
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });

    it('should throw appropriate error on 403 forbidden', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 403, data: { message: 'Forbidden' } }
      };
      await mockAxiosInstance.simulateError('put', error);

      try {
        await client.transferWorkflow('123', 'project-456');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nApiError);
        expect((err as N8nApiError).statusCode).toBe(403);
      }
    });
  });

  describe('createDataTable', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should create data table with name and columns', async () => {
      const params = {
        name: 'My Table',
        columns: [
          { name: 'email', type: 'string' as const },
          { name: 'count', type: 'number' as const },
        ],
      };
      const createdTable = { id: 'dt-1', name: 'My Table', columns: [] };

      mockAxiosInstance.post.mockResolvedValue({ data: createdTable });

      const result = await client.createDataTable(params);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/data-tables', params);
      expect(result).toEqual(createdTable);
    });

    it('should create data table without columns', async () => {
      const params = { name: 'Empty Table' };
      const createdTable = { id: 'dt-2', name: 'Empty Table' };

      mockAxiosInstance.post.mockResolvedValue({ data: createdTable });

      const result = await client.createDataTable(params);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/data-tables', params);
      expect(result).toEqual(createdTable);
    });

    it('should handle 400 error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Invalid table name' } },
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.createDataTable({ name: '' });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toBe('Invalid table name');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('listDataTables', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should list data tables successfully', async () => {
      const response = { data: [{ id: 'dt-1', name: 'Table One' }], nextCursor: 'abc' };
      mockAxiosInstance.get.mockResolvedValue({ data: response });

      const result = await client.listDataTables({ limit: 10, cursor: 'xyz' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/data-tables', { params: { limit: 10, cursor: 'xyz' } });
      expect(result).toEqual(response);
    });

    it('should handle error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 500, data: { message: 'Internal server error' } },
      };
      await mockAxiosInstance.simulateError('get', error);

      try {
        await client.listDataTables();
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });
  });

  describe('getDataTable', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should get data table successfully', async () => {
      const table = { id: 'dt-1', name: 'My Table', columns: [] };
      mockAxiosInstance.get.mockResolvedValue({ data: table });

      const result = await client.getDataTable('dt-1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/data-tables/dt-1');
      expect(result).toEqual(table);
    });

    it('should handle 404 error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 404, data: { message: 'Data table not found' } },
      };
      await mockAxiosInstance.simulateError('get', error);

      try {
        await client.getDataTable('dt-nonexistent');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });
  });

  describe('updateDataTable', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should update data table successfully', async () => {
      const updated = { id: 'dt-1', name: 'Renamed' };
      mockAxiosInstance.patch.mockResolvedValue({ data: updated });

      const result = await client.updateDataTable('dt-1', { name: 'Renamed' });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/data-tables/dt-1', { name: 'Renamed' });
      expect(result).toEqual(updated);
    });

    it('should handle error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Invalid name' } },
      };
      await mockAxiosInstance.simulateError('patch', error);

      try {
        await client.updateDataTable('dt-1', { name: '' });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('deleteDataTable', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should delete data table successfully', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: {} });

      await client.deleteDataTable('dt-1');

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/data-tables/dt-1');
    });

    it('should handle 404 error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 404, data: { message: 'Data table not found' } },
      };
      await mockAxiosInstance.simulateError('delete', error);

      try {
        await client.deleteDataTable('dt-nonexistent');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nNotFoundError);
        expect((err as N8nNotFoundError).statusCode).toBe(404);
      }
    });
  });

  describe('getDataTableRows', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should get data table rows with params', async () => {
      const response = { data: [{ id: 1, email: 'a@b.com' }], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });

      const params = { limit: 50, sortBy: 'email:asc', search: 'john' };
      const result = await client.getDataTableRows('dt-1', params);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/data-tables/dt-1/rows', expect.objectContaining({ params }));
      expect(result).toEqual(response);
    });

    it('should handle error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 500, data: { message: 'Internal server error' } },
      };
      await mockAxiosInstance.simulateError('get', error);

      try {
        await client.getDataTableRows('dt-1');
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });
  });

  describe('insertDataTableRows', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should insert data table rows successfully', async () => {
      const insertResult = { insertedCount: 2 };
      mockAxiosInstance.post.mockResolvedValue({ data: insertResult });

      const params = { data: [{ email: 'a@b.com' }, { email: 'c@d.com' }], returnType: 'count' as const };
      const result = await client.insertDataTableRows('dt-1', params);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/data-tables/dt-1/rows', params);
      expect(result).toEqual(insertResult);
    });

    it('should handle 400 error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Invalid row data' } },
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.insertDataTableRows('dt-1', { data: [{}] });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).message).toBe('Invalid row data');
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('updateDataTableRows', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should update data table rows successfully', async () => {
      const updateResult = { updatedCount: 3 };
      mockAxiosInstance.patch.mockResolvedValue({ data: updateResult });

      const params = {
        filter: { type: 'and' as const, filters: [{ columnName: 'status', condition: 'eq' as const, value: 'old' }] },
        data: { status: 'new' },
      };
      const result = await client.updateDataTableRows('dt-1', params);

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/data-tables/dt-1/rows/update', params);
      expect(result).toEqual(updateResult);
    });

    it('should handle error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 500, data: { message: 'Internal server error' } },
      };
      await mockAxiosInstance.simulateError('patch', error);

      try {
        await client.updateDataTableRows('dt-1', {
          filter: { type: 'and', filters: [{ columnName: 'id', condition: 'eq', value: 1 }] },
          data: { name: 'test' },
        });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });
  });

  describe('upsertDataTableRow', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should upsert data table row successfully', async () => {
      const upsertResult = { action: 'updated', row: { id: 1, email: 'a@b.com' } };
      mockAxiosInstance.post.mockResolvedValue({ data: upsertResult });

      const params = {
        filter: { type: 'and' as const, filters: [{ columnName: 'email', condition: 'eq' as const, value: 'a@b.com' }] },
        data: { score: 15 },
      };
      const result = await client.upsertDataTableRow('dt-1', params);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/data-tables/dt-1/rows/upsert', params);
      expect(result).toEqual(upsertResult);
    });

    it('should handle error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 400, data: { message: 'Invalid upsert params' } },
      };
      await mockAxiosInstance.simulateError('post', error);

      try {
        await client.upsertDataTableRow('dt-1', {
          filter: { type: 'and', filters: [{ columnName: 'id', condition: 'eq', value: 1 }] },
          data: { name: 'test' },
        });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nValidationError);
        expect((err as N8nValidationError).statusCode).toBe(400);
      }
    });
  });

  describe('deleteDataTableRows', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should delete data table rows successfully', async () => {
      const deleteResult = { deletedCount: 2 };
      mockAxiosInstance.delete.mockResolvedValue({ data: deleteResult });

      const params = { filter: '{"type":"and","filters":[]}', dryRun: false };
      const result = await client.deleteDataTableRows('dt-1', params);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/data-tables/dt-1/rows/delete', expect.objectContaining({ params }));
      expect(result).toEqual(deleteResult);
    });

    it('should handle error', async () => {
      const error = {
        message: 'Request failed',
        response: { status: 500, data: { message: 'Internal server error' } },
      };
      await mockAxiosInstance.simulateError('delete', error);

      try {
        await client.deleteDataTableRows('dt-1', { filter: '{}' });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeInstanceOf(N8nServerError);
        expect((err as N8nServerError).statusCode).toBe(500);
      }
    });
  });

  describe('interceptors', () => {
    let requestInterceptor: any;
    let responseInterceptor: any;
    let responseErrorInterceptor: any;

    beforeEach(() => {
      // Capture the interceptor functions
      vi.mocked(mockAxiosInstance.interceptors.request.use).mockImplementation((onFulfilled: any) => {
        requestInterceptor = onFulfilled;
        return 0;
      });
      
      vi.mocked(mockAxiosInstance.interceptors.response.use).mockImplementation((onFulfilled: any, onRejected: any) => {
        responseInterceptor = onFulfilled;
        responseErrorInterceptor = onRejected;
        return 0;
      });
      
      client = new N8nApiClient(defaultConfig);
    });

    it('should log requests', () => {
      const config = { 
        method: 'get', 
        url: '/workflows',
        params: { limit: 10 },
        data: undefined,
      };
      
      const result = requestInterceptor(config);
      
      expect(logger.debug).toHaveBeenCalledWith(
        'n8n API Request: GET /workflows',
        { params: { limit: 10 }, data: undefined }
      );
      expect(result).toBe(config);
    });

    it('should log successful responses', () => {
      const response = {
        status: 200,
        config: { url: '/workflows' },
        data: [],
      };
      
      const result = responseInterceptor(response);
      
      expect(logger.debug).toHaveBeenCalledWith(
        'n8n API Response: 200 /workflows'
      );
      expect(result).toBe(response);
    });

    it('should handle response errors', async () => {
      const error = new Error('Request failed');
      Object.assign(error, {
        response: {
          status: 400,
          data: { message: 'Bad request' },
        },
      });
      
      const result = await responseErrorInterceptor(error).catch((e: any) => e);
      expect(result).toBeInstanceOf(N8nValidationError);
      expect(result.message).toBe('Bad request');
    });
  });
});
