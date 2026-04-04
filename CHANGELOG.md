# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.47.0] - 2026-04-04

### Added

- **`n8n_audit_instance` tool** — Security audit combining n8n's built-in `POST /audit` API (5 risk categories: credentials, database, nodes, instance, filesystem) with deep workflow scanning. Custom checks include 50+ regex patterns for hardcoded secrets (OpenAI, AWS, Stripe, GitHub, Slack, SendGrid, and more), unauthenticated webhook detection, error handling gap analysis, data retention risk assessment, and PII detection. Returns a compact markdown report grouped by workflow with a Remediation Playbook showing auto-fixable items, items requiring review, and items requiring user action. Inspired by [Audit n8n Workflows Security](https://wotai.co/blog/audit-n8n-workflows-security)
- **`n8n_manage_credentials` tool** — Full credential CRUD with schema discovery. Actions: list, get, create, update, delete, getSchema. Enables AI agents to create credentials and assign them to workflow nodes as part of security remediation. Credential secret values are never logged or returned in responses (defense-in-depth)
- **Credential scanner service** (`src/services/credential-scanner.ts`) — 50+ regex patterns ported from the production cache ingestion pipeline, covering AI/ML keys, cloud/DevOps tokens, GitHub PATs, payment keys, email/marketing APIs, and more. Per-node scanning with masked output
- **Workflow security scanner** (`src/services/workflow-security-scanner.ts`) — 4 configurable checks: hardcoded secrets, unauthenticated webhooks (excludes respondToWebhook), error handling gaps (3+ node threshold), data retention settings
- **Audit report builder** (`src/services/audit-report-builder.ts`) — Generates compact grouped-by-workflow markdown with tables, built-in audit rendering, and a Remediation Playbook with tool chains for auto-fixing

### Changed

- **CLAUDE.md** — Removed Session Persistence section (no longer needed), added OSS sensitivity notice to prevent secrets from landing in committed files
- **API client request interceptor** — Now redacts request body for `/credentials` endpoints to prevent secret leakage in debug logs
- **Credential handler responses** — All credential handlers (get, create, update) strip the `data` field from responses as defense-in-depth against future n8n versions returning decrypted values

### Security

- **Secret masking at scan time** — `maskSecret()` is called immediately during scanning; raw values are never stored in detection results
- **Credential body redaction** — API client interceptor suppresses body logging for credential endpoints
- **Cursor dedup guard** — `listAllWorkflows()` tracks seen cursors to prevent infinite pagination loops
- **PII findings classified as review** — PII detections (email, phone, credit card) are marked as `review_recommended` instead of `auto_fixable`, preventing nonsensical auto-remediation

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.46.1] - 2026-04-03

### Fixed

- **Fix SSE reconnection loop** — SSE clients entering rapid reconnection loops because `POST /mcp` never routed messages to `SSEServerTransport.handlePostMessage()` (Fixes #617). Root cause: SSE sessions were stored in a separate `this.session` property invisible to the StreamableHTTP POST handler
- **Add authentication to SSE endpoints** — `GET /sse` and `POST /messages` now require Bearer token authentication, closing an auth gap where SSE connections were unauthenticated
- **Fix rate limiter exhaustion during reconnection** — added `skipSuccessfulRequests: true` to `authLimiter` so legitimate requests don't count toward the rate limit, preventing 429 storms during SSE reconnection loops

### Changed

- **Separate SSE endpoints (SDK pattern)** — SSE transport now uses dedicated `GET /sse` + `POST /messages` endpoints instead of sharing `/mcp` with StreamableHTTP, following the official MCP SDK backward-compatible server pattern
- **Unified auth into `authenticateRequest()` method** — consolidated duplicated Bearer token validation logic from three endpoints into a single method with consistent JSON-RPC error responses
- **SSE sessions use shared transports map** — removed the legacy `this.session` singleton; SSE sessions are now stored in the same `this.transports` map as StreamableHTTP sessions with `instanceof` guards for type discrimination

### Deprecated

- **SSE transport (`GET /sse`, `POST /messages`)** — SSE is deprecated in MCP SDK v1.x and removed in v2.x. Clients should migrate to StreamableHTTP (`POST /mcp`). These endpoints will be removed in a future major release

### Security

- **Rate limiting on all authenticated endpoints** — `authLimiter` now applied to `GET /sse` and `POST /messages` in addition to `POST /mcp`
- **Transport type guards** — `instanceof` checks prevent cross-protocol access (SSE session IDs rejected on StreamableHTTP endpoint and vice versa)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.46.0] - 2026-04-03

