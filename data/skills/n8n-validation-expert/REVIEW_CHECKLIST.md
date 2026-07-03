# Workflow Review Checklist

A severity-tiered audit for reviewing an **existing** n8n workflow — yours or anyone's. This is different from the validate-as-you-build loop in the main skill: that loop catches schema and shape errors with `validate_node` / `validate_workflow`; this checklist catches the silent issues those tools pass clean — antipatterns, security holes, broken-but-valid connections, and missing error paths.

## How to use

Pull the workflow first, then walk the list top to bottom. For each item, inspect the actual JSON and decide if it applies. Report findings grouped by severity, each pointing at the canonical skill for the *why* and the *fix*.

**You're reviewing JSON, not source.** `n8n_get_workflow` returns nodes (with `parameters`, `credentials`, `type` strings like `nodes-base.httpRequest`) and a `connections` graph. Phrase findings in JSON terms: "node `Route order` has no `parameters.options.fallbackOutput`, so unmatched items drop."

> Bare **NODE_FAMILY_GOTCHAS.md** references in the lists below all point to [n8n-node-configuration/NODE_FAMILY_GOTCHAS.md](../n8n-node-configuration/NODE_FAMILY_GOTCHAS.md).

| Severity | Meaning | Action |
|---|---|---|
| **MUST FIX** | Ship-blocker: security hole, broken connection, production-breaking bug. | If the workflow is active, stop it; fix before re-enabling. |
| **SHOULD FIX** | Real issue: antipattern, missing error handling on a production path, broken contract. | Fix in the next change. |
| **NICE TO HAVE** | Polish: naming, descriptions, readability. | Clean up opportunistically. |

> A review agent should **not** auto-fix MUST FIX items without user confirmation — security and connection changes have blast radius. Surface the finding, propose the fix, wait for approval.

## Contents

