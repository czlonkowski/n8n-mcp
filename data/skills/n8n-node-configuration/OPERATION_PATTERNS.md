# Operation Patterns Guide

Common node configuration patterns organized by node type and operation.

---

## Overview

**Purpose**: Quick reference for common node configurations

**Coverage**: Top 20 most-used nodes from 525 available

**Pattern format**:
- Minimal valid configuration
- Common options
- Real-world examples
- Gotchas and tips

---

## HTTP & API Nodes

### HTTP Request (nodes-base.httpRequest)

Most versatile node for HTTP operations

#### GET Request

**Minimal**:
```javascript
{
  "method": "GET",
  "url": "https://api.example.com/users",
  "authentication": "none"
}
```

**With query parameters**:
```javascript
{
  "method": "GET",
  "url": "https://api.example.com/users",
  "authentication": "none",
  "sendQuery": true,
  "queryParameters": {
    "parameters": [
      {
        "name": "limit",
        "value": "100"
      },
      {
        "name": "offset",
        "value": "={{$json.offset}}"
      }
    ]
  }
}
```

**With authentication**:
```javascript
{
  "method": "GET",
  "url": "https://api.example.com/users",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth"
}
```

#### POST with JSON

**Minimal**:
```javascript
{
  "method": "POST",
  "url": "https://api.example.com/users",
  "authentication": "none",
  "sendBody": true,
  "body": {
    "contentType": "json",
    "content": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

**With expressions**:
```javascript
{
  "method": "POST",
  "url": "https://api.example.com/users",
  "authentication": "none",
  "sendBody": true,
  "body": {
    "contentType": "json",
    "content": {
      "name": "={{$json.name}}",
      "email": "={{$json.email}}",
      "metadata": {
        "source": "n8n",
        "timestamp": "={{$now.toISO()}}"
      }
    }
  }
}
```

**Gotcha**: Remember `sendBody: true` for POST/PUT/PATCH!

#### PUT/PATCH Request

**Pattern**: Same as POST, but method changes
```javascript
{
  "method": "PUT",  // or "PATCH"
  "url": "https://api.example.com/users/123",
  "authentication": "none",
  "sendBody": true,
  "body": {
    "contentType": "json",
    "content": {
      "name": "Updated Name"
    }
  }
}
```

#### DELETE Request

**Minimal** (no body):
```javascript
{
  "method": "DELETE",
  "url": "https://api.example.com/users/123",
  "authentication": "none"
}
```

**With body** (some APIs allow):
```javascript
{
  "method": "DELETE",
  "url": "https://api.example.com/users",
  "authentication": "none",
  "sendBody": true,
  "body": {
    "contentType": "json",
    "content": {
      "ids": ["123", "456"]
    }
  }
}
```

---

### Webhook (nodes-base.webhook)

Most common trigger - 813 searches!

#### Basic Webhook

**Minimal**:
```javascript
{
  "path": "my-webhook",
  "httpMethod": "POST",
  "responseMode": "onReceived"
}
```

**Gotcha**: Webhook data is under `$json.body`, not `$json`!

```javascript
// ❌ Wrong
{
  "text": "={{$json.email}}"
}

