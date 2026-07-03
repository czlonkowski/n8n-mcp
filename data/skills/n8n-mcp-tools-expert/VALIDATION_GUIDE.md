# Configuration Validation Tools Guide

Complete guide for validating node configurations and workflows.

---

## Validation Philosophy

**Validate early, validate often**

Validation is typically iterative with validate → fix cycles

---

## validate_node (UNIFIED VALIDATION)

The `validate_node` tool provides all validation capabilities with different modes.

### Quick Check (mode="minimal")

**Speed**: <50ms

**Use when**: Checking what fields are required

```javascript
validate_node({
  nodeType: "nodes-base.slack",
  config: {},  // Empty to see all required fields
  mode: "minimal"
})
```

**Returns**:
```javascript
{
  "valid": true,           // Usually true (most nodes have no strict requirements)
  "missingRequiredFields": []
}
```

**When to use**: Planning configuration, seeing basic requirements

### Full Validation (mode="full", DEFAULT)

**Speed**: <100ms

**Use when**: Validating actual configuration before deployment

```javascript
validate_node({
  nodeType: "nodes-base.slack",
  config: {
    resource: "channel",
    operation: "create",
    channel: "general"
  },
  profile: "runtime"  // Recommended!
})
// mode="full" is the default
```

---

## Validation Profiles

The profile controls **which advisory findings you see** — not how likely the validator is to be
wrong. What flips `valid: false` (real errors) and what counts as a security/deprecation warning is
the same under every profile; the profiles differ only in how many *best-practice advisories* ride
along (n8n-mcp ≥ 2.63.0). Choose by how much lint you want at this stage:

**minimal** - Required fields only
- Fastest, leanest output
- Errors for missing required fields; nothing advisory
- Use: Quick checks while you are still assembling a config

**runtime** - Errors + security/deprecation warnings (**RECOMMENDED**)
- The profile that decides valid/invalid for deployment
- Real value/type errors, plus warnings that matter for safety (security, deprecated nodes)
- Stays signal-heavy: no per-node best-practice warnings and no outdated-`typeVersion` notes
  (at most a single top-level "add error handling" suggestion)
- Use: Pre-deployment validation

**ai-friendly** - runtime + best-practice advisories
- Everything `runtime` reports, *plus* advisory notes: outdated-`typeVersion` suggestions,
  per-node "without error handling" warnings, resource-locator `cachedResultName` advice,
  long-chain hints
- These advisories are informational — they never flip `valid: false`
- Use: Reviewing an AI-built or hand-built workflow for polish

**strict** - ai-friendly + strict-only checks
- Everything `ai-friendly` reports, plus checks like "Property 'X' won't be used" for
  leftover parameters hidden by the current settings
- The most verbose profile — expect the most advisory notes, not more real errors
- Use: A final lint pass before shipping

> These are advisory tiers, not accuracy tiers. `ai-friendly` is **not** "more tolerant" and
> `strict` is **not** "more likely to be wrong" — a config that is `valid` under `runtime` stays
> `valid` under `strict`; `strict` just adds more suggestions and warnings to read.

---

## Validation Response

```javascript
{
  "nodeType": "nodes-base.slack",
  "workflowNodeType": "n8n-nodes-base.slack",
  "displayName": "Slack",
  "valid": false,
  "errors": [
    {
      "type": "missing_required",
      "property": "name",
      "message": "Channel name is required",
      "fix": "Provide a channel name (lowercase, no spaces, 1-80 characters)"
    }
  ],
  "warnings": [
    {
      "type": "best_practice",
      "property": "errorHandling",
      "message": "Slack API can have rate limits",
      "suggestion": "Add onError: 'continueRegularOutput' with retryOnFail"
    }
  ],
  "suggestions": [],
  "summary": {
    "hasErrors": true,
    "errorCount": 1,
    "warningCount": 1,
    "suggestionCount": 0
  }
}
```

### Error Types

- `missing_required` - Must fix (flips `valid:false`)
- `invalid_value` - Must fix (flips `valid:false`)
- `type_mismatch` - Must fix (flips `valid:false`)
- `best_practice` - Advisory warning; surfaces under `ai-friendly`/`strict` (security/deprecation warnings surface under every profile)
- `suggestion` - Optional improvement; surfaces under `ai-friendly`/`strict`

The `best_practice` warning shown above (rate-limit / error-handling advice) is one of the
advisories gated to `ai-friendly`/`strict` — under `runtime` this same config reports the error
with no such warning.

---

## validate_workflow (STRUCTURE VALIDATION)

**Speed**: 100-500ms

