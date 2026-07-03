# False Positives Guide

When validation warnings are acceptable and how to handle them.

---

## What Are False Positives?

**Definition**: A validation warning that flags a real trade-off but is acceptable in your specific use case — not something the validator got *wrong*.

**Key insight**: Not every warning needs a fix, but the reason has changed (n8n-mcp ≥ 2.63.0).

The validator used to emit a large family of *genuine* false positives — warnings and even hard errors on configurations that run fine in production (template literals inside expressions, optional chaining, omitted-operation defaults, the Webhook → Respond-to-Webhook pattern, IF/Filter legacy shapes, and more). Those have been fixed at the source. The validator no longer flags them at all, so there is no longer a standing list of "known false positives to ignore."

What remains is not noise-to-suppress but **context-dependent advice**. Every warning you now see falls into one of two buckets:

- **Security and deprecation warnings** — surfaced under *every* profile (`minimal` through `strict`). Treat these as real.
- **Best-practice advisories** — error-handling suggestions, rate-limit notes, outdated-`typeVersion` suggestions, `cachedResultName` advice, long-chain hints. These surface **only under `ai-friendly` and `strict`**. `minimal` and `runtime` never emit them.

So the practical question is no longer "is this a false positive?" but "does this best-practice advisory apply to *my* workflow?" The per-case guidance below (error handling, retries, rate limiting, unbounded queries, input validation, credentials) is exactly that judgement call.

---

## Philosophy

### ✅ Good Practice
```
1. Validate with 'runtime' (errors + security/deprecation only)
2. Fix all ERRORS
3. Run 'ai-friendly' or 'strict' to surface best-practice advisories
4. Review each advisory against your use case (this document)
5. Document why you accepted the ones you skip
6. Deploy with confidence
```

### ❌ Bad Practice
```
1. Ignore security and deprecation warnings
2. Treat every 'strict' advisory as a mandatory fix (or as noise to blank-ignore)
3. Deploy without reading the errors
```

---

## Common False Positives

### 1. Missing Error Handling

**Warning** (surfaces under `ai-friendly` / `strict` only):
```json
{
  "type": "warning",
  "nodeName": "HTTP Request",
  "message": "HTTP Request node without error handling. Consider adding \"onError: 'continueRegularOutput'\" for non-critical requests or \"retryOnFail: true\" for transient failures."
}
```

This is never a hard error — error-handling *style* does not block execution or activation (n8n-mcp ≥ 2.63.0). Under `minimal` and `runtime` you will not see it at all.

#### When Acceptable

**✅ Development/Testing Workflows**
```javascript
// Testing workflow - failures are obvious
{
  "name": "Test Slack Integration",
  "nodes": [{
    "type": "n8n-nodes-base.slack",
    "parameters": {
      "resource": "message",
      "operation": "post",
      "channel": "#test"
      // No error handling - OK for testing
    }
  }]
}
```

**Reasoning**: You WANT to see failures during testing.

**✅ Non-Critical Notifications**
```javascript
// Nice-to-have notification
{
  "name": "Optional Slack Notification",
  "parameters": {
    "channel": "#general",
    "text": "FYI: Process completed"
    // If this fails, no big deal
  }
}
```

**Reasoning**: Notification failure doesn't affect core functionality.

**✅ Manual Trigger Workflows**
```javascript
// Manual workflow - user is watching
{
  "nodes": [{
    "type": "n8n-nodes-base.webhook",
    "parameters": {
      "path": "manual-test"
      // No error handling - user will retry manually
    }
  }]
}
```

**Reasoning**: User is present to see and handle errors.

#### When to Fix

**❌ Production Automation**
```javascript
// BAD: Critical workflow without error handling
{
  "name": "Process Customer Orders",
  "nodes": [{
    "type": "n8n-nodes-base.postgres",
    "parameters": {
      "query": "INSERT INTO orders..."
      // ❌ Should have error handling!
    }
  }]
}
```

**Fix** (modern `onError`, set at node level):
```javascript
{
  "onError": "continueRegularOutput",  // or wire "continueErrorOutput" to a real handler
  "retryOnFail": true,                 // maxTries defaults to 3 — no need to state it
  "parameters": {
    "query": "INSERT INTO orders..."
  }
}
```

