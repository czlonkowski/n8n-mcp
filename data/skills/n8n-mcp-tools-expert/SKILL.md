---
name: n8n-mcp-tools-expert
description: Expert guide for using n8n-mcp MCP tools effectively. Use when searching for nodes, validating configurations, accessing templates, managing workflows, managing credentials, auditing instance security, or using any n8n-mcp tool. Provides tool selection guidance, parameter formats, and common patterns. IMPORTANT — Always consult this skill before calling any n8n-mcp tool — it prevents common mistakes like wrong nodeType formats, incorrect parameter structures, and inefficient tool usage. If the user mentions n8n, workflows, nodes, or automation and you have n8n MCP tools available, use this skill first.
---

# n8n MCP Tools Expert

Master guide for using n8n-mcp MCP server tools to build workflows.

---

## Tool Categories

n8n-mcp provides tools organized into categories:

1. **Node Discovery** → [SEARCH_GUIDE.md](SEARCH_GUIDE.md)
2. **Configuration Validation** → [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md)
3. **Workflow Management** → [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md)
4. **Template Library** - Search and deploy 2,700+ real workflows
5. **Data Tables** - Manage n8n data tables and rows (`n8n_manage_datatable`)
6. **Credential Management** - Full credential CRUD + schema discovery (`n8n_manage_credentials`)
7. **Security & Audit** - Instance security auditing with custom deep scan (`n8n_audit_instance`)
8. **Documentation & Guides** - Tool docs, AI agent guide, Code node guides

---

## Quick Reference

### Most Used Tools (by success rate)

| Tool | Use When | Speed |
|------|----------|-------|
| `search_nodes` | Finding nodes by keyword | <20ms |
| `get_node` | Understanding node operations (detail="standard") | <10ms |
| `validate_node` | Checking configurations (mode="full") | <100ms |
| `n8n_create_workflow` | Creating workflows | 100-500ms |
| `n8n_update_partial_workflow` | Editing workflows (MOST USED!) | 50-200ms |
| `validate_workflow` | Checking complete workflow | 100-500ms |
| `n8n_deploy_template` | Deploy template to n8n instance | 200-500ms |
| `n8n_manage_datatable` | Managing data tables and rows | 50-500ms |
| `n8n_manage_credentials` | Credential CRUD + schema discovery | 50-500ms |
| `n8n_audit_instance` | Security audit (built-in + custom scan) | 500-5000ms |
| `n8n_autofix_workflow` | Auto-fix validation errors | 200-1500ms |

---

## Tool Selection Guide

### Finding the Right Node

**Workflow**:
```
1. search_nodes({query: "keyword"})
2. get_node({nodeType: "nodes-base.name"})
3. [Optional] get_node({nodeType: "nodes-base.name", mode: "docs"})
```

**Example**:
```javascript
// Step 1: Search
search_nodes({query: "slack"})
// Returns: nodes-base.slack

// Step 2: Get details
get_node({nodeType: "nodes-base.slack"})
// Returns: operations, properties, examples (standard detail)

// Step 3: Get readable documentation
get_node({nodeType: "nodes-base.slack", mode: "docs"})
// Returns: markdown documentation
```

**Common pattern**: search → get_node (18s average)

### Validating Configuration

**Workflow**:
```
1. validate_node({nodeType, config: {}, mode: "minimal"}) - Check required fields
2. validate_node({nodeType, config, profile: "runtime"}) - Full validation
3. [Repeat] Fix errors, validate again
```

**Common pattern**: validate → fix → validate (23s thinking, 58s fixing per cycle)

### Managing Workflows

**Workflow**:
```
1. n8n_create_workflow({name, nodes, connections})
2. n8n_validate_workflow({id})
3. n8n_update_partial_workflow({id, operations: [...]})
4. n8n_validate_workflow({id}) again
5. n8n_update_partial_workflow({id, operations: [{type: "activateWorkflow"}]})
```

**Common pattern**: iterative updates (56s average between edits)

### Critical: Node JSON Hygiene When Creating Workflows

Three structural mistakes in generated node JSON break the n8n UI even when the workflow validates:

1. **Never emit a `credentials` block with a placeholder ID.** A fake ID like `"id": "REPLACE_ME"` renders the credential selector permanently disabled and non-clickable in the n8n UI ("No credentials yet") — the user has to recreate the node from scratch. If you don't know the real credential ID, **omit the `credentials` block entirely**; an absent block shows a normal empty dropdown the user can click. Use `n8n_manage_credentials({action: "list"})` to discover real credential IDs first.

