# API Workflows

When a workflow is an HTTP API — a Webhook trigger that ends at a `Respond to Webhook` — error handling stops being optional. The caller is a machine waiting on a response, and the failure modes are unforgiving: a hanging branch becomes a timeout, a wrong status code breaks the caller's error handling, a leaked stack trace becomes a security finding.

This file covers wiring that pattern so it behaves under failure, not just on the happy path. For the per-node mechanics, see **NODE_ERROR_OUTPUTS.md**; for body conventions and status codes, **RESPONSE_SHAPES.md**.

---

## The shape

```
Webhook (responseMode: "responseNode")
  → validate input ──valid──→ process ──→ Respond (200, success body)
  │                └─invalid─→ Respond (400, validation_error body)
  └── (any fallible node's error output, sourceIndex 1)
            → Respond (5xx, structured error body)
            → optional: Log full error privately / notify
```

The non-negotiable: **every path ends at a Respond node.** Success, validation failure, execution failure — all of them. A path that doesn't reach a Respond is a hanging branch, and a hanging branch is a caller timeout.

Set `responseMode: "responseNode"` on the Webhook trigger — without it the trigger acknowledges immediately (`onReceived`) and the caller never sees your computed response. (See **n8n-node-configuration** NODE_FAMILY_GOTCHAS.md for the Webhook/Respond traps.)

---

## Wiring every fallible node

For each fallible node (HTTP, DB, third-party, file op), the two-step setup from NODE_ERROR_OUTPUTS.md:

1. `onError: "continueErrorOutput"` on the node.
2. `addConnection` from its `sourceIndex: 1` to your error Respond (directly, or via a logger).

A two-node processing chain, both fallible, both routing to one responder:

```javascript
// Turn on error outputs
{ type: "updateNode", nodeName: "Fetch User",    changes: { onError: "continueErrorOutput" } }
{ type: "updateNode", nodeName: "Call External", changes: { onError: "continueErrorOutput" } }

// Success path
{ type: "addConnection", source: "Webhook",      target: "Fetch User",      sourceIndex: 0 }
{ type: "addConnection", source: "Fetch User",   target: "Call External",   sourceIndex: 0 }
{ type: "addConnection", source: "Call External",target: "Respond Success", sourceIndex: 0 }

// Error paths — both fan in to one responder
{ type: "addConnection", source: "Fetch User",   target: "Respond Error",   sourceIndex: 1 }
{ type: "addConnection", source: "Call External",target: "Respond Error",   sourceIndex: 1 }
```

Three things to notice:

1. **One `Respond Error` for many sources.** Fan-in keeps it readable.
2. **Both nodes have `onError` set.** Miss it on either and that node's failure halts the workflow instead of routing — and the caller times out.
3. **If you surface the error message in the body, sanitize it.** See "Don't leak internals" below.

The error Respond node, in JSON:

```json
{
  "type": "n8n-nodes-base.respondToWebhook",
  "name": "Respond Error",
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ { error: 'upstream_error', message: 'External service failed' } }}",
    "options": {
      "responseCode": 502,
      "responseHeaders": { "entries": [{ "name": "Content-Type", "value": "application/json" }] }
    }
  }
}
```

Always set `Content-Type: application/json` explicitly — the default depends on the body shape and isn't reliable.

---

## 4xx lives upstream, 5xx comes out of error outputs

This is the structural rule that keeps an API honest:

- **Validation / auth / not-found failures are *expected outcomes with a known response*.** They aren't nodes crashing. Check them **before** the work, with IF/Switch + a dedicated Respond, and return the right 4xx directly. Do not route them through error outputs.
- **Execution failures (a node actually throwing) are *unexpected*.** Those come out of error outputs as 5xx.

A real API usually needs several upstream checks, each its own IF/Switch + Respond, *before* the processing stage:

```
Webhook
  → Auth present & valid?      ── no ──→ Respond 401 unauthorized
  → Input valid?               ── no ──→ Respond 400 validation_error (with details)
  → Caller allowed this op?    ── no ──→ Respond 403 forbidden
  → Target resource exists?    ── no ──→ Respond 404 not_found
  → Processing stage (HTTP / DB / etc.) ←── this is where 5xx errors originate
```