### Added

- **`patchNodeField` operation for `n8n_update_partial_workflow`** — a dedicated, strict find/replace operation for surgical string edits in node fields (Fixes #696). Key features:
  - **Strict error handling**: errors if find string not found (unlike `__patch_find_replace` which only warns)
  - **Ambiguity detection**: errors if find matches multiple times unless `replaceAll: true` is set
  - **`replaceAll` flag**: replace all occurrences of a string in a single patch
  - **`regex` flag**: use regex patterns for advanced find/replace
  - Top-level operation type for better discoverability

### Security

- **Prototype pollution protection** — `setNestedProperty` and `getNestedProperty` now reject paths containing `__proto__`, `constructor`, or `prototype`. Protects both `patchNodeField` and `updateNode` operations
- **ReDoS protection** — regex patterns with nested quantifiers or overlapping alternations are rejected to prevent catastrophic backtracking
- **Resource limits** — max 50 patches per operation, max 500-char regex patterns, max 512KB field size for regex operations

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.45.1] - 2026-04-02

### Fixed

- **Use stdio-wrapper.js as default bin entry point** — the previous entry point (`index.js`) wrote INFO-level logs to stdout, corrupting JSON-RPC MCP transport for stdio-mode users (Fixes #693, Related: #555, #628)
- **Preserve node credentials during full workflow updates** — `n8n_update_full_workflow` now carries forward existing credential references from the server when user-provided nodes omit them, preventing "missing credentials" errors on PUT (Fixes #689)

### Changed

- **Updated publish scripts** to use `stdio-wrapper.js` as the npm bin entry point, ensuring the fix persists across releases

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.45.0] - 2026-04-01

### Changed

- **Update n8n dependencies** to latest versions:
  - `n8n`: 2.13.3 → 2.14.2
  - `n8n-core`: 2.13.1 → 2.14.1
  - `n8n-workflow`: 2.13.1 → 2.14.1
  - `@n8n/n8n-nodes-langchain`: 2.13.1 → 2.14.1
- **Rebuild FTS5 search index** with all 1396 nodes (812 base + 584 community)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.44.1] - 2026-04-01

### Security

- **Bump axios** from `^1.11.0` to `^1.14.0` to patch known vulnerability
- **Bump nodemon** from `^3.1.10` to `^3.1.14` to patch transitive dependency vulnerabilities

### Changed

- **Upgrade GitHub Actions** to latest versions across all CI/CD workflows (docker, release, test, update-n8n-deps) — contributed by @salmanmkc in #663

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.44.0] - 2026-04-01

### Added

- **Multi-step workflow generation flow**: `n8n_generate_workflow` now supports a three-step flow where AI agents act as quality gates — get proposals, review, then deploy. New parameters: `deploy_id` (deploy a specific proposal), `confirm_deploy` (deploy a previously generated preview).

- **`GenerateWorkflowProposal` type**: New exported type for workflow proposals with `id`, `name`, `description`, `flow_summary`, and `credentials_needed` fields.

- **`status` field on `GenerateWorkflowResult`**: Indicates the current phase — `proposals`, `preview`, `deployed`, or `error`.

### Changed

- **Tool description updated**: `n8n_generate_workflow` description now explains the multi-step flow instead of auto-deploy behavior.

- **Tool documentation updated**: Essentials and full docs reflect the three-step flow with examples for each step.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.43.0] - 2026-03-31

### Added

- **`n8n_generate_workflow` tool**: New MCP tool that enables AI-powered workflow generation from natural language descriptions. Available on the hosted service with handler delegation pattern for extensibility.

- **Handler injection API**: `EngineOptions.generateWorkflowHandler` allows hosting environments to provide custom workflow generation backends. Handler receives helpers for `createWorkflow`, `validateWorkflow`, `autofixWorkflow`, and `getWorkflow`.

- **Tool documentation**: Full essentials and deep documentation for `n8n_generate_workflow` via `tools_documentation`.

