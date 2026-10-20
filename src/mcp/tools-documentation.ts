import { toolsDocumentation } from './tool-docs';

export function getToolDocumentation(
  toolName: string,
  depth: 'essentials' | 'full' = 'essentials',
  disabledOperations?: Set<string>
): string {
  // Check for special documentation topics
  if (toolName === 'javascript_code_node_guide') {
    return getJavaScriptCodeNodeGuide(depth);
  }
  if (toolName === 'python_code_node_guide') {
    return getPythonCodeNodeGuide(depth);
  }
  
  const tool = toolsDocumentation[toolName];
  if (!tool) {
    return `Tool '${toolName}' not found. Use tools_documentation() to see available tools.`;
  }

  const disabledNotice = disabledOperations && disabledOperations.size > 0
    ? `\n> **Server policy**: The following operations are disabled in this deployment: ${[...disabledOperations].join(', ')}\n`
    : '';

  if (depth === 'essentials') {
    const { essentials } = tool;
    return `# ${tool.name}
${disabledNotice}
${essentials.description}

**Example**: ${essentials.example}

**Key parameters**: ${essentials.keyParameters.join(', ')}

**Performance**: ${essentials.performance}

**Tips**:
${essentials.tips.map(tip => `- ${tip}`).join('\n')}

For full documentation, use: tools_documentation({topic: "${toolName}", depth: "full"})`;
  }

  // Full documentation
  const { full } = tool;
  return `# ${tool.name}
${disabledNotice}
${full.description}

## Parameters
${Object.entries(full.parameters).map(([param, info]) => 
  `- **${param}** (${info.type}${info.required ? ', required' : ''}): ${info.description}`
).join('\n')}

## Returns
${full.returns}

## Examples
${full.examples.map(ex => `\`\`\`javascript\n${ex}\n\`\`\``).join('\n\n')}

## Common Use Cases
${full.useCases.map(uc => `- ${uc}`).join('\n')}

## Performance
${full.performance}

## Best Practices
${full.bestPractices.map(bp => `- ${bp}`).join('\n')}

## Common Pitfalls
${full.pitfalls.map(p => `- ${p}`).join('\n')}

## Related Tools
${full.relatedTools.map(t => `- ${t}`).join('\n')}`;
}

function buildDisabledOpsOverviewSection(disabledToolOps?: Map<string, Set<string>>): string {
  if (!disabledToolOps || disabledToolOps.size === 0) return '';
  const lines = [...disabledToolOps.entries()]
    .map(([tool, ops]) => `- **${tool}**: ${[...ops].join(', ')}`);
  return `\n\n## Server Policy: Disabled Operations\nThe following operations are disabled in this deployment and will be rejected if called:\n${lines.join('\n')}`;
}