That's not over-engineering — it's the difference between the caller getting an actionable `validation_error` and getting a generic 500 they can't act on.

---

## Input validation: conditions on the canvas

Put the checks in an **IF** node: one condition per rule, combinator `and`. True → your logic; false → a 400 Respond.
Every rule is visible on the canvas, and adding one is adding a condition.

```json
{
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.3,
  "name": "Input valid?",
  "parameters": {
    "conditions": {
      "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict", "version": 3 },
      "conditions": [
        { "leftValue": "={{ typeof $json.body.name === 'string' && $json.body.name.length > 0 }}", "rightValue": "", "operator": { "type": "boolean", "operation": "true", "singleValue": true } },
        { "leftValue": "={{ /^\\S+@\\S+\\.\\S+$/.test($json.body.email ?? '') }}", "rightValue": "", "operator": { "type": "boolean", "operation": "true", "singleValue": true } },
        { "leftValue": "={{ ['starter', 'pro', 'enterprise'].includes($json.body.plan) }}", "rightValue": "", "operator": { "type": "boolean", "operation": "true", "singleValue": true } },
        { "leftValue": "={{ Number.isInteger($json.body.seat_count) && $json.body.seat_count >= 1 && $json.body.seat_count <= 500 }}", "rightValue": "", "operator": { "type": "boolean", "operation": "true", "singleValue": true } }
      ],
      "combinator": "and"
    },
    "options": {}
  }
}
```

Write each rule as a boolean expression tested with `is true`, not as a typed comparison (`number` ≥ 1). The input is
untrusted: with strict type validation, a typed comparison on a value of the wrong type (`"seat_count": "five"`) makes
the node throw instead of returning false, and the caller gets a 500 instead of a 400.

The false branch responds with a static body that echoes the expected schema, so the caller (or an LLM driving the
call) can fix the request:

```json
{
  "type": "n8n-nodes-base.respondToWebhook",
  "name": "Respond 400",
  "parameters": {
    "respondWith": "json",
    "options": { "responseCode": 400 },
    "responseBody": "={{ { error: 'validation_error', message: 'The request body does not match request_schema.', request_schema: { type: 'object', additionalProperties: false, required: ['name', 'email', 'plan', 'seat_count'], properties: { name: { type: 'string', minLength: 1 }, email: { type: 'string', format: 'email' }, plan: { type: 'string', enum: ['starter', 'pro', 'enterprise'] }, seat_count: { type: 'integer', minimum: 1, maximum: 500 } } } } }}"
  }
}
```

The status code lives in `options.responseCode`; a top-level `responseCode` is ignored and the node returns 200. Pass the
body as an object; a string body is parsed as JSON first, so `JSON.stringify(...)` only adds a step (see
**n8n-node-configuration** NODE_FAMILY_GOTCHAS.md).

### Exception: per-field messages (a Code node)

When the caller needs to know **which** field failed and why, the IF can't say it. Replace the IF with one Code node that
loops over a schema list — the loop is the closed-list reason — and branch on its result with an IF on
`={{ $json.valid }}`. Set the node's note: `Why Code: IF considered — per-field messages need a loop over the schema`.

