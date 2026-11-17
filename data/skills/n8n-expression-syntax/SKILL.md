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
- Use n8n Variables (`$vars`, below) when the instance's license includes them
- Use a Set node with manually entered values
- Pass values through webhook query parameters

### $vars - n8n Variables

Read instance variables set in the n8n UI or with `n8n_manage_variables`:

```javascript
{{$vars.API_BASE_URL}}/users
{{$vars.SLACK_CHANNEL}}
```

Values are always strings and read-only at runtime. A missing variable resolves to `undefined` without an error (`{{$vars.API_BASE_URL}}/users` becomes `undefined/users`), so confirm the key with `n8n_manage_variables` (`list`) before using it. Variables need an n8n license that includes them (not the free Community edition). They are visible to every user in their scope, so keep secrets in credentials.

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

Before you add a node — or write any code — to transform data, walk this order and stop at the first that fits:

1. **The service's own node** does it in its own fields: a CRM node's field slots, the Slack node's Blocks field, a
   Data Table insert's per-column slots. HTTP Request only when no node covers the operation.
2. **A native node for the job.** Filter, IF / Switch, Summarize, Aggregate, Split Out, Merge, Compare Datasets, Remove
   Duplicates, Sort + Limit, Date & Time, XML / HTML / Extract From File, HTTP Request pagination, Crypto. The job-to-node
   table in `using-n8n-mcp-skills` maps jobs to nodes; their configs are in `n8n-node-configuration` → NATIVE_NODES.md.
3. **A short expression** (`{{ ... }}`) inside that node's field. Property access, method chains
   (`.map().filter().join()`), a ternary, string building, Luxon date math, the helper functions below — "take A,
   produce B" in one expression, without intermediate variables.
   - **Querying nested JSON for one field** (pick, filter, sum inside an array) → `$jmespath()` in that same expression
     (rules below). When downstream needs one item per element, use Split Out / Filter / Aggregate instead.
4. **Code node**, only for the closed list: loops or recursion no node expresses, state across runs, parsing no node
   handles, an allowlisted library, heavy all-items work (thousands of items, stated or measured), or one short Code node
   (~15 lines) replacing 4+ glue nodes. Give it a `Why Code:` note. See `n8n-code-javascript`.

**A function body is code.** When the logic needs `const`, `if`, `return` or several statements — an
`(() => { ... })()` wrapped in `{{ }}` — it has outgrown an expression. Split it into a native node plus short
expressions, or move it into a Code node with a `Why Code:` note. A long expression is harder to read than either, and a
runtime error inside it resolves silently to `null` (see Debugging). The create/update hooks flag function bodies in
non-Code nodes.

**Why the order matters.** Readability: a native node says on the canvas what it does, and a short expression stays
visible in the field that uses it, instead of hiding in an upstream node someone has to open. Performance rarely decides
it — below a few hundred items none of the costs matter, and the measured model lives in `n8n-code-javascript`.

## `$jmespath()` — query nested JSON in one expression

```
{{ $jmespath($json, "customers[?country=='PL' && revenue > `100000`].name") }}    →  ["Acme"]
```

Verified on n8n 2.38: this one expression returns exactly what Split Out → Filter → Aggregate
returns, with no extra nodes. The syntax is unforgiving, and **most mistakes fail silently**:

| Write | Not | What the wrong form does |
|---|---|---|
| `$jmespath(object, "query")`, object first | `$jmespath("query", object)` | throws `expected two arguments (Object, string) for this function` (JMESPath's own docs show `search(query, data)`) |
| strings in single quotes: `country=='PL'` | `country=="PL"` | double quotes mean a **field name** → returns `[]`, no error |
| numbers/booleans in backticks: `` revenue > `100000` `` | `revenue > 100000` | parse error → whole expression becomes `null` (see Debugging) |
| `&&` `\|\|` `!` `==` | `and` `or` `=` | parse error → `null` |
| hyphenated keys quoted: `'customers[*].contact."first-name"'` (single-quote the JS string) | `contact.first-name` | parse error → `null` |
| over items, keep the wrapper: `$jmespath($('Node').all(), "[?json.country=='PL'].json.name")` or `$jmespath($input.all().map(i => i.json), "[?country=='PL'].name")` | `"[?country=='PL'].name"` on `.all()` | items are `{json: …}` wrappers → `[]` |

- **Results:** missing path or index → `null`; filter with no match → `[]`; `sum()` over an empty
  projection → `0`.
- **First argument must be an object or array.** A string (e.g. an HTTP Request with a text
  response) or `undefined` (`$json.missingField`) throws the same `expected two arguments` error.
  That one does fail the node.
- **Handy pieces:** `length()`, `sum()`, `max_by(arr, &field)`, `sort_by(arr, &field)`,
  `reverse()`, `contains()`, `starts_with()`, `keys()`, `to_number()`; projection `[*]`, flatten
  `[]`, pipe `| [0]`, reshape `{name: name, email: contact.email}`.
- **It returns a value, not items.** Use it where the result feeds one field (message text, HTTP
  body, IF/Filter condition). When downstream needs one item per match, narrow with `$jmespath` in
  Edit Fields and follow with a single Split Out on that field.
- **Where it exists:** expressions and JavaScript Code nodes (same argument order). Not in native
  Python Code nodes.

## Built-in helper functions

n8n adds methods to values inside `{{ }}`. Together with a native node they replace most one-line Code nodes. **They
exist only in expressions, not in Code nodes** — inside Code use plain JavaScript (and `toFormat()` instead of `format()`).
They see only the current item's values: jobs across items (dedupe items, group and total, join two lists) belong in a
node. On n8n-mcp 2.97.0+, `tools_documentation({topic: "expression_helpers", depth: "full"})` lists every helper with a
tested example.

| Need | Expression | Note |
|---|---|---|
| One field from every object | `{{ $json.items.pluck('name') }}` | several names → one array per object |
| Sum / average / min / max | `{{ $json.prices.sum() }}` | throws on non-numbers, numeric strings included |
| Dedupe an array | `{{ $json.rows.unique('email') }}` | each argument is one field name; none → compares whole values (`removeDuplicates` is an alias) |
| Default for an empty value | `{{ $ifEmpty($json.name, 'there') }}` | empty = undefined, null, `''`, `[]`, `{}`; exactly two arguments |
| Email or domain in text | `{{ $json.text.extractEmail() }}`, `.extractDomain()` | `undefined` when nothing matches |
| Hash a string | `{{ $json.email.hash('sha256') }}` | md5 by default; HMAC needs the Crypto node |
| Days between dates | `{{ $now.diffTo($json.created_at, 'days') }}` | receiver minus argument: positive when the argument is earlier |
| String to date | `{{ $json.created_at.toDateTime().format('yyyy-MM-dd') }}` | then `.diffTo()`, `.plus(7, 'days')`, `.extract('month')` |
| Split an array into batches | `{{ $json.ids.chunk(100) }}` | for bulk API bodies |
| Drop empty values | `{{ $json.tags.compact() }}`, `{{ $json.compact() }}` | arrays and objects |

- `diffTo` takes a DateTime, a JS Date or an ISO string, and an optional unit (default `days`) or a list of units (then it
  returns an object). `$json.created_at.toDateTime().diffToNow('days')` is **negative** for past dates.
- `.sum()` over strings throws: `{{ $json.items.pluck('price').map(Number).sum() }}`.
- A helper called on `null` or `undefined` throws: guard with `?.` (`{{ $json.email?.extractDomain() }}`) or `$ifEmpty()`.
- A helper that throws (bad unit, wrong argument count, a missing value) fails the node; a plain JavaScript error inside
  `{{ }}` returns `null` silently. Test with real items either way.

## The Set-node antipattern and branch convergence

### Delete Set nodes that only re-map fields for the next node

A Set / Edit Fields node whose only job is to copy or rename fields so the **next** node can read them is dead weight. Inline its expressions at the consumer instead.

```
❌  Webhook → Set { customer_id: {{ $json.body.customer_id }} } → Postgres: WHERE id = {{ $json.customer_id }}

✅  Webhook → Postgres: WHERE id = {{ $('Webhook').item.json.body.customer_id }}
```

The Set node adds a hop, more canvas clutter, and a refactor hazard, while doing nothing the consumer couldn't do itself. To remove it cleanly with `n8n_update_partial_workflow`: rewire the connection (`removeConnection` from the Set's source-and-target, `addConnection` straight from source to consumer), `patchNodeField` the consumer's expression to reference the original source by node name, then `removeNode` the Set.

