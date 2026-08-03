import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { N8nApiError } from '@/utils/n8n-errors';

// Mock dependencies
vi.mock('@/services/n8n-api-client');
vi.mock('@/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn(),
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

describe('Folder Handlers (n8n_manage_folders)', () => {
  let mockApiClient: any;
  let handlers: any;
  let getN8nApiConfig: any;

  const folder = {
    id: 'fold1',
    name: 'Production',
    parentFolderId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApiClient = {
      createFolder: vi.fn(),
      listFolders: vi.fn(),
      getFolder: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
      resolvePersonalProjectId: vi.fn().mockResolvedValue('proj-personal'),
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
    // Reset the module-level default client singleton: with the config mocked to
    // null, getN8nApiClient() clears defaultApiClient so the next test's fresh
    // mockApiClient is actually constructed instead of the cached one being reused.
    if (handlers) {
      const clientGetter = handlers.getN8nApiClient;
      if (clientGetter) {
        vi.mocked(getN8nApiConfig).mockReturnValue(null);
        clientGetter();
      }
    }
  });

  describe('handleCreateFolder', () => {
    it('passes the personal alias through untouched (n8n resolves it server-side)', async () => {
      mockApiClient.createFolder.mockResolvedValue(folder);

      const result = await handlers.handleCreateFolder({ action: 'create', name: 'Production' });

      expect(result.success).toBe(true);
      expect(mockApiClient.createFolder).toHaveBeenCalledWith('personal', { name: 'Production' });
      expect(mockApiClient.resolvePersonalProjectId).not.toHaveBeenCalled();
      expect(result.data).toEqual({ id: 'fold1', name: 'Production', parentFolderId: null });
    });

    it('sends parentFolderId only when provided', async () => {
      mockApiClient.createFolder.mockResolvedValue({ ...folder, parentFolderId: 'parent1' });

      await handlers.handleCreateFolder({ action: 'create', name: 'Sub', parentFolderId: 'parent1', projectId: 'projA' });

      expect(mockApiClient.createFolder).toHaveBeenCalledWith('projA', { name: 'Sub', parentFolderId: 'parent1' });
    });

    it('accepts parentFolderId: null as "no parent" (published schema declares string|null)', async () => {
      mockApiClient.createFolder.mockResolvedValue(folder);

      const result = await handlers.handleCreateFolder({ action: 'create', name: 'X', parentFolderId: null });

      expect(result.success).toBe(true);
      expect(mockApiClient.createFolder).toHaveBeenCalledWith('personal', { name: 'X' });
    });

    it('treats a blank projectId as the personal default (lossy MCP clients, #774)', async () => {
      // Regression: .default() only fires on a raw undefined, but lossy clients
      // serialize omitted fields as '' - the default must still apply.
      mockApiClient.createFolder.mockResolvedValue(folder);

      await handlers.handleCreateFolder({ action: 'create', name: 'X', projectId: '' });

      expect(mockApiClient.createFolder).toHaveBeenCalledWith('personal', { name: 'X' });
    });

    it('rejects a missing name before calling the API', async () => {
      const result = await handlers.handleCreateFolder({ action: 'create' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.createFolder).not.toHaveBeenCalled();
    });

    it('fails cleanly when the API returns an empty response', async () => {
      mockApiClient.createFolder.mockResolvedValue(null);

      const result = await handlers.handleCreateFolder({ action: 'create', name: 'X' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty or invalid response');
    });
  });

  describe('handleListFolders', () => {
    it('resolves the personal alias and sends the fixed select with defaults', async () => {
      mockApiClient.listFolders.mockResolvedValue({ count: 1, data: [folder] });

      const result = await handlers.handleListFolders({ action: 'list' });

      expect(mockApiClient.resolvePersonalProjectId).toHaveBeenCalledTimes(1);
      expect(mockApiClient.listFolders).toHaveBeenCalledWith('proj-personal', {
        select: expect.arrayContaining(['id', 'name', 'workflowCount', 'subFolderCount', 'path']),
        sortBy: 'updatedAt:desc',
        skip: 0,
        take: 50,
      });
      expect(result.success).toBe(true);
      expect(result.data.folders).toEqual([folder]);
      expect(result.data.count).toBe(1);
      expect(result.data.projectId).toBe('proj-personal');
    });

    it('does not resolve when an explicit projectId is given', async () => {
      mockApiClient.listFolders.mockResolvedValue({ count: 0, data: [] });

      await handlers.handleListFolders({ action: 'list', projectId: 'projB' });

      expect(mockApiClient.resolvePersonalProjectId).not.toHaveBeenCalled();
      expect(mockApiClient.listFolders).toHaveBeenCalledWith('projB', expect.any(Object));
    });

    it('builds the filter from nameFilter and parentFolderId', async () => {
      mockApiClient.listFolders.mockResolvedValue({ count: 0, data: [] });

      await handlers.handleListFolders({
        action: 'list',
        nameFilter: 'prod',
        parentFolderId: 'parent1',
        sortBy: 'name:asc',
        skip: 10,
        take: 5,
      });

      expect(mockApiClient.listFolders).toHaveBeenCalledWith('proj-personal', expect.objectContaining({
        filter: { name: 'prod', parentFolderId: 'parent1' },
        sortBy: 'name:asc',
        skip: 10,
        take: 5,
      }));
    });

    it('surfaces a resolution failure instead of listing another project', async () => {
      mockApiClient.resolvePersonalProjectId.mockRejectedValue(
        new N8nApiError("Could not resolve the 'personal' project", 400, 'VALIDATION_ERROR')
      );

      const result = await handlers.handleListFolders({ action: 'list' });

      expect(result.success).toBe(false);
      expect(mockApiClient.listFolders).not.toHaveBeenCalled();
    });
  });

  describe('handleGetFolder', () => {
    it('returns the folder with the resolved projectId attached', async () => {
      const detail = { ...folder, totalSubFolders: 2, totalWorkflows: 7 };
      mockApiClient.getFolder.mockResolvedValue(detail);

      const result = await handlers.handleGetFolder({ action: 'get', folderId: 'fold1' });

      expect(mockApiClient.getFolder).toHaveBeenCalledWith('proj-personal', 'fold1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ...detail, projectId: 'proj-personal' });
    });

    it('requires folderId', async () => {
      const result = await handlers.handleGetFolder({ action: 'get' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
    });
  });

  describe('handleRenameFolder', () => {
    it('PATCHes only the name', async () => {
      mockApiClient.updateFolder.mockResolvedValue({ ...folder, name: 'Staging' });

      const result = await handlers.handleRenameFolder({ action: 'rename', folderId: 'fold1', name: 'Staging' });

      expect(mockApiClient.updateFolder).toHaveBeenCalledWith('proj-personal', 'fold1', { name: 'Staging' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Staging');
    });
  });

  describe('handleMoveFolder', () => {
    it('maps null to the PROJECT_ROOT sentinel "0"', async () => {
      mockApiClient.updateFolder.mockResolvedValue({ ...folder, parentFolderId: null });

      const result = await handlers.handleMoveFolder({ action: 'move', folderId: 'fold1', parentFolderId: null });

      expect(mockApiClient.updateFolder).toHaveBeenCalledWith('proj-personal', 'fold1', { parentFolderId: '0' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('project root');
    });

    it('passes a real target folder through', async () => {
      mockApiClient.updateFolder.mockResolvedValue({ ...folder, parentFolderId: 'parent1' });

      const result = await handlers.handleMoveFolder({ action: 'move', folderId: 'fold1', parentFolderId: 'parent1' });

      expect(mockApiClient.updateFolder).toHaveBeenCalledWith('proj-personal', 'fold1', { parentFolderId: 'parent1' });
      expect(result.message).toContain('parent1');
    });

    it('rejects a move without parentFolderId (must be a folder ID or explicit null)', async () => {
      const result = await handlers.handleMoveFolder({ action: 'move', folderId: 'fold1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input');
      expect(mockApiClient.updateFolder).not.toHaveBeenCalled();
    });
  });

  describe('handleDeleteFolder', () => {
    it('deletes without transfer and warns about archiving in the message', async () => {
      mockApiClient.deleteFolder.mockResolvedValue(undefined);

      const result = await handlers.handleDeleteFolder({ action: 'delete', folderId: 'fold1' });

      expect(mockApiClient.deleteFolder).toHaveBeenCalledWith('proj-personal', 'fold1', undefined);
      expect(result.success).toBe(true);
      expect(result.message).toContain('ARCHIVED');
    });

    it('passes transferToFolderId and reports the transfer target', async () => {
      mockApiClient.deleteFolder.mockResolvedValue(undefined);

      const result = await handlers.handleDeleteFolder({
        action: 'delete',
        folderId: 'fold1',
        transferToFolderId: 'fold2',
      });

      expect(mockApiClient.deleteFolder).toHaveBeenCalledWith('proj-personal', 'fold1', 'fold2');
      expect(result.message).toContain('fold2');
      expect(result.message).not.toContain('ARCHIVED');
    });

    it('describes a transfer to "0" as the project root', async () => {
      mockApiClient.deleteFolder.mockResolvedValue(undefined);

      const result = await handlers.handleDeleteFolder({
        action: 'delete',
        folderId: 'fold1',
        transferToFolderId: '0',
      });

      expect(result.message).toContain('project root');
    });
  });

  describe('error shaping', () => {
    it('appends the licensing/scope hint on 403', async () => {
      mockApiClient.createFolder.mockRejectedValue(
        new N8nApiError('Forbidden', 403, 'API_ERROR')
      );

      const result = await handlers.handleCreateFolder({ action: 'create', name: 'X' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('folder:*');
      expect(result.error).toContain('registered free Community tier');
    });

    it('appends the version/existence hint on 404', async () => {
      mockApiClient.getFolder.mockRejectedValue(
        new N8nApiError('Not found', 404, 'NOT_FOUND')
      );

      const result = await handlers.handleGetFolder({ action: 'get', folderId: 'missing' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('n8n older than 2.19');
    });

    it('leaves other errors unhinted', async () => {
      mockApiClient.getFolder.mockRejectedValue(
        new N8nApiError('boom', 500, 'SERVER_ERROR')
      );

      const result = await handlers.handleGetFolder({ action: 'get', folderId: 'fold1' });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain('folder:*');
      expect(result.error).not.toContain('2.19');
    });
  });
});
