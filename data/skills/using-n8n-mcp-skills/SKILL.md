---
name: using-n8n-mcp-skills
description: "Use when building, editing, validating, testing, or debugging an n8n workflow through the n8n-mcp MCP server — designing a flow, configuring a node, writing an expression or Code node, wiring credentials, or fixing one that misbehaves. The entry-point skill for the n8n-mcp-skills pack: it routes you to the right specialist skill, gives working knowledge of every n8n-mcp tool from turn one, and states the rules that keep workflows from breaking in production. Always consult it first on any n8n, workflow, node, or automation task — even a quick one-off, and even when the user names no skill — because n8n's surface drifts between versions and the specialist skills prevent silent failures."
---

# Using the n8n-mcp Skills

This is a **router**, not a reference. It tells you which skill owns the rules for what
you're about to do. The skill bodies hold the actual guidance — invoke them with the
Skill tool. When in doubt, load more skills rather than fewer.

The community **n8n-mcp** server and n8n itself move faster than any model's training
cutoff. Tool names, parameters, node `typeVersion`s, and default behaviors drift between
releases. When you spot drift — a tool a skill names doesn't exist, a parameter shape
doesn't match what `get_node` returns, behavior differs from what a skill describes —
trust the **live tool**, tell the user, and suggest updating the pack and the instance.

## Non-negotiables

Three rules with no exceptions. Each one prevents a class of workflow that looks correct
but breaks in production.

1. **Invoke the relevant skill before any n8n action** — not just before MCP calls.
   Before writing an expression, configuring a node, designing a workflow, wiring a
   connection, or writing Code, invoke the matching skill. PreToolUse hooks remind you on
   the highest-impact tool calls, but they exist **only in the Claude Code plugin
   install**. Everywhere else — Claude.ai skill uploads, and any client that loads this
   pack as an Agent Plugin (Codex, Cursor, Copilot and the rest) — nothing nudges you and
   it's on you. Assume you are un-hooked unless you have seen a
   hook fire this session.
2. **Validate AND verify before activating.** Run `validate_workflow` (or
   `n8n_validate_workflow` by id) before you activate, and call `n8n_get_workflow` after
   every create or update to inspect the `connections` object. Validation alone misses
   silently dropped wires, Merge index off-by-one, and error outputs that were never
   wired. Validation passing means the JSON is well-formed — not that the workflow is
   correct. A green test run isn't proof either: JS errors inside `{{ }}` resolve silently to
   `null` (a Filter with a broken condition drops every item and still shows success), so
   inspect the output values. See `n8n-expression-syntax`.
3. **Secrets never go in text fields.** Tokens, API keys, and passwords always go through
   the n8n credential system. If no native node exists, use the HTTP Request node with
   the official credential type. A Set node holding a token referenced via `{{ $json.token }}`
   is a leak with extra steps. See `n8n-mcp-tools-expert`.

## Lean on skills, not training data

n8n changes constantly. "Remembered" parameter names are often silently wrong — they
validate as plain strings and then do nothing at runtime. If a skill contradicts your
memory, trust the skill. If `get_node` contradicts a skill, trust the
tool and flag the drift.

## Strong defaults

These are the defaults; the Code exceptions below are a closed list.

**Native node first, Code last.** Pick in this order: the service's own node (HTTP Request
only when no node covers the operation), then a native node for the job, then a short
expression inside that node, then Code. A function body or several statements inside
`{{ }}` is code: it belongs in a Code node.

| Job | Use |
|---|---|
| Flag that only picks a route; dropping items | conditions in IF / Switch / Filter |
| Constant, error or return item | Edit Fields (Set) |
| Restore earlier context | `$('Node').item` |
| Pick rows after a Data Table get | the get's order by + limit |
| Group and sum | Summarize |
| Items to one array / array to items | Aggregate / Split Out |
| Join two lists | Merge (combine by fields) |
| Diff or sync two lists | Compare Datasets |
| Dedupe, also across runs | Remove Duplicates |
| Top-N | Sort + Limit |
| Dates | Date & Time, or a Luxon one-liner |
| XML / HTML / Markdown / CSV / XLSX | XML, HTML, Markdown, Extract From File / Convert To File |
| Paging an API (no service node) | HTTP Request's pagination option |
| Throttle calls | HTTP Request's batching option, or Loop + Wait |
| Hash, HMAC, UUID | Crypto (+ Webhook raw body) |