> Prefer `onError` over the legacy `continueOnFail: true` — the validator flags `continueOnFail` as deprecated and n8n's UI no longer surfaces it cleanly. And note: if you set `onError: 'continueErrorOutput'` you must wire the node's error output (`main[1]`) to a handler, or failed items are silently dropped — the validator warns about exactly that (n8n-mcp ≥ 2.63.0).

**❌ Critical Integrations**
```javascript
// BAD: Payment processing without error handling
{
  "name": "Process Payment",
  "type": "n8n-nodes-base.stripe"
  // ❌ Payment failures MUST be handled!
}
```

---

### 2. No Retry Logic

**Warning**:
```json
{
  "type": "best_practice",
  "message": "External API calls should retry on failure",
  "suggestion": "Add retryOnFail: true with exponential backoff"
}
```

#### When Acceptable

**✅ APIs with Built-in Retry**
```javascript
// Stripe has its own retry mechanism
{
  "type": "n8n-nodes-base.stripe",
  "parameters": {
    "resource": "charge",
    "operation": "create"
    // Stripe SDK retries automatically
  }
}
```

**✅ Idempotent Operations**
```javascript
// GET request - safe to retry manually if needed
{
  "method": "GET",
  "url": "https://api.example.com/status"
  // Read-only, no side effects
}
```

**✅ Local/Internal Services**
```javascript
// Internal API with high reliability
{
  "url": "http://localhost:3000/process"
  // Local service, failures are rare and obvious
}
```

#### When to Fix

**❌ Flaky External APIs**
```javascript
// BAD: Known unreliable API without retries
{
  "url": "https://unreliable-api.com/data"
  // ❌ Should retry!
}

// GOOD:
{
  "url": "https://unreliable-api.com/data",
  "retryOnFail": true,
  "maxTries": 3,
  "waitBetweenTries": 2000
}
```

**❌ Non-Idempotent Operations**
```javascript
// BAD: POST without retry - may lose data
{
  "method": "POST",
  "url": "https://api.example.com/create"
  // ❌ Could timeout and lose data
}
```

---

### 3. Missing Rate Limiting

**Warning**:
```json
{
  "type": "best_practice",
  "message": "API may have rate limits",
  "suggestion": "Add rate limiting or batch requests"
}
```

#### When Acceptable

**✅ Internal APIs**
```javascript
// Internal microservice - no rate limits
{
  "url": "http://internal-api/process"
  // Company controls both ends
}
```

**✅ Low-Volume Workflows**
```javascript
// Runs once per day
{
  "trigger": {
    "type": "n8n-nodes-base.cron",
    "parameters": {
      "mode": "everyDay",
      "hour": 9
    }
  },
  "nodes": [{
    "type": "n8n-nodes-base.httpRequest",
    "parameters": {
      "url": "https://api.example.com/daily-report"
      // Once per day = no rate limit concerns
    }
  }]
}
```

**✅ APIs with Server-Side Limits**
```javascript
// API returns 429 and n8n handles it
{
  "url": "https://api.example.com/data",
  "options": {
    "response": {
      "response": {
        "neverError": false  // Will error on 429
      }
    }
  },
  "retryOnFail": true  // Retry on 429
}
```

#### When to Fix

**❌ High-Volume Public APIs**
```javascript
// BAD: Loop hitting rate-limited API
{
  "nodes": [{
    "type": "n8n-nodes-base.splitInBatches",
    "parameters": {
      "batchSize": 100
    }
  }, {
    "type": "n8n-nodes-base.httpRequest",
    "parameters": {
      "url": "https://api.github.com/..."
      // ❌ GitHub has strict rate limits!
    }
  }]
}

// GOOD: Add rate limiting
{
  "type": "n8n-nodes-base.httpRequest",
  "parameters": {
    "url": "https://api.github.com/...",
    "options": {
      "batching": {
        "batch": {
          "batchSize": 10,
          "batchInterval": 1000  // 1 second between batches
        }
      }
    }
  }
}
```

---

### 4. Unbounded Database Queries

**Warning**:
```json
{
  "type": "performance",
  "message": "SELECT without LIMIT can return massive datasets",
  "suggestion": "Add LIMIT clause or use pagination"
}
```

#### When Acceptable

**✅ Small Known Datasets**
```javascript
// Config table with ~10 rows
{
  "query": "SELECT * FROM app_config"
  // Known to be small, no LIMIT needed
}
```

