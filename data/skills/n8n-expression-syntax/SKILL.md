---
name: n8n-expression-syntax
description: Validate n8n expression syntax and fix common errors. Use when writing n8n expressions, using {{}} syntax, accessing $json/$node variables, troubleshooting expression errors, mapping data between nodes, or referencing webhook data in workflows. Use this skill whenever configuring node fields that reference data from previous nodes — expressions are how n8n passes data between nodes, and getting the syntax wrong is the most common source of workflow errors. Also use when asked whether a complex expression hurts performance.
---

# n8n Expression Syntax

Expert guide for writing correct n8n expressions in workflows.

---

## Expression Format

All dynamic content in n8n uses **double curly braces**:

```
{{expression}}
```

**Examples**:
```
✅ {{$json.email}}
✅ {{$json.body.name}}
✅ {{$node["HTTP Request"].json.data}}
❌ $json.email  (no braces - treated as literal text)
❌ {$json.email}  (single braces - invalid)
```

---

## Core Variables

### $json - Current Node Output

Access data from the current node:

```javascript
{{$json.fieldName}}
{{$json['field with spaces']}}
{{$json.nested.property}}
{{$json.items[0].name}}
```

### $node - Reference Other Nodes

Access data from any previous node:

```javascript
{{$node["Node Name"].json.fieldName}}
{{$node["HTTP Request"].json.data}}
{{$node["Webhook"].json.body.email}}
```

**Important**:
- Node names **must** be in quotes
- Node names are **case-sensitive**
- Must match exact node name from workflow

### $now - Current Timestamp

Access current date/time:

```javascript
{{$now}}
{{$now.toFormat('yyyy-MM-dd')}}
{{$now.toFormat('HH:mm:ss')}}
{{$now.plus({days: 7})}}
```

### $env - Environment Variables

Access environment variables:

```javascript
{{$env.API_KEY}}
{{$env.DATABASE_URL}}
```

**Warning**: Some n8n instances have `N8N_BLOCK_ENV_ACCESS_IN_NODE` enabled, which blocks `$env` access entirely. If `$env` returns errors, use alternative approaches:
- Store values in credentials instead
- Use a Set node with manually entered values
- Pass values through webhook query parameters

---

## 🚨 CRITICAL: Webhook Data Structure

**Most Common Mistake**: Webhook data is **NOT** at the root!

### Webhook Node Output Structure

```javascript
{
  "headers": {...},
  "params": {...},
  "query": {...},
  "body": {           // ⚠️ USER DATA IS HERE!
    "name": "John",
    "email": "john@example.com",
    "message": "Hello"
  }
}
```

### Correct Webhook Data Access

```javascript
❌ WRONG: {{$json.name}}
❌ WRONG: {{$json.email}}

✅ CORRECT: {{$json.body.name}}
✅ CORRECT: {{$json.body.email}}
✅ CORRECT: {{$json.body.message}}
```

**Why**: Webhook node wraps incoming data under `.body` property to preserve headers, params, and query parameters.

---

## Common Patterns

### Access Nested Fields

```javascript
// Simple nesting
{{$json.user.email}}

// Array access
{{$json.data[0].name}}
{{$json.items[0].id}}

// Bracket notation for spaces
{{$json['field name']}}
{{$json['user data']['first name']}}
```

### Reference Other Nodes

```javascript
// Node without spaces
{{$node["Set"].json.value}}

// Node with spaces (common!)
{{$node["HTTP Request"].json.data}}
{{$node["Respond to Webhook"].json.message}}

// Webhook node
{{$node["Webhook"].json.body.email}}
```

### Combine Variables

```javascript
// Concatenation (automatic)
Hello {{$json.body.name}}!

// In URLs
https://api.example.com/users/{{$json.body.user_id}}

// In object properties
{
  "name": "={{$json.body.name}}",
  "email": "={{$json.body.email}}"
}
```

---

## When NOT to Use Expressions

### ❌ Code Nodes

Code nodes use **direct JavaScript access**, NOT expressions!

```javascript
// ❌ WRONG in Code node
const email = '={{$json.email}}';
const name = '{{$json.body.name}}';

// ✅ CORRECT in Code node
const email = $json.email;
const name = $json.body.name;

// Or using Code node API
const email = $input.item.json.email;
const allItems = $input.all();
```

