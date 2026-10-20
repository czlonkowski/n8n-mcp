import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the handler module so we can detect which handler the server routes to
// for each action of n8n_manage_folders. vi.hoisted lifts the spy declarations
// above the vi.mock call (vi.mock is itself hoisted above the import below).
const handlerMocks = vi.hoisted(() => ({
  handleCreateFolder: vi.fn().mockResolvedValue({ success: true, data: { action: 'create' } }),
  handleListFolders: vi.fn().mockResolvedValue({ success: true, data: { action: 'list' } }),
  handleGetFolder: vi.fn().mockResolvedValue({ success: true, data: { action: 'get' } }),
  handleRenameFolder: vi.fn().mockResolvedValue({ success: true, data: { action: 'rename' } }),
  handleMoveFolder: vi.fn().mockResolvedValue({ success: true, data: { action: 'move' } }),
  handleDeleteFolder: vi.fn().mockResolvedValue({ success: true, data: { action: 'delete' } }),
}));

vi.mock('../../../src/mcp/handlers-n8n-manager', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    ...handlerMocks,
  };
});

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

import { N8NDocumentationMCPServer } from '../../../src/mcp/server';

class TestableServer extends N8NDocumentationMCPServer {
  public async testExecuteTool(name: string, args: any): Promise<any> {
    return (this as any).executeTool(name, args);
  }
}

describe('n8n_manage_folders action dispatch', () => {
  let server: TestableServer;

  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
    process.env.N8N_API_URL = 'https://example.invalid';
    process.env.N8N_API_KEY = 'test-key';
    delete process.env.DISABLED_TOOL_OPERATIONS;
    server = new TestableServer();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
    delete process.env.DISABLED_TOOL_OPERATIONS;
  });

  it('routes every action to its own handler', async () => {
    await server.testExecuteTool('n8n_manage_folders', { action: 'create', name: 'X' });
    expect(handlerMocks.handleCreateFolder).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_manage_folders', { action: 'list' });
    expect(handlerMocks.handleListFolders).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_manage_folders', { action: 'get', folderId: 'f1' });
    expect(handlerMocks.handleGetFolder).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_manage_folders', { action: 'rename', folderId: 'f1', name: 'Y' });
    expect(handlerMocks.handleRenameFolder).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_manage_folders', { action: 'move', folderId: 'f1', parentFolderId: null });
    expect(handlerMocks.handleMoveFolder).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_manage_folders', { action: 'delete', folderId: 'f1' });
    expect(handlerMocks.handleDeleteFolder).toHaveBeenCalledTimes(1);
  });

  it('forwards args untouched so null parentFolderId survives to the handler', async () => {
    await server.testExecuteTool('n8n_manage_folders', {
      action: 'move',
      folderId: 'f1',
      parentFolderId: null,
    });

    expect(handlerMocks.handleMoveFolder).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'f1', parentFolderId: null }),
      undefined
    );
  });

  it('rejects a missing action before reaching any handler', async () => {
    await expect(
      server.testExecuteTool('n8n_manage_folders', {})
    ).rejects.toThrow(/action/);

    expect(handlerMocks.handleCreateFolder).not.toHaveBeenCalled();
    expect(handlerMocks.handleListFolders).not.toHaveBeenCalled();
  });

  it('lists the valid actions in the unknown-action error', async () => {
    await expect(
      server.testExecuteTool('n8n_manage_folders', { action: 'nope' })
    ).rejects.toThrow('create, list, get, rename, move, delete');
  });
});