### Fixed

- **Tools documentation count**: Corrected n8n API tools count and added missing `n8n_manage_datatable` entry to tools overview.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.3] - 2026-03-30

### Improved

- **Patterns response trimmed for token efficiency** (Issue #683): Task-specific patterns response reduced ~64% — dropped redundant `displayName`, shortened field names (`frequency` → `freq`), capped chains at 5, and shortened chain node types to last segment.

- **`patterns` mode added to `tools_documentation`**: Was missing from both essentials and full docs. AI agents can now discover patterns mode through the standard documentation flow.

- **`includeOperations` omission behavior documented**: Added note that trigger nodes and freeform nodes (Code, HTTP Request) omit the `operationsTree` field.

- **`search_nodes` examples trimmed**: Reduced from 11 to 6 examples in full docs, removing near-duplicates.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.2] - 2026-03-30

### Fixed

- **`workflow-patterns.json` missing from npm package** (Issue #681): Added `data/workflow-patterns.json` to the `files` array in `package.json` so the patterns file is included in the published npm package and works out of the box without manual generation.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.1] - 2026-03-30

### Fixed

- **Community nodes missing from database after rebuild**: Restored 584 community nodes from the n8n 2.13.3 snapshot and re-extracted operations with resource grouping from `properties_schema`. 366 community nodes now have proper resource-grouped operations.

- **Community node service missing resource extraction**: `extractOperations()` in `community-node-service.ts` was not extracting `resource` from `displayOptions.show.resource`, same issue that was fixed in `property-extractor.ts` in v2.42.0.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.42.0] - 2026-03-30

### Added

- **`includeOperations` flag for search_nodes**: Opt-in parameter that returns a resource/operation tree per search result, grouped by resource (e.g., Slack returns 7 resources with 44 operations). Saves a mandatory `get_node` round-trip when building workflows. Adds ~100-300 tokens per result.

- **`searchMode: "patterns"` for search_templates**: New lightweight mode that serves workflow pattern summaries mined from 2,700+ templates. Returns common node combinations, connection chains, and frequency data per task category (10 categories: ai_automation, webhook_processing, scheduling, etc.). Use `task` parameter for category-specific patterns or omit for overview.

- **Workflow pattern mining script** (`npm run mine:patterns`): Extracts node frequency, co-occurrence, and connection topology from the template database. Two-pass pipeline: Pass 1 analyzes `nodes_used` metadata (no decompression), Pass 2 decompresses workflows for connection analysis. Produces `data/workflow-patterns.json` with 554 node types, 3,201 edges, and 5,246 chains.

### Fixed

- **Operations extraction now includes resource grouping**: The property extractor was using `find()` to get only the first `operation` property, but n8n nodes have multiple operation properties each mapped to a different resource via `displayOptions.show.resource`. Changed to `filter()` to capture all operation properties. Slack went from 17 flat operations to 44 operations across 7 named resources.

- **FTS-to-LIKE fallback dropped search options**: When the FTS5 search fell back to LIKE-based search (e.g., for "http request"), the `options` object (including `includeOperations`, `includeExamples`, `source`) was silently lost. Now correctly passed through.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.4] - 2026-03-30

### Fixed