- [Cross-cutting first](#cross-cutting-first)
- [MUST FIX](#must-fix)
- [SHOULD FIX](#should-fix)
- [NICE TO HAVE](#nice-to-have)
- [Reporting findings](#reporting-findings)

---

## Cross-cutting first

- [ ] **Pull the workflow.** `n8n_get_workflow({ id })` so every check runs on real JSON, not assumptions. Use `structure` mode for a fast graph read, `full` when you need parameters, and `filtered` + `nodeNames` to read a single heavy node (e.g. a long Code node) on a large workflow that would otherwise truncate client-side when fetched whole.
- [ ] **Logic smell test.** Trace the happy path once, top to bottom. Does the structure match the workflow's stated purpose? Anything dead, contradictory, or out of place (a write node in a "read-only" flow, a fan-out branch wired nowhere, an HTTP call to an unrelated domain)? → **n8n-workflow-patterns**
- [ ] **Note the trigger type and whether it's active.** Severity shifts with both: a webhook/API or unattended schedule needs error paths a manual run doesn't, and an active workflow with broken connections is higher severity.

---

## MUST FIX

### Credentials and secrets
- [ ] **Tokens / API keys / passwords in node text fields** (`Bearer xxx`, `sk-...` typed into an HTTP header value, a query param, or any parameter). The credential system is the only correct home. Use `n8n_manage_credentials` to inspect/migrate. → **n8n-mcp-tools-expert** (credential management)
- [ ] **Secrets stored in Set node values** for later `{{ $json.token }}` referencing. The secret is in the workflow JSON regardless of how it's read. → **n8n-mcp-tools-expert**
- [ ] **Hardcoded credentials inside Code nodes.** Same leak surface as text fields. → **n8n-code-javascript** / **n8n-code-python** (anti-patterns)
- [ ] **Placeholder credential IDs** (`"id": "REPLACE_ME"`) left in the `credentials` block. n8n renders a permanently disabled selector for unknown IDs. Omit the block when the real ID is unknown. → **n8n-node-configuration**

> Run `n8n_audit_instance` to surface hardcoded secrets and unauthenticated webhooks across the instance automatically. → **n8n-validation-expert**

### SQL / query injection
- [ ] **User input interpolated into a query string.** Any DB node with `{{ ... }}` inside `parameters.query` — n8n substitutes it into the SQL *before* the driver binds parameters, so it's an injection vector. Use `$1, $2` placeholders + `parameters.options.queryReplacement` (Postgres/MySQL); object filters for Mongo. → **n8n-node-configuration** → [NODE_FAMILY_GOTCHAS.md](../n8n-node-configuration/NODE_FAMILY_GOTCHAS.md) (Database)

### Connection bugs (valid but broken)
- [ ] **Merge with 3+ sources but `numberOfInputs` still 2.** Third source silently drops. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Merge)
- [ ] **Merge index off-by-one.** `parameters.useDataOfInput` is 1-indexed; the wire sits at `connections.<source>.main[N-1]`. Mismatch passes through the wrong source silently. Verify with `n8n_get_workflow`. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Merge)
- [ ] **Error output enabled but unwired, or wired but not enabled.** If `parameters.onError` is `continueErrorOutput` but the node's error output is empty, failed items are silently dropped; if a node feeds an error branch but `onError` isn't set, the branch is unreachable and a failure halts the workflow. `validate_workflow` now surfaces both as warnings (n8n-mcp ≥ 2.63.0), but neither flips `valid:false`, so this stays a review item. **Locate the error output by node type**: it is the *last* `main[]` slot after the node's natural outputs — `main[1]` on a single-output node like HTTP Request, but `main[2]` on an IF (whose `main[1]` is the normal false branch) and similarly on Switch/Split In Batches. Don't mistake a wired second branch on a multi-output node for an unwired error output. → **n8n-validation-expert**

### Switch
- [ ] **No fallback output.** Without `parameters.options.fallbackOutput: "extra"`, unmatched items drop silently. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Switch)

### Webhook API workflows
- [ ] **Webhook performing a sensitive action with `parameters.authentication: "none"`.** "Sensitive" = mutates state, sends external messages, hits production data, triggers paid actions. Anyone with the URL can fire it. Set `authentication` to `basicAuth`/`headerAuth` with a matching credential. → **n8n-workflow-patterns** (webhook), **n8n-mcp-tools-expert** (credentials)
- [ ] **Error branch returns HTTP 200.** `responseCode` defaults to 200 on every Respond node, including error paths. The caller sees success while the body says failure. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Webhook)

---

## SHOULD FIX

### Set-node antipattern
- [ ] **Set node feeding 0 or 1 downstream consumer.** The most common antipattern. Delete it and inline the expression at the consumer. Exceptions: 2+ consumers of a non-trivial derived value, or a sub-workflow's final Return node. → **n8n-expression-syntax** ("The Set-node antipattern and branch convergence")
- [ ] **Set node building an email / Slack body.** Build the body inline in the comms node's body field. → **n8n-expression-syntax**
- [ ] **Set node mapping fields right before a write node.** Map directly in the write node's per-field expression slots. → **n8n-node-configuration**
- [ ] **Multiple consecutive Set nodes each defining one field.** Collapse into one, or eliminate. → **n8n-expression-syntax**

### Code-node antipattern
- [ ] **Code node doing pure single-item shaping** (`.map`/`.filter`/`.find`, field rename, optional chaining). Use an expression or an Edit Fields arrow-function IIFE — same result, ~100x faster, more readable. → **n8n-code-javascript** (the transform gatekeeper)
- [ ] **Code node using `crypto.createHash` / `crypto.createHmac`.** Use the native Crypto node (`nodes-base.crypto`). Recurring slip. → **n8n-code-javascript**
- [ ] **Code node parsing XML / SOAP / RSS.** Use the native XML node (`nodes-base.xml`) + Edit Fields for extraction. → **n8n-code-javascript**
- [ ] **Code node + Set node combo** (Set builds inputs, Code transforms). One Edit Fields arrow-function IIFE does both. → **n8n-code-javascript**
- [ ] **Python Code node where JS would do.** JS is recommended for ~95% of cases; reserve Python for its standard-library strengths (regex, hashlib, statistics) when the user asked for it. → **n8n-code-python**

### Expression discipline
- [ ] **`$json.x` deep in a branchy / multi-step workflow.** Switch to `$('Source Node').item.json.x` for refactor stability; the `$json` form breaks silently when an intermediate is inserted or context is cleared. → **n8n-expression-syntax** (non-negotiable)
- [ ] **Branches converge with `$json` references downstream.** Whichever branch fired last wins, non-deterministically. Insert a NoOp (`Combine Inputs`) at the merge and reference it by name; use a Set to normalize if the branch shapes differ. → **n8n-expression-syntax**
- [ ] **DateTime node used for date math/formatting.** Use a Luxon expression inline (`DateTime.fromISO(...).toFormat(...)`). → **n8n-expression-syntax**
- [ ] **`$env.X` in any expression.** Doesn't work, throws at runtime. Use `$vars.X` (paid plans), a Data Table, or a credential for secrets. → **n8n-expression-syntax**
- [ ] **`.all().map()/filter()/reduce()` aggregation without `executeOnce: true`** on the node. It re-runs the full aggregation per input item — wasted work, and N identical outputs where one was expected. (Leave `executeOnce` off when `.all()` is a per-item *lookup* keyed by the current item.) → **n8n-expression-syntax**

### Slack / comms
- [ ] **Block Kit passed as a bare array.** Posts as plain text, silently. Wrap as `={{ { "blocks": ... } }}`. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Slack)
- [ ] **Thread reply posting as a top-level message** — `thread_ts` not set or in the wrong place. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Slack)
- [ ] **Operation set from the UI display name** (`"send"`) rather than the internal value (`"post"`). Confirm with `get_node`. → **n8n-node-configuration**

