import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the handler module so we can detect which handler the server routes to
// for each mode of n8n_get_workflow. vi.hoisted lifts the spy declarations above
// the vi.mock call (vi.mock is itself hoisted above the import below).
const handlerMocks = vi.hoisted(() => ({
  handleGetWorkflow: vi.fn().mockResolvedValue({ success: true, data: { mode: 'full' } }),
  handleGetWorkflowDetails: vi.fn().mockResolvedValue({ success: true, data: { mode: 'details' } }),
  handleGetWorkflowStructure: vi.fn().mockResolvedValue({ success: true, data: { mode: 'structure' } }),
  handleGetWorkflowMinimal: vi.fn().mockResolvedValue({ success: true, data: { mode: 'minimal' } }),
  handleGetWorkflowActive: vi.fn().mockResolvedValue({ success: true, data: { mode: 'active' } }),
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

describe('n8n_get_workflow mode dispatch', () => {
  let server: TestableServer;

  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
    process.env.N8N_API_URL = 'https://example.invalid';
    process.env.N8N_API_KEY = 'test-key';
    server = new TestableServer();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
  });

  it('routes mode="active" to handleGetWorkflowActive', async () => {
    const result = await server.testExecuteTool('n8n_get_workflow', { id: 'wf-1', mode: 'active' });

    expect(handlerMocks.handleGetWorkflowActive).toHaveBeenCalledTimes(1);
    expect(handlerMocks.handleGetWorkflow).not.toHaveBeenCalled();
    expect(handlerMocks.handleGetWorkflowDetails).not.toHaveBeenCalled();
    expect(result.data.mode).toBe('active');
  });

  it('routes omitted mode (default) to handleGetWorkflow', async () => {
    await server.testExecuteTool('n8n_get_workflow', { id: 'wf-1' });

    expect(handlerMocks.handleGetWorkflow).toHaveBeenCalledTimes(1);
    expect(handlerMocks.handleGetWorkflowActive).not.toHaveBeenCalled();
  });

  it('routes mode="details" to handleGetWorkflowDetails', async () => {
    await server.testExecuteTool('n8n_get_workflow', { id: 'wf-1', mode: 'details' });

    expect(handlerMocks.handleGetWorkflowDetails).toHaveBeenCalledTimes(1);
    expect(handlerMocks.handleGetWorkflowActive).not.toHaveBeenCalled();
  });
});
