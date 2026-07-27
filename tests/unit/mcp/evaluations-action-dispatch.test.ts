import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the handler module so we can detect which handler the server routes to
// for each action of n8n_evaluations. vi.hoisted lifts the spy declarations above
// the vi.mock call (vi.mock is itself hoisted above the import below).
const handlerMocks = vi.hoisted(() => ({
  handleListTestRuns: vi.fn().mockResolvedValue({ success: true, data: { action: 'list_runs' } }),
  handleGetTestRun: vi.fn().mockResolvedValue({ success: true, data: { action: 'get_run' } }),
  handleListTestCases: vi.fn().mockResolvedValue({ success: true, data: { action: 'list_cases' } }),
  handleTriggerTestRun: vi.fn().mockResolvedValue({ success: true, data: { action: 'run' } }),
  handleCancelTestRun: vi.fn().mockResolvedValue({ success: true, data: { action: 'cancel' } }),
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

describe('n8n_evaluations action dispatch', () => {
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

  it('routes action="run" to handleTriggerTestRun', async () => {
    // The global afterEach (tests/setup/global-setup.ts) runs vi.restoreAllMocks(), which
    // strips the hoisted mockResolvedValue after the first test. Re-apply it here so the
    // returned-data assertion is order-independent.
    handlerMocks.handleTriggerTestRun.mockResolvedValue({ success: true, data: { action: 'run' } });

    const result = await server.testExecuteTool('n8n_evaluations', { action: 'run', workflowId: 'wf1' });

    expect(handlerMocks.handleTriggerTestRun).toHaveBeenCalledTimes(1);
    expect(handlerMocks.handleTriggerTestRun).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf1' }),
      undefined
    );
    expect(handlerMocks.handleCancelTestRun).not.toHaveBeenCalled();
    expect(handlerMocks.handleListTestRuns).not.toHaveBeenCalled();
    expect(result.data.action).toBe('run');
  });

  it('routes action="cancel" to handleCancelTestRun', async () => {
    handlerMocks.handleCancelTestRun.mockResolvedValue({ success: true, data: { action: 'cancel' } });

    const result = await server.testExecuteTool('n8n_evaluations', {
      action: 'cancel',
      workflowId: 'wf1',
      runId: 'run1',
    });

    expect(handlerMocks.handleCancelTestRun).toHaveBeenCalledTimes(1);
    expect(handlerMocks.handleCancelTestRun).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf1', runId: 'run1' }),
      undefined
    );
    expect(handlerMocks.handleTriggerTestRun).not.toHaveBeenCalled();
    expect(result.data.action).toBe('cancel');
  });

  it('rejects action="cancel" without a runId before reaching the handler', async () => {
    await expect(
      server.testExecuteTool('n8n_evaluations', { action: 'cancel', workflowId: 'wf1' })
    ).rejects.toThrow('runId is required for action=cancel');

    expect(handlerMocks.handleCancelTestRun).not.toHaveBeenCalled();
  });

  it('does not require a runId for action="run"', async () => {
    await server.testExecuteTool('n8n_evaluations', { action: 'run', workflowId: 'wf1' });

    expect(handlerMocks.handleTriggerTestRun).toHaveBeenCalledTimes(1);
  });

  it('routes the read actions to their own handlers', async () => {
    await server.testExecuteTool('n8n_evaluations', { action: 'list_runs', workflowId: 'wf1' });
    expect(handlerMocks.handleListTestRuns).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_evaluations', { action: 'get_run', workflowId: 'wf1', runId: 'run1' });
    expect(handlerMocks.handleGetTestRun).toHaveBeenCalledTimes(1);

    await server.testExecuteTool('n8n_evaluations', { action: 'list_cases', workflowId: 'wf1', runId: 'run1' });
    expect(handlerMocks.handleListTestCases).toHaveBeenCalledTimes(1);

    expect(handlerMocks.handleTriggerTestRun).not.toHaveBeenCalled();
    expect(handlerMocks.handleCancelTestRun).not.toHaveBeenCalled();
  });

  it('lists the write actions as valid in the unknown-action error', async () => {
    await expect(
      server.testExecuteTool('n8n_evaluations', { action: 'nope', workflowId: 'wf1' })
    ).rejects.toThrow('list_runs, get_run, list_cases, run, cancel');
  });
});
