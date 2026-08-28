import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

/**
 * A synthetic multi-operation tool whose destructive set contains a VIRTUAL
 * operation — `expose`, which is not a selectable value of its operation
 * parameter (it stands for "enabling Available in MCP through exposeToMcp").
 * Injecting it here keeps the virtual-operation rule under test without
 * depending on which real tools happen to declare one.
 */
vi.mock('../../../src/mcp/tools-n8n-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/mcp/tools-n8n-manager')>();
  const probeTool = {
    name: 'n8n_probe_tool',
    description: 'Synthetic tool used by the policy tests',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', enum: ['auto', 'trigger', 'pinned', 'direct'], description: 'How to run' },
      },
    },
    annotations: { title: 'Probe', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  };
  return {
    ...actual,
    n8nManagementTools: [...actual.n8nManagementTools, probeTool],
    TOOL_OPERATION_PARAM: { ...actual.TOOL_OPERATION_PARAM, n8n_probe_tool: 'method' },
    DESTRUCTIVE_TOOL_OPERATIONS: {
      ...actual.DESTRUCTIVE_TOOL_OPERATIONS,
      n8n_probe_tool: new Set(['trigger', 'pinned', 'direct', 'expose']),
    },
  };
});

import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { logger } from '../../../src/utils/logger';
import {
  getDisabledTools,
  isToolDisabled,
  getDisabledToolOperations,
  getDisabledOperations,
  isOperationDisabled,
  getValidOperations,
  resetToolPolicyCache,
} from '../../../src/mcp/tool-policy';

class TestableN8NMCPServer extends N8NDocumentationMCPServer {
  public testBuildFilteredToolDefinitions(disabledOps: Map<string, Set<string>>): Map<string, any> {
    return (this as any).buildFilteredToolDefinitions(disabledOps);
  }
}

beforeEach(() => {
  process.env.NODE_DB_PATH = ':memory:';
  delete process.env.DISABLED_TOOLS;
  delete process.env.DISABLED_TOOL_OPERATIONS;
  resetToolPolicyCache();
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.NODE_DB_PATH;
  delete process.env.DISABLED_TOOLS;
  delete process.env.DISABLED_TOOL_OPERATIONS;
  resetToolPolicyCache();
});

describe('getDisabledTools', () => {
  it('is empty when the variable is unset', () => {
    expect(getDisabledTools().size).toBe(0);
    expect(isToolDisabled('n8n_update_partial_workflow')).toBe(false);
  });

  it('parses a comma-separated list and trims entries', () => {
    process.env.DISABLED_TOOLS = ' n8n_update_partial_workflow , n8n_delete_workflow ,,';
    expect([...getDisabledTools()]).toEqual(['n8n_update_partial_workflow', 'n8n_delete_workflow']);
    expect(isToolDisabled('n8n_delete_workflow')).toBe(true);
  });

  it('re-parses when the environment value changes', () => {
    process.env.DISABLED_TOOLS = 'n8n_delete_workflow';
    expect(isToolDisabled('n8n_delete_workflow')).toBe(true);
    process.env.DISABLED_TOOLS = 'n8n_executions';
    expect(isToolDisabled('n8n_delete_workflow')).toBe(false);
    expect(isToolDisabled('n8n_executions')).toBe(true);
  });

  it('caps the list at 200 entries', () => {
    process.env.DISABLED_TOOLS = Array.from({ length: 250 }, (_, i) => `tool_${i}`).join(',');
    expect(getDisabledTools().size).toBe(200);
  });
});

describe('getDisabledOperations', () => {
  it('is empty for a tool with no rule', () => {
    expect(getDisabledOperations('n8n_executions').size).toBe(0);
    expect(isOperationDisabled('n8n_executions', 'delete')).toBe(false);
  });

  it('lowercases operation names', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:Delete,ROLLBACK';
    expect([...getDisabledOperations('n8n_workflow_versions')]).toEqual(['delete', 'rollback']);
    expect(isOperationDisabled('n8n_workflow_versions', 'DELETE')).toBe(true);
  });

  it('keeps unknown tools out of the way of the tools that do have rules', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'not_a_tool:delete;n8n_executions:delete';
    expect(getDisabledOperations('not_a_tool').has('delete')).toBe(true);
    expect(isOperationDisabled('n8n_executions', 'delete')).toBe(true);
    // The unknown tool is reported so a typo is visible rather than silent.
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining("unknown tool 'not_a_tool'"));
  });

  it('parses several tools separated by semicolons', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_executions:delete;n8n_workflow_versions:delete,prune';
    const all = getDisabledToolOperations();
    expect(all.size).toBe(2);
    expect(all.get('n8n_workflow_versions')).toEqual(new Set(['delete', 'prune']));
  });
});

