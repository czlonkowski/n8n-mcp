# n8n Official MCP vs n8n-mcp — Head-to-Head Competitive Analysis

**Date:** 2026-06-19 (supersedes the 2026-04-30 edition)
**Official server tested:** live n8n MCP server on the **stable channel** (full-rewrite update path), cross-referenced against the **n8n 2.27.0 source tree** (master, pre-release — npm `latest` is 2.26.7) with `@n8n/workflow-sdk` 0.20.0 (source) / 0.19.2 (npm `latest`).
**n8n-mcp version tested:** 2.59.0 (bundles n8n 2.26.2), live staging instance.

---

## 0. What changed since the April 2026 edition

The previous edition's headline was that **n8n-mcp wins iterative editing by 6.5×–22× because the official server only does full-workflow rewrites**. That premise is now time-bound, and this refresh corrects it:

- **The official server has built a diff-based partial-update tool.** In the n8n **2.27.0 source tree**, `update_workflow` is no longer a full SDK-code rewrite — it applies an ordered, atomic array of named operations (14 op types, up to 100/call) directly to the stored workflow JSON. Its own docstring says it "emits a tiny diff per call instead of re-sending the full SDK code." This is the same model n8n-mcp pioneered, and it neutralizes the raw per-edit token gap for built-in-node editing.
- **But it is not shipped yet.** The live official server on the **stable channel still uses the full-code update path** — verified directly: its `update_workflow` tool accepts only `{ workflowId, code }` (full TypeScript SDK code), and adding one node to a 9-node workflow re-sends the entire program. npm `latest` is n8n 2.26.7; every diff-update commit is dated 2026-06-17/18 and sits in no release tag. So **today, on what users actually run, the April finding still holds and is live-verified** — it simply has a near-term expiry.
- **Single-node validation arrived** on the official side (`validate_node_config`, in 2.27.0 source) — the April "no single-node validation" gap is closed.
- **The official validator still passes broken configs as `valid:true`** on the stable channel (live-verified across 4 of 5 probes), and even in 2.27.0 source the schema-error→warning downgrade persists.
- **The durable differentiators are unchanged**: templates, community/custom-node coverage, credentials CRUD, instance audit, version history, multi-instance/SaaS, and surgical in-field edits (`patchNodeField`).

The strategic correction: **stop selling a raw per-edit token multiple as the moat.** The moat is ecosystem breadth (templates, community nodes, credentials, audit, versions, multi-instance) plus a handful of edit-ergonomics the official op set still lacks. The token advantage now survives only in specific shapes (large Code-node / array-field edits) and on the stable channel until 2.27.x ships.

---

## 1. Executive summary

n8n ships a first-party MCP server inside the product (`packages/cli/src/modules/mcp/`), with workflow authoring split into `@n8n/workflow-sdk` and `@n8n/ai-workflow-builder.ee`. The architectural divergence is narrowing: the official server makes the LLM **author** workflows as TypeScript code against a fluent SDK, but its **update** path is converging on the same JSON-diff model n8n-mcp uses.