**Use when**: Checking complete workflow before execution

**Syntax**:
```javascript
validate_workflow({
  workflow: {
    nodes: [...],        // Array of nodes
    connections: {...}   // Connections object
  },
  options: {
    validateNodes: true,       // Default: true
    validateConnections: true, // Default: true
    validateExpressions: true, // Default: true
    profile: "runtime"         // For node validation
  }
})
```

**Validates**:
- Node configurations
- Connection validity (no broken references)
- Expression syntax ({{ }} patterns)
- Workflow structure (triggers, flow)
- AI connections (8 types)

**Returns**: Comprehensive validation report with errors, warnings, suggestions

### Validate by Workflow ID

```javascript
// Validate workflow already in n8n
n8n_validate_workflow({
  id: "workflow-id",
  options: {
    validateNodes: true,
    validateConnections: true,
    validateExpressions: true,
    profile: "runtime"
  }
})
```

---

## Validation Loop Pattern

**Typical cycle**: 23s thinking, 58s fixing

```
1. Configure node
   ↓
2. validate_node (23s thinking about errors)
   ↓
3. Fix errors
   ↓
4. validate_node again (58s fixing)
   ↓
5. Repeat until valid
```

**Example**:
```javascript
// Iteration 1
let config = {
  resource: "channel",
  operation: "create"
};

const result1 = validate_node({
  nodeType: "nodes-base.slack",
  config,
  profile: "runtime"
});
// → Error: Missing "name"

// Iteration 2 (~58s later)
config.name = "general";

const result2 = validate_node({
  nodeType: "nodes-base.slack",
  config,
  profile: "runtime"
});
// → Valid!
```

---

## Auto-Sanitization System

**When it runs**: On ANY workflow update (create or update_partial)

**What it fixes** (automatically on ALL nodes):
1. Binary operators (equals, contains, greaterThan) → removes `singleValue`
2. Unary operators (isEmpty, isNotEmpty, true, false) → adds `singleValue: true`
3. Invalid operator structures → corrects to proper format
4. IF v2.2+ nodes → adds complete `conditions.options` metadata
5. Switch v3.2+ nodes → adds complete `conditions.options` for all rules

**What it CANNOT fix**:
- Broken connections (references to non-existent nodes)
- Branch count mismatches (3 Switch rules but only 2 outputs)
- Paradoxical corrupt states (API returns corrupt, rejects updates)

**Example**:
```javascript
// Before auto-sanitization
{
  "type": "boolean",
  "operation": "equals",
  "singleValue": true  // Binary operators shouldn't have this
}

// After auto-sanitization (automatic!)
{
  "type": "boolean",
  "operation": "equals"
  // singleValue removed automatically
}
```

**Recovery tools**:
- `cleanStaleConnections` operation - removes broken connections
- `n8n_autofix_workflow({id})` - preview/apply fixes

---

## n8n_autofix_workflow (AUTO-FIX TOOL)

**Use when**: Validation errors need automatic fixes

```javascript
// Preview fixes (default - doesn't apply)
n8n_autofix_workflow({
  id: "workflow-id",
  applyFixes: false,  // Preview mode
  confidenceThreshold: "medium"  // high, medium, low
})

// Apply fixes
n8n_autofix_workflow({
  id: "workflow-id",
  applyFixes: true
})
```

**Fix Types**:
- `expression-format` - Fix missing `=` prefix in expressions
- `typeversion-correction` - Downgrade unsupported typeVersions
- `error-output-config` - Remove conflicting onError settings
- `node-type-correction` - Fix unknown node types via similarity matching (90%+ confidence)
- `webhook-missing-path` - Generate UUIDs for webhook nodes missing paths
- `typeversion-upgrade` - Smart upgrade nodes to latest versions with auto-migration
- `version-migration` - Guidance for complex breaking changes (manual steps)

**Confidence Threshold**: `high` (90%+), `medium` (70-89%, default), `low` (any)

**Post-update guidance**: Check `postUpdateGuidance` in the response for version upgrade migration steps.

---

## Binary vs Unary Operators

**Binary operators** (compare two values):
- equals, notEquals, contains, notContains
- greaterThan, lessThan, startsWith, endsWith
- **Must NOT have** `singleValue: true`

**Unary operators** (check single value):
- isEmpty, isNotEmpty, true, false
- **Must have** `singleValue: true`

**Auto-sanitization fixes these automatically!**

---

## Handling Validation Errors

### Process

```
1. Read error message carefully
2. Separate real errors (they flip valid:false) from advisory notes
3. Fix the errors
4. Validate again
5. Iterate until clean
```