Code is right only for: loops or recursion no node expresses, state across runs, parsing no
node handles, libraries, heavy all-items work on queue-mode workers (thousands of items,
stated or measured), or one short Code node (~15 lines) replacing 4+ glue nodes that only
reshape data. Every Code or HTTP Request node that stays gets the note
`Why Code: <native node considered> — <reason>` (or `Why HTTP:`). See
`n8n-node-configuration` and `n8n-code-javascript`.

- **A Set that only re-maps fields for the next node is the antipattern.** Put those
  expressions in the next node. Edit Fields as a named step is fine. See `n8n-expression-syntax`.
- **Per-item iteration is automatic.** Don't add a Loop Over Items node to "make it loop"
  when default per-item execution already handles the case.
- **Configure from the live schema, never from memory.** `get_node` before you set
  parameters. See `n8n-node-configuration`.

## Red flags: "about to ___" → invoke ___

If you catch yourself thinking any of these, stop and invoke the named skill first.

| Thought | Invoke |
|---|---|
| "This workflow is simple, I'll just build it" | `n8n-workflow-patterns` — most "simple" flows ship at 10+ nodes |
| "I'll add a Set node to map these fields" | `n8n-expression-syntax` — a Set that only re-maps for the next node is the antipattern; named steps are fine |
| "I'll just use a Code node, it's easier" | the job table above, then `n8n-code-javascript` — Code only for the closed list, with a `Why Code:` note |
| "The user mentioned data, I'll write Python" | `n8n-code-javascript` — default JS; Python (`n8n-code-python`) only on explicit ask |
| "I'm writing code an AI agent will call" | `n8n-code-tool` — a different runtime contract from the Code node |
| "I'll call this API with HTTP Request" | `n8n-mcp-tools-expert` — `search_nodes` for the service's own node first; a kept HTTP node gets `Why HTTP:` |
| "I'll wire a Merge with 3 sources" | `n8n-node-configuration` — Merge defaults to 2 inputs (`numberInputs`); the 3rd silently drops |
| "Validation passed, I'm ready to activate" | `n8n-validation-expert` + `n8n-workflow-patterns` — run the antipattern scan |
| "Validation threw an error I don't understand" | `n8n-validation-expert` — what each error and warning means, and which are must-fix vs. best-practice advice |
| "I'll reference `$json.x` here" | `n8n-expression-syntax` — prefer `$('Node').item.json.x` in branchy workflows |
| "This webhook/scheduled flow is happy-path only" | `n8n-error-handling` — wire an error branch on every fallible node; 4xx caller faults, 5xx yours |
| "I'll pass this file/image through as JSON" | `n8n-binary-and-data` — file contents live in `$binary`, and can't cross the agent-tool boundary |
| "I'll wire up an AI agent and give the model some tools" | `n8n-agents` — tool names & descriptions ARE the prompt; memory, structured output, and topology have traps |
| "I'll copy this logic into another workflow" / "this is getting big" | `n8n-subworkflows` — extract a reusable sub-workflow; search before building |
| "I'll create that credential / open that workflow" (account has >1 instance) | `n8n-multi-instance` — name the target with `instance: "<name>"`; unnamed calls hit a default other chats can move |

## Skill index