### ❌ Webhook Paths

```javascript
// ❌ WRONG
path: "{{$json.user_id}}/webhook"

// ✅ CORRECT
path: "user-webhook"  // Static paths only
```

### ❌ Credential Fields

```javascript
// ❌ WRONG
apiKey: "={{$env.API_KEY}}"

// ✅ CORRECT
Use n8n credential system, not expressions
```

---

## The transform gatekeeper

Before you add any node — or write any code — to transform data, walk this order and stop at the first that fits:

1. **Expression** (`{{ ... }}`) in the consuming field. Property access, method chains (`.map().filter().join()`), ternaries, string building, Luxon date math — if it's "take A, produce B" without intermediate variables, it's an expression. This covers most "just transform this" cases.
2. **Arrow-function IIFE inside an Edit Fields field.** When the logic needs intermediate variables, branching, or comments but still operates on one item, wrap it in an immediately-invoked arrow function right in the field value:

   ```
   ={{ (() => {
       const items = $json.line_items;
       const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
       const tax = subtotal * 0.08;
       return (subtotal + tax).toFixed(2);
   })() }}
   ```

   The outer `(...)` brackets the function; the trailing `()` invokes it. Drop either and n8n refuses to run. Inside you get the full expression scope (`$json`, `$('Node')`, `$now`, Luxon) plus `const`/`let`, `if`/`switch`, `try`/`catch`, and regex. No `require`, no `await`.
3. **Code node — last resort.** Only when you need multi-item aggregation across the whole dataset (`$input.all()`), an allowlisted library, or async work.

**Why the order matters.** It's not style — it's readability and performance. The Code node runs in a sandboxed VM with per-invocation setup and value marshaling — a cold-start cost that can reach 500–1000ms before your logic runs. (It amortizes on warm, high-item-count runs, so treat this as the common-case cost, not a universal constant.) The same logic in an expression or Edit Fields IIFE runs in-process in single-digit milliseconds and skips the sandbox entirely. For pure single-item shaping that's a large gap with no functional difference, and it compounds on hot paths like per-request webhooks. The expression also stays visible in the field that uses it, instead of hiding in an upstream node someone has to open to understand. Reach past a stage only when the input or scope genuinely demands it.

## The Set-node antipattern and branch convergence

### Delete Set nodes that feed one consumer

A Set / Edit Fields node whose only job is to extract a value and hand it to **one** downstream node is dead weight. Inline its expression at the consumer instead.

```
❌  Webhook → Set { customer_id: {{ $json.body.customer_id }} } → Postgres: WHERE id = {{ $json.customer_id }}

✅  Webhook → Postgres: WHERE id = {{ $('Webhook').item.json.body.customer_id }}
```

The Set node adds a hop, more canvas clutter, and a refactor hazard, while doing nothing the consumer couldn't do itself. To remove it cleanly with `n8n_update_partial_workflow`: rewire the connection (`removeConnection` from the Set's source-and-target, `addConnection` straight from source to consumer), `patchNodeField` the consumer's expression to reference the original source by node name, then `removeNode` the Set.

**Quick test:** count how many downstream nodes reference each field the Set produces.
- **0 or 1** → delete, inline at the consumer.
- **2+** → it may earn its place.

**Legitimate exceptions** — keep the Set when:
- **2+ consumers** read the same derived value and the derivation is non-trivial (a name aids readability and you compute it once).
- **It's a sub-workflow's final Return node**, shaping the output contract. Here the "single consumer" is every caller, so the Set *is* the API boundary — and with `Include Other Fields: false` it whitelists the output shape so internal scratch fields don't leak.
- **You're renaming or whitelisting fields** and want that visible in one place rather than spread across consumer expressions.

### Branch convergence: anchor with a NoOp

When branches converge (after IF/Switch/Merge), `$json` becomes "whichever branch fired last" — non-deterministic, and a silent source of wrong data. Insert a **NoOp** node at the convergence, name it descriptively (`Combine Inputs`), and have downstream nodes reference it by name:

```
Branch A ──┐
           ├─→ [NoOp: Combine Inputs] ──→ downstream uses $('Combine Inputs').item.json.x
Branch B ──┘
```

