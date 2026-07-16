import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { N8nApiError } from '@/utils/n8n-errors';

// Mock dependencies
vi.mock('@/services/n8n-api-client');
vi.mock('@/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn(),
}));
vi.mock('@/services/n8n-validation', () => ({
  validateWorkflowStructure: vi.fn(),
  hasWebhookTrigger: vi.fn(),
  getWebhookUrl: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
  LogLevel: {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
  },
}));

describe('Evaluation Handlers (n8n_evaluations)', () => {
  let mockApiClient: any;
  let handlers: any;
  let getN8nApiConfig: any;

  const completedRun = {
    id: 'run1',
    status: 'completed',
    runAt: '2026-07-15T10:00:00.000Z',
    completedAt: '2026-07-15T10:05:00.000Z',
    metrics: { accuracy: 0.9 },
    errorCode: null,
    errorDetails: null,
    finalResult: 'success',
    testCaseCount: 3,
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:05:00.000Z',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApiClient = {
      listTestRuns: vi.fn(),
      getTestRun: vi.fn(),
      listTestCases: vi.fn(),
      getCachedVersionInfo: vi.fn().mockReturnValue(null),
      getVersion: vi.fn().mockResolvedValue(null),
    };

    getN8nApiConfig = (await import('@/config/n8n-api')).getN8nApiConfig;

    vi.mocked(getN8nApiConfig).mockReturnValue({
      baseUrl: 'https://n8n.test.com',
      apiKey: 'test-key',
      timeout: 30000,
      maxRetries: 3,
    });

    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);

    handlers = await import('@/mcp/handlers-n8n-manager');
  });

  afterEach(() => {
    if (handlers) {
      const clientGetter = handlers.getN8nApiClient;
      if (clientGetter) {
        vi.mocked(getN8nApiConfig).mockReturnValue(null);
        clientGetter();
      }
    }
  });

  describe('handleListTestRuns', () => {
    it('should return runs with pagination info', async () => {
      mockApiClient.listTestRuns.mockResolvedValue({ data: [completedRun], nextCursor: null });

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1', status: 'completed' });

      expect(result.success).toBe(true);
      expect(result.data.testRuns).toHaveLength(1);
      expect(result.data.returned).toBe(1);
      expect(result.data.hasMore).toBe(false);
      expect(mockApiClient.listTestRuns).toHaveBeenCalledWith('wf1', {
        status: 'completed',
        limit: undefined,
        cursor: undefined,
      });
    });

    it('should include a pagination note when more pages exist', async () => {
      mockApiClient.listTestRuns.mockResolvedValue({ data: [completedRun], nextCursor: 'next' });

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1' });

      expect(result.success).toBe(true);
      expect(result.data.hasMore).toBe(true);
      expect(result.data._note).toContain('cursor');
    });

    it('should include a hint when no runs exist', async () => {
      mockApiClient.listTestRuns.mockResolvedValue({ data: [], nextCursor: null });

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1' });

      expect(result.success).toBe(true);
      expect(result.data.testRuns).toHaveLength(0);
      expect(result.data._note).toContain('evaluation');
    });

    it('should reject a limit above 250', async () => {
      const result = await handlers.handleListTestRuns({ workflowId: 'wf1', limit: 500 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.listTestRuns).not.toHaveBeenCalled();
    });

    it('should reject a missing workflowId', async () => {
      const result = await handlers.handleListTestRuns({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
    });

    it('should map 403 to API key scope guidance', async () => {
      mockApiClient.listTestRuns.mockRejectedValue(new N8nApiError('Forbidden', 403, 'FORBIDDEN'));

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('testRun scopes');
      expect(result.error).toContain('re-create');
    });

    it('should use a filter-aware note when a status filter matches nothing', async () => {
      mockApiClient.listTestRuns.mockResolvedValue({ data: [], nextCursor: null });

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1', status: 'error' });

      expect(result.success).toBe(true);
      expect(result.data._note).toContain("status 'error'");
      expect(result.data._note).not.toContain('evaluation trigger');
    });

    it('should coerce empty-string status and cursor to undefined', async () => {
      mockApiClient.listTestRuns.mockResolvedValue({ data: [], nextCursor: null });

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1', status: '', cursor: '' });

      expect(result.success).toBe(true);
      expect(mockApiClient.listTestRuns).toHaveBeenCalledWith('wf1', {
        status: undefined,
        limit: undefined,
        cursor: undefined,
      });
    });

    it('should pass the cursor through', async () => {
      mockApiClient.listTestRuns.mockResolvedValue({ data: [completedRun], nextCursor: null });

      await handlers.handleListTestRuns({ workflowId: 'wf1', cursor: 'page2' });

      expect(mockApiClient.listTestRuns).toHaveBeenCalledWith('wf1', {
        status: undefined,
        limit: undefined,
        cursor: 'page2',
      });
    });
  });

  describe('handleGetTestRun', () => {
    it('should return the run', async () => {
      mockApiClient.getTestRun.mockResolvedValue(completedRun);

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(completedRun);
      expect(mockApiClient.getTestRun).toHaveBeenCalledWith('wf1', 'run1');
    });

    it('should reject missing runId', async () => {
      const result = await handlers.handleGetTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.getTestRun).not.toHaveBeenCalled();
    });

    it('should map 404 on a pre-2.30 instance to version guidance', async () => {
      mockApiClient.getCachedVersionInfo.mockReturnValue({
        version: '2.29.1',
        major: 2,
        minor: 29,
        patch: 1,
      });
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2.30');
      expect(result.error).toContain('2.29.1');
    });

    it('should map 404 on a 2.30+ instance to not-found guidance', async () => {
      mockApiClient.getCachedVersionInfo.mockReturnValue({
        version: '2.30.4',
        major: 2,
        minor: 30,
        patch: 4,
      });
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('belong');
    });

    it('should map 404 with unknown instance version to not-found guidance', async () => {
      mockApiClient.getCachedVersionInfo.mockReturnValue(null);
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('belong');
    });

    it('should fetch the version on 404 when the cache is cold', async () => {
      mockApiClient.getCachedVersionInfo.mockReturnValue(null);
      mockApiClient.getVersion.mockResolvedValue({
        version: '2.29.1',
        major: 2,
        minor: 29,
        patch: 1,
      });
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(mockApiClient.getVersion).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain('2.30');
      expect(result.error).toContain('2.29.1');
    });

    it('should fall back to not-found guidance when the version fetch fails', async () => {
      mockApiClient.getCachedVersionInfo.mockReturnValue(null);
      mockApiClient.getVersion.mockRejectedValue(new Error('network down'));
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('belong');
    });

    it('should map 403 to API key scope guidance', async () => {
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Forbidden', 403, 'FORBIDDEN'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('testRun scopes');
    });
  });

  describe('handleListTestCases', () => {
    it('should default limit to 20', async () => {
      mockApiClient.listTestCases.mockResolvedValue({ data: [], nextCursor: null });

      const result = await handlers.handleListTestCases({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(true);
      expect(mockApiClient.listTestCases).toHaveBeenCalledWith('wf1', 'run1', {
        limit: 20,
        cursor: undefined,
      });
    });

    it('should return cases with pagination info and size warning', async () => {
      const testCase = {
        id: 'case1',
        status: 'success',
        runAt: null,
        completedAt: null,
        metrics: { accuracy: 1 },
        errorCode: null,
        errorDetails: null,
        inputs: { question: 'hi' },
        outputs: { answer: 'hello' },
        executionId: 'exec1',
      };
      mockApiClient.listTestCases.mockResolvedValue({ data: [testCase], nextCursor: 'next' });

      const result = await handlers.handleListTestCases({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(true);
      expect(result.data.testCases).toEqual([testCase]);
      expect(result.data.hasMore).toBe(true);
      expect(result.data._note).toContain('Paginate');
    });

    it('should reject missing runId', async () => {
      const result = await handlers.handleListTestCases({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
    });

    it('should map 403 to API key scope guidance', async () => {
      mockApiClient.listTestCases.mockRejectedValue(new N8nApiError('Forbidden', 403, 'FORBIDDEN'));

      const result = await handlers.handleListTestCases({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('testRun scopes');
    });
  });
});