// ✅ Correct
{
  "text": "={{$json.body.email}}"
}
```

#### Webhook with Authentication

**Header auth**:
```javascript
{
  "path": "secure-webhook",
  "httpMethod": "POST",
  "responseMode": "onReceived",
  "authentication": "headerAuth",
  "options": {
    "responseCode": 200,
    "responseData": "{\n  \"success\": true\n}"
  }
}
```

#### Webhook Returning Data

**Custom response**:
```javascript
{
  "path": "my-webhook",
  "httpMethod": "POST",
  "responseMode": "lastNode",  // Return data from last node
  "options": {
    "responseCode": 201,
    "responseHeaders": {
      "entries": [
        {
          "name": "Content-Type",
          "value": "application/json"
        }
      ]
    }
  }
}
```

---

## Communication Nodes

### Slack (nodes-base.slack)

Popular choice for AI agent workflows

#### Post Message

**Minimal**:
```javascript
{
  "resource": "message",
  "operation": "post",
  "channel": "#general",
  "text": "Hello from n8n!"
}
```

**With dynamic content**:
```javascript
{
  "resource": "message",
  "operation": "post",
  "channel": "={{$json.channel}}",
  "text": "New user: {{$json.name}} ({{$json.email}})"
}
```

**With attachments**:
```javascript
{
  "resource": "message",
  "operation": "post",
  "channel": "#alerts",
  "text": "Error Alert",
  "attachments": [
    {
      "color": "#ff0000",
      "fields": [
        {
          "title": "Error Type",
          "value": "={{$json.errorType}}"
        },
        {
          "title": "Timestamp",
          "value": "={{$now.toLocaleString()}}"
        }
      ]
    }
  ]
}
```

**Gotcha**: Channel must start with `#` for public channels or be a channel ID!

#### Update Message

**Minimal**:
```javascript
{
  "resource": "message",
  "operation": "update",
  "messageId": "1234567890.123456",  // From previous message post
  "text": "Updated message content"
}
```

**Note**: `messageId` required, `channel` optional (can be inferred)

#### Create Channel

**Minimal**:
```javascript
{
  "resource": "channel",
  "operation": "create",
  "name": "new-project-channel",  // Lowercase, no spaces
  "isPrivate": false
}
```

**Gotcha**: Channel name must be lowercase, no spaces, 1-80 chars!

---

### Gmail (nodes-base.gmail)

Popular for email automation

#### Send Email

**Minimal**:
```javascript
{
  "resource": "message",
  "operation": "send",
  "to": "user@example.com",
  "subject": "Hello from n8n",
  "message": "This is the email body"
}
```

**With dynamic content**:
```javascript
{
  "resource": "message",
  "operation": "send",
  "to": "={{$json.email}}",
  "subject": "Order Confirmation #{{$json.orderId}}",
  "message": "Dear {{$json.name}},\n\nYour order has been confirmed.\n\nThank you!",
  "options": {
    "ccList": "admin@example.com",
    "replyTo": "support@example.com"
  }
}
```

#### Get Email

**Minimal**:
```javascript
{
  "resource": "message",
  "operation": "getAll",
  "returnAll": false,
  "limit": 10
}
```

**With filters**:
```javascript
{
  "resource": "message",
  "operation": "getAll",
  "returnAll": false,
  "limit": 50,
  "filters": {
    "q": "is:unread from:important@example.com",
    "labelIds": ["INBOX"]
  }
}
```

---

## Database Nodes

### Postgres (nodes-base.postgres)

Database operations - 456 templates

#### Execute Query

**Minimal** (SELECT):
```javascript
{
  "operation": "executeQuery",
  "query": "SELECT * FROM users WHERE active = true LIMIT 100"
}
```

**With parameters** (SQL injection prevention):
```javascript
{
  "operation": "executeQuery",
  "query": "SELECT * FROM users WHERE email = $1 AND active = $2",
  "additionalFields": {
    "mode": "list",
    "queryParameters": "user@example.com,true"
  }
}
```

**Gotcha**: ALWAYS use parameterized queries for user input!

```javascript
// ❌ BAD - SQL injection risk!
{
  "query": "SELECT * FROM users WHERE email = '{{$json.email}}'"
}

// ✅ GOOD - Parameterized
{
  "query": "SELECT * FROM users WHERE email = $1",
  "additionalFields": {
    "mode": "list",
    "queryParameters": "={{$json.email}}"
  }
}
```

#### Insert

**Minimal**:
```javascript
{
  "operation": "insert",
  "table": "users",
  "columns": "name,email,created_at",
  "additionalFields": {
    "mode": "list",
    "queryParameters": "John Doe,john@example.com,NOW()"
  }
}
```

