# Workflow Management Tools Guide

Complete guide for creating, updating, and managing n8n workflows.

---

## Tool Availability

**Requires n8n API**: All tools in this guide need `N8N_API_URL` and `N8N_API_KEY` configured.

If unavailable, use template examples and validation-only workflows.

---

## n8n_create_workflow

**Speed**: 100-500ms

**Use when**: Creating new workflows from scratch

**Syntax**:
```javascript
n8n_create_workflow({
  name: "Webhook to Slack",  // Required
  nodes: [...],              // Required: array of nodes
  connections: {...},        // Required: connections object
  settings: {...}            // Optional: workflow settings
})
```

**Returns**: Created workflow with ID

**Example**:
```javascript
n8n_create_workflow({
  name: "Webhook to Slack",
  nodes: [
    {
      id: "webhook-1",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",  // Full prefix!
      typeVersion: 2,
      position: [250, 300],
      parameters: {
        path: "slack-notify",
        httpMethod: "POST"
      }
    },
    {
      id: "slack-1",
      name: "Slack",
      type: "n8n-nodes-base.slack",
      typeVersion: 2,
      position: [450, 300],
      parameters: {
        resource: "message",
        operation: "post",
        channel: "#general",
        text: "={{$json.body.message}}"
      }
    }
  ],
  connections: {
    "Webhook": {
      "main": [[{node: "Slack", type: "main", index: 0}]]
    }
  }
})
```

**Notes**:
- Workflows created **inactive** (activate with `activateWorkflow` operation)
- Auto-sanitization runs on creation
- Validate before creating for best results

---

## n8n_update_partial_workflow (MOST USED!)

**Speed**: 50-200ms | **Uses**: 38,287 (most used tool!)

**Use when**: Making incremental changes to workflows

**Common pattern**: 56s average between edits (iterative building!)

### 19 Operation Types

**Node Operations** (7 types):
1. `addNode` - Add new node
2. `removeNode` - Remove node by ID or name
3. `updateNode` - Update node properties (use dot notation)
4. `patchNodeField` - Surgical string edits via strict find/replace (see below)
5. `moveNode` - Change position
6. `enableNode` - Enable disabled node
7. `disableNode` - Disable active node

**Connection Operations** (5 types):
8. `addConnection` - Connect nodes (supports smart params)
9. `removeConnection` - Remove connection (supports ignoreErrors)
10. `rewireConnection` - Change connection target
11. `cleanStaleConnections` - Auto-remove broken connections
12. `replaceConnections` - Replace entire connections object

**Metadata Operations** (4 types):
13. `updateSettings` - Workflow settings
14. `updateName` - Rename workflow
15. `addTag` - Add tag
16. `removeTag` - Remove tag

**Activation Operations** (2 types):
17. `activateWorkflow` - Activate workflow for automatic execution
18. `deactivateWorkflow` - Deactivate workflow

**Project Management Operations** (1 type):
19. `transferWorkflow` - Transfer workflow to a different project (enterprise/cloud)

### Intent Parameter (IMPORTANT!)

Always include `intent` for better responses:

```javascript
n8n_update_partial_workflow({
  id: "workflow-id",
  intent: "Add error handling for API failures",  // Describe what you're doing
  operations: [...]
})
```

### Smart Parameters

**IF nodes** - Use semantic branch names:
```javascript
{
  type: "addConnection",
  source: "IF",
  target: "True Handler",
  branch: "true"  // Instead of sourceIndex: 0
}

{
  type: "addConnection",
  source: "IF",
  target: "False Handler",
  branch: "false"  // Instead of sourceIndex: 1
}
```

**Switch nodes** - Use semantic case numbers:
```javascript
{
  type: "addConnection",
  source: "Switch",
  target: "Handler A",
  case: 0
}

{
  type: "addConnection",
  source: "Switch",
  target: "Handler B",
  case: 1
}
```

### AI Connection Types (8 types)

**Full support** for AI workflows:

