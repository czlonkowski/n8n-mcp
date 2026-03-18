import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';

vi.mock('@/services/n8n-api-client');
vi.mock('@/services/workflow-validator');
vi.mock('@/database/node-repository');
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

describe('handleCreateDataTable', () => {
  let mockApiClient: any;
  let handlers: any;
  let getN8nApiConfig: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApiClient = {
      createDataTable: vi.fn(),
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
    vi.resetModules();
  });

  describe('happy path', () => {
    it('creates data table with name and columns, returns success with id and name', async () => {
      mockApiClient.createDataTable.mockResolvedValue({
        id: 'table-abc123',
        name: 'My Table',
        columns: [{ name: 'col1', type: 'string' }],
      });

      const result = await handlers.handleCreateDataTable(
        {
          name: 'My Table',
          columns: [{ name: 'col1', type: 'string' }],
        },
        undefined
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'table-abc123', name: 'My Table' });
      expect(mockApiClient.createDataTable).toHaveBeenCalledWith({
        name: 'My Table',
        columns: [{ name: 'col1', type: 'string' }],
      });
    });

    it('creates data table with name only (no columns)', async () => {
      mockApiClient.createDataTable.mockResolvedValue({
        id: 'table-xyz',
        name: 'Simple Table',
      });

      const result = await handlers.handleCreateDataTable({ name: 'Simple Table' }, undefined);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ id: 'table-xyz', name: 'Simple Table' });
    });
  });

  describe('error cases', () => {
    it('returns error when n8n API is not configured', async () => {
      vi.mocked(getN8nApiConfig).mockReturnValue(null);

      const result = await handlers.handleCreateDataTable({ name: 'Test' }, undefined);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('returns validation error when name is missing', async () => {
      const result = await handlers.handleCreateDataTable({}, undefined);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when API call fails', async () => {
      mockApiClient.createDataTable.mockRejectedValue(new Error('Network error'));

      const result = await handlers.handleCreateDataTable({ name: 'Fail Table' }, undefined);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('returns error when API returns empty response', async () => {
      mockApiClient.createDataTable.mockResolvedValue(null);

      const result = await handlers.handleCreateDataTable({ name: 'Empty Response' }, undefined);

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty response');
    });
  });
});
