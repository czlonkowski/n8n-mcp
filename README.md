# n8n-MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/czlonkowski/n8n-mcp?style=social)](https://github.com/czlonkowski/n8n-mcp)
[![npm version](https://img.shields.io/npm/v/n8n-mcp.svg)](https://www.npmjs.com/package/n8n-mcp)
[![codecov](https://codecov.io/gh/czlonkowski/n8n-mcp/graph/badge.svg?token=YOUR_TOKEN)](https://codecov.io/gh/czlonkowski/n8n-mcp)
[![Tests](https://img.shields.io/badge/tests-5418%20passing-brightgreen.svg)](https://github.com/czlonkowski/n8n-mcp/actions)
[![n8n version](https://img.shields.io/badge/n8n-2.26.5-orange.svg)](https://github.com/n8n-io/n8n)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fczlonkowski%2Fn8n--mcp-green.svg)](https://github.com/czlonkowski/n8n-mcp/pkgs/container/n8n-mcp)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/n8n-mcp?referralCode=n8n-mcp)

A Model Context Protocol (MCP) server that provides AI assistants with comprehensive access to n8n node documentation, properties, and operations. Deploy in minutes to give Claude and other AI assistants deep knowledge about n8n's 1,845 workflow automation nodes (816 core + 1,029 community).

## Overview

n8n-MCP serves as a bridge between n8n's workflow automation platform and AI models, enabling them to understand and work with n8n nodes effectively. It provides structured access to:

- **1,845 n8n nodes** - 816 core nodes + 1,029 community nodes (911 verified)
- **Node properties** - 99% coverage with detailed schemas
- **Node operations** - 63.6% coverage of available actions
- **Documentation** - 87% coverage from official n8n docs (including AI nodes)
- **AI tools** - 265 AI-capable tool variants detected with full documentation
- **Real-world examples** - 156 ranked configurations extracted from popular templates
- **Template library** - 2,352 workflow templates with 99.96% AI metadata coverage
- **Community nodes** - Search verified community integrations with `source` filter


## ⚠️ Important Safety Warning

**NEVER edit your production workflows directly with AI!** Always:
- 🔄 **Make a copy** of your workflow before using AI tools
- 🧪 **Test in development** environment first
- 💾 **Export backups** of important workflows
- ⚡ **Validate changes** before deploying to production

AI results can be unpredictable. Protect your work!

## 🚀 Quick Start

### Option 1: Hosted Service (Easiest - No Setup!) ☁️

**The fastest way to try n8n-MCP** - no installation, no configuration:

👉 **[dashboard.n8n-mcp.com](https://dashboard.n8n-mcp.com)**

- ✅ **Free tier**: 100 tool calls/day
- ✅ **Instant access**: Start building workflows immediately
- ✅ **Always up-to-date**: Latest n8n nodes and templates
- ✅ **No infrastructure**: We handle everything

Just sign up, get your API key, and connect your MCP client. 

---

## 🏠 Self-Hosting Options

Prefer to run n8n-MCP yourself? Choose your deployment method:

### Option A: npx (Quick Local Setup) 🚀

Get n8n-MCP running in minutes:

[![n8n-mcp Video Quickstart Guide](./thumbnail.png)](https://youtu.be/5CccjiLLyaY?si=Z62SBGlw9G34IQnQ&t=343)

**Prerequisites:** [Node.js](https://nodejs.org/) installed on your system

```bash
# Run directly with npx (no installation needed!)
npx n8n-mcp
```

Add to Claude Desktop config:

> ⚠️ **Important**: The `MCP_MODE: "stdio"` environment variable is **required** for Claude Desktop. Without it, you will see JSON parsing errors like `"Unexpected token..."` in the UI. This variable ensures that only JSON-RPC messages are sent to stdout, preventing debug logs from interfering with the protocol.

**Basic configuration (documentation tools only):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true"
      }
    }
  }
}
```

**Full configuration (with n8n management tools):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

> **Note**: npx will download and run the latest version automatically. The package includes a pre-built database with all n8n node information.

**Configuration file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Restart Claude Desktop after updating configuration** - That's it! 🎉

### Option B: Docker (Isolated & Reproducible) 🐳

**Prerequisites:** Docker installed on your system

<details>
<summary><strong>📦 Install Docker</strong> (click to expand)</summary>

**macOS:**
```bash
# Using Homebrew
brew install --cask docker

# Or download from https://www.docker.com/products/docker-desktop/
```

**Linux (Ubuntu/Debian):**
```bash
# Update package index
sudo apt-get update

# Install Docker
sudo apt-get install docker.io

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER
# Log out and back in for this to take effect
```

**Windows:**
```bash
# Option 1: Using winget (Windows Package Manager)
winget install Docker.DockerDesktop

# Option 2: Using Chocolatey
choco install docker-desktop

# Option 3: Download installer from https://www.docker.com/products/docker-desktop/
```

**Verify installation:**
```bash
docker --version
```
</details>

```bash
# Pull the Docker image (~280MB, no n8n dependencies!)
docker pull ghcr.io/czlonkowski/n8n-mcp:latest
```

> **⚡ Ultra-optimized:** Our Docker image is 82% smaller than typical n8n images because it contains NO n8n dependencies - just the runtime MCP server with a pre-built database!

Add to Claude Desktop config:

**Basic configuration (documentation tools only):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "DISABLE_CONSOLE_OUTPUT=true",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

**Full configuration (with n8n management tools):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "DISABLE_CONSOLE_OUTPUT=true",
        "-e", "N8N_API_URL=https://your-n8n-instance.com",
        "-e", "N8N_API_KEY=your-api-key",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

>💡 Tip: If you're running n8n locally on the same machine (e.g., via Docker), use http://host.docker.internal:5678 as the N8N_API_URL.

> **Note**: The n8n API credentials are optional. Without them, you'll have access to all documentation and validation tools. With them, you'll additionally get workflow management capabilities (create, update, execute workflows).

### 🏠 Local n8n Instance Configuration

If you're running n8n locally (e.g., `http://localhost:5678` or Docker), you need to allow localhost webhooks:

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "DISABLE_CONSOLE_OUTPUT=true",
        "-e", "N8N_API_URL=http://host.docker.internal:5678",
        "-e", "N8N_API_KEY=your-api-key",
        "-e", "WEBHOOK_SECURITY_MODE=moderate",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

> ⚠️ **Important:** Set `WEBHOOK_SECURITY_MODE=moderate` to allow webhooks to your local n8n instance. This is safe for local development while still blocking private networks and cloud metadata.

**Important:** The `-i` flag is required for MCP stdio communication.

> 🔧 If you encounter any issues with Docker, check our [Docker Troubleshooting Guide](./docs/DOCKER_TROUBLESHOOTING.md).

**Configuration file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Restart Claude Desktop after updating configuration** - That's it! 🎉

### 🛡️ Cloudflare Access Authentication

If your n8n instance is protected behind Cloudflare Access (Zero Trust), you can provide your service token credentials to allow n8n-MCP to authenticate and bypass the protection:

**Environment Variables:**
- `N8N_CF_CLIENT_ID`: Your Cloudflare Access Client ID
- `N8N_CF_CLIENT_SECRET`: Your Cloudflare Access Client Secret

**Example in Claude Desktop (Docker):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "N8N_API_URL=https://your-protected-n8n.com",
        "-e", "N8N_API_KEY=your-api-key",
        "-e", "N8N_CF_CLIENT_ID=your-cf-client-id",
        "-e", "N8N_CF_CLIENT_SECRET=your-cf-client-secret",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

These headers will be automatically injected into all n8n API requests, webhook executions, and n8n version checks.


## 🔐 Privacy & Telemetry

n8n-mcp collects anonymous usage statistics to improve the tool. [View our privacy policy](./PRIVACY.md).

### Opting Out

**For npx users:**
```bash
npx n8n-mcp telemetry disable
```

**For Docker users:**
Add the following environment variable to your Docker configuration:
```json
"-e", "N8N_MCP_TELEMETRY_DISABLED=true"
```

Example in Claude Desktop config:
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "N8N_MCP_TELEMETRY_DISABLED=true",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

**For docker-compose users:**
Set in your environment file or docker-compose.yml:
```yaml
environment:
  N8N_MCP_TELEMETRY_DISABLED: "true"
```

## ⚙️ Database & Memory Configuration

### Database Adapters

n8n-mcp uses SQLite for storing node documentation. Two adapters are available:

1. **better-sqlite3** (Default in Docker)
   - Native C++ bindings for best performance
   - Direct disk writes (no memory overhead)
   - **Now enabled by default** in Docker images (v2.20.2+)
   - Memory usage: ~100-120 MB stable

2. **sql.js** (Fallback)
   - Pure JavaScript implementation
   - In-memory database with periodic saves
   - Used when better-sqlite3 compilation fails
   - Memory usage: ~150-200 MB stable

### Memory Optimization (sql.js)

If using sql.js fallback, you can configure the save interval to balance between data safety and memory efficiency:

**Environment Variable:**
```bash
SQLJS_SAVE_INTERVAL_MS=5000  # Default: 5000ms (5 seconds)
```

**Usage:**
- Controls how long to wait after database changes before saving to disk
- Lower values = more frequent saves = higher memory churn
- Higher values = less frequent saves = lower memory usage
- Minimum: 100ms
- Recommended: 5000-10000ms for production

**Docker Configuration:**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "SQLJS_SAVE_INTERVAL_MS=10000",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

**docker-compose:**
```yaml
environment:
  SQLJS_SAVE_INTERVAL_MS: "10000"
```

## 💖 Support This Project
## Support This Project

<div align="center">
  <a href="https://github.com/sponsors/czlonkowski">
    <img src="https://img.shields.io/badge/Sponsor-❤️-db61a2?style=for-the-badge&logo=github-sponsors" alt="Sponsor n8n-mcp" />
  </a>
</div>

**n8n-mcp** started as a personal tool but now helps tens of thousands of developers automate their workflows efficiently. Maintaining and developing this project competes with my paid work. Your sponsorship helps me dedicate focused time to new features, respond quickly to issues, keep documentation up-to-date, and ensure compatibility with latest n8n releases. **[Become a sponsor](https://github.com/sponsors/czlonkowski)**

## Important Safety Warning

**NEVER edit your production workflows directly with AI!** Always:
- Make a copy of your workflow before using AI tools
- Test in development environment first
- Export backups of important workflows
- Validate changes before deploying to production

AI results can be unpredictable. Protect your work!

## Quick Start

**The fastest way to try n8n-MCP** - no installation, no configuration:

**[dashboard.n8n-mcp.com](https://dashboard.n8n-mcp.com)**

- Free tier: 100 tool calls/day
- Instant access: Start building workflows immediately
- Always up-to-date: Latest n8n nodes and templates
- No infrastructure: We handle everything

Just sign up, get your API key, and connect your MCP client.

**Want to self-host?** See the [Self-Hosting Guide](./docs/SELF_HOSTING.md) for npx, Docker, Railway, and local installation options.

## n8n Integration

Want to use n8n-MCP with your n8n instance? Check out our comprehensive [n8n Deployment Guide](./docs/N8N_DEPLOYMENT.md) for:
- Local testing with the MCP Client Tool node
- Production deployment with Docker Compose
- Cloud deployment on Hetzner, AWS, and other providers
- Troubleshooting and security best practices

## Connect your IDE

n8n-MCP works with multiple AI-powered IDEs and tools:

- [Claude Code](./docs/CLAUDE_CODE_SETUP.md) - Quick setup for Claude Code CLI
- [Visual Studio Code](./docs/VS_CODE_PROJECT_SETUP.md) - VS Code with GitHub Copilot integration
- [Cursor](./docs/CURSOR_SETUP.md) - Step-by-step Cursor IDE setup
- [Windsurf](./docs/WINDSURF_SETUP.md) - Windsurf integration with project rules
- [Codex](./docs/CODEX_SETUP.md) - Codex integration guide
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
   - If using template: `get_template(templateId, {mode: "full"})`
   - **MANDATORY ATTRIBUTION**: "Based on template by **[author.name]** (@[username]). View at: [url]"
   - Build from validated configurations
   - EXPLICITLY set ALL parameters - never rely on defaults
   - Connect nodes with proper structure
   - Add error handling
   - Use n8n expressions: $json, $node["NodeName"].json
   - Build in artifact (unless deploying to n8n instance)

7. **Workflow Validation** (before deployment)
   - `validate_workflow(workflow)` - Complete validation
   - `validate_workflow_connections(workflow)` - Structure check
   - `validate_workflow_expressions(workflow)` - Expression validation
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
`validate_workflow(workflow)` - Connections, expressions, AI tools

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
    {type: "updateNode", nodeId: "slack-1", changes: {...}},
    {type: "updateNode", nodeId: "http-1", changes: {...}},
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

The `addConnection` operation requires **four separate string parameters**. Common mistakes cause misleading errors.

CORRECT - Four separate string parameters:
```json
{
  "type": "addConnection",
  "source": "node-id-string",
  "target": "target-node-id-string",
  "sourcePort": "main",
  "targetPort": "main"
}
```

**Reference**: [GitHub Issue #327](https://github.com/czlonkowski/n8n-mcp/issues/327)

### CRITICAL: IF Node Multi-Output Routing

IF nodes have **two outputs** (TRUE and FALSE). Use the **`branch` parameter** to route to the correct output:

```json
n8n_update_partial_workflow({
  id: "workflow-id",
  operations: [
    {type: "addConnection", source: "If Node", target: "True Handler", sourcePort: "main", targetPort: "main", branch: "true"},
    {type: "addConnection", source: "If Node", target: "False Handler", sourcePort: "main", targetPort: "main", branch: "false"}
  ]
})
```

**Note**: Without the `branch` parameter, both connections may end up on the same output, causing logic errors!

### removeConnection Syntax

Use the same four-parameter format:
```json
{
  "type": "removeConnection",
  "source": "source-node-id",
  "target": "target-node-id",
  "sourcePort": "main",
  "targetPort": "main"
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

### n8n Management Tools (13 tools - Requires API Configuration)
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
- **`n8n_workflow_versions`** - Manage version history and rollback
- **`n8n_deploy_template`** - Deploy templates from n8n.io directly to your instance with auto-fix

#### Execution Management
- **`n8n_test_workflow`** - Test/trigger workflow execution (webhook, form, chat)
- **`n8n_executions`** - Unified execution management (list, get, delete)

#### Credential Management
- **`n8n_manage_credentials`** - Manage n8n credentials (list, get, create, update, delete, getSchema)

#### Security & Audit
- **`n8n_audit_instance`** - Security audit combining n8n's built-in audit API with deep workflow scanning

#### System Tools
- **`n8n_health_check`** - Check n8n API connectivity and features

## Documentation

- [Self-Hosting Guide](./docs/SELF_HOSTING.md) - npx, Docker, Railway, and local installation
- [Security & Hardening](./docs/SECURITY_HARDENING.md) - Trust model, hardening options, workflow restrictions
- [n8n Deployment Guide](./docs/N8N_DEPLOYMENT.md) - Production deployment with n8n
- [Database Configuration](./docs/DATABASE_CONFIGURATION.md) - SQLite adapters and memory optimization
- [Privacy & Telemetry](./PRIVACY.md) - What we collect and how to opt out
- [Workflow Diff Operations](./docs/workflow-diff-examples.md) - Token-efficient workflow updates
- [HTTP Deployment](./docs/HTTP_DEPLOYMENT.md) - Remote server setup
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
