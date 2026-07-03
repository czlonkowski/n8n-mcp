---
name: n8n-node-configuration
description: Operation-aware node configuration guidance. Use when configuring nodes, understanding property dependencies, determining required fields, choosing between get_node detail levels, or learning common configuration patterns by node type. Always use this skill when setting up node parameters — it explains which fields are required for each operation, how displayOptions control field visibility, and when to use patchNodeField for surgical edits vs full node updates.
---

# n8n Node Configuration

Expert guidance for operation-aware node configuration with property dependencies.

---

## Configuration Philosophy

**Progressive disclosure**: Start minimal, add complexity as needed

Configuration best practices:
- `get_node` with `detail: "standard"` is the most used discovery pattern
- 56 seconds average between configuration edits
- Covers 95% of use cases with 1-2K tokens response

**Key insight**: Most configurations need only standard detail, not full schema!

---

## Core Concepts

### 1. Operation-Aware Configuration

**Not all fields are always required** - it depends on operation!

**Example**: Slack node
```javascript
// For operation='post'
{
  "resource": "message",
  "operation": "post",
  "channel": "#general",  // Required for post
  "text": "Hello!"        // Required for post
}

// For operation='update'
{
  "resource": "message",
  "operation": "update",
  "messageId": "123",     // Required for update (different!)
  "text": "Updated!"      // Required for update
  // channel NOT required for update
}
```

**Key**: Resource + operation determine which fields are required!

### 2. Property Dependencies

**Fields appear/disappear based on other field values**

**Example**: HTTP Request node
```javascript
// When method='GET'
{
  "method": "GET",
  "url": "https://api.example.com"
  // sendBody not shown (GET doesn't have body)
}

// When method='POST'
{
  "method": "POST",
  "url": "https://api.example.com",
  "sendBody": true,       // Now visible!
  "body": {               // Required when sendBody=true
    "contentType": "json",
    "content": {...}
  }
}
```

**Mechanism**: displayOptions control field visibility

### 3. Progressive Discovery

**Use the right detail level**:

1. **get_node({detail: "standard"})** - DEFAULT
   - Quick overview (~1-2K tokens)
   - Required fields + common options
   - **Use first** - covers 95% of needs

2. **get_node({mode: "search_properties", propertyQuery: "..."})** (for finding specific fields)
   - Find properties by name
   - Use when looking for auth, body, headers, etc.

3. **get_node({detail: "full"})** (complete schema)
   - All properties (~3-8K tokens)
   - Use only when standard detail is insufficient

---

## Configuration Workflow

### Standard Process

1. Identify node type and operation.
2. Use `get_node` (standard detail is default).
3. Configure required fields.
4. Validate configuration.
5. If a field is unclear → `get_node({mode: "search_properties"})`.
6. Add optional fields as needed.
7. Validate again.
8. Deploy.

### Example: Configuring HTTP Request

