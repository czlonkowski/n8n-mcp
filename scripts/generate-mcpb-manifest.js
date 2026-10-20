#!/usr/bin/env node
/**
 * generate-mcpb-manifest.js
 *
 * Generates manifest.json for the MCPB (MCP Bundle) used for one-click install
 * in Claude Desktop and other MCP hosts.
 *
 * The version and the advertised tool list are derived from the single sources
 * of truth (package.json and the live MCP tool registry) so the bundle metadata
 * can never drift from the server, the way the hand-maintained manifest did.
 *
 * The project must be built first: the tool list is read from dist/mcp/*.js.
 *
 * Usage:
 *   node scripts/generate-mcpb-manifest.js          # write manifest.json
 *   node scripts/generate-mcpb-manifest.js --check  # exit 1 if manifest.json is stale
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

/**
 * Load the full tool registry from the built output. Both arrays are plain
 * data (their only import is a TypeScript type), so requiring them has no
 * side effects.
 */
function loadTools() {
  const docToolsPath = path.join(ROOT, 'dist/mcp/tools.js');
  const mgmtToolsPath = path.join(ROOT, 'dist/mcp/tools-n8n-manager.js');

  for (const p of [docToolsPath, mgmtToolsPath]) {
    if (!fs.existsSync(p)) {
      console.error(`✖ ${path.relative(ROOT, p)} not found. Run "npm run build" first.`);
      process.exit(1);
    }
  }

  const docTools = require(docToolsPath).n8nDocumentationToolsFinal;
  const mgmtTools = require(mgmtToolsPath).n8nManagementTools;
  return [...docTools, ...mgmtTools];
}

/** Reduce a (possibly multi-line, multi-sentence) tool description to one tidy line. */
function shortDescription(description) {
  const oneLine = String(description).replace(/\s+/g, ' ').trim();
  const match = oneLine.match(/^(.*?[.!?])(\s|$)/);
  let sentence = match ? match[1] : oneLine;
  if (sentence.length > 160) {
    sentence = sentence.slice(0, 157).trimEnd() + '...';
  }
  return sentence;
}

function buildManifest() {
  const pkg = require(path.join(ROOT, 'package.json'));
  const tools = loadTools().map(t => ({
    name: t.name,
    description: shortDescription(t.description),
  }));

  return {
    manifest_version: '0.3',
    name: 'n8n-mcp',
    display_name: 'n8n-MCP',
    version: pkg.version,
    description:
      'MCP server providing AI assistants with comprehensive access to n8n node ' +
      'documentation and workflow management capabilities',
    author: {
      name: 'Romuald Członkowski',
      url: 'https://aiadvisors.pl/en',
    },
    repository: {
      type: 'git',
      url: 'https://github.com/czlonkowski/n8n-mcp',
    },
    homepage: 'https://www.n8n-mcp.com/',
    documentation: 'https://github.com/czlonkowski/n8n-mcp#readme',
    support: 'https://github.com/czlonkowski/n8n-mcp/issues',
    license: 'MIT',
    keywords: ['n8n', 'mcp', 'workflow', 'automation', 'ai', 'documentation', 'model-context-protocol'],
    privacy_policies: ['https://n8n.io/legal/privacy/'],
    server: {
      type: 'node',
      // Required by the v0.3 schema. This bundle launches via npx (see mcp_config
      // below), so entry_point is documentation-only; it must still resolve on disk
      // at pack time, which is why the bundle is packed after "npm run build".
      entry_point: 'dist/mcp/index.js',
      mcp_config: {
        command: 'npx',
        args: ['-y', 'n8n-mcp'],
        env: {
          MCP_MODE: 'stdio',
          LOG_LEVEL: 'error',
          DISABLE_CONSOLE_OUTPUT: 'true',
          N8N_API_URL: '${user_config.n8n_api_url}',
          N8N_API_KEY: '${user_config.n8n_api_key}',
          N8N_MCP_TELEMETRY_DISABLED: '${user_config.n8n_mcp_telemetry_disabled}',
        },
      },
    },
    user_config: {
      n8n_api_url: {
        type: 'string',
        title: 'n8n Instance URL',
        description:
          'URL of your n8n instance (e.g., https://your-n8n.com or http://localhost:5678). ' +
          'Leave empty for documentation-only mode.',
        required: false,
      },
      n8n_api_key: {
        type: 'string',
        title: 'n8n API Key',
        description: 'API key from your n8n instance Settings > API. Required for workflow management features.',
        required: false,
        sensitive: true,
      },
      n8n_mcp_telemetry_disabled: {
        type: 'boolean',
        title: 'Disable Telemetry',
        description: 'Enable to turn off anonymous usage telemetry. Telemetry is on by default.',
        required: false,
        default: false,
      },
    },
    compatibility: {
      claude_desktop: '>=0.10.0',
      platforms: ['darwin', 'win32', 'linux'],
      runtimes: {
        // npx needs a host Node install; declaring it lets hosts fail fast with a
        // clear message instead of npx erroring at launch.
        node: '>=20',
      },
    },
    tools_generated: false,
    tools,
  };
}

function serialize(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const output = serialize(buildManifest());

  if (check) {
    const existing = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf8') : '';
    if (existing !== output) {
      console.error('✖ manifest.json is out of date. Run: npm run generate:mcpb-manifest');
      process.exit(1);
    }
    console.log('✓ manifest.json is up to date');
    return;
  }

  fs.writeFileSync(MANIFEST_PATH, output);
  const manifest = buildManifest();
  console.log(`✓ Wrote manifest.json (version ${manifest.version}, ${manifest.tools.length} tools)`);
}

main();