| Concern | Winner | Margin / Notes |
|---|---|---|
| Greenfield authoring (built-in nodes) | ≈ Tie (different model) | Official: SDK TypeScript → `create_workflow_from_code`. n8n-mcp: direct JSON + 2,700+ templates + NL-to-workflow (hosted). n8n-mcp wins on template-accelerated starts. |
| Iterative editing, raw token cost | **Tie soon; n8n-mcp today** | Stable official is still full-rewrite (live-verified) → n8n-mcp advantage holds **now**. n8n 2.27.x source is diff-based (14 ops) → parity for built-in-node edits once shipped. |
| Surgical large-field / Code-node edits | **n8n-mcp** | `patchNodeField` does find/replace inside a field; the official `setNodeParameter` (RFC 6901 pointer) has no find/replace and no array indices, so it re-sends the whole field value. Survives 2.27.x. |
| Validation depth & actionability | **n8n-mcp** | 4 named profiles + by-ID validation + 13-fix-type autofix. Official: one un-exposed `strictMode` flag, reports-only, schema errors downgraded to warnings. |
| Single-node validation | ≈ Tie (official caught up) | Official `validate_node_config` (2.27.0 source) closes the gap; n8n-mcp's residual edge is community-node coverage. |
| Templates / patterns library | **n8n-mcp** | 2,700+ templates; official has zero template tools. |
| Credentials management | **n8n-mcp** | n8n-mcp has CRUD + getSchema; official has read-only `list_credentials` + auto-assign only (HTTP nodes excluded). |
| Instance audit / security scan | **n8n-mcp** | n8n-mcp ships it; official has none. |
| Workflow version history & rollback | **n8n-mcp** | n8n-mcp has it; official has only soft-delete `archive_workflow`. |
| Community-node coverage | **n8n-mcp** | n8n-mcp covers ~1,845 nodes (816 core + 1,029 community). Official can *search* installed community nodes but cannot *type/validate* them (schemas baked to the two built-in packages). |
| Multi-instance / fleet / SaaS | **n8n-mcp** | n8n-mcp ships a multi-tenant SaaS; official is 1:1 to one n8n. |
| Drafts / publish lifecycle | **Official** | `publish_workflow` / `unpublish_workflow`; n8n-mcp uses the activate flag. |
| Project / folder placement on create | **Official** | `create_workflow_from_code` takes `projectId` + `folderId`; n8n-mcp has no folder placement. |
| Pin-data testing | **Official** | `prepare_test_pin_data` + `test_workflow`; n8n-mcp has no pin-data prep surface. |
| Data tables CRUD | ≈ Tie | Official has a 7-tool suite; n8n-mcp has `n8n_manage_datatable` (CRUD + filter + dryRun). |
| Native in-instance integration / no API token (self-host) | **Official** | Runs inside n8n; instance-scoped auth, optional preview UI. n8n-mcp self-host passes an API key (SaaS users do not). |

**Strategic read:** the official MCP is strongest for authoring and iterating on **built-in-node** workflows inside one n8n account, and it is closing the iteration-cost gap. n8n-mcp is strongest where the work touches the **ecosystem** — templates, community/custom nodes, credentials, audit, version history, fleets — and for **surgical edits to large fields**.

---

## 2. Methodology and reproducibility

This refresh used three evidence streams, all dated 2026-06-18/19:

1. **Live head-to-head.** The official server was exercised directly via its connected MCP tools (`search_nodes`, `get_node_types`, `validate_workflow`, `get_sdk_reference`, `update_workflow` schema, `search_workflows`) against its live n8n instance. n8n-mcp was exercised against its live staging instance (`n8n-test.n8n-mcp.com`). Validator probes and a token-cost build were run on both.
2. **Source analysis.** The n8n monorepo was cloned (sparse: `packages/cli/src/modules/mcp`, `packages/@n8n/workflow-sdk`, `packages/@n8n/ai-workflow-builder.ee`, `packages/@n8n/db`, `packages/@n8n/config`) at master HEAD (`package.json` version **2.27.0**, 2026-06-18). All official-side claims about op types, validation internals, tool registration, and gating are cited to specific files/lines in that tree.
3. **Telemetry context.** The usage-pattern figures in §3.4 are carried forward from the 2026-04-30 telemetry pull and are explicitly dated; they were **not** re-queried for this edition. They are used only to establish that iteration dominates usage — not to project a counterfactual dollar figure against the official server (see §3.4 for why that projection was retired).

**A note on the shipped-vs-source split.** The most important methodological point in this edition: the live stable server and the source tree disagree. The diff-based `update_workflow`, `validate_node_config`, and the 30-tool surface are present in **2.27.0 source** but **not** in the stable build the live server runs (still 25 tools, full-code update, no single-node validation). Where this document says "shipped" or "live", it means the stable channel verified directly; where it says "2.27.0 / source / imminent", it means the pre-release tree. The exact stable-ship date of the diff update cannot be established from a shallow clone and is not yet in any tag.

If you find a factual error or want to challenge a measurement, please open an issue or PR.

---

## 3. The update problem: shipped vs imminent