**With expressions**:
```javascript
{
  "operation": "insert",
  "table": "users",
  "columns": "name,email,metadata",
  "additionalFields": {
    "mode": "list",
    "queryParameters": "={{$json.name}},={{$json.email}},{{JSON.stringify($json)}}"
  }
}
```

#### Update

**Minimal**:
```javascript
{
  "operation": "update",
  "table": "users",
  "updateKey": "id",
  "columns": "name,email",
  "additionalFields": {
    "mode": "list",
    "queryParameters": "={{$json.id}},Updated Name,newemail@example.com"
  }
}
```

---

## Storage Nodes

### Data Table (nodes-base.dataTable)

Persistent, structured per-project key-value storage — an in-n8n alternative to external SQL for small state like buffers, de-dup sets, counters, or lookup caches. **Do not confuse with the MCP tool `n8n_manage_datatable`** — that tool manages tables from outside n8n (create/list/delete tables and rows from Claude). The **`nodes-base.dataTable` node** below is what you drop *into a workflow* to read/write rows during execution.

> **Verified end-to-end against live n8n on 2026-04-08** with a 15-node assertion harness exercising every claim below: insert returning rows with system `id`, `like` operator, `returnAll`, `allConditions` AND-of-multiple-filters, `isTrue` unary boolean condition, `upsert` with `matchingColumns` (no duplicates), `defineBelow` resourceMapper writing values, `deleteRows` (the reserved-word workaround) returning affected rows, and `dataTableId` resourceLocator in `mode: "name"`. All 6 assertions passed.

**Node shape**:
- `type`: `n8n-nodes-base.dataTable`
- `typeVersion`: `1.1` (also `1`)
- `resource`: `"row"` or `"table"`
- Row `operation` values — note the reserved-word workaround on delete:
  - `"insert"` — Insert row
  - `"get"` — Get row(s)
  - `"update"` — Update row(s) matching conditions
  - `"upsert"` — Update if match, else insert
  - `"deleteRows"` — Delete row(s) matching conditions (**not `"delete"`** — `delete` is a JS reserved word, the node uses `deleteRows`)
  - `"rowExists"` — Pass through input if at least one match
  - `"rowNotExists"` — Pass through input if zero matches

**Table selection** — always a resourceLocator parameter named `dataTableId`:
```javascript
"dataTableId": {
  "__rl": true,
  "mode": "list",      // or "name" or "id"
  "value": "dt_xyz123" // or the name when mode=name
}
```

**Row mapping** (insert/update/upsert) — resourceMapper parameter named `columns`:
```javascript
"columns": {
  "mappingMode": "defineBelow",    // or "autoMapInputData"
  "value": {
    "user_email": "={{ $json.email }}",
    "score": "={{ $json.score }}",
    "active": true
  },
  "matchingColumns": [],           // filled for update/upsert match keys
  "schema": [],                    // n8n re-loads at runtime; safe to leave empty
  "attemptToConvertTypes": false,
  "convertFieldsToString": false
}
```
In `autoMapInputData` mode, incoming item field names must match column names exactly and `value` is ignored.

**Filtering** (get/update/upsert/deleteRows/rowExists/rowNotExists):
```javascript
"matchType": "anyCondition",   // or "allConditions"
"filters": {
  "conditions": [
    { "keyName": "user_email", "condition": "eq",        "keyValue": "a@b.com" },
    { "keyName": "score",      "condition": "gte",       "keyValue": 10 },
    { "keyName": "archived",   "condition": "isNotEmpty"  }
  ]
}
```
Supported `condition` values: `eq, neq, like, ilike, gt, gte, lt, lte, isEmpty, isNotEmpty, isTrue, isFalse`. The last four are unary — omit `keyValue`.

**Get options**: `returnAll: true` bypasses the default 50-row limit. `options` can include ordering.