```javascript
// Language Model
{
  type: "addConnection",
  source: "OpenAI Chat Model",
  target: "AI Agent",
  sourceOutput: "ai_languageModel"
}

// Tool
{
  type: "addConnection",
  source: "HTTP Request Tool",
  target: "AI Agent",
  sourceOutput: "ai_tool"
}

// Memory
{
  type: "addConnection",
  source: "Window Buffer Memory",
  target: "AI Agent",
  sourceOutput: "ai_memory"
}

// All 8 types:
// - ai_languageModel
// - ai_tool
// - ai_memory
// - ai_outputParser
// - ai_embedding
// - ai_vectorStore
// - ai_document
// - ai_textSplitter
```

### Property Removal with null

Remove properties by setting them to `null`:

```javascript
// Remove a property
{
  type: "updateNode",
  nodeName: "HTTP Request",
  updates: { onError: null }
}

// Migrate from deprecated property
{
  type: "updateNode",
  nodeName: "HTTP Request",
  updates: {
    continueOnFail: null,  // Remove old
    onError: "continueErrorOutput"  // Add new
  }
}
```

### patchNodeField (Surgical String Edits)

Use `patchNodeField` for strict find/replace edits on string fields — code, HTML, email templates, JSON bodies. Unlike `updateNode` with `__patch_find_replace` (which silently warns on misses), `patchNodeField` is strict: it errors if the find string is not found, and errors if multiple matches are found (preventing ambiguous replacements).

**When to use which**:
- `patchNodeField` — preferred for most string edits. Strict error handling catches mistakes early.
- `updateNode` with `__patch_find_replace` — legacy approach. Tolerant (warns but continues on miss). Use only when you want lenient behavior.

**Syntax**:
```javascript
{
  type: "patchNodeField",
  nodeName: "Code",           // or nodeId
  fieldPath: "parameters.jsCode",  // Dot-notation path to the string field
  patches: [
    {
      find: "const limit = 10;",
      replace: "const limit = 50;",
      replaceAll: false,       // Default: false. Set true to replace all occurrences
      regex: false             // Default: false. Set true to treat find as regex
    }
  ]
}
```

**Examples**:
```javascript
// Basic strict find/replace in code
n8n_update_partial_workflow({
  id: "wf-123",
  intent: "Update API limit",
  operations: [{
    type: "patchNodeField",
    nodeName: "Code",
    fieldPath: "parameters.jsCode",
    patches: [{find: "const limit = 10;", replace: "const limit = 50;"}]
  }]
})

// Replace all occurrences of a URL
n8n_update_partial_workflow({
  id: "wf-123",
  intent: "Migrate API domain",
  operations: [{
    type: "patchNodeField",
    nodeName: "Code",
    fieldPath: "parameters.jsCode",
    patches: [{find: "api.old.com", replace: "api.new.com", replaceAll: true}]
  }]
})

// Regex-based replacement (whitespace-insensitive)
n8n_update_partial_workflow({
  id: "wf-123",
  intent: "Update limit with regex",
  operations: [{
    type: "patchNodeField",
    nodeName: "Code",
    fieldPath: "parameters.jsCode",
    patches: [{find: "const\\s+limit\\s*=\\s*\\d+", replace: "const limit = 100", regex: true}]
  }]
})

// Multiple sequential patches on an email template
n8n_update_partial_workflow({
  id: "wf-123",
  intent: "Update email footer",
  operations: [{
    type: "patchNodeField",
    nodeName: "Set Email",
    fieldPath: "parameters.assignments.assignments.6.value",
    patches: [
      {find: "© 2025", replace: "© 2026"},
      {find: "<p>Unsubscribe</p>", replace: ""}
    ]
  }]
})
```

**Error behavior** (this is what makes it strict):
- **Find string not found** → operation fails with error (not a silent warning)
- **Multiple matches without `replaceAll`** → operation fails (ambiguity detected)
- Patches are applied sequentially — order matters

**Security limits**:
- Max 50 patches per operation
- Regex patterns capped at 500 characters
- Regex only on fields under 512KB
- ReDoS-safe: rejects nested quantifiers like `(a+)+` and overlapping alternations like `(\w|\d)+`
- Prototype pollution protection on field paths

### Activation Operations