**Quick test:** does the Set only re-map fields the next node could read directly (`$('Source').item.json.x`)?
- **Yes** → delete it, inline the expressions at the consumer.
- **No, it creates something** → keep it as a named step (name it for what it produces).

**Edit Fields earns its place** when:
- **It creates a constant item** — fixed config, a default payload, a test fixture.
- **It builds an error or return item** — `{ error: 'validation_error', message: … }` before a Respond, or a sub-workflow's output.
- **It builds a payload object** several nodes, or a whole request body, are built from.
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

A common worry is that a complex `{{ }}` is slow. It isn't — what costs is *how many times* n8n evaluates an
expression, not how elaborate each one is. Measured on n8n 2.x, an elaborate expression (`sqrt`, `split`, `reduce`)
costs about the same per item as `{{ $json.x > 50 }}`: most of the cost is n8n building the per-item evaluation context.

What this means in practice:

- **Don't split a working short expression into extra nodes for speed**, and don't grow it into a function body for
  speed either. Choose by readability: native node, then a short expression, then Code (the gatekeeper above).
- Per-item costs only bite at thousands of items, mostly through the number of per-item boundaries (Code in "Each Item"
  mode is the worst case). The **n8n Code JavaScript** skill has the measured per-item model.

---

## Debugging Expressions

### Runtime errors don't fail the node — they become `null`

Verified on n8n 2.38 with the default expression runtime: during execution the handler around
each `{{ }}` re-throws only n8n's own `ExpressionError`s and swallows other JavaScript errors, so
the field resolves to empty/`null` and the node still reports **success**. `$json.missing.field`
(TypeError), `JSON.parse('{bad')`, `throw new Error(...)` and JMESPath syntax errors all
produced `null`. In a Filter or IF condition every item then silently fails the check. On other
versions or expression engines the same mistake may fail the node instead. Either way, never
trust a green run on its own.

This isn't a reason to avoid expressions (a Code node has silent traps of its own). It's a
reason to **test with real items**:

- Check the expression editor preview against real data. The preview *does* show the error.
- After a test run, look at the output values. `null` where you expected data is the symptom.
  `validate_workflow` and a green execution won't tell you.
- To surface the real message, wrap the expression temporarily:
  `{{ (() => { try { return JSON.stringify(<expr>) } catch (e) { return 'ERROR: ' + e.message } })() }}`
- n8n's own errors still fail the node (e.g. `$jmespath` given a non-object argument).

### Test in Expression Editor

1. Click field with expression
2. Open expression editor (click "fx" icon)
3. See live preview of result
4. Check for errors highlighted in red

### Common Error Messages

These appear in the editor preview; at runtime most of them resolve to `null` instead (see above).

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

**JSON query**:
- `$jmespath(object, "query")`: filter/pick/aggregate nested JSON (see the `$jmespath()` section for the quoting rules)

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
6. Runtime errors inside `{{ }}` become `null` silently. Check output values after a test run
7. `$jmespath(object, "query")`: `'string'`, `` `number` ``, `"field"`; `json.` prefix over `.all()`

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