### 3.1 Shipped (stable) — still full-rewrite (live-verified)

The connected official server's `update_workflow` accepts only full SDK code:

> `update_workflow({ workflowId, code })` — *"Update an existing workflow in n8n from validated SDK code. Parses the code into a workflow and saves the changes."*

To measure the cost, a 9-node workflow was authored as SDK code, validated (`{valid:true, nodeCount:9}`), then edited by inserting one node mid-flow:

| Edit: "add one node mid-flow" (9→10 nodes) | Payload the agent must emit |
|---|---|
| **Official `update_workflow`** (full SDK code resend) | **1,715 chars** (the change itself is only 154) |
| **n8n-mcp `n8n_update_partial_workflow`** (diff) | **~492 chars** (4 ops, flat regardless of size) |

n8n-mcp's diff payload is flat as the workflow grows; the official full-code payload scales with workflow size. Measured n8n-mcp CREATE vs partial-update payloads on staging:

| Workflow size | n8n-mcp CREATE (JSON) | n8n-mcp partial-update (ops) |
|---|---|---|
| 4 nodes | 1,320 chars | 561 chars |
| 15 nodes | 5,295 chars | 556 chars |
| 30 nodes | 10,795 chars | 550 chars |

Since the official full-code update payload tracks the workflow's full program size, the per-edit ratio on the stable channel today is ~3.5× at 9 nodes, climbing toward ~10× at 15 nodes and ~20× at 30 nodes — consistent with the April finding, and **live-verified for the build users currently run.**

### 3.2 Imminent (n8n 2.27.0 source) — diff-based, near-parity for built-in edits

In master, `update_workflow` is a diff tool:

- **14 operation types**: `updateNodeParameters, setNodeParameter, addNode, removeNode, renameNode, addConnection, removeConnection, setNodeCredential, setNodePosition, setNodeDisabled, setNodeSettings, setWorkflowMetadata, addTags, removeTags` (`update-workflow.tool.ts:37-52`).
- **Atomic, max 100 ops/call**; first failing op aborts the batch, nothing saved (`update-workflow.tool.ts:35,178-184`; `workflow-operations.ts:397-401`).
- **Applied to stored JSON**, not SDK code: `applyOperations(toWorkflowSlice(existingWorkflow), strictOperations)` (`update-workflow.tool.ts:310-317`). The end state is graph+JSON-validated and returns `validationWarnings`.
- **Docstring**: *"The agent emits a tiny diff per call instead of re-sending the full SDK code, which keeps output-token cost roughly constant per edit"* (`update-workflow.tool.ts:228-237`).

Once this ships, the raw per-edit token gap for built-in-node, whole-value edits effectively closes. **Note the asymmetry:** `create_workflow_from_code` remains SDK-TypeScript-only — the SDK now lives on the create path while update moved to JSON ops.

### 3.3 The advantage that survives parity: surgical in-field edits

n8n-mcp's `patchNodeField` does **string find/replace inside a single field** (`patches: [{find, replace, replaceAll?, regex?}]` on a dot path like `parameters.jsCode`; `src/services/workflow-diff-engine.ts:1009-1013`). Changing one line of a large Code node sends only the changed snippet — measured at **151 chars** for a `version: '1.0'` → `'2.0'` edit on staging.

The official `setNodeParameter` (both shipped and in 2.27.0 source) is an RFC 6901 JSON Pointer set: it writes the **entire value** at the pointer and explicitly **does not support array indices** — *"Array indices are NOT supported — to change a value inside an array, set the whole array"* (`workflow-operations.ts:42-47,285`). There is no find/replace anywhere in the official op set. So editing one line of a large `jsCode` requires re-sending the whole field value even after 2.27.x ships. This was confirmed adversarially against both source trees.

n8n-mcp also carries **19 ops vs 14**, plus `validateOnly` (dry-run) and `continueOnError` modes the official tool lacks (it is always atomic-or-throw). Notable additional capabilities vs the official op set include `patchNodeField`, `rewireConnection`, `cleanStaleConnections`, and `replaceConnections` (plus `validateOnly`/best-effort modes).