```javascript
// Activate workflow
n8n_update_partial_workflow({
  id: "workflow-id",
  intent: "Activate workflow for production",
  operations: [{type: "activateWorkflow"}]
})

// Deactivate workflow
n8n_update_partial_workflow({
  id: "workflow-id",
  intent: "Deactivate workflow for maintenance",
  operations: [{type: "deactivateWorkflow"}]
})
```

### Example Usage

```javascript
n8n_update_partial_workflow({
  id: "workflow-id",
  intent: "Add transform node after IF condition",
  operations: [
    // Add node
    {
      type: "addNode",
      node: {
        name: "Transform",
        type: "n8n-nodes-base.set",
        position: [400, 300],
        parameters: {}
      }
    },
    // Connect it (smart parameter)
    {
      type: "addConnection",
      source: "IF",
      target: "Transform",
      branch: "true"  // Clear and semantic!
    }
  ]
})
```

### Cleanup & Recovery

**cleanStaleConnections** - Remove broken connections:
```javascript
{type: "cleanStaleConnections"}
```

**rewireConnection** - Change target atomically:
```javascript
{
  type: "rewireConnection",
  source: "Webhook",
  from: "Old Handler",
  to: "New Handler"
}
```

**Best-effort mode** - Apply what works:
```javascript
n8n_update_partial_workflow({
  id: "workflow-id",
  operations: [...],
  continueOnError: true  // Don't fail if some operations fail
})
```

**Validate before applying**:
```javascript
n8n_update_partial_workflow({
  id: "workflow-id",
  operations: [...],
  validateOnly: true  // Preview without applying
})
```

---

## n8n_deploy_template (QUICK START!)

**Speed**: 200-500ms

**Use when**: Deploying a template directly to n8n instance

```javascript
n8n_deploy_template({
  templateId: 2947,  // Required: from n8n.io
  name: "My Weather to Slack",  // Optional: custom name
  autoFix: true,  // Default: auto-fix common issues
  autoUpgradeVersions: true,  // Default: upgrade node versions
  stripCredentials: true  // Default: remove credential refs
})
```

**Returns**:
- Workflow ID
- Required credentials
- Fixes applied

**Example**:
```javascript
// Deploy a webhook to Slack template
const result = n8n_deploy_template({
  templateId: 2947,
  name: "Production Slack Notifier"
});

// Result includes:
// - id: "new-workflow-id"
// - requiredCredentials: ["slack"]
// - fixesApplied: ["typeVersion upgraded", "expression format fixed"]
```

---

## n8n_generate_workflow (NATURAL LANGUAGE → WORKFLOW)

**Speed**: Proposals ~2s, fresh generation 5–15s, deploy ~3s

**Use when**: User describes the workflow in plain English and wants the system to draft (and optionally deploy) it.

> ⚠️ **Hosted-only feature.** On self-hosted instances the tool returns `{hosted_only: true}` with a redirect message rather than a workflow. For self-hosted, use `n8n_deploy_template` (templates) or `n8n_create_workflow` (manual).

### How It Works

It's a **multi-step flow with a review checkpoint** — proposals/preview are returned first, deployment requires a second call. This avoids deploying low-quality drafts.

### Path A: Proposals → Deploy (default, recommended)

```javascript
// Step 1: Generate proposals (NOT deployed, returns up to 5 candidates)
n8n_generate_workflow({
  description: "Slack daily standup reminder at 9am every weekday"
})
// → {
//     status: "proposals",
//     proposals: [
//       {
//         id: "uuid-1",
//         name: "Daily Standup Reminder",
//         description: "...",
//         flow_summary: "Schedule trigger → Slack message",
//         credentials_needed: ["slackApi"]
//       },
//       ...
//     ]
//   }

// Step 2: Deploy the proposal you picked
n8n_generate_workflow({
  description: "Slack daily standup reminder at 9am every weekday",
  deploy_id: "uuid-1"
})
// → { status: "deployed", workflow_id, workflow_name, workflow_url,
//     node_count, node_summary }
```

### Path B: Skip Cache → Preview → Confirm

Use when none of the proposals match what you want.