The NoOp survives refactors: inserting a transform later between it and the consumer doesn't break the `$('Combine Inputs')` reference. (If the branches produce *different* shapes, use a Set node instead of a NoOp to normalize both into one shape — see the exceptions above.)

More broadly in branchy flows, **prefer `$('Node').item.json.x` over deep `$json.x`.** `$json` breaks the moment an intermediate node is inserted or a node clears item context (Aggregate, Code with Run for All, branching merges); the failure is silent and downstream gets the wrong data with no error. A node-name reference is unambiguous regardless of what sits between source and consumer.

---

## Validation Rules

### 1. Always Use {{}}

Expressions **must** be wrapped in double curly braces.

```javascript
❌ $json.field
✅ {{$json.field}}
```

### 2. Use Quotes for Spaces and Special Characters

Field or node names with spaces, diacritics, or special characters require **bracket notation**:

```javascript
❌ {{$json.field name}}
✅ {{$json['field name']}}

❌ {{$node.HTTP Request.json}}
✅ {{$node["HTTP Request"].json}}

// Bracket notation is mandatory for keys with special characters
✅ {{$json['Gross Price w/o shipment']}}
✅ {{$json['Cena brutto zł']}}
```

### 3. Match Exact Node Names

Node references are **case-sensitive**:

```javascript
❌ {{$node["http request"].json}}  // lowercase
❌ {{$node["Http Request"].json}}  // wrong case
✅ {{$node["HTTP Request"].json}}  // exact match
```

### 4. No Nested {{}}

Don't double-wrap expressions:

```javascript
❌ {{{$json.field}}}
✅ {{$json.field}}
```

---

## Common Mistakes

For complete error catalog with fixes, see [COMMON_MISTAKES.md](COMMON_MISTAKES.md)

### Quick Fixes

| Mistake | Fix |
|---------|-----|
| `$json.field` | `{{$json.field}}` |
| `{{$json.field name}}` | `{{$json['field name']}}` |
| `{{$node.HTTP Request}}` | `{{$node["HTTP Request"]}}` |
| `{{{$json.field}}}` | `{{$json.field}}` |
| `{{$json.name}}` (webhook) | `{{$json.body.name}}` |
| `'={{$json.email}}'` (Code node) | `$json.email` |

---

## Working Examples

For real workflow examples, see [EXAMPLES.md](EXAMPLES.md)

### Example 1: Webhook to Slack

**Webhook receives**:
```json
{
  "body": {
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello!"
  }
}
```

**In Slack node text field**:
```
New form submission!

Name: {{$json.body.name}}
Email: {{$json.body.email}}
Message: {{$json.body.message}}
```

### Example 2: HTTP Request to Email

**HTTP Request returns**:
```json
{
  "data": {
    "items": [
      {"name": "Product 1", "price": 29.99}
    ]
  }
}
```

**In Email node** (reference HTTP Request):
```
Product: {{$node["HTTP Request"].json.data.items[0].name}}
Price: ${{$node["HTTP Request"].json.data.items[0].price}}
```

### Example 3: Format Timestamp

```javascript
// Current date
{{$now.toFormat('yyyy-MM-dd')}}
// Result: 2025-10-20

// Time
{{$now.toFormat('HH:mm:ss')}}
// Result: 14:30:45

// Full datetime
{{$now.toFormat('yyyy-MM-dd HH:mm')}}
// Result: 2025-10-20 14:30
```

---

## Data Type Handling

### Arrays

```javascript
// First item
{{$json.users[0].email}}

// Array length
{{$json.users.length}}

// Last item
{{$json.users[$json.users.length - 1].name}}
```

### Objects

```javascript
// Dot notation (no spaces)
{{$json.user.email}}

// Bracket notation (with spaces or dynamic)
{{$json['user data'].email}}
```

### Strings

```javascript
// Concatenation (automatic)
Hello {{$json.name}}!

// String methods
{{$json.email.toLowerCase()}}
{{$json.name.toUpperCase()}}
```

### Numbers

```javascript
// Direct use
{{$json.price}}

// Math operations
{{$json.price * 1.1}}  // Add 10%
{{$json.quantity + 5}}
```

---

## Advanced Patterns

### Conditional Content

```javascript
// Ternary operator
{{$json.status === 'active' ? 'Active User' : 'Inactive User'}}

// Default values
{{$json.email || 'no-email@example.com'}}
```