export function getToolsOverview(
  depth: 'essentials' | 'full' = 'essentials',
  disabledToolOps?: Map<string, Set<string>>
): string {
  // Get version info from package.json. We track n8n-nodes-base directly
  // instead of the n8n meta package, so use that as the compatibility hint.
  const packageJson = require('../../package.json');
  const supportedN8nVersion = packageJson.dependencies?.['n8n-nodes-base']?.replace(/[^0-9.]/g, '') || 'latest';
  
  if (depth === 'essentials') {
    return `# n8n MCP Tools Reference

## Important: Compatibility Notice
⚠️ This MCP server is tested with n8n version ${supportedN8nVersion}. 
Inform the user to check their n8n version matches or is compatible with the supported version listed above.

## Code Node Configuration
When working with Code nodes, always start by calling the relevant guide:
- tools_documentation({topic: "javascript_code_node_guide"}) for JavaScript Code nodes
- tools_documentation({topic: "python_code_node_guide"}) for Python Code nodes

## Standard Workflow Pattern

⚠️ **CRITICAL**: Always call get_node() with detail='standard' FIRST before configuring any node!

1. **Find** the node you need:
   - search_nodes({query: "slack"}) - Search by keyword
   - search_nodes({query: "communication"}) - Search by category name
   - search_nodes({query: "AI langchain"}) - Search for AI-capable nodes

2. **Configure** the node (ALWAYS START WITH STANDARD DETAIL):
   - ✅ get_node({nodeType: "nodes-base.slack", detail: "standard"}) - Get essential properties FIRST (~1-2KB, shows required fields)
   - get_node({nodeType: "nodes-base.slack", detail: "full"}) - Get complete schema only if standard insufficient (~100KB+)
   - get_node({nodeType: "nodes-base.slack", mode: "docs"}) - Get readable markdown documentation
   - get_node({nodeType: "nodes-base.slack", mode: "search_properties", propertyQuery: "auth"}) - Find specific properties

3. **Validate** before deployment:
   - validate_node({nodeType: "nodes-base.slack", config: {...}, mode: "minimal"}) - Quick required fields check
   - validate_node({nodeType: "nodes-base.slack", config: {...}}) - Full validation with errors/warnings/suggestions
   - validate_workflow({workflow: {...}}) - Validate entire workflow

## Tool Categories (28 Tools Total)

**Meta Tools** (1 tool)
- tools_documentation - Get documentation for any MCP tool (this tool)

**Discovery Tools** (1 tool)
- search_nodes - Full-text search across all nodes (supports OR, AND, FUZZY modes)

**Configuration Tools** (1 consolidated tool)
- get_node - Unified node information tool:
  - detail='minimal'/'standard'/'full': Progressive detail levels
  - mode='docs': Readable markdown documentation
  - mode='search_properties': Find specific properties
  - mode='versions'/'compare'/'breaking'/'migrations': Version management

**Validation Tools** (2 tools)
- validate_node - Unified validation with mode='full' or mode='minimal'
- validate_workflow - Complete workflow validation (nodes, connections, expressions)

**Template Tools** (2 tools)
- get_template - Get complete workflow JSON by ID
- search_templates - Unified template search:
  - searchMode='keyword': Text search (default)
  - searchMode='by_nodes': Find templates using specific nodes
  - searchMode='by_task': Curated task-based templates
  - searchMode='by_metadata': Filter by complexity/services
  - searchMode='patterns': Workflow pattern summaries from 2,700+ templates

**n8n API Tools** (21 tools, requires N8N_API_URL configuration)
- n8n_create_workflow - Create new workflows
- n8n_get_workflow - Get workflow with mode='full' (draft) / 'details' / 'active' (published graph) / 'structure' / 'minimal'
- n8n_update_full_workflow - Full workflow replacement
- n8n_update_partial_workflow - Incremental diff-based updates
- n8n_delete_workflow - Delete workflow
- n8n_list_workflows - List workflows with filters
- n8n_validate_workflow - Validate workflow by ID
- n8n_autofix_workflow - Auto-fix common issues
- n8n_test_workflow - Run a workflow: method='auto'/'trigger' over its webhook/form/chat trigger, or method='prepare'/'pinned'/'direct' through n8n's MCP server (needs N8N_MCP_ACCESS_TOKEN)
- n8n_executions - Unified execution management (action='get'/'list'/'delete')
- n8n_evaluations - Run and read evaluation test runs (action='list_runs'/'get_run'/'list_cases' on n8n 2.30+, 'run'/'cancel' on 2.32+)
- n8n_health_check - Check n8n API connectivity
- n8n_workflow_versions - Version history, diff and rollback over n8n-mcp snapshots (source='local') or n8n's own history (source='native', needs N8N_MCP_ACCESS_TOKEN)
- n8n_deploy_template - Deploy templates directly to n8n instance
- n8n_manage_datatable - Manage data tables, rows and columns (addColumn/deleteColumn/renameColumn need N8N_MCP_ACCESS_TOKEN)
- n8n_manage_credentials - Manage credentials (action='list'/'get'/'create'/'update'/'delete'/'getSchema')
- n8n_manage_folders - Manage workflow folders (action='create'/'list'/'get'/'rename'/'move'/'delete', n8n 2.19+; workflow placement via parentFolderId/moveToFolder needs 2.32+)
- n8n_audit_instance - Security audit of the n8n instance
- n8n_manage_agents - Manage n8n Agents through n8n's instance-level MCP server (requires N8N_MCP_ACCESS_TOKEN, n8n 2.34+)
- n8n_explore_node_resources - Resolve dynamic dropdown/resource-locator options (Slack channels, Google Sheets tabs, etc.) using a real credential (requires N8N_MCP_ACCESS_TOKEN)
- n8n_list_catalog - List instance-level projects or tags, with an official-MCP fallback when team projects need it

## Performance Characteristics
- Instant (<10ms): search_nodes, get_node (minimal/standard)
- Fast (<100ms): validate_node, get_template
- Moderate (100-500ms): validate_workflow, get_node (full detail)
- Network-dependent: All n8n_* tools

For comprehensive documentation on any tool:
tools_documentation({topic: "tool_name", depth: "full"})${buildDisabledOpsOverviewSection(disabledToolOps)}`;
  }

  const categories = getAllCategories();
  return `# n8n MCP Tools - Complete Reference

## Important: Compatibility Notice
⚠️ This MCP server is tested with n8n version ${supportedN8nVersion}. 
Run n8n_health_check() to verify your n8n instance compatibility and API connectivity.

## Code Node Guides
For Code node configuration, use these comprehensive guides:
- tools_documentation({topic: "javascript_code_node_guide", depth: "full"}) - JavaScript patterns, n8n variables, error handling
- tools_documentation({topic: "python_code_node_guide", depth: "full"}) - Python patterns, data access, debugging

## All Available Tools by Category

${categories.map(cat => {
  const tools = getToolsByCategory(cat);
  const categoryName = cat.charAt(0).toUpperCase() + cat.slice(1).replace('_', ' ');
  return `### ${categoryName}
${tools.map(toolName => {
  const tool = toolsDocumentation[toolName];
  return `- **${toolName}**: ${tool.essentials.description}`;
}).join('\n')}`;
}).join('\n\n')}

## Usage Notes
- All node types require the "nodes-base." or "nodes-langchain." prefix
- Use get_node() with detail='standard' first for most tasks (~95% smaller than detail='full')
- Validation profiles: minimal (editing), runtime (default), strict (deployment)
- n8n API tools only available when N8N_API_URL and N8N_API_KEY are configured

For detailed documentation on any tool:
tools_documentation({topic: "tool_name", depth: "full"})${buildDisabledOpsOverviewSection(disabledToolOps)}`;
}