```javascript
// ❌ Breaks the credential selector
"credentials": {"httpHeaderAuth": {"id": "REPLACE_ME", "name": "My API Key"}}

// ✅ Unknown ID → omit credentials block; user picks in UI
// ✅ Known ID (from n8n_manage_credentials list) → use the real ID
```

2. **Generate UUID v4 values for node `id`** — not human-readable strings like `"http-list-node"`. n8n's frontend uses node IDs for form binding and credential component initialization; non-UUID IDs cause subtle UI breakage.

3. **Use the current `typeVersion`** for each node — check `get_node` rather than hardcoding remembered versions (e.g. httpRequest is at 4.4+, not 4.2).

---

## Critical: nodeType Formats

**Two different formats** for different tools!

### Format 1: Search/Validate Tools
```javascript
// Use SHORT prefix
"nodes-base.slack"
"nodes-base.httpRequest"
"nodes-base.webhook"
"nodes-langchain.agent"
```

**Tools that use this**:
- search_nodes (returns this format)
- get_node
- validate_node
- validate_workflow

### Format 2: Workflow Tools
```javascript
// Use FULL prefix
"n8n-nodes-base.slack"
"n8n-nodes-base.httpRequest"
"n8n-nodes-base.webhook"
"@n8n/n8n-nodes-langchain.agent"
```

**Tools that use this**:
- n8n_create_workflow
- n8n_update_partial_workflow

### Conversion

```javascript
// search_nodes returns BOTH formats
{
  "nodeType": "nodes-base.slack",          // For search/validate tools
  "workflowNodeType": "n8n-nodes-base.slack"  // For workflow tools
}
```

---

## Common Mistakes

Eight recurring mistakes. Two are worth showing in full because they silently corrupt structure:

```javascript
// nodeType prefix (search/validate tools want the SHORT form)
get_node({nodeType: "slack"})              // ❌ missing prefix → "Node not found"
get_node({nodeType: "n8n-nodes-base.slack"}) // ❌ FULL prefix is for workflow tools
get_node({nodeType: "nodes-base.slack"})     // ✅

// credentials must be nested by type with {id, name} — not a flat string
updates: {credentials: "myApiKey"}                              // ❌
updates: {credentials: {httpHeaderAuth: {id: "abc123", name: "My API Key"}}}  // ✅
```

| # | Mistake | Fix |
|---|---------|-----|
| 1 | Wrong nodeType format | SHORT `nodes-base.*` for search/validate; FULL `n8n-nodes-base.*` for workflow tools (see above) |
| 2 | `detail: "full"` by default | Default `standard` covers 95%; reach for `docs`/`search_properties` instead of `full` |
| 3 | No validation profile | Pass `profile: "runtime"` explicitly (`minimal`/`ai-friendly`/`strict` for other stages) |
| 4 | Ignoring auto-sanitization | ALL nodes sanitized on ANY update (operator structures, IF/Switch metadata); it can't fix broken connections or branch-count mismatches |
| 5 | Not using smart parameters | Use `branch: "true"` / `case: 0` instead of fragile `sourceIndex` math |
| 6 | Omitting `intent` | Always include `intent` on `n8n_update_partial_workflow` for better responses |
| 7 | `parameters` instead of `updates` | `updateNode` takes `updates: {...}`, not `parameters: {...}` |
| 8 | Wrong credential format | Nest by type with `{id, name}` (see above) |

Full WRONG/CORRECT examples for each: see [VALIDATION_GUIDE.md → Common Mistakes](VALIDATION_GUIDE.md).

---

## Tool Usage Patterns

Three patterns dominate real usage. Worked, step-by-step examples for each live in the reference guides.

- **Pattern 1 — Node Discovery** (18s avg between steps): `search_nodes({query})` → `get_node({nodeType, includeExamples: true})`. See [SEARCH_GUIDE.md](SEARCH_GUIDE.md).
- **Pattern 2 — Validation Loop** (23s thinking, 58s fixing): `validate_node({profile: "runtime"})` → read `errors` → fix config → validate again until clean. See [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md).
- **Pattern 3 — Workflow Editing** (99.0% success, 56s avg between edits): iterate `n8n_update_partial_workflow` (with `intent`) → `n8n_validate_workflow` → finally `activateWorkflow`. Build iteratively, NOT one-shot. See [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md).

---

## Detailed Guides

### Node Discovery Tools
See [SEARCH_GUIDE.md](SEARCH_GUIDE.md) for:
- search_nodes
- get_node with detail levels (minimal, standard, full)
- get_node modes (info, docs, search_properties, versions)