**Insert option**: `options.optimizeBulk: true` skips returning inserted rows for ~5x bulk throughput. Do not use when downstream nodes need the inserted row ids.

**Mutating ops** (update/upsert/deleteRows) accept `options.dryRun: true` — returns the rows that *would* be affected with before/after states, without writing.

#### Minimal Insert
```javascript
{
  "resource": "row",
  "operation": "insert",
  "dataTableId": { "__rl": true, "mode": "name", "value": "email_buffer" },
  "columns": {
    "mappingMode": "defineBelow",
    "value": {
      "from_name": "={{ $json.from_name }}",
      "subject":   "={{ $json.subject }}"
    },
    "matchingColumns": [],
    "schema": []
  },
  "options": {}
}
```

#### Get All Rows
`Get` requires at least one condition — a bare "return everything" isn't allowed. Trick: filter on the always-populated system `id` column with `isNotEmpty`.
```javascript
{
  "resource": "row",
  "operation": "get",
  "dataTableId": { "__rl": true, "mode": "name", "value": "email_buffer" },
  "matchType": "anyCondition",
  "filters": {
    "conditions": [ { "keyName": "id", "condition": "isNotEmpty" } ]
  },
  "returnAll": true,
  "options": {}
}
```

#### Delete All Rows
Same `id isNotEmpty` trick — a delete without conditions throws `At least one condition is required`.
```javascript
{
  "resource": "row",
  "operation": "deleteRows",
  "dataTableId": { "__rl": true, "mode": "name", "value": "email_buffer" },
  "matchType": "anyCondition",
  "filters": {
    "conditions": [ { "keyName": "id", "condition": "isNotEmpty" } ]
  },
  "options": {}
}
```

#### Upsert by Natural Key
```javascript
{
  "resource": "row",
  "operation": "upsert",
  "dataTableId": { "__rl": true, "mode": "name", "value": "user_scores" },
  "matchType": "allConditions",
  "filters": {
    "conditions": [ { "keyName": "user_email", "condition": "eq", "keyValue": "={{ $json.email }}" } ]
  },
  "columns": {
    "mappingMode": "defineBelow",
    "value": {
      "user_email": "={{ $json.email }}",
      "score":      "={{ $json.score }}"
    },
    "matchingColumns": ["user_email"],
    "schema": []
  },
  "options": {}
}
```

**System columns**: every table auto-has `id` plus created/updated timestamps — you don't declare these and can't write to them. They're usable in filters.

**When to reach for Data Table vs alternatives**:

| Need | Use |
|------|-----|
| Small per-workflow scratch state, single workflow, not durable across workflow edits | `$getWorkflowStaticData('global')` inside a Code node |
| Persistent structured state, queryable by column, survives workflow rename/edit/deactivation, shared across multiple workflows in the same project | **Data Table node** |
| Large datasets (>>10k rows), complex joins, transactions, FKs, indexes | External Postgres/MySQL |
| Unstructured key-value cache with TTL | Redis |

**Gotchas**:
- Scope is **per project** — Data Tables are not shared across n8n projects. Move a workflow to another project and its Data Table references break.
- Filter operator `eq` on a column that doesn't exist in the table returns a validation error at execution, not at import — always verify column names match the live table.
- Expression values in `columns.value` are evaluated per input item. If the upstream node emits N items, Insert runs N times unless you explicitly use `optimizeBulk`.
- `deleteRows` is the operation value, not `delete`. Using `delete` will import but fail at execution with "unknown operation".
- Race condition in buffer/flush patterns: rows added between `Get` and `deleteRows` will be wiped without being read. For at-least-once semantics, delete by specific row ids returned from `Get` instead of by a broad filter.
- **Zero-match halts the chain.** When `get`, `deleteRows`, `update`, or `upsert` matches 0 rows, the node emits 0 output items and n8n stops the downstream branch silently — no error, just nothing happens. This bites cleanup steps in idempotent test/setup workflows where the table starts empty. Fix: set node-level `"alwaysOutputData": true` (sibling of `parameters`/`type`, NOT inside `parameters`) on any DT node that may legitimately match nothing. The node will then emit a single empty item and the chain continues.
- **DT operations execute once per input item.** A `Get` node fed 3 input items will run 3 separate queries and concatenate the results — usually not what you want. Insert a "collapse" Code node (`return [{ json: {} }];`) between any multi-item-emitting node and a downstream DT op that should run exactly once.
- DT nodes do not natively offer a "run once for all items" mode like the Code node — the collapse-node pattern is currently the only clean workaround.

