import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'n8n-mcp-ui-smoke-'));
await copyFile(path.join(root, 'data/nodes.db'), path.join(scratch, 'nodes.db'));
const client = new Client({ name: 'n8n-mcp-ui-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist/mcp/stdio-wrapper.js')],
  cwd: scratch,
  env: {
    MCP_MODE: 'stdio', LOG_LEVEL: 'error', NODE_ENV: 'test',
    N8N_MCP_TELEMETRY_DISABLED: 'true', N8N_API_URL: '', N8N_API_KEY: '', N8N_MCP_ACCESS_TOKEN: '',
    NODE_DB_PATH: path.join(scratch, 'nodes.db'),
  },
  stderr: 'pipe',
});
const deadline = setTimeout(() => { void transport.close(); }, 45000);
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert(!tools.some(tool => tool.name === 'n8n_create_workflow'), 'Smoke must not have live management configuration');
  const tool = tools.find(tool => tool.name === 'validate_workflow');
  assert(tool, 'Offline validation tool must exist');
  const uri = tool._meta?.ui?.resourceUri ?? tool._meta?.['ui/resourceUri'];
  assert.equal(uri, 'ui://n8n-mcp/validation-summary');
  const resources = await client.listResources();
  assert(resources.resources.some(resource => resource.uri === uri));
  async function readApp(appUri) {
    assert(resources.resources.some(resource => resource.uri === appUri));
    const resource = await client.readResource({ uri: appUri });
    const html = resource.contents.find(content => typeof content.text === 'string')?.text;
    assert(typeof html === 'string' && html.includes('root') && html.includes('<script'), `Built app HTML must be returned over MCP: ${appUri}`);
    return html;
  }
  const html = await readApp(uri);
  const operationHtml = await readApp('ui://n8n-mcp/operation-result');
  const builtResources = {};
  for (const id of ['operation-result', 'validation-summary', 'workflow-list', 'execution-history', 'health-dashboard']) {
    const resourceHtml = await readApp(`ui://n8n-mcp/${id}`);
    assert.equal(resourceHtml, await readFile(path.join(root, 'ui-apps/dist', id, 'index.html'), 'utf8'));
    assert(Buffer.byteLength(resourceHtml) < 750000, `${id} exceeds the 750 kB host fixture budget`);
    builtResources[id] = resourceHtml;
  }
  const input = {
    workflow: {
      name: 'Offline protocol smoke',
      nodes: [{ id: 'manual', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }],
      connections: {},
    }, options: { profile: 'runtime' },
  };
  const result = await client.callTool({ name: tool.name, arguments: input });
  assert(!result.isError, 'Validation must return a domain result');
  assert.equal(result._meta?.['n8n-mcp/toolName'], tool.name);
  const rejected = await client.callTool({ name: 'validate_node', arguments: {} });
  assert.equal(rejected.isError, true, 'Invalid arguments must return a tool error');
  assert.equal(rejected._meta?.['n8n-mcp/toolName'], 'validate_node');
  const verdict = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
  assert.equal(typeof verdict.valid, 'boolean');
  const operation = {
    tool: 'n8n_create_workflow', input: { name: 'Synthetic saved workflow' }, html: operationHtml,
    result: { _meta: { 'n8n-mcp/toolName': 'n8n_create_workflow' }, content: [{ type: 'text', text: JSON.stringify({ success: true, data: { id: 'synthetic-smoke', name: 'Synthetic saved workflow', active: false, nodeCount: 2 } }) }] },
  };
  await writeFile(path.join(root, 'ui-apps/.lab-smoke.json'), JSON.stringify({ validation: { tool: tool.name, input, result, html }, operation, resources: builtResources, capturedAt: new Date().toISOString() }));
  console.log('UI protocol smoke passed: offline tools/list, all five exact built resources, size budget, and validate_workflow. Management rendering uses synthetic fixtures; no live management call was made.');
  console.log('Open the local UI lab and choose Load protocol snapshot to render this exact built resource and result.');
} finally {
  clearTimeout(deadline);
  await client.close();
  await transport.close();
  await rm(scratch, { recursive: true, force: true });
}