### 3.4 Why iteration matters (usage context, 2026-04-30 telemetry — not re-queried)

*The figures below are dated 2026-04-30 and are carried forward unchanged; they establish that iteration dominates real usage. They are aggregate and anonymized per the [privacy policy](../PRIVACY.md).*

- **6.21:1 update-to-create ratio** across 84,034 users in 90 days — iteration, not greenfield authoring, is the dominant pattern.
- **89.2% of update calls** go through the diff-based partial tool when users have the choice.
- Real workflow sizes cluster where diffs matter: **mean 23.4 nodes**, p90 51, p99 123.

**Retired claim.** The April edition projected ~$601k/quarter in avoided output-token cost versus the official server, on the premise that the official path always full-rewrites. That premise expires when 2.27.x ships, so the headline dollar projection is withdrawn. The defensible residual cost argument is now narrower: (a) it holds on the **stable channel today**, and (b) it persists indefinitely only for **large-field / Code-node / array edits** via `patchNodeField`. Anyone re-running the cost analysis should scope it to those two cases and re-query telemetry rather than reuse the old figure.

---

## 4. Architecture & transport (official, 2.27.0 source)

- **Location:** `packages/cli/src/modules/mcp/` (mounted on the `main` instance).
- **Endpoint:** `/mcp-server/http` with HEAD/GET/POST (`mcp.controller.ts:29,77,110`).
- **Transport:** stateless Streamable HTTP — a fresh `McpServer` + transport per request (`sessionIdGenerator: undefined`, `mcp.controller.ts:200-206`).
- **Auth:** Bearer token routed by a JWT `meta.isOAuth` flag to either OAuth access-token verification or MCP API-key verification (`mcp-server-middleware.service.ts:39-60`). HEAD returns `401` with `WWW-Authenticate: Bearer` for discovery. CORS is wide-open (`*`).
- **Server identity:** name `n8n MCP Server`, version bumps to **1.1.0** when the builder is enabled (`mcp.service.ts:204-213`).
- **Resources:** one MCP resource, `n8n://workflow-sdk/reference` (builder path only). When `N8N_MCP_APPS_ENABLED` (default false) is on, a workflow-preview MCP-App iframe is attached to `create_workflow_from_code` (`mcp.service.ts:475-500,554-571`).

n8n-mcp by contrast ships a standalone MCP server (stdio + single-session HTTP with persistent session state) plus a multi-tenant SaaS (OAuth2/Auth0, AES-256-GCM-encrypted per-instance credentials so users never expose their n8n API key to the AI client).

---

## 5. The TypeScript Workflow SDK

The SDK is the codegen engine behind the official create path. It matured from 0.12.x to 0.20.0 over ~9 roughly-weekly minors (npm `time` object: 0.12.0=2026-04-28 … 0.19.2=2026-06-15 (`latest`), 0.20.0=2026-06-16, not yet `latest`).

- **Authoring (unchanged in spirit):** the LLM writes `workflow('id','name').add(trigger).to(node...)` with `node()/trigger()/ifElse()/switchCase()/merge()/splitInBatches()` and AI subnode binding by reference (`subnodes: { model, tools, memory, outputParser }`). Type-checked authoring for built-in nodes via `get_node_types` (real `.d.ts`); auto-layout via `@dagrejs/dagre`.
- **What's new:** full **bidirectional round-trip codegen** (`json-to-code` and `code-to-json` CLIs with dedicated roundtrip test suites) and composite control-flow handlers (if-else, switch-case, splitInBatches/merge). Round-trip is the mechanism behind "update existing workflows" — and behind the 2.27.x move of update onto JSON ops.
- **What it still gives up:** community-node typing (SDK type generation reads only `nodes-base` and `@n8n/nodes-langchain`, `generate-types.ts:6-8,40-44`); and the AST-interpreter foot-guns remain (reserved JS identifiers like `fetch` rejected as "Security violation").

---

## 6. Validation

### 6.1 Live probes against the stable official validator