describe('virtual operations (enum union destructive set)', () => {
  it('reports the union as the valid operations for a tool', () => {
    expect(getValidOperations('n8n_probe_tool')).toEqual(new Set(['auto', 'trigger', 'pinned', 'direct', 'expose']));
  });

  it('accepts a virtual operation without a "no effect" warning', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_probe_tool:expose';
    expect(isOperationDisabled('n8n_probe_tool', 'expose')).toBe(true);
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes('is not a valid'))).toBe(false);
  });

  it('still warns about an operation that is neither an enum value nor destructive', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_probe_tool:teleport';
    getDisabledToolOperations();
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes("'teleport' is not a valid method"))).toBe(true);
  });

  it('keeps a tool destructive while its virtual operation is still enabled', () => {
    const server = new TestableN8NMCPServer();
    const cache = server.testBuildFilteredToolDefinitions(
      new Map([['n8n_probe_tool', new Set(['trigger', 'pinned', 'direct'])]])
    );
    const filtered = cache.get('n8n_probe_tool');
    expect(filtered.inputSchema.properties.method.enum).toEqual(['auto']);
    expect(filtered.annotations.readOnlyHint).toBe(false);
    expect(filtered.annotations.destructiveHint).toBe(true);
  });

  it('advises moving the tool to DISABLED_TOOLS once no selectable operation is left', () => {
    const server = new TestableN8NMCPServer();
    // Every enum value gone; only the virtual `expose` operation survives. It
    // keeps the tool destructive, but it is not a value a caller can pass, so
    // the tool is published with an empty enum and the operator needs to hear
    // it — the warning counts callable operations, not the union.
    const cache = server.testBuildFilteredToolDefinitions(
      new Map([['n8n_probe_tool', new Set(['auto', 'trigger', 'pinned', 'direct'])]])
    );
    expect(cache.get('n8n_probe_tool').inputSchema.properties.method.enum).toEqual([]);
    expect(cache.get('n8n_probe_tool').annotations.readOnlyHint).toBe(false);
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes("all operations for 'n8n_probe_tool' are disabled"))).toBe(true);
  });

  it('warns for a real tool whose every method is disabled while expose keeps it destructive', () => {
    const server = new TestableN8NMCPServer();
    const cache = server.testBuildFilteredToolDefinitions(
      new Map([['n8n_test_workflow', new Set(['auto', 'trigger', 'prepare', 'pinned', 'direct'])]])
    );
    const filtered = cache.get('n8n_test_workflow');
    expect(filtered.inputSchema.properties.method.enum).toEqual([]);
    // `expose` is still enabled, so the tool is not read-only.
    expect(filtered.annotations.readOnlyHint).toBe(false);
    expect(filtered.annotations.destructiveHint).toBe(true);
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes("all operations for 'n8n_test_workflow' are disabled"))).toBe(true);
  });

  it('advises moving the tool to DISABLED_TOOLS once nothing is reachable', () => {
    const server = new TestableN8NMCPServer();
    server.testBuildFilteredToolDefinitions(
      new Map([['n8n_probe_tool', new Set(['auto', 'trigger', 'pinned', 'direct', 'expose'])]])
    );
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes("all operations for 'n8n_probe_tool' are disabled"))).toBe(true);
  });

  it('flips the tool to read-only once the virtual operation is disabled too', () => {
    const server = new TestableN8NMCPServer();
    const cache = server.testBuildFilteredToolDefinitions(
      new Map([['n8n_probe_tool', new Set(['trigger', 'pinned', 'direct', 'expose'])]])
    );
    const filtered = cache.get('n8n_probe_tool');
    expect(filtered.annotations.readOnlyHint).toBe(true);
    expect(filtered.annotations.destructiveHint).toBe(false);
  });
});

describe('n8n_test_workflow policy registration', () => {
  it('accepts the real tool\'s virtual expose operation without a "no effect" warning', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_test_workflow:expose';
    expect(isOperationDisabled('n8n_test_workflow', 'expose')).toBe(true);
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes('is not a valid'))).toBe(false);
    expect(warnings.some(w => w.includes("unknown tool 'n8n_test_workflow'"))).toBe(false);
  });

  it('treats every run method of n8n_test_workflow as destructive and prepare as the read path', () => {
    expect(getValidOperations('n8n_test_workflow')).toEqual(
      new Set(['auto', 'trigger', 'prepare', 'pinned', 'direct', 'expose'])
    );
  });
});

describe('n8n_workflow_versions policy registration', () => {
  it('accepts the real tool\'s virtual expose operation without a "no effect" warning', () => {
    process.env.DISABLED_TOOL_OPERATIONS = 'n8n_workflow_versions:expose';
    expect(isOperationDisabled('n8n_workflow_versions', 'expose')).toBe(true);
    const warnings = vi.mocked(logger.warn).mock.calls.map(c => String(c[0]));
    expect(warnings.some(w => w.includes('is not a valid'))).toBe(false);
  });

  it('counts diff as a read mode and expose as the virtual write', () => {
    expect(getValidOperations('n8n_workflow_versions')).toEqual(
      new Set(['list', 'get', 'rollback', 'delete', 'prune', 'diff', 'expose'])
    );
  });
});