Only findings in `errors` flip `valid: false`. `warnings` and `suggestions` are advice — an
outdated-`typeVersion` note or a "without error handling" suggestion under `ai-friendly`/`strict`
does not make the workflow invalid, so treat them as a to-review list, not a blocker.

### Common Errors

**"Required field missing"** / **"Required property 'X' cannot be empty"**
→ Add the field with a real value. This is a true error even when the field looks optional — n8n's
own publish validation rejects the same empty value, so the workflow will not save.

**"Invalid value"**
→ Check allowed values in get_node output. Fires only on an explicitly wrong enum value; an
*omitted* operation on a multi-resource node (Gmail, Slack, Telegram…) is no longer flagged
(n8n-mcp ≥ 2.63.0 resolves the correct per-resource default before checking).

**"Type mismatch"**
→ Convert to correct type (string/number/boolean)

**"Code cannot be empty"**
→ Fill in the Code node's `jsCode`/`pythonCode`. Kept as a true error — n8n refuses to run an
empty Code node.

> Operator shapes (`singleValue`, IF/Switch `conditions.options` metadata) are **no longer
> validation errors**. The save-time sanitizer normalizes them (see Auto-Sanitization), and
> validate-only calls leave them alone — so you will not see "Cannot have singleValue" or
> "Missing operator metadata" from the validator anymore.

### Errors vs advisories

There is no standing list of validator false positives to ignore (n8n-mcp ≥ 2.63.0 removed the
classes that used to require it — template literals inside `{{ }}`, optional chaining `?.`,
string-keyed bracket access like `$json['some-prop']`, legacy IF v1 condition shapes, the
Webhook → Respond-to-Webhook pattern, and outdated-but-supported typeVersions all validate cleanly
now). If something lands in `errors`, treat it as real. If you want the leanest output while
building, validate under `runtime` (errors + security/deprecation only); switch to
`ai-friendly`/`strict` when you want the best-practice advisories.

---

## Best Practices

### Do

- Use **runtime** profile for pre-deployment
- Validate after every configuration change
- Fix errors immediately (avg 58s)
- Iterate validation loop
- Trust auto-sanitization for operator issues
- Use `mode: "minimal"` for quick checks
- Use `n8n_autofix_workflow` for bulk fixes
- Activate workflows via API when ready (`activateWorkflow` operation)

### Don't

- Skip validation before deployment
- Ignore error messages
- Use strict profile mid-build (it layers on best-practice advisories that are noise until the workflow is nearly done)
- Assume validation passed (check result)
- Try to manually fix auto-sanitization issues

---

## Example: Complete Validation Workflow

```javascript
// Step 1: Get node requirements (quick check)
validate_node({
  nodeType: "nodes-base.slack",
  config: {},
  mode: "minimal"
});
// → Know what's required

// Step 2: Configure node
const config = {
  resource: "message",
  operation: "post",
  channel: "#general",
  text: "Hello!"
};

// Step 3: Validate configuration (full validation)
const result = validate_node({
  nodeType: "nodes-base.slack",
  config,
  profile: "runtime"
});

// Step 4: Check result
if (result.valid) {
  console.log("Configuration valid!");
} else {
  console.log("Errors:", result.errors);
  // Fix and validate again
}

// Step 5: Validate in workflow context
validate_workflow({
  workflow: {
    nodes: [{...config as node...}],
    connections: {...}
  }
});

// Step 6: Apply auto-fixes if needed
n8n_autofix_workflow({
  id: "workflow-id",
  applyFixes: true
});
```

---

## Summary

**Key Points**:
1. Use **runtime** profile (balanced validation)
2. Validation loop: validate → fix (58s) → validate again
3. Auto-sanitization fixes operator structures automatically
4. Binary operators ≠ singleValue, Unary operators = singleValue: true
5. Iterate until validation passes
6. Use `n8n_autofix_workflow` for automatic fixes

**Tool Selection**:
- **validate_node({mode: "minimal"})**: Quick required fields check
- **validate_node({profile: "runtime"})**: Full config validation (**use this!**)
- **validate_workflow**: Complete workflow check
- **n8n_validate_workflow({id})**: Validate existing workflow
- **n8n_autofix_workflow({id})**: Auto-fix common issues

---

## Common Mistakes (Full Deep-Dive)

The eight most common tool-usage mistakes, with WRONG vs CORRECT examples.

### Mistake 1: Wrong nodeType Format

**Problem**: "Node not found" error

```javascript
// WRONG
get_node({nodeType: "slack"})  // Missing prefix
get_node({nodeType: "n8n-nodes-base.slack"})  // Wrong prefix

// CORRECT
get_node({nodeType: "nodes-base.slack"})
```