| Skill | Reach for it when |
|---|---|
| `using-n8n-mcp-skills` | This router (auto-loaded). Names the skill that owns your task. |
| `n8n-mcp-tools-expert` | Choosing or calling any n8n-mcp tool; node discovery; credentials; data tables; security audit; templates |
| `n8n-workflow-patterns` | Designing or building a workflow; picking an architecture (webhook / HTTP API / database / AI agent / scheduled / batch) |
| `n8n-node-configuration` | Configuring any node; operation-aware required fields; property dependencies; surgical field edits |
| `n8n-expression-syntax` | Writing `{{ }}`, `$json`/`$node`/`$now`; mapping data between nodes; the transform gatekeeper; Set-node discipline |
| `n8n-validation-expert` | Interpreting validation errors/warnings; false positives; the validation loop; auto-fix; reviewing an existing workflow |
| `n8n-code-javascript` | Any Code node in JavaScript; data access; `this.helpers`; DateTime; SplitInBatches loop patterns |
| `n8n-code-python` | A Code node specifically requested in Python; native runtime (`_items`/`_item` only, imports blocked by default, legacy `_input` code fails) |
| `n8n-code-tool` | The AI-agent-callable Custom Code Tool (`toolCode`) — returns a string, no `$fromAI`/`$input` |
| `n8n-error-handling` | Webhook/API or unattended workflows; wiring error outputs; retries; 4xx/5xx response shapes; silent failures |
| `n8n-binary-and-data` | Files, images, PDFs, attachments, uploads/downloads, vision; passing a file to/from an agent tool |
| `n8n-subworkflows` | Reusable / multi-step builds; Execute Workflow; extracting shared logic; Define-Below inputs; all-vs-each; exposing a workflow as an agent tool |
| `n8n-agents` | AI Agent / LLM-with-tools / Text Classifier; tool design & `$fromAI`; system prompts; structured output; memory; RAG; human review; chat bots |
| `n8n-multi-instance` | Accounts with several instances (`n8n_instances` present); the per-call `instance` argument; parallel agents; `switch`; credential writes; an unexpected `NOT_FOUND`, wrong/empty reads, `INSTANCE_*` errors |
| `n8n-self-hosting` | *Deployment, not workflow-building* — self-hosting / installing / deploying n8n on a VM (Docker Compose + Caddy, single vs queue mode), or updating / backing up / hardening it. Triggers on its own; not part of the build flow above. |

## n8n-mcp tools — working knowledge from turn one

Qualified names look like `mcp__<server>__<tool>` (`<server>` is usually `n8n-mcp`).

**Two tiers, and how to tell which one you have.** The documentation and validation tools
below work offline and are always present. The `n8n_*` management tools talk to a live n8n
instance and appear **only once one is connected**. If they are absent, nothing is broken
and nothing needs a retry — say so and point the user at the fix for their install:

- **Hosted (`https://api.n8n-mcp.com/mcp`)** — sign in through the client's OAuth prompt on
  first use, then connect the n8n instance in the dashboard. No env vars or API keys in config.
- **Self-hosted (`npx n8n-mcp`, Docker)** — the server needs `N8N_API_URL` and
  `N8N_API_KEY` in its environment, exported before the client starts.

`n8n_health_check` confirms a working connection and returns the resolved instance.

**Discovery & docs**
- `tools_documentation` — meta-docs for every tool; `{topic, depth:"full"}` with `ai_agents_guide` or (n8n-mcp 2.97+) `expression_helpers`.
- `search_nodes` — find nodes by keyword.
- `get_node` — node info. Takes a single **SHORT-form** `nodeType` (`nodes-base.httpRequest`, `nodes-langchain.agent`), plus `detail` (minimal/standard/full) and `mode` (info/docs/search_properties/versions).
- `validate_node` — validate one node's config in isolation (profiles: minimal/runtime/ai-friendly/strict).
- `search_templates` / `get_template` — the template library (by keyword, nodes, task, metadata).

**Build & edit**
- `n8n_create_workflow` — create from full workflow JSON.
- `n8n_update_partial_workflow` — incremental diff ops (`{id, operations:[…]}`): addNode, updateNode, patchNodeField, addConnection, setNodeGroups, activateWorkflow, etc. Preferred for edits.
- **Canvas groups** (n8n 2.28+) survive your edits; adjustments show in `details.warnings`. Create or change them with the `setNodeGroups` op. See `n8n-mcp-tools-expert`.
- `n8n_update_full_workflow` — full replacement.
- `n8n_autofix_workflow` — auto-fix common issues.
- `n8n_deploy_template` — deploy a template to the instance.

**Validate** (necessary, not sufficient — always pair with the antipattern scan)
- `validate_workflow` — full JSON in, errors/warnings/fixes out. Node types here are **LONG form** (`n8n-nodes-base.set`).
- `n8n_validate_workflow` — validate a deployed workflow by `{id}` (no node JSON to inspect).

**Inspect & lifecycle**
- `n8n_get_workflow` — fetch a workflow (full / structure / active / filtered / minimal). Use it to verify `connections` after edits; `mode="filtered"` + `nodeNames` reads one heavy node without pulling a whole workflow that can truncate client-side.
- `n8n_list_workflows` — list/filter (search before duplicating logic).
- `n8n_delete_workflow`; `n8n_workflow_versions` (history/rollback/diff; `source: "native"` includes UI edits); `n8n_instances` (multi-instance accounts only; every n8n tool also takes a per-call `instance` name — see `n8n-multi-instance`); `n8n_health_check` (resolved `instanceName`, plus `officialMcp`: is the instance-level server below reachable).