### Database
- [ ] **`select` / query with no-match path feeding an IF, but `alwaysOutputData` not set.** No match = zero items = the IF never fires. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Database)
- [ ] **Multi-step writes needing atomicity split across nodes.** No cross-node transaction exists; collapse into one `executeQuery` with `options.queryBatching: "transaction"`. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Database)
- [ ] **Write node (INSERT/UPDATE/DELETE) followed by a node expecting its output, without `alwaysOutputData`.** Writes often return 0 items and stall the chain. → **n8n-node-configuration**

### Webhook / Respond to Webhook
- [ ] **`responseMode` left at `onReceived` for a request/response API.** Caller never sees the computed result; use `responseNode`. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Webhook)
- [ ] **Generic 500 for every failure.** Map status codes: 400 validation, 401/403 auth, 409 conflict, 429 rate limit. → **n8n-node-configuration**
- [ ] **`respondWith: "json"` body built with `JSON.stringify(...)`.** Double-encodes. Pass the object literal in expression mode. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Webhook)
- [ ] **Fallible nodes (HTTP/DB/API) on a webhook path with no error branch.** A failure halts the workflow and the caller gets n8n's generic error. Wire `onError: "continueErrorOutput"` + a 5xx Respond, and validate the wiring. → **n8n-error-handling**, **n8n-workflow-patterns** (webhook)

### HTTP Request
- [ ] **Auth header typed into `headerParameters` instead of a credential.** Use Bearer Auth / Header Auth credentials. → **n8n-node-configuration**, **n8n-mcp-tools-expert**
- [ ] **Headers set via both `headerParameters` and a credential's header auth.** They conflict. → **n8n-node-configuration**
- [ ] **Network-calling node (HTTP/comms/DB/AI) without `retryOnFail`.** Transient 429s and blips surface as hard failures. *(Transient-failure handling folds into node config for now.)* → **n8n-node-configuration**

### Schedule trigger
- [ ] **Business-critical schedule with no explicit workflow timezone.** DST and instance moves shift timing. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Schedule)
- [ ] **Schedule-triggered workflow not idempotent.** Restarts can miss runs and re-runs can double-fire. → **n8n-node-configuration** → NODE_FAMILY_GOTCHAS.md (Schedule)

### Structure and patterns
- [ ] **Workflow built without a recognizable pattern** where one fits (webhook, HTTP API, database, AI, scheduled, batch). Reshape to the proven pattern. → **n8n-workflow-patterns**
- [ ] **Fan-out branches assumed to run in parallel.** n8n runs them sequentially. Real concurrency needs sub-workflow dispatch. *(Sub-workflow guidance is pending a dedicated skill; note the limitation for now.)* → **n8n-workflow-patterns**
- [ ] **Large-item-count flow doing per-item work where batching/aggregation would cut overhead.** → **n8n-workflow-patterns**

### AI Agent / Code Tool (when present)
- [ ] **Custom Code Tool returning a non-string** (`[{json:{...}}]`) or using `$fromAI` / `$input` / `$helpers` — none exist in the Code Tool sandbox; the return must be a string. → **n8n-code-tool**
- [ ] **Tool with a generic/empty name or description.** The model can't tell when to call it; descriptions are part of the prompt. Use verb-first specific names. *(Deeper agent guidance is pending a dedicated skill.)* → **n8n-code-tool**

---

## NICE TO HAVE

### Naming
- [ ] **Generic node names** (`HTTP Request1`, `Set2`, `Postgres1`). A runtime failure on `Fetch order details` localizes the break instantly; `HTTP Request3` tells the operator nothing. Rename to describe what the node does in this workflow. → **n8n-workflow-patterns**
- [ ] **Workflow name not verb-first** (`Send weekly customer report`, not `Customer report sender`). Sentence case, no emojis, no trailing version numbers. → **n8n-workflow-patterns**

### Readability
- [ ] **Workflow `description` empty or one line.** Two sentences: what it does and why it exists (the "why" is the part that otherwise gets lost). → **n8n-workflow-patterns**
- [ ] **Code node with no one-line comment** explaining why simpler tools weren't used. → **n8n-code-javascript**
- [ ] **Multi-line expression that isn't indented or commented.** Most n8n users aren't coders — format it like real code. → **n8n-expression-syntax**

---

## Reporting findings

Group by severity, then by domain. For each finding give the node(s) affected, a one-sentence description, and the canonical skill for the fix.

```
MUST FIX
  Security
  - Node `Send webhook`: bearer token typed into headerParameters value. -> n8n-mcp-tools-expert (credentials)
  - Node `Lookup user`: {{ $json.email }} interpolated into parameters.query. -> NODE_FAMILY_GOTCHAS.md (Database)

  Connections
  - Node `Merge customer + Stripe`: 3 sources wired but parameters.numberOfInputs = 2; third drops. -> NODE_FAMILY_GOTCHAS.md (Merge)

SHOULD FIX
  Set-node antipattern
  - Node `Set customer_id`: feeds one consumer; inline at `Lookup customer`. -> n8n-expression-syntax
  ...
```