---

## Data Transformation Nodes

### Set (nodes-base.set)

Most used transformation - 68% of workflows!

#### Set Fixed Values

**Minimal**:
```javascript
{
  "mode": "manual",
  "duplicateItem": false,
  "assignments": {
    "assignments": [
      {
        "name": "status",
        "value": "active",
        "type": "string"
      },
      {
        "name": "count",
        "value": 100,
        "type": "number"
      }
    ]
  }
}
```

#### Set from Input Data

**Mapping data**:
```javascript
{
  "mode": "manual",
  "duplicateItem": false,
  "assignments": {
    "assignments": [
      {
        "name": "fullName",
        "value": "={{$json.firstName}} {{$json.lastName}}",
        "type": "string"
      },
      {
        "name": "email",
        "value": "={{$json.email.toLowerCase()}}",
        "type": "string"
      },
      {
        "name": "timestamp",
        "value": "={{$now.toISO()}}",
        "type": "string"
      }
    ]
  }
}
```

**Gotcha**: Use correct `type` for each field!

```javascript
// ❌ Wrong type
{
  "name": "age",
  "value": "25",      // String
  "type": "string"    // Will be string "25"
}

// ✅ Correct type
{
  "name": "age",
  "value": 25,        // Number
  "type": "number"    // Will be number 25
}
```

---

### Code (nodes-base.code)

JavaScript execution - 42% of workflows

#### Simple Transformation

**Minimal**:
```javascript
{
  "mode": "runOnceForAllItems",
  "jsCode": "return $input.all().map(item => ({\n  json: {\n    name: item.json.name.toUpperCase(),\n    email: item.json.email\n  }\n}));"
}
```

**Per-item processing**:
```javascript
{
  "mode": "runOnceForEachItem",
  "jsCode": "// Process each item\nconst data = $input.item.json;\n\nreturn {\n  json: {\n    fullName: `${data.firstName} ${data.lastName}`,\n    email: data.email.toLowerCase(),\n    timestamp: new Date().toISOString()\n  }\n};"
}
```

**Gotcha**: In Code nodes, use `$input.item.json` or `$input.all()`, NOT `{{...}}`!

```javascript
// ❌ Wrong - expressions don't work in Code nodes
{
  "jsCode": "const name = '={{$json.name}}';"
}

// ✅ Correct - direct access
{
  "jsCode": "const name = $input.item.json.name;"
}
```

---

## Conditional Nodes

### IF (nodes-base.if)

Conditional logic - 38% of workflows

#### String Comparison

**Equals** (binary):
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.status}}",
        "operation": "equals",
        "value2": "active"
      }
    ]
  }
}
```

**Contains** (binary):
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.email}}",
        "operation": "contains",
        "value2": "@example.com"
      }
    ]
  }
}
```