Five invalid configurations were sent to the official `validate_workflow` and to n8n-mcp's `validate_workflow` (profile `runtime`):

| Probe | Official (live, stable) | n8n-mcp (live) |
|---|---|---|
| Unknown node type (`totallyMadeUpNode`) | **`valid:true`** (silent) | **ERROR** — "Unknown node type … must include the package prefix" |
| `typeVersion: 99` on httpRequest | **`valid:true`** (silent) | **ERROR** — "typeVersion 99 exceeds maximum supported version 4.4" |
| HTTP Request without `url` | **`valid:true`** (silent) | **ERROR** — "Required property 'URL' cannot be empty" |
| Two nodes with the same name | **`valid:true`** (silent) | **ERROR** — "Duplicate node name" |
| AI Agent without language model | **`valid:true`** + 3 warnings (incl. "Required field subnodes is missing") | **ERROR** — `MISSING_LANGUAGE_MODEL` |

Four of five pass silently as `valid:true`; the fifth is `valid:true` with warnings. An agent loop using `valid:true` as its stop signal accepts all five broken workflows as done. n8n-mcp errors on all five.

### 6.2 What 2.27.0 source changes

- **Single-node validation now exists:** `validate_node_config` validates 1–50 candidate node configs against the generated Zod schema in isolation (`validate-node.tool.ts:38-44,85,107-115`). The April "no single-node validation" gap is closed (schema-level only; no graph/credential checks; built-in nodes only).
- **Structured result:** `validate_workflow` returns `{valid, errors, warnings}`; hard parse/schema failures now yield `valid:false` (`validate-workflow-code.tool.ts:105-112,129-132`).
- **Expanded taxonomy:** ~33 error/warning codes with `violationLevel` (critical/major/minor); new structural checks (Switch outputs/fallback, Merge `numberInputs`, input/output index validity, invalid `ai_tool` source, placeholder slots). AI-Agent-without-LM is a **hard error** (`MISSING_REQUIRED_INPUT`).
- **But two April findings persist even in source:** (1) Zod config errors are still downgraded to warnings with the verbatim comment *"Report as WARNING (non-blocking) to maintain backwards compatibility"* (`workflow-sdk/src/validation/index.ts`) — a broken node config can still be `valid:true`. (2) The richest structural checks are gated on a `nodeTypesProvider` that the MCP partial-update `validateJSON` path does not supply, so on that path unknown node types and invalid typeVersions still pass via the `loadSchema` graceful fallback.

### 6.3 n8n-mcp validation edge

- **4 named profiles** (`minimal`, `runtime`, `ai-friendly`, `strict`) vs one un-exposed `strictMode` boolean.
- **By-ID validation** (`n8n_validate_workflow`) and **autofix** (`n8n_autofix_workflow`, 13 fix types) — the official server reports warnings but never repairs.
- **Schema errors are real errors**, not silent warnings; **community nodes are validated** (the official server treats no-schema nodes as `valid:true`).

### 6.4 Where the official validator is genuinely strong

Field-level expression-path validation against upstream `output:` samples and `INVALID_INPUT_INDEX` with concrete fix suggestions remain clever patterns n8n-mcp does not fully replicate; the SDK error messages are high quality and speak the SDK syntax directly.

---

## 7. Tool inventory

The stable server exposes **25 tools**; the 2.27.0 source tree registers **30** (18 always-on + 12 builder-only, `mcp.service.ts:216-576`). New since the April 25-tool count: a 7-tool data-table CRUD suite, `search_executions`, `get_execution`, `prepare_test_pin_data`, plus builder tools `explore_node_resources`, `get_workflow_best_practices`, and `validate_node_config`.

