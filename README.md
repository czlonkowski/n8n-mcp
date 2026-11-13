# n8n-MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/czlonkowski/n8n-mcp?style=social)](https://github.com/czlonkowski/n8n-mcp)
[![npm version](https://img.shields.io/npm/v/n8n-mcp.svg)](https://www.npmjs.com/package/n8n-mcp)
[![codecov](https://codecov.io/gh/czlonkowski/n8n-mcp/graph/badge.svg?token=YOUR_TOKEN)](https://codecov.io/gh/czlonkowski/n8n-mcp)
[![Tests](https://img.shields.io/badge/tests-6524%20passing-brightgreen.svg)](https://github.com/czlonkowski/n8n-mcp/actions)
[![n8n version](https://img.shields.io/badge/n8n-2.46.7-orange.svg)](https://github.com/n8n-io/n8n)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fczlonkowski%2Fn8n--mcp-green.svg)](https://github.com/czlonkowski/n8n-mcp/pkgs/container/n8n-mcp)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16495/badge)](https://www.bestpractices.dev/projects/16495)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/n8n-mcp?referralCode=n8n-mcp)

n8n-MCP is an open-source MCP server that lets Claude, ChatGPT, Cursor, and other AI assistants operate n8n: read failed executions, edit workflows in place, validate and test them, manage credentials, and build new workflows. It works with any n8n instance that has the Public API enabled, and can use n8n's built-in MCP server as a second backend.

## What You Can Do With It

- **Debug failing workflows** - `n8n_executions` reads an execution and, with `mode: "error"`, returns the error, the failing node, and sample items from the node before it.
- **Edit workflows in place** - `n8n_update_partial_workflow` applies targeted operations to the nodes and connections named in the request, so the assistant does not resend the whole workflow. This includes find-and-replace inside one large field such as a Code node (`patchNodeField`). By default n8n-MCP saves a snapshot before it changes a workflow's nodes or connections, and `n8n_workflow_versions` can diff and roll back.
- **Validate and fix before going live** - `validate_node`, `validate_workflow`, and `n8n_validate_workflow` report unknown nodes, invalid node versions, missing required fields, and broken connections or expressions. `n8n_autofix_workflow` repairs the common ones.
- **Test** - `n8n_test_workflow` runs a workflow through its webhook, form, or chat trigger, or, through n8n's built-in MCP server, with pinned data when it has no such trigger.
- **Manage the instance** - create, update, and delete credentials, work with data tables and folders, and run a security audit (`n8n_audit_instance`).
- **Build new workflows** - bundled knowledge of 3,501 nodes and 2,352 templates, so the assistant configures real nodes instead of guessing.
- **Work across several n8n instances** - on the [hosted service](https://www.n8n-mcp.com/docs/multi-instance), register production, staging, and client instances once and name the target on each call. Self-hosted HTTP mode can serve several instances with [per-request instance headers](./docs/HTTP_DEPLOYMENT.md#per-request-instance-headers-multi-tenant).

## n8n-MCP and n8n's Built-In MCP Server

n8n ships its own instance-level MCP server, and it covers a lot: building and editing workflows, executions, version history, data tables, and Agents. n8n-MCP does not replace it. The two differ in how they are built:

| | n8n's built-in MCP server | n8n-MCP |
|---|---|---|
| Runs | Inside one n8n instance | As a separate server that talks to n8n |
| Instances per connection | One | Several (hosted service, or multi-tenant HTTP mode) |
| Credentials | Lists credentials and edits their descriptions | Creates, updates, and deletes credentials |
| n8n versions | Present since late n8n 1.x; most tools need n8n 2.12 or later, and each tool has its own minimum version | Workflow and execution tools work through the Public API on older versions too, including the 1.x line. Credential actions depend on what that version's API exposes, and newer tools state the version they need |
| Workflow access | Most operations need the workflow's "Available in MCP" setting, which is off by default | Every workflow the API key can reach |

**The built-in server is enough when** you work with a single instance on a recent n8n 2.x, build and edit workflows on that instance, and set up credentials yourself in the n8n UI.

**Add n8n-MCP when** you run more than one instance, want the assistant to create and update credentials, are on an older n8n version that predates the built-in tools you need, or want autofix, execution error analysis, templates, and a security audit.

**Or use both through one connection.** Set `N8N_MCP_ACCESS_TOKEN` and n8n-MCP routes the operations the Public API cannot perform to n8n's own server: test runs with pinned data, n8n's native version history, live dropdown values, n8n Agents, and data-table column changes. The assistant still sees one MCP server. See [Official MCP Setup](./docs/OFFICIAL_MCP_SETUP.md).

> **Naming note:** n8n's documentation uses `n8n-mcp` as the example connection name for its built-in server in some client configurations (for example `claude mcp add --transport http n8n-mcp https://<your-n8n-domain>/mcp-server/http`). That name points at n8n's own server. This project is a separate open-source server: `github.com/czlonkowski/n8n-mcp`, published on npm as `n8n-mcp`.

## Node and Template Coverage

The documentation and validation tools work without an n8n connection, against a bundled database:

- **3,501 n8n nodes** - 842 core nodes + 2,659 community nodes (2,228 verified)
- **Node properties** - 99% coverage with detailed schemas
- **Node operations** - 66.5% coverage of available actions
- **Documentation** - 86% coverage from official n8n docs (including AI nodes)
- **AI tools** - 267 AI-capable tool variants detected with full documentation
- **Real-world examples** - 156 ranked configurations extracted from popular templates
- **Template library** - 2,352 workflow templates with 99.96% AI metadata coverage
- **Community nodes** - Search verified community integrations with `source` filter

## Support This Project

<div align="center">
  <a href="https://github.com/sponsors/czlonkowski">
    <img src="https://img.shields.io/badge/Sponsor-❤️-db61a2?style=for-the-badge&logo=github-sponsors" alt="Sponsor n8n-mcp" />
  </a>
</div>

**n8n-mcp** started as a personal tool but now helps tens of thousands of developers automate their workflows efficiently. Maintaining and developing this project competes with my paid work. Your sponsorship helps me dedicate focused time to new features, respond quickly to issues, keep documentation up-to-date, and ensure compatibility with latest n8n releases. **[Become a sponsor](https://github.com/sponsors/czlonkowski)**

> 💼 **Need it built for you?** Work with [AiAdvisors — n8n automation audits, builds, and operations](https://aiadvisors.pl/en), run by the author of n8n-mcp and n8n-skills.

## Working Safely on Live Workflows

AI results can be unpredictable, and n8n-MCP can change real workflows. **Try changes to important production workflows on a copy or a staging instance first.**

- **Snapshots and rollback** - by default n8n-MCP saves a version of a workflow before it changes its nodes or connections, and keeps up to 10 per workflow. `n8n_workflow_versions` lists, diffs, and rolls back those versions. A snapshot that fails to save does not stop the edit, so check that a version exists before relying on rollback for an important change.
- **One editor at a time** - n8n-MCP reads a workflow, applies the change, and writes the whole workflow back, because n8n's Public API has no conditional write. An edit made in the n8n UI in between is overwritten, so do not edit a workflow in the UI while the assistant is working on it.
- **Validate before deploying** - run `validate_workflow` on the change, and `n8n_validate_workflow` once it is in n8n.
- **Keep exports** of workflows you cannot afford to lose.
- **Limit what the assistant can do** - [Read-Only Deployment](#read-only-deployment) disables write operations.

## Quick Start

**The fastest way to try n8n-MCP** - no installation, no configuration:

**[dashboard.n8n-mcp.com](https://dashboard.n8n-mcp.com)**

- Free tier: 100 tool calls/day
- Instant access: Connect your n8n instance and start working on your workflows
- Several n8n instances through one connection, on every plan ([multi-instance guide](https://www.n8n-mcp.com/docs/multi-instance))
- OAuth sign-in for claude.ai and ChatGPT, API keys for IDEs and other MCP clients
- Your n8n API key is stored encrypted and is never returned to the AI client
- Always up-to-date: Latest n8n nodes and templates
- No infrastructure: We handle everything

The hosted service is run by the author of this project. Just sign up, connect your n8n instance, and connect your MCP client.

**Want to self-host?** See the [Self-Hosting Guide](./docs/SELF_HOSTING.md) for npx, Docker, Railway, and local installation options.

## n8n Integration

Want to use n8n-MCP with your n8n instance? Check out our comprehensive [n8n Deployment Guide](./docs/N8N_DEPLOYMENT.md) for:
- Local testing with the MCP Client Tool node
- Production deployment with Docker Compose
- Cloud deployment on Hetzner, AWS, and other providers
- Troubleshooting and security best practices

### Cloudflare Access Authentication

If your n8n instance sits behind Cloudflare Access (Zero Trust), provide your service token so n8n-MCP can authenticate:

- `N8N_CF_CLIENT_ID` - Cloudflare Access Client ID
- `N8N_CF_CLIENT_SECRET` - Cloudflare Access Client Secret

When set, these are sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on n8n API requests, version/health probes, and webhook executions. The token is confined to the `N8N_API_URL` origin — webhook calls to a different host (e.g. a split `WEBHOOK_URL` origin) do not receive it, to avoid leaking the token.

### n8n Agents and Instance-Level MCP (Optional)

To use `n8n_manage_agents`, `n8n_explore_node_resources`, and the project fallback in `n8n_list_catalog`, set:

- `N8N_MCP_ACCESS_TOKEN` - MCP API key from n8n Settings → Instance-level MCP → set MCP status to Enabled. This is a separate secret from `N8N_API_KEY` and should be stored the same way. The MCP endpoint is derived from `N8N_API_URL`; instances that serve MCP from a split host (`N8N_MCP_BASE_URL`) are not supported.

See [Connecting n8n-mcp to n8n's instance-level MCP server](./docs/OFFICIAL_MCP_SETUP.md) for the full setup walkthrough, including how to get the token from the n8n UI, prerequisites, and troubleshooting.

## Connect your IDE

n8n-MCP works with multiple AI-powered IDEs and tools:

- [Claude Code](./docs/CLAUDE_CODE_SETUP.md) - Quick setup for Claude Code CLI
- [Visual Studio Code](./docs/VS_CODE_PROJECT_SETUP.md) - VS Code with GitHub Copilot integration
- [Cursor](./docs/CURSOR_SETUP.md) - Step-by-step Cursor IDE setup
- [Windsurf](./docs/WINDSURF_SETUP.md) - Windsurf integration with project rules
- [Codex](./docs/CODEX_SETUP.md) - Codex integration guide
- [Kiro](./docs/KIRO_SETUP.md) - Kiro IDE and CLI setup
- [Antigravity](./docs/ANTIGRAVITY_SETUP.md) - Antigravity integration guide

## Add Claude Skills (Optional)

Supercharge your n8n workflow building with specialized skills that teach AI how to build production-ready workflows!

[![n8n-mcp Skills Setup](./docs/img/skills.png)](https://www.youtube.com/watch?v=e6VvRqmUY2Y)

Learn more: [n8n-skills repository](https://github.com/czlonkowski/n8n-skills)

## Claude Project Setup

For the best results when using n8n-MCP with Claude Projects, use these enhanced system instructions:

````markdown
You are an expert in n8n automation software using n8n-MCP tools. Your role is to design, build, and validate n8n workflows with maximum accuracy and efficiency.

## Core Principles

### 1. Silent Execution
CRITICAL: Execute tools without commentary. Only respond AFTER all tools complete.

### 2. Parallel Execution
When operations are independent, execute them in parallel for maximum performance.

### 3. Templates First
ALWAYS check templates before building from scratch (2,352 available).

### 4. Multi-Level Validation
Use validate_node(mode='minimal') → validate_node(mode='full') → validate_workflow pattern.

### 5. Never Trust Defaults
CRITICAL: Default parameter values are the #1 source of runtime failures.
ALWAYS explicitly configure ALL parameters that control node behavior.

## Workflow Process

1. **Start**: Call `tools_documentation()` for best practices

2. **Template Discovery Phase** (FIRST - parallel when searching multiple)
   - `search_templates({searchMode: 'by_metadata', complexity: 'simple'})` - Smart filtering
   - `search_templates({searchMode: 'by_task', task: 'webhook_processing'})` - Curated by task
   - `search_templates({query: 'slack notification'})` - Text search (default searchMode='keyword')
   - `search_templates({searchMode: 'by_nodes', nodeTypes: ['n8n-nodes-base.slack']})` - By node type

   **Filtering strategies**:
   - Beginners: `complexity: "simple"` + `maxSetupMinutes: 30`
   - By role: `targetAudience: "marketers"` | `"developers"` | `"analysts"`
   - By time: `maxSetupMinutes: 15` for quick wins
   - By service: `requiredService: "openai"` for compatibility

3. **Node Discovery** (if no suitable template - parallel execution)
   - Think deeply about requirements. Ask clarifying questions if unclear.
   - `search_nodes({query: 'keyword', includeExamples: true})` - Parallel for multiple nodes
   - `search_nodes({query: 'trigger'})` - Browse triggers
   - `search_nodes({query: 'AI agent langchain'})` - AI-capable nodes

4. **Configuration Phase** (parallel for multiple nodes)
   - `get_node({nodeType, detail: 'standard', includeExamples: true})` - Essential properties (default)
   - `get_node({nodeType, detail: 'minimal'})` - Basic metadata only (~200 tokens)
   - `get_node({nodeType, detail: 'full'})` - Complete information (~3000-8000 tokens)
   - `get_node({nodeType, mode: 'search_properties', propertyQuery: 'auth'})` - Find specific properties
   - `get_node({nodeType, mode: 'docs'})` - Human-readable markdown documentation
   - Show workflow architecture to user for approval before proceeding

5. **Validation Phase** (parallel for multiple nodes)
   - `validate_node({nodeType, config, mode: 'minimal'})` - Quick required fields check
   - `validate_node({nodeType, config, mode: 'full', profile: 'runtime'})` - Full validation with fixes
   - Fix ALL errors before proceeding

6. **Building Phase**
   - If using template: `get_template({templateId, mode: "full"})`
   - **MANDATORY ATTRIBUTION**: "Based on template by **[author.name]** (@[username]). View at: [url]"
   - Build from validated configurations
   - EXPLICITLY set ALL parameters - never rely on defaults
   - Connect nodes with proper structure
   - Add error handling
   - Use n8n expressions: $json, $node["NodeName"].json
   - Build in artifact (unless deploying to n8n instance)

7. **Workflow Validation** (before deployment)
   - `validate_workflow({workflow})` - Node, connection, and expression validation
   - Fix ALL issues before deployment

8. **Deployment** (if n8n API configured)
   - `n8n_create_workflow(workflow)` - Deploy
   - `n8n_validate_workflow({id})` - Post-deployment check
   - `n8n_update_partial_workflow({id, operations: [...]})` - Batch updates
   - `n8n_test_workflow({workflowId})` - Test workflow execution

## Critical Warnings

### Never Trust Defaults
Default values cause runtime failures. Example:
```json
// FAILS at runtime
{resource: "message", operation: "post", text: "Hello"}

// WORKS - all parameters explicit
{resource: "message", operation: "post", select: "channel", channelId: "C123", text: "Hello"}
```

### Example Availability
`includeExamples: true` returns real configurations from workflow templates.
- Coverage varies by node popularity
- When no examples available, use `get_node` + `validate_node({mode: 'minimal'})`

## Validation Strategy

### Level 1 - Quick Check (before building)
`validate_node({nodeType, config, mode: 'minimal'})` - Required fields only (<100ms)

### Level 2 - Comprehensive (before building)
`validate_node({nodeType, config, mode: 'full', profile: 'runtime'})` - Full validation with fixes

### Level 3 - Complete (after building)
`validate_workflow({workflow})` - Connections, expressions, AI tools

### Level 4 - Post-Deployment
1. `n8n_validate_workflow({id})` - Validate deployed workflow
2. `n8n_autofix_workflow({id})` - Auto-fix common errors
3. `n8n_executions({action: 'list'})` - Monitor execution status

## Response Format

### Initial Creation
```
[Silent tool execution in parallel]

Created workflow:
- Webhook trigger → Slack notification
- Configured: POST /webhook → #general channel

Validation: All checks passed
```

### Modifications
```
[Silent tool execution]

Updated workflow:
- Added error handling to HTTP node
- Fixed required Slack parameters

Changes validated successfully.
```

## Batch Operations

Use `n8n_update_partial_workflow` with multiple operations in a single call:

GOOD - Batch multiple operations:
```json
n8n_update_partial_workflow({
  id: "wf-123",
  operations: [
    {type: "updateNode", nodeId: "slack-1", updates: {...}},
    {type: "updateNode", nodeId: "http-1", updates: {...}},
    {type: "cleanStaleConnections"}
  ]
})
```

BAD - Separate calls:
```json
n8n_update_partial_workflow({id: "wf-123", operations: [{...}]})
n8n_update_partial_workflow({id: "wf-123", operations: [{...}]})
```

### CRITICAL: addConnection Syntax

The `addConnection` operation requires **`source` and `target`**. Optional `sourceOutput` and `targetInput` select connection types and default to `"main"`.

CORRECT - Separate source and target parameters:
```json
{
  "type": "addConnection",
  "source": "node-id-string",
  "target": "target-node-id-string",
  "sourceOutput": "main",
  "targetInput": "main"
}
```

**Reference**: [GitHub Issue #327](https://github.com/czlonkowski/n8n-mcp/issues/327)

### CRITICAL: IF Node Multi-Output Routing

IF nodes have **two outputs** (TRUE and FALSE). Use the **`branch` parameter** to route to the correct output:

```json
n8n_update_partial_workflow({
  id: "workflow-id",
  operations: [
    {type: "addConnection", source: "If Node", target: "True Handler", sourceOutput: "main", targetInput: "main", branch: "true"},
    {type: "addConnection", source: "If Node", target: "False Handler", sourceOutput: "main", targetInput: "main", branch: "false"}
  ]
})
```

**Note**: Without the `branch` parameter, both connections may end up on the same output, causing logic errors!

### removeConnection Syntax

Use the same source/target format, with optional connection types:
```json
{
  "type": "removeConnection",
  "source": "source-node-id",
  "target": "target-node-id",
  "sourceOutput": "main",
  "targetInput": "main"
}
```

## Important Rules

### Core Behavior
1. **Silent execution** - No commentary between tools
2. **Parallel by default** - Execute independent operations simultaneously
3. **Templates first** - Always check before building (2,352 available)
4. **Multi-level validation** - Quick check → Full validation → Workflow validation
5. **Never trust defaults** - Explicitly configure ALL parameters

### Attribution & Credits
- **MANDATORY TEMPLATE ATTRIBUTION**: Share author name, username, and n8n.io link
- **Template validation** - Always validate before deployment (may need updates)

### Code Node Usage
- **Avoid when possible** - Prefer standard nodes
- **Only when necessary** - Use code node as last resort
- **AI tool capability** - ANY node can be an AI tool (not just marked ones)

### Most Popular n8n Nodes (for get_node):

1. **n8n-nodes-base.code** - JavaScript/Python scripting
2. **n8n-nodes-base.httpRequest** - HTTP API calls
3. **n8n-nodes-base.webhook** - Event-driven triggers
4. **n8n-nodes-base.set** - Data transformation
5. **n8n-nodes-base.if** - Conditional routing
6. **n8n-nodes-base.manualTrigger** - Manual workflow execution
7. **n8n-nodes-base.respondToWebhook** - Webhook responses
8. **n8n-nodes-base.scheduleTrigger** - Time-based triggers
9. **@n8n/n8n-nodes-langchain.agent** - AI agents
10. **n8n-nodes-base.googleSheets** - Spreadsheet integration
11. **n8n-nodes-base.merge** - Data merging
12. **n8n-nodes-base.switch** - Multi-branch routing
13. **n8n-nodes-base.telegram** - Telegram bot integration
14. **@n8n/n8n-nodes-langchain.lmChatOpenAi** - OpenAI chat models
15. **n8n-nodes-base.splitInBatches** - Batch processing
16. **n8n-nodes-base.openAi** - OpenAI legacy node
17. **n8n-nodes-base.gmail** - Email automation
18. **n8n-nodes-base.function** - Custom functions
19. **n8n-nodes-base.stickyNote** - Workflow documentation
20. **n8n-nodes-base.executeWorkflowTrigger** - Sub-workflow calls

**Note:** LangChain nodes use the `@n8n/n8n-nodes-langchain.` prefix, core nodes use `n8n-nodes-base.`

````

Save these instructions in your Claude Project for optimal n8n workflow assistance with intelligent template discovery.

## Available MCP Tools

### Core Tools (7 tools)
- **`tools_documentation`** - Get documentation for any MCP tool (START HERE!)
- **`search_nodes`** - Full-text search across all nodes. Use `source: 'community'|'verified'` for community nodes, `includeExamples: true` for configs
- **`get_node`** - Unified node information tool with multiple modes:
  - **Info mode** (default): `detail: 'minimal'|'standard'|'full'`, `includeExamples: true`
  - **Docs mode**: `mode: 'docs'` - Human-readable markdown documentation
  - **Property search**: `mode: 'search_properties'`, `propertyQuery: 'auth'`
  - **Versions**: `mode: 'versions'|'compare'|'breaking'|'migrations'`
- **`validate_node`** - Unified node validation:
  - `mode: 'minimal'` - Quick required fields check (<100ms)
  - `mode: 'full'` - Comprehensive validation with profiles (minimal, runtime, ai-friendly, strict)
- **`validate_workflow`** - Complete workflow validation including AI Agent validation
- **`search_templates`** - Unified template search:
  - `searchMode: 'keyword'` (default) - Text search with `query` parameter
  - `searchMode: 'by_nodes'` - Find templates using specific `nodeTypes`
  - `searchMode: 'by_task'` - Curated templates for common `task` types
  - `searchMode: 'by_metadata'` - Filter by `complexity`, `requiredService`, `targetAudience`
- **`get_template`** - Get complete workflow JSON (modes: nodes_only, structure, full)

### n8n Management Tools (21 tools - Requires API Configuration)
These tools require `N8N_API_URL` and `N8N_API_KEY` in your configuration.

#### Workflow Management
- **`n8n_create_workflow`** - Create new workflows with nodes and connections
- **`n8n_get_workflow`** - Unified workflow retrieval (modes: full, details, structure, minimal)
- **`n8n_update_full_workflow`** - Update entire workflow (complete replacement)
- **`n8n_update_partial_workflow`** - Update workflow using diff operations
- **`n8n_delete_workflow`** - Delete workflows permanently
- **`n8n_list_workflows`** - List workflows with filtering and pagination
- **`n8n_validate_workflow`** - Validate workflows in n8n by ID
- **`n8n_autofix_workflow`** - Automatically fix common workflow errors
- **`n8n_workflow_versions`** - Version history, diff and rollback over two histories: `source: 'local'` (the snapshots n8n-mcp takes before it changes a workflow, the default) and `source: 'native'` (n8n's own workflow history, including UI edits — needs `N8N_MCP_ACCESS_TOKEN` and the workflow's "Available in MCP" setting)
- **`n8n_deploy_template`** - Deploy templates from n8n.io directly to your instance with auto-fix

#### Node Resource Discovery
- **`n8n_explore_node_resources`** - Resolve a node's dynamic dropdown (loadOptions) or resource-locator search (listSearch) values — Slack channels, Google Sheets tabs, model lists — using a real credential, so workflow configs use existing IDs instead of invented ones. Requires `N8N_MCP_ACCESS_TOKEN` (see [Official MCP Setup](./docs/OFFICIAL_MCP_SETUP.md))

#### Execution Management
- **`n8n_test_workflow`** - Run a workflow. `method: 'auto'` (default) triggers it over HTTP through its webhook/form/chat trigger; `method: 'prepare'`/`'pinned'`/`'direct'` run workflows that have no such trigger through n8n's own MCP server (needs `N8N_MCP_ACCESS_TOKEN` and the workflow's "Available in MCP" setting)
- **`n8n_executions`** - Unified execution management (list, get, delete)
- **`n8n_evaluations`** - Run and read evaluation test runs (list runs, aggregated metrics, per-case results on n8n 2.30+; trigger and cancel on 2.32+)

#### Folder Management
- **`n8n_manage_folders`** - Manage workflow folders (create, list, get, rename, move, delete; n8n 2.19+). Place workflows into folders via `n8n_create_workflow`'s `parentFolderId` or `n8n_update_partial_workflow`'s `moveToFolder` operation (n8n 2.32+)

#### Data Table Management
- **`n8n_manage_datatable`** - Manage n8n data tables, rows and columns (list, get, create, update, delete; `addColumn`/`deleteColumn`/`renameColumn` change an existing table's columns through n8n's own MCP server and need `N8N_MCP_ACCESS_TOKEN`)

#### Credential Management
- **`n8n_manage_credentials`** - Manage n8n credentials (list, get, create, update, delete, getSchema)

#### Security & Audit
- **`n8n_audit_instance`** - Security audit combining n8n's built-in audit API with deep workflow scanning

#### Agents
- **`n8n_manage_agents`** - Manage n8n Agents (persisted assistants with a model, instructions, tools, skills, tasks, memory and channels) through n8n's instance-level MCP server. Requires `N8N_MCP_ACCESS_TOKEN` and n8n 2.34+ with the agents module (see [Official MCP Setup](./docs/OFFICIAL_MCP_SETUP.md)). This is not the AI Agent workflow node — use `get_node` for that

#### System Tools
- **`n8n_health_check`** - Check n8n API connectivity and features, including `officialMcp` status when `N8N_MCP_ACCESS_TOKEN` is configured
- **`n8n_list_catalog`** - List instance-level projects or tags; falls back to n8n's instance-level MCP server for team projects when the Public API doesn't expose them

### Read-Only Deployment

For governance-sensitive environments, use both env vars together. Fully disable tools that are write/destructive or handle sensitive data (`n8n_manage_credentials` and `n8n_manage_datatable` also offer read operations, but are removed entirely here because even reads expose sensitive material):

```bash
DISABLED_TOOLS=n8n_create_workflow,n8n_update_full_workflow,n8n_update_partial_workflow,n8n_delete_workflow,n8n_autofix_workflow,n8n_deploy_template,n8n_test_workflow,n8n_manage_credentials,n8n_manage_datatable
```

For tools that bundle read and write operations under one name, block only the destructive operations while keeping `list` and `get`. Use this instead of a full `DISABLED_TOOLS` entry where the tool's read operations are acceptable — the `n8n_manage_datatable` and `n8n_test_workflow` entries below are the alternative to removing those tools entirely as above. The example names every write operation of every tool that has one:

```bash
DISABLED_TOOL_OPERATIONS=n8n_executions:delete;n8n_test_workflow:auto,trigger,pinned,direct,expose;n8n_evaluations:run,cancel;n8n_manage_folders:create,rename,move,delete;n8n_workflow_versions:delete,rollback,prune,expose;n8n_manage_agents:create,mutate,call,publish,unpublish,revert,delete,update_integration;n8n_manage_datatable:createTable,updateTable,deleteTable,insertRows,updateRows,upsertRows,deleteRows,addColumn,deleteColumn,renameColumn
```

Two details are easy to miss when writing your own list. For `n8n_test_workflow`, all four of `auto`, `trigger`, `pinned` and `direct` run the workflow (an omitted or blank `method` counts as `auto`), leaving only the read-only `prepare`. And `expose` is not a value of any operation parameter: it is the `exposeToMcp` consent write of `n8n_test_workflow` and `n8n_workflow_versions`, which enables a workflow's "Available in MCP" setting. Omitting `expose` leaves that write reachable.

Combine with a read-only n8n API key (Settings → API in your n8n instance) for defence in depth. See [Read-Only Deployment Recipe](./docs/HTTP_DEPLOYMENT.md#read-only-deployment-recipe) for the full setup guide.

## Documentation

- [Self-Hosting Guide](./docs/SELF_HOSTING.md) - npx, Docker, Railway, and local installation
- [Security & Hardening](./docs/SECURITY_HARDENING.md) - Trust model, hardening options, workflow restrictions
- [n8n Deployment Guide](./docs/N8N_DEPLOYMENT.md) - Production deployment with n8n
- [Database Configuration](./docs/DATABASE_CONFIGURATION.md) - SQLite adapters and memory optimization
- [Privacy & Telemetry](./PRIVACY.md) - What we collect and how to opt out
- [Workflow Diff Operations](./docs/workflow-diff-examples.md) - Token-efficient workflow updates
- [HTTP Deployment](./docs/HTTP_DEPLOYMENT.md) - Remote server setup
- [Official MCP Setup](./docs/OFFICIAL_MCP_SETUP.md) - Connect n8n-mcp to n8n's instance-level MCP server for Agents and node resource discovery
- [Change Log](./CHANGELOG.md) - Complete version history

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, testing, and contribution guidelines.

## Acknowledgments

See [Acknowledgments](./docs/ACKNOWLEDGMENTS.md) for credits and template attribution.

---

<div align="center">
  <strong>Built with care for the n8n community</strong>
</div>

---

> 💼 **Need it built for you?**
>
> Work with [AiAdvisors — n8n automation audits, builds, and operations](https://aiadvisors.pl/en), run by the author of n8n-mcp and n8n-skills.