**isEmpty** (unary):
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.email}}",
        "operation": "isEmpty"
        // No value2 - unary operator
        // singleValue: true added by auto-sanitization
      }
    ]
  }
}
```

**Gotcha**: Unary operators (isEmpty, isNotEmpty) don't need value2!

#### Number Comparison

**Greater than**:
```javascript
{
  "conditions": {
    "number": [
      {
        "value1": "={{$json.age}}",
        "operation": "larger",
        "value2": 18
      }
    ]
  }
}
```

#### Boolean Comparison

**Is true**:
```javascript
{
  "conditions": {
    "boolean": [
      {
        "value1": "={{$json.isActive}}",
        "operation": "true"
        // Unary - no value2
      }
    ]
  }
}
```

#### Multiple Conditions (AND)

**All must match**:
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.status}}",
        "operation": "equals",
        "value2": "active"
      }
    ],
    "number": [
      {
        "value1": "={{$json.age}}",
        "operation": "larger",
        "value2": 18
      }
    ]
  },
  "combineOperation": "all"  // AND logic
}
```

#### Multiple Conditions (OR)

**Any can match**:
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.status}}",
        "operation": "equals",
        "value2": "active"
      },
      {
        "value1": "={{$json.status}}",
        "operation": "equals",
        "value2": "pending"
      }
    ]
  },
  "combineOperation": "any"  // OR logic
}
```

---

### Switch (nodes-base.switch)

Multi-way routing - 18% of workflows

#### Basic Switch

**Minimal**:
```javascript
{
  "mode": "rules",
  "rules": {
    "rules": [
      {
        "conditions": {
          "string": [
            {
              "value1": "={{$json.status}}",
              "operation": "equals",
              "value2": "active"
            }
          ]
        }
      },
      {
        "conditions": {
          "string": [
            {
              "value1": "={{$json.status}}",
              "operation": "equals",
              "value2": "pending"
            }
          ]
        }
      }
    ]
  },
  "fallbackOutput": "extra"  // Catch-all for non-matching
}
```

**Gotcha**: Number of rules must match number of outputs!

---

## AI Nodes

### OpenAI (nodes-langchain.openAi)

AI operations - 234 templates

#### Chat Completion

**Minimal**:
```javascript
{
  "resource": "chat",
  "operation": "complete",
  "messages": {
    "values": [
      {
        "role": "user",
        "content": "={{$json.prompt}}"
      }
    ]
  }
}
```

**With system prompt**:
```javascript
{
  "resource": "chat",
  "operation": "complete",
  "messages": {
    "values": [
      {
        "role": "system",
        "content": "You are a helpful assistant specialized in customer support."
      },
      {
        "role": "user",
        "content": "={{$json.userMessage}}"
      }
    ]
  },
  "options": {
    "temperature": 0.7,
    "maxTokens": 500
  }
}
```

---

## Schedule Nodes

### Schedule Trigger (nodes-base.scheduleTrigger)

Time-based workflows - 28% have schedule triggers

#### Daily at Specific Time

**Minimal**:
```javascript
{
  "rule": {
    "interval": [
      {
        "field": "hours",
        "hoursInterval": 24
      }
    ],
    "hour": 9,
    "minute": 0,
    "timezone": "America/New_York"
  }
}
```

**Gotcha**: Always set timezone explicitly!

```javascript
// ❌ Bad - uses server timezone
{
  "rule": {
    "interval": [...]
  }
}

// ✅ Good - explicit timezone
{
  "rule": {
    "interval": [...],
    "timezone": "America/New_York"
  }
}
```

#### Every N Minutes

**Minimal**:
```javascript
{
  "rule": {
    "interval": [
      {
        "field": "minutes",
        "minutesInterval": 15
      }
    ]
  }
}
```

#### Cron Expression

**Advanced scheduling**:
```javascript
{
  "mode": "cron",
  "cronExpression": "0 */2 * * *",  // Every 2 hours
  "timezone": "America/New_York"
}
```

---

## Summary

**Key Patterns by Category**:

| Category | Most Common | Key Gotcha |
|---|---|---|
| HTTP/API | GET, POST JSON | Remember sendBody: true |
| Webhooks | POST receiver | Data under $json.body |
| Communication | Slack post | Channel format (#name) |
| Database | SELECT with params | Use parameterized queries |
| Transform | Set assignments | Correct type per field |
| Conditional | IF string equals | Unary vs binary operators |
| AI | OpenAI chat | System + user messages |
| Schedule | Daily at time | Set timezone explicitly |

**Configuration Approach**:
1. Use patterns as starting point
2. Adapt to your use case
3. Validate configuration
4. Iterate based on errors
5. Deploy when valid

**Related Files**:
- **[SKILL.md](SKILL.md)** - Configuration workflow and philosophy
- **[DEPENDENCIES.md](DEPENDENCIES.md)** - Property dependency rules

---

## Worked Example: Configuring HTTP Request Step by Step

A full validate-driven walkthrough of building a `POST` JSON request from minimal config, letting validation surface each required field.

**Step 1**: Identify what you need
```javascript
// Goal: POST JSON to API
```

**Step 2**: Get node info
```javascript
const info = get_node({
  nodeType: "nodes-base.httpRequest"
});

