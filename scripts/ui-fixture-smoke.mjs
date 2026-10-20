import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=JSON.parse(await readFile(path.join(root,'ui-apps/src/lab/host-fixtures.json'),'utf8'));
const client=new Client({name:'ui-fixture-smoke',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/ui-fixture-server.mjs')],env:{},stderr:'pipe'});
const deadline=setTimeout(()=>void transport.close(),30000);
try {
  await client.connect(transport);
  const {tools}=await client.listTools();
  assert.equal(tools.length,4);
  for (const f of fixtures) {
    const tool=tools.find(t=>t.name===f.tool);
    assert.equal(tool?._meta?.ui?.resourceUri,`ui://n8n-mcp/${f.app}`);
    assert.equal(tool.annotations.readOnlyHint,true);
    const result=await client.callTool({name:f.tool,arguments:{scenario:f.id,...f.input}});
    assert(!result.isError);
    assert.equal(result._meta?.['n8n-mcp/toolName'], f.tool);
    assert.deepEqual(result.structuredContent,{...f.data,_uiTestFixture:true});
    const resource=await client.readResource({uri:tool._meta.ui.resourceUri});
    assert.equal(resource.contents[0].text,await readFile(path.join(root,'ui-apps/dist',f.app,'index.html'),'utf8'));
  }
  const invalid=await client.callTool({name:'n8n_executions',arguments:{scenario:'execution-deleted',action:'list'}});
  assert.equal(invalid.isError,true);
  for (const f of fixtures) {
    for (const arguments_ of [
      { scenario:f.id,...f.input,unexpected:'extra' },
      { scenario:f.id,...f.input,...(Object.hasOwn(f.input,'action') ? {limit:99} : {action:'delete'}) },
      { scenario:f.id,...Object.fromEntries(Object.entries(f.input).slice(1)) },
    ]) {
      const rejected=await client.callTool({name:f.tool,arguments:arguments_});
      assert.equal(rejected.isError,true,`Expected exact argument rejection for ${f.id}`);
      assert.equal(rejected._meta?.['n8n-mcp/toolName'],f.tool);
    }
  }
  console.log(`Fixture MCP smoke passed: ${fixtures.length} synthetic scenarios, 4 tools, exact built resources, and extra/missing/mismatched argument rejection. No n8n connection.`);
} finally {clearTimeout(deadline);await client.close();await transport.close();}