**✅ Aggregation Queries**
```javascript
// COUNT/SUM operations
{
  "query": "SELECT COUNT(*) as total FROM users WHERE active = true"
  // Aggregation, not returning rows
}
```

**✅ Development/Testing**
```javascript
// Testing with small dataset
{
  "query": "SELECT * FROM test_users"
  // Test database has 5 rows
}
```

#### When to Fix

**❌ Production Queries on Large Tables**
```javascript
// BAD: User table could have millions of rows
{
  "query": "SELECT * FROM users"
  // ❌ Could return millions of rows!
}

// GOOD: Add LIMIT
{
  "query": "SELECT * FROM users LIMIT 1000"
}

// BETTER: Use pagination
{
  "query": "SELECT * FROM users WHERE id > {{$json.lastId}} LIMIT 1000"
}
```

---

### 5. Missing Input Validation

**Warning**:
```json
{
  "type": "best_practice",
  "message": "Webhook doesn't validate input data",
  "suggestion": "Add IF node to validate required fields"
}
```

#### When Acceptable

**✅ Internal Webhooks**
```javascript
// Webhook from your own backend
{
  "type": "n8n-nodes-base.webhook",
  "parameters": {
    "path": "internal-trigger"
    // Your backend already validates
  }
}
```

**✅ Trusted Sources**
```javascript
// Webhook from Stripe (cryptographically signed)
{
  "type": "n8n-nodes-base.webhook",
  "parameters": {
    "path": "stripe-webhook",
    "authentication": "headerAuth"
    // Stripe signature validates authenticity
  }
}
```

#### When to Fix

**❌ Public Webhooks**
```javascript
// BAD: Public webhook without validation
{
  "type": "n8n-nodes-base.webhook",
  "parameters": {
    "path": "public-form-submit"
    // ❌ Anyone can send anything!
  }
}

// GOOD: Add validation
{
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook"
    },
    {
      "name": "Validate Input",
      "type": "n8n-nodes-base.if",
      "parameters": {
        "conditions": {
          "boolean": [
            {
              "value1": "={{$json.body.email}}",
              "operation": "isNotEmpty"
            },
            {
              "value1": "={{$json.body.email}}",
              "operation": "regex",
              "value2": "^[^@]+@[^@]+\\.[^@]+$"
            }
          ]
        }
      }
    }
  ]
}
```

---

### 6. Hardcoded Credentials

**Warning**:
```json
{
  "type": "security",
  "message": "Credentials should not be hardcoded",
  "suggestion": "Use n8n credential system"
}
```

#### When Acceptable

**✅ Public APIs (No Auth)**
```javascript
// Truly public API with no secrets
{
  "url": "https://api.ipify.org"
  // No credentials needed
}
```

**✅ Demo/Example Workflows**
```javascript
// Example workflow in documentation
{
  "url": "https://example.com/api",
  "headers": {
    "Authorization": "Bearer DEMO_TOKEN"
  }
  // Clearly marked as example
}
```

#### When to Fix (Always!)

**❌ Real Credentials**
```javascript
// BAD: Real API key in workflow
{
  "headers": {
    "Authorization": "Bearer sk_live_abc123..."
  }
  // ❌ NEVER hardcode real credentials!
}

// GOOD: Use credentials system
{
  "authentication": "headerAuth",
  "credentials": {
    "headerAuth": {
      "id": "credential-id",
      "name": "My API Key"
    }
  }
}
```

---

## Validation Profile Strategies

### Strategy 1: Progressive Strictness

The profiles are cumulative — each surfaces everything the lower one does, plus more (n8n-mcp ≥ 2.63.0). Move up the ladder as a workflow gets closer to production.

**While editing** — fast, errors only:
```javascript
validate_node({ nodeType: "nodes-base.slack", config, profile: "runtime" })
// errors + security/deprecation warnings; no best-practice advisories
```

**Before deploying** — surface the advisories you may want to act on:
```javascript
validate_node({ nodeType: "nodes-base.slack", config, profile: "ai-friendly" })
// adds error-handling suggestions, rate-limit notes, outdated-typeVersion suggestions
```

**Hardening a critical workflow** — the full lint:
```javascript
validate_node({ nodeType: "nodes-base.slack", config, profile: "strict" })
// everything ai-friendly emits, plus "property won't be used" leftover checks
```

### Strategy 2: Profile by Workflow Type

