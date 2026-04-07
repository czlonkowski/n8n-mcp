"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getToolDocumentation = getToolDocumentation;
exports.getToolsOverview = getToolsOverview;
exports.searchToolDocumentation = searchToolDocumentation;
exports.getToolsByCategory = getToolsByCategory;
exports.getAllCategories = getAllCategories;
const tool_docs_1 = require("./tool-docs");
function getToolDocumentation(toolName, depth = 'essentials') {
    if (toolName === 'javascript_code_node_guide') {
        return getJavaScriptCodeNodeGuide(depth);
    }
    if (toolName === 'python_code_node_guide') {
        return getPythonCodeNodeGuide(depth);
    }
    const tool = tool_docs_1.toolsDocumentation[toolName];
    if (!tool) {
        return `Tool '${toolName}' not found. Use tools_documentation() to see available tools.`;
    }
    if (depth === 'essentials') {
        const { essentials } = tool;
        return `# ${tool.name}

${essentials.description}

**Example**: ${essentials.example}

**Key parameters**: ${essentials.keyParameters.join(', ')}

**Performance**: ${essentials.performance}

**Tips**:
${essentials.tips.map(tip => `- ${tip}`).join('\n')}

For full documentation, use: tools_documentation({topic: "${toolName}", depth: "full"})`;
    }
    const { full } = tool;
    return `# ${tool.name}

${full.description}

## Parameters
${Object.entries(full.parameters).map(([param, info]) => `- **${param}** (${info.type}${info.required ? ', required' : ''}): ${info.description}`).join('\n')}

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
function getToolsOverview(depth = 'essentials') {
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

## Tool Categories (21 Tools Total)

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

**n8n API Tools** (15 tools, requires N8N_API_URL configuration)
- n8n_create_workflow - Create new workflows
- n8n_get_workflow - Get workflow with mode='full'/'details'/'structure'/'minimal'
- n8n_update_full_workflow - Full workflow replacement
- n8n_update_partial_workflow - Incremental diff-based updates
- n8n_delete_workflow - Delete workflow
- n8n_list_workflows - List workflows with filters
- n8n_validate_workflow - Validate workflow by ID
- n8n_autofix_workflow - Auto-fix common issues
- n8n_test_workflow - Test/trigger workflows (webhook, form, chat, execute)
- n8n_executions - Unified execution management (action='get'/'list'/'delete')
- n8n_health_check - Check n8n API connectivity
- n8n_workflow_versions - Version history and rollback
- n8n_deploy_template - Deploy templates directly to n8n instance
- n8n_manage_datatable - Manage data tables and rows
- n8n_generate_workflow - Generate workflow from natural language description

## Performance Characteristics
- Instant (<10ms): search_nodes, get_node (minimal/standard)
- Fast (<100ms): validate_node, get_template
- Moderate (100-500ms): validate_workflow, get_node (full detail)
- Network-dependent: All n8n_* tools

For comprehensive documentation on any tool:
tools_documentation({topic: "tool_name", depth: "full"})`;
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
            const tool = tool_docs_1.toolsDocumentation[toolName];
            return `- **${toolName}**: ${tool.essentials.description}`;
        }).join('\n')}`;
    }).join('\n\n')}

## Usage Notes
- All node types require the "nodes-base." or "nodes-langchain." prefix
- Use get_node() with detail='standard' first for most tasks (~95% smaller than detail='full')
- Validation profiles: minimal (editing), runtime (default), strict (deployment)
- n8n API tools only available when N8N_API_URL and N8N_API_KEY are configured

For detailed documentation on any tool:
tools_documentation({topic: "tool_name", depth: "full"})`;
}
function searchToolDocumentation(keyword) {
    const results = [];
    for (const [toolName, tool] of Object.entries(tool_docs_1.toolsDocumentation)) {
        const searchText = `${toolName} ${tool.essentials.description} ${tool.full.description}`.toLowerCase();
        if (searchText.includes(keyword.toLowerCase())) {
            results.push(toolName);
        }
    }
    return results;
}
function getToolsByCategory(category) {
    return Object.entries(tool_docs_1.toolsDocumentation)
        .filter(([_, tool]) => tool.category === category)
        .map(([name, _]) => name);
}
function getAllCategories() {
    const categories = new Set();
    Object.values(tool_docs_1.toolsDocumentation).forEach(tool => {
        categories.add(tool.category);
    });
    return Array.from(categories);
}
function getJavaScriptCodeNodeGuide(depth = 'essentials') {
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
const result = $jmespath($json, "users[?age > 30].name");
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
function getPythonCodeNodeGuide(depth = 'essentials') {
    if (depth === 'essentials') {
        return `# Python Code Node Guide

Essential patterns for Python in n8n Code nodes.

**Key Concepts**:
- Access all items: \`_input.all()\` (not items[0])
- Current item data: \`_json\`
- Return format: \`[{"json": {...}}]\` (list of dicts)

**Limitations**:
- No external libraries (no requests, pandas, numpy)
- Use built-in functions only
- No pip install available

**Common Patterns**:
\`\`\`python
# Process all items
all_items = _input.all()
return [{
    "json": {
        "processed": True,
        "count": len(all_items),
        "first_item": all_items[0]["json"] if all_items else None
    }
}]
\`\`\`

**Tips**:
- Webhook data is under ["body"] key
- Use json module for parsing
- datetime for date handling

For full guide: tools_documentation({topic: "python_code_node_guide", depth: "full"})`;
    }
    return `# Python Code Node Complete Guide

Comprehensive guide for using Python in n8n Code nodes.

## Data Access Patterns

### Accessing Input Data
\`\`\`python
# Get all items from previous node
all_items = _input.all()

# Get specific node's output (use _node)
webhook_data = _node["Webhook"]["json"]

# Current item in loop
current_item = _json

# First item only
first_item = _input.first()["json"]
\`\`\`

### Webhook Data Structure
**CRITICAL**: Webhook data is nested under ["body"]:
\`\`\`python
# WRONG - Won't work
data = _json["name"]

# CORRECT - Webhook data is under body
data = _json["body"]["name"]
\`\`\`

## Available Built-in Modules

### Standard Library Only
\`\`\`python
import json
import datetime
import base64
import hashlib
import urllib.parse
import re
import math
import random
\`\`\`

### Date/Time Handling
\`\`\`python
from datetime import datetime, timedelta

# Current time
now = datetime.now()
iso_format = now.isoformat()

# Date arithmetic
future = now + timedelta(days=5)
formatted = now.strftime("%Y-%m-%d")
\`\`\`

### JSON Operations
\`\`\`python
# Parse JSON string
data = json.loads(json_string)

# Convert to JSON
json_output = json.dumps({"key": "value"})
\`\`\`

## Return Format Requirements

### Correct Format
\`\`\`python
# MUST return list of dictionaries with "json" key
return [{
    "json": {
        "result": "success",
        "data": processed_data
    }
}]

# Multiple items
return [
    {"json": {"id": item["json"]["id"], "processed": True}}
    for item in all_items
]
\`\`\`

### Binary Data
\`\`\`python
# Return with binary data
import base64

return [{
    "json": {"filename": "report.pdf"},
    "binary": {
        "data": base64.b64encode(pdf_content).decode()
    }
}]
\`\`\`

## Common Patterns

### Processing Webhook Data
\`\`\`python
# Extract webhook payload
webhook_body = _json["body"]
username = webhook_body.get("username")
email = webhook_body.get("email")
items = webhook_body.get("items", [])

# Process and return
return [{
    "json": {
        "username": username,
        "email": email,
        "item_count": len(items),
        "processed_at": datetime.now().isoformat()
    }
}]
\`\`\`

### Aggregating Data
\`\`\`python
# Sum values across all items
all_items = _input.all()
total = sum(item["json"].get("amount", 0) for item in all_items)

return [{
    "json": {
        "total": total,
        "item_count": len(all_items),
        "average": total / len(all_items) if all_items else 0
    }
}]
\`\`\`

### Error Handling
\`\`\`python
try:
    # Process data
    webhook_data = _json["body"]
    result = process_data(webhook_data)
    
    return [{
        "json": {
            "success": True,
            "data": result
        }
    }]
except Exception as e:
    return [{
        "json": {
            "success": False,
            "error": str(e)
        }
    }]
\`\`\`

### Data Transformation
\`\`\`python
# Transform all items
all_items = _input.all()
transformed = []

for item in all_items:
    data = item["json"]
    transformed.append({
        "json": {
            "id": data.get("id"),
            "name": data.get("name", "").upper(),
            "timestamp": datetime.now().isoformat(),
            "valid": bool(data.get("email"))
        }
    })

return transformed
\`\`\`

## Limitations & Workarounds

### No External Libraries
\`\`\`python
# CANNOT USE:
# import requests  # Not available
# import pandas   # Not available
# import numpy    # Not available

# WORKAROUND: Use JavaScript Code node for HTTP requests
# Or use HTTP Request node before Code node
\`\`\`

### HTTP Requests Alternative
Since Python requests library is not available, use:
1. JavaScript Code node with $helpers.httpRequest()
2. HTTP Request node before your Python Code node
3. Webhook node to receive data

## Common Pitfalls
1. Trying to import external libraries (requests, pandas)
2. Using items[0] instead of _input.all()
3. Forgetting webhook data is under ["body"]
4. Returning dictionaries instead of [{"json": {...}}]
5. Not handling missing keys with .get()

## Best Practices
1. Always use .get() for dictionary access
2. Validate data before processing
3. Handle empty input arrays
4. Use list comprehensions for transformations
5. Return meaningful error messages

## Type Conversions
\`\`\`python
# String to number
value = float(_json.get("amount", "0"))

# Boolean conversion
is_active = str(_json.get("active", "")).lower() == "true"

# Safe JSON parsing
try:
    data = json.loads(_json.get("json_string", "{}"))
except json.JSONDecodeError:
    data = {}
\`\`\`

## Related Tools
- get_node({nodeType: "nodes-base.code"}) - Get Code node configuration details
- validate_node({nodeType: "nodes-base.code", config: {...}}) - Validate Code node setup
- javascript_code_node_guide (for JavaScript syntax)`;
}
//# sourceMappingURL=tools-documentation.js.map