| Capability | Official | n8n-mcp |
|---|---|---|
| **Discovery** | | |
| Search nodes | `search_nodes` (instance registry) | `search_nodes` (FTS5, OR/AND/FUZZY, source filter) |
| Node detail | `get_node_types` (`.d.ts`, built-ins only) | `get_node` (info/docs/search_properties/versions/compare/breaking/migrations) |
| Suggest nodes | — (constant defined, not registered) | `search_templates` mode `patterns` |
| SDK reference | `get_sdk_reference` + resource | n/a — no SDK |
| **Authoring** | | |
| Create | `create_workflow_from_code` (SDK code) | `n8n_create_workflow` (JSON) + `n8n_generate_workflow` (NL, hosted) |
| Update full | n/a (update is the diff/code tool) | `n8n_update_full_workflow` (JSON) |
| **Update partial** | ✅ 2.27.0 source (14 ops) / ❌ stable | ✅ `n8n_update_partial_workflow` (19 ops) |
| Validate workflow | `validate_workflow` (single strictMode) | `validate_workflow` (4 profiles) + `n8n_validate_workflow` (by ID) |
| Validate single node | `validate_node_config` (2.27.0 source) | `validate_node` |
| Autofix | ❌ | `n8n_autofix_workflow` |
| **Lifecycle** | | |
| Drafts/publish | `publish_workflow` / `unpublish_workflow` | n/a — `active` flag |
| Archive / delete | `archive_workflow` (soft) | `n8n_delete_workflow` |
| Version history | ❌ | `n8n_workflow_versions` (list/get/rollback/delete/prune) |
| **Execution** | | |
| Execute / test | `execute_workflow`, `test_workflow` | `n8n_test_workflow` |
| Executions | `get_execution`, `search_executions` | `n8n_executions` |
| Pin-data prep | `prepare_test_pin_data` | ❌ |
| **Org / structure** | | |
| Projects / folders | `search_projects` / `search_folders` | projectId only; no folders |
| Data tables | 7 dedicated tools | `n8n_manage_datatable` (CRUD + filter + dryRun) |
| **Operations** | | |
| Health check | ❌ | `n8n_health_check` |
| Templates | ❌ | `search_templates` + `get_template` + `n8n_deploy_template` (2,700+) |
| Credentials | read-only `list_credentials` + auto-assign | `n8n_manage_credentials` (CRUD + getSchema + includeUsage) |
| Instance audit | ❌ | `n8n_audit_instance` |

---

## 8. Workflow management

### 8.1 Drafts/publish, projects/folders, pin-data (official advantages — still hold)

`publish_workflow` / `unpublish_workflow` operate the draft/publish model in `WorkflowEntity`; `create_workflow_from_code` accepts `projectId` + `folderId`; `prepare_test_pin_data` returns JSON Schemas for pin-data so logic nodes run for real while credentialed/external I/O is bypassed. n8n-mcp has none of these surfaces (folder placement is deferred).

### 8.2 Credentials — two trust models (unchanged)

The official server walks each added node's credential slots and auto-assigns the user's first matching credential, **excluding HTTP Request node types for security** (`credentials-auto-assign.ts:19-23`); `list_credentials` is read-only and never returns secrets. The LLM has no credential CRUD. n8n-mcp takes the opposite approach: full visibility via `n8n_manage_credentials` (list/get/create/update/delete/getSchema), explicit selection between multiple credentials of a type, and HTTP nodes as first-class — appropriate to its standalone-server architecture where the agent operates with the user's API key.

---

## 9. Distribution & gating (official, 2.27.0 source)

| Flag | Default | Effect |
|---|---|---|
| `N8N_MCP_ACCESS_ENABLED` | `false` | Master switch (instance MCP access) |
| `N8N_MCP_MANAGED_BY_ENV` | `false` | Env-only management (cloud managed mode) |
| `N8N_MCP_BUILDER_ENABLED` | `true` | Toggles the 12 builder-only tools |
| `N8N_MCP_APPS_ENABLED` | `false` | Force-enables the MCP-App preview iframe |
| `N8N_MCP_MAX_REGISTERED_CLIENTS` | `5000` | OAuth client cap |
| `N8N_MCP_SERVER_RATE_LIMIT` | `100` | Requests / IP / 5 min |
| `settings.availableInMCP` (per workflow) | `false` | Workflows must opt in to MCP |

Source: `packages/@n8n/config/src/configs/endpoints.config.ts:162-175`, `instance-settings-loader.config.ts:117-121`, `mcp.config.ts:11-12`.