```javascript
// Step 1: Bypass proposals; get a fresh preview (NOT deployed)
n8n_generate_workflow({
  description: "Webhook receives JSON, transforms it, POSTs to a REST API",
  skip_cache: true
})
// → { status: "preview", ... }

// Step 2: Deploy the preview
n8n_generate_workflow({
  description: "Webhook receives JSON, transforms it, POSTs to a REST API",
  confirm_deploy: true
})
// → { status: "deployed", ... }
```

### Writing a Good Description

The quality of the generated workflow is bound by the clarity of the description. Always include:

- **Trigger type**: `webhook`, `schedule` (with cadence — "every 15 min", "weekdays at 9am"), `manual`, `form`, `chat`
- **Services involved**: name them explicitly (Slack, Gmail, HubSpot, Postgres, etc.) — generic terms ("a chat tool") yield generic results
- **Logic / flow**: branches, transforms, aggregation, deduplication, retry behavior

**Bad**: `"Send a notification when something happens"`

**Good**: `"When a new row is added to the 'leads' Postgres table, enrich it with Clearbit, then post a summary to the #sales Slack channel. Skip rows where 'company' is empty."`

### Parameters

| Parameter | Type | Use |
|-----------|------|-----|
| `description` | string (required) | Natural-language description |
| `deploy_id` | string | ID of a proposal from a prior call — deploys it |
| `skip_cache` | boolean | Skip proposals; generate from scratch and return a preview |
| `confirm_deploy` | boolean | Deploy the most recent preview from this session |

### Common Pitfalls

- **Hosted-only** — on self-hosted, no workflow is generated; fall back to `n8n_deploy_template` or `n8n_create_workflow`
- **Proposals are NOT deployed** — until you call again with `deploy_id` or `confirm_deploy`, nothing exists in n8n
- **Inactive on deploy** — generated workflows are created in **inactive** state; credentials must be configured in the n8n UI before activation
- **Per-session state** — pending proposals/preview live in MCP-session state; reconnecting loses them, and you'll need to re-issue the description

### Recommended Follow-Up

Always validate after deploying:
```javascript
n8n_generate_workflow({description: "...", deploy_id: "uuid-1"})
// → workflow_id: "abc"

n8n_validate_workflow({id: "abc"})
// → catches any node-version or connection issues the generator missed

// If issues found, n8n_autofix_workflow can resolve common ones
n8n_autofix_workflow({id: "abc", applyFixes: true})
```

---

## n8n_workflow_versions (VERSION CONTROL)

**Use when**: Managing workflow history, rollback, cleanup

### List Versions
```javascript
n8n_workflow_versions({
  mode: "list",
  workflowId: "workflow-id",
  limit: 10
})
```

### Get Specific Version
```javascript
n8n_workflow_versions({
  mode: "get",
  versionId: 123
})
```

### Rollback to Previous Version
```javascript
n8n_workflow_versions({
  mode: "rollback",
  workflowId: "workflow-id",
  versionId: 123,  // Optional: specific version
  validateBefore: true  // Default: validate before rollback
})
```

### Delete Versions
```javascript
// Delete specific version
n8n_workflow_versions({
  mode: "delete",
  workflowId: "workflow-id",
  versionId: 123
})

// Delete all versions for workflow
n8n_workflow_versions({
  mode: "delete",
  workflowId: "workflow-id",
  deleteAll: true
})
```

### Prune Old Versions
```javascript
n8n_workflow_versions({
  mode: "prune",
  workflowId: "workflow-id",
  maxVersions: 10  // Keep 10 most recent
})
```

---

## n8n_test_workflow (TRIGGER EXECUTION)

**Use when**: Testing workflow execution

**Auto-detects** trigger type (webhook, form, chat)

```javascript
// Test webhook workflow
n8n_test_workflow({
  workflowId: "workflow-id",
  triggerType: "webhook",  // Optional: auto-detected
  httpMethod: "POST",
  data: {message: "Hello!"},
  waitForResponse: true,
  timeout: 120000
})

// Test chat workflow
n8n_test_workflow({
  workflowId: "workflow-id",
  triggerType: "chat",
  message: "Hello, AI agent!",
  sessionId: "session-123"  // For conversation continuity
})
```