### Date Manipulation

```javascript
// Add days
{{$now.plus({days: 7}).toFormat('yyyy-MM-dd')}}

// Subtract hours
{{$now.minus({hours: 24}).toISO()}}

// Set specific date
{{DateTime.fromISO('2025-12-25').toFormat('MMMM dd, yyyy')}}
```

### String Manipulation

```javascript
// Substring
{{$json.email.substring(0, 5)}}

// Replace
{{$json.message.replace('old', 'new')}}

// Split and join
{{$json.tags.split(',').join(', ')}}
```

---

## Performance: expression complexity is (almost) free

A common worry is that a complex `{{ }}` is slow. It isn't — what costs is *how many times* n8n evaluates an expression, not how elaborate each one is.

Measured on an n8n 2.x instance, an elaborate expression (`sqrt`, `split`, `reduce`, arithmetic) costs the same per item as a trivial `{{ $json.x > 50 }}` — roughly **~0.2 ms/item either way**, because ~90% of that is n8n building the per-item evaluation context, not running your expression.

What this means in practice:

- **Don't break a working expression into a chain of nodes for "speed."** Each extra node re-evaluates per item and re-copies all items; one node with one richer expression beats three nodes with simple ones.
- **An expression (~0.2 ms/item) is ~3× cheaper than a Code node in "Run Once for Each Item" mode** (~0.6 ms/item) for the same per-item check — but a Code node in "Run Once for All Items" mode is cheaper still (~0.02 ms/item), because it crosses the per-item boundary once instead of N times.
- This only bites at **thousands of items**; below that it's sub-100 ms. The **n8n Code JavaScript** skill has the full per-item-boundary model.

---

## Debugging Expressions

### Test in Expression Editor

1. Click field with expression
2. Open expression editor (click "fx" icon)
3. See live preview of result
4. Check for errors highlighted in red

### Common Error Messages

**"Cannot read property 'X' of undefined"**
→ Parent object doesn't exist
→ Check your data path

**"X is not a function"**
→ Trying to call method on non-function
→ Check variable type

**Expression shows as literal text**
→ Missing {{ }}
→ Add curly braces

---

## Expression Helpers

### Available Methods

**String**:
- `.toLowerCase()`, `.toUpperCase()`
- `.trim()`, `.replace()`, `.substring()`
- `.split()`, `.includes()`

**Array**:
- `.length`, `.map()`, `.filter()`
- `.find()`, `.join()`, `.slice()`

**DateTime** (Luxon):
- `.toFormat()`, `.toISO()`, `.toLocal()`
- `.plus()`, `.minus()`, `.set()`

**Number**:
- `.toFixed()`, `.toString()`
- Math operations: `+`, `-`, `*`, `/`, `%`

---

## Best Practices

### ✅ Do

- Always use {{ }} for dynamic content
- Use bracket notation for field names with spaces
- Reference webhook data from `.body`
- Use $node for data from other nodes
- Test expressions in expression editor

### ❌ Don't

- Don't use expressions in Code nodes
- Don't forget quotes around node names with spaces
- Don't double-wrap with extra {{ }}
- Don't assume webhook data is at root (it's under .body!)
- Don't use expressions in webhook paths or credentials

---

## Related Skills

- **n8n MCP Tools Expert**: Learn how to validate expressions using MCP tools
- **n8n Workflow Patterns**: See expressions in real workflow examples
- **n8n Node Configuration**: Understand when expressions are needed

---

## Summary

**Essential Rules**:
1. Wrap expressions in {{ }}
2. Webhook data is under `.body`
3. No {{ }} in Code nodes
4. Quote node names with spaces
5. Node names are case-sensitive

**Most Common Mistakes**:
- Missing {{ }} → Add braces
- `{{$json.name}}` in webhooks → Use `{{$json.body.name}}`
- `{{$json.email}}` in Code → Use `$json.email`
- `{{$node.HTTP Request}}` → Use `{{$node["HTTP Request"]}}`

For more details, see:
- [COMMON_MISTAKES.md](COMMON_MISTAKES.md) - Complete error catalog
- [EXAMPLES.md](EXAMPLES.md) - Real workflow examples

---

**Need Help?** Reference the n8n expression documentation or use n8n-mcp validation tools to check your expressions.
