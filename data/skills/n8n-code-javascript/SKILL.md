---
name: n8n-code-javascript
description: "Write, review, or debug JavaScript in an n8n Code node. Use when a Code node is already in the workflow (editing it, fixing an error, choosing its mode, making it faster), or when a new one is justified: no native node fits (check the job-to-node table in using-n8n-mcp-skills first) and the job is on the closed list — loops or recursion no node expresses, state across runs, parsing no node handles, an allowlisted library, heavy all-items work, or one short node replacing 4+ glue nodes. Covers $input/$json/$node in code, this.helpers, Luxon, SplitInBatches loops, cross-iteration data, pairedItem, per-item performance, and the \"Why Code:\" note. Filtering, totals, dedupe, sorting, joins, file formats and API paging have native nodes (Filter, Summarize, Remove Duplicates, Sort, Merge, Extract From File, HTTP Request): see n8n-node-configuration. EXCEPTION — for the AI-agent-callable Custom Code Tool (@n8n/n8n-nodes-langchain.toolCode), use n8n-code-tool; it has a different runtime contract."
---

# JavaScript Code Node

Expert guidance for writing JavaScript code in n8n Code nodes.

---

## Before you write a Code node

A new Code node has to pass this gate first:

1. **Is there a native node for the job?** Check the job-to-node table in `using-n8n-mcp-skills`: Filter, IF / Switch,
   Summarize, Aggregate, Split Out, Merge, Compare Datasets, Remove Duplicates, Sort + Limit, Date & Time, XML / HTML /
   Extract From File / Convert To File, HTTP Request (pagination, batching) and Crypto cover most reaches for Code.
   Their configs are in `n8n-node-configuration` → NATIVE_NODES.md.
2. **Would a short expression in that node do?** One expression, no function body — the helper methods (`.pluck()`,
   `.sum()`, `.unique()`, `$ifEmpty()`, `.diffTo()`) are in `n8n-expression-syntax` and, on n8n-mcp 2.97.0+, in
   `tools_documentation({topic: "expression_helpers"})`. Several statements inside `{{ }}` count as code, so they belong
   here rather than in an Edit Fields field.
3. **Is the job on the closed list?** Loops or recursion no node expresses, state across runs
   (`$getWorkflowStaticData`), parsing no node handles, an allowlisted library, heavy all-items work (thousands of items,
   stated or measured), or one short Code node (~15 lines) replacing 4+ glue nodes that only reshape data.

If it passes, write the Code node and give it a note, so the next reader (and the review hooks) can see why:

```json
{ "name": "Flatten category tree", "type": "n8n-nodes-base.code", "notes": "Why Code: Split Out considered — the tree has arbitrary depth (recursion)", "notesInFlow": true }
```

Editing or debugging a Code node that is already there doesn't need the gate, but if the node does a native-node job,
say so and offer the native replacement.

---

## Quick Start

```javascript
// Basic template for Code nodes
const items = $input.all();

// Process data
const processed = items.map(item => ({
  json: {
    ...item.json,
    processed: true,
    timestamp: new Date().toISOString()
  }
}));

return processed;
```

### Essential Rules

1. **Choose "Run Once for All Items" mode** (recommended for most use cases)
2. **Access data**: `$input.all()`, `$input.first()`, or `$input.item`
3. **Return `[{json: {...}}]`** — the canonical, mode-portable form. In *Run Once for All Items* mode n8n also auto-wraps a bare `return {…}` object, so that runs too; what genuinely fails is returning a primitive (string/number) or `null`.
4. **CRITICAL**: Webhook data is under `$json.body` (not `$json` directly)
5. **Built-ins available**: `this.helpers.httpRequest()` (no auth — the bare `$helpers` global is **undefined** in the task-runner sandbox, so `$helpers.httpRequest()` throws `ReferenceError: $helpers is not defined`), DateTime (Luxon), $jmespath(). **Not available**: `this.helpers.httpRequestWithAuthentication` (deny-listed), $env (when N8N_BLOCK_ENV_ACCESS_IN_NODE=true), require() (unless allowlisted). For anything beyond a trivial unauthenticated GET (auth, pagination, retries), prefer the **HTTP Request node** and keep Code nodes for pure logic.
6. **Instance-allowlisted libraries**: Self-hosted instances can allowlist modules via `N8N_RUNNERS_ALLOWED_BUILT_IN_MODULES` and `N8N_RUNNERS_ALLOWED_EXTERNAL_MODULES` (legacy: `NODE_FUNCTION_ALLOW_BUILTIN` / `NODE_FUNCTION_ALLOW_EXTERNAL`). If the user says their instance allows specific modules (e.g. `axios`, `lodash`, `crypto`), use them via `require()` — don't refuse. If unsure, ask or default to built-ins only.
7. **Wrong skill?** If you're writing code for a **Custom Code Tool** attached to an AI Agent (`@n8n/n8n-nodes-langchain.toolCode`), stop — that node has a different contract (input via `query`, must return a string, no `$input`/`$helpers`). Use the **n8n-code-tool** skill.