---

## n8n_manage_credentials (CREDENTIAL MANAGEMENT)

**Speed**: 50-500ms

**Use when**: Creating, updating, listing, or deleting credentials; discovering credential schemas

### 6 Actions

1. `list` - List all credentials (id, name, type, timestamps)
2. `get` - Get credential by ID (data field stripped)
3. `create` - Create credential (requires name, type, data)
4. `update` - Update credential by ID (name, data, and/or type)
5. `delete` - Permanently delete credential by ID
6. `getSchema` - Discover required fields for a credential type

`list` and `get` also accept an optional `includeUsage: true` flag that attaches workflow-usage info to each credential (see "Find Which Workflows Use a Credential" below).

### List Credentials
```javascript
n8n_manage_credentials({action: "list"})
// → [{id, name, type, createdAt, updatedAt}, ...]
```

### Get Credential
```javascript
n8n_manage_credentials({action: "get", id: "123"})
// → {id, name, type, ...} (data field stripped for security)
// Falls back to list+filter if GET returns 403/405
```

### Find Which Workflows Use a Credential
n8n's public API has no native "which workflows use credential X" endpoint, so n8n-mcp builds the reverse index for you by scanning workflows client-side. Pass `includeUsage: true` to either `list` or `get`.

```javascript
// Every credential, with the workflows that reference it
n8n_manage_credentials({action: "list", includeUsage: true})
// → {
//     credentials: [
//       {
//         id: "123",
//         name: "Production Slack",
//         type: "slackApi",
//         createdAt: "...", updatedAt: "...",
//         usedIn: [
//           {id: "wf_abc", name: "Daily digest",  active: true},
//           {id: "wf_xyz", name: "Alert fan-out", active: false}
//         ],
//         usageCount: 2
//       },
//       ...
//     ],
//     count: N,
//     // usageScanError: "..."  // present only if the workflow scan failed
//   }

// One credential, with its workflow references
n8n_manage_credentials({action: "get", id: "123", includeUsage: true})
// → Same shape as `get` plus usedIn and usageCount.
//   On scan failure: response sets usageScanError and omits usedIn/usageCount.
```

**When to use it:**
- Before `delete`: confirm nothing references the credential
- Before rotating a secret with `update`: see exactly which workflows you'll affect
- After `n8n_audit_instance` flags a credential: locate the workflows that need remediation

**Behavior and limits:**
- The reverse index is built client-side, deduplicated per workflow, and capped at 5000 workflows (same ceiling as `n8n_audit_instance`)
- Archived workflows are excluded by n8n's API — a "no usages" result does **not** prove a credential is unused; verify before destructive actions
- Triggers one full workflow scan per call. On large instances expect slower responses than the base ~50–500ms — budget accordingly when calling repeatedly
- If the scan fails, the response degrades to base credentials with a `usageScanError` field rather than failing the whole call
- Default behavior unchanged: omit the flag and no extra API calls happen

### Discover Schema
```javascript
n8n_manage_credentials({
  action: "getSchema",
  type: "httpHeaderAuth"
})
// → Required fields, types, descriptions for this credential type
```

### Create Credential
```javascript
n8n_manage_credentials({
  action: "create",
  name: "My Slack Token",
  type: "slackApi",
  data: {accessToken: "xoxb-your-token"}
})
// → Created credential (data field stripped from response)
```

### Update Credential
```javascript
n8n_manage_credentials({
  action: "update",
  id: "123",
  name: "Updated Slack Token",
  data: {accessToken: "xoxb-new-token"},
  type: "slackApi"  // Optional, some n8n versions require it
})
// → Updated credential (data field stripped from response)
```

### Delete Credential
```javascript
n8n_manage_credentials({action: "delete", id: "123"})
```

### Typical Workflow: Set Up Credentials for a New Integration
```javascript
// 1. Discover what fields are needed
n8n_manage_credentials({
  action: "getSchema",
  type: "slackApi"
})

// 2. Create the credential
n8n_manage_credentials({
  action: "create",
  name: "Production Slack",
  type: "slackApi",
  data: {accessToken: "xoxb-..."}
})

// 3. Verify it was created
n8n_manage_credentials({action: "list"})
```

