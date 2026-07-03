# Error Patterns - JavaScript Code Node

Complete guide to avoiding the most common Code node errors.

---

## Overview

This guide covers the **top 5 error patterns** encountered in n8n Code nodes. Understanding and avoiding these errors will save you significant debugging time.

**Error frequency (roughly ordered)**:
1. Empty Code / Missing Return - the dominant error n8n itself rejects
2. Expression Syntax used as Code - `{{ }}` written where JavaScript belongs
3. Return Shape - primitive/`null` returns (bare objects auto-wrap)
4. Broken Strings / Escaping - unbalanced quotes/brackets throw a JS syntax error
5. Missing Null Checks - common runtime error

---

## Error #1: Empty Code or Missing Return Statement

**Frequency**: Most common error (38% of all validation failures)

**What Happens**:
- Workflow execution fails
- Next nodes receive no data
- Error: "Code cannot be empty" or "Code must return data"

### The Problem

```javascript
// ❌ ERROR: No code at all
// (Empty code field)
```

```javascript
// ❌ ERROR: Code executes but doesn't return anything
const items = $input.all();

// Process items
for (const item of items) {
  console.log(item.json.name);
}

// Forgot to return!
```

```javascript
// ❌ ERROR: Early return path exists, but not all paths return
const items = $input.all();

if (items.length === 0) {
  return [];  // ✅ This path returns
}

// Process items
const processed = items.map(item => ({json: item.json}));

// ❌ Forgot to return processed!
```

### The Solution

```javascript
// ✅ CORRECT: Always return data
const items = $input.all();

// Process items
const processed = items.map(item => ({
  json: {
    ...item.json,
    processed: true
  }
}));

return processed;  // ✅ Return statement present
```

```javascript
// ✅ CORRECT: Return empty array if no items
const items = $input.all();

if (items.length === 0) {
  return [];  // Valid: empty array when no data
}

// Process and return
return items.map(item => ({json: item.json}));
```

```javascript
// ✅ CORRECT: All code paths return
const items = $input.all();

if (items.length === 0) {
  return [];
} else if (items.length === 1) {
  return [{json: {single: true, data: items[0].json}}];
} else {
  return items.map(item => ({json: item.json}));
}

// All paths covered
```

### Checklist

- [ ] Code field is not empty
- [ ] Return statement exists
- [ ] ALL code paths return data (if/else branches)
- [ ] Return format is correct (`[{json: {...}}]`)
- [ ] Return happens even on errors (use try-catch)

---

## Error #2: Expression Syntax Confusion

**What Happens** — there are two distinct cases, and only one is a syntax error:
- **`{{ }}` inside a string literal**: valid JavaScript that runs fine, but you get the *literal text* `{{ ... }}` instead of a value — n8n does not evaluate expressions inside Code-node code. A logic bug, not a validation error. (n8n-mcp ≥ 2.63.0 no longer flags `{{ }}` inside string literals — prompt templates, payload placeholders, and `.replace()` tokens are legitimate.)
- **`{{ }}` written as bare code** (e.g. `return {{ $json.x }}`): a genuine JavaScript syntax error. The validator reports "Expression syntax {{...}} is not valid in Code nodes" and n8n throws "Unexpected token".

### The Problem

n8n has TWO distinct syntaxes:
1. **Expression syntax** `{{ }}` - Used in OTHER nodes (Set, IF, HTTP Request)
2. **JavaScript** - Used in CODE nodes

Many developers mistakenly reach for expression syntax inside a Code node when they want a *value*. Putting `{{ }}` in a string does not interpolate it:

```javascript
// ❌ LOGIC BUG: n8n never evaluates {{ }} in Code-node strings
const userName = "{{ $json.name }}";
const userEmail = "{{ $json.body.email }}";

return [{
  json: {
    name: userName,
    email: userEmail
  }
}];

// Result: Literal string "{{ $json.name }}", NOT the value!
// (This runs — it just doesn't do what you meant. Use $json.name directly.)
```

