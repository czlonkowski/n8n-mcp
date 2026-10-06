import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../../src/mcp/server';
import { UIAppRegistry } from '../../../../src/mcp/ui/registry';
import { UI_APP_CONFIGS } from '../../../../src/mcp/ui/app-configs';
import { n8nManagementTools } from '../../../../src/mcp/tools-n8n-manager';
import { n8nDocumentationToolsFinal } from '../../../../src/mcp/tools';
import { validateInstanceContext, type InstanceContext } from '../../../../src/types/instance-context';

vi.mock('../../../../src/database/database-adapter');
vi.mock('../../../../src/database/node-repository');
vi.mock('../../../../src/templates/template-service');
vi.mock('../../../../src/utils/logger');

const tenant: InstanceContext = { n8nApiUrl: 'https://n8n.example.com', n8nApiKey: 'key-a', instanceId: 'tenant-a' };
const MAPPED_TOOLS = UI_APP_CONFIGS.flatMap(config => config.toolPatterns);
const UI_URIS = UI_APP_CONFIGS.map(config => config.uri);

function createServer(context?: InstanceContext) {
  const server = new N8NDocumentationMCPServer(context);
  // The constructor loads the registry from ui-apps/dist, which a test checkout may
  // not have built. Entries are shared with the tool index, so this covers both.
  for (const app of UIAppRegistry.getAllApps()) app.html = '<html>card</html>';
  const handler = (method: string) => (server as any).server._requestHandlers.get(method);
  return {
    // What performContextSwitch does to a live session's server on each request.
    setContext: (next?: InstanceContext) => { (server as any).instanceContext = next; },
    listTools: async () => (await handler('tools/list')({ method: 'tools/list', params: {} }, {})).tools as any[],
    callTool: async (name: string) => {
      vi.spyOn(server as any, 'executeTool').mockResolvedValue({ success: true, data: {} });
      return handler('tools/call')({ method: 'tools/call', params: { name, arguments: {} } }, {});
    },
    listResources: async () => (await handler('resources/list')({ method: 'resources/list', params: {} }, {})).resources as any[],
    readResource: (uri: string) => handler('resources/read')({ method: 'resources/read', params: { uri } }, {}),
  };
}

const uiTools = (tools: any[]) => tools.filter(tool => tool._meta?.ui || tool._meta?.['ui/resourceUri']);
const uiResources = (resources: any[]) => resources.filter(resource => resource.uri.startsWith('ui://'));

