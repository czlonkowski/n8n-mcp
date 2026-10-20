import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { n8nManagementTools } from '../../../src/mcp/tools-n8n-manager';
import { withoutInstanceArgument } from '../../../src/mcp/instance-argument';
import { isInstanceContext, validateInstanceContext, type InstanceContext } from '../../../src/types/instance-context';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

const tenant: InstanceContext = { n8nApiUrl: 'https://n8n.example.com', n8nApiKey: 'key-a', instanceId: 'tenant-a' };
const MANAGEMENT = new Set(n8nManagementTools.map(tool => tool.name));

function createServer(context?: InstanceContext) {
  const server = new N8NDocumentationMCPServer(context);
  const handler = (method: string) => (server as any).server._requestHandlers.get(method);
  return {
    server,
    listTools: async () => (await handler('tools/list')({ method: 'tools/list', params: {} }, {})).tools as any[],
    callTool: (name: string, args: Record<string, unknown>) =>
      handler('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {}),
  };
}

describe('per-call instance argument', () => {
  beforeEach(() => { vi.stubEnv('NODE_DB_PATH', ':memory:'); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('leaves tool schemas unchanged when the switch is unset', async () => {
    const tools = await createServer(tenant).listTools();
    expect(tools.some(tool => tool.inputSchema?.properties?.instance)).toBe(false);
  });

  it('adds an optional `instance` property to every management tool, and only to those', async () => {
    const tools = await createServer({ ...tenant, instanceArgument: true }).listTools();
    for (const tool of tools) {
      const property = tool.inputSchema?.properties?.instance;
      if (MANAGEMENT.has(tool.name)) {
        expect(property, tool.name).toMatchObject({ type: 'string' });
        expect(tool.inputSchema.required ?? []).not.toContain('instance');
      } else {
        expect(property, tool.name).toBeUndefined();
      }
    }
    // The shared definitions are not mutated.
    expect(n8nManagementTools.some(tool => (tool.inputSchema as any).properties?.instance)).toBe(false);
  });

  it('drops `instance` before dispatching a management tool', async () => {
    const { server, callTool } = createServer({ ...tenant, instanceArgument: true });
    const execute = vi.spyOn(server as any, 'executeTool').mockResolvedValue({ success: true, data: {} });
    await callTool('n8n_list_workflows', { limit: 5, instance: 'acme' });
    expect(execute).toHaveBeenCalledWith('n8n_list_workflows', { limit: 5 });
  });

  it('withoutInstanceArgument returns other args untouched', () => {
    const args = { id: 'x' };
    expect(withoutInstanceArgument(args)).toBe(args);
    expect(withoutInstanceArgument(undefined)).toBeUndefined();
    expect(withoutInstanceArgument({ id: 'x', instance: 'a' })).toEqual({ id: 'x' });
  });

  it('rejects a non-boolean switch', () => {
    const bad = { ...tenant, instanceArgument: 'true' } as unknown as InstanceContext;
    expect(isInstanceContext(bad)).toBe(false);
    expect(validateInstanceContext(bad).errors).toContain('Invalid instanceArgument: Must be a boolean, got string');
  });
});
