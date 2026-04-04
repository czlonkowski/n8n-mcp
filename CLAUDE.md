# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note:** This file is committed to a public OSS repository. Never add sensitive information (API keys, internal URLs, credentials, private infrastructure details) here.

## Project Overview

n8n-mcp is a comprehensive documentation and knowledge server that provides AI assistants with complete access to n8n node information through the Model Context Protocol (MCP). It serves as a bridge between n8n's workflow automation platform and AI models, enabling them to understand and work with n8n nodes effectively.

### Current Architecture:
```
src/
├── loaders/
│   └── node-loader.ts         # NPM package loader for both packages
├── parsers/
│   ├── node-parser.ts         # Enhanced parser with version support
│   └── property-extractor.ts  # Dedicated property/operation extraction
├── mappers/
│   └── docs-mapper.ts         # Documentation mapping with fixes
├── database/
│   ├── schema.sql             # SQLite schema
│   ├── node-repository.ts     # Data access layer
│   └── database-adapter.ts    # Universal database adapter (NEW in v2.3)
├── services/
│   ├── property-filter.ts     # Filters properties to essentials (NEW in v2.4)
│   ├── example-generator.ts   # Generates working examples (NEW in v2.4)
│   ├── task-templates.ts      # Pre-configured node settings (NEW in v2.4)
│   ├── config-validator.ts    # Configuration validation (NEW in v2.4)
│   ├── enhanced-config-validator.ts # Operation-aware validation (NEW in v2.4.2)
│   ├── node-specific-validators.ts  # Node-specific validation logic (NEW in v2.4.2)
│   ├── property-dependencies.ts # Dependency analysis (NEW in v2.4)
│   ├── type-structure-service.ts # Type structure validation (NEW in v2.22.21)
│   ├── expression-validator.ts # n8n expression syntax validation (NEW in v2.5.0)
│   └── workflow-validator.ts  # Complete workflow validation (NEW in v2.5.0)
├── types/
│   ├── type-structures.ts      # Type structure definitions (NEW in v2.22.21)
│   ├── instance-context.ts     # Multi-tenant instance configuration
│   └── session-state.ts        # Session persistence types (NEW in v2.24.1)
├── constants/
│   └── type-structures.ts      # 22 complete type structures (NEW in v2.22.21)
├── templates/
│   ├── template-fetcher.ts    # Fetches templates from n8n.io API (NEW in v2.4.1)
│   ├── template-repository.ts # Template database operations (NEW in v2.4.1)
│   └── template-service.ts    # Template business logic (NEW in v2.4.1)
├── scripts/
│   ├── rebuild.ts             # Database rebuild with validation
│   ├── validate.ts            # Node validation
│   ├── test-nodes.ts          # Critical node tests
│   ├── test-essentials.ts     # Test new essentials tools (NEW in v2.4)
│   ├── test-enhanced-validation.ts # Test enhanced validation (NEW in v2.4.2)
│   ├── test-structure-validation.ts # Test type structure validation (NEW in v2.22.21)
│   ├── test-workflow-validation.ts # Test workflow validation (NEW in v2.5.0)
│   ├── test-ai-workflow-validation.ts # Test AI workflow validation (NEW in v2.5.1)
│   ├── test-mcp-tools.ts      # Test MCP tool enhancements (NEW in v2.5.1)
│   ├── test-n8n-validate-workflow.ts # Test n8n_validate_workflow tool (NEW in v2.6.3)
│   ├── test-typeversion-validation.ts # Test typeVersion validation (NEW in v2.6.1)
│   ├── test-workflow-diff.ts  # Test workflow diff engine (NEW in v2.7.0)
│   ├── test-tools-documentation.ts # Test tools documentation (NEW in v2.7.3)
│   ├── fetch-templates.ts     # Fetch workflow templates from n8n.io (NEW in v2.4.1)
│   └── test-templates.ts      # Test template functionality (NEW in v2.4.1)
├── mcp/
│   ├── server.ts              # MCP server with enhanced tools
│   ├── tools.ts               # Tool definitions including new essentials
│   ├── tools-documentation.ts # Tool documentation system (NEW in v2.7.3)
│   └── index.ts               # Main entry point with mode selection
├── utils/
│   ├── console-manager.ts     # Console output isolation (NEW in v2.3.1)
│   └── logger.ts              # Logging utility with HTTP awareness
├── http-server-single-session.ts  # Single-session HTTP server (NEW in v2.3.1)
│                                   # Session persistence API (NEW in v2.24.1)
├── mcp-engine.ts              # Clean API for service integration (NEW in v2.3.1)
│                                # Session persistence wrappers (NEW in v2.24.1)
└── index.ts                   # Library exports
```

## Common Development Commands

