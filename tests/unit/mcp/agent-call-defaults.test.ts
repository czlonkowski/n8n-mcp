import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Issue #1051: the most frequent agent call errors came from missing defaults
// and retired parameter names. These tests pin the server-level dispatch:
// n8n_executions defaults action to list and serves get-without-id as a
// listing; n8n_workflow_versions and n8n_test_workflow accept id for workflowId.
const handlerMocks = vi.hoisted(() => ({
  handleGetExecution: vi.fn().mockResolvedValue({ success: true, data: { handler: 'get' } }),
  handleListExecutions: vi.fn().mockResolvedValue({ success: true, data: { handler: 'list' } }),
  handleDeleteExecution: vi.fn().mockResolvedValue({ success: true, data: { handler: 'delete' } }),
  handleWorkflowVersions: vi.fn().mockResolvedValue({ success: true, data: { handler: 'versions' } }),
  handleTestWorkflow: vi.fn().mockResolvedValue({ success: true, data: { handler: 'test' } }),
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

describe('agent call defaults and aliases (#1051)', () => {
  let server: TestableServer;

  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
    process.env.N8N_API_URL = 'https://example.invalid';
    process.env.N8N_API_KEY = 'test-key';
    delete process.env.DISABLED_TOOL_OPERATIONS;
    server = new TestableServer();
    vi.clearAllMocks();
    // The global afterEach runs vi.restoreAllMocks(), which strips the hoisted
    // resolved values; re-apply them so every test sees the same handler results.
    handlerMocks.handleGetExecution.mockResolvedValue({ success: true, data: { handler: 'get' } });
    handlerMocks.handleListExecutions.mockResolvedValue({ success: true, data: { handler: 'list' } });
    handlerMocks.handleDeleteExecution.mockResolvedValue({ success: true, data: { handler: 'delete' } });
    handlerMocks.handleWorkflowVersions.mockResolvedValue({ success: true, data: { handler: 'versions' } });
    handlerMocks.handleTestWorkflow.mockResolvedValue({ success: true, data: { handler: 'test' } });
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
    delete process.env.N8N_API_URL;
    delete process.env.N8N_API_KEY;
    delete process.env.DISABLED_TOOL_OPERATIONS;
  });

  describe('n8n_executions', () => {
    it('lists executions when action is omitted', async () => {
      const result = await server.testExecuteTool('n8n_executions', { workflowId: 'wf1' });

      expect(handlerMocks.handleListExecutions).toHaveBeenCalledTimes(1);
      expect(handlerMocks.handleListExecutions).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf1' }),
        undefined
      );
      expect(handlerMocks.handleGetExecution).not.toHaveBeenCalled();
      expect(result.data.handler).toBe('list');
      expect(result.message).toBeUndefined();
    });

    it('lists executions when called with no arguments at all', async () => {
      const result = await server.testExecuteTool('n8n_executions', {});
      expect(handlerMocks.handleListExecutions).toHaveBeenCalledTimes(1);
      expect(result.data.handler).toBe('list');
    });

    it('treats a blank action as omitted', async () => {
      await server.testExecuteTool('n8n_executions', { action: '  ' });
      expect(handlerMocks.handleListExecutions).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-string action rather than silently defaulting past the policy gate', async () => {
      await expect(server.testExecuteTool('n8n_executions', { action: 42 }))
        .rejects.toThrow('Unknown action: 42');
      expect(handlerMocks.handleListExecutions).not.toHaveBeenCalled();
    });

    it('serves get without id as a listing of the workflow and says so', async () => {
      const result = await server.testExecuteTool('n8n_executions', { action: 'get', workflowId: 'wf1' });

      expect(handlerMocks.handleGetExecution).not.toHaveBeenCalled();
      expect(handlerMocks.handleListExecutions).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf1' }),
        undefined
      );
      expect(result.success).toBe(true);
      expect(result.data.handler).toBe('list');
      expect(result.message).toContain('without an execution id');
      expect(result.message).toContain('workflow wf1');
      expect(result.message).toContain('Pass id');
    });

    it('serves get without id or workflowId as a listing of recent executions', async () => {
      const result = await server.testExecuteTool('n8n_executions', { action: 'get' });

      expect(handlerMocks.handleListExecutions).toHaveBeenCalledTimes(1);
      expect(result.message).toContain('recent executions');
    });

    it('treats a blank id as absent and a blank workflowId as unscoped', async () => {
      const result = await server.testExecuteTool('n8n_executions', { action: 'get', id: '   ', workflowId: '  ' });

      expect(handlerMocks.handleGetExecution).not.toHaveBeenCalled();
      expect(handlerMocks.handleListExecutions).toHaveBeenCalledTimes(1);
      expect(result.message).toContain('recent executions');
      expect(result.message).not.toContain('executions of workflow');
    });

    it('does not decorate a failed listing with the fallback note', async () => {
      handlerMocks.handleListExecutions.mockResolvedValue({ success: false, error: 'n8n API not configured' });

      const result = await server.testExecuteTool('n8n_executions', { action: 'get' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('n8n API not configured');
      expect(result.message).toBeUndefined();
    });

    it('still routes get with an id to handleGetExecution', async () => {
      const result = await server.testExecuteTool('n8n_executions', { action: 'get', id: 'exec1' });

      expect(handlerMocks.handleGetExecution).toHaveBeenCalledTimes(1);
      expect(handlerMocks.handleListExecutions).not.toHaveBeenCalled();
      expect(result.data.handler).toBe('get');
    });

    it('keeps delete strict about id', async () => {
      await expect(server.testExecuteTool('n8n_executions', { action: 'delete', workflowId: 'wf1' }))
        .rejects.toThrow('id is required for action=delete');
      await expect(server.testExecuteTool('n8n_executions', { action: 'delete', id: '   ' }))
        .rejects.toThrow('id is required for action=delete');
      expect(handlerMocks.handleDeleteExecution).not.toHaveBeenCalled();
      expect(handlerMocks.handleListExecutions).not.toHaveBeenCalled();
    });

    it('suggests list for get_many and names the owning tool for foreign vocabulary', async () => {
      await expect(server.testExecuteTool('n8n_executions', { action: 'get_many' }))
        .rejects.toThrow("Unknown action: get_many. Valid actions: get, list, delete. Did you mean action='list'?");
      await expect(server.testExecuteTool('n8n_executions', { action: 'list_runs' }))
        .rejects.toThrow(/Unknown action: list_runs.*n8n_evaluations/);
      await expect(server.testExecuteTool('n8n_executions', { action: 'frobnicate' }))
        .rejects.toThrow('Unknown action: frobnicate. Valid actions: get, list, delete.');
    });

    it('applies a disabled-operation rule to the defaulted list action', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:list';
      const { resetToolPolicyCache } = await import('../../../src/mcp/tool-policy');
      resetToolPolicyCache();

      await expect(server.testExecuteTool('n8n_executions', {})).rejects.toThrow(/disabled/i);
      expect(handlerMocks.handleListExecutions).not.toHaveBeenCalled();
      resetToolPolicyCache();
    });

    it('does not let get without id open a listing that policy has disabled', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:list';
      const { resetToolPolicyCache } = await import('../../../src/mcp/tool-policy');
      resetToolPolicyCache();

      await expect(server.testExecuteTool('n8n_executions', { action: 'get', workflowId: 'wf1' }))
        .rejects.toThrow('id is required for action=get');
      expect(handlerMocks.handleListExecutions).not.toHaveBeenCalled();
      resetToolPolicyCache();
    });

    it('drops the schema default when policy disables the defaulted operation', async () => {
      const disabled = new Map([['n8n_executions', new Set(['list'])]]);
      const filtered = (server as any).buildFilteredToolDefinitions(disabled);
      const action = filtered.get('n8n_executions').inputSchema.properties.action;
      expect(action.enum).toEqual(['get', 'delete']);
      expect(action.default).toBeUndefined();
      expect(action.description).toContain('disabled by server policy: list; no default, pass a value)');
      expect(filtered.get('n8n_executions').description).toContain('The default for action was one of them, so action must be passed explicitly.');

      const untouched = (server as any).buildFilteredToolDefinitions(new Map([['n8n_executions', new Set(['delete'])]]));
      expect(untouched.get('n8n_executions').inputSchema.properties.action.default).toBe('list');
    });
  });

  describe('n8n_workflow_versions', () => {
    it('no longer requires mode at the server layer', async () => {
      const result = await server.testExecuteTool('n8n_workflow_versions', { workflowId: 'wf1' });

      expect(handlerMocks.handleWorkflowVersions).toHaveBeenCalledTimes(1);
      expect(handlerMocks.handleWorkflowVersions.mock.calls[0][0]).toEqual({ workflowId: 'wf1' });
      expect(result.data.handler).toBe('versions');
    });

    it('fills workflowId from id', async () => {
      await server.testExecuteTool('n8n_workflow_versions', { id: 'wf1' });

      expect(handlerMocks.handleWorkflowVersions.mock.calls[0][0]).toEqual({ id: 'wf1', workflowId: 'wf1' });
    });

    it('drops a blank workflowId so the handler reports it as missing', async () => {
      await server.testExecuteTool('n8n_workflow_versions', { workflowId: '   ' });

      expect(handlerMocks.handleWorkflowVersions.mock.calls[0][0]).toEqual({ workflowId: undefined });
    });

    it('keeps an explicit workflowId when both spellings are sent', async () => {
      await server.testExecuteTool('n8n_workflow_versions', { mode: 'list', id: 'x', workflowId: 'wf1' });

      expect(handlerMocks.handleWorkflowVersions.mock.calls[0][0]).toEqual({ mode: 'list', id: 'x', workflowId: 'wf1' });
    });

    it('applies a disabled-operation rule to the defaulted list mode', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:list';
      const { resetToolPolicyCache } = await import('../../../src/mcp/tool-policy');
      resetToolPolicyCache();

      await expect(server.testExecuteTool('n8n_workflow_versions', { workflowId: 'wf1' })).rejects.toThrow(/disabled/i);
      expect(handlerMocks.handleWorkflowVersions).not.toHaveBeenCalled();
      resetToolPolicyCache();
    });
  });

  describe('n8n_test_workflow', () => {
    it('accepts id as an alias for workflowId', async () => {
      const result = await server.testExecuteTool('n8n_test_workflow', { id: 'wf1' });

      expect(handlerMocks.handleTestWorkflow).toHaveBeenCalledTimes(1);
      expect(handlerMocks.handleTestWorkflow.mock.calls[0][0]).toEqual({ id: 'wf1', workflowId: 'wf1' });
      expect(result.data.handler).toBe('test');
    });

    it('names the parameter and the alias when neither spelling is sent', async () => {
      await expect(server.testExecuteTool('n8n_test_workflow', { method: 'prepare' }))
        .rejects.toThrow('n8n_test_workflow: Validation failed:\n  • workflowId: workflowId is required: the ID of the workflow to run ("id" is accepted as an alias)');
      expect(handlerMocks.handleTestWorkflow).not.toHaveBeenCalled();
    });

    it('treats an empty or blank workflowId as missing', async () => {
      await expect(server.testExecuteTool('n8n_test_workflow', { workflowId: '' }))
        .rejects.toThrow('workflowId is required');
      await expect(server.testExecuteTool('n8n_test_workflow', { workflowId: '   ' }))
        .rejects.toThrow('workflowId is required');
      expect(handlerMocks.handleTestWorkflow).not.toHaveBeenCalled();
    });

    it('uses the id alias when workflowId is blank', async () => {
      await server.testExecuteTool('n8n_test_workflow', { workflowId: '  ', id: 'wf1' });
      expect(handlerMocks.handleTestWorkflow.mock.calls[0][0]).toMatchObject({ workflowId: 'wf1' });
    });
  });
});