### Validation Tools
See [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md) for:
- Validation profiles explained
- validate_node with modes (minimal, full)
- validate_workflow complete structure
- Auto-sanitization system
- Handling validation errors

### Workflow Management
See [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) for:
- n8n_create_workflow
- n8n_update_partial_workflow (19 operation types including patchNodeField!)
- Smart parameters (branch, case)
- AI connection types (8 types)
- Workflow activation (activateWorkflow/deactivateWorkflow)
- n8n_deploy_template
- n8n_workflow_versions
- n8n_manage_credentials (credential CRUD + schema discovery)
- n8n_audit_instance (security auditing)

### Templates, Data Tables & Self-Help
See [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md) for:
- search_templates / get_template / n8n_deploy_template examples
- n8n_manage_datatable (full actions, filter conditions, examples)
- tools_documentation, ai_agents_guide, n8n_health_check

---

## Template Usage

The 2,700+ template library has three tools: `search_templates` (modes `query`/`by_nodes`/`by_task`/`by_metadata`), `get_template` (modes `structure`/`full`), and `n8n_deploy_template` (deploys to your instance with `autoFix`/`autoUpgradeVersions`, returns workflow ID + required credentials + fixes applied).

See [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md) for full search/get/deploy examples.

---

## Data Table Management

`n8n_manage_datatable` is the MCP tool for managing data tables and rows from *outside* a workflow (table actions `createTable`/`listTables`/`getTable`/`updateTable`/`deleteTable`; row actions `getRows`/`insertRows`/`updateRows`/`upsertRows`/`deleteRows`, with filtering, pagination, and `dryRun`). Don't confuse it with the in-workflow `nodes-base.dataTable` node, which reads/writes rows *during execution* (see [n8n-node-configuration → OPERATION_PATTERNS.md](../n8n-node-configuration/OPERATION_PATTERNS.md#data-table-nodes-basedatatable)). Rule of thumb: MCP tool to set up a table once, workflow node to read/write on every execution. `deleteRows` requires a filter; use `dryRun: true` before bulk changes.

See [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md) for all actions, filter conditions, and examples.

---

## Credential Management

`n8n_manage_credentials` is the unified credential tool: actions `list`, `get`, `create`, `update`, `delete`, `getSchema`. It never returns secrets — `get`/`create`/`update` strip the `data` field. Use `getSchema` before `create` to discover required fields. The optional `includeUsage: true` flag (on `list`/`get`) reverse-scans workflows and attaches `usedIn: [{id, name, active}]` + `usageCount` — use it before deleting or rotating a credential to see what breaks (it triggers a full client-side scan, caps at 5000 workflows, excludes archived, and degrades to a `usageScanError` field on failure).

See [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) for all actions, the includeUsage shape, security notes, and the safe delete/rotate workflow.

---

## Security & Audit

`n8n_audit_instance` combines n8n's built-in audit (categories `credentials`/`database`/`nodes`/`instance`/`filesystem`) with a custom deep scan (`hardcoded_secrets`, `unauthenticated_webhooks`, `error_handling`, `data_retention`). All parameters optional: `categories`, `includeCustomScan` (default `true`), `customChecks`, `daysAbandonedWorkflow`. Detected secrets are masked (first 6 + last 4 chars). Output is an actionable markdown report — summary table, findings by workflow, and a Remediation Playbook split into auto-fixable / requires-review / requires-user-action.

See [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) for the two scanning approaches, examples, and remediation types in full.

---

## Self-Help Tools

- `tools_documentation()` — overview of all tools; `tools_documentation({topic, depth: "full"})` for a specific tool. Code node guides via topics `javascript_code_node_guide` / `python_code_node_guide`.
- **AI agent guide** — `tools_documentation({topic: "ai_agents_guide", depth: "full"})` (no standalone tool); returns architecture, connections, tools, validation, best practices.
- `n8n_health_check()` — quick check; `n8n_health_check({mode: "diagnostic"})` returns status, env vars, tool status, API connectivity.

See [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md) for examples.

---

## Tool Availability

**Always Available** (no n8n API needed):
- search_nodes, get_node
- validate_node, validate_workflow
- search_templates, get_template
- tools_documentation (includes the ai_agents_guide topic)

