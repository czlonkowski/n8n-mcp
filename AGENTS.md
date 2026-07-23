# Repository Guidelines

> This file is committed to a public OSS repository. Never add API keys, credentials, private URLs, customer data, or private infrastructure details.

## Project Overview

n8n-mcp is a Model Context Protocol server that gives AI assistants access to n8n node documentation, workflow validation, and workflow management. Documentation and validation tools work offline against the bundled SQLite node database. Management tools prefixed with `n8n_` operate on a live n8n instance and require API configuration.

## Project Structure & Module Organization

Core TypeScript lives in `src/`. Important subsystems include:

- `src/mcp/` — MCP server, request handlers, tool definitions and documentation, and bundled skills
- `src/database/` — SQLite adapters, repositories, FTS5 search, and migrations
- `src/loaders/`, `src/parsers/`, `src/mappers/` — node loading, metadata parsing, and documentation mapping
- `src/services/` — validation, workflow diffing and autofix, node/version lookup, the n8n API client, and security scanners
- `src/templates/` and `src/community/` — workflow-template and community-node ingestion and documentation
- `src/telemetry/`, `src/triggers/`, and `src/n8n/` — telemetry, trigger detection, and the n8n community-node wrapper
- `src/scripts/` — maintenance scripts compiled to `dist/scripts/`
- `src/types/`, `src/constants/`, and `src/utils/` — shared types, constants, and helpers
- `src/http-server*.ts` — HTTP transports and session persistence
- `src/mcp-engine.ts` and `src/mcp-tools-engine.ts` — APIs for embedding the server

Tests mirror the source areas in `tests/unit/` and `tests/integration/`, with fixtures, factories, helpers, and mocks under `tests/`. React/Vite apps live in `ui-apps/src/`, repository utilities in `scripts/`, documentation in `docs/`, and generated skills and databases in `data/`. Treat `dist/`, coverage output, and `ui-apps/dist/` as generated; do not edit them directly.

## Architecture & MCP Conventions

- Route database operations through repository classes and keep business logic in the service layer.
- Validation profiles are `minimal`, `runtime`, `ai-friendly`, and `strict`.
- Prefer diff-based workflow changes through `n8n_update_partial_workflow`; do not replace a whole workflow when a focused operation is sufficient.
- Offline documentation and validation tools include `search_nodes`, `get_node`, `validate_node`, `validate_workflow`, `search_templates`, `get_template`, and `tools_documentation`.
- Live management tools use the `n8n_*` prefix and cover workflows, executions, tests, versions, autofix, templates, credentials, datatables, and audits.
- Request the smallest useful `get_node` detail level: `minimal`, `standard`, or `full`.
- Validate workflows before deploying them to n8n.

## Build, Test, and Development Commands

```bash
# Install and build
npm install                    # Install root dependencies; repeat in ui-apps/ for UI work
npm run build                  # Compile production TypeScript to dist/
npm run build:all              # Sync skills, build UI apps, and compile the server
npm run typecheck              # Strict TypeScript check without emitting; npm run lint is an alias

# Test
npm test                       # Run all Vitest tests
npm run test:unit              # Unit tests
npm run test:integration       # Integration tests
npm run test:e2e               # End-to-end tests
npm run test:coverage          # Coverage report
npm test -- tests/unit/services/property-filter.test.ts

# Run and maintain
npm start                      # MCP server in stdio mode
npm run start:http             # MCP server in HTTP mode
npm run dev:http               # Rebuild and restart HTTP mode on source changes
npm run rebuild                # Rebuild the bundled node database
npm run validate               # Validate generated node data
npm run dev                    # Build, rebuild the database, and validate

# Update bundled data
npm run update:n8n:check       # Dry-run n8n dependency update; follow MEMORY_N8N_UPDATE.md
npm run update:n8n             # Update n8n packages
npm run fetch:templates        # Fetch n8n.io templates; follow MEMORY_TEMPLATE_UPDATE.md
npm run fetch:community        # Upsert community nodes while preserving existing docs
npm run generate:docs:incremental # Generate docs for community nodes missing them
```

Database rebuilds take several minutes because of the n8n package size. HTTP mode requires valid auth configuration, and live n8n tests require configuration and a clean database state.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, and semicolons. Prefer `camelCase` for variables and functions, `PascalCase` for classes and types, and kebab-case filenames such as `workflow-auto-fixer.ts`. Use the configured `@/` and `@tests/` aliases where helpful. Keep modules focused, validate external input, and do not use hyperbolic or dramatic language in comments or documentation. No separate formatter is configured; `npm run typecheck` is the required static check.

## Development & Testing Workflow

- Run `npm run typecheck` after every code change and `npm run build` after MCP server changes.
- After rebuilding server code, ask the user to reload the MCP server before testing the changed MCP behavior.
- Name tests `*.test.ts` and place them in the matching test subtree. Use MSW for API mocking.
- Run focused tests while iterating, `npm run test:unit` for the fast suite, and relevant integration or end-to-end tests for system behavior.
- Run `npm run test:coverage` before substantial pull requests. Coverage thresholds are 75% for lines, functions, and statements and 70% for branches.
- Do not mask flaky tests with retries.
- When reviewing a GitHub issue, use `gh` to fetch the issue and all comments.

## Sub-agents

- When a task has genuinely independent subtasks, use appropriately specialized sub-agents in parallel.
- Give each sub-agent a bounded scope and clear file ownership.
- Sub-agents must not spawn additional sub-agents, commit, or push. The primary agent owns integration, verification, commits, and pushes.

## Commit & Pull Request Guidelines

Use Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, `chore:`, and scoped forms such as `ci(deps):`. Work on a feature branch and never commit directly to `main`. Keep commits narrowly scoped and do not include unrelated dirty-worktree changes.

PRs should explain intent and verification, link relevant issues, include screenshots for UI changes, and enable “Allow edits by maintainers.” Add the following attribution to every commit message and PR description:

`Conceived by Romuald Członkowski - www.aiadvisors.pl/en`

The attribution belongs only in commit messages and PR descriptions. Never add it to source, test, documentation, or other product file contents.

## Security & Configuration

Start from `.env.example` and keep local secrets untracked. Never commit credentials, API keys, private URLs, customer data, or sensitive configuration. Confirm the intended n8n instance before using live management tools, and validate workflows before deployment.