**Test & run**
- `n8n_test_workflow` — runs real nodes (Code, HTTP, DB writes, sends all fire). Ask the user before running when side effects exist. `method` picks the path: `auto` (default) and `trigger` fire a webhook/form/chat trigger over HTTP on an **active** workflow; `prepare`/`pinned`/`direct` go through n8n's own MCP server and run workflows with no HTTP trigger (Manual, Schedule, sub-workflow) — see `n8n-mcp-tools-expert`.
- `n8n_executions` — list/inspect executions. **There is no `execute_workflow` tool.**
- `n8n_evaluations` — evaluation runs, metrics and per-case results (n8n ≥ 2.30); `run`/`cancel` (≥ 2.32). `run` fires real nodes across the whole dataset, so ask the user first. For a 403, see `n8n-mcp-tools-expert`.

**Data, folders, variables, credentials, audit**
- `n8n_manage_datatable` — Data Table CRUD, filtering, dry-run. `addColumn`/`deleteColumn`/`renameColumn` change an existing table's columns (the Public API cannot) through n8n's MCP server — `deleteColumn` drops the column's values along with it.
- `n8n_manage_folders` — folder CRUD (n8n ≥ 2.19). Place workflows with `parentFolderId` or the `moveToFolder` op; verify via the folder's `get` counts, not the workflow. `delete` without `transferToFolderId` ARCHIVES the folder's workflows. See `n8n-mcp-tools-expert`.
- `n8n_manage_variables` — instance variables that workflows read as `{{ $vars.KEY }}` (needs a license that includes Variables; 403 otherwise, not retryable). `update` with `value: ""` is ignored — use `clearValue: true`. See `n8n-mcp-tools-expert`.
- `n8n_manage_credentials` — credential CRUD + `getSchema` discovery.
- `n8n_audit_instance` — security audit (hardcoded secrets, unauthenticated webhooks, error-handling gaps).

**Instance-level MCP server** — a second endpoint alongside the Public API, gated on `N8N_MCP_ACCESS_TOKEN` (n8n 2.34+). `n8n_health_check` reports whether it is reachable; without it these calls answer `NOT_CONFIGURED`.
- `n8n_manage_agents` — persisted n8n **Agents**: a standalone assistant artifact with its own lifecycle (model, instructions, skills, tasks, memory, channels), **not** the AI Agent workflow node. `call` runs it live with real credentials and may return `approvals[]`; `publish` only when the user asks. See `n8n-agents`.
- `n8n_explore_node_resources` — resolve a node's live dropdown / resource-locator values through a real credential instead of guessing an ID. See `n8n-node-configuration`.
- `n8n_list_catalog` — list `projects` (to get a `projectId`) or `tags`. The one tool here that also works without the token.
- The same server backs `n8n_test_workflow` `prepare`/`pinned`/`direct`, `source: "native"` versions and Data Table column actions, gated per workflow: `WORKFLOW_NOT_EXPOSED` means "Available in MCP" is off, and turning it on (`exposeToMcp: true`) is a persistent change — ask the user first.

> **Node-type form trap:** `get_node` / `validate_node` take SHORT form (`nodes-base.set`);
> workflow JSON inside `validate_workflow` / `n8n_create_workflow` uses LONG form
> (`n8n-nodes-base.set`). Mixing them is a common, silent mistake — see `n8n-mcp-tools-expert`.

## The protocol, in order

1. Recognize the matching skill from the index and **invoke it before the first MCP call**.
2. Skim `tools_documentation` once per session to refresh the tool surface if you're unsure.
3. `get_node` before configuring any node — read the live schema, don't assume.
4. Build / edit, then **`validate_workflow` before activating** and **`n8n_get_workflow` after** to check `connections`.
5. Surface any drift you notice (missing tool, changed parameter, diverging behavior).

## When in doubt

- **Can't find a workflow the user built in the UI?** The most common cause is per-workflow
  MCP access being off. Ask them to open it in n8n, go to Settings, and enable MCP access.
- **User says it's broken?** Believe them. Re-check parameters against `get_node`, trace
  data references, inspect the execution. See `n8n-validation-expert`.
- **No skill fits and the task is non-trivial?** Ask before guessing.

These are opinionated best practices, not laws. Disagree with a call? It's all markdown —
edit the skill.
