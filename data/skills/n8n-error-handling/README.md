# n8n Error Handling Skill

Wire n8n error handling so failures are loud, structured, and recoverable — instead of the default, where a single node throwing **halts the whole workflow** and the caller or operator gets nothing.

---

## ⚠️ The default is silent failure

When an n8n node throws, the workflow stops. For a run you're watching that's fine — you see the red node. For anything unattended it's the wrong default:

| Workflow | What the default does | What you wanted |
|---|---|---|
| Webhook / API | Caller gets a timeout or a bare 500 | A 4xx/5xx with a body that says what broke |
| Scheduled / cron | Job stops; nobody is told | An alert the moment it fails |
| Agent tool / queue worker | Silently drops work | A handled, recoverable failure |

This skill turns silence into a routed, structured, recoverable failure.

---

## What This Skill Teaches

### Core Concepts
1. **Per-node error outputs are a TWO-step setup** — `onError: "continueErrorOutput"` **and** wiring `main[1]`. One without the other is the #1 silent trap.
2. **Self-healing first** — `retryOnFail` on network nodes so transient blips never reach an error path
3. **API workflows respond on every path** — no hanging branches; success and error both end at a Respond
4. **Status code maps to cause** — 4xx is the caller's fault, 5xx is yours; never 500 for everything
5. **Workflow-level error workflows** — an Error Trigger catch-all for what per-node handling misses

### Top traps this skill prevents
1. `onError` set but error output unwired → run shows **succeeded** while dropping work
2. Error output wired but `onError` unset → handler unreachable, workflow halts
3. Error branch returns 200 → caller's error handling never fires
4. One 500 `internal_error` for everything, including bad input
5. Network node with no retry → transient 429s surface as 5xx and page on-call
6. Unattended workflow with no error workflow → a genuine failure goes nowhere

---

## Skill Activation

Activates when you:
- Build any webhook/API workflow, or a scheduled/unattended one
- Wire a per-node error output (`onError`, `continueErrorOutput`, error branch, `main[1]`)
- Configure retries (`retryOnFail`, `maxTries`, `waitBetweenTries`)
- Decide a Respond-to-Webhook status code (4xx/5xx)
- Set up an Error Trigger workflow
- Say "my workflow fails silently"

**Example queries**:
- "My HTTP node has onError set but the workflow still halts on failure — why?"
- "My webhook API returns 500 for everything, even bad input. How do I fix the status codes?"
- "My scheduled workflow fails on a flaky API and nobody notices."
- "How do I wire a node's error output to a handler?"
- "How do I retry an HTTP request before treating it as an error?"

---

## File Structure

### SKILL.md
Main skill content — loaded when the skill activates.
- The default (halt = silent failure) and when looser handling is OK
- The two-step per-node error output and the failure-mode table
- `retryOnFail` self-healing before wiring error paths
- The canonical webhook/API shape (respond on every path)
- Cause → status code mapping; one expression-driven Respond
- Workflow-level error workflows and the recursion trap
- What the community MCP can't do (the error-workflow UI setting)
- Anti-patterns table, integration with other skills, quick-reference checklist

### NODE_ERROR_OUTPUTS.md
The two-step setup on a single node, in depth.
- Step 1 (`onError` values) and step 2 (`addConnection` with `sourceIndex: 1`)
- Both failure modes and why each is dangerous
- Why validation won't catch a half-wired error output
- Wiring shapes (single, fan-out, fan-in, log + respond)
- What counts as "fallible"; mandatory `n8n_get_workflow` verification

### API_WORKFLOWS.md
The webhook → Respond pattern under failure.
- Wiring every fallible node to one responder
- 4xx upstream vs 5xx from error outputs
- The Set-node schema validator (JSON) and the regex-escaping gotcha
- Differentiating 5xx with an expression; don't-leak-internals wiring
- Correlation IDs, the async/202 pattern, verification steps

