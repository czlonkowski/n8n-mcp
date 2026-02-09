# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.35.1] - 2026-02-09

### Fixed

- **MCP Apps: Fix UI not rendering for some tools in Claude**: Added legacy flat `_meta["ui/resourceUri"]` key alongside the nested `_meta.ui.resourceUri` in tool definitions. Claude.ai reads the flat key format; without it, tools like `n8n_health_check` and `n8n_list_workflows` showed as collapsed accordions instead of rendering their rich UI apps. Both key formats are now set by `injectToolMeta()`, matching the behavior of the official `registerAppTool` helper from `@modelcontextprotocol/ext-apps/server`.

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.0] - 2026-02-09

### Added

- **3 new MCP Apps**: workflow-list (compact table with status/tags), execution-history (status summary bar + execution table), health-dashboard (connection status, versions, performance metrics)
- **Enhanced operation-result**: operation-aware headers (create/update/delete/test/deploy), detail panels with workflow metadata, copy-to-clipboard for IDs/URLs, autofix diff viewer
- **CopyButton shared component**: reusable clipboard button with visual feedback
- **Local preview harness** (`ui-apps/preview.html`): test all 5 apps with mock data, dark/light theme toggle, JSON-RPC protocol simulation
- **Expanded shared types**: TypeScript types for workflow-list, execution-history, and health-dashboard data

### Fixed

- **React hooks violation**: Fixed `useMemo` called after early returns in `execution-history/App.tsx` and `validation-summary/App.tsx`, causing React error #310 ("Rendered more hooks than during the previous render") and blank iframes
- **JSON-RPC catch-all handler**: Preview harness responds to unknown SDK requests to prevent hangs

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.5] - 2026-02-08

### Fixed

- **MCP Apps: Fix blank UI and wrong status badge in Claude**: Rewrote `useToolData` hook to use the official `useApp` hook from `@modelcontextprotocol/ext-apps/react` for proper lifecycle management. Updated UI types and components to match actual server response format (`success: boolean` instead of `status: string`, nested `data` object for workflow details). Validation summary now handles both direct and wrapped (`n8n_validate_workflow`) response shapes.

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.3] - 2026-02-07

### Fixed

- **MCP Apps: Use correct MIME type for ext-apps spec**: Changed resource MIME type from `text/html` to `text/html;profile=mcp-app` (the `RESOURCE_MIME_TYPE` constant from `@modelcontextprotocol/ext-apps`). Without this profile parameter, Claude Desktop/web fails to recognize resources as MCP Apps and shows "Failed to load MCP App: the resource may exceed the 5 MB size limit."

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.2] - 2026-02-07

### Fixed

- **CI: UI apps missing from npm package**: Release pipeline only ran `npm run build` (TypeScript), so `ui-apps/dist/` was never built and excluded from published packages
  - Changed build step to `npm run build:all` in `build-and-verify` and `publish-npm` jobs
  - Added `ui-apps/dist/` to npm publish staging directory
  - Added `ui-apps/dist/**/*` to published package files list

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.1] - 2026-02-07

### Changed

- **MCP Apps: Align with official ext-apps spec** for Claude Desktop/web compatibility
  - URI scheme changed from `n8n-mcp://ui/{id}` to `ui://n8n-mcp/{id}` per MCP ext-apps spec
  - `_meta.ui.resourceUri` now set on tool definitions (`tools/list`) instead of tool call responses
  - `UIMetadata.ui.app` renamed to `UIMetadata.ui.resourceUri`
  - Added `_meta` field to `ToolDefinition` type
  - Added `UIAppRegistry.injectToolMeta()` method for enriching tool definitions
  - UI apps now use `@modelcontextprotocol/ext-apps` `App` class instead of `window.__MCP_DATA__`
  - Updated `ReadResource` URI parser to match new `ui://` scheme

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.34.0] - 2026-02-07

### Added

- **MCP Apps**: Rich HTML UIs rendered by MCP hosts alongside tool results via `_meta.ui` and the MCP resources protocol
  - Server-side UI module (`src/mcp/ui/`) with tool-to-UI mapping and `_meta.ui` injection
  - `UIAppRegistry` static class for loading and serving self-contained HTML apps
  - `UI_APP_CONFIGS` mapping tools to their corresponding UI apps