export function searchToolDocumentation(keyword: string): string[] {
  const results: string[] = [];
  
  for (const [toolName, tool] of Object.entries(toolsDocumentation)) {
    const searchText = `${toolName} ${tool.essentials.description} ${tool.full.description}`.toLowerCase();
    if (searchText.includes(keyword.toLowerCase())) {
      results.push(toolName);
    }
  }
  
  return results;
}

export function getToolsByCategory(category: string): string[] {
  return Object.entries(toolsDocumentation)
    .filter(([_, tool]) => tool.category === category)
    .map(([name, _]) => name);
}

export function getAllCategories(): string[] {
  const categories = new Set<string>();
  Object.values(toolsDocumentation).forEach(tool => {
    categories.add(tool.category);
  });
  return Array.from(categories);
}

// Special documentation topics
function getJavaScriptCodeNodeGuide(depth: 'essentials' | 'full' = 'essentials'): string {
  if (depth === 'essentials') {
    return `# JavaScript Code Node Guide

Essential patterns for JavaScript in n8n Code nodes.

**Key Concepts**:
- Access all items: \`$input.all()\` (not items[0])
- Current item data: \`$json\`
- Return format: \`[{json: {...}}]\` (array of objects)

**Available Helpers**:
- \`$helpers.httpRequest()\` - Make HTTP requests
- \`$jmespath()\` - Query JSON data
- \`DateTime\` - Luxon for date handling

**Common Patterns**:
\`\`\`javascript
// Process all items
const allItems = $input.all();
return allItems.map(item => ({
  json: {
    processed: true,
    original: item.json,
    timestamp: DateTime.now().toISO()
  }
}));
\`\`\`

**Tips**:
- Webhook data is under \`.body\` property
- Use async/await for HTTP requests
- Always return array format

For full guide: tools_documentation({topic: "javascript_code_node_guide", depth: "full"})`;
  }

  // Full documentation
  return `# JavaScript Code Node Complete Guide

Comprehensive guide for using JavaScript in n8n Code nodes.

## Data Access Patterns

### Accessing Input Data
\`\`\`javascript
// Get all items from previous node
const allItems = $input.all();

// Get specific node's output
const webhookData = $node["Webhook"].json;

// Current item in loop
const currentItem = $json;

// First item only
const firstItem = $input.first().json;
\`\`\`

### Webhook Data Structure
**CRITICAL**: Webhook data is nested under \`.body\`:
\`\`\`javascript
// WRONG - Won't work
const data = $json.name;

// CORRECT - Webhook data is under body
const data = $json.body.name;
\`\`\`

## Available Built-in Functions

### HTTP Requests
\`\`\`javascript
// Make HTTP request
const response = await $helpers.httpRequest({
  method: 'GET',
  url: 'https://api.example.com/data',
  headers: {
    'Authorization': 'Bearer token'
  }
});
\`\`\`

### Date/Time Handling
\`\`\`javascript
// Using Luxon DateTime
const now = DateTime.now();
const formatted = now.toFormat('yyyy-MM-dd');
const iso = now.toISO();
const plus5Days = now.plus({ days: 5 });
\`\`\`

### JSON Querying
\`\`\`javascript
// JMESPath queries
const result = $jmespath($json, "users[?age > \`30\`].name"); // numbers are backtick literals
\`\`\`

## Return Format Requirements

### Correct Format
\`\`\`javascript
// MUST return array of objects with json property
return [{
  json: {
    result: "success",
    data: processedData
  }
}];

// Multiple items
return items.map(item => ({
  json: {
    id: item.id,
    processed: true
  }
}));
\`\`\`

### Binary Data
\`\`\`javascript
// Return with binary data
return [{
  json: { filename: "report.pdf" },
  binary: {
    data: Buffer.from(pdfContent).toString('base64')
  }
}];
\`\`\`

## Common Patterns

### Processing Webhook Data
\`\`\`javascript
// Extract webhook payload
const webhookBody = $json.body;
const { username, email, items } = webhookBody;

// Process and return
return [{
  json: {
    username,
    email,
    itemCount: items.length,
    processedAt: DateTime.now().toISO()
  }
}];
\`\`\`

### Aggregating Data
\`\`\`javascript
// Sum values across all items
const allItems = $input.all();
const total = allItems.reduce((sum, item) => {
  return sum + (item.json.amount || 0);
}, 0);

return [{
  json: { 
    total,
    itemCount: allItems.length,
    average: total / allItems.length
  }
}];
\`\`\`

### Error Handling
\`\`\`javascript
try {
  const response = await $helpers.httpRequest({
    url: 'https://api.example.com/data'
  });
  
  return [{
    json: {
      success: true,
      data: response
    }
  }];
} catch (error) {
  return [{
    json: {
      success: false,
      error: error.message
    }
  }];
}
\`\`\`

## Available Node.js Modules
- crypto (built-in)
- Buffer
- URL/URLSearchParams
- Basic Node.js globals

## Common Pitfalls
1. Using \`items[0]\` instead of \`$input.all()\`
2. Forgetting webhook data is under \`.body\`
3. Returning plain objects instead of \`[{json: {...}}]\`
4. Using \`require()\` for external modules (not allowed)
5. Trying to use expression syntax \`{{}}\` inside code

## Best Practices
1. Always validate input data exists before accessing
2. Use try-catch for HTTP requests
3. Return early on validation failures
4. Keep code simple and readable
5. Use descriptive variable names

## Related Tools
- get_node({nodeType: "nodes-base.code"}) - Get Code node configuration details
- validate_node({nodeType: "nodes-base.code", config: {...}}) - Validate Code node setup
- python_code_node_guide (for Python syntax)`;
}

