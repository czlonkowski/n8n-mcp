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
import { clearVersionCache, parseVersion } from '../../../src/services/n8n-version';
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
    
    // Route a sequence of outcomes through the real response interceptor, so callers see the
    // N8nApiError the interceptor produces rather than a raw axios error. Needed for fallbacks
    // that branch on the status of the first failure.
    mockAxiosInstance.simulateSequence = (method: string, outcomes: any[]) => {
      let call = 0;
      mockAxiosInstance[method].mockImplementation(async () => {
        const outcome = outcomes[Math.min(call++, outcomes.length - 1)];
        if (!outcome.error) return { data: outcome.data, headers: outcome.headers ?? {} };
        const axiosError = createAxiosError(outcome.error);
        try {
          return Promise.reject(
            await mockAxiosInstance._responseInterceptor.onRejected(axiosError)
          );
        } catch (transformed) {
          return Promise.reject(transformed);
        }
      });
    };

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

      expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
        baseURL: 'https://n8n.example.com/api/v1',
        timeout: 30000,
        headers: {
          'X-N8N-API-KEY': 'test-api-key',
          'Content-Type': 'application/json',
        },
        // SECURITY (GHSA-cmrh-wvq6-wm9r): no redirect-following on the
        // authenticated client.
        maxRedirects: 0,
      }));
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

  describe('Cloudflare Access headers', () => {
    const cfConfig: N8nApiClientConfig = {
      ...defaultConfig,
      cfClientId: 'cf-id',
      cfClientSecret: 'cf-secret',
    };

    beforeEach(() => {
      // fetchN8nVersion caches per baseUrl at module scope; clear between tests
      // so each getVersion() actually issues a request we can assert on.
      clearVersionCache();
    });

    it('injects CF headers into the authenticated API client when configured', () => {
      client = new N8nApiClient(cfConfig);

      expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
        headers: {
          'X-N8N-API-KEY': 'test-api-key',
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': 'cf-id',
          'CF-Access-Client-Secret': 'cf-secret',
        },
      }));
    });

    it('omits CF headers from the API client when not configured', () => {
      client = new N8nApiClient(defaultConfig);

      const createConfig = vi.mocked(axios.create).mock.calls[0][0] as any;
      expect(createConfig.headers).not.toHaveProperty('CF-Access-Client-Id');
      expect(createConfig.headers).not.toHaveProperty('CF-Access-Client-Secret');
    });

    it('injects only the CF client id when secret is absent', () => {
      client = new N8nApiClient({ ...defaultConfig, cfClientId: 'cf-id' });

      const createConfig = vi.mocked(axios.create).mock.calls[0][0] as any;
      expect(createConfig.headers['CF-Access-Client-Id']).toBe('cf-id');
      expect(createConfig.headers).not.toHaveProperty('CF-Access-Client-Secret');
    });

    it('forwards CF headers and pinned agents to the version probe', async () => {
      client = new N8nApiClient(cfConfig);
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: { data: { n8nVersion: '1.119.0' } },
      });

      const version = await client.getVersion();

      expect(version).toEqual({ version: '1.119.0', major: 1, minor: 119, patch: 0 });
      expect(axios.get).toHaveBeenCalledWith(
        'https://n8n.example.com/rest/settings',
        expect.objectContaining({
          headers: {
            'CF-Access-Client-Id': 'cf-id',
            'CF-Access-Client-Secret': 'cf-secret',
          },
          // SECURITY (GHSA-cmrh-wvq6-wm9r): version probe stays pinned.
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
          maxRedirects: 0,
        })
      );
    });

    it('sends no CF headers to the version probe when not configured', async () => {
      client = new N8nApiClient(defaultConfig);
      vi.mocked(axios.get).mockResolvedValue({
        status: 200,
        data: { data: { n8nVersion: '1.119.0' } },
      });

      await client.getVersion();

      expect(axios.get).toHaveBeenCalledWith(
        'https://n8n.example.com/rest/settings',
        expect.objectContaining({ headers: undefined })
      );
    });

    it('injects CF headers into webhook executions when configured', async () => {
      client = new N8nApiClient(cfConfig);
      const mockWebhookClient = {
        request: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', data: {}, headers: {} }),
      };
      vi.mocked(axios.create).mockReturnValue(mockWebhookClient as any);

      await client.triggerWebhook({
        webhookUrl: 'https://n8n.example.com/webhook/abc-123',
        httpMethod: 'POST',
        data: { key: 'value' },
        waitForResponse: false,
      });

      expect(mockWebhookClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'CF-Access-Client-Id': 'cf-id',
            'CF-Access-Client-Secret': 'cf-secret',
            // API key is never forwarded to webhook endpoints.
            'X-N8N-API-KEY': undefined,
          }),
        })
      );
    });

    it('omits CF headers from webhook executions when not configured', async () => {
      client = new N8nApiClient(defaultConfig);
      const mockWebhookClient = {
        request: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', data: {}, headers: {} }),
      };
      vi.mocked(axios.create).mockReturnValue(mockWebhookClient as any);

      await client.triggerWebhook({
        webhookUrl: 'https://n8n.example.com/webhook/abc-123',
        httpMethod: 'POST',
        data: { key: 'value' },
        waitForResponse: false,
      });

      const requestConfig = mockWebhookClient.request.mock.calls[0][0] as any;
      expect(requestConfig.headers).not.toHaveProperty('CF-Access-Client-Id');
      expect(requestConfig.headers).not.toHaveProperty('CF-Access-Client-Secret');
    });

    it('never forwards CF headers to a webhook on a different origin', async () => {
      // SECURITY: the CF service token must not leak to a host supplied via
      // webhookUrl that differs from the configured n8n instance origin.
      client = new N8nApiClient(cfConfig);
      const mockWebhookClient = {
        request: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', data: {}, headers: {} }),
      };
      vi.mocked(axios.create).mockReturnValue(mockWebhookClient as any);

      await client.triggerWebhook({
        webhookUrl: 'https://evil.example.com/webhook/abc-123',
        httpMethod: 'POST',
        data: { key: 'value' },
        waitForResponse: false,
      });

      const requestConfig = mockWebhookClient.request.mock.calls[0][0] as any;
      expect(requestConfig.headers).not.toHaveProperty('CF-Access-Client-Id');
      expect(requestConfig.headers).not.toHaveProperty('CF-Access-Client-Secret');
    });

    it('forwards CF headers to the healthz probe when configured', async () => {
      client = new N8nApiClient(cfConfig);
      vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { status: 'ok' } });

      await client.healthCheck();

      expect(axios.get).toHaveBeenCalledWith(
        'https://n8n.example.com/healthz',
        expect.objectContaining({
          headers: {
            'CF-Access-Client-Id': 'cf-id',
            'CF-Access-Client-Secret': 'cf-secret',
          },
        })
      );
    });

    // Instance origin is https://n8n.example.com. The gate must fail closed on a
    // divergent port/scheme and normalize host case.
    it.each([
      ['https://n8n.example.com:8443/webhook/abc', false], // different port -> withheld
      ['https://N8N.EXAMPLE.COM/webhook/abc', true],       // uppercase host -> origin-normalized, forwarded
    ])('origin gate for %s forwards CF headers = %s', async (webhookUrl, shouldForward) => {
      client = new N8nApiClient(cfConfig);
      const mockWebhookClient = {
        request: vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', data: {}, headers: {} }),
      };
      vi.mocked(axios.create).mockReturnValue(mockWebhookClient as any);

      await client.triggerWebhook({
        webhookUrl,
        httpMethod: 'POST',
        data: { key: 'value' },
        waitForResponse: false,
      });

      const requestConfig = mockWebhookClient.request.mock.calls[0][0] as any;
      if (shouldForward) {
        expect(requestConfig.headers['CF-Access-Client-Id']).toBe('cf-id');
        expect(requestConfig.headers['CF-Access-Client-Secret']).toBe('cf-secret');
      } else {
        expect(requestConfig.headers).not.toHaveProperty('CF-Access-Client-Id');
        expect(requestConfig.headers).not.toHaveProperty('CF-Access-Client-Secret');
      }
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
        expect.objectContaining({
          timeout: 5000,
          validateStatus: expect.any(Function),
          maxRedirects: 0,
          // SECURITY (GHSA-cmrh-wvq6-wm9r): pinned transport agents.
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        })
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

    it('should fallback to PATCH when the 405 arrives through the response interceptor', async () => {
      // The interceptor rewrites every rejection into an N8nApiError, which carries statusCode
      // and no response. A fallback reading error.response.status never fires in production.
      const workflow = { name: 'Updated', nodes: [], connections: {} };
      const updatedWorkflow = { ...workflow, id: '123' };

      await mockAxiosInstance.simulateError('put', {
        response: { status: 405, data: { message: 'Method Not Allowed' } }
      });
      mockAxiosInstance.patch.mockResolvedValue({ data: updatedWorkflow });

      const result = await client.updateWorkflow('123', workflow);

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

  describe('canvas groups (nodeGroups)', () => {
    // n8n validates canvas groups on every write, including writes unrelated to grouping, and
    // names the group it rejects. These cover the degradation ladder that keeps an unrelated edit
    // from failing because of a frame — and the guarantee that a group the caller just asked for
    // is never silently thrown away.
    const groupedWorkflow = (nodeGroups: any[]) => ({
      name: 'Grouped',
      nodes: [
        { id: 'a', name: 'Set A', type: 'n8n-nodes-base.set', typeVersion: 1, position: [0, 0] as [number, number], parameters: {} },
        { id: 'b', name: 'Set B', type: 'n8n-nodes-base.set', typeVersion: 1, position: [1, 0] as [number, number], parameters: {} },
      ],
      connections: {},
      nodeGroups,
    });

    const badRequest = (message: string, data?: unknown) =>
      createAxiosError({ message, response: { status: 400, data: data ?? { message } } });

    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('forwards groups on update', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a', 'b'] }]);
      mockAxiosInstance.put.mockResolvedValue({ data: { ...workflow, id: '123' } });

      await client.updateWorkflow('123', workflow);

      expect(mockAxiosInstance.put.mock.calls[0][1].nodeGroups).toEqual([
        { id: 'g1', name: 'Transform', nodeIds: ['a', 'b'] },
      ]);
    });

    it('prunes members that no longer exist before writing, and says so', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a', 'b', 'deleted'] }]);
      mockAxiosInstance.put.mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) });

      expect(mockAxiosInstance.put.mock.calls[0][1].nodeGroups[0].nodeIds).toEqual(['a', 'b']);
      expect(warnings.join(' ')).toContain('Transform');
    });

    it('omits the field and warns when the instance predates canvas groups (n8n < 2.28)', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('request/body must NOT have additional properties'))
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) });

      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.put.mock.calls[1][1]).not.toHaveProperty('nodeGroups');
      expect(warnings.join(' ')).toContain('does not support canvas groups');
    });

    it('remembers that an instance rejects the field, so the next write skips it', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('request/body must NOT have additional properties'))
        .mockResolvedValue({ data: { id: '123' } });

      await client.updateWorkflow('123', workflow);
      await client.updateWorkflow('123', workflow);

      // 2 for the first call (reject + retry), 1 for the second: no repeat probe.
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.put.mock.calls[2][1]).not.toHaveProperty('nodeGroups');
    });

    it('keeps warning on later writes once the instance is known not to support groups', async () => {
      // The client outlives a request. Warning only on the write that discovered the limit would
      // let a caller author a brand-new grouping later in the session, get plain success, and no
      // group — silently losing what they explicitly asked for.
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('request/body must NOT have additional properties'))
        .mockResolvedValue({ data: { id: '123' } });

      await client.updateWorkflow('123', workflow);

      const laterWarnings: string[] = [];
      await client.updateWorkflow('123', groupedWorkflow([{ id: 'g2', name: 'Authored now', nodeIds: ['b'] }]), {
        authoredGroups: new Set(['Authored now']),
        onWarning: w => laterWarnings.push(w),
      });

      expect(laterWarnings.join(' ')).toContain('does not support canvas groups');
    });

    it('keeps warning about dropped descriptions on later writes, but only when one was sent', async () => {
      const withDescription = groupedWorkflow([
        { id: 'g1', name: 'Transform', nodeIds: ['a'], description: 'cleans records' },
      ]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(
badRequest('request/body/nodeGroups/0 must NOT have additional properties')
        )
        .mockResolvedValue({ data: { id: '123' } });

      await client.updateWorkflow('123', withDescription);

      const second: string[] = [];
      await client.updateWorkflow('123', withDescription, { onWarning: w => second.push(w) });
      expect(second.join(' ')).toContain('descriptions');

      const third: string[] = [];
      await client.updateWorkflow('123', groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]), {
        onWarning: w => third.push(w),
      });
      expect(third).toEqual([]);
    });

    it('strips descriptions but keeps the groups when the instance predates them (n8n < 2.32)', async () => {
      const workflow = groupedWorkflow([
        { id: 'g1', name: 'Transform', nodeIds: ['a'], description: 'cleans records' },
      ]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(
badRequest('request/body/nodeGroups/0 must NOT have additional properties')
        )
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) });

      const retried = mockAxiosInstance.put.mock.calls[1][1];
      expect(retried.nodeGroups).toEqual([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      expect(warnings.join(' ')).toContain('descriptions');
    });

    it('ungroups only the group n8n named, and keeps the others', async () => {
      const workflow = groupedWorkflow([
        { id: 'g1', name: 'Broken', nodeIds: ['a'] },
        { id: 'g2', name: 'Fine', nodeIds: ['b'] },
      ]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(
          badRequest('Node group "Broken" (g1) must form a single connected subgraph with a single entry and exit.')
        )
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) });

      expect(mockAxiosInstance.put.mock.calls[1][1].nodeGroups).toEqual([
        { id: 'g2', name: 'Fine', nodeIds: ['b'] },
      ]);
      expect(warnings.join(' ')).toContain('Broken');
    });

    it('does not remember a semantic rejection as "unsupported"', async () => {
      // One invalid group must not disable canvas groups for the whole instance.
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Broken', nodeIds: ['a'] }]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('Group "Broken" references node ID "x" that does not exist in the workflow.'))
        .mockResolvedValue({ data: { id: '123' } });

      await client.updateWorkflow('123', workflow);
      await client.updateWorkflow('123', groupedWorkflow([{ id: 'g2', name: 'Fine', nodeIds: ['b'] }]));

      expect(mockAxiosInstance.put.mock.calls[2][1].nodeGroups).toEqual([
        { id: 'g2', name: 'Fine', nodeIds: ['b'] },
      ]);
    });

    it('surfaces the rejection instead of ungrouping when the caller authored that group', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Mine', nodeIds: ['a'] }]);
      mockAxiosInstance.put.mockRejectedValue(
        badRequest('Node group "Mine" (g1) must form a single connected subgraph with a single entry and exit.')
      );

      await expect(
        client.updateWorkflow('123', workflow, { authoredGroups: new Set(['Mine']) })
      ).rejects.toThrow(/single connected subgraph/);

      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
    });

    it('removes all groups as a last resort when n8n names none of them', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('Invalid nodeGroups payload'))
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) });

      expect(mockAxiosInstance.put.mock.calls[1][1].nodeGroups).toEqual([]);
      expect(warnings.join(' ')).toContain('all of them were removed');
    });

    it('keeps an authored group when n8n rejects the set without naming one', async () => {
      // Last resort used to be all-or-nothing. Dropping only the inherited groups saves the write
      // without destroying what the caller explicitly asked for.
      const workflow = groupedWorkflow([
        { id: 'g1', name: 'Inherited', nodeIds: ['a'] },
        { id: 'g2', name: 'Mine', nodeIds: ['b'] },
      ]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('Invalid nodeGroups payload'))
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, {
        authoredGroups: new Set(['Mine']),
        onWarning: w => warnings.push(w),
      });

      expect(mockAxiosInstance.put.mock.calls[1][1].nodeGroups).toEqual([
        { id: 'g2', name: 'Mine', nodeIds: ['b'] },
      ]);
      expect(warnings.join(' ')).toContain('the ones it did not ask about were');
    });

    it('surfaces the error rather than guessing when n8n names a group it does not hold', async () => {
      // A group name containing a quote truncates n8n's name capture. Destroying every other group
      // to recover from an unmatched name would be worse than failing.
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Keep me', nodeIds: ['a'] }]);
      mockAxiosInstance.put.mockRejectedValue(
        badRequest('Group "Say "hi"" references node ID "x" that does not exist in the workflow.')
      );

      await expect(client.updateWorkflow('123', workflow)).rejects.toThrow(/does not exist/);
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
    });

    it('rejects an authored group whose member is not in the workflow', async () => {
      // Repair prunes stale members for inherited groups, but for one the caller just authored the
      // missing node is a mistake in the request — n8n would have said the same.
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Mine', nodeIds: ['a', 'typo'] }]);
      mockAxiosInstance.put.mockResolvedValue({ data: { id: '123' } });

      await expect(
        client.updateWorkflow('123', workflow, { authoredGroups: new Set(['Mine']) })
      ).rejects.toThrow(/"typo"/);

      expect(mockAxiosInstance.put).not.toHaveBeenCalled();
    });

    it('does not record the field as unsupported when dropping it does not help', async () => {
      // n8n cannot say WHICH unknown property it rejected, so the retry is the experiment: if the
      // write still fails without nodeGroups, something else in the body was wrong and groups must
      // not be blamed — otherwise one unrelated 400 would disable them for the whole instance.
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put.mockRejectedValue(badRequest('request/body must NOT have additional properties'));
      const warnings: string[] = [];

      await expect(
        client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) })
      ).rejects.toThrow(/additional properties/);

      expect(warnings).toEqual([]);

      // The next write must still send groups: nothing was learned.
      mockAxiosInstance.put.mockReset();
      mockAxiosInstance.put.mockResolvedValue({ data: { id: '123' } });
      await client.updateWorkflow('123', workflow);
      expect(mockAxiosInstance.put.mock.calls[0][1]).toHaveProperty('nodeGroups');
    });

    it('records the field as unsupported only once dropping it succeeds', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('request/body must NOT have additional properties'))
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow('123', workflow, { onWarning: w => warnings.push(w) });

      expect(warnings.join(' ')).toContain('does not support canvas groups');
      // Learned: the following write skips the field without probing again.
      await client.updateWorkflow('123', workflow);
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.put.mock.calls[2][1]).not.toHaveProperty('nodeGroups');
    });

    it('leaves errors that have nothing to do with groups alone', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.put.mockRejectedValue(badRequest("request/body must have required property 'name'"));

      await expect(client.updateWorkflow('123', workflow)).rejects.toThrow(/required property/);
      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
    });

    it('degrades the same way on create', async () => {
      const workflow = groupedWorkflow([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
      mockAxiosInstance.post
        .mockRejectedValueOnce(badRequest('request/body must NOT have additional properties'))
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.createWorkflow(workflow, { onWarning: w => warnings.push(w) });

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post.mock.calls[1][1]).not.toHaveProperty('nodeGroups');
      expect(warnings.join(' ')).toContain('does not support canvas groups');
    });

    it('sends nothing extra for a workflow without groups', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: { id: '123' } });

      await client.updateWorkflow('123', { name: 'Plain', nodes: [], connections: {} });

      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.put.mock.calls[0][1]).not.toHaveProperty('nodeGroups');
    });

    it('degrades an explicit ungroup-all on an instance that has no such field', async () => {
      // `nodeGroups: []` is a sent field, so a pre-2.28 rejection of it must omit the field and
      // warn — not fail the write.
      mockAxiosInstance.put
        .mockRejectedValueOnce(badRequest('request/body must NOT have additional properties'))
        .mockResolvedValue({ data: { id: '123' } });
      const warnings: string[] = [];

      await client.updateWorkflow(
        '123',
        { ...groupedWorkflow([]), nodeGroups: [] },
        { onWarning: w => warnings.push(w) }
      );

      expect(mockAxiosInstance.put).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.put.mock.calls[1][1]).not.toHaveProperty('nodeGroups');
      expect(warnings.join(' ')).toContain('does not support canvas groups');
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

      // Version undetectable here. The legacy route works on every version, so it is used
      // directly rather than probing /publish - detection genuinely fails on real instances.
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/activate', {});
      expect(result).toEqual(activatedWorkflow);
      expect(result.active).toBe(true);
    });

    it('should use /publish on n8n 2.33.0 and above', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.34.4'));
      mockAxiosInstance.post.mockResolvedValue({ data: { id: '123', active: true } });

      await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/publish', {});
    });

    it('should use the deprecated /activate on n8n below 2.33.0', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.32.4'));
      mockAxiosInstance.post.mockResolvedValue({ data: { id: '123', active: true } });

      await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/activate', {});
    });

    it('should fall back to /activate when /publish 404s', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.34.4'));
      const activated = { id: '123', active: true };
      // Through the interceptor: it rejects with an N8nApiError carrying statusCode, not a
      // raw axios error with .response - which is what the fallback has to read.
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 404, data: { message: 'Not Found' } } } },
        { data: activated },
      ]);

      const result = await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/workflows/123/publish', {});
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/activate', {});
      expect(result).toEqual(activated);
    });

    it('should use the legacy route when the version cannot be detected', async () => {
      // Reproduces a live instance whose /rest/settings carries no version at all. Probing
      // /publish there cost a failed request per call and broke activation outright.
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      mockAxiosInstance.post.mockResolvedValue({ data: { id: '123', active: true } });

      await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/activate', {});
    });

    it('should fall back to /activate when /publish answers 405', async () => {
      // n8n answers "POST method not allowed" rather than 404 when the path prefix matches
      // but the method does not - observed live on a pre-2.33 instance.
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.34.4'));
      const activated = { id: '123', active: true };
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 405, data: { message: 'POST method not allowed' } } } },
        { data: activated },
      ]);

      const result = await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/workflows/123/publish', {});
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/activate', {});
      expect(result).toEqual(activated);
    });

    it('should fall back to /publish when the legacy route is gone', async () => {
      // The legacy routes are deprecated with no announced sunset. When n8n removes them, an
      // instance whose version we cannot read must move to /publish rather than lose activation.
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      const activated = { id: '123', active: true };
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 404, data: { message: 'Not Found' } } } },
        { data: activated },
      ]);

      const result = await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/workflows/123/activate', {});
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/publish', {});
      expect(result).toEqual(activated);
    });

    it('should fall back when the legacy route answers 410 Gone', async () => {
      // A retired alias may be answered rather than removed from the router
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      const activated = { id: '123', active: true };
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 410, data: { message: 'Gone' } } } },
        { data: activated },
      ]);

      const result = await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/publish', {});
      expect(result).toEqual(activated);
    });

    it('should switch to /publish once a legacy response carries a Deprecation header', async () => {
      // n8n sets `Deprecation: @<epoch>` on /activate from 2.33 on. Only an instance that has
      // /publish sends it, so it is proof the modern route is there - without a version reading.
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      mockAxiosInstance.simulateSequence('post', [
        { data: { id: '123', active: true }, headers: { deprecation: '@1753228800' } },
        { data: { id: '123', active: true } },
      ]);

      await client.activateWorkflow('123');
      await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/workflows/123/activate', {});
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/publish', {});
    });

    it('should read the Deprecation header whatever its casing', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      mockAxiosInstance.simulateSequence('post', [
        { data: { id: '123', active: true }, headers: { Deprecation: '@1753228800' } },
        { data: { id: '123', active: true } },
      ]);

      await client.activateWorkflow('123');
      await client.deactivateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/unpublish', {});
    });

    it('should stay on the legacy route when no Deprecation header arrives', async () => {
      // Absence proves nothing: an older n8n has no header, and a proxy may strip it. The legacy
      // route works on every version, so an unconfirmed instance keeps using it.
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      mockAxiosInstance.simulateSequence('post', [{ data: { id: '123', active: true } }]);

      await client.activateWorkflow('123');
      await client.activateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/workflows/123/activate', {});
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/activate', {});
    });

    it('should switch to /publish once a fallback to it has succeeded', async () => {
      // The legacy route being gone is the other proof that /publish is there. Latching it keeps
      // the wasted probe to one request instead of one per call.
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 405, data: { message: 'POST method not allowed' } } } },
        { data: { id: '123', active: true } },
      ]);

      await client.activateWorkflow('123');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);

      await client.activateWorkflow('123');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(3, '/workflows/123/publish', {});
    });

    it('should surface the fallback error when it is substantive, not a missing route', async () => {
      // A 400 naming the real problem is more useful than the route probe that preceded it
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 405, data: { message: 'POST method not allowed' } } } },
        { error: { response: { status: 400, data: { message: 'Workflow has no trigger node' } } } },
      ]);

      await expect(client.activateWorkflow('123')).rejects.toThrow(/trigger node/);
    });

    it('should surface the original error when neither route exists', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(null);
      await mockAxiosInstance.simulateError('post', {
        response: { status: 404, data: { message: 'Not Found' } }
      });

      await expect(client.activateWorkflow('nope')).rejects.toBeInstanceOf(N8nNotFoundError);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('should surface a non-404 failure without probing the other route', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.34.4'));
      await mockAxiosInstance.simulateError('post', {
        response: { status: 400, data: { message: 'Workflow has no trigger node' } }
      });

      await expect(client.activateWorkflow('123')).rejects.toBeInstanceOf(N8nValidationError);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
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

      // Version undetectable here - legacy route, which every version has
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/deactivate', {});
      expect(result).toEqual(deactivatedWorkflow);
      expect(result.active).toBe(false);
    });

    it('should use /unpublish on n8n 2.33.0 and above', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.34.4'));
      mockAxiosInstance.post.mockResolvedValue({ data: { id: '123', active: false } });

      await client.deactivateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/unpublish', {});
    });

    it('should use the deprecated /deactivate on n8n below 2.33.0', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.32.4'));
      mockAxiosInstance.post.mockResolvedValue({ data: { id: '123', active: false } });

      await client.deactivateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/123/deactivate', {});
    });

    it('should fall back to /deactivate when /unpublish 404s', async () => {
      vi.spyOn(client, 'getVersion').mockResolvedValue(parseVersion('2.34.4'));
      const deactivated = { id: '123', active: false };
      mockAxiosInstance.simulateSequence('post', [
        { error: { response: { status: 404, data: { message: 'Not Found' } } } },
        { data: deactivated },
      ]);

      const result = await client.deactivateWorkflow('123');

      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/workflows/123/unpublish', {});
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(2, '/workflows/123/deactivate', {});
      expect(result).toEqual(deactivated);
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

  describe('evaluation test runs', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    it('should list test runs with params', async () => {
      const response = { data: [{ id: 'run1', status: 'completed' }], nextCursor: null };
      mockAxiosInstance.get.mockResolvedValue({ data: response });

      const result = await client.listTestRuns('wf1', { status: 'completed', limit: 50, cursor: 'abc' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows/wf1/test-runs', {
        params: { status: 'completed', limit: 50, cursor: 'abc' },
      });
      expect(result).toEqual(response);
    });

    it('should reject hostile workflow ids before making a request', async () => {
      await expect(client.listTestRuns('a/../b')).rejects.toThrow();
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should get a single test run', async () => {
      const run = { id: 'run1', status: 'completed', finalResult: 'success' };
      mockAxiosInstance.get.mockResolvedValue({ data: run });

      const result = await client.getTestRun('wf1', 'run1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows/wf1/test-runs/run1');
      expect(result).toEqual(run);
    });

    it('should reject hostile run ids before making a request', async () => {
      await expect(client.getTestRun('wf1', '../../executions')).rejects.toThrow();
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should list test cases with pagination params', async () => {
      const response = { data: [{ id: 'case1', executionId: 'exec1' }], nextCursor: 'next' };
      mockAxiosInstance.get.mockResolvedValue({ data: response });

      const result = await client.listTestCases('wf1', 'run1', { limit: 20 });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows/wf1/test-runs/run1/test-cases', {
        params: { limit: 20 },
      });
      expect(result.nextCursor).toBe('next');
    });

    it('should wrap legacy array responses when listing test runs', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: [{ id: 'run1' }] });

      const result = await client.listTestRuns('wf1');

      expect(result).toEqual({ data: [{ id: 'run1' }], nextCursor: null });
    });

    it('should throw N8nApiError on HTTP failure', async () => {
      await mockAxiosInstance.simulateError('get', {
        message: 'Forbidden',
        response: { status: 403, data: { message: 'forbidden' } },
      });

      await expect(client.listTestRuns('wf1')).rejects.toThrow(N8nApiError);
    });

    it('should trigger a test run', async () => {
      const triggered = { id: 'run1', status: 'new', createdAt: '2026-07-27T10:00:00.000Z' };
      mockAxiosInstance.post.mockResolvedValue({ data: triggered });

      const result = await client.triggerTestRun('wf1');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/wf1/test-runs', {});
      expect(result).toEqual(triggered);
    });

    it('should reject hostile workflow ids before triggering a run', async () => {
      await expect(client.triggerTestRun('a/../b')).rejects.toThrow();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should cancel a test run', async () => {
      const cancelled = { id: 'run1', status: 'cancelled' };
      mockAxiosInstance.post.mockResolvedValue({ data: cancelled });

      const result = await client.cancelTestRun('wf1', 'run1');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/workflows/wf1/test-runs/run1/cancel', {});
      expect(result).toEqual(cancelled);
    });

    it('should reject hostile run ids before cancelling', async () => {
      await expect(client.cancelTestRun('wf1', '../../executions')).rejects.toThrow();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should throw N8nApiError when triggering a run fails', async () => {
      await mockAxiosInstance.simulateError('post', {
        message: 'Payment Required',
        response: { status: 402, data: { message: 'Evaluation quota exceeded' } },
      });

      await expect(client.triggerTestRun('wf1')).rejects.toThrow(N8nApiError);
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
      
      expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
        baseURL: 'https://n8n.example.com/',
        validateStatus: expect.any(Function),
        maxRedirects: 0,
        // SECURITY (GHSA-cmrh-wvq6-wm9r): pinned transport agents.
        httpAgent: expect.any(Object),
        httpsAgent: expect.any(Object),
      }));

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

    describe('listAllCredentials (pagination, #816)', () => {
      it('paginates across multiple pages until nextCursor is empty', async () => {
        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: { data: [{ id: '1' }, { id: '2' }], nextCursor: 'page2' } })
          .mockResolvedValueOnce({ data: { data: [{ id: '3' }], nextCursor: null } });

        const result = await client.listAllCredentials();

        expect(result.map((c) => c.id)).toEqual(['1', '2', '3']);
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(1, '/credentials', {
          params: { limit: 100, cursor: undefined },
        });
        expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(2, '/credentials', {
          params: { limit: 100, cursor: 'page2' },
        });
      });

      it('stops when a cursor repeats to avoid infinite loops', async () => {
        mockAxiosInstance.get.mockResolvedValue({
          data: { data: [{ id: 'x' }], nextCursor: 'same' },
        });

        const result = await client.listAllCredentials();

        // First page accepted, second page returns the same cursor -> stop.
        expect(result.map((c) => c.id)).toEqual(['x', 'x']);
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      });

      it('respects the MAX_PAGES safety cap', async () => {
        // Always return a fresh cursor so only the page cap can stop the loop.
        let n = 0;
        mockAxiosInstance.get.mockImplementation(async () => ({
          data: { data: [{ id: `c${n}` }], nextCursor: `cursor-${n++}` },
        }));

        const result = await client.listAllCredentials();

        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(50);
        expect(result).toHaveLength(50);
      });
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

    it('should log requests', async () => {
      const config = {
        method: 'get',
        url: '/workflows',
        params: { limit: 10 },
        data: undefined,
      };

      const result = await requestInterceptor(config);

      expect(logger.debug).toHaveBeenCalledWith(
        'n8n API Request: GET /workflows',
        { params: { limit: 10 }, data: undefined }
      );
      // SECURITY (GHSA-cmrh-wvq6-wm9r): interceptor returns the config with
      // pinned agents attached. Compare identity rather than expecting the
      // original object back unchanged.
      expect(result).toBe(config);
      expect(result.httpAgent).toBeDefined();
      expect(result.httpsAgent).toBeDefined();
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

  // #978/#989/#990 — pinned-agent resilience follow-up to GHSA-cmrh-wvq6-wm9r:
  // TTL expiry, invalidate-on-failure, and real connection-level retries.
  describe('pinned agent resilience', () => {
    let requestInterceptor: any;
    let responseErrorInterceptor: any;

    beforeEach(() => {
      vi.mocked(mockAxiosInstance.interceptors.request.use).mockImplementation((onFulfilled: any) => {
        requestInterceptor = onFulfilled;
        return 0;
      });
      vi.mocked(mockAxiosInstance.interceptors.response.use).mockImplementation((onFulfilled: any, onRejected: any) => {
        responseErrorInterceptor = onRejected;
        return 0;
      });
      client = new N8nApiClient(defaultConfig);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // Real n8n api client `config` objects carry `.method` and mutate
    // `__retryCount` across retries; helper mirrors that shape.
    const makeConnectionError = (code: string, config: any) => {
      const error: any = new Error(code);
      error.isAxiosError = true;
      error.code = code;
      error.request = {};
      error.config = config;
      return error;
    };

    it('caches pinned agents across requests within the TTL', async () => {
      await requestInterceptor({ method: 'get', url: '/workflows' });
      await requestInterceptor({ method: 'get', url: '/workflows' });

      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(1);
    });

    it('re-resolves pinned agents after the TTL expires', async () => {
      vi.useFakeTimers();

      await requestInterceptor({ method: 'get', url: '/workflows' });
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(1);

      // Still within the 60s TTL: cache is reused.
      await requestInterceptor({ method: 'get', url: '/workflows' });
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_001);

      await requestInterceptor({ method: 'get', url: '/workflows' });
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(2);
    });

    it('invalidates the pinned agent cache after a NO_RESPONSE error', async () => {
      await requestInterceptor({ method: 'get', url: '/workflows' });
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(1);

      // No `.code` on the error: retry is ineligible, isolating the
      // cache-invalidation behavior of the terminal NO_RESPONSE mapping.
      const error: any = new Error('Network error');
      error.isAxiosError = true;
      error.request = {};
      error.config = {};
      await expect(responseErrorInterceptor(error)).rejects.toThrow();

      await requestInterceptor({ method: 'get', url: '/workflows' });
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(2);
    });

    it('does not stampede re-resolution when concurrent requests hit an expired TTL', async () => {
      vi.useFakeTimers();

      await requestInterceptor({ method: 'get', url: '/workflows' });
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_001);

      // Both requests observe the expired cache; only the first may kick off
      // a new resolution — the second must reuse the in-flight promise.
      await Promise.all([
        requestInterceptor({ method: 'get', url: '/workflows' }),
        requestInterceptor({ method: 'get', url: '/workflows' }),
      ]);
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(2);
    });

    it('re-resolves DNS on the retried attempt after a connection failure', async () => {
      vi.useFakeTimers();
      const config: any = { method: 'get', url: '/workflows' };

      // Populate the pinned-agent cache the way a real first attempt would.
      await requestInterceptor(config);
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(1);

      // Mimic real axios: a re-issued request runs the request interceptor
      // (which attaches agents, resolving DNS if the cache was cleared)
      // before hitting the (now healthy) adapter.
      mockAxiosInstance.request.mockImplementation(async (cfg: any) => {
        await requestInterceptor(cfg);
        return { data: { ok: true }, headers: {} };
      });

      const resultPromise = responseErrorInterceptor(makeConnectionError('ECONNREFUSED', config));
      const assertion = expect(resultPromise).resolves.toEqual({ data: { ok: true }, headers: {} });
      await vi.runAllTimersAsync();
      await assertion;

      // tryRetry cleared the cache, so the retried attempt resolved afresh.
      expect(vi.mocked(dns.lookup)).toHaveBeenCalledTimes(2);
    });

    it('retries a GET on ETIMEDOUT up to maxRetries then rejects with NO_RESPONSE', async () => {
      vi.useFakeTimers();
      const config: any = { method: 'get', url: '/workflows' };

      // Mimics real axios: re-issuing via client.request() re-enters the
      // same response error interceptor, so retries recurse exactly as they
      // do against a real client.
      mockAxiosInstance.request.mockImplementation(async () =>
        responseErrorInterceptor(makeConnectionError('ETIMEDOUT', config))
      );

      const resultPromise = responseErrorInterceptor(makeConnectionError('ETIMEDOUT', config));
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: 'NO_RESPONSE' });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(defaultConfig.maxRetries!);
    });

    it('retries a POST on ECONNREFUSED and resolves on success', async () => {
      vi.useFakeTimers();
      const config: any = { method: 'post', url: '/workflows' };

      mockAxiosInstance.request.mockResolvedValue({ data: { id: '123' }, headers: {} });

      const resultPromise = responseErrorInterceptor(makeConnectionError('ECONNREFUSED', config));
      const assertion = expect(resultPromise).resolves.toEqual({ data: { id: '123' }, headers: {} });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('does not retry a POST on ECONNRESET (not idempotent-safe)', async () => {
      const config: any = { method: 'post', url: '/workflows' };

      await expect(
        responseErrorInterceptor(makeConnectionError('ECONNRESET', config))
      ).rejects.toMatchObject({ code: 'NO_RESPONSE' });

      expect(mockAxiosInstance.request).not.toHaveBeenCalled();
    });

    it('does retry a GET on ECONNRESET (idempotent-safe)', async () => {
      vi.useFakeTimers();
      const config: any = { method: 'get', url: '/workflows' };

      mockAxiosInstance.request.mockResolvedValue({ data: [], headers: {} });

      const resultPromise = responseErrorInterceptor(makeConnectionError('ECONNRESET', config));
      const assertion = expect(resultPromise).resolves.toEqual({ data: [], headers: {} });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('respects a custom maxRetries', async () => {
      vi.useFakeTimers();
      // Constructing a second client re-registers interceptors on the mock;
      // `responseErrorInterceptor` now points at this client's handler.
      new N8nApiClient({ ...defaultConfig, maxRetries: 1 });
      const config: any = { method: 'get', url: '/workflows' };

      mockAxiosInstance.request.mockImplementation(async () =>
        responseErrorInterceptor(makeConnectionError('ETIMEDOUT', config))
      );

      const resultPromise = responseErrorInterceptor(makeConnectionError('ETIMEDOUT', config));
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: 'NO_RESPONSE' });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });
  });

  // GHSA-4ggg-h7ph-26qr — defense-in-depth URL normalization in the constructor.
  describe('constructor URL normalization', () => {
    const getLastAxiosBaseURL = (): string => {
      const calls = vi.mocked(axios.create).mock.calls;
      return (calls[calls.length - 1][0] as any).baseURL;
    };

    it('should strip a trailing fragment', () => {
      const c = new N8nApiClient({
        baseUrl: 'http://169.254.169.254#',
        apiKey: 'k'
      });
      expect((c as any).baseUrl).toBe('http://169.254.169.254');
      const baseURL = getLastAxiosBaseURL();
      expect(baseURL).not.toContain('#');
      expect(baseURL).toBe('http://169.254.169.254/api/v1');
    });

    it('should strip a fragment with content after the hash', () => {
      const c = new N8nApiClient({
        baseUrl: 'https://n8n.example.com#trailing',
        apiKey: 'k'
      });
      expect((c as any).baseUrl).not.toContain('#');
      expect(getLastAxiosBaseURL()).not.toContain('#');
    });

    it('should strip userinfo from baseUrl', () => {
      const c = new N8nApiClient({
        baseUrl: 'https://user:pw@n8n.example.com',
        apiKey: 'k'
      });
      expect((c as any).baseUrl).not.toContain('@');
      expect((c as any).baseUrl).not.toContain('user');
      expect((c as any).baseUrl).not.toContain('pw');
      expect(getLastAxiosBaseURL()).not.toContain('@');
    });

    it('should collapse trailing slash', () => {
      const c = new N8nApiClient({
        baseUrl: 'https://n8n.example.com/',
        apiKey: 'k'
      });
      expect((c as any).baseUrl).toBe('https://n8n.example.com');
      expect(getLastAxiosBaseURL()).toBe('https://n8n.example.com/api/v1');
    });

    it('should be idempotent when baseUrl already ends with /api/v1', () => {
      const c = new N8nApiClient({
        baseUrl: 'https://n8n.example.com/api/v1',
        apiKey: 'k'
      });
      expect(getLastAxiosBaseURL()).toBe('https://n8n.example.com/api/v1');
      // Must not double-suffix to /api/v1/api/v1
      expect(getLastAxiosBaseURL()).not.toContain('/api/v1/api/v1');
    });

    it('should fall through to raw input for unparseable URLs without throwing', () => {
      expect(() => {
        new N8nApiClient({ baseUrl: 'not-a-url', apiKey: 'k' });
      }).not.toThrow();
    });
  });

  describe('path segment validation', () => {
    beforeEach(() => {
      client = new N8nApiClient(defaultConfig);
    });

    const invalidIds = [
      '../credentials',
      '../../../healthz',
      '..%2Fcredentials',
      '%2E%2E%2Fcredentials',
      'workflow/../credentials',
      'a?includeData=true',
      'a#fragment',
      'with space',
      '',
      'a'.repeat(129),
    ];

    it('rejects ids containing disallowed characters or sequences', async () => {
      for (const badId of invalidIds) {
        await expect(client.getWorkflow(badId)).rejects.toThrow();
      }
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('rejects disallowed ids on getCredential, deleteWorkflow, getExecution, deleteCredential', async () => {
      await expect(client.getCredential('../tags')).rejects.toThrow();
      await expect(client.deleteWorkflow('../../healthz')).rejects.toThrow();
      await expect(client.getExecution('1?includeData=true')).rejects.toThrow();
      await expect(client.deleteCredential('cred/../../variables')).rejects.toThrow();
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
      expect(mockAxiosInstance.delete).not.toHaveBeenCalled();
    });

    it('accepts valid nanoid-style ids', async () => {
      const workflow = { id: 'abc-XYZ_123', name: 'Test', nodes: [], connections: {} };
      mockAxiosInstance.get.mockResolvedValue({ data: workflow });

      await expect(client.getWorkflow('abc-XYZ_123')).resolves.toEqual(workflow);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows/abc-XYZ_123');
    });

    it('accepts valid uuid-style ids', async () => {
      const workflow = { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Test', nodes: [], connections: {} };
      mockAxiosInstance.get.mockResolvedValue({ data: workflow });

      await expect(client.getWorkflow('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).resolves.toEqual(workflow);
    });

    it('rejects non-string id types', async () => {
      // @ts-expect-error - intentional bad input
      await expect(client.getWorkflow(123)).rejects.toThrow();
      // @ts-expect-error - intentional bad input
      await expect(client.getWorkflow(null)).rejects.toThrow();
      // @ts-expect-error - intentional bad input
      await expect(client.getWorkflow(undefined)).rejects.toThrow();
    });
  });
});