- **`validate_workflow` misses `conditions.options` check for If/Switch nodes** (Issue #675): Added version-conditional validation — If v2.2+ and Switch v3.2+ now require `conditions.options` metadata, If v2.0-2.1 validates operator structures, and v1.x is left unchecked. Previously only caught by `n8n_create_workflow` pre-flight but not by offline `validate_workflow`.

- **False positive "Set node has no fields configured" for Set v3+** (Issue #676): The `validateSet` checker now recognizes `config.assignments.assignments` (v3+ schema) in addition to `config.values` (v1/v2 schema). Updated suggestion text to match current UI terminology.

- **Expression validator does not detect unwrapped n8n expressions** (Issue #677): Added heuristic pre-pass that detects bare `$json`, `$node`, `$input`, `$execution`, `$workflow`, `$prevNode`, `$env`, `$now`, `$today`, `$itemIndex`, and `$runIndex` references missing `={{ }}` wrappers. Uses anchored patterns to avoid false positives. Emits warnings, not errors.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.3] - 2026-03-27

### Fixed

- **Session timeout default too low** (Issue #626): Raised `SESSION_TIMEOUT_MINUTES` default from 5 to 30 minutes. The 5-minute default caused sessions to expire mid-operation during complex multi-step workflows (validate → get structure → patch → validate), forcing users to retry. Configurable via environment variable.

- **Operations array received as string from VS Code** (Issue #600): Added `z.preprocess` JSON string parsing to the `operations` parameter in `n8n_update_partial_workflow`. The VS Code MCP extension serializes arrays as JSON strings — the Zod schema now transparently parses them before validation.

- **`undefined` values rejected in MCP tool calls from VS Code** (Issue #611): Strip explicit `undefined` values from tool arguments before Zod validation. VS Code sends `undefined` as a value which Zod's `.optional()` rejects (it expects the field to be missing, not present-but-undefined).

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.2] - 2026-03-27

### Fixed

- **MCP initialization floods Claude Desktop with JSON parse errors** (Issues #628, #627, #567): Intercept `process.stdout.write` in stdio mode to redirect non-JSON-RPC output to stderr. Console method suppression alone was insufficient — native modules (better-sqlite3), n8n packages, and third-party code can call `process.stdout.write()` directly, corrupting the JSON-RPC stream. Only writes containing valid JSON-RPC messages (`{"jsonrpc":...}`) are now allowed through stdout; everything else is redirected to stderr. This fixes the flood of "Unexpected token is not valid JSON" warnings on every new chat in Claude Desktop, including leaked `refCount`, `dbPath`, `clientVersion`, `protocolVersion`, and other debug strings.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.1] - 2026-03-27

### Fixed

- **If node operators silently fail at runtime** (Issue #665): Replaced incorrect operator names `isNotEmpty`/`isEmpty` with `notEmpty`/`empty` across all validators, sanitizer, documentation, and error messages. n8n's execution engine does not recognize `isNotEmpty`/`isEmpty` — unknown operators silently return `false`, causing If/Switch conditions to always take the wrong branch. Added auto-correction in the sanitizer so existing workflows using legacy names are fixed on update.

- **`addConnection` creates broken connections with `type: "0"`** (Issue #659): Fixed two edge cases where numeric `targetInput` or `sourceOutput` values leaked into connection objects as `"type": "0"` instead of `"type": "main"`. Numeric `targetInput` values are now remapped to `"main"`, and the `sourceOutput` remapping guard was relaxed to handle redundant `sourceOutput: 0` + `sourceIndex: 0` combinations. Also resolves Issue #653 (dangling connections after `removeNode`) which was caused by malformed connections from this bug.

- **`__patch_find_replace` corrupts Code node jsCode** (Issue #642): Implemented the `__patch_find_replace` feature for surgical string edits in `updateNode` operations. Previously, passing `{"parameters.jsCode": {"__patch_find_replace": [...]}}` stored the patch object literally as jsCode, producing `[object Object]` at runtime. The feature now reads the current string value, applies each `{find, replace}` entry sequentially, and writes back the modified string. Includes validation for patch format, target property existence, and string type.

### Improved

- Extracted `OPERATOR_CORRECTIONS` and `UNARY_OPERATORS` to module-level constants for better performance and single source of truth
- Added `exists`/`notExists` to unary operator lists for consistency across sanitizer and validator
- Fixed recovery guidance referencing non-existent `validate_node_operation` tool (now `validate_node`)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.41.0] - 2026-03-25

### Changed

- **Updated n8n dependencies**: n8n 2.12.3 → 2.13.3, n8n-core 2.12.0 → 2.13.1, n8n-workflow 2.12.0 → 2.13.1, @n8n/n8n-nodes-langchain 2.12.0 → 2.13.1
- **Rebuilt node database**: 1,396 nodes (812 from n8n-nodes-base/langchain + 584 community: 516 verified + 68 npm)
- **Refreshed community nodes**: 584 total (up from 430), with 581 AI-generated documentation summaries
- **Improved documentation generator**: Strip `<think>` tags from thinking-model responses; use raw fetch for vLLM `chat_template_kwargs` support
- **Incremental community node updates**: `fetch:community` now upserts by default, preserving existing READMEs and AI summaries. Use `--rebuild` for clean slate

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.40.5] - 2026-03-22

### Fixed

- **Webhook workflows created via MCP get 404 errors** (Issue #643): Auto-inject `webhookId` (UUID) on webhook-type nodes (`webhook`, `webhookTrigger`, `formTrigger`, `chatTrigger`) during `cleanWorkflowForCreate()` and `cleanWorkflowForUpdate()`. n8n 2.10+ requires this field for proper webhook URL registration; without it, webhooks silently fail with 404. Existing `webhookId` values are preserved.

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.4] - 2026-03-22

### Fixed

- **Incorrect data tables availability info**: Removed "enterprise/cloud only" restriction from tool description and documentation — data tables are available on all n8n plans including self-hosted
- **Redundant pitfalls removed**: Removed "Requires N8N_API_URL and N8N_API_KEY" and "enterprise or cloud plans" pitfalls — the first is implicit for all n8n management tools, the second was incorrect

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.3] - 2026-03-22

### Fixed

- **Notification 400 disconnect storms (#654)**: `handleRequest()` now returns 202 Accepted for JSON-RPC notifications with stale/expired session IDs instead of 400. Per JSON-RPC 2.0 spec, notifications don't expect responses — returning 400 caused Claude's proxy to trigger reconnection storms (930 errors/day, 216 users affected)
- **TOCTOU race in session lookup**: Added null guard after transport assignment to handle sessions removed between the existence check and use
- **`updateTable` silently ignoring `columns` parameter**: Now returns a warning message when `columns` is passed to `updateTable`, clarifying that table schema is immutable after creation via the public API
- **Tool schema descriptions clarified**: `name` and `columns` parameter descriptions now explicitly document that `updateTable` is rename-only and columns are for `createTable` only

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.2] - 2026-03-22

### Fixed

- **Double URL-encoding of `filter` and `sortBy` in `getRows`/`deleteRows`**: Moved `encodeURIComponent()` from handler layer to a custom `paramsSerializer` in the API client. Handlers were encoding values before passing them as Axios params, causing double-encoding (`%257B` instead of `%7B`). Handlers now pass raw values; the API client encodes once via `serializeDataTableParams()`
- **`updateTable` documentation clarified**: Explicitly notes that only renaming is supported (no column modifications via public API)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.1] - 2026-03-21

### Fixed

- **`n8n_manage_datatable` row operations broken by MCP transport serialization**: `data` parameter received as string instead of JSON — added `z.preprocess` coercers for array/object/filter params
- **`n8n_manage_datatable` filter/sortBy URL encoding**: n8n API requires URL-encoded query params — added `encodeURIComponent()` for filter and sortBy in getRows and deleteRows (revised in 2.40.2 to move encoding to API client layer)
- **`json` column type rejected by n8n API**: Removed `json` from column type enum (n8n only accepts string/number/boolean/date)
- **Garbled 404 error messages**: Fixed `N8nNotFoundError` constructor — API error messages are now passed through cleanly instead of being wrapped in "Resource with ID ... not found"

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.40.0] - 2026-03-21

### Changed

- **`n8n_manage_datatable` MCP tool** (replaces `n8n_create_data_table`): Full data table management covering all 10 n8n data table API endpoints
  - **Table operations**: createTable, listTables, getTable, updateTable, deleteTable
  - **Row operations**: getRows, insertRows, updateRows, upsertRows, deleteRows
  - Filter system with and/or logic and 8 condition operators (eq, neq, like, ilike, gt, gte, lt, lte)
  - Dry-run support for updateRows, upsertRows, deleteRows
  - Pagination, sorting, and full-text search for row listing
  - Shared error handler and consolidated Zod schemas for consistency
  - 9 new `N8nApiClient` methods for all data table endpoints
- **`projectId` parameter for `n8n_create_workflow`**: Create workflows directly in a specific team project (enterprise feature)

### Breaking

- `n8n_create_data_table` tool replaced by `n8n_manage_datatable` with `action: "createTable"`

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.38.0] - 2026-03-20

### Added

- **`transferWorkflow` diff operation** (Issue #644): Move workflows between projects via `n8n_update_partial_workflow`
  - New `transferWorkflow` operation type with `destinationProjectId` parameter
  - Calls `PUT /workflows/{id}/transfer` via dedicated API after workflow update
  - Proper error handling: returns `{ success: false, saved: true }` when transfer fails after update
  - Transfer executes before activation so workflow is in target project first
  - Zod schema validates `destinationProjectId` is non-empty
  - Updated tool description and documentation to list the new operation
  - `inferIntentFromOperations` returns descriptive intent for transfer operations
  - `N8nApiClient.transferWorkflow()` method added

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.4] - 2026-03-18

### Changed

- **Updated n8n dependencies**: n8n 2.11.4 → 2.12.3, n8n-core 2.11.1 → 2.12.0, n8n-workflow 2.11.1 → 2.12.0, @n8n/n8n-nodes-langchain 2.11.2 → 2.12.0
- **Rebuilt node database**: 1,239 nodes (809 from n8n-nodes-base and @n8n/n8n-nodes-langchain, 430 community)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.3] - 2026-03-15

### Fixed

- **updateNode `name`/`id` field normalization**: LLMs sending `{type: "updateNode", name: "Code", ...}` instead of `nodeName` no longer get "Node not found" errors. The Zod schema now normalizes `name` → `nodeName` and `id` → `nodeId` for node-targeting operations (updateNode, removeNode, moveNode, enableNode, disableNode)
- **AI connection types in disconnected-node detection** (Issue #581): Replaced hardcoded 7-type list with dynamic iteration over all connection types present in workflow data. Nodes connected via `ai_outputParser`, `ai_document`, `ai_textSplitter`, `ai_agent`, `ai_chain`, `ai_retriever` are no longer falsely flagged as disconnected during save
- **Connection schema and reference validation** (Issue #581): Added `.catchall()` to `workflowConnectionSchema` for unknown AI connection types, and extended connection reference validation to check all connection types (not just `main`)
- **autofix `filterOperationsByFixes` ID-vs-name mismatch**: Typeversion-upgrade operations now include `nodeName` alongside `nodeId`, and the filter checks both fields. Previously, `applyFixes=true` silently dropped all typeversion fixes because `fixedNodes` contained names but the filter only checked `nodeId` (UUID)

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.2] - 2026-03-15

### Fixed

- **Code validator `$()` false positive** (Issue #294): `$('Previous Node').first().json` no longer triggers "Invalid $ usage detected" warning. Added `(` and `_` to the regex negative lookahead to support standard n8n cross-node references and valid JS identifiers like `$_var`
- **Code validator helper function return false positive** (Issue #293): `function isValid(item) { return false; }` no longer triggers "Cannot return primitive values directly" error. Added helper function detection to skip primitive return checks when named functions or arrow function assignments are present
- **Null property removal in diff engine** (Issue #611): `{continueOnFail: null}` no longer causes Zod validation error "Expected boolean, received null". The diff engine now treats `null` values as property deletion (`delete` operator), and documentation updated from `undefined` to `null` for property removal

Conceived by Romuald Członkowski - https://www.aiadvisors.pl/en

## [2.37.1] - 2026-03-14

### Fixed

- **Numeric sourceOutput remapping** (Issue #537): `addConnection` with numeric `sourceOutput` values like `"0"` or `"1"` now correctly maps to `"main"` with the corresponding `sourceIndex`, preventing malformed connection keys
- **IMAP Email Trigger activation** (Issue #538): `n8n-nodes-base.emailReadImap` and other IMAP-based polling triggers are now recognized as activatable triggers, allowing workflow activation
- **AI tool description false positives** (Issue #477): Validators now check `description` and `options.description` in addition to `toolDescription`, fixing false `MISSING_TOOL_DESCRIPTION` errors for toolWorkflow, toolCode, and toolSerpApi nodes
- **n8n_create_workflow undefined ID** (Issue #602): Added defensive check for missing workflow ID in API response with actionable error message
- **Flaky CI performance test**: Relaxed bulk insert ratio threshold from 15 to 20 to accommodate CI runner variability

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.37.0] - 2026-03-14

### Fixed

- **Unary operator sanitization** (Issue #592): Added missing `empty`, `notEmpty`, `exists`, `notExists` operators to the sanitizer's unary operator list, preventing IF/Switch node corruption during partial updates
- **Positional connection array preservation** (Issue #610): `removeNode` and `cleanStaleConnections` now trim only trailing empty arrays, preserving intermediate positional indices for IF/Switch multi-output nodes
- **Scoped sanitization**: Auto-sanitization now only runs on nodes that were actually added or updated, preventing unrelated nodes (e.g., HTTP Request parameters) from being silently modified
- **Activate/deactivate 415 errors** (Issue #633): Added empty body `{}` to POST calls for workflow activation/deactivation endpoints
- **Zod error readability** (Issue #630): Validation errors now return human-readable `"path: message"` strings instead of raw Zod error objects
- **updateNode error hints** (Issue #623): Improved error message when `updates` parameter is missing, showing correct structure with `nodeId`/`nodeName` and `updates` fields
- **removeConnection after removeNode** (Issue #624): When a node was already removed by a prior `removeNode` operation, the error message now explains that connections were automatically cleaned up
- **Connection type coercion** (Issue #629): `sourceOutput` and `targetInput` are now coerced to strings, handling numeric values (0, 1) passed by MCP clients

### Added

- **`saved` field in responses** (Issue #625): All `n8n_update_partial_workflow` responses now include `saved: true/false` to distinguish whether the workflow was persisted to n8n
- **Tag operations via dedicated API** (Issue #599): `addTag`/`removeTag` now use the n8n tag API (`PUT /workflows/{id}/tags`) instead of embedding tags in the workflow body, fixing silent tag failures. Includes automatic tag creation, case-insensitive name resolution, and last-operation-wins reconciliation for conflicting add/remove
- **`updateWorkflowTags` API client method**: New method on `N8nApiClient` for managing workflow tag associations via the dedicated endpoint
- **`operationsApplied` in top-level response**: Promoted from nested `details` to top-level for easier consumption by MCP clients

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.36.2] - 2026-03-14

### Changed

- **Updated n8n dependencies**: n8n 2.10.3 → 2.11.4, n8n-core 2.10.1 → 2.11.1, n8n-workflow 2.10.1 → 2.11.1, @n8n/n8n-nodes-langchain 2.10.1 → 2.11.2
- **Updated @modelcontextprotocol/sdk**: 1.20.1 → 1.27.1 (fixes critical cross-client data leak vulnerability CVE GHSA-345p-7cg4-v4c7)
- Rebuilt node database with 1,239 nodes (809 core + 430 community preserved)
- Updated README badge with new n8n version and node counts

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.36.1] - 2026-03-08

### Added

- **Conditional branch fan-out detection** (`CONDITIONAL_BRANCH_FANOUT`): Warns when IF, Filter, or Switch nodes have all connections crammed into `main[0]` with higher-index outputs empty, which usually means all target nodes execute together on one branch while other branches have no effect
  - Detects IF nodes with both true/false targets on `main[0]`
  - Detects Filter nodes with both matched/unmatched targets on `main[0]`
  - Detects Switch nodes with all targets on output 0 and other outputs unused
  - Skips warning when fan-out is legitimate (higher outputs also have connections)
  - Skips warning for single connections (intentional true-only/matched-only usage)

### Changed

- **Refactored output index validation**: Extracted `getShortNodeType()` and `getConditionalOutputInfo()` helpers to eliminate duplicated conditional node detection logic between `validateOutputIndexBounds` and the new `validateConditionalBranchUsage`

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.36.0] - 2026-03-07

### Added

- **Connection validation: detect broken/malformed workflow connections** (Issue #620):
  - Unknown output keys (`UNKNOWN_CONNECTION_KEY`): Flags invalid connection keys like `"0"`, `"1"`, `"output"` with fix suggestions (e.g., "use main[1] instead" for numeric keys)
  - Invalid type field (`INVALID_CONNECTION_TYPE`): Detects invalid `type` values in connection targets (e.g., `"0"` instead of `"main"`)
  - Output index bounds checking (`OUTPUT_INDEX_OUT_OF_BOUNDS`): Catches connections using output indices beyond what a node supports, with awareness of `onError: 'continueErrorOutput'`, Switch rules, and IF/Filter nodes
  - Input index bounds checking (`INPUT_INDEX_OUT_OF_BOUNDS`): Validates target input indices against known node input counts (Merge=2, triggers=0, others=1)
  - BFS-based trigger reachability analysis: Replaces simple orphan detection with proper graph traversal from trigger nodes, flagging unreachable subgraphs
  - Flexible `WorkflowConnection` interface: Changed from explicit `main?/error?/ai_tool?` to `[outputType: string]` for accurate validation of all connection types

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.6] - 2026-03-04

### Changed

- **Updated n8n dependencies**: n8n 2.8.3 → 2.10.3, n8n-core 2.8.1 → 2.10.1, n8n-workflow 2.8.0 → 2.10.1, @n8n/n8n-nodes-langchain 2.8.1 → 2.10.1
- Rebuilt node database with 806 core nodes (community nodes preserved from previous build)

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.5] - 2026-02-22

### Fixed

- **Comprehensive parameter type coercion for Claude Desktop / Claude.ai** (Issue #605): Expanded the v2.35.4 fix to handle ALL type mismatches, not just stringified objects/arrays. Testing revealed 6/9 tools still failing in Claude Desktop after the initial fix.
  - Extended `coerceStringifiedJsonParams()` to coerce every schema type: `string→number`, `string→boolean`, `number→string`, `boolean→string` (in addition to existing `string→object` and `string→array`)
  - Added top-level safeguard to parse the entire `args` object if it arrives as a JSON string
  - Added `[Diagnostic]` section to error responses showing received argument types, enabling users to report exactly what their MCP client sends
  - Added 9 new unit tests (24 total) covering number, boolean, and number-to-string coercion

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.4] - 2026-02-20

### Fixed

- **Defensive JSON.parse for stringified object/array parameters** (Issue #605): Claude Desktop 1.1.3189 serializes JSON object/array MCP parameters as strings, causing ZodError failures for ~60% of tools that accept nested parameters
  - Added schema-driven `coerceStringifiedJsonParams()` in the central `CallToolRequestSchema` handler
  - Automatically detects string values where the tool's `inputSchema` expects `object` or `array`, and parses them back
  - Safe: prefix check before parsing, type verification after, try/catch preserves original on failure
  - No-op for correct clients: native objects pass through unchanged
  - Affects 9 tools with object/array params: `validate_node`, `validate_workflow`, `n8n_create_workflow`, `n8n_update_full_workflow`, `n8n_update_partial_workflow`, `n8n_validate_workflow`, `n8n_autofix_workflow`, `n8n_test_workflow`, `n8n_executions`
  - Added 15 unit tests covering coercion, no-op, safety, and end-to-end scenarios

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.3] - 2026-02-19

### Changed

- **Updated n8n dependencies**: n8n 2.6.3 → 2.8.3, n8n-core 2.6.1 → 2.8.1, n8n-workflow 2.6.0 → 2.8.0, @n8n/n8n-nodes-langchain 2.6.2 → 2.8.1
- **Fixed node loader for langchain package**: Adapted node loader to bypass restricted package.json `exports` field in @n8n/n8n-nodes-langchain >=2.9.0, resolving node files via absolute paths instead of `require.resolve()`
- **Fixed community doc generation for cloud LLMs**: Added `N8N_MCP_LLM_API_KEY`/`OPENAI_API_KEY` env var support, switched to `max_completion_tokens`, and auto-omit `temperature` for cloud API endpoints
- Rebuilt node database with 1,236 nodes (673 from n8n-nodes-base, 133 from @n8n/n8n-nodes-langchain, 430 community)
- Refreshed community nodes (361 verified + 69 npm) with 424/430 AI documentation summaries

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

## [2.35.2] - 2026-02-09

### Changed

- **MCP Apps: Disable non-rendering apps in Claude.ai**: Disabled 3 MCP Apps (workflow-list, execution-history, health-dashboard) that render as collapsed accordions in Claude.ai, and removed `n8n_deploy_template` tool mapping which renders blank content. The server sets `_meta` correctly on the wire but the Claude.ai host ignores it for these tools. The 2 working apps (operation-result for 6 tools, validation-summary for 3 tools) remain active. Disabled apps can be re-enabled once the host-side issue is resolved.

Conceived by Romuald Czlonkowski - https://www.aiadvisors.pl/en

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
