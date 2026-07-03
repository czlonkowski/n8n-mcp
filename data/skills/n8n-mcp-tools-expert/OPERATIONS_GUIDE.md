# Templates, Data Tables & Self-Help Tools Guide

Reference depth for template search/deploy, data table management, and the self-help/diagnostic tools.

---

## Template Library

### search_templates

```javascript
// Search by keyword (default mode)
search_templates({
  query: "webhook slack",
  limit: 20
});

// Search by node types
search_templates({
  searchMode: "by_nodes",
  nodeTypes: ["n8n-nodes-base.httpRequest", "n8n-nodes-base.slack"]
});

// Search by task type
search_templates({
  searchMode: "by_task",
  task: "webhook_processing"
});

// Search by metadata (complexity, setup time)
search_templates({
  searchMode: "by_metadata",
  complexity: "simple",
  maxSetupMinutes: 15
});
```

### get_template

```javascript
get_template({
  templateId: 2947,
  mode: "structure"  // nodes+connections only
});

get_template({
  templateId: 2947,
  mode: "full"  // complete workflow JSON
});
```

### n8n_deploy_template (Deploy Directly)

```javascript
// Deploy template to your n8n instance
n8n_deploy_template({
  templateId: 2947,
  name: "My Weather to Slack",  // Custom name (optional)
  autoFix: true,  // Auto-fix common issues (default)
  autoUpgradeVersions: true  // Upgrade node versions (default)
});
// Returns: workflow ID, required credentials, fixes applied
```

(Full deploy parameters and a worked example also appear in [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md).)

---

## Data Table Management

> **Two surfaces, don't confuse them:**
> - **`n8n_manage_datatable` (below)** — MCP tool for managing tables and rows from *outside* a workflow (e.g. creating tables during workflow scaffolding, seeding data, or inspecting state from Claude). Covered here.
> - **`nodes-base.dataTable` node** — the in-workflow node you drop into a workflow to read/write rows *during execution*. For its parameter shapes, operation values, filter syntax, and gotchas (e.g. the `deleteRows` reserved-word workaround, the `id isNotEmpty` trick for "all rows"), see [n8n-node-configuration → OPERATION_PATTERNS.md → Storage Nodes → Data Table](../n8n-node-configuration/OPERATION_PATTERNS.md#data-table-nodes-basedatatable).
>
> Rule of thumb: use the MCP tool to set up a table once and the workflow node to read/write rows on every execution.

### n8n_manage_datatable

Unified tool for managing n8n data tables and rows. Supports CRUD operations on tables and rows with filtering, pagination, and dry-run support.

**Table Actions**: `createTable`, `listTables`, `getTable`, `updateTable`, `deleteTable`
**Row Actions**: `getRows`, `insertRows`, `updateRows`, `upsertRows`, `deleteRows`

```javascript
// Create a data table
n8n_manage_datatable({
  action: "createTable",
  name: "Contacts",
  columns: [
    {name: "email", type: "string"},
    {name: "score", type: "number"}
  ]
})

// Get rows with filter
n8n_manage_datatable({
  action: "getRows",
  tableId: "dt-123",
  filter: {
    filters: [{columnName: "status", condition: "eq", value: "active"}]
  },
  limit: 50
})

// Insert rows
n8n_manage_datatable({
  action: "insertRows",
  tableId: "dt-123",
  data: [{email: "a@b.com", score: 10}],
  returnType: "all"
})

// Update with dry run (preview changes)
n8n_manage_datatable({
  action: "updateRows",
  tableId: "dt-123",
  filter: {filters: [{columnName: "score", condition: "lt", value: 5}]},
  data: {status: "inactive"},
  dryRun: true
})

// Upsert (update or insert)
n8n_manage_datatable({
  action: "upsertRows",
  tableId: "dt-123",
  filter: {filters: [{columnName: "email", condition: "eq", value: "a@b.com"}]},
  data: {score: 15},
  returnData: true
})
```

**Filter conditions**: `eq`, `neq`, `like`, `ilike`, `gt`, `gte`, `lt`, `lte`

**Best practices**:
- Use `dryRun: true` before bulk updates/deletes to verify filter correctness
- Define column types upfront (`string`, `number`, `boolean`, `date`)
- Use `returnType: "count"` (default) for insertRows to minimize response size
- `deleteRows` requires a filter - cannot delete all rows without one

---

## Self-Help Tools

### Get Tool Documentation

```javascript
// Overview of all tools
tools_documentation()

// Specific tool details
tools_documentation({
  topic: "search_nodes",
  depth: "full"
})

// Code node guides
tools_documentation({topic: "javascript_code_node_guide", depth: "full"})
tools_documentation({topic: "python_code_node_guide", depth: "full"})
```

### AI Agent Guide

```javascript
// Comprehensive AI workflow guide — accessed via tools_documentation
// (there is no standalone ai_agents_guide tool)
tools_documentation({topic: "ai_agents_guide", depth: "full"})
// Returns: Architecture, connections, tools, validation, best practices
```

### Health Check

```javascript
// Quick health check
n8n_health_check()

// Detailed diagnostics
n8n_health_check({mode: "diagnostic"})
// → Returns: status, env vars, tool status, API connectivity
```

---

## Related

- [SEARCH_GUIDE.md](SEARCH_GUIDE.md) - Node discovery
- [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md) - Configuration validation
- [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) - Workflow management (incl. credentials, audit, generation)