// Returns: method, url, sendBody, body, authentication required/optional
```

**Step 3**: Minimal config
```javascript
{
  "method": "POST",
  "url": "https://api.example.com/create",
  "authentication": "none"
}
```

**Step 4**: Validate
```javascript
validate_node({
  nodeType: "nodes-base.httpRequest",
  config,
  profile: "runtime"
});
// → Error: "sendBody required for POST"
```

**Step 5**: Add required field
```javascript
{
  "method": "POST",
  "url": "https://api.example.com/create",
  "authentication": "none",
  "sendBody": true
}
```

**Step 6**: Validate again
```javascript
validate_node({...});
// → Error: "body required when sendBody=true"
```

**Step 7**: Complete configuration
```javascript
{
  "method": "POST",
  "url": "https://api.example.com/create",
  "authentication": "none",
  "sendBody": true,
  "body": {
    "contentType": "json",
    "content": {
      "name": "={{$json.name}}",
      "email": "={{$json.email}}"
    }
  }
}
```

**Step 8**: Final validation
```javascript
validate_node({...});
// → Valid! ✅
```

---

## Operation-Specific Configuration Examples

Concrete minimal configs showing how required fields differ by resource + operation.

### Slack Node Examples

#### Post Message
```javascript
{
  "resource": "message",
  "operation": "post",
  "channel": "#general",      // Required
  "text": "Hello!",           // Required
  "attachments": [],          // Optional
  "blocks": []                // Optional
}
```

#### Update Message
```javascript
{
  "resource": "message",
  "operation": "update",
  "messageId": "1234567890",  // Required (different from post!)
  "text": "Updated!",         // Required
  "channel": "#general"       // Optional (can be inferred)
}
```

#### Create Channel
```javascript
{
  "resource": "channel",
  "operation": "create",
  "name": "new-channel",      // Required
  "isPrivate": false          // Optional
  // Note: text NOT required for this operation
}
```

### HTTP Request Node Examples

#### GET Request
```javascript
{
  "method": "GET",
  "url": "https://api.example.com/users",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth",
  "sendQuery": true,                    // Optional
  "queryParameters": {                  // Shows when sendQuery=true
    "parameters": [
      {
        "name": "limit",
        "value": "100"
      }
    ]
  }
}
```

#### POST with JSON
```javascript
{
  "method": "POST",
  "url": "https://api.example.com/users",
  "authentication": "none",
  "sendBody": true,                     // Required for POST
  "body": {                             // Required when sendBody=true
    "contentType": "json",
    "content": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

### IF Node Examples

#### String Comparison (Binary)
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.status}}",
        "operation": "equals",
        "value2": "active"              // Binary: needs value2
      }
    ]
  }
}
```

#### Empty Check (Unary)
```javascript
{
  "conditions": {
    "string": [
      {
        "value1": "={{$json.email}}",
        "operation": "isEmpty",
        // No value2 - unary operator
        "singleValue": true             // Auto-added by sanitization
      }
    ]
  }
}
```