### RESPONSE_SHAPES.md
Response body and status-code conventions.
- Match the instance first; success and error envelopes
- `responseCode` defaults to 200 — set it on every error branch
- Status → cause table; the stable error-code set
- Validation details, rate-limit shapes, the do-not-leak list
- Respond-node JSON for the community MCP

### ERROR_WORKFLOWS.md
The workflow-level catch-all.
- The Error Trigger payload and a minimal capture → notify workflow
- Alert-field expressions; the featureful "recover the failing input" version
- Assigning it is UI-only (MCP can't); when it fires and when it doesn't
- The recursion trap and verification

---

## Quick Reference

### The two-step per-node error output
```javascript
// 1) create the error output
{ type: "updateNode", nodeName: "HTTP Request",
  changes: { onError: "continueErrorOutput" } }

// 2) wire it (sourceIndex 1 = error output)
{ type: "addConnection", source: "HTTP Request", target: "Handle Error", sourceIndex: 1 }
```

### Self-healing on network nodes
```javascript
{ type: "updateNode", nodeName: "HTTP Request",
  changes: { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 } }
```

### Set the status code on an error Respond (don't leave it 200)
```json
{ "responseCode": 502,
  "responseBody": "={{ JSON.stringify({ error: 'upstream_error', message: 'External service failed' }) }}" }
```

### `onError` values
- `"stopWorkflow"` (default) — halt the workflow
- `"continueErrorOutput"` — route the error out `main[1]` (the one you wire)
- `"continueRegularOutput"` — error flows out the normal output (rare, usually wrong)

---

## Integration with Other Skills

**n8n-workflow-patterns**: the webhook/API and scheduled patterns are where error handling lives — use it for the shape, this skill to harden it.

**n8n-node-configuration**: `onError`/`retryOnFail` are node config; NODE_FAMILY_GOTCHAS.md covers the Webhook/Respond response-code traps in detail.

**n8n-validation-expert**: a half-wired error output is a connection/config audit item, not a validation error — this skill is the fix.

**n8n-expression-syntax**: the expression-driven `Response Code` and alert messages depend on correct `{{ }}` and `$json.error` access.

**n8n-code-javascript / n8n-code-python**: if you catch errors inside a Code node, decide deliberately — re-throw to use the error output, or handle and continue; don't return error-shaped data as success.

**n8n-binary-and-data**: file/binary operations are fallible too — wire their error outputs like any network node.

---

## When error handling can be looser

| Situation | Posture |
|---|---|
| Anyone but you sees the output (downstream system, end user, on-call) | Full handling — the rules above apply |
| Internal one-off you run and watch yourself | `onError: "stopWorkflow"` is fine — you'll see it and re-run |

---

## Success Metrics

After using this skill, you should be able to:

- [ ] Wire a per-node error output correctly — `onError` **and** `main[1]`, verified via `n8n_get_workflow`
- [ ] Recognize and fix both half-wired failure modes
- [ ] Add `retryOnFail` so transient failures self-heal before reaching an error path
- [ ] Build an API workflow where every path ends at a Respond with an explicit status code
- [ ] Map a failure's cause to the right 4xx/5xx and keep internals out of the body
- [ ] Build an Error Trigger workflow and tell the user the UI step to assign it
- [ ] Avoid the recursion trap in the error workflow

---

## Sources

Authoritative facts in this skill come from:
- n8n node `onError` semantics and the `main[1]` error output contract
- n8n retry engine limits (`maxTries` ≤ 5, `waitBetweenTries` ≤ 5000ms; retries on any error)
- The Error Trigger payload shape (`execution`/`workflow`/`error`)
- n8n-mcp `n8n_update_partial_workflow` operations (`updateNode`, `patchNodeField`, `addConnection`, `activateWorkflow`)

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n with per-node `onError` outputs; community n8n-mcp server for all workflow operations.

---

## Credits

Part of the n8n-skills project.

**Remember**: the default is silence. Make the failure **route** (per-node `onError` + wired output, or a catch-all error workflow) and make it **speak** (a truthful status code and body). Half a move is worse than none — it looks done.
