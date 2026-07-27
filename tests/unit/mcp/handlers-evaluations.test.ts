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
      triggerTestRun: vi.fn(),
      cancelTestRun: vi.fn(),
      refreshVersion: vi.fn().mockResolvedValue(null),
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

    it('should not mention runId in the not-found guidance, which list_runs never takes', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.30.4',
        major: 2,
        minor: 30,
        patch: 4,
      });
      mockApiClient.listTestRuns.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow not found');
      expect(result.error).not.toContain('runId');
    });

    it('should not blame POST for a 405 on a read route', async () => {
      mockApiClient.refreshVersion.mockResolvedValue(null);
      mockApiClient.listTestRuns.mockRejectedValue(
        new N8nApiError('Method Not Allowed', 405, 'API_ERROR')
      );

      const result = await handlers.handleListTestRuns({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain('POST');
      expect(result.error).toContain('could not be read');
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
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.29.1',
        major: 2,
        minor: 29,
        patch: 1,
      });
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2.30.0 or later');
      expect(result.error).toContain('2.29.1');
    });

    it('should map 404 on a 2.30+ instance to not-found guidance', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.30.4',
        major: 2,
        minor: 30,
        patch: 4,
      });
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('belong');
      expect(result.error).not.toContain('could not be read');
    });

    it('should re-read the version on 404 instead of trusting the cached value', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.29.1',
        major: 2,
        minor: 29,
        patch: 1,
      });
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(mockApiClient.refreshVersion).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain('2.30.0 or later');
      expect(result.error).toContain('2.29.1');
    });

    it('should hedge a 404 when the instance version cannot be read', async () => {
      mockApiClient.refreshVersion.mockResolvedValue(null);
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('could not be read');
      expect(result.error).toContain('2.30.0 or later');
      expect(result.error).toContain('belong');
    });

    it('should hedge a 404 when the version refresh throws', async () => {
      mockApiClient.refreshVersion.mockRejectedValue(new Error('network down'));
      mockApiClient.getTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleGetTestRun({ workflowId: 'wf1', runId: 'run1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('could not be read');
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

  describe('handleTriggerTestRun', () => {
    const triggeredRun = { id: 'run9', status: 'new', createdAt: '2026-07-27T10:00:00.000Z' };

    it('should return the triggered run with a polling note', async () => {
      mockApiClient.triggerTestRun.mockResolvedValue(triggeredRun);

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(triggeredRun);
      expect(result.data._note).toContain('get_run');
      expect(result.data._note).toContain('run9');
      expect(mockApiClient.triggerTestRun).toHaveBeenCalledWith('wf1');
    });

    it('should reject a missing workflowId', async () => {
      const result = await handlers.handleTriggerTestRun({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.triggerTestRun).not.toHaveBeenCalled();
    });

    it('should map 402 to evaluation quota guidance', async () => {
      mockApiClient.triggerTestRun.mockRejectedValue(
        new N8nApiError('Evaluation quota exceeded', 402, 'API_ERROR')
      );

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('quota');
      expect(result.error).toContain('plan');
    });

    it('should map 409 to missing evaluation trigger guidance', async () => {
      mockApiClient.triggerTestRun.mockRejectedValue(
        new N8nApiError('Workflow has no evaluation trigger', 409, 'API_ERROR')
      );

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('evaluation trigger');
    });

    it('should map 403 to testRun:create scope guidance', async () => {
      mockApiClient.triggerTestRun.mockRejectedValue(new N8nApiError('Forbidden', 403, 'FORBIDDEN'));

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('testRun:create');
      expect(result.error).toContain('2.32');
    });

    it('should reject a whitespace-only workflowId', async () => {
      const result = await handlers.handleTriggerTestRun({ workflowId: '   ' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.triggerTestRun).not.toHaveBeenCalled();
    });

    it('should map 405 on a pre-2.32 instance to version guidance', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.31.3',
        major: 2,
        minor: 31,
        patch: 3,
      });
      mockApiClient.triggerTestRun.mockRejectedValue(
        new N8nApiError('Method Not Allowed', 405, 'API_ERROR')
      );

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2.32.0 or later');
      expect(result.error).toContain('2.31.3');
    });

    it('should still point at the upgrade on a 405 when the version cannot be read', async () => {
      mockApiClient.refreshVersion.mockResolvedValue(null);
      mockApiClient.triggerTestRun.mockRejectedValue(
        new N8nApiError('Method Not Allowed', 405, 'API_ERROR')
      );

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2.32.0 or later');
      expect(result.error).toContain('could not be read');
      expect(result.error).toContain('Upgrade the instance');
    });

    it('should not claim a version problem when the instance is 2.32+', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.32.0',
        major: 2,
        minor: 32,
        patch: 0,
      });
      mockApiClient.triggerTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Workflow not found');
      expect(result.error).not.toContain('2.32');
    });

    it('should not mention runId in the not-found guidance, which run never takes', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.32.0',
        major: 2,
        minor: 32,
        patch: 0,
      });
      mockApiClient.triggerTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleTriggerTestRun({ workflowId: 'wf1' });

      expect(result.error).not.toContain('runId');
      expect(result.error).toContain('workflowId');
    });
  });

  describe('handleCancelTestRun', () => {
    it('should return the cancelled run with a confirmation note', async () => {
      mockApiClient.cancelTestRun.mockResolvedValue({ id: 'run9', status: 'cancelled' });

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'run9', status: 'cancelled' });
      expect(result.data._note).toContain('get_run');
      expect(mockApiClient.cancelTestRun).toHaveBeenCalledWith('wf1', 'run9');
    });

    it('should reject a missing runId', async () => {
      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.cancelTestRun).not.toHaveBeenCalled();
    });

    it('should map 409 to already-finished guidance', async () => {
      mockApiClient.cancelTestRun.mockRejectedValue(
        new N8nApiError('The test run "run9" cannot be cancelled', 409, 'API_ERROR')
      );

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already finished');
    });

    it('should map 403 to testRun:cancel scope guidance', async () => {
      mockApiClient.cancelTestRun.mockRejectedValue(new N8nApiError('Forbidden', 403, 'FORBIDDEN'));

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('testRun:cancel');
    });

    it('should reject a whitespace-only runId', async () => {
      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: '  ' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.cancelTestRun).not.toHaveBeenCalled();
    });

    it('should map 404 on a pre-2.32 instance to version guidance', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.31.3',
        major: 2,
        minor: 31,
        patch: 3,
      });
      mockApiClient.cancelTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2.32.0 or later');
      expect(result.error).toContain('2.31.3');
    });

    it('should map 404 on a 2.32+ instance to not-found guidance', async () => {
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.32.1',
        major: 2,
        minor: 32,
        patch: 1,
      });
      mockApiClient.cancelTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('belong');
      expect(result.error).not.toContain('could not be read');
    });

    it('should offer both causes on a 404 when the version cannot be read', async () => {
      mockApiClient.refreshVersion.mockResolvedValue(null);
      mockApiClient.cancelTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2.32.0 or later');
      expect(result.error).toContain('could not be read');
      expect(result.error).toContain('belong');
    });

    it('should not report an upgrade when a stale cache predates a live upgrade', async () => {
      // The client cached 2.31 before the instance was upgraded; the refresh sees
      // 2.32, so a genuine bad-id 404 must not be blamed on the version.
      mockApiClient.refreshVersion.mockResolvedValue({
        version: '2.32.0',
        major: 2,
        minor: 32,
        patch: 0,
      });
      mockApiClient.cancelTestRun.mockRejectedValue(new N8nApiError('Not found', 404, 'NOT_FOUND'));

      const result = await handlers.handleCancelTestRun({ workflowId: 'wf1', runId: 'run9' });

      expect(mockApiClient.refreshVersion).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain('belong');
      expect(result.error).not.toContain('Upgrade the instance');
    });
  });
});