### Mistake 2: Using detail="full" by Default

**Problem**: Huge payload, slower response, token waste

```javascript
// WRONG - Returns 3-8K tokens, use sparingly
get_node({nodeType: "nodes-base.slack", detail: "full"})

// CORRECT - Returns 1-2K tokens, covers 95% of use cases
get_node({nodeType: "nodes-base.slack"})  // detail="standard" is default
get_node({nodeType: "nodes-base.slack", detail: "standard"})
```

**When to use detail="full"**:
- Debugging complex configuration issues
- Need complete property schema with all nested options
- Exploring advanced features

**Better alternatives**:
1. `get_node({detail: "standard"})` - for operations list (default)
2. `get_node({mode: "docs"})` - for readable documentation
3. `get_node({mode: "search_properties", propertyQuery: "auth"})` - for specific property

### Mistake 3: Not Using Validation Profiles

**Problem**: Missing real errors, or drowning in advisory notes at the wrong stage

**Profiles** (they gate advisory volume, not accuracy — see [Validation Profiles](#validation-profiles)):
- `minimal` - Required fields only (fast, leanest)
- `runtime` - Errors + security/deprecation warnings (recommended for pre-deployment; decides valid/invalid)
- `ai-friendly` - runtime + best-practice advisories (outdated-typeVersion, error-handling suggestions…)
- `strict` - ai-friendly + strict-only checks (e.g. "property won't be used")

```javascript
// WRONG - Uses default profile
validate_node({nodeType, config})

// CORRECT - Explicit profile
validate_node({nodeType, config, profile: "runtime"})
```

### Mistake 4: Ignoring Auto-Sanitization

**What happens**: ALL nodes sanitized on ANY workflow update

**Auto-fixes**:
- Binary operators (equals, contains) → removes singleValue
- Unary operators (isEmpty, isNotEmpty) → adds singleValue: true
- IF/Switch nodes → adds missing metadata

**Cannot fix**:
- Broken connections
- Branch count mismatches
- Paradoxical corrupt states

```javascript
// After ANY update, auto-sanitization runs on ALL nodes
n8n_update_partial_workflow({id, operations: [...]})
// → Automatically fixes operator structures
```

### Mistake 5: Not Using Smart Parameters

**Problem**: Complex sourceIndex calculations for multi-output nodes

**Old way** (manual):
```javascript
// IF node connection
{
  type: "addConnection",
  source: "IF",
  target: "Handler",
  sourceIndex: 0  // Which output? Hard to remember!
}
```

**New way** (smart parameters):
```javascript
// IF node - semantic branch names
{
  type: "addConnection",
  source: "IF",
  target: "True Handler",
  branch: "true"  // Clear and readable!
}

{
  type: "addConnection",
  source: "IF",
  target: "False Handler",
  branch: "false"
}

// Switch node - semantic case numbers
{
  type: "addConnection",
  source: "Switch",
  target: "Handler A",
  case: 0
}
```

### Mistake 7: Wrong Parameter Name for updateNode

**Problem**: Using `parameters` instead of `updates`

```javascript
// WRONG
n8n_update_partial_workflow({
  id: "wf-123",
  operations: [{
    type: "updateNode",
    nodeName: "HTTP Request",
    parameters: {url: "..."}  // ❌ Wrong key
  }]
})

// CORRECT
n8n_update_partial_workflow({
  id: "wf-123",
  operations: [{
    type: "updateNode",
    nodeName: "HTTP Request",
    updates: {url: "..."}  // ✅ Correct key
  }]
})
```

### Mistake 8: Wrong Credential Attachment Format

**Problem**: Credentials not attaching to nodes

```javascript
// WRONG - credentials as flat object
updates: {credentials: "myApiKey"}

// CORRECT - credentials nested by type with id and name
updates: {
  credentials: {
    httpHeaderAuth: {
      id: "abc123",
      name: "My API Key"
    }
  }
}
```

### Mistake 6: Not Using intent Parameter

**Problem**: Less helpful tool responses

```javascript
// WRONG - No context for response
n8n_update_partial_workflow({
  id: "abc",
  operations: [{type: "addNode", node: {...}}]
})

// CORRECT - Better AI responses
n8n_update_partial_workflow({
  id: "abc",
  intent: "Add error handling for API failures",
  operations: [{type: "addNode", node: {...}}]
})
```

---

**Related**:
- [SEARCH_GUIDE.md](SEARCH_GUIDE.md) - Find nodes
- [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) - Build workflows