function getPythonCodeNodeGuide(depth: 'essentials' | 'full' = 'essentials'): string {
  if (depth === 'essentials') {
    return `# Python Code Node Guide

n8n 2.x runs Python natively in a task runner: \`language: "pythonNative"\`.
JavaScript is recommended for most cases - every n8n helper is JS-only.

**Two variables, one per mode**:
- \`runOnceForAllItems\` (default): \`_items\`, a list of \`{"json": {...}}\` dicts
- \`runOnceForEachItem\`: \`_item\`, one such dict
- Dict access only. \`it.json.field\` raises AttributeError.
- \`_input\`, \`_json\`, \`_node\`, \`_now\`, \`_today\`, \`_jmespath\` are gone (NameError).

**Blocked**: every \`import\` unless this instance allowlists it (Cloud: none);
\`class\`; \`type\`/\`getattr\`/\`hasattr\`/\`setattr\`/\`vars\`/\`dir\`/\`globals\`/\`locals\`/
\`open\`/\`input\`/\`eval\`/\`exec\`; dunders; \`global\` inside a function (use \`nonlocal\`).

**Returns**: all items - list of \`{"json": ...}\`, list of plain dicts, or one
dict. Each item - a dict; \`None\` drops the item; a list errors.

\`\`\`python
# runOnceForAllItems
return [{"json": {"name": it["json"]["name"]}} for it in _items if it["json"].get("active")]
\`\`\`

\`\`\`python
# runOnceForEachItem
row = _item["json"]
return {"json": {**row, "upper": (row.get("name") or "").upper()}}
\`\`\`

**Tips**: webhook payloads are under ["body"]; use \`.get(key, default)\`;
self-hosted Docker needs the \`n8nio/runners\` sidecar or every Python node
fails with "Python runner unavailable".

For full guide: tools_documentation({topic: "python_code_node_guide", depth: "full"})`;
  }

  // Full documentation
  return `# Python Code Node Complete Guide

Since n8n 2.0 the Code node runs native Python in a task runner
(\`language: "pythonNative"\`, typeVersion 2). The Pyodide "Python (Beta)"
runtime is gone, and with it every n8n helper. JavaScript is recommended for
most cases: \`$()\`, \`$jmespath\`, Luxon and \`$helpers\` exist only there.

## The only inputs: _items and _item

| Mode | Variable | Shape |
|---|---|---|
| runOnceForAllItems (default) | \`_items\` | list of \`{"json": {...}, "pairedItem": {...}}\` dicts |
| runOnceForEachItem | \`_item\` | one such dict |

- Each exists **only in its own mode**; the other raises \`NameError\`.
- **Dict access only.** \`it["json"].get("name")\`, never \`it.json.name\`
  (\`AttributeError: 'dict' object has no attribute 'json'\`).
- **No other nodes**: no \`_node\` / \`$('Node')\`. Merge upstream, or use JavaScript.
- **Webhook payloads** are under \`["body"]\`: \`_items[0]["json"].get("body", {})\`.
- **pairedItem**: returning \`_items\` / \`_item\` keeps it; when building new dicts
  add \`"pairedItem": {"item": i}\` if a downstream node uses \`$('Node').item\`.
- Binary data: handle it in a JavaScript Code node.

## Migration from Pyodide

| Legacy (removed) | Native |
|---|---|
| \`_input.all()\` | \`_items\` |
| \`_input.first()["json"]\` | \`_items[0]["json"]\` (guard \`if _items\`) |
| \`_input.item\` / \`_json\` | \`_item\` / \`_item["json"]\` |
| \`_node["X"]\` | not available: merge upstream, or use JavaScript |
| \`_now\`, \`_today\` | not available: pass \`{{ $now.toISO() }}\` in via Edit Fields |
| \`_jmespath(data, q)\` | not available: \`$jmespath\` in an expression, or a comprehension |
| \`item.json.field\` | \`item["json"]["field"]\` |

## Imports: blocked by default

Every \`import\` - standard library included - is checked against an allowlist
before the code runs. The default allowlist is empty, so even \`import json\`
rejects the node with \`Security violations detected / Import of standard
library module 'json' is disallowed. Allowed stdlib modules: none\`.

- **n8n Cloud**: no imports at all. **Self-hosted**: an admin can allowlist
  modules in the task-runner config; most instances don't.
- Default to import-free code; confirm with a one-line test node before relying
  on an import. \`requests\`, \`pandas\` and \`numpy\` need a custom runner image
  that ships and allowlists them, so assume they are unavailable.
- Instead: parse JSON upstream (\`{{ JSON.parse($json.payload) }}\`), do date math
  in expressions, hash with the Crypto node. ISO-8601 strings sort as strings.

## Sandbox limits (these fail even without imports)

| You write | What happens | Use instead |
|---|---|---|
| \`type\`, \`getattr\`, \`setattr\`, \`hasattr\`, \`vars\`, \`dir\`, \`globals\`, \`locals\`, \`open\`, \`input\`, \`eval\`, \`exec\`, \`compile\`, \`object\`, \`memoryview\`, \`breakpoint\` | \`NameError\` at runtime, whether called or merely named | \`isinstance(x, dict)\`; \`key in d\` / \`d.get(key)\` |
| \`class Foo: ...\` | \`__build_class__ not found\` | dicts + functions |
| \`x.__class__\`, \`__import__("json")\` | \`Security violations detected\` (before running) | - |
| \`global counter\` inside a function | \`NameError\` - your code already runs inside a wrapper function, so a nested \`global\` never binds (at top level it is a harmless no-op) | \`nonlocal counter\` |

Plain Python otherwise works: comprehensions, generators, lambdas, closures,
\`try\`/\`except\`, f-strings, \`sorted\`/\`sum\`/\`min\`/\`max\`/\`any\`/\`all\`/\`zip\`,
sets, \`isinstance\`, \`print()\` (output goes to the browser console).

## Return shapes

**runOnceForAllItems**: \`[{"json": {...}}, ...]\` is canonical; a list of plain
dicts and a single dict are auto-wrapped; \`_items\` mutated in place passes
through; \`None\` or no \`return\` errors with
\`Cannot read properties of null (reading 'json')\`.

**runOnceForEachItem**: a dict (or \`_item\`) gives one item; \`None\` **drops** the
item; a **list** errors with \`A 'json' property isn't a dictionary [item 0]\`.

On output a \`tuple\` becomes a list, a \`set\` becomes the *string* \`"{1, 2}"\` and
a \`datetime\` becomes \`str(dt)\`, not ISO - convert explicitly.

## Common patterns (import-free)

\`\`\`python
# Aggregate to one item (runOnceForAllItems)
total = sum(it["json"].get("amount", 0) for it in _items)
return {"json": {"total": total, "count": len(_items),
                 "average": total / len(_items) if _items else 0}}
\`\`\`

\`\`\`python
# Drop an item (runOnceForEachItem) - returning None filters it out
row = _item["json"]
if not row.get("email"):
    return None
return {"json": {**row, "email": row["email"].lower()}}
\`\`\`

## Self-hosted: the Python task runner

Self-hosted Docker needs the \`n8nio/runners\` sidecar. Without it every Python
Code node fails with \`Python runner unavailable: Python 3 is missing from this
system\` - an infrastructure problem, not a code problem.

## Errors and onError

\`raise ValueError("bad row")\` fails the node with that message, and routes to the
error output when the node sets \`onError: "continueErrorOutput"\`. But a **static
rejection** (blocked import, dunder access) and a
**bad return shape** mark the node failed while sending the **unchanged input
items to the success output**, so no error branch catches them. Prevent both and
confirm with a real test execution.

## Common Pitfalls
1. Copying Pyodide code that uses \`_input\`, \`_json\`, \`_node\`, \`_now\` or \`_jmespath\`
2. Dot access (\`item.json.field\`) instead of \`item["json"]["field"]\`
3. Assuming \`import json\` or \`import datetime\` works
4. Using the wrong mode variable, or returning a list in runOnceForEachItem mode
5. Forgetting webhook data is under ["body"]

## Best Practices
1. Confirm the mode before writing the first line
2. Use \`.get()\` for every dictionary access and handle an empty \`_items\`
3. Return the explicit \`{"json": ...}\` shape
4. Run a real test execution - validation alone won't catch the passthrough traps

## Related Tools
- get_node({nodeType: "nodes-base.code"}) - Get Code node configuration details
- validate_node({nodeType: "nodes-base.code", config: {...}}) - Validate Code node setup
- javascript_code_node_guide (for JavaScript syntax)`;
}