```javascript
// ❌ SYNTAX ERROR: {{ }} used as code, not inside a string
const value = {{ $now.toFormat('yyyy-MM-dd') }};  // "Unexpected token"
```

### The Solution

```javascript
// ✅ CORRECT: Use JavaScript directly (no {{ }})
const userName = $json.name;
const userEmail = $json.body.email;

return [{
  json: {
    name: userName,
    email: userEmail
  }
}];
```

```javascript
// ✅ CORRECT: JavaScript template literals (use backticks)
const message = `Hello, ${$json.name}! Your email is ${$json.email}`;

return [{
  json: {
    greeting: message
  }
}];
```

```javascript
// ✅ CORRECT: Direct variable access
const item = $input.first().json;

return [{
  json: {
    name: item.name,
    email: item.email,
    timestamp: new Date().toISOString()  // JavaScript Date, not {{ }}
  }
}];
```

### Comparison Table

| Context | Syntax | Example |
|---------|--------|---------|
| Set node | `{{ }}` expressions | `{{ $json.name }}` |
| IF node | `{{ }}` expressions | `{{ $json.age > 18 }}` |
| HTTP Request URL | `{{ }}` expressions | `{{ $json.userId }}` |
| **Code node** | **JavaScript** | `$json.name` |
| **Code node strings** | **Template literals** | `` `Hello ${$json.name}` `` |

### Quick Fix Guide

```javascript
// WRONG → RIGHT conversions

// ❌ "{{ $json.field }}"
// ✅ $json.field

// ❌ "{{ $now }}"
// ✅ new Date().toISOString()

// ❌ "{{ $node['HTTP Request'].json.data }}"
// ✅ $node["HTTP Request"].json.data

// ❌ `{{ $json.firstName }} {{ $json.lastName }}`
// ✅ `${$json.firstName} ${$json.lastName}`
```

---

## Error #3: Return Shape

**What actually happens** — n8n is more forgiving than the old advice implied:
- In *Run Once for All Items* mode, n8n **auto-normalizes** a single bare object, or an array of bare objects, by wrapping each under a `json` property. So these run.
- What genuinely fails, with "Code doesn't return items properly", is returning a **primitive** (string/number/boolean) or **`null`/`undefined`** — there is nothing to wrap.