### Typical Workflow: Safely Delete or Rotate a Credential
```javascript
// 1. Check what would break
n8n_manage_credentials({action: "get", id: "123", includeUsage: true})
// → Inspect usedIn — the {id, name, active} of every workflow that references it

// 2a. If nothing depends on it, delete
n8n_manage_credentials({action: "delete", id: "123"})

// 2b. If something does, rotate the secret instead and notify owners
n8n_manage_credentials({
  action: "update",
  id: "123",
  data: {accessToken: "xoxb-new-..."}
})
```

### Security Notes
- **Response stripping**: `get`, `create`, and `update` all strip the `data` field from responses (defense-in-depth — secrets are never returned)
- **Log redaction**: Credential request bodies are redacted from debug logs
- **Fallback resilience**: `get` falls back to list+filter when `GET /credentials/:id` returns 403/405 (endpoint not in all n8n versions)
- **Usage scan resilience**: when `includeUsage: true` triggers a workflow scan that fails, the response includes `usageScanError` and still returns the base credentials rather than erroring out

---

## n8n_audit_instance (SECURITY AUDIT)

**Speed**: 500-5000ms (scans all workflows)

**Use when**: Auditing instance security, finding hardcoded secrets, checking for unauthenticated webhooks, verifying error handling

### Two Scanning Approaches