---

## Mode Selection Guide

The Code node offers two execution modes. Choose based on your use case:

### Run Once for All Items (Recommended - Default)

**Use this mode for:** 95% of use cases

- **How it works**: Code executes **once** regardless of input count
- **Data access**: `$input.all()` or `items` array
- **Best for**: logic that needs every item at once and passed the gate above
- **Performance**: Faster for multiple items (single execution)

```javascript
// Example: running balance — each item depends on the ones before it,
// which no native node expresses (Summarize gives one total per group, not a running one)
let balance = 0;
return $input.all().map(item => {
  balance += item.json.amount || 0;
  return { json: { ...item.json, balance } };
});
```

**When to use:**
- ✅ Each item depends on earlier items (running totals, sessionizing events, gap detection)
- ✅ Multi-pass algorithms or recursion over nested data of unknown depth
- ✅ Heavy transforms over thousands of items where one node beats a long chain (measured)

Native first: totals, averages and counts → **Summarize**; sorting or ranking → **Sort + Limit**; deduplication →
**Remove Duplicates**; items into one array → **Aggregate**; joining two lists → **Merge**.

### Run Once for Each Item

**Use this mode for:** Specialized cases only

- **How it works**: Code executes **separately** for each input item
- **Data access**: `$input.item` or `$item`
- **Best for**: Item-specific logic, independent operations, per-item validation
- **Performance**: Slower for large datasets (multiple executions)

```javascript
// Example: Add processing timestamp to each item
const item = $input.item;

return [{
  json: {
    ...item.json,
    processed: true,
    processedAt: new Date().toISOString()
  }
}];
```

**When to use:**
- ✅ Each item needs independent API call
- ✅ Per-item validation with different error handling
- ✅ Item-specific transformations based on item properties
- ✅ When items must be processed separately for business logic

**Decision Shortcut:**
- **Need to look at multiple items?** → Use "All Items" mode
- **Each item completely independent?** → Use "Each Item" mode
- **Not sure?** → Use "All Items" mode (you can always loop inside)

### Why "All Items" is faster — the per-item boundary

Mode choice is the single biggest performance lever in a Code node. Each *per-item* execution context costs a setup tax (measured on n8n 2.x, small records):

| What runs per item | Approx. cost |
|---|---|
| Code **All Items** (one run for the whole set) | ~0.02 ms/item |
| Expression in any node (IF / Set / etc.) | ~0.2 ms/item |
| Code **Each Item** (a full sandbox per item) | ~0.6 ms/item — ~25–30× All Items |