(n8n-mcp ≥ 2.63.0 no longer errors "Return value must be an array of objects" on a bare-object return; the earlier claim contradicted n8n's auto-wrap behavior.)

### Prefer the Canonical Form

The canonical `[{json: {...}}]` is unambiguous and behaves identically in both execution modes, so make it your default even though looser shapes are auto-wrapped:

```javascript
// ⚠️ Auto-wrapped → [{json: {result: 'success'}}]. Runs, but prefer the array + json form.
return {
  json: {
    result: 'success'
  }
};
```

```javascript
// ⚠️ Auto-wrapped → each object gets a json wrapper. Runs, but be explicit.
return [
  {id: 1, name: 'Alice'},
  {id: 2, name: 'Bob'}
];
```

```javascript
// ✅ Fine — input items already carry a json property; returning them unchanged is a valid passthrough
return $input.all();
```

```javascript
// ❌ FAILS: primitive value — nothing to wrap into an item
return "processed";
```

```javascript
// ❌ FAILS: null / undefined — no items to pass on
return null;
```

### The Solution

```javascript
// ✅ CORRECT: Single result
return [{
  json: {
    result: 'success',
    timestamp: new Date().toISOString()
  }
}];
```

```javascript
// ✅ CORRECT: Multiple results
return [
  {json: {id: 1, name: 'Alice'}},
  {json: {id: 2, name: 'Bob'}},
  {json: {id: 3, name: 'Carol'}}
];
```

```javascript
// ✅ CORRECT: Transforming array
const items = $input.all();

return items.map(item => ({
  json: {
    id: item.json.id,
    name: item.json.name,
    processed: true
  }
}));
```

```javascript
// ✅ CORRECT: Empty result
return [];
// Valid when no data to return
```

```javascript
// ✅ CORRECT: Conditional returns
if (shouldProcess) {
  return [{json: {result: 'processed'}}];
} else {
  return [];
}
```

### Return Format Checklist

- [ ] Return value is an **array** `[...]` (canonical — preferred)
- [ ] Each array element has a **`json` property**
- [ ] Structure is `[{json: {...}}]` or `[{json: {...}}, {json: {...}}]`
- [ ] Not a primitive (string/number/boolean) or `null`/`undefined` — those are the shapes that actually fail

### Common Scenarios

```javascript
// Scenario 1: Single object from API
const response = $input.first().json;

// ✅ CANONICAL
return [{json: response}];

// ⚠️ Auto-wrapped to the same thing — runs, but prefer the array form
return {json: response};


// Scenario 2: Array of objects
const users = $input.all();

// ✅ CANONICAL
return users.map(user => ({json: user.json}));

// ✅ Also fine — a passthrough of items that already carry json
return users;


// Scenario 3: Computed result
const total = $input.all().reduce((sum, item) => sum + item.json.amount, 0);

// ✅ CANONICAL
return [{json: {total}}];

// ⚠️ Auto-wrapped → [{json: {total}}] in All Items mode — runs, but be explicit
return {total};


// Scenario 4: No results
// ✅ CORRECT
return [];

// ❌ FAILS — null has no items to pass on
return null;
```

---

## Error #4: Broken Strings & Escaping (JavaScript syntax errors)

**What Happens**:
- The Code node throws a JavaScript syntax error at execution: "Unexpected token" or "Unexpected end of input"
- Cause is your own JS — unbalanced quotes or a raw newline inside a plain quoted string

This is a plain JavaScript concern, **not** a validator check. The validator (n8n-mcp ≥ 2.63.0) does not flag balanced apostrophes, `{ }` in regex, or `{{ }}` sitting inside a string literal — those are all valid JavaScript. Only genuinely malformed JS throws, and it throws at runtime.

### The Problem

This happens when:
1. A quote inside a same-quoted string is left unescaped
2. A plain (non-template) string spans multiple lines
3. Backslashes in paths/regex are not escaped

```javascript
// ✅ FINE: an apostrophe inside a double-quoted string is valid JavaScript
const message = "It's a nice day";

// ✅ FINE: braces in a regex literal are valid
const pattern = /\{(\w+)\}/;
```

```javascript
// ❌ SYNTAX ERROR: raw newline + unescaped inner double-quotes in a plain string
const html = "
  <div class="container">
    <p>Hello</p>
  </div>
";
```

### The Solution

```javascript
// ✅ Mix quote styles or escape, whichever reads cleaner
const message = "It's a nice day";     // double quotes around an apostrophe — fine
const other   = 'She said "hello"';    // single quotes around double quotes — fine
```

```javascript
// ✅ Regex literals need no extra escaping of their own braces
const pattern = /\{(\w+)\}/;
```

```javascript
// ✅ CORRECT: Template literals for multi-line
const html = `
  <div class="container">
    <p>Hello</p>
  </div>
`;
// Backticks handle multi-line and quotes
```

```javascript
// ✅ CORRECT: Escape backslashes
const path = "C:\\\\Users\\\\Documents\\\\file.txt";
```

### Escaping Guide

| Character | Escape As | Example |
|-----------|-----------|---------|
| Single quote in single-quoted string | `\\'` | `'It\\'s working'` |
| Double quote in double-quoted string | `\\"` | `"She said \\"hello\\""` |
| Backslash | `\\\\` | `"C:\\\\path"` |
| Newline | `\\n` | `"Line 1\\nLine 2"` |
| Tab | `\\t` | `"Column1\\tColumn2"` |

### Best Practices

```javascript
// ✅ BEST: Use template literals for complex strings
const message = `User ${name} said: "Hello!"`;

// ✅ BEST: Use template literals for HTML
const html = `
  <div class="${className}">
    <h1>${title}</h1>
    <p>${content}</p>
  </div>
`;

// ✅ BEST: Use template literals for JSON
const jsonString = `{
  "name": "${name}",
  "email": "${email}"
}`;
```

---

## Error #5: Missing Null Checks / Undefined Access

**Frequency**: Very common runtime error

**What Happens**:
- Workflow execution stops
- Error: "Cannot read property 'X' of undefined"
- Error: "Cannot read property 'X' of null"
- Crashes on missing data

### The Problem

```javascript
// ❌ WRONG: No null check - crashes if user doesn't exist
const email = item.json.user.email;
```

```javascript
// ❌ WRONG: Assumes array has items
const firstItem = $input.all()[0].json;
```

```javascript
// ❌ WRONG: Assumes nested property exists
const city = $json.address.city;
```

```javascript
// ❌ WRONG: No validation before array operations
const names = $json.users.map(user => user.name);
```

### The Solution

```javascript
// ✅ CORRECT: Optional chaining
const email = item.json?.user?.email || 'no-email@example.com';
```

```javascript
// ✅ CORRECT: Check array length
const items = $input.all();

if (items.length === 0) {
  return [];
}

const firstItem = items[0].json;
```

```javascript
// ✅ CORRECT: Guard clauses
const data = $input.first().json;

if (!data.address) {
  return [{json: {error: 'No address provided'}}];
}

const city = data.address.city;
```

```javascript
// ✅ CORRECT: Default values
const users = $json.users || [];
const names = users.map(user => user.name || 'Unknown');
```

```javascript
// ✅ CORRECT: Try-catch for risky operations
try {
  const email = item.json.user.email.toLowerCase();
  return [{json: {email}}];
} catch (error) {
  return [{
    json: {
      error: 'Invalid user data',
      details: error.message
    }
  }];
}
```

### Safe Access Patterns

```javascript
// Pattern 1: Optional chaining (modern, recommended)
const value = data?.nested?.property?.value;

// Pattern 2: Logical OR with default
const value = data.property || 'default';

// Pattern 3: Ternary check
const value = data.property ? data.property : 'default';

// Pattern 4: Guard clause
if (!data.property) {
  return [];
}
const value = data.property;

// Pattern 5: Try-catch
try {
  const value = data.nested.property.value;
} catch (error) {
  const value = 'default';
}
```

### Webhook Data Safety

```javascript
// Webhook data requires extra safety

// ❌ RISKY: Assumes all fields exist
const name = $json.body.user.name;
const email = $json.body.user.email;

// ✅ SAFE: Check each level
const body = $json.body || {};
const user = body.user || {};
const name = user.name || 'Unknown';
const email = user.email || 'no-email';

// ✅ BETTER: Optional chaining
const name = $json.body?.user?.name || 'Unknown';
const email = $json.body?.user?.email || 'no-email';
```

### Array Safety

```javascript
// ❌ RISKY: No length check
const items = $input.all();
const firstId = items[0].json.id;

// ✅ SAFE: Check length
const items = $input.all();

if (items.length > 0) {
  const firstId = items[0].json.id;
} else {
  // Handle empty case
  return [];
}

// ✅ BETTER: Use $input.first()
const firstItem = $input.first();
const firstId = firstItem.json.id;  // Built-in safety
```

### Object Property Safety

```javascript
// ❌ RISKY: Direct access
const config = $json.settings.advanced.timeout;

// ✅ SAFE: Step by step with defaults
const settings = $json.settings || {};
const advanced = settings.advanced || {};
const timeout = advanced.timeout || 30000;

// ✅ BETTER: Optional chaining
const timeout = $json.settings?.advanced?.timeout ?? 30000;
// Note: ?? (nullish coalescing) vs || (logical OR)
```

---

## Error #6: UnsupportedFunctionError (Auth Helpers Blocked)

**Frequency**: The most common "this worked yesterday in old n8n" error after upgrading to v2.0+

**What Happens**:
- Error: `UnsupportedFunctionError: The function "helpers.httpRequestWithAuthentication" is not supported in the Code Node`
- Same for `helpers.requestWithAuthenticationPaginated`
- Throws on execution, not on save

### The Problem

Since n8n v2.0, Code nodes execute in the **task runner sandbox** which deliberately blocks the auth helpers. The legacy vm2 sandbox used to bind them, which is why old forum posts and tutorials show them working. n8n's source comment explains why: the Code node has no credential of its own, so the helper had nothing to authenticate against — it was always semantically broken, just not always loud about it.

```javascript
// ❌ BLOCKED in task runner sandbox (default since v2.0)
const data = await this.helpers.httpRequestWithAuthentication.call(
  this,
  'baseLinkerApi',
  { url: '...', method: 'POST' }
);
```

### The Solution

There is **no env flag** to re-enable these in the runner — the deny-list is compiled-in. Pick one of:

**Option A — Replace the Code node with an HTTP Request node** (best):

The HTTP Request node natively supports credential attachment with full expression support for URL/body/headers. Most "Code-node-makes-an-API-call" patterns are leftovers from before HTTP Request had pagination and expression support.

**Option B — Sub-workflow with HTTP Request node** (when you need code-level logic before/after):

```javascript
// Parent Code node — prepare payloads, then delegate
return $input.all().map(i => ({ json: {
  url: 'https://api.example.com/things',
  method: 'POST',
  body: { sku: i.json.sku }
}}));
```

Then wire to **Execute Workflow** → child workflow with **Execute Workflow Trigger** → **HTTP Request** node using `={{ $json.url }}`, `={{ $json.body }}`, with the credential attached natively.

**Option C — Token as runtime data** (only when the token genuinely flows through the workflow):

```javascript
// ✅ Works — manual auth header, token came from upstream
const token = $('Get Token').first().json.access_token;

const data = await this.helpers.httpRequest({
  url: 'https://api.example.com/data',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Decision Guide

| Need | Use |
|------|-----|
| Single authenticated API call | HTTP Request node directly |
| Many API calls + pre/post processing | Sub-workflow pattern (Option B) |
| Token already in the data flow | Manual `this.helpers.httpRequest()` with header |
| `httpRequestWithAuthentication` | **Doesn't work — pick A, B, or C above** |

---

## Error #7: $env is not defined / Cannot access $env

**Frequency**: Common in hardened production instances

**What Happens**:
- Error: `$env is not defined` or `ReferenceError: $env is not defined`
- Code looks correct, runs fine on dev instance, throws in production

### The Problem

`$env` access is gated by the **`N8N_BLOCK_ENV_ACCESS_IN_NODE`** environment variable. When set to `true` (a common production hardening setting), `$env` is removed from the Code node sandbox entirely. This is increasingly the default in security-conscious deployments.

```javascript
// ❌ Throws if N8N_BLOCK_ENV_ACCESS_IN_NODE=true
const apiKey = $env.API_KEY;
```

### The Solution

Treat secrets as a **credential concern**, not a Code-node concern:

```javascript
// ✅ Token arrives as data from an upstream node that used a credential
const apiKey = $('Set Secret').first().json.apiKey;

// Or: secret was attached server-side by an HTTP Request node with the credential
// — your Code node never sees the raw secret, which is the whole point
```

For values you genuinely need to inject from outside the workflow (config, not secrets), use:
- A **Set** node at the top of the workflow with hardcoded constants, or
- An **n8n credential** referenced by an HTTP Request node, or
- The **External Secrets** integration (`$secrets`) if your edition supports it.

### Why This Matters

Skills and tutorials written before 2024 routinely use `$env.API_KEY` because it was the path of least resistance. Modern n8n setups block it because letting Code nodes read arbitrary env vars is a privilege escalation surface — any user with workflow-edit access could exfiltrate `DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, etc. Don't fight the restriction; route secrets through credentials.

---

## Error Prevention Checklist

Use this checklist before deploying Code nodes:

### Code Structure
- [ ] Code field is not empty
- [ ] Return statement exists
- [ ] All code paths return data

### Return Format
- [ ] Returns items, not a primitive/`null`
- [ ] Canonical shape `[{json: {...}}]` (bare objects auto-wrap, but be explicit)

### Syntax
- [ ] No `{{ }}` written as code (it's for other nodes' fields; in a string it's just literal text)
- [ ] Template literals use backticks: `` `${variable}` ``
- [ ] All quotes and brackets balanced
- [ ] Strings properly escaped

### Data Safety
- [ ] Null checks for optional properties
- [ ] Array length checks before access
- [ ] Webhook data accessed via `.body`
- [ ] Try-catch for risky operations
- [ ] Default values for missing data

### Testing
- [ ] Test with empty input
- [ ] Test with missing fields
- [ ] Test with unexpected data types
- [ ] Check browser console for errors

---

## Quick Error Reference

| Error Message | Likely Cause | Fix |
|---------------|--------------|-----|
| "Code cannot be empty" | Empty code field | Add meaningful code |
| "Code must return data" | Missing return statement | Add `return [...]` |
| "Code doesn't return items properly" | Returned a primitive (string/number) or `null` | Return `[{json:{...}}]` (objects/arrays auto-wrap; primitives don't) |
| "Not all items have a json key" | Mixed return — some items wrapped, some bare | Wrap every item: `{json: {...}}` |
| "Expression syntax {{...}} is not valid in Code nodes" / "Unexpected token" | `{{ }}` written as code (not inside a string) | Use JavaScript: `$json.x` or `` `${$json.x}` `` |
| "Cannot read property X of undefined" | Missing null check | Use optional chaining `?.` |
| "Cannot read property X of null" | Null value access | Add guard clause or default |
| "Unexpected end of input" | Unbalanced quotes/brackets in your JS | Escape strings or use backtick template literals |
| "UnsupportedFunctionError ... httpRequestWithAuthentication" | Auth helper blocked in task runner | Use HTTP Request node + credential, or sub-workflow pattern (Error #6) |
| "$env is not defined" | `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` | Route secrets through credentials, not `$env` (Error #7) |
| "Cannot find module 'crypto'" | `require()` allowlist not set | Move logic out of Code node, or set `N8N_RUNNERS_ALLOWED_BUILT_IN_MODULES` |

---

## Debugging Tips

### 1. Use console.log()

```javascript
const items = $input.all();
console.log('Items count:', items.length);
console.log('First item:', items[0]);

// Check browser console (F12) for output
```

### 2. Return Intermediate Results

```javascript
// Debug by returning current state
const items = $input.all();
const processed = items.map(item => ({json: item.json}));

// Return to see what you have
return processed;
```

### 3. Try-Catch for Troubleshooting

```javascript
try {
  // Your code here
  const result = riskyOperation();
  return [{json: {result}}];
} catch (error) {
  // See what failed
  return [{
    json: {
      error: error.message,
      stack: error.stack
    }
  }];
}
```

### 4. Validate Input Structure

```javascript
const items = $input.all();

// Check what you received
console.log('Input structure:', JSON.stringify(items[0], null, 2));

// Then process
```

---

## Summary

**Top 7 Errors to Avoid**:
1. **Empty code / missing return** - Always return data
2. **Expression syntax as code** - Use JavaScript, not `{{ }}` (in-string `{{ }}` is just literal text)
3. **Return shape** - prefer `[{json: {...}}]`; primitives/`null` fail (bare objects auto-wrap)
4. **Broken strings** - unbalanced quotes/brackets throw a JS syntax error; escape or use template literals
5. **Missing null checks** - Use optional chaining `?.`
6. **`httpRequestWithAuthentication` blocked** - Use HTTP Request node + credential
7. **`$env` blocked** - Route secrets through credentials, not env access

**Quick Prevention**:
- Prefer the canonical `[{json: {...}}]` return; never return a primitive or `null`
- Write JavaScript — don't put `{{ }}` where code belongs
- Check for null/undefined before accessing
- Test with empty and invalid data
- Use browser console for debugging

**See Also**:
- [SKILL.md](SKILL.md) - Overview and best practices
- [DATA_ACCESS.md](DATA_ACCESS.md) - Safe data access patterns
- [COMMON_PATTERNS.md](COMMON_PATTERNS.md) - Working examples