The validate-driven loop in practice: start minimal (`method`, `url`, `authentication`), then let each `validate_node` error surface the next required field (`sendBody` for POST → `body` when `sendBody=true`) until valid. Full step-by-step walkthrough in **[OPERATION_PATTERNS.md](OPERATION_PATTERNS.md#worked-example-configuring-http-request-step-by-step)**.

---

## get_node Detail Levels

### Standard Detail (DEFAULT - Use This!)

**✅ Starting configuration**
```javascript
get_node({
  nodeType: "nodes-base.slack"
});
// detail="standard" is the default
```

**Returns** (~1-2K tokens):
- Required fields
- Common options
- Operation list
- Metadata

**Use**: 95% of configuration needs

### Full Detail (Use Sparingly)

**✅ When standard isn't enough**
```javascript
get_node({
  nodeType: "nodes-base.slack",
  detail: "full"
});
```

**Returns** (~3-8K tokens):
- Complete schema
- All properties
- All nested options

**Warning**: Large response, use only when standard insufficient

### Search Properties Mode

**✅ Looking for specific field**
```javascript
get_node({
  nodeType: "nodes-base.httpRequest",
  mode: "search_properties",
  propertyQuery: "auth"
});
```

**Use**: Find authentication, headers, body fields, etc.

### Decision Tree

1. Starting a new node config → `get_node` (standard).
2. Standard has what you need → configure with it. Otherwise continue.
3. Looking for a specific field → `search_properties` mode. Otherwise continue.
4. Still need more → `get_node({detail: "full"})`.

---

## Property Dependencies Deep Dive

Fields have `displayOptions` visibility rules: `show`/`hide` blocks where multiple conditions are AND'd and multiple values are OR'd (e.g. `body` shows when `sendBody=true` AND `method IN (POST, PUT, PATCH)`). The three recurring patterns are the boolean toggle (sendBody → body), the operation switch (post vs update show different fields), and type selection (string vs boolean conditions). To find what controls a field, use `get_node({mode: "search_properties", propertyQuery: "..."})` or `get_node({detail: "full"})` — especially when validation flags a field you don't see.

Mechanism details, all four dependency patterns, complex flows, nested dependencies, and troubleshooting are in **[DEPENDENCIES.md](DEPENDENCIES.md)** (quick-reference recap under [Quick Reference: displayOptions and Common Dependency Patterns](DEPENDENCIES.md#quick-reference-displayoptions-and-common-dependency-patterns)).

---

## Common Node Patterns

### Pattern 1: Resource/Operation Nodes

**Examples**: Slack, Google Sheets, Airtable

**Structure**:
```javascript
{
  "resource": "<entity>",      // What type of thing
  "operation": "<action>",     // What to do with it
  // ... operation-specific fields
}
```

**How to configure**:
1. Choose resource
2. Choose operation
3. Use get_node to see operation-specific requirements
4. Configure required fields

### Pattern 2: HTTP-Based Nodes

**Examples**: HTTP Request, Webhook

**Structure**:
```javascript
{
  "method": "<HTTP_METHOD>",
  "url": "<endpoint>",
  "authentication": "<type>",
  // ... method-specific fields
}
```

**Dependencies**:
- POST/PUT/PATCH → sendBody available
- sendBody=true → body required
- authentication != "none" → credentials required

**Critical: credentials block, node id, typeVersion**
- **Never set a placeholder credential ID** (e.g. `"id": "REPLACE_ME"`) — n8n's UI renders a permanently disabled credential selector for unknown IDs. Omit the `credentials` block when the real ID is unknown; the user then gets a normal clickable dropdown.
- **Node `id` must be a UUID v4**, not a readable slug — the frontend binds forms and the credential component to it.
- **Don't hardcode old `typeVersion` values** — verify the current version with `get_node` (httpRequest is 4.4+).

### Pattern 3: Database Nodes

**Examples**: Postgres, MySQL, MongoDB

**Structure**:
```javascript
{
  "operation": "<query|insert|update|delete>",
  // ... operation-specific fields
}
```

**Dependencies**:
- operation="executeQuery" → query required
- operation="insert" → table + values required
- operation="update" → table + values + where required

**Critical: Write operations may return 0 items**
- INSERT, UPDATE, DELETE can produce 0 n8n output items, depending on the node and operation (raw query execution reliably returns 0 result rows; some database nodes return the affected rows)
- Set `alwaysOutputData: true` on write-operation nodes to keep downstream chains alive
- Downstream nodes should use `$('UpstreamNode').all()` instead of `$input` if they need data

### Pattern 4: Conditional Logic Nodes

**Examples**: IF, Switch, Merge

**Structure**:
```javascript
{
  "conditions": {
    "<type>": [
      {
        "operation": "<operator>",
        "value1": "...",
        "value2": "..."  // Only for binary operators
      }
    ]
  }
}
```

**Dependencies**:
- Binary operators (equals, contains, etc.) → value1 + value2
- Unary operators (isEmpty, isNotEmpty) → value1 only + singleValue: true

---

## Operation-Specific Configuration

Required fields shift with resource + operation: Slack `post` needs `channel`+`text`, but `update` needs `messageId`+`text` (channel optional) and `channel/create` needs `name`. HTTP `GET` uses `sendQuery`+`queryParameters`; `POST` needs `sendBody`+`body`. IF binary operators (`equals`) need `value1`+`value2`; unary (`isEmpty`) need only `value1` plus auto-added `singleValue: true`. Concrete minimal configs for each in **[OPERATION_PATTERNS.md](OPERATION_PATTERNS.md#operation-specific-configuration-examples)**.

---

## Handling Conditional Requirements

Some fields are required only under certain conditions: HTTP `body` is required when `sendBody=true` AND `method IN (POST, PUT, PATCH, DELETE)`; IF `singleValue` should be `true` when the operator is unary (`isEmpty`, `isNotEmpty`, `true`, `false`) — and auto-sanitization sets it for you. Discover conditional requirements by reading the validation error, searching the property (`get_node({mode: "search_properties"})`), or iterating from a minimal config. Worked discovery examples in **[DEPENDENCIES.md](DEPENDENCIES.md#handling-conditional-requirements)**.

---

## Node-Specific Configuration Notes

### SplitInBatches v3

```javascript
{
  "batchSize": 100,  // Number of items per batch
  "options": {}
}
```

**Output wiring**:
- `main[0]` (done) → Connect to downstream processing (add Limit 1 first)
- `main[1]` (each batch) → Connect to loop body, then loop back to SplitInBatches input

See the n8n Workflow Patterns skill for detailed loop and nested loop patterns.

### Google Sheets Node

**Per-item execution**: Each input item triggers a separate API call. If you have 100 items and use a Google Sheets "Append Row" node, it makes 100 API calls. To write in bulk, aggregate items in a Code node first, then use a single HTTP Request with the Sheets API.

**Formula columns**: Never use `append` on sheets with formula columns — it overwrites formulas. Instead, use HTTP Request with Google Sheets API `values.update` (PUT) method and a `googleApi` credential.

---

## Configuration Anti-Patterns

### ❌ Don't: Over-configure Upfront

**Bad**:
```javascript
// Adding every possible field
{
  "method": "GET",
  "url": "...",
  "sendQuery": false,
  "sendHeaders": false,
  "sendBody": false,
  "timeout": 10000,
  "ignoreResponseCode": false,
  // ... 20 more optional fields
}
```

**Good**:
```javascript
// Start minimal
{
  "method": "GET",
  "url": "...",
  "authentication": "none"
}
// Add fields only when needed
```

### ❌ Don't: Skip Validation

**Bad**:
```javascript
// Configure and deploy without validating
const config = {...};
n8n_update_partial_workflow({...});  // YOLO
```

**Good**:
```javascript
// Validate before deploying
const config = {...};
const result = validate_node({...});
if (result.valid) {
  n8n_update_partial_workflow({...});
}
```

### ❌ Don't: Ignore Operation Context

**Bad**:
```javascript
// Same config for all Slack operations
{
  "resource": "message",
  "operation": "post",
  "channel": "#general",
  "text": "..."
}

// Then switching operation without updating config
{
  "resource": "message",
  "operation": "update",  // Changed
  "channel": "#general",  // Wrong field for update!
  "text": "..."
}
```

**Good**:
```javascript
// Check requirements when changing operation
get_node({
  nodeType: "nodes-base.slack"
});
// See what update operation needs (messageId, not channel)
```

---

## Surgical Field Edits with patchNodeField

When you need to edit a specific string inside a node field — rather than replacing the whole field — use `patchNodeField` in `n8n_update_partial_workflow`. This is especially useful for:

- Editing code inside Code nodes without re-transmitting the full code block
- Updating URLs or text in large HTML email templates
- Fixing typos in JSON bodies or long text fields

```javascript
// Instead of replacing the entire jsCode field:
n8n_update_partial_workflow({
  id: "wf-123",
  operations: [{
    type: "patchNodeField",
    nodeName: "Code",
    fieldPath: "parameters.jsCode",
    patches: [{find: "const limit = 10;", replace: "const limit = 50;"}]
  }]
})
```

`patchNodeField` is strict — it errors if the find string isn't found or matches multiple times (unless `replaceAll: true`). This prevents accidental silent failures during configuration updates. See the n8n MCP Tools Expert skill for full syntax and examples.

---

## Best Practices

### Do

1. **Start with get_node (standard detail)**
   - ~1-2K tokens response
   - Covers 95% of configuration needs
   - Default detail level

2. **Validate iteratively**
   - Configure → Validate → Fix → Repeat
   - Average 2-3 iterations is normal
   - Read validation errors carefully

3. **Use search_properties mode when stuck**
   - If field seems missing, search for it
   - Understand what controls field visibility
   - `get_node({mode: "search_properties", propertyQuery: "..."})`

4. **Respect operation context**
   - Different operations = different requirements
   - Always check get_node when changing operation
   - Don't assume configs are transferable

5. **Trust auto-sanitization**
   - Operator structure fixed automatically
   - Don't manually add/remove singleValue
   - IF/Switch metadata added on save

### ❌ Don't

1. **Jump to detail="full" immediately**
   - Try standard detail first
   - Only escalate if needed
   - Full schema is 3-8K tokens

2. **Configure blindly**
   - Always validate before deploying
   - Understand why fields are required
   - Use search_properties for conditional fields

3. **Copy configs without understanding**
   - Different operations need different fields
   - Validate after copying
   - Adjust for new context

4. **Manually fix auto-sanitization issues**
   - Let auto-sanitization handle operator structure
   - Focus on business logic
   - Save and let system fix structure

---

## Silent-Failure Gotchas by Node Family

Some misconfigurations pass `validate_node` and `validate_workflow` clean, run without error, and quietly do the wrong thing — `get_node` shows the fields exist but not what happens when you omit them. The high-frequency ones:

- **Switch** — no `options.fallbackOutput` ⇒ unmatched items silently dropped.
- **Merge** — `numberOfInputs` defaults to 2 (extra sources drop); `useDataOfInput` is 1-indexed vs the 0-indexed `connections.<src>.main[idx]` slot (`useDataOfInput: "N"` → `main[N-1]`).
- **Database** — `{{ }}` interpolation into `parameters.query` is SQL injection; use `$1/$2` placeholders + `options.queryReplacement`.
- **Slack** — Block Kit must be wrapped `={{ { "blocks": ... } }}` or it posts as plain text.
- **Webhook / Respond** — `responseCode` defaults to 200 even on error branches.
- **Schedule Trigger** — timezone is workflow-level (Workflow Settings), not per-rule.

Full symptom/cause/fix detail (in JSON + `n8n_update_partial_workflow` terms) in **[NODE_FAMILY_GOTCHAS.md](NODE_FAMILY_GOTCHAS.md)**.

---

## Detailed References

For comprehensive guides on specific topics:

- **[DEPENDENCIES.md](DEPENDENCIES.md)** - Deep dive into property dependencies and displayOptions
- **[OPERATION_PATTERNS.md](OPERATION_PATTERNS.md)** - Common configuration patterns by node type
- **[NODE_FAMILY_GOTCHAS.md](NODE_FAMILY_GOTCHAS.md)** - Silent runtime traps by family (Switch, Merge, Database, Slack, Webhook, Schedule)

---

## Summary

**Configuration Strategy**:
1. Start with `get_node` (standard detail is default)
2. Configure required fields for operation
3. Validate configuration
4. Search properties if stuck
5. Iterate until valid (avg 2-3 cycles)
6. Deploy with confidence

**Key Principles**:
- **Operation-aware**: Different operations = different requirements
- **Progressive disclosure**: Start minimal, add as needed
- **Dependency-aware**: Understand field visibility rules
- **Validation-driven**: Let validation guide configuration

**Related Skills**:
- **n8n MCP Tools Expert** - How to use discovery tools correctly
- **n8n Validation Expert** - Interpret validation errors
- **n8n Expression Syntax** - Configure expression fields
- **n8n Workflow Patterns** - Apply patterns with proper configuration