```javascript
// Run Once for All Items. Edit FIELDS for your endpoint; keep the output keys.
const body = $input.first().json.body ?? {};
const FIELDS = [
  { name: 'name', type: 'string', required: true, minLength: 1, description: 'Customer full name' },
  { name: 'email', type: 'string', required: true, pattern: '^\\S+@\\S+\\.\\S+$', description: 'Contact email address' },
  { name: 'plan', type: 'string', required: true, enum: ['starter', 'pro', 'enterprise'], description: 'Subscription plan' },
  { name: 'seat_count', type: 'integer', required: true, minimum: 1, maximum: 500, description: 'Number of licensed seats' },
];
const details = {};
for (const f of FIELDS) {
  const v = body[f.name];
  if (v === undefined) { if (f.required) details[f.name] = `Missing required field "${f.name}"`; continue; }
  const typeOk = f.type === 'integer' ? Number.isInteger(v) : typeof v === f.type;
  if (!typeOk) details[f.name] = `Expected type "${f.type}"`;
  else if (f.minLength !== undefined && v.length < f.minLength) details[f.name] = `Must be at least ${f.minLength} character(s)`;
  else if (f.pattern && !new RegExp(f.pattern).test(v)) details[f.name] = `"${v}" is not valid`;
  else if (f.enum && !f.enum.includes(v)) details[f.name] = `"${v}" is not allowed. Must be one of: ${f.enum.join(', ')}`;
  else if ((f.minimum !== undefined && v < f.minimum) || (f.maximum !== undefined && v > f.maximum)) details[f.name] = `Must be between ${f.minimum} and ${f.maximum}`;
}
for (const key of Object.keys(body)) if (!FIELDS.some(f => f.name === key)) details[key] = 'Unknown field';

const requiredSchema = {
  type: 'object', additionalProperties: false,
  required: FIELDS.filter(f => f.required).map(f => f.name),
  properties: Object.fromEntries(FIELDS.map(({ name, required, ...rule }) => [name, rule])),
};
const issues = Object.entries(details).map(([field, msg]) => `• ${field}: ${msg}`);
return [{ json: issues.length === 0
  ? { valid: true, validationError: null }
  : { valid: false, validationError: `Validation failed (${issues.length} issue${issues.length > 1 ? 's' : ''}):\n${issues.join('\n')}`, details, requiredSchema } }];
```

The 400 Respond reads the result:

```
={{ { error: 'validation_error', message: $json.validationError, details: $json.details, request_schema: $json.requiredSchema } }}
```

The output contract (the Respond depends on these key names):

- Valid: `{ valid: true, validationError: null }`
- Invalid: `{ valid: false, validationError: <summary string>, details: { <field>: <message> }, requiredSchema: <schema echoed back> }`

`FIELDS` is the one place to edit: the checks and the echoed schema are built from it, so they can't drift apart.
Unknown fields are reported, which is what `additionalProperties: false` in the echoed schema promises.

### Constraint cookbook

| Need | IF rule (boolean expression) | `FIELDS` entry (Code exception) |
|---|---|---|
| Required, non-empty string | `typeof $json.body.name === 'string' && $json.body.name.length > 0` | `type: 'string', required: true, minLength: 1` |
| Pattern | `/^\S+@\S+\.\S+$/.test($json.body.email ?? '')` | `pattern: '^\\S+@\\S+\\.\\S+$'` |
| Enum | `['a', 'b'].includes($json.body.plan)` | `enum: ['a', 'b']` |
| Integer in range | `Number.isInteger($json.body.n) && $json.body.n >= 1 && $json.body.n <= 500` | `type: 'integer', minimum: 1, maximum: 500` |
| Array with items | `Array.isArray($json.body.tags) && $json.body.tags.length > 0` | add an `array` branch to the type check |
| Conditional rule | a second IF after the first, or `$json.body.type !== 'X' \|\| <rule>` | a `when` key the loop checks |

### Escaping in workflow JSON

In the IF rules the regex is a JavaScript literal inside the expression: `/^\S+@\S+\.\S+$/`. In the Code node it is a
string passed to `new RegExp`, so each backslash is written twice (`'^\\S+@\\S+\\.\\S+$'`). When either lands in workflow
JSON (an expression string or `jsCode`), every backslash doubles once more. If an email check never matches, count the
backslashes.

---

## 5xx: route by cause, one static Respond per status

Error outputs from several fallible nodes can fan in to one **Switch** that classifies the failure. Each output goes to a
Respond with a fixed code and a fixed body; the fallback output catches everything else as 500. Every status is visible
on the canvas, and adding a case is adding a rule.

```
error outputs (main[1]) ─→ Switch "Classify error"
                             ├─ message contains "timeout"    → Respond 504 upstream_timeout
                             ├─ message contains "rate limit" → Respond 503 service_unavailable
                             └─ fallback (extra output)       → Respond 500 internal_error
```