**Requires n8n API** (N8N_API_URL + N8N_API_KEY):
- n8n_create_workflow
- n8n_update_partial_workflow, n8n_update_full_workflow
- n8n_validate_workflow (by ID)
- n8n_list_workflows, n8n_get_workflow, n8n_delete_workflow
- n8n_test_workflow
- n8n_executions
- n8n_deploy_template
- n8n_workflow_versions
- n8n_autofix_workflow
- n8n_manage_datatable
- n8n_manage_credentials
- n8n_audit_instance

If API tools unavailable, use templates and validation-only workflows.

---

## Unified Tool Reference

- **`get_node`** — detail levels (`minimal` ~200 tok / `standard` ~1-2K, RECOMMENDED / `full` ~3-8K, sparingly) and modes (`info` default, `docs`, `search_properties` + `propertyQuery`, `versions`, `compare`, `breaking`, `migrations`). Deep dive in [SEARCH_GUIDE.md](SEARCH_GUIDE.md).
- **`validate_node`** — modes `full` (default, errors/warnings/suggestions) and `minimal` (required-fields check); profiles `minimal`/`runtime` (default, recommended)/`ai-friendly`/`strict`. Deep dive in [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md).

---

## Performance Characteristics

| Tool | Response Time | Payload Size |
|------|---------------|--------------|
| search_nodes | <20ms | Small |
| get_node (standard) | <10ms | ~1-2KB |
| get_node (full) | <100ms | 3-8KB |
| validate_node (minimal) | <50ms | Small |
| validate_node (full) | <100ms | Medium |
| validate_workflow | 100-500ms | Medium |
| n8n_manage_credentials | 50-500ms | Small-Medium |
| n8n_audit_instance | 500-5000ms | Large |
| n8n_create_workflow | 100-500ms | Medium |
| n8n_update_partial_workflow | 50-200ms | Small |
| n8n_deploy_template | 200-500ms | Medium |

---

## Best Practices

### Do
- For simple workflows (<=5 nodes), use MCP tools directly — don't over-engineer the investigation
- Use `patchNodeField` for surgical edits to Code node content instead of replacing the entire node
- Use `get_node({detail: "standard"})` for most use cases
- Specify validation profile explicitly (`profile: "runtime"`)
- Use smart parameters (`branch`, `case`) for clarity
- Include `intent` parameter in workflow updates
- Follow search → get_node → validate workflow
- Iterate workflows (avg 56s between edits)
- Validate after every significant change
- Use `includeExamples: true` for real configs
- Use `n8n_deploy_template` for quick starts

### Don't
- Use `detail: "full"` unless necessary (wastes tokens)
- Forget nodeType prefix (`nodes-base.*`)
- Skip validation profiles
- Try to build workflows in one shot (iterate!)
- Ignore auto-sanitization behavior
- Use full prefix (`n8n-nodes-base.*`) with search/validate tools
- Forget to activate workflows after building

---

## Summary

**Most Important**:
1. Use **get_node** with `detail: "standard"` (default) - covers 95% of use cases
2. nodeType formats differ: `nodes-base.*` (search/validate) vs `n8n-nodes-base.*` (workflows)
3. Specify **validation profiles** (`runtime` recommended)
4. Use **smart parameters** (`branch="true"`, `case=0`)
5. Include **intent parameter** in workflow updates
6. **Auto-sanitization** runs on ALL nodes during updates
7. Workflows can be **activated via API** (`activateWorkflow` operation)
8. Workflows are built **iteratively** (56s avg between edits)
9. **Data tables** managed with `n8n_manage_datatable` (CRUD + filtering)
10. **Credentials** managed with `n8n_manage_credentials` (CRUD + schema discovery)
11. **Security audits** via `n8n_audit_instance` (built-in + custom deep scan)
12. **AI agent guide** available via `tools_documentation({topic: "ai_agents_guide", depth: "full"})`

**Common Workflow**:
1. search_nodes → find node
2. get_node → understand config
3. validate_node → check config
4. n8n_create_workflow → build
5. n8n_validate_workflow → verify
6. n8n_update_partial_workflow → iterate
7. activateWorkflow → go live!

For details, see:
- [SEARCH_GUIDE.md](SEARCH_GUIDE.md) - Node discovery
- [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md) - Configuration validation + common mistakes
- [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) - Workflow management
- [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md) - Templates, data tables, self-help tools

---

**Related Skills**:
- n8n Expression Syntax - Write expressions in workflow fields
- n8n Workflow Patterns - Architectural patterns from templates
- n8n Validation Expert - Interpret validation errors
- n8n Node Configuration - Operation-specific requirements
- n8n Code JavaScript - Write JavaScript in Code nodes
- n8n Code Python - Write Python in Code nodes
