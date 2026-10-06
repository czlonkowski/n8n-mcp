/** Verify UI assets and tool mappings in the packaged runtime, without n8n. */
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const { UIAppRegistry } = require(path.join(root, 'dist/mcp/ui/registry.js'));
const { UI_APP_CONFIGS } = require(path.join(root, 'dist/mcp/ui/app-configs.js'));

UIAppRegistry.load();
assert(UI_APP_CONFIGS.length > 0, 'No UI apps registered');
let mappings = 0;
for (const config of UI_APP_CONFIGS) {
  const entry = UIAppRegistry.getAppById(config.id);
  assert(entry?.html?.includes('<html'), `Missing UI HTML: ${config.id}`);
  const bytes = Buffer.byteLength(entry.html);
  assert(bytes <= 750_000, `UI resource exceeds 750 kB: ${config.id} (${bytes})`);
  const tools = UIAppRegistry.injectToolMeta(config.toolPatterns.map(name => ({ name })));
  for (const tool of tools) {
    assert.equal(tool._meta?.ui?.resourceUri, config.uri, `Missing UI metadata: ${tool.name}`);
    assert.equal(tool._meta?.['ui/resourceUri'], config.uri);
    mappings++;
  }
}
console.log(`Packaged UI smoke passed: ${UI_APP_CONFIGS.length} resources, ${mappings} tool mappings.`);