---

## 10. Empirical artifacts from this analysis (2026-06-18/19)

**Live, official server (stable channel):**
- `update_workflow` tool schema = `{ workflowId, code }` (full SDK code) — full-rewrite confirmed.
- 9-node SDK workflow: validated `{valid:true, nodeCount:9}`; CREATE code 1,561 chars; full resend to add one node = 1,715 chars (change itself 154 chars).
- Validator probes: unknown node, typeVersion 99, HTTP-without-URL, duplicate name → `valid:true` (silent); AI-Agent-without-LM → `valid:true` + 3 warnings.
- Community nodes: `search_nodes(["playwright"])` → "No nodes found"; `get_node_types(["n8n-nodes-playwright.playwright"])` → "not found"; `get_node_types(["n8n-nodes-anchorbrowser.anchorBrowser"])` → "not found" **even though that node is installed** (search surfaced it under "browser automation"). Confirms: official can discover installed community nodes but cannot type/validate them.

**Live, n8n-mcp staging (v2.59.0):**
- `n8n_update_partial_workflow` advertises 19 op types; atomic by default, `continueOnError` + `validateOnly` modes.
- CREATE vs partial-update payloads: 1,320/561 (4 nodes), 5,295/556 (15), 10,795/550 (30).
- 4-edit cumulative on a 15-node workflow: 492 + 151 + 184 + 273 = 1,100 chars / 11 ops; the `patchNodeField` one-line edit was 151 chars.
- Validator probes: all 5 ERROR (`valid:false`) with precise messages.
- Community node: `search_nodes("playwright")` returns the node (community, v0.2.21, 10k npm downloads, full schema).

**Source (n8n 2.27.0 clone, master, 2026-06-18):** diff-based `update_workflow` (14 ops, 100 cap, atomic), `validate_node_config`, 30-tool surface, ~33 validation codes, SDK 0.20.0 round-trip codegen — none yet in a release tag.

---

## 11. Source citations

**Official MCP (n8n monorepo, master @ 2.27.0, 2026-06-18 clone):**
- `packages/cli/src/modules/mcp/mcp.service.ts` (tool registration; server identity; resources)
- `packages/cli/src/modules/mcp/tools/workflow-builder/{update-workflow.tool,workflow-operations,create-workflow-from-code.tool,validate-node.tool,validate-workflow-code.tool,credentials-auto-assign}.ts`
- `packages/cli/src/modules/mcp/tools/list-credentials.tool.ts`
- `packages/cli/src/modules/mcp/{mcp.controller,mcp-server-middleware.service,mcp.config}.ts`
- `packages/@n8n/workflow-sdk/{package.json,src/validation/index.ts,src/generate-types/generate-types.ts}`
- `packages/@n8n/config/src/configs/{endpoints.config,instance-settings-loader.config}.ts`

**Official live observations:** the connected official MCP server's tool schemas and responses (`update_workflow`, `validate_workflow`, `search_nodes`, `get_node_types`, `get_sdk_reference`, `search_workflows`), 2026-06-18.

**External:**
- npm: `registry.npmjs.org/@n8n/workflow-sdk` (0.12.0 → 0.20.0; `latest` 0.19.2) and `n8n` (`latest` 2.26.7)
- Blog: `blog.n8n.io/n8n-mcp-server` (frames update as conversational full re-generation; no diff/partial messaging)
- Community: `community.n8n.io/t/create-workflows-via-mcp/280856` (create+update shipped in n8n 2.14.0 beta)

**n8n-mcp side:**
- `src/services/workflow-diff-engine.ts` (partial-update engine; `patchNodeField` at 1009-1013)
- `src/types/workflow-diff.ts` (`PatchNodeFieldOperation`, 58-69)
- `src/mcp/tools.ts`, `src/mcp/tools-n8n-manager.ts` (full tool surface; credentials, audit, templates)
- `PRIVACY.md` (telemetry policy)

**Telemetry sources (queried 2026-04-30, not refreshed for this edition):** landing-page aggregates and daily tool-usage aggregates as cited inline in §3.4.