**1. Built-in Audit** (via n8n's `POST /audit` API):
- 5 risk categories: `credentials`, `database`, `nodes`, `instance`, `filesystem`
- Wraps n8n's native audit endpoint; gracefully degrades if unavailable

**2. Custom Deep Scan** (workflow analysis):
- `hardcoded_secrets` — 50+ regex patterns for API keys/tokens/passwords plus PII detection
- `unauthenticated_webhooks` — Webhook/form triggers without authentication
- `error_handling` — Workflows with 3+ nodes and no error handling
- `data_retention` — Workflows saving all execution data

### Examples

```javascript
// Full audit (default)
n8n_audit_instance()

// Built-in audit only
n8n_audit_instance({
  categories: ["credentials", "nodes", "instance"],
  includeCustomScan: false
})

// Custom scan only — specific checks
n8n_audit_instance({
  customChecks: ["hardcoded_secrets", "unauthenticated_webhooks"]
})

// Custom abandoned workflow threshold
n8n_audit_instance({
  daysAbandonedWorkflow: 90
})
```

### Output

Returns an actionable markdown report with:
- **Summary table**: Critical/high/medium/low finding counts
- **Findings by workflow**: Per-workflow tables of issues
- **Built-in audit results**: n8n's native audit findings
- **Remediation Playbook**:
  - Auto-fixable items (with tool chains to apply)
  - Items requiring review (human judgment needed)
  - Items requiring user action (e.g., key rotation)

### Secret Masking
Detected secrets are masked in output — shows first 6 + last 4 characters only. Raw values are never stored or returned.

### Remediation Types
- `auto_fixable` — Can be fixed with MCP tools (e.g., add webhook auth)
- `review_recommended` — Needs human judgment (e.g., PII detection)
- `user_input_needed` — Requires user decision (e.g., choose auth method)
- `user_action_needed` — Manual action required (e.g., rotate exposed API key)

---

## n8n_validate_workflow (by ID)

**Use when**: Validating workflow stored in n8n

```javascript
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

## n8n_get_workflow

**Use when**: Retrieving workflow details

**Modes**:
- `full` (default) - Complete workflow JSON
- `details` - Full + execution stats
- `structure` - Nodes + connections only
- `minimal` - ID, name, active, tags

```javascript
// Full workflow
n8n_get_workflow({id: "workflow-id"})

// Just structure
n8n_get_workflow({id: "workflow-id", mode: "structure"})

// Minimal metadata
n8n_get_workflow({id: "workflow-id", mode: "minimal"})
```

---

## n8n_executions (EXECUTION MANAGEMENT)

**Use when**: Managing workflow executions

### Get Execution Details
```javascript
n8n_executions({
  action: "get",
  id: "execution-id",
  mode: "summary"  // preview, summary, filtered, full, error
})

// Error mode for debugging
n8n_executions({
  action: "get",
  id: "execution-id",
  mode: "error",
  includeStackTrace: true
})
```

### List Executions
```javascript
n8n_executions({
  action: "list",
  workflowId: "workflow-id",
  status: "error",  // success, error, waiting
  limit: 100
})
```

### Delete Execution
```javascript
n8n_executions({
  action: "delete",
  id: "execution-id"
})
```

---

## Workflow Lifecycle

**Standard pattern**:
```
1. CREATE
   n8n_create_workflow({...})
   → Returns workflow ID

2. VALIDATE
   n8n_validate_workflow({id})
   → Check for errors

3. EDIT (iterative! 56s avg between edits)
   n8n_update_partial_workflow({id, intent: "...", operations: [...]})
   → Make changes

4. VALIDATE AGAIN
   n8n_validate_workflow({id})
   → Verify changes

5. ACTIVATE
   n8n_update_partial_workflow({
     id,
     intent: "Activate workflow",
     operations: [{type: "activateWorkflow"}]
   })
   → Workflow now runs on triggers!

6. MONITOR
   n8n_executions({action: "list", workflowId: id})
   n8n_executions({action: "get", id: execution_id})
```

---

## Common Patterns from Telemetry

### Pattern 1: Edit → Validate (7,841 occurrences)
```javascript
n8n_update_partial_workflow({...})
// ↓ 23s (thinking about what to validate)
n8n_validate_workflow({id})
```

### Pattern 2: Validate → Fix (7,266 occurrences)
```javascript
n8n_validate_workflow({id})
// ↓ 58s (fixing errors)
n8n_update_partial_workflow({...})
```

### Pattern 3: Iterative Building (31,464 occurrences)
```javascript
update → update → update → ... (56s avg between edits)
```

**This shows**: Workflows are built **iteratively**, not in one shot!

---

## Best Practices

### Do

- Build workflows **iteratively** (avg 56s between edits)
- Include **intent** parameter for better responses
- Use **smart parameters** (branch, case) for clarity
- Validate **after** significant changes
- Use **atomic mode** (default) for critical updates
- Specify **sourceOutput** for AI connections
- Clean stale connections after node renames/deletions
- Use `n8n_deploy_template` for quick starts
- Activate workflows via API when ready

### Don't

- Try to build workflows in one shot
- Skip the intent parameter
- Use sourceIndex when branch/case available
- Skip validation before activation
- Forget to test workflows after creation
- Ignore auto-sanitization behavior

---

## Summary

**Most Important**:
1. **n8n_update_partial_workflow** is most-used tool (38,287 uses, 19 operation types)
2. Include **intent** parameter for better responses
3. Workflows built **iteratively** (56s avg between edits)
4. Use **smart parameters** (branch="true", case=0) for clarity
5. **patchNodeField** for surgical string edits (strict find/replace with regex support)
6. **AI connections** supported (8 types with sourceOutput)
7. **Workflow activation** supported via API (`activateWorkflow` operation)
8. **Auto-sanitization** runs on all operations
9. Use **n8n_deploy_template** for quick starts

**Additional Tools**:
- `n8n_deploy_template` - Deploy templates directly
- `n8n_workflow_versions` - Version control & rollback
- `n8n_test_workflow` - Trigger execution
- `n8n_executions` - Manage executions
- `n8n_manage_datatable` - Data table and row management
- `n8n_manage_credentials` - Credential CRUD + schema discovery
- `n8n_audit_instance` - Security audit (built-in + custom scan)
- `n8n_delete_workflow` - Permanently delete workflows
- `n8n_list_workflows` - List workflows with filtering
- `n8n_update_full_workflow` - Full workflow replacement

**Related**:
- [SEARCH_GUIDE.md](SEARCH_GUIDE.md) - Find nodes to add
- [VALIDATION_GUIDE.md](VALIDATION_GUIDE.md) - Validate workflows
