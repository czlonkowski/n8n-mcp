import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { N8nApiClient, N8nApiClientConfig } from '../../../src/services/n8n-api-client';
import * as n8nValidation from '../../../src/services/n8n-validation';
import { logger } from '../../../src/utils/logger';
import * as dns from 'dns/promises';

// Mock DNS module for SSRF protection
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

vi.mock('axios');
vi.mock('../../../src/utils/logger');

vi.mock('../../../src/services/n8n-validation', () => ({
  cleanWorkflowForCreate: vi.fn((workflow) => workflow),
  cleanWorkflowForUpdate: vi.fn((workflow) => workflow),
}));

describe('N8nApiClient.listProjects', () => {
  let client: N8nApiClient;
  let mockAxiosInstance: any;

  const defaultConfig: N8nApiClientConfig = {
    baseUrl: 'https://n8n.example.com',
    apiKey: 'test-api-key',
    timeout: 30000,
    maxRetries: 3,
  };

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

    vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
      if (hostname === 'localhost') {
        return { address: '127.0.0.1', family: 4 } as any;
      }
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipv4Regex.test(hostname)) {
        return { address: hostname, family: 4 } as any;
      }
      return { address: '8.8.8.8', family: 4 } as any;
    });

    mockAxiosInstance = {
      defaults: { baseURL: 'https://n8n.example.com/api/v1' },
      interceptors: {
        request: { use: vi.fn() },
        response: {
          use: vi.fn((onFulfilled, onRejected) => {
            mockAxiosInstance._responseInterceptor = { onFulfilled, onRejected };
            return 0;
          }),
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

    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { status: 'ok' } });

    mockAxiosInstance.simulateError = async (method: string, errorConfig: any) => {
      const axiosError = createAxiosError(errorConfig);
      mockAxiosInstance[method].mockImplementation(async () => {
        if (mockAxiosInstance._responseInterceptor?.onRejected) {
          try {
            const transformedError = await mockAxiosInstance._responseInterceptor.onRejected(axiosError);
            return Promise.reject(transformedError);
          } catch (error) {
            return Promise.reject(error);
          }
        }
        return Promise.reject(axiosError);
      });
    };

    client = new N8nApiClient(defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the data array and passes limit', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { data: [{ id: 'p1', name: 'Personal', type: 'personal' }] } });
    expect(await client.listProjects()).toEqual([{ id: 'p1', name: 'Personal', type: 'personal' }]);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', { params: { limit: 100 } });
  });

  it('passes a custom limit through', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { data: [] } });
    await client.listProjects(10);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', { params: { limit: 10 } });
  });

  it('returns an empty array when the response has no data array', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });
    expect(await client.listProjects()).toEqual([]);
  });

  it('returns a legacy plain array response as-is', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({ data: [{ id: 'p1', name: 'Personal', type: 'personal' }] });
    expect(await client.listProjects()).toEqual([{ id: 'p1', name: 'Personal', type: 'personal' }]);
  });

  it('surfaces a 403 as N8nApiError with statusCode 403', async () => {
    await mockAxiosInstance.simulateError('get', { message: 'Forbidden', response: { status: 403, data: { message: 'license' } } });
    await expect(client.listProjects()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('surfaces a 404 as N8nApiError with statusCode 404', async () => {
    await mockAxiosInstance.simulateError('get', { message: 'Not Found', response: { status: 404, data: { message: 'not found' } } });
    await expect(client.listProjects()).rejects.toMatchObject({ statusCode: 404 });
  });
});
