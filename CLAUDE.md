# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** This file is committed to a public OSS repository. Never add sensitive information (API keys, internal URLs, credentials, private infrastructure details) here.

## Project Overview

n8n-mcp is an MCP (Model Context Protocol) server that gives AI assistants access to n8n node documentation, workflow validation, and workflow management. Documentation and validation tools work offline against a bundled SQLite database of node information; management tools (`n8n_*`) operate on a live n8n instance when API credentials are configured.

## Common Development Commands

```bash
# Build
npm run build          # Compile TypeScript (always run after changes)
npm run build:all      # Sync skills pack + build UI apps + compile
npm run rebuild        # Rebuild node database from n8n packages
npm run validate       # Validate node data in database
npm run dev            # build + rebuild + validate

# Testing
npm test               # Run all tests (vitest)
npm run test:unit      # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e       # End-to-end tests
npm run test:coverage  # Coverage report
npm test -- tests/unit/services/property-filter.test.ts  # Single file

# Type checking
npm run typecheck      # tsc --noEmit (npm run lint is an alias)

# Running the server
npm start              # MCP server in stdio mode
npm run start:http     # MCP server in HTTP mode
npm run dev:http       # HTTP server with auto-reload

# n8n dependency updates — follow MEMORY_N8N_UPDATE.md
npm run update:n8n:check  # Dry run
npm run update:n8n        # Update n8n packages

# Templates and community nodes
npm run fetch:templates   # Fetch workflow templates from n8n.io — see MEMORY_TEMPLATE_UPDATE.md
npm run fetch:community   # Fetch/refresh community nodes (upserts; preserves existing docs)
npm run generate:docs:incremental  # Generate AI docs for community nodes missing them
```

## Architecture

Key subsystems of `src/` (non-exhaustive — smaller directories are omitted). This file intentionally stays at subsystem level; for file-level detail, explore the directories.

- `mcp/` — MCP server, tool definitions (`tools.ts`, `tools-n8n-manager.ts`), request handlers, per-tool documentation (`tool-docs/`), bundled skills (`skills/`)
- `database/` — SQLite storage: universal adapter over better-sqlite3/sql.js, `node-repository.ts` data access, FTS5 full-text search, `migrations/`
- `loaders/`, `parsers/`, `mappers/` — node processing pipeline: load nodes from n8n packages → parse metadata and properties → map external documentation
- `services/` — business logic: config/workflow/expression validators, validation profiles, workflow diff engine, auto-fixer, node similarity and version services, n8n API client, security/audit scanners
- `templates/` — fetching and storing workflow templates from n8n.io
- `community/` — community node fetching and documentation generation
- `telemetry/` — opt-in anonymous usage telemetry
- `triggers/` — trigger detection and registry
- `n8n/` — n8n community node wrapper (N8N_MODE)
- `scripts/` — maintenance CLI scripts (rebuild, validate, template/community fetching), compiled to `dist/scripts/`
- `types/`, `constants/`, `utils/` — shared types, type structures, helpers
- `http-server.ts`, `http-server-single-session.ts` — HTTP mode with session persistence
- `mcp-engine.ts`, `mcp-tools-engine.ts` — clean API for embedding the server in other services

### Key design patterns

1. **Repository pattern**: all database operations go through repository classes
2. **Service layer**: business logic separated from data access
3. **Validation profiles**: strictness levels `minimal`, `runtime`, `ai-friendly`, `strict`
4. **Diff-based updates**: `n8n_update_partial_workflow` applies operation diffs, saving 80–90% of tokens vs full updates

### MCP tools

Two groups:

- **Documentation and validation** (offline, always available): `search_nodes`, `get_node`, `validate_node`, `validate_workflow`, `search_templates`, `get_template`, `tools_documentation`
- **Management** (`n8n_*`, require n8n API configuration): workflow CRUD and partial updates, executions, workflow testing, versions, autofix, template deployment, credentials, datatables, instance audit

`get_node` supports detail levels (`minimal`/`standard`/`full`) — request the smallest level that answers the question.

## Development Workflow

- After changing MCP server code: build, then ask the user to reload the MCP server before testing
- Run `npm run typecheck` after every code change
- Never commit directly to main — use feature branches and PRs
- Add to every commit message and PR description: `Conceived by Romuald Członkowski - www.aiadvisors.pl/en`. The attribution belongs in commit messages and PR descriptions only — never in source, test, or documentation file contents
- When reviewing issues, use the GH CLI (`gh`) to fetch the issue and all its comments
- Do not use hyperbolic or dramatic language in comments and documentation

### Sub-agents

- When a task divides into independent subtasks, spawn sub-agents to handle them in parallel; pick the best agent type per its description
- Sub-agents must not spawn further sub-agents
- Sub-agents must not commit or push — do that yourself

### Pitfalls

- Database rebuilds take 2–3 minutes due to n8n package size
- Integration tests require a clean database state
- HTTP mode requires proper auth token configuration
- Always validate workflows before deploying them to n8n
