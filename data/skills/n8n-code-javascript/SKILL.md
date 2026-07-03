---
name: n8n-code-javascript
description: Write JavaScript code in n8n Code nodes. Use when writing JavaScript in n8n, using $input/$json/$node syntax, making HTTP requests with this.helpers / the $helpers global, working with dates using DateTime, troubleshooting Code node errors, choosing between Code node modes, or doing any custom data transformation in n8n. Always use this skill when a workflow needs a Code node — whether for data aggregation, filtering, API calls, format conversion, batch processing logic, or any custom JavaScript. Covers SplitInBatches loop patterns, cross-iteration data, pairedItem, and real-world production patterns. Also use when asked why a Code node or workflow is slow, which execution mode is faster, or how to cut per-item overhead on large datasets. EXCEPTION — for the AI-agent-callable Custom Code Tool (@n8n/n8n-nodes-langchain.toolCode, a tool attached to an AI Agent), use the n8n-code-tool skill instead; it has a different runtime contract.
---

# JavaScript Code Node

Expert guidance for writing JavaScript code in n8n Code nodes.

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
- **Best for**: Aggregation, filtering, batch processing, transformations, API calls with all data
- **Performance**: Faster for multiple items (single execution)

```javascript
// Example: Calculate total from all items
const allItems = $input.all();
const total = allItems.reduce((sum, item) => sum + (item.json.amount || 0), 0);

return [{
  json: {
    total,
    count: allItems.length,
    average: total / allItems.length
  }
}];
```

**When to use:**
- ✅ Comparing items across the dataset
- ✅ Calculating totals, averages, or statistics
- ✅ Sorting or ranking items
- ✅ Deduplication
- ✅ Building aggregated reports
- ✅ Combining data from multiple items

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

So `Run Once for Each Item` over 10k items is ~6 s of pure overhead vs ~0.2 s in `Run Once for All Items`. Use Each Item only when an item genuinely needs isolating (independent error handling, or a per-item API call you can't batch); otherwise loop *inside* one All Items node. Expression complexity itself is essentially free (~90% of the cost is the per-item context, not your code) and every node→node hop re-copies all items — so reduce the *number* of per-item boundaries, don't micro-optimize each one. Below a few hundred items none of this matters; reach for it on the hot path (large item counts, little I/O).

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

The most useful Code node shapes from production workflows. One quick example — sum/aggregate across all items:

```javascript
const items = $input.all();
const total = items.reduce((sum, item) => sum + (item.json.amount || 0), 0);
return [{ json: { total, count: items.length, average: total / items.length } }];
```

The full library covers 10 patterns: multi-source aggregation, regex filtering, markdown/structured-text parsing, JSON comparison, CRM/form transformation, release processing, array transformation with computed fields, Slack Block Kit formatting, top-N ranking, and string-aggregation reporting — each with variations.

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

> **Before reaching for a Code node, walk the transform gatekeeper** in the n8n Expression Syntax skill: expression → arrow-function IIFE inside an Edit Fields field → Code node, in that order. The first two paths cover most "transform this data" tasks at ~1–10ms each, versus the Code node's sandboxed ~500–1000ms — a ~100x gap on pure single-item shaping, with no functional difference. The Code node earns its place only for whole-dataset aggregation (`$input.all()`), allowlisted libraries, or async work. And before writing code for crypto (HMAC, hashing, signing) or XML/SOAP/RSS parsing, check for a **native node** — n8n has a Crypto node (`nodes-base.crypto`) and an XML node (`nodes-base.xml`) that cover those without any JavaScript. Dropping into Code for something a native node already does is one of the most common false positives.

Use Code node when:
- ✅ Complex transformations requiring multiple steps
- ✅ Custom calculations or business logic
- ✅ Recursive operations
- ✅ API response parsing with complex structure
- ✅ Multi-step conditionals
- ✅ Data aggregation across items

Consider other nodes when:
- ❌ Simple field mapping → Use **Set** node
- ❌ Basic filtering → Use **Filter** node
- ❌ Simple conditionals → Use **IF** or **Switch** node
- ❌ HTTP requests only → Use **HTTP Request** node

**Code node excels at**: Complex logic that would require chaining many simple nodes

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