- **Operation Result UI**: Visual summary for workflow operation tools
  - Status badge, operation type, workflow details card
  - Expandable sections for nodes added, modified, and removed
  - Mapped to: `n8n_create_workflow`, `n8n_update_full_workflow`, `n8n_update_partial_workflow`, `n8n_delete_workflow`, `n8n_test_workflow`, `n8n_autofix_workflow`, `n8n_deploy_template`

- **Validation Summary UI**: Visual summary for validation tools
  - Valid/invalid badge with error and warning counts
  - Expandable error list with type, property, message, and fix
  - Expandable warning list and suggestions
  - Mapped to: `validate_node`, `validate_workflow`, `n8n_validate_workflow`

- **React + Vite Build Pipeline** (`ui-apps/`):
  - React 19, Vite 6, vite-plugin-singlefile for self-contained HTML output
  - Shared component library: Card, Badge, Expandable
  - `useToolData` hook for reading data from `window.__MCP_DATA__` or embedded JSON
  - n8n-branded dark theme with CSS custom properties
  - Per-app builds via `APP_NAME` environment variable

- **MCP Resources Protocol**: Server now exposes `resources` capability
  - `ListResources` handler returns available UI apps
  - `ReadResource` handler serves self-contained HTML via `n8n-mcp://ui/{id}` URIs

- **New Scripts**:
  - `build:ui`: Build UI apps (`cd ui-apps && npm install && npm run build`)
  - `build:all`: Build UI apps then server (`npm run build:ui && npm run build`)

### Changed

- **MCP Server**: Added `resources: {}` to server capabilities alongside existing `tools: {}`
- **Tool Responses**: Tools with matching UI apps now include `_meta.ui.app` URI pointing to their visual representation
- **Graceful Degradation**: Server starts and operates normally without `ui-apps/dist/`; UI metadata is only injected when HTML is available

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.33.6] - 2026-02-06

### Changed

- Updated n8n from 2.4.4 to 2.6.3
- Updated n8n-core from 2.4.2 to 2.6.1
- Updated n8n-workflow from 2.4.2 to 2.6.0
- Updated @n8n/n8n-nodes-langchain from 2.4.3 to 2.6.2
- Rebuilt node database with 806 nodes (544 from n8n-nodes-base, 262 from @n8n/n8n-nodes-langchain)
- Updated README badge with new n8n version

## [2.33.5] - 2026-01-23

### Fixed