```bash
# Build and Setup
npm run build          # Build TypeScript (always run after changes)
npm run rebuild        # Rebuild node database from n8n packages
npm run validate       # Validate all node data in database

# Testing
npm test               # Run all tests
npm run test:unit      # Run unit tests only
npm run test:integration # Run integration tests
npm run test:coverage  # Run tests with coverage report
npm run test:watch     # Run tests in watch mode
npm run test:structure-validation # Test type structure validation (Phase 3)

# Run a single test file
npm test -- tests/unit/services/property-filter.test.ts

# Linting and Type Checking
npm run lint           # Check TypeScript types (alias for typecheck)
npm run typecheck      # Check TypeScript types

# Running the Server
npm start              # Start MCP server in stdio mode
npm run start:http     # Start MCP server in HTTP mode
npm run dev            # Build, rebuild database, and validate
npm run dev:http       # Run HTTP server with auto-reload

# Update n8n Dependencies
npm run update:n8n:check  # Check for n8n updates (dry run)
npm run update:n8n        # Update n8n packages to latest

# Database Management
npm run db:rebuild     # Rebuild database from scratch
npm run migrate:fts5   # Migrate to FTS5 search (if needed)

# Template Management
npm run fetch:templates  # Fetch latest workflow templates from n8n.io
npm run test:templates   # Test template functionality
```

## High-Level Architecture

### Core Components

1. **MCP Server** (`mcp/server.ts`)
   - Implements Model Context Protocol for AI assistants
   - Provides tools for searching, validating, and managing n8n nodes
   - Supports both stdio (Claude Desktop) and HTTP modes

2. **Database Layer** (`database/`)
   - SQLite database storing all n8n node information
   - Universal adapter pattern supporting both better-sqlite3 and sql.js
   - Full-text search capabilities with FTS5

3. **Node Processing Pipeline**
   - **Loader** (`loaders/node-loader.ts`): Loads nodes from n8n packages
   - **Parser** (`parsers/node-parser.ts`): Extracts node metadata and structure
   - **Property Extractor** (`parsers/property-extractor.ts`): Deep property analysis
   - **Docs Mapper** (`mappers/docs-mapper.ts`): Maps external documentation

4. **Service Layer** (`services/`)
   - **Property Filter**: Reduces node properties to AI-friendly essentials
   - **Config Validator**: Multi-profile validation system
   - **Type Structure Service**: Validates complex type structures (filter, resourceMapper, etc.)
   - **Expression Validator**: Validates n8n expression syntax
   - **Workflow Validator**: Complete workflow structure validation

5. **Template System** (`templates/`)
   - Fetches and stores workflow templates from n8n.io
   - Provides pre-built workflow examples
   - Supports template search and validation

### Key Design Patterns

1. **Repository Pattern**: All database operations go through repository classes
2. **Service Layer**: Business logic separated from data access
3. **Validation Profiles**: Different validation strictness levels (minimal, runtime, ai-friendly, strict)
4. **Diff-Based Updates**: Efficient workflow updates using operation diffs

### MCP Tools Architecture

The MCP server exposes tools in several categories:

1. **Discovery Tools**: Finding and exploring nodes
2. **Configuration Tools**: Getting node details and examples
3. **Validation Tools**: Validating configurations before deployment
4. **Workflow Tools**: Complete workflow validation
5. **Management Tools**: Creating and updating workflows (requires API config)

## Memories and Notes for Development

### Development Workflow Reminders
- When you make changes to MCP server, you need to ask the user to reload it before you test
- When the user asks to review issues, you should use GH CLI to get the issue and all the comments
- When the task can be divided into separated subtasks, you should spawn separate sub-agents to handle them in parallel
- Use the best sub-agent for the task as per their descriptions

### Testing Best Practices
- Always run `npm run build` before testing changes
- Use `npm run dev` to rebuild database after package updates
- Check coverage with `npm run test:coverage`
- Integration tests require a clean database state

### Common Pitfalls
- The MCP server needs to be reloaded in Claude Desktop after changes
- HTTP mode requires proper CORS and auth token configuration
- Database rebuilds can take 2-3 minutes due to n8n package size
- Always validate workflows before deployment to n8n

### Performance Considerations
- Use `get_node_essentials()` instead of `get_node_info()` for faster responses
- Batch validation operations when possible
- The diff-based update system saves 80-90% tokens on workflow updates

### Agent Interaction Guidelines
- Sub-agents are not allowed to spawn further sub-agents
- When you use sub-agents, do not allow them to commit and push. That should be done by you

### Development Best Practices
- Run typecheck and lint after every code change

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- When you make changes to MCP server, you need to ask the user to reload it before you test
- When the user asks to review issues, you should use GH CLI to get the issue and all the comments
- When the task can be divided into separated subtasks, you should spawn separate sub-agents to handle them in paralel
- Use the best sub-agent for the task as per their descriptions
- Do not use hyperbolic or dramatic language in comments and documentation
- Add to every commit and PR: Concieved by Romuald Członkowski - and then link to www.aiadvisors.pl/en. Don't add it in conversations