describe('MCP Apps switch (#1152)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_DB_PATH', ':memory:');
    vi.stubEnv('N8N_MCP_DISABLE_UI_APPS', '');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); UIAppRegistry.reset(); });

  it('advertises UI for every mapped tool when nothing is set', async () => {
    const server = createServer(tenant);
    const tools = await server.listTools();
    expect(uiTools(tools).map(tool => tool.name).sort()).toEqual([...MAPPED_TOOLS].sort());
    for (const tool of uiTools(tools)) {
      expect(tool._meta.ui.resourceUri).toBe(tool._meta['ui/resourceUri']);
      expect(UI_URIS).toContain(tool._meta.ui.resourceUri);
    }
    expect((await server.callTool('n8n_create_workflow'))._meta).toEqual({ 'n8n-mcp/toolName': 'n8n_create_workflow' });
    expect(uiResources(await server.listResources()).map(resource => resource.uri).sort()).toEqual([...UI_URIS].sort());
  });

  it('treats an explicit true like unset', async () => {
    const server = createServer({ ...tenant, uiAppsEnabled: true });
    expect(uiTools(await server.listTools())).toHaveLength(MAPPED_TOOLS.length);
  });

  it('stops advertising UI when the context says false, and keeps every tool', async () => {
    const enabled = createServer(tenant);
    const enabledTools = await enabled.listTools();
    const enabledResources = await enabled.listResources();

    const server = createServer({ ...tenant, uiAppsEnabled: false });
    const tools = await server.listTools();
    expect(uiTools(tools)).toEqual([]);
    expect(tools.map(tool => tool.name)).toEqual(enabledTools.map(tool => tool.name));

    const result = await server.callTool('n8n_create_workflow');
    expect(result._meta).toBeUndefined();
    expect(result.content[0].text).toContain('success');

    const resources = await server.listResources();
    expect(uiResources(resources)).toEqual([]);
    // Skill resources are not UI and stay listed.
    expect(resources).toEqual(enabledResources.filter(resource => !resource.uri.startsWith('ui://')));
  });

  it('keeps metadata that is not UI on a tool definition when UI is off', async () => {
    const server = createServer({ ...tenant, uiAppsEnabled: false });
    const withOwnMeta = n8nManagementTools.find(tool => (tool as any)._meta)!;
    const listed = (await server.listTools()).find(tool => tool.name === withOwnMeta.name);
    expect(listed._meta).toEqual((withOwnMeta as any)._meta);
  });

  it('follows the context on every request of one server', async () => {
    const server = createServer(tenant);
    const expected = [true, false, true, false, false, true];
    for (const on of expected) {
      server.setContext(on ? tenant : { ...tenant, uiAppsEnabled: false });
      expect(uiTools(await server.listTools()).length > 0).toBe(on);
      expect((await server.callTool('validate_workflow'))._meta !== undefined).toBe(on);
      expect(uiResources(await server.listResources()).length > 0).toBe(on);
    }
  });

  it('never writes UI metadata onto the shared tool definitions', async () => {
    const snapshot = (tools: readonly any[]) => JSON.stringify(tools.map(tool => [tool.name, tool._meta ?? null]));
    const before = [snapshot(n8nManagementTools), snapshot(n8nDocumentationToolsFinal)];

    const server = createServer(tenant);
    const tools = await server.listTools();
    expect(uiTools(tools).length).toBeGreaterThan(0);

    expect([snapshot(n8nManagementTools), snapshot(n8nDocumentationToolsFinal)]).toEqual(before);
    for (const tool of [...n8nManagementTools, ...n8nDocumentationToolsFinal] as any[]) {
      expect(tool._meta?.ui).toBeUndefined();
      expect(tool._meta?.['ui/resourceUri']).toBeUndefined();
    }
  });

  it('never writes UI metadata onto the per-operation filtered definitions', async () => {
    vi.stubEnv('DISABLED_TOOL_OPERATIONS', 'n8n_executions:delete');
    const server = createServer(tenant);
    expect(uiTools(await server.listTools()).map(tool => tool.name)).toContain('n8n_executions');
    server.setContext({ ...tenant, uiAppsEnabled: false });
    expect(uiTools(await server.listTools())).toEqual([]);
  });

  describe('N8N_MCP_DISABLE_UI_APPS', () => {
    it('wins over a context that asks for UI', async () => {
      vi.stubEnv('N8N_MCP_DISABLE_UI_APPS', 'true');
      const server = createServer({ ...tenant, uiAppsEnabled: true });
      expect(uiTools(await server.listTools())).toEqual([]);
      expect((await server.callTool('n8n_create_workflow'))._meta).toBeUndefined();
      expect(uiResources(await server.listResources())).toEqual([]);
    });

    it('applies without any instance context', async () => {
      vi.stubEnv('N8N_MCP_DISABLE_UI_APPS', 'true');
      vi.stubEnv('N8N_API_URL', 'https://n8n.example.com');
      vi.stubEnv('N8N_API_KEY', 'key-a');
      const server = createServer();
      expect(uiTools(await server.listTools())).toEqual([]);
      expect((await server.callTool('validate_workflow'))._meta).toBeUndefined();
    });

    it('is read on each request, not once at startup', async () => {
      const server = createServer(tenant);
      expect(uiTools(await server.listTools()).length).toBeGreaterThan(0);
      vi.stubEnv('N8N_MCP_DISABLE_UI_APPS', 'true');
      expect(uiTools(await server.listTools())).toEqual([]);
    });

    it.each(['false', '0', ''])('leaves UI on for the value %j', async value => {
      vi.stubEnv('N8N_MCP_DISABLE_UI_APPS', value);
      const server = createServer(tenant);
      expect(uiTools(await server.listTools()).length).toBeGreaterThan(0);
    });
  });

  it.each([
    ['context false', { ...tenant, uiAppsEnabled: false }, ''],
    ['environment veto', { ...tenant, uiAppsEnabled: true }, 'true'],
  ] as const)('still serves ui:// resources/read with UI off by %s', async (_label, context, env) => {
    vi.stubEnv('N8N_MCP_DISABLE_UI_APPS', env);
    const server = createServer(context);
    for (const uri of UI_URIS) {
      const read = await server.readResource(uri);
      expect(read.contents).toEqual([{ uri, mimeType: 'text/html;profile=mcp-app', text: '<html>card</html>' }]);
    }
  });

  describe('validateInstanceContext', () => {
    it.each([true, false, undefined])('accepts uiAppsEnabled = %j', value => {
      expect(validateInstanceContext({ ...tenant, uiAppsEnabled: value }).valid).toBe(true);
    });

    it.each(['false', 'true', 0, 1, null, {}])('rejects a non-boolean uiAppsEnabled = %j', value => {
      const result = validateInstanceContext({ ...tenant, uiAppsEnabled: value as any });
      expect(result.valid).toBe(false);
      expect(result.errors?.join(' ')).toContain('uiAppsEnabled');
    });
  });
});