- **Critical memory leak: per-session database connections** (Issue #542): Fixed severe memory leak where each MCP session created its own database connection (~900MB per session)
  - Root cause: `N8NDocumentationMCPServer` called `createDatabaseAdapter()` for every new session, duplicating the entire 68MB database in memory
  - With 3-4 sessions, memory would exceed 4GB causing OOM kills every ~20 minutes
  - Fix: Implemented singleton `SharedDatabase` pattern - all sessions now share ONE database connection
  - Memory impact: Reduced from ~900MB per session to ~68MB total (shared) + ~5MB per session overhead
  - Added `getSharedDatabase()` and `releaseSharedDatabase()` for thread-safe connection management
  - Added reference counting to track active sessions using the shared connection

- **Session timeout optimization**: Reduced default session timeout from 30 minutes to 5 minutes
  - Faster cleanup of stale sessions reduces memory buildup
  - Configurable via `SESSION_TIMEOUT_MINUTES` environment variable

- **Eager instance cleanup**: When a client reconnects, previous sessions for the same instanceId are now immediately cleaned up
  - Prevents memory accumulation from reconnecting clients in multi-tenant deployments

- **Telemetry event listener leak**: Fixed event listeners in `TelemetryBatchProcessor` that were never removed
  - Added proper cleanup in `stop()` method
  - Added guard against multiple `start()` calls

### Added

- **New module: `src/database/shared-database.ts`** - Singleton database manager
  - `getSharedDatabase(dbPath)`: Thread-safe initialization with promise lock pattern
  - `releaseSharedDatabase(state)`: Reference counting for cleanup
  - `closeSharedDatabase()`: Graceful shutdown for process termination
  - `isSharedDatabaseInitialized()` and `getSharedDatabaseRefCount()`: Monitoring helpers

### Changed

- **`N8NDocumentationMCPServer.close()`**: Now releases shared database reference instead of closing the connection
- **`SingleSessionHTTPServer.shutdown()`**: Calls `closeSharedDatabase()` during graceful shutdown

## [2.33.4] - 2026-01-21

### Fixed

- **Memory leak in SSE session reset** (Issue #542): Fixed memory leak when SSE sessions are recreated every 5 minutes
  - Root cause: `resetSessionSSE()` only closed the transport but not the MCP server
  - This left the SimpleCache cleanup timer (60-second interval) running indefinitely
  - Database connections and cached data (~50-100MB per session) persisted in memory
  - Fix: Added `server.close()` call before `transport.close()`, mirroring the existing cleanup pattern in `removeSession()`
  - Impact: Prevents ~288 leaked server instances per day in long-running HTTP deployments

## [2.33.3] - 2026-01-21

### Changed

- **Updated n8n dependencies to latest versions**
  - n8n: 2.3.3 → 2.4.4
  - n8n-core: 2.3.2 → 2.4.2
  - n8n-workflow: 2.3.2 → 2.4.2
  - @n8n/n8n-nodes-langchain: 2.3.2 → 2.4.3

### Added

- **New `icon` property type**: Added support for the new `icon` NodePropertyType introduced in n8n 2.4.x
  - Added type structure definition in `src/constants/type-structures.ts`
  - Updated type count from 22 to 23 NodePropertyTypes
  - Updated related tests to reflect the new type

### Fixed

- Rebuilt node database with 803 nodes (541 from n8n-nodes-base, 262 from @n8n/n8n-nodes-langchain)

## [2.33.2] - 2026-01-13

### Changed

- **Updated n8n dependencies to latest versions**
  - n8n: 2.2.3 → 2.3.3
  - n8n-core: 2.2.2 → 2.3.2
  - n8n-workflow: 2.2.2 → 2.3.2
  - @n8n/n8n-nodes-langchain: 2.2.2 → 2.3.2
  - Rebuilt node database with 537 nodes (434 from n8n-nodes-base, 103 from @n8n/n8n-nodes-langchain)
  - Updated README badge with new n8n version

## [2.33.1] - 2026-01-12

### Fixed

- **Docker image version mismatch bug**: Docker images were built with stale `package.runtime.json` (v2.29.5) while npm package was at v2.33.0
  - Root cause: `build-docker` job in `release.yml` did not sync `package.runtime.json` version before building
  - The `publish-npm` job synced the version, but both jobs ran in parallel, so Docker got the stale version
  - Added "Sync runtime version" step to `release.yml` `build-docker` job
  - Added "Sync runtime version" step to `docker-build.yml` `build` and `build-railway` jobs
  - All Docker builds now sync `package.runtime.json` version from `package.json` before building

## [2.33.0] - 2026-01-08

### Added

**AI-Powered Documentation for Community Nodes**

Added AI-generated documentation summaries for 537 community nodes, making them accessible through the MCP `get_node` tool.

**Features:**
- **README Fetching**: Automatically fetches README content from npm registry for all community nodes
- **AI Summary Generation**: Uses local LLM (Qwen or compatible) to generate structured documentation summaries
- **MCP Integration**: AI summaries exposed in `get_node` with `mode='docs'`

**AI Documentation Structure:**
```json
{
  "aiDocumentationSummary": {
    "purpose": "What this node does",
    "capabilities": ["key features"],
    "authentication": "API key, OAuth, etc.",
    "commonUseCases": ["practical examples"],
    "limitations": ["known caveats"],
    "relatedNodes": ["related n8n nodes"]
  },
  "aiSummaryGeneratedAt": "2026-01-08T10:45:31.000Z"
}
```

**New CLI Commands:**
```bash
npm run generate:docs              # Full generation (README + AI summary)
npm run generate:docs:readme-only  # Only fetch READMEs from npm
npm run generate:docs:summary-only # Only generate AI summaries
npm run generate:docs:incremental  # Skip nodes with existing data
npm run generate:docs:stats        # Show documentation statistics
npm run migrate:readme-columns     # Migrate database schema
```

**Environment Variables:**
```bash
N8N_MCP_LLM_BASE_URL=http://localhost:1234/v1  # LLM server URL
N8N_MCP_LLM_MODEL=qwen3-4b-thinking-2507       # Model name
N8N_MCP_LLM_TIMEOUT=60000                       # Request timeout
```

**Files Added:**
- `src/community/documentation-generator.ts` - LLM integration with Zod validation
- `src/community/documentation-batch-processor.ts` - Batch processing with progress tracking
- `src/scripts/generate-community-docs.ts` - CLI entry point
- `src/scripts/migrate-readme-columns.ts` - Database migration script

**Files Modified:**
- `src/database/schema.sql` - Added `npm_readme`, `ai_documentation_summary`, `ai_summary_generated_at` columns
- `src/database/node-repository.ts` - Added AI documentation methods and fields
- `src/community/community-node-fetcher.ts` - Added `fetchPackageWithReadme()` and batch fetching
- `src/community/index.ts` - Exported new classes
- `src/mcp/server.ts` - Added AI documentation to `get_node` docs mode response

**Statistics:**
- 538/547 community nodes have README content
- 537/547 community nodes have AI summaries
- Generation takes ~30 min for all nodes with local LLM

## [2.32.1] - 2026-01-08

### Fixed

- **Fixed community node count discrepancy**: The search tool now correctly returns all 547 community nodes
  - Root cause: `countCommunityNodes()` method was not counting nodes with NULL `is_community` flag
  - Added query to count nodes where `source_package NOT IN ('n8n-nodes-base', '@n8n/n8n-nodes-langchain')`
  - This includes nodes that may have been inserted without the `is_community` flag set

## [2.32.0] - 2026-01-08

### Added

- **Community Node Search Integration**: Added `source` filter to `search_nodes` tool
  - Filter by `"core"` for official n8n nodes (n8n-nodes-base + langchain)
  - Filter by `"community"` for verified community integrations
  - Filter by `"all"` (default) for all nodes
  - Example: `search_nodes({ query: "google", source: "community" })`

- **Community Node Statistics**: Added community node counts to search results
  - Shows `communityNodeCount` in search results when searching all sources
  - Indicates how many results come from verified community packages

### Changed

- **Search Results Enhancement**: Search results now include source information
  - Each result shows whether it's from core or community packages
  - Helps users identify and discover community integrations

### Technical Details

- Added `source` parameter to `searchNodes()` method in NodeRepository
- Updated `search_nodes` tool schema with new `source` parameter
- Community nodes identified by `is_community=1` flag in database
- 547 verified community nodes available from 301 npm packages

## [2.31.0] - 2026-01-08

### Added

- **Community Node Support**: Full integration of verified n8n community nodes
  - Added 547 verified community nodes from 301 npm packages
  - Automatic fetching from n8n's verified integrations API
  - NPM package metadata extraction (version, downloads, repository)
  - Node property extraction via tarball analysis
  - CLI commands: `npm run fetch:community`, `npm run fetch:community:rebuild`

- **Database Schema Updates**:
  - Added `is_community` boolean flag for community node identification
  - Added `npm_package_name` for npm registry reference
  - Added `npm_version` for installed package version
  - Added `npm_downloads` for weekly download counts
  - Added `npm_repository` for GitHub/source links
  - Added unique constraint `idx_nodes_unique_type` on `node_type`

- **New MCP Tool Features**:
  - `search_nodes` now includes community nodes in results
  - `get_node` returns community metadata (npm package, downloads, repo)
  - Community nodes have full property/operation support

### Technical Details

- Community node fetcher with retry logic and rate limiting
- Tarball extraction for node class analysis
- Support for multi-node packages (e.g., n8n-nodes-document-generator)
- Graceful handling of packages without extractable nodes

## [2.30.0] - 2026-01-07

### Added

- **Real-World Configuration Examples**: Added `includeExamples` parameter to `search_nodes` and `get_node` tools
  - Pre-extracted configurations from 2,646 popular workflow templates
  - Shows actual working configurations used in production workflows
  - Examples include all parameters, credentials patterns, and common settings
  - Helps AI understand practical usage patterns beyond schema definitions

- **Example Data Sources**:
  - Top 50 most-used nodes have 2+ configuration examples each
  - Examples extracted from templates with 1000+ views
  - Covers diverse use cases: API integrations, data transformations, triggers

### Changed

- **Tool Parameter Updates**:
  - `search_nodes`: Added `includeExamples` boolean parameter (default: false)
  - `get_node` with `mode='info'` and `detail='standard'`: Added `includeExamples` parameter

### Technical Details

- Examples stored in `node_config_examples` table with template metadata
- Extraction script: `npm run extract:examples`
- Examples include: node parameters, credentials type, template ID, view count
- Adds ~200-400 tokens per example to response

## [2.29.5] - 2026-01-05

### Fixed

- **Critical validation loop prevention**: Added infinite loop detection in workflow validation with 1000-iteration safety limit
- **Memory management improvements**: Fixed potential memory leaks in validation result accumulation
- **Error propagation**: Improved error handling to prevent silent failures during validation

### Changed

- **Validation performance**: Optimized loop detection algorithm to reduce CPU overhead
- **Debug logging**: Added detailed logging for validation iterations when DEBUG=true

## [2.29.4] - 2026-01-04

### Fixed

- **Node type version validation**: Fixed false positive errors for nodes using valid older typeVersions
- **AI tool variant detection**: Improved detection of AI-capable tool variants in workflow validation
- **Connection validation**: Fixed edge case where valid connections between AI nodes were flagged as errors

## [2.29.3] - 2026-01-03

### Fixed

- **Sticky note validation**: Fixed false "missing name property" errors for n8n sticky notes
- **Loop node connections**: Fixed validation of Loop Over Items node output connections
- **Expression format detection**: Improved detection of valid n8n expression formats

## [2.29.2] - 2026-01-02

### Fixed

- **HTTP Request node validation**: Fixed false positives for valid authentication configurations
- **Webhook node paths**: Fixed validation of webhook paths with dynamic segments
- **Resource mapper validation**: Improved handling of auto-mapped fields

## [2.29.1] - 2026-01-01

### Fixed

- **typeVersion validation**: Fixed incorrect "unknown typeVersion" warnings for valid node versions
- **AI node connections**: Fixed validation of connections between AI agent and tool nodes
- **Expression escaping**: Fixed handling of expressions containing special characters

## [2.29.0] - 2025-12-31

### Added

- **Workflow Auto-Fixer**: New `n8n_autofix_workflow` tool for automatic error correction
  - Fixes expression format issues (missing `=` prefix)
  - Corrects invalid typeVersions to latest supported
  - Adds missing error output configurations
  - Fixes webhook paths and other common issues
  - Preview mode (default) shows fixes without applying
  - Apply mode updates workflow with corrections

- **Fix Categories**:
  - `expression-format`: Fixes `{{ }}` to `={{ }}`
  - `typeversion-correction`: Updates to valid typeVersion
  - `error-output-config`: Adds missing onError settings
  - `webhook-missing-path`: Generates unique webhook paths
  - `node-type-correction`: Fixes common node type typos

### Changed

- **Validation Integration**: Auto-fixer integrates with existing validation
- **Confidence Scoring**: Each fix includes confidence level (high/medium/low)
- **Batch Processing**: Multiple fixes applied in single operation

## [2.28.0] - 2025-12-30

### Added

- **Execution Debugging**: New `n8n_executions` tool with `mode='error'` for debugging failed workflows
  - Optimized error analysis with upstream node context
  - Execution path tracing to identify failure points
  - Sample data from nodes leading to errors
  - Stack trace extraction for debugging

- **Execution Management Features**:
  - `action='list'`: List executions with filters (status, workflow, project)
  - `action='get'`: Get execution details with multiple modes
  - `action='delete'`: Remove execution records
  - Pagination support with cursor-based navigation

### Changed

- **Error Response Format**: Enhanced error details include:
  - `errorNode`: Node where error occurred
  - `errorMessage`: Human-readable error description
  - `upstreamData`: Sample data from preceding nodes
  - `executionPath`: Ordered list of executed nodes

## [2.27.0] - 2025-12-29

### Added

- **Workflow Version History**: New `n8n_workflow_versions` tool for version management
  - `mode='list'`: View version history for a workflow
  - `mode='get'`: Get specific version details
  - `mode='rollback'`: Restore workflow to previous version
  - `mode='delete'`: Remove specific versions
  - `mode='prune'`: Keep only N most recent versions
  - `mode='truncate'`: Clear all version history

- **Version Features**:
  - Automatic backup before rollback
  - Validation before restore
  - Configurable retention policies
  - Version comparison capabilities

## [2.26.0] - 2025-12-28

### Added

- **Template Deployment**: New `n8n_deploy_template` tool for one-click template deployment
  - Deploy any template from n8n.io directly to your instance
  - Automatic credential stripping for security
  - Auto-fix common issues after deployment
  - TypeVersion upgrades to latest supported

- **Deployment Features**:
  - `templateId`: Required template ID from n8n.io
  - `name`: Optional custom workflow name
  - `autoFix`: Enable/disable automatic fixes (default: true)
  - `autoUpgradeVersions`: Upgrade node versions (default: true)
  - `stripCredentials`: Remove credential references (default: true)

## [2.25.0] - 2025-12-27

### Added

- **Workflow Diff Engine**: New partial update system for efficient workflow modifications
  - `n8n_update_partial_workflow`: Apply incremental changes via diff operations
  - Operations: addNode, removeNode, updateNode, moveNode, enable/disableNode
  - Connection operations: addConnection, removeConnection
  - Metadata operations: updateSettings, updateName, add/removeTag

- **Diff Benefits**:
  - 80-90% token reduction for updates
  - Atomic operations with rollback on failure
  - Validation-only mode for testing changes
  - Best-effort mode for partial application

## [2.24.1] - 2025-12-26

### Added

- **Session Persistence API**: Export and restore session state for zero-downtime deployments
  - `exportSessionState()`: Serialize active sessions with context
  - `restoreSessionState()`: Recreate sessions from serialized state
  - Multi-tenant support for SaaS deployments
  - Automatic session expiration handling

### Security

- **Important**: API keys exported as plaintext - downstream MUST encrypt
- Session validation on restore prevents invalid state injection
- Respects `sessionTimeout` configuration during restore

## [2.24.0] - 2025-12-25

### Added

- **Flexible Instance Configuration**: Connect to any n8n instance dynamically
  - Session-based instance switching via `configure` method
  - Per-request instance override in tool calls
  - Backward compatible with environment variable configuration

- **Multi-Tenant Support**: Run single MCP server for multiple n8n instances
  - Each session maintains independent instance context
  - Secure credential isolation between sessions
  - Automatic context cleanup on session end

## [2.23.0] - 2025-12-24

### Added

- **Type Structure Validation**: Complete validation for all 22 n8n property types
  - `filter`: Validates conditions array, combinator, operator structure
  - `resourceMapper`: Validates mappingMode and field mappings
  - `assignmentCollection`: Validates assignments array structure
  - `resourceLocator`: Validates mode and value combinations

- **Type Structure Service**: New service for type introspection
  - `getStructure(type)`: Get complete type definition
  - `getExample(type)`: Get working example values
  - `isComplexType(type)`: Check if type needs special handling
  - `getJavaScriptType(type)`: Get underlying JS type

### Changed

- **Enhanced Validation**: Validation now includes type-specific checks
- **Better Error Messages**: Type validation errors include expected structure

## [2.22.21] - 2025-12-23

### Added

- **Complete Type Structures**: Defined all 22 NodePropertyTypes with:
  - JavaScript type mappings
  - Expected data structures
  - Working examples
  - Validation rules
  - Usage notes

- **Type Categories**:
  - Primitive: string, number, boolean, dateTime, color, json
  - Options: options, multiOptions
  - Collections: collection, fixedCollection
  - Special: resourceLocator, resourceMapper, filter, assignmentCollection
  - Credentials: credentials, credentialsSelect
  - UI-only: hidden, button, callout, notice
  - Utility: workflowSelector, curlImport

## [2.22.0] - 2025-12-22

### Added

- **n8n Workflow Management Tools**: Full CRUD operations for n8n workflows
  - `n8n_create_workflow`: Create new workflows
  - `n8n_get_workflow`: Retrieve workflow details
  - `n8n_update_full_workflow`: Complete workflow replacement
  - `n8n_delete_workflow`: Remove workflows
  - `n8n_list_workflows`: List all workflows with filters
  - `n8n_validate_workflow`: Validate workflow by ID
  - `n8n_test_workflow`: Trigger workflow execution

- **Health Check**: `n8n_health_check` tool for API connectivity verification

### Changed

- **Tool Organization**: Management tools require n8n API configuration
- **Error Handling**: Improved error messages for API failures

## [2.21.0] - 2025-12-21

### Added

- **Tools Documentation System**: Self-documenting MCP tools
  - `tools_documentation` tool for comprehensive tool guides
  - Topic-based documentation (overview, specific tools)
  - Depth levels: essentials (quick ref) and full (comprehensive)

### Changed

- **Documentation Format**: Standardized documentation across all tools
- **Help System**: Integrated help accessible from within MCP

## [2.20.0] - 2025-12-20

### Added

- **Workflow Validation Tool**: `validate_workflow` for complete workflow checks
  - Node configuration validation
  - Connection validation
  - Expression syntax checking
  - AI tool compatibility verification

- **Validation Profiles**:
  - `minimal`: Quick required fields check
  - `runtime`: Production-ready validation
  - `ai-friendly`: Balanced for AI workflows
  - `strict`: Maximum validation coverage

## [2.19.0] - 2025-12-19

### Added

- **Expression Validator**: Validate n8n expression syntax
  - Detects missing `=` prefix in expressions
  - Validates `$json`, `$node`, `$input` references
  - Checks function call syntax
  - Reports expression errors with suggestions

### Changed

- **Validation Integration**: Expression validation integrated into workflow validator

## [2.18.0] - 2025-12-18

### Added

- **Node Essentials Tool**: `get_node_essentials` for AI-optimized node info
  - 60-80% smaller responses than full node info
  - Essential properties only
  - Working examples included
  - Perfect for AI context windows

- **Property Filtering**: Smart filtering of node properties
  - Removes internal/deprecated properties
  - Keeps only user-configurable options
  - Maintains operation-specific properties

## [2.17.0] - 2025-12-17

### Added

- **Enhanced Config Validator**: Operation-aware validation
  - Validates resource/operation combinations
  - Suggests similar resources when invalid
  - Provides operation-specific property requirements

- **Similarity Services**:
  - Resource similarity for typo detection
  - Operation similarity for suggestions
  - Fuzzy matching with configurable threshold

## [2.16.0] - 2025-12-16

### Added

- **Template System**: Workflow templates from n8n.io
  - `search_templates`: Find templates by keyword, nodes, or task
  - `get_template`: Retrieve complete template JSON
  - 2,700+ templates indexed with metadata
  - Search modes: keyword, by_nodes, by_task, by_metadata

- **Template Metadata**:
  - Complexity scoring
  - Setup time estimates
  - Required services
  - Node usage statistics

## [2.15.0] - 2025-12-15

### Added

- **HTTP Server Mode**: REST API for MCP integration
  - Single-session endpoint for simple deployments
  - Multi-session support for SaaS
  - Bearer token authentication
  - CORS configuration

- **Docker Support**: Official Docker image
  - `ghcr.io/czlonkowski/n8n-mcp`
  - Railway one-click deploy
  - Environment-based configuration

## [2.14.0] - 2025-12-14

### Added

- **Node Version Support**: Track and query node versions
  - `mode='versions'`: List all versions of a node
  - `mode='compare'`: Compare two versions
  - `mode='breaking'`: Find breaking changes
  - `mode='migrations'`: Get migration guides

- **Version Migration Service**: Automated migration suggestions
  - Property mapping between versions
  - Breaking change detection
  - Upgrade recommendations

## [2.13.0] - 2025-12-13

### Added

- **AI Tool Detection**: Identify AI-capable nodes
  - 265 AI tool variants detected
  - Tool vs non-tool node classification
  - AI workflow validation support

- **Tool Variant Handling**: Special handling for AI tools
  - Validate tool configurations
  - Check AI node connections
  - Verify tool compatibility

## [2.12.0] - 2025-12-12

### Added

- **Node-Specific Validators**: Custom validation for complex nodes
  - HTTP Request: URL, method, auth validation
  - Code: JavaScript/Python syntax checking
  - Webhook: Path and response validation
  - Slack: Channel and message validation

### Changed

- **Validation Architecture**: Pluggable validator system
- **Error Specificity**: More targeted error messages

## [2.11.0] - 2025-12-11

### Added

- **Config Validator**: Multi-profile validation system
  - Validate node configurations before deployment
  - Multiple strictness profiles
  - Detailed error reporting with suggestions

- **Validation Profiles**:
  - `minimal`: Required fields only
  - `runtime`: Runtime compatibility
  - `ai-friendly`: Balanced validation
  - `strict`: Full schema validation

## [2.10.0] - 2025-12-10

### Added

- **Documentation Mapping**: Integrated n8n docs
  - 87% coverage of core nodes
  - Links to official documentation
  - AI node documentation included

- **Docs Mode**: `get_node(mode='docs')` for markdown documentation

## [2.9.0] - 2025-12-09

### Added

- **Property Dependencies**: Analyze property relationships
  - Find dependent properties
  - Understand displayOptions
  - Track conditional visibility

### Changed

- **Property Extraction**: Enhanced extraction with dependencies

## [2.8.0] - 2025-12-08

### Added

- **FTS5 Search**: Full-text search with SQLite FTS5
  - Fast fuzzy searching
  - Relevance ranking
  - Partial matching

### Changed

- **Search Performance**: 10x faster searches with FTS5

## [2.7.0] - 2025-12-07

### Added

- **Database Adapter**: Universal SQLite adapter
  - better-sqlite3 for Node.js
  - sql.js for browser/Cloudflare
  - Automatic adapter selection

### Changed

- **Deployment Flexibility**: Works in more environments

## [2.6.0] - 2025-12-06

### Added

- **Search Nodes Tool**: `search_nodes` for node discovery
  - Keyword search with multiple modes
  - OR, AND, FUZZY matching
  - Result limiting and pagination

### Changed

- **Tool Interface**: Standardized parameter naming

## [2.5.0] - 2025-12-05

### Added

- **Get Node Tool**: `get_node` for detailed node info
  - Multiple detail levels: minimal, standard, full
  - Multiple modes: info, docs, versions
  - Property searching

## [2.4.0] - 2025-12-04

### Added

- **Validate Node Tool**: `validate_node` for configuration validation
  - Validates against node schema
  - Reports errors and warnings
  - Provides fix suggestions

## [2.3.0] - 2025-12-03

### Added

- **Property Extraction**: Deep analysis of node properties
  - Extract all configurable properties
  - Parse displayOptions conditions
  - Handle nested collections

## [2.2.0] - 2025-12-02

### Added

- **Node Parser**: Parse n8n node definitions
  - Extract metadata (name, description, icon)
  - Parse properties and operations
  - Handle version variations

## [2.1.0] - 2025-12-01

### Added

- **Node Loader**: Load nodes from n8n packages
  - Support n8n-nodes-base
  - Support @n8n/n8n-nodes-langchain
  - Handle node class instantiation

## [2.0.0] - 2025-11-30

### Added

- **MCP Server**: Model Context Protocol implementation
  - stdio mode for Claude Desktop
  - Tool registration system
  - Resource handling

### Changed

- **Architecture**: Complete rewrite for MCP compatibility

## [1.0.0] - 2025-11-15

### Added

- Initial release
- Basic n8n node database
- Simple search functionality
