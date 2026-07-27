import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { n8nManagementTools } from '../../../src/mcp/tools-n8n-manager';
import { getToolDocumentation } from '../../../src/mcp/tools-documentation';
import { logger } from '../../../src/utils/logger';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

class TestableN8NMCPServer extends N8NDocumentationMCPServer {
  public testGetDisabledToolOperations(): Map<string, Set<string>> {
    return (this as any).getDisabledToolOperations();
  }

  public testBuildFilteredToolDefinitions(disabledOps: Map<string, Set<string>>): Map<string, any> {
    return (this as any).buildFilteredToolDefinitions(disabledOps);
  }

  public async testExecuteTool(name: string, args: any): Promise<any> {
    return (this as any).executeTool(name, args);
  }
}

describe('Disabled Tool Operations Feature (Issue #714)', () => {
  let server: TestableN8NMCPServer;

  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
    delete process.env.DISABLED_TOOL_OPERATIONS;
    delete process.env.DISABLED_TOOLS;
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
    delete process.env.DISABLED_TOOL_OPERATIONS;
    delete process.env.DISABLED_TOOLS;
  });

  // ---------------------------------------------------------------------------
  // 1. Parser — getDisabledToolOperations()
  // ---------------------------------------------------------------------------

  describe('getDisabledToolOperations() - Environment Variable Parsing', () => {
    it('should return empty map when DISABLED_TOOL_OPERATIONS is not set', () => {
      server = new TestableN8NMCPServer();
      expect(server.testGetDisabledToolOperations().size).toBe(0);
    });

    it('should return empty map when DISABLED_TOOL_OPERATIONS is empty string', () => {
      process.env.DISABLED_TOOL_OPERATIONS = '';
      server = new TestableN8NMCPServer();
      expect(server.testGetDisabledToolOperations().size).toBe(0);
    });

    it('should parse single tool with single operation', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      expect(ops.size).toBe(1);
      expect(ops.get('n8n_executions')).toEqual(new Set(['delete']));
    });

    it('should parse single tool with multiple operations', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:delete,rollback,prune';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      expect(ops.size).toBe(1);
      const versionOps = ops.get('n8n_workflow_versions')!;
      expect(versionOps.has('delete')).toBe(true);
      expect(versionOps.has('rollback')).toBe(true);
      expect(versionOps.has('prune')).toBe(true);
      expect(versionOps.size).toBe(3);
    });

    it('should parse operation names case-insensitively', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:Delete,ROLLBACK';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      const versionOps = ops.get('n8n_workflow_versions')!;
      expect(versionOps.has('delete')).toBe(true);
      expect(versionOps.has('rollback')).toBe(true);
    });

    it('should parse multiple tools separated by semicolons', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:delete,rollback,prune;n8n_executions:delete';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      expect(ops.size).toBe(2);
      expect(ops.get('n8n_workflow_versions')!.size).toBe(3);
      expect(ops.get('n8n_executions')).toEqual(new Set(['delete']));
    });

    it('should trim whitespace from tool names and operations', () => {
      process.env.DISABLED_TOOL_OPERATIONS = '  n8n_executions  :  delete  ,  list  ';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      const execOps = ops.get('n8n_executions')!;
      expect(execOps.has('delete')).toBe(true);
      expect(execOps.has('list')).toBe(true);
    });

    it('should filter out empty operation entries', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete,,list,,,';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      const execOps = ops.get('n8n_executions')!;
      expect(execOps.size).toBe(2);
      expect(execOps.has('delete')).toBe(true);
      expect(execOps.has('list')).toBe(true);
    });

    it('should skip entries missing a colon separator', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions_no_colon;n8n_workflow_versions:delete';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      expect(ops.has('n8n_executions_no_colon')).toBe(false);
      expect(ops.has('n8n_workflow_versions')).toBe(true);
    });

    it('should skip entries with empty operations after colon', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:;n8n_workflow_versions:delete';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      expect(ops.has('n8n_executions')).toBe(false);
      expect(ops.has('n8n_workflow_versions')).toBe(true);
    });

    it('should enforce 50-entry limit', () => {
      const entries = Array.from({ length: 60 }, (_, i) => `tool_${i}:op`).join(';');
      process.env.DISABLED_TOOL_OPERATIONS = entries;
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      expect(ops.size).toBeLessThanOrEqual(50);
    });

    it('should enforce 10KB size limit on env var', () => {
      const longValue = Array.from({ length: 1000 }, (_, i) => `tool_${i}:delete`).join(';');
      expect(longValue.length).toBeGreaterThan(10000);

      process.env.DISABLED_TOOL_OPERATIONS = longValue;
      server = new TestableN8NMCPServer();

      // Should not throw and should have parsed some entries
      expect(server.testGetDisabledToolOperations().size).toBeGreaterThan(0);
    });

    it('should return cached result on repeated calls', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      const first = server.testGetDisabledToolOperations();
      const second = server.testGetDisabledToolOperations();

      expect(first).toBe(second);
    });

    it('should normalise uppercase operation names in env var to lowercase', () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:DELETE,List';
      server = new TestableN8NMCPServer();
      const ops = server.testGetDisabledToolOperations();

      const execOps = ops.get('n8n_executions')!;
      expect(execOps.has('delete')).toBe(true);
      expect(execOps.has('list')).toBe(true);
      expect(execOps.has('DELETE')).toBe(false);
      expect(execOps.has('List')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Dispatch enforcement — n8n_executions
  // ---------------------------------------------------------------------------

  describe('executeTool() - Dispatch Enforcement for n8n_executions', () => {
    it('should throw with exact error message when delete is disabled', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      await expect(
        server.testExecuteTool('n8n_executions', { action: 'delete', id: '123' })
      ).rejects.toThrow("Operation 'delete' on tool 'n8n_executions' is disabled by server policy");
    });

    it('should not block allowed operations when only delete is disabled', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      for (const action of ['get', 'list']) {
        try {
          await server.testExecuteTool('n8n_executions', { action });
        } catch (error: any) {
          expect(error.message).not.toContain('disabled by server policy');
        }
      }
    });

    it('should include the tool name and operation in the error', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      let message = '';
      try {
        await server.testExecuteTool('n8n_executions', { action: 'delete', id: '123' });
      } catch (error: any) {
        message = error.message;
      }

      expect(message).toContain('delete');
      expect(message).toContain('n8n_executions');
    });

    it('should block uppercase operation from client when lowercase rule is configured', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      await expect(
        server.testExecuteTool('n8n_executions', { action: 'DELETE', id: '123' })
      ).rejects.toThrow("Operation 'DELETE' on tool 'n8n_executions' is disabled by server policy");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Dispatch enforcement — n8n_workflow_versions
  // ---------------------------------------------------------------------------

  describe('executeTool() - Dispatch Enforcement for n8n_workflow_versions', () => {
    it('should block all destructive operations', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:delete,rollback,prune';
      server = new TestableN8NMCPServer();

      for (const mode of ['delete', 'rollback', 'prune']) {
        await expect(
          server.testExecuteTool('n8n_workflow_versions', { mode })
        ).rejects.toThrow(`Operation '${mode}' on tool 'n8n_workflow_versions' is disabled by server policy`);
      }
    });

    it('should not block read operations when destructive ops are disabled', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:delete,rollback,prune';
      server = new TestableN8NMCPServer();

      for (const mode of ['list', 'get']) {
        try {
          await server.testExecuteTool('n8n_workflow_versions', { mode, workflowId: 'abc' });
        } catch (error: any) {
          expect(error.message).not.toContain('disabled by server policy');
        }
      }
    });

    it('should use mode param (not action) for n8n_workflow_versions', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:delete';
      server = new TestableN8NMCPServer();

      await expect(
        server.testExecuteTool('n8n_workflow_versions', { mode: 'delete', workflowId: 'abc' })
      ).rejects.toThrow("Operation 'delete' on tool 'n8n_workflow_versions' is disabled by server policy");
    });
  });

  // ---------------------------------------------------------------------------
  // 3b. Dispatch enforcement — n8n_evaluations
  // ---------------------------------------------------------------------------

  describe('executeTool() - Dispatch Enforcement for n8n_evaluations', () => {
    it('should block the write actions', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_evaluations:run,cancel';
      server = new TestableN8NMCPServer();

      for (const action of ['run', 'cancel']) {
        await expect(
          server.testExecuteTool('n8n_evaluations', { action, workflowId: 'abc', runId: 'run1' })
        ).rejects.toThrow(`Operation '${action}' on tool 'n8n_evaluations' is disabled by server policy`);
      }
    });

    it('should not block read actions when the write actions are disabled', async () => {
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_evaluations:run,cancel';
      server = new TestableN8NMCPServer();

      for (const action of ['list_runs', 'get_run', 'list_cases']) {
        try {
          await server.testExecuteTool('n8n_evaluations', { action, workflowId: 'abc', runId: 'run1' });
        } catch (error: any) {
          expect(error.message).not.toContain('disabled by server policy');
        }
      }
    });

    it('should recompute annotations to read-only when run and cancel are disabled', () => {
      const disabledOps = new Map([['n8n_evaluations', new Set(['run', 'cancel'])]]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_evaluations');
      const enumValues: string[] = filtered.inputSchema.properties.action.enum;
      expect(enumValues).not.toContain('run');
      expect(enumValues).not.toContain('cancel');
      expect(enumValues).toContain('list_runs');
      expect(filtered.annotations.readOnlyHint).toBe(true);
      expect(filtered.annotations.destructiveHint).toBe(false);
    });

    it('should keep the tool writable when only run is disabled', () => {
      const disabledOps = new Map([['n8n_evaluations', new Set(['run'])]]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_evaluations');
      expect(filtered.annotations.readOnlyHint).toBe(false);
      expect(filtered.annotations.destructiveHint).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Interaction with DISABLED_TOOLS
  // ---------------------------------------------------------------------------

  describe('Interaction with DISABLED_TOOLS', () => {
    it('should block at tool level when tool is in DISABLED_TOOLS, not operation level', async () => {
      process.env.DISABLED_TOOLS = 'n8n_executions';
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      await expect(
        server.testExecuteTool('n8n_executions', { action: 'delete', id: '123' })
      ).rejects.toThrow("Tool 'n8n_executions' is disabled via DISABLED_TOOLS environment variable");
    });

    it('should allow DISABLED_TOOLS and DISABLED_TOOL_OPERATIONS to target different tools', async () => {
      process.env.DISABLED_TOOLS = 'n8n_delete_workflow';
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      // Tool-level block still works
      await expect(
        server.testExecuteTool('n8n_delete_workflow', {})
      ).rejects.toThrow('disabled via DISABLED_TOOLS');

      // Operation-level block still works on the other tool
      await expect(
        server.testExecuteTool('n8n_executions', { action: 'delete', id: '123' })
      ).rejects.toThrow('disabled by server policy');
    });

    it('should work correctly when only DISABLED_TOOL_OPERATIONS is set', async () => {
      delete process.env.DISABLED_TOOLS;
      process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete';
      server = new TestableN8NMCPServer();

      await expect(
        server.testExecuteTool('n8n_executions', { action: 'delete', id: '123' })
      ).rejects.toThrow('disabled by server policy');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Schema filtering — buildFilteredToolDefinitions()
  // ---------------------------------------------------------------------------

  describe('buildFilteredToolDefinitions() - Schema Mutation Safety', () => {
    it('should remove disabled operation from n8n_executions action enum', () => {
      const disabledOps = new Map([['n8n_executions', new Set(['delete'])]]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_executions');
      expect(filtered).toBeDefined();
      const enumValues: string[] = filtered.inputSchema.properties.action.enum;
      expect(enumValues).not.toContain('delete');
      expect(enumValues).toContain('get');
      expect(enumValues).toContain('list');
    });

    it('should remove disabled operations from n8n_workflow_versions mode enum', () => {
      const disabledOps = new Map([
        ['n8n_workflow_versions', new Set(['delete', 'rollback', 'prune'])]
      ]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_workflow_versions');
      const enumValues: string[] = filtered.inputSchema.properties.mode.enum;
      expect(enumValues).not.toContain('delete');
      expect(enumValues).not.toContain('rollback');
      expect(enumValues).not.toContain('prune');
      expect(enumValues).toContain('list');
      expect(enumValues).toContain('get');
    });

    it('should recompute annotations to read-only when all destructive ops are disabled', () => {
      const disabledOps = new Map([
        ['n8n_workflow_versions', new Set(['delete', 'rollback', 'prune'])]
      ]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_workflow_versions');
      // Only read modes (list/get) remain → tool is effectively read-only.
      expect(filtered.annotations.readOnlyHint).toBe(true);
      expect(filtered.annotations.destructiveHint).toBe(false);
    });

    it('should keep destructiveHint when a destructive op remains', () => {
      // Only 'delete' disabled; 'rollback'/'prune' still available → still destructive.
      const disabledOps = new Map([
        ['n8n_workflow_versions', new Set(['delete'])]
      ]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_workflow_versions');
      expect(filtered.annotations.destructiveHint).toBe(true);
      expect(filtered.annotations.readOnlyHint).toBe(false);
    });

    it('should NOT mutate the original n8nManagementTools definitions', () => {
      const originalExec = n8nManagementTools.find(t => t.name === 'n8n_executions')!;
      const originalEnum = [...(originalExec.inputSchema as any).properties.action.enum];

      const disabledOps = new Map([['n8n_executions', new Set(['delete'])]]);
      server = new TestableN8NMCPServer();
      server.testBuildFilteredToolDefinitions(disabledOps);

      const afterEnum = (originalExec.inputSchema as any).properties.action.enum;
      expect(afterEnum).toEqual(originalEnum);
    });

    it('should produce no cache entry for unknown tool names', () => {
      const disabledOps = new Map([['n8n_nonexistent_tool', new Set(['delete'])]]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      expect(cache.has('n8n_nonexistent_tool')).toBe(false);
    });

    it('should include disabled ops notice in tool description', () => {
      const disabledOps = new Map([['n8n_executions', new Set(['delete'])]]);
      server = new TestableN8NMCPServer();
      const cache = server.testBuildFilteredToolDefinitions(disabledOps);

      const filtered = cache.get('n8n_executions');
      expect(filtered.description).toContain('disabled by server policy');
      expect(filtered.description).toContain('delete');
    });

    it('should warn when all operations for a tool are disabled', () => {
      const disabledOps = new Map([
        ['n8n_executions', new Set(['get', 'list', 'delete'])]
      ]);
      server = new TestableN8NMCPServer();
      server.testBuildFilteredToolDefinitions(disabledOps);

      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("all operations for 'n8n_executions' are disabled")
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6. tools_documentation notice
  // ---------------------------------------------------------------------------

  describe('getToolDocumentation() - Disabled Operations Notice', () => {
    it('should include server policy notice when operations are disabled (essentials)', () => {
      const result = getToolDocumentation('n8n_executions', 'essentials', new Set(['delete']));
      expect(result).toContain('Server policy');
      expect(result).toContain('delete');
    });

    it('should include server policy notice in full depth', () => {
      const result = getToolDocumentation('n8n_executions', 'full', new Set(['delete']));
      expect(result).toContain('Server policy');
      expect(result).toContain('delete');
    });

    it('should not include notice when no operations are disabled', () => {
      const result = getToolDocumentation('n8n_executions', 'essentials');
      expect(result).not.toContain('Server policy');
    });

    it('should list all disabled operations in the notice', () => {
      const result = getToolDocumentation(
        'n8n_workflow_versions',
        'essentials',
        new Set(['delete', 'rollback', 'prune'])
      );
      expect(result).toContain('delete');
      expect(result).toContain('rollback');
      expect(result).toContain('prune');
    });
  });
});
