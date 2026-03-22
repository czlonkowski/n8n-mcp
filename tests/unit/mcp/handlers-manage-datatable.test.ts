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

describe('Data Table Handlers (n8n_manage_datatable)', () => {
  let mockApiClient: any;
  let handlers: any;
  let getN8nApiConfig: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock API client with all data table methods
    mockApiClient = {
      createWorkflow: vi.fn(),
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
      triggerWebhook: vi.fn(),
      getExecution: vi.fn(),
      listExecutions: vi.fn(),
      deleteExecution: vi.fn(),
      healthCheck: vi.fn(),
      createDataTable: vi.fn(),
      listDataTables: vi.fn(),
      getDataTable: vi.fn(),
      updateDataTable: vi.fn(),
      deleteDataTable: vi.fn(),
      getDataTableRows: vi.fn(),
      insertDataTableRows: vi.fn(),
      updateDataTableRows: vi.fn(),
      upsertDataTableRow: vi.fn(),
      deleteDataTableRows: vi.fn(),
    };

    // Import mocked modules
    getN8nApiConfig = (await import('@/config/n8n-api')).getN8nApiConfig;

    // Mock the API config
    vi.mocked(getN8nApiConfig).mockReturnValue({
      baseUrl: 'https://n8n.test.com',
      apiKey: 'test-key',
      timeout: 30000,
      maxRetries: 3,
    });

    // Mock the N8nApiClient constructor
    vi.mocked(N8nApiClient).mockImplementation(() => mockApiClient);

    // Import handlers module after setting up mocks
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

  // ========================================================================
  // handleCreateTable
  // ========================================================================
  describe('handleCreateTable', () => {
    it('should create data table with name and columns successfully', async () => {
      const createdTable = {
        id: 'dt-123',
        name: 'My Data Table',
        columns: [
          { id: 'col-1', name: 'email', type: 'string', index: 0 },
          { id: 'col-2', name: 'age', type: 'number', index: 1 },
        ],
      };

      mockApiClient.createDataTable.mockResolvedValue(createdTable);

      const result = await handlers.handleCreateTable({
        name: 'My Data Table',
        columns: [
          { name: 'email', type: 'string' },
          { name: 'age', type: 'number' },
        ],
      });

      expect(result).toEqual({
        success: true,
        data: { id: 'dt-123', name: 'My Data Table' },
        message: 'Data table "My Data Table" created with ID: dt-123',
      });

      expect(mockApiClient.createDataTable).toHaveBeenCalledWith({
        name: 'My Data Table',
        columns: [
          { name: 'email', type: 'string' },
          { name: 'age', type: 'number' },
        ],
      });
    });

    it('should create data table with name only (no columns)', async () => {
      const createdTable = {
        id: 'dt-456',
        name: 'Empty Table',
      };

      mockApiClient.createDataTable.mockResolvedValue(createdTable);

      const result = await handlers.handleCreateTable({
        name: 'Empty Table',
      });

      expect(result).toEqual({
        success: true,
        data: { id: 'dt-456', name: 'Empty Table' },
        message: 'Data table "Empty Table" created with ID: dt-456',
      });

      expect(mockApiClient.createDataTable).toHaveBeenCalledWith({
        name: 'Empty Table',
      });
    });

    it('should return error when API returns empty response (null)', async () => {
      mockApiClient.createDataTable.mockResolvedValue(null);

      const result = await handlers.handleCreateTable({
        name: 'Ghost Table',
      });

      expect(result).toEqual({
        success: false,
        error: 'Data table creation failed: n8n API returned an empty or invalid response',
      });
    });

    it('should return error when API call fails', async () => {
      const apiError = new Error('Data table creation failed on the server');
      mockApiClient.createDataTable.mockRejectedValue(apiError);

      const result = await handlers.handleCreateTable({
        name: 'Broken Table',
      });

      expect(result).toEqual({
        success: false,
        error: 'Data table creation failed on the server',
      });
    });

    it('should return Zod validation error when name is missing', async () => {
      const result = await handlers.handleCreateTable({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });

    it('should return error when n8n API is not configured', async () => {
      vi.mocked(getN8nApiConfig).mockReturnValue(null);

      const result = await handlers.handleCreateTable({
        name: 'Test Table',
      });

      expect(result).toEqual({
        success: false,
        error: 'n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.',
      });
    });

    it('should return structured error for N8nApiError', async () => {
      const apiError = new N8nApiError('Feature not available', 402, 'PAYMENT_REQUIRED', { plan: 'enterprise' });
      mockApiClient.createDataTable.mockRejectedValue(apiError);

      const result = await handlers.handleCreateTable({
        name: 'Enterprise Table',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toBe('PAYMENT_REQUIRED');
      expect(result.details).toEqual({ plan: 'enterprise' });
    });

    it('should return Unknown error when a non-Error value is thrown', async () => {
      mockApiClient.createDataTable.mockRejectedValue('string-error');

      const result = await handlers.handleCreateTable({
        name: 'Error Table',
      });

      expect(result).toEqual({
        success: false,
        error: 'Unknown error occurred',
      });
    });
  });

  // ========================================================================
  // handleListTables
  // ========================================================================
  describe('handleListTables', () => {
    it('should list tables successfully', async () => {
      const tables = [
        { id: 'dt-1', name: 'Table One' },
        { id: 'dt-2', name: 'Table Two' },
      ];
      mockApiClient.listDataTables.mockResolvedValue({ data: tables, nextCursor: null });

      const result = await handlers.handleListTables({});

      expect(result).toEqual({
        success: true,
        data: {
          tables,
          count: 2,
          nextCursor: undefined,
        },
      });
    });

    it('should return empty list when no tables exist', async () => {
      mockApiClient.listDataTables.mockResolvedValue({ data: [], nextCursor: null });

      const result = await handlers.handleListTables({});

      expect(result).toEqual({
        success: true,
        data: {
          tables: [],
          count: 0,
          nextCursor: undefined,
        },
      });
    });

    it('should pass pagination params (limit, cursor)', async () => {
      mockApiClient.listDataTables.mockResolvedValue({
        data: [{ id: 'dt-3', name: 'Page Two' }],
        nextCursor: 'cursor-next',
      });

      const result = await handlers.handleListTables({ limit: 10, cursor: 'cursor-abc' });

      expect(mockApiClient.listDataTables).toHaveBeenCalledWith({ limit: 10, cursor: 'cursor-abc' });
      expect(result.success).toBe(true);
      expect(result.data.nextCursor).toBe('cursor-next');
    });

    it('should handle API error', async () => {
      mockApiClient.listDataTables.mockRejectedValue(new Error('Server down'));

      const result = await handlers.handleListTables({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server down');
    });
  });

  // ========================================================================
  // handleGetTable
  // ========================================================================
  describe('handleGetTable', () => {
    it('should get table successfully', async () => {
      const table = { id: 'dt-1', name: 'My Table', columns: [] };
      mockApiClient.getDataTable.mockResolvedValue(table);

      const result = await handlers.handleGetTable({ tableId: 'dt-1' });

      expect(result).toEqual({
        success: true,
        data: table,
      });
      expect(mockApiClient.getDataTable).toHaveBeenCalledWith('dt-1');
    });

    it('should return error on 404', async () => {
      const notFoundError = new N8nApiError('Data table not found', 404, 'NOT_FOUND');
      mockApiClient.getDataTable.mockRejectedValue(notFoundError);

      const result = await handlers.handleGetTable({ tableId: 'dt-nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should return Zod validation error when tableId is missing', async () => {
      const result = await handlers.handleGetTable({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });
  });

  // ========================================================================
  // handleUpdateTable
  // ========================================================================
  describe('handleUpdateTable', () => {
    it('should rename table successfully', async () => {
      const updatedTable = { id: 'dt-1', name: 'Renamed Table' };
      mockApiClient.updateDataTable.mockResolvedValue(updatedTable);

      const result = await handlers.handleUpdateTable({ tableId: 'dt-1', name: 'Renamed Table' });

      expect(result).toEqual({
        success: true,
        data: updatedTable,
        message: 'Data table renamed to "Renamed Table"',
      });
      expect(mockApiClient.updateDataTable).toHaveBeenCalledWith('dt-1', { name: 'Renamed Table' });
    });

    it('should return Zod validation error when tableId is missing', async () => {
      const result = await handlers.handleUpdateTable({ name: 'New Name' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });

    it('should return error when API call fails', async () => {
      mockApiClient.updateDataTable.mockRejectedValue(new Error('Update failed'));

      const result = await handlers.handleUpdateTable({ tableId: 'dt-1', name: 'New Name' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });
  });

  // ========================================================================
  // handleDeleteTable
  // ========================================================================
  describe('handleDeleteTable', () => {
    it('should delete table successfully', async () => {
      mockApiClient.deleteDataTable.mockResolvedValue(undefined);

      const result = await handlers.handleDeleteTable({ tableId: 'dt-1' });

      expect(result).toEqual({
        success: true,
        message: 'Data table dt-1 deleted successfully',
      });
      expect(mockApiClient.deleteDataTable).toHaveBeenCalledWith('dt-1');
    });

    it('should return error on 404', async () => {
      const notFoundError = new N8nApiError('Data table not found', 404, 'NOT_FOUND');
      mockApiClient.deleteDataTable.mockRejectedValue(notFoundError);

      const result = await handlers.handleDeleteTable({ tableId: 'dt-nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toBe('NOT_FOUND');
    });
  });

  // ========================================================================
  // handleGetRows
  // ========================================================================
  describe('handleGetRows', () => {
    it('should get rows with default params', async () => {
      const rows = [
        { id: 1, email: 'a@b.com', score: 10 },
        { id: 2, email: 'c@d.com', score: 20 },
      ];
      mockApiClient.getDataTableRows.mockResolvedValue({ data: rows, nextCursor: null });

      const result = await handlers.handleGetRows({ tableId: 'dt-1' });

      expect(result).toEqual({
        success: true,
        data: {
          rows,
          count: 2,
          nextCursor: undefined,
        },
      });
      expect(mockApiClient.getDataTableRows).toHaveBeenCalledWith('dt-1', {});
    });

    it('should pass filter, sort, and search params', async () => {
      mockApiClient.getDataTableRows.mockResolvedValue({ data: [], nextCursor: null });

      await handlers.handleGetRows({
        tableId: 'dt-1',
        limit: 50,
        sortBy: 'name:asc',
        search: 'john',
      });

      expect(mockApiClient.getDataTableRows).toHaveBeenCalledWith('dt-1', {
        limit: 50,
        sortBy: 'name:asc',
        search: 'john',
      });
    });

    it('should serialize object filter to JSON string', async () => {
      mockApiClient.getDataTableRows.mockResolvedValue({ data: [], nextCursor: null });

      const objectFilter = {
        type: 'and' as const,
        filters: [{ columnName: 'status', condition: 'eq' as const, value: 'active' }],
      };

      await handlers.handleGetRows({
        tableId: 'dt-1',
        filter: objectFilter,
      });

      expect(mockApiClient.getDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter: JSON.stringify(objectFilter),
      });
    });

    it('should pass string filter as-is', async () => {
      mockApiClient.getDataTableRows.mockResolvedValue({ data: [], nextCursor: null });

      const filterStr = '{"type":"and","filters":[]}';
      await handlers.handleGetRows({
        tableId: 'dt-1',
        filter: filterStr,
      });

      expect(mockApiClient.getDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter: filterStr,
      });
    });
  });

  // ========================================================================
  // handleInsertRows
  // ========================================================================
  describe('handleInsertRows', () => {
    it('should insert rows successfully', async () => {
      const insertResult = { insertedCount: 2, ids: [1, 2] };
      mockApiClient.insertDataTableRows.mockResolvedValue(insertResult);

      const result = await handlers.handleInsertRows({
        tableId: 'dt-1',
        data: [
          { email: 'a@b.com', score: 10 },
          { email: 'c@d.com', score: 20 },
        ],
      });

      expect(result).toEqual({
        success: true,
        data: insertResult,
        message: 'Rows inserted into data table dt-1',
      });
      expect(mockApiClient.insertDataTableRows).toHaveBeenCalledWith('dt-1', {
        data: [
          { email: 'a@b.com', score: 10 },
          { email: 'c@d.com', score: 20 },
        ],
      });
    });

    it('should pass returnType to the API client', async () => {
      const insertResult = [{ id: 1, email: 'a@b.com', score: 10 }];
      mockApiClient.insertDataTableRows.mockResolvedValue(insertResult);

      const result = await handlers.handleInsertRows({
        tableId: 'dt-1',
        data: [{ email: 'a@b.com', score: 10 }],
        returnType: 'all',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(insertResult);
      expect(mockApiClient.insertDataTableRows).toHaveBeenCalledWith('dt-1', {
        data: [{ email: 'a@b.com', score: 10 }],
        returnType: 'all',
      });
    });

    it('should return Zod validation error when data is empty array', async () => {
      const result = await handlers.handleInsertRows({
        tableId: 'dt-1',
        data: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(result.details).toHaveProperty('errors');
    });
  });

  // ========================================================================
  // handleUpdateRows
  // ========================================================================
  describe('handleUpdateRows', () => {
    it('should update rows successfully', async () => {
      const updateResult = { updatedCount: 3 };
      mockApiClient.updateDataTableRows.mockResolvedValue(updateResult);

      const filter = {
        type: 'and' as const,
        filters: [{ columnName: 'status', condition: 'eq' as const, value: 'inactive' }],
      };

      const result = await handlers.handleUpdateRows({
        tableId: 'dt-1',
        filter,
        data: { status: 'active' },
      });

      expect(result).toEqual({
        success: true,
        data: updateResult,
        message: 'Rows updated successfully',
      });
      expect(mockApiClient.updateDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter,
        data: { status: 'active' },
      });
    });

    it('should support dryRun mode', async () => {
      const dryRunResult = { matchedCount: 5 };
      mockApiClient.updateDataTableRows.mockResolvedValue(dryRunResult);

      const filter = {
        filters: [{ columnName: 'score', condition: 'lt' as const, value: 5 }],
      };

      const result = await handlers.handleUpdateRows({
        tableId: 'dt-1',
        filter,
        data: { status: 'low' },
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Dry run: rows matched (no changes applied)');
      expect(mockApiClient.updateDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter: { type: 'and', ...filter },
        data: { status: 'low' },
        dryRun: true,
      });
    });

    it('should return error on API failure', async () => {
      mockApiClient.updateDataTableRows.mockRejectedValue(new Error('Conflict'));

      const result = await handlers.handleUpdateRows({
        tableId: 'dt-1',
        filter: { filters: [{ columnName: 'id', condition: 'eq' as const, value: 1 }] },
        data: { name: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Conflict');
    });
  });

  // ========================================================================
  // handleUpsertRows
  // ========================================================================
  describe('handleUpsertRows', () => {
    it('should upsert row successfully', async () => {
      const upsertResult = { action: 'updated', row: { id: 1, email: 'a@b.com', score: 15 } };
      mockApiClient.upsertDataTableRow.mockResolvedValue(upsertResult);

      const filter = {
        filters: [{ columnName: 'email', condition: 'eq' as const, value: 'a@b.com' }],
      };

      const result = await handlers.handleUpsertRows({
        tableId: 'dt-1',
        filter,
        data: { score: 15 },
      });

      expect(result).toEqual({
        success: true,
        data: upsertResult,
        message: 'Row upserted successfully',
      });
      expect(mockApiClient.upsertDataTableRow).toHaveBeenCalledWith('dt-1', {
        filter: { type: 'and', ...filter },
        data: { score: 15 },
      });
    });

    it('should support dryRun mode', async () => {
      const dryRunResult = { action: 'would_update', matchedRows: 1 };
      mockApiClient.upsertDataTableRow.mockResolvedValue(dryRunResult);

      const filter = {
        filters: [{ columnName: 'email', condition: 'eq' as const, value: 'a@b.com' }],
      };

      const result = await handlers.handleUpsertRows({
        tableId: 'dt-1',
        filter,
        data: { score: 20 },
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Dry run: upsert previewed (no changes applied)');
    });

    it('should return error on API failure', async () => {
      const apiError = new N8nApiError('Server error', 500, 'INTERNAL_ERROR');
      mockApiClient.upsertDataTableRow.mockRejectedValue(apiError);

      const result = await handlers.handleUpsertRows({
        tableId: 'dt-1',
        filter: { filters: [{ columnName: 'id', condition: 'eq' as const, value: 1 }] },
        data: { name: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================================================
  // handleDeleteRows
  // ========================================================================
  describe('handleDeleteRows', () => {
    it('should delete rows successfully', async () => {
      const deleteResult = { deletedCount: 2 };
      mockApiClient.deleteDataTableRows.mockResolvedValue(deleteResult);

      const filter = {
        filters: [{ columnName: 'status', condition: 'eq' as const, value: 'deleted' }],
      };

      const result = await handlers.handleDeleteRows({
        tableId: 'dt-1',
        filter,
      });

      expect(result).toEqual({
        success: true,
        data: deleteResult,
        message: 'Rows deleted successfully',
      });
      expect(mockApiClient.deleteDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter: JSON.stringify({ type: 'and', ...filter }),
      });
    });

    it('should serialize filter to JSON string for API call', async () => {
      mockApiClient.deleteDataTableRows.mockResolvedValue({ deletedCount: 1 });

      const filter = {
        type: 'or' as const,
        filters: [
          { columnName: 'score', condition: 'lt' as const, value: 0 },
          { columnName: 'status', condition: 'eq' as const, value: 'spam' },
        ],
      };

      await handlers.handleDeleteRows({ tableId: 'dt-1', filter });

      expect(mockApiClient.deleteDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter: JSON.stringify(filter),
      });
    });

    it('should support dryRun mode', async () => {
      const dryRunResult = { matchedCount: 4 };
      mockApiClient.deleteDataTableRows.mockResolvedValue(dryRunResult);

      const filter = {
        filters: [{ columnName: 'active', condition: 'eq' as const, value: false }],
      };

      const result = await handlers.handleDeleteRows({
        tableId: 'dt-1',
        filter,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Dry run: rows matched for deletion (no changes applied)');
      expect(mockApiClient.deleteDataTableRows).toHaveBeenCalledWith('dt-1', {
        filter: JSON.stringify({ type: 'and', ...filter }),
        dryRun: true,
      });
    });
  });
});
