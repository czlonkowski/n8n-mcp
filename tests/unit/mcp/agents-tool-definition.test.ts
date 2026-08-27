import { describe, it, expect } from 'vitest';
import { n8nManagementTools, TOOL_OPERATION_PARAM, DESTRUCTIVE_TOOL_OPERATIONS } from '@/mcp/tools-n8n-manager';
import { AGENT_ACTIONS } from '@/mcp/agents-action-map';
import { toolsDocumentation } from '@/mcp/tool-docs';

describe('n8n_manage_agents tool definition', () => {
  const tool = n8nManagementTools.find(t => t.name === 'n8n_manage_agents')!;
  it('exists with action enum matching the action map, opaque args and top-level timeoutMs', () => {
    expect(tool).toBeDefined();
    expect(tool.inputSchema.properties.action.enum).toEqual(AGENT_ACTIONS);
    expect(tool.inputSchema.properties.args.type).toBe('object');
    expect(tool.inputSchema.properties.timeoutMs).toMatchObject({ type: 'number', minimum: 5000, maximum: 600000 });
    expect(tool.inputSchema.required).toEqual(['action']);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });
  it('is registered for operation filtering with the destructive set', () => {
    expect(TOOL_OPERATION_PARAM['n8n_manage_agents']).toBe('action');
    expect([...DESTRUCTIVE_TOOL_OPERATIONS['n8n_manage_agents']].sort()).toEqual(['delete', 'publish', 'revert', 'unpublish', 'update_integration']);
  });
  it('has documentation', () => {
    expect(toolsDocumentation['n8n_manage_agents']).toBeDefined();
    expect(toolsDocumentation['n8n_manage_agents'].full.parameters.timeoutMs).toBeDefined();
  });
});