```json
{
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.4,
  "name": "Classify error",
  "parameters": {
    "mode": "rules",
    "rules": {
      "values": [
        {
          "conditions": {
            "options": { "caseSensitive": false, "leftValue": "", "typeValidation": "strict", "version": 3 },
            "conditions": [ { "leftValue": "={{ $json.error?.message ?? '' }}", "rightValue": "timeout", "operator": { "type": "string", "operation": "contains" } } ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "upstream_timeout"
        },
        {
          "conditions": {
            "options": { "caseSensitive": false, "leftValue": "", "typeValidation": "strict", "version": 3 },
            "conditions": [ { "leftValue": "={{ $json.error?.message ?? '' }}", "rightValue": "rate limit", "operator": { "type": "string", "operation": "contains" } } ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "service_unavailable"
        }
      ]
    },
    "options": { "fallbackOutput": "extra", "renameFallbackOutput": "internal_error" }
  }
}
```

Each Respond is static, for example:

```json
{
  "type": "n8n-nodes-base.respondToWebhook",
  "name": "Respond 504",
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ { error: 'upstream_timeout', message: 'External service did not respond in time' } }}",
    "options": { "responseCode": 504 }
  }
}
```

- Without `fallbackOutput: "extra"`, an error no rule matches is dropped and the caller waits until it times out.
- A single Respond with a computed code is fine for exactly two outcomes, as one short ternary in its Response Code field
  (`options.responseCode` = `={{ $json.error?.message?.includes('timeout') ? 504 : 500 }}`). From three outcomes on, use the Switch.

---

## Don't leak internals

The tempting one-liner:

```javascript
responseBody: "={{ JSON.stringify({ error: 'internal_error', details: $json.error }) }}"  // ❌
```

`$json.error` can carry stack traces, internal node names, connection strings, and upstream response bodies with embedded tokens. Surfacing it hands attackers a map and gives callers nothing useful.

Instead: log the full error privately, return a sanitized message.

```javascript
// Error output → Log node (sends full $json.error to Sentry/Slack/your logger)
{ type: "addConnection", source: "Call External", target: "Log Full Error", sourceIndex: 1 }
{ type: "addConnection", source: "Log Full Error", target: "Respond Error",  sourceIndex: 0 }
```

```json
// Respond Error keeps the body clean:
{ "responseBody": "={{ { error: 'upstream_error', message: 'External service failed' } }}",
  "options": { "responseCode": 502 } }
```

The caller sees a clean message; the detail stays internal. Full do-not-leak list in **RESPONSE_SHAPES.md**.

---

## Correlation IDs (optional)

If you run distributed tracing or log correlation, add a `request_id` consistently across **every** success and error response (partial coverage is worse than none). Two sources:

- **Caller-supplied** — read an `X-Request-ID` header, pass it through. Better for tracing across systems.
- **Generated** — use `{{ $execution.id }}` or a UUID. Easier.

Don't conflate this with the `job_id` an async (202) endpoint returns — that's how the caller polls for work later, not a correlation field.

---

## Async / 202 pattern

If the work takes longer than the caller wants to wait, respond 202 immediately and continue async:

```
Webhook → validate → Respond (202, { job_id }) → continue processing → callback / queue / email on completion
```

It has its own gotchas (idempotency, callback retries, status tracking) — build it deliberately. The `job_id` is intrinsic (it's how the work is found later), distinct from the optional `request_id`.

---

## Verifying the API workflow

Before activating:

1. **Test the success path** with `n8n_test_workflow`. Confirm shape and code. **API workflows almost always have side effects (DB writes, third-party calls, comms) — ask the user before running a test that triggers them.**
2. **Trigger an error path** — feed input that breaks a processing node, run, confirm the error Respond fires with the right code and body.
3. **Verify connections** with `n8n_get_workflow`: every fallible node has `onError: "continueErrorOutput"` AND `main[1]` wired. (NODE_ERROR_OUTPUTS.md.)
4. **Confirm no internal detail leaks** in the error body.
5. **Inspect real failures** afterward with `n8n_executions` to confirm the codes you expected are what actually went out.

If any check fails, fix before activating.
