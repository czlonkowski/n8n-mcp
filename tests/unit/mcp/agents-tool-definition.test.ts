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
    // 'integer', not 'number': the Zod schema the handler validates against
    // requires an integer, so the advertised schema has to say the same.
    expect(tool.inputSchema.properties.timeoutMs).toMatchObject({ type: 'integer', minimum: 5000, maximum: 600000 });
    expect(tool.inputSchema.required).toEqual(['action']);
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });
  it('is registered for operation filtering with the destructive set', () => {
    expect(TOOL_OPERATION_PARAM['n8n_manage_agents']).toBe('action');
    // Every write action, not just the publish/delete pair: create and mutate
    // persist a draft, and call runs the agent's real tools.
    expect([...DESTRUCTIVE_TOOL_OPERATIONS['n8n_manage_agents']].sort())
      .toEqual(['call', 'create', 'delete', 'mutate', 'publish', 'revert', 'unpublish', 'update_integration']);
  });
  it('advertises integer bounds on the two other official-MCP tools', () => {
    const explore = n8nManagementTools.find(t => t.name === 'n8n_explore_node_resources')!;
    expect(explore.inputSchema.properties.timeoutMs).toMatchObject({ type: 'integer', minimum: 5000, maximum: 600000 });
    const catalog = n8nManagementTools.find(t => t.name === 'n8n_list_catalog')!;
    expect(catalog.inputSchema.properties.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 500 });
  });
  it('has documentation', () => {
    expect(toolsDocumentation['n8n_manage_agents']).toBeDefined();
    expect(toolsDocumentation['n8n_manage_agents'].full.parameters.timeoutMs).toBeDefined();
  });
});