So `Run Once for Each Item` over 10k items is ~6 s of pure overhead vs ~0.2 s in `Run Once for All Items`. Use Each Item only when an item genuinely needs isolating (independent error handling, or a per-item API call you can't batch); otherwise loop *inside* one All Items node. Expression complexity itself is essentially free (~90% of the cost is the per-item context, not your code) and every node→node hop re-copies all items — so reduce the *number* of per-item boundaries, don't micro-optimize each one.

On top of the per-item cost, every Code node run pays a fixed hand-off to the task runner. In the default internal mode the runner stops after 15 s idle (`N8N_RUNNERS_AUTO_SHUTDOWN_TIMEOUT`), so a workflow that runs now and then pays a cold start of hundreds of milliseconds on most runs. Native transform nodes process all items in one in-process call and skip that hand-off.

**What this means for node choice.** Most workflows are I/O-bound, and below a few hundred items none of these costs matter: choose by readability, which means native nodes first. Performance becomes the deciding argument only for heavy all-items work — thousands of items per run, transform work rather than I/O dominating, stated by the user or measured. Then one All Items Code node can beat a long chain of nodes, and the reason goes in its `Why Code:` note. These figures are the pack's one measured reference; the other skills point here instead of repeating them.

**See**: [DATA_ACCESS.md](DATA_ACCESS.md) → "Mode Performance" for the corollaries, hop costs, and scale check.

---

## Data Access Patterns

Four ways to pull data from upstream nodes. Note `$node["Name"]` and `$('Name')` need `.first().json` or `.all()` — never `.json` directly.

```javascript
const allItems = $input.all();          // 1. All items — batch ops, aggregation (most common)
const data = $input.first().json;       // 2. First item — single objects, API responses
const item = $input.item;               // 3. Current item — "Each Item" mode ONLY (undefined otherwise)
const other = $node["Webhook"].json;    // 4. Named node — combine data across nodes
```

Always access fields via `.json` (e.g. `item.json.name`, not `item.name`), and prefer the explicit `$input.first().json.field` over a bare `$json.field`.

**See**: [DATA_ACCESS.md](DATA_ACCESS.md) for the full guide — every pattern with examples, a decision tree, and the common mistakes (mutating originals, missing length checks, `$input.item` in the wrong mode).

---

## Critical: Webhook Data Structure

**MOST COMMON MISTAKE**: Webhook data is nested under `.body`

```javascript
// ❌ WRONG - Will return undefined
const name = $json.name;
const email = $json.email;

// ✅ CORRECT - Webhook data is under .body
const name = $json.body.name;
const email = $json.body.email;

// Or with $input
const webhookData = $input.first().json.body;
const name = webhookData.name;
```

**Why**: Webhook node wraps all request data under `body` property. This includes POST data, query parameters, and JSON payloads.

**See**: [DATA_ACCESS.md](DATA_ACCESS.md) for full webhook structure details

---

## Return Format Requirements

**Canonical form**: `[{json: {...}}]` — an array of objects each with a `json` property. It is unambiguous and works identically in both execution modes, so make it your default.

In *Run Once for All Items* mode n8n auto-normalizes looser shapes on the way out: a single bare object, or an array of bare objects, gets wrapped under `json` for you. So `return {foo: 1}` runs. What has nothing to wrap — and therefore genuinely fails at runtime with "Code doesn't return items properly" — is a primitive (string/number/boolean) or `null`/`undefined`. (n8n-mcp ≥ 2.63.0 no longer flags a bare-object return as an error; it reflects this auto-wrap behavior.)

### Correct Return Formats

```javascript
// ✅ Single result
return [{
  json: {
    field1: value1,
    field2: value2
  }
}];

// ✅ Multiple results
return [
  {json: {id: 1, data: 'first'}},
  {json: {id: 2, data: 'second'}}
];

// ✅ Transformed array
const transformed = $input.all()
  .filter(item => item.json.valid)
  .map(item => ({
    json: {
      id: item.json.id,
      processed: true
    }
  }));
return transformed;

// ✅ Empty result (when no data to return)
return [];

// ✅ Conditional return
if (shouldProcess) {
  return [{json: processedData}];
} else {
  return [];
}
```

### Non-Canonical Returns (auto-wrapped — prefer the canonical form)

```javascript
// ⚠️ Auto-wrapped in All Items mode → [{json: {field: value}}]. Runs, but prefer the array form.
return {
  json: {field: value}
};

// ⚠️ Auto-wrapped → [{json: {field: value}}]. Runs, but add the json wrapper for clarity.
return [{field: value}];

// ✅ Fine — input items already carry a json property, so returning them unchanged is a valid passthrough
return $input.all();
```

### Genuinely Broken Returns

```javascript
// ❌ FAILS: primitive — n8n errors "Code doesn't return items properly"
return "processed";

// ❌ FAILS: null / undefined — nothing to pass to the next node
return null;
```

**Why it matters**: The canonical `[{json: {...}}]` is unambiguous and behaves the same in both modes. n8n auto-normalizes bare objects and arrays-of-objects in All Items mode, but a primitive or `null` return has nothing to wrap and stops execution.

**See**: [ERROR_PATTERNS.md](ERROR_PATTERNS.md) #3 for detailed error solutions

---

## Common Patterns Overview

The most useful Code node shapes from production workflows, for when Code passed the gate. Several of them have a native equivalent (totals → Summarize, top-N → Sort + Limit, JSON comparison → Compare Datasets, string aggregation → Aggregate or Summarize `concatenate`); each pattern in the library opens with its native alternative. The full library covers 10 patterns: multi-source aggregation, regex filtering, markdown/structured-text parsing, JSON comparison, CRM/form transformation, release processing, array transformation with computed fields, Slack Block Kit formatting, top-N ranking, and string-aggregation reporting — each with variations.

**See**: [COMMON_PATTERNS.md](COMMON_PATTERNS.md) for the 10 detailed production patterns (and the Best Practices section: validate input, try-catch, filter-early, array methods over loops, console.log debugging).

---

## Error Prevention - Top Mistakes

The recurring Code node failures, in rough frequency order:

1. **Empty code / missing return** — always end with `return [...]`, and make sure *every* branch returns.
2. **Expression syntax as code** — don't write `{{ }}` where JavaScript belongs (`return {{ $json.x }}` is a syntax error). Use `` `${$json.field}` `` or `$input.first().json.field`. `{{ }}` *inside a string literal* is fine — it's just literal text n8n won't evaluate.
3. **Return shape** — prefer `return [{json:{...}}]`. A bare `return {…}` auto-wraps in All Items mode, but returning a primitive (string/number) or `null` is what actually fails.
4. **Missing null checks** — use optional chaining: `item.json?.user?.email || 'fallback'`.
5. **Webhook body nesting** — `$json.email` is undefined; use `$json.body.email`.
6. **Auth helpers blocked** (`httpRequestWithAuthentication`) and `$env` blocked — route secrets through credentials/HTTP Request node, not the Code node sandbox.

**See**: [ERROR_PATTERNS.md](ERROR_PATTERNS.md) for the comprehensive guide — each error with wrong/right code, escaping rules, the sandbox restrictions (Errors #6–#7), a prevention checklist, and a quick error-message lookup table.

---

## Built-in Functions & Helpers

```javascript
// HTTP requests (no auth — see sandbox note below)
const res = await this.helpers.httpRequest({ method: 'GET', url: 'https://api.example.com/data' });

// DateTime (Luxon): now, formatting, arithmetic
const now = DateTime.now();
const formatted = now.toFormat('yyyy-MM-dd');
const tomorrow = now.plus({ days: 1 });

// $jmespath() — query JSON structures
const adults = $jmespath($input.first().json, 'users[?age >= `18`]');

// $getWorkflowStaticData() — data that persists across executions
```

**Sandbox (since n8n v2.0, JsTaskRunnerSandbox):** the accessor is `this.helpers.httpRequest()` — the bare `$helpers` global is **undefined** here (`$helpers.httpRequest()` throws `ReferenceError`). Inside a nested async function where `this` is lost, call it as `await fn.call(this, ...)`. `this.helpers.httpRequestWithAuthentication` and `this.helpers.requestWithAuthenticationPaginated` are deny-listed (→ `UnsupportedFunctionError`); for authenticated calls use an **HTTP Request node** with the credential (preferred), a sub-workflow, or a manual `Authorization: Bearer ${token}` header on `this.helpers.httpRequest()` only when the token already flows through the workflow as data. `$env` is blocked when `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`; `require()` works only for allowlisted modules. `Buffer`, `URL`, and standard JS globals (Math, JSON, Object, Array) always work.

**See**: [BUILTIN_FUNCTIONS.md](BUILTIN_FUNCTIONS.md) for the complete reference — full httpRequest options, all DateTime/Luxon operations, JMESPath patterns, static-data use cases, and the sandbox-restriction details.

---

## Best Practices

- **Validate input first** — guard for empty arrays / missing `.json` before processing.
- **Try-catch risky work** (HTTP calls) and return an error object instead of crashing.
- **Prefer array methods** (`filter`/`map`/`reduce`) over manual loops.
- **Filter early, transform late** — shrink the dataset before expensive work.
- **Descriptive names** and `console.log()` for debugging (output goes to the browser console).

**See**: [COMMON_PATTERNS.md](COMMON_PATTERNS.md) → "Best Practices" for code examples of each.

---

## Production Gotchas

Hard-won lessons from real deployments — summarized here, with code in [DATA_ACCESS.md](DATA_ACCESS.md) → "Production Gotchas":

- **SplitInBatches outputs are counterintuitive**: `main[0]` = **done** (fires once, after all batches), `main[1]` = **each batch** (the loop body). Add a **Limit 1** node after the done output as a safety.
- **Iteration count is the cost**: each loop iteration re-runs the whole body through the engine (~0.8 ms overhead each). `batchSize: 1` is the loop equivalent of *Each Item* — use the largest batch your real constraint (rate limit, page size, memory) allows, or don't loop at all.
- **Cross-iteration accumulation (CRITICAL)**: after the loop, `$('Node Inside Loop').all()` returns ONLY the last iteration's items. Accumulate via `$getWorkflowStaticData('global')` (reset before, push inside, read after).
- **pairedItem**: when emitting items that don't map 1:1 to input, set `pairedItem: { item: i }` or downstream Set nodes fail with `paired_item_no_info`.
- **Node reference syntax**: `$('Node').first().json` or `$('Node').all()` — never `.json` directly on the reference.
- **Float precision**: compare currency at the cent level — `Math.round(a*100) !== Math.round(b*100)` — to avoid false positives from float noise.

---

## When to Use Code Node

Code is the last rung, after the service's own node, a native node for the job, and a short expression inside that node.
The gate at the top of this skill is the test; this is the closed list it checks against:

| Code is right for | Example | Not Code |
|---|---|---|
| Loops or recursion no node expresses | flatten a tree of unknown depth; multi-pass matching | one level of nesting → Split Out |
| State across runs | counters or cursors in `$getWorkflowStaticData` | "only new items" → Remove Duplicates across executions |
| Parsing no node handles | fixed-width records, a custom log format | CSV / XLSX / PDF / XML / HTML → Extract From File, XML, HTML |
| An allowlisted library | `require('some-lib')` the instance allows | hashing / HMAC / UUID → Crypto |
| Heavy all-items work | thousands of items, transform-bound, stated or measured | a few hundred items → native nodes |
| One short node replacing 4+ glue nodes | ~15 lines that would otherwise be a Set → Split Out → Set → Aggregate chain that only reshapes data | a chain with real routing or I/O in it |

Not on the list, so not Code: filtering (Filter), routing (IF / Switch), totals and counts (Summarize), top-N (Sort + Limit),
dedupe (Remove Duplicates), joins (Merge), diffs (Compare Datasets), dates (Date & Time or a Luxon expression), API calls
and paging (HTTP Request), crypto and XML (Crypto, XML).

Every Code node that stays carries the note `Why Code: <native node considered> — <reason>` (set `notes`, and
`notesInFlow: true` to show it on the canvas). The create/update hooks remind you when a Code node has no such note.

---

## Integration with Other Skills

### Works With:

**n8n Expression Syntax**:
- Expressions use `{{ }}` syntax in other nodes
- Code nodes use JavaScript directly (no `{{ }}`)
- When to use expressions vs code

**n8n MCP Tools Expert**:
- How to find Code node: `search_nodes({query: "code"})`
- Get configuration help: `get_node({nodeType: "nodes-base.code"})`
- Validate code: `validate_node({nodeType: "nodes-base.code", config: {...}})`

**n8n Node Configuration**:
- Mode selection (All Items vs Each Item)
- Language selection (JavaScript vs Python)
- Understanding property dependencies

**n8n Workflow Patterns**:
- Code nodes in transformation step
- Webhook → Code → API pattern
- Error handling in workflows

**n8n Validation Expert**:
- Validate Code node configuration
- Handle validation errors
- Auto-fix common issues

---

## Quick Reference Checklist

Before deploying Code nodes, verify:

- [ ] **Passed the gate** - No native node fits; `notes` starts with `Why Code:`
- [ ] **Code is not empty** - Must have meaningful logic
- [ ] **Return statement exists** - Returns items, not a primitive/`null`
- [ ] **Canonical return format** - Each item: `{json: {...}}` (bare objects auto-wrap, but be explicit)
- [ ] **Data access correct** - Using `$input.all()`, `$input.first()`, or `$input.item`
- [ ] **No `{{ }}` written as code** - Use JavaScript template literals: `` `${value}` ``
- [ ] **Error handling** - Guard clauses for null/undefined inputs
- [ ] **Webhook data** - Access via `.body` if from webhook
- [ ] **Mode selection** - "All Items" for most cases
- [ ] **Performance** - Prefer map/filter over manual loops
- [ ] **Output consistent** - All code paths return same structure

---

## Additional Resources

### Related Files
- [DATA_ACCESS.md](DATA_ACCESS.md) - Comprehensive data access patterns
- [COMMON_PATTERNS.md](COMMON_PATTERNS.md) - 10 production-tested patterns
- [ERROR_PATTERNS.md](ERROR_PATTERNS.md) - Top 5 errors and solutions
- [BUILTIN_FUNCTIONS.md](BUILTIN_FUNCTIONS.md) - Complete built-in reference

### n8n Documentation
- Code Node Guide: https://docs.n8n.io/code/code-node/
- Built-in Methods: https://docs.n8n.io/code-examples/methods-variables-reference/
- Luxon Documentation: https://moment.github.io/luxon/

---

**Ready to write JavaScript in n8n Code nodes!** Start with simple transformations, use the error patterns guide to avoid common mistakes, and reference the pattern library for production-ready examples.
