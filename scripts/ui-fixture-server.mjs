/** Development-only MCP server: returns fixed examples, never calls n8n. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { UI_APP_CONFIGS } = require('../dist/mcp/ui/app-configs.js');
const fixtures = JSON.parse(readFileSync(path.join(root, 'ui-apps/src/lab/host-fixtures.json'), 'utf8'));
const resources = UI_APP_CONFIGS.map(config => ({ ...config, html: readFileSync(path.join(root, 'ui-apps/dist', config.id, 'index.html'), 'utf8') }));
const tools = [...new Set(fixtures.map(f => f.tool))].map(name => {
  const examples = fixtures.filter(f => f.tool === name);
  const app = resources.find(app => app.toolPatterns.includes(name));
  if (!app) throw new Error(`No UI registration for ${name}`);
  return {
    name, description: `SYNTHETIC UI TEST ONLY. Returns a fixed example; no n8n connection, reads or writes. Choose a scenario and pass its matching arguments: ${examples.map(f => `${f.id}: ${JSON.stringify(f.input)}`).join('; ')}`,
    inputSchema: { type: 'object', properties: {
      scenario: { type: 'string', enum: examples.map(f => f.id) },
      action: { type: 'string', enum: ['list', 'get', 'delete'] }, id: { type: 'string' },
      mode: { type: 'string', enum: ['status', 'diagnostic', 'error'] },
      templateId: { type: 'number' }, workflowId: { type: 'string' }, limit: { type: 'number' },
    }, required: ['scenario'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: app.uri }, 'ui/resourceUri': app.uri },
  };
});
const server = new Server({ name: 'n8n-mcp synthetic UI fixtures', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} }, instructions: 'This is an isolated UI demonstration. All returned data is synthetic. Never describe a demo result as a real deployment, connection, execution or deletion.' });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: resources.map(r => ({ uri: r.uri, name: r.displayName, mimeType: r.mimeType })) }));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  const resource = resources.find(r => r.uri === params.uri);
  if (!resource) throw new Error('Unknown UI resource');
  return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.html }] };
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const resultMeta = tools.some(tool => tool.name === params.name) ? { _meta: { 'n8n-mcp/toolName': params.name } } : {};
  const f = fixtures.find(f => f.tool === params.name && f.id === params.arguments?.scenario);
  const keys = Object.keys(params.arguments ?? {}).filter(key => key !== 'scenario');
  if (!f || keys.length !== Object.keys(f.input).length || Object.entries(f.input).some(([key, value]) => params.arguments?.[key] !== value)) {
    return { ...resultMeta, isError: true, content: [{ type: 'text', text: 'Unknown fixture or mismatched arguments. Use the exact scenario arguments in the tool description.' }] };
  }
  const data = { ...f.data, _uiTestFixture: true };
  return { ...resultMeta, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
});
await server.connect(new StdioServerTransport());