**Quick Automations**:
- Profile: `runtime`
- See: errors + security/deprecation warnings
- Fix: errors; skip best-practice advisories you don't need

**Business-Critical Workflows**:
- Profile: `strict`
- See: every advisory
- Fix: errors, security, and any advisory that applies to a production path

**Integration Testing**:
- Profile: `minimal`
- See: only errors that would stop execution
- Fix: those errors; everything else is out of scope while wiring connections

---

## Decision Framework

### Should I Fix This Warning?

```
┌─────────────────────────────────┐
│ Is it a SECURITY warning?       │
├─────────────────────────────────┤
│ YES → Always fix                │
│ NO  → Continue                  │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ Is this a production workflow?  │
├─────────────────────────────────┤
│ YES → Continue                  │
│ NO  → Probably acceptable       │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ Does it handle critical data?   │
├─────────────────────────────────┤
│ YES → Fix the warning           │
│ NO  → Continue                  │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ Is there a known workaround?    │
├─────────────────────────────────┤
│ YES → Acceptable if documented  │
│ NO  → Fix the warning           │
└─────────────────────────────────┘
```

---

## Documentation Template

When accepting a warning, document why:

```javascript
// workflows/customer-notifications.json

{
  "nodes": [{
    "name": "Send Slack Notification",
    "type": "n8n-nodes-base.slack",
    "parameters": {
      "channel": "#notifications"
      // ACCEPTED WARNING: No error handling
      // Reason: Non-critical notification, failures are acceptable
      // Reviewed: 2025-10-20
      // Reviewer: Engineering Team
    }
  }]
}
```

---

## What the validator no longer flags

Earlier versions of this guide listed "known n8n issues" to ignore. Those false positives are gone at the source (n8n-mcp ≥ 2.63.0) — the validator simply does not emit them anymore, so there is nothing to recognize or suppress. If you are on an older server and still see them, upgrading is the fix. Among the classes that no longer fire:

- **Template literals inside expressions** — `` ={{ `https://api/${$json.id}` }} `` is valid; n8n's engine evaluates full modern JS (template literals, optional chaining `?.`) inside `{{ }}`.
- **Omitted `operation` on multi-resource nodes** (Gmail, Telegram, Slack, Google Drive, Discord, Notion, …) — no longer produces a fabricated "Invalid value for 'operation'" error. The genuine missing *required* field (e.g. a channel) is still flagged.
- **The Webhook → Respond-to-Webhook pattern** — needs no `onError`; n8n auto-returns a 500 if a node fails before the Respond node.
- **IF / Filter / Switch v1 legacy shapes** — the native `conditions.{string|number|boolean}` shape validates correctly; `combinator` and `conditions.options` are optional (n8n defaults them); unary operators don't need `singleValue`.
- **Optional chaining, string-keyed bracket access** (`$json['some-prop']`), fields named `test`/`null`/`undefined`, `this.helpers` usage, regex `$` anchors, and bare-object returns in `runOnceForAllItems` mode.

One precise caveat on template literals: they only evaluate **inside `{{ }}`**. A bare backtick string written as a plain field value (no `{{ }}`) is literal text — n8n evaluates only `{{ }}`, everything else is passed through verbatim.

---

## Summary

### Always Fix
- ❌ Security warnings (surface under every profile)
- ❌ Hardcoded credentials
- ❌ SQL injection risks
- ❌ Any error (`valid: false`) — these block activation

### Usually Fix
- ⚠️ Error handling (production)
- ⚠️ Retry logic (external APIs)
- ⚠️ Input validation (public webhooks)
- ⚠️ Rate limiting (high volume)

### Often Acceptable
- ✅ Error handling (dev/test)
- ✅ Retry logic (internal APIs)
- ✅ Rate limiting (low volume)
- ✅ Query limits (small datasets)

### Not a fix at all — advice, not defects
- ✅ Best-practice advisories under `ai-friendly` / `strict` that don't apply to your workflow (weigh them per-case using this document)
- ✅ Outdated-`typeVersion` suggestions when your version is older-but-supported (that is normal n8n behavior)

**Golden Rule**: If you accept an advisory, document WHY.

**Related Files**:
- **[SKILL.md](SKILL.md)** - Main validation guide
- **[ERROR_CATALOG.md](ERROR_CATALOG.md)** - Error types and fixes
