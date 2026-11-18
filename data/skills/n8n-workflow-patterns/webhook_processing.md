# Webhook Processing Pattern

**Use Case**: Receive HTTP requests from external systems and process them instantly.

---

## Pattern Structure

```
Webhook → [Validate] → [Transform] → [Action] → [Response/Notify]
```

**Key Characteristic**: Instant event-driven processing

---

## Core Components

### 1. Webhook Node (Trigger)
**Purpose**: Create HTTP endpoint to receive data

**Configuration**:
```javascript
{
  path: "form-submit",        // URL path: https://n8n.example.com/webhook/form-submit
  httpMethod: "POST",         // GET, POST, PUT, DELETE
  responseMode: "onReceived", // or "lastNode" for custom response
  responseData: "allEntries"  // or "firstEntryJson"
}
```

**Critical Gotcha**: Data is nested under `$json.body`
```javascript
❌ {{$json.email}}
✅ {{$json.body.email}}
```

### 2. Validation (Optional but Recommended)
**Purpose**: Verify incoming data before processing

**Options**:
- **IF node** - Check required fields exist (one condition per rule)
- **Stop and Error** - Fail gracefully with message
- **Code node** - Only when the caller needs per-field error messages (a loop over a schema; see `n8n-error-handling`)

**Example**:
```javascript
// IF node condition
{{$json.body.email}} is not empty AND
{{$json.body.name}} is not empty
```

### 3. Transformation
**Purpose**: Map webhook data to desired format

**Typical nodes**:
- **None** - Map fields in the action node's own slots (`{{ $json.body.email }}` straight in the CRM or database node)
- **Edit Fields (Set)** - A named step: a payload several nodes read, constants, an error or return item
- **Native transforms** - Split Out, Filter, Summarize, Date & Time (see the job-to-node table in `using-n8n-mcp-skills`)

**Example** (Edit Fields, when several nodes read these values):
```javascript
{
  "user_email": "={{$json.body.email}}",
  "user_name": "={{$json.body.name}}",
  "timestamp": "={{$now}}"
}
```

### 4. Action
**Purpose**: Do something with the data

**Common actions**:
- Store in database (Postgres, MySQL, MongoDB)
- Send notification (Slack, Email, Discord)
- Call another API (HTTP Request)
- Update external system (CRM, support ticket)

### 5. Response (If responseMode: "lastNode")
**Purpose**: Send custom HTTP response

**Webhook Response Node**:
```javascript
{
  statusCode: 200,
  headers: {
    "Content-Type": "application/json"
  },
  body: {
    "status": "success",
    "message": "Form received"
  }
}
```

---

## Common Use Cases

### 1. Form Submissions
**Flow**: Form → Webhook → Validate → Database → Email Confirmation

**Example**:
```
1. Webhook (path: "contact-form", POST)
2. IF (check email & message not empty)
3. Postgres (insert into contacts table)
4. Email (send confirmation to user)
5. Slack (notify team in #leads)
6. Webhook Response ({"status": "success"})
```

**Real Data Access**:
```javascript
Name: {{$json.body.name}}
Email: {{$json.body.email}}
Message: {{$json.body.message}}
```

### 2. Payment Webhooks (Stripe, PayPal)
**Flow**: Payment Provider → Webhook → Verify → Update Database → Send Receipt

**Security**: Verify webhook signatures — with the provider's trigger node when one exists (Stripe Trigger, GitHub
Trigger), otherwise natively:

```
Webhook (options.rawBody: true)
  → Crypto (hmac SHA256 over the binary "data"; secret from a crypto credential)
  → IF (signature header equals the computed value) → process / Respond 401
```

The signature is computed over the **raw** body; re-serialising `$json.body` breaks it. Stripe signs
`<timestamp>.<raw body>` rather than the body alone, so its check needs that string built first. Full node JSON:
`n8n-node-configuration` → NATIVE_NODES.md → "Webhook signature".

### 3. Chat Platform Integrations (Slack, Discord, Teams)
**Flow**: Chat Command → Webhook → Process → Respond

**Example** (Slack slash command):
```
1. Webhook (path: "slack-command", POST)
2. HTTP Request (fetch data from API; query = {{ $json.body.text }})
3. Respond to Webhook (immediate Slack response; the message is built with expressions from $json and $('Webhook').item.json.body)
```

The Slack payload fields are read where they're used (`$json.body.text`, `$json.body.user_id`); no parsing node is needed.

**Slack Data Access**:
```javascript
Command: {{$json.body.command}}
Text: {{$json.body.text}}
User ID: {{$json.body.user_id}}
Channel ID: {{$json.body.channel_id}}
```

### 4. GitHub/GitLab Webhooks
**Flow**: Git Event → Webhook → Parse → Notify/Deploy

**Example** (new PR notification):
```
1. Webhook (path: "github", POST)
2. IF (check $json.body.action equals "opened")
3. Slack (notify #dev-team; title, author and URL read with the expressions below)
4. Webhook Response (200 OK)
```

The GitHub Trigger node registers the webhook and filters events for you; prefer it over a bare Webhook (service node
first).

**GitHub Data Access**:
```javascript
Event Type: {{$json.headers['x-github-event']}}
Action: {{$json.body.action}}
PR Title: {{$json.body.pull_request.title}}
Author: {{$json.body.pull_request.user.login}}
URL: {{$json.body.pull_request.html_url}}
```

### 5. IoT Device Data
**Flow**: Device → Webhook → Validate → Store → Alert (if threshold)

**Example** (temperature sensor):
```
1. Webhook (path: "sensor-data", POST)
2. Postgres (insert into sensor_readings; columns from $json.body.*)
3. IF (temperature > 80)
4. Email (alert admin)
```

---

## Webhook Data Structure

### Standard Structure
```json
{
  "headers": {
    "content-type": "application/json",
    "user-agent": "...",
    "x-custom-header": "..."
  },
  "params": {
    "id": "123"  // From URL: /webhook/form/:id
  },
  "query": {
    "token": "abc"  // From URL: /webhook/form?token=abc
  },
  "body": {
    // ⚠️ YOUR DATA IS HERE!
    "name": "John",
    "email": "john@example.com"
  }
}
```

### Accessing Different Parts
```javascript
// Headers
{{$json.headers['content-type']}}
{{$json.headers['x-api-key']}}

// URL Parameters
{{$json.params.id}}

// Query Parameters
{{$json.query.token}}
{{$json.query.page}}

// Body (MOST COMMON)
{{$json.body.email}}
{{$json.body.user.name}}
{{$json.body.items[0].price}}
```

---

## Authentication & Security

### 1. Header or Basic Auth (shared secret)
**Simple and enough for most internal callers**

Set the Webhook node's `authentication` to `headerAuth` (or `basicAuth` / `jwtAuth`) and attach a credential. n8n
rejects requests without the right header before the workflow runs. Never compare a token in an IF node: the secret
then sits in the workflow JSON, which breaks the "secrets never go in text fields" rule.

```json
{ "httpMethod": "POST", "path": "orders", "authentication": "headerAuth", "responseMode": "responseNode", "options": {} }
```

Query-string tokens leak into logs and browser history; prefer a header.

### 2. Signature Verification (HMAC)
**Best security** (for webhooks from services like GitHub, Shopify, Stripe)

```
Webhook (options.rawBody: true)
  → Crypto (typeVersion 2, action hmac, type SHA256, binaryData true, binaryPropertyName "data", encoding hex;
            secret from a crypto credential)
  → IF {{ $('Webhook').item.json.headers['x-hub-signature-256'] }} equals {{ 'sha256=' + $json.computedSignature }}
      ├─ true  → process
      └─ false → Respond to Webhook 401
```

- Compute over the raw body (`rawBody: true` puts it in binary `data`); `JSON.stringify($json.body)` changes the bytes.
- Header name and prefix differ per provider (GitHub `x-hub-signature-256: sha256=…`, Shopify base64). Read their docs.
- Use the provider's trigger node if n8n has one (GitHub Trigger, Stripe Trigger) before building this by hand.
- Full JSON: `n8n-node-configuration` → NATIVE_NODES.md → "Webhook signature".

### 3. IP Allowlist

**Restrict access by IP** with the Webhook node's `options.ipWhitelist` ("IP(s) Allowlist"): comma-separated
addresses or CIDR ranges; empty allows all. Good for internal callers with fixed addresses, on top of auth.

---

## Response Modes

### onReceived (Default)
**Behavior**: Immediate 200 OK response, workflow continues in background

**Use when**:
- Long-running workflows
- Response doesn't depend on workflow result
- Fire-and-forget processing

**Configuration**:
```javascript
{
  responseMode: "onReceived",
  options: { responseCode: { values: { responseCode: 200 } } }   // Webhook v2+: a nested collection
}
```

### lastNode (Custom Response)
**Behavior**: Wait for workflow completion, send custom response

**Use when**:
- Need to return data to caller
- Synchronous processing required
- Form submissions with confirmation

**Configuration**:
```javascript
{
  responseMode: "lastNode"
}
```

**Then add Webhook Response node**:
```javascript
{
  statusCode: 200,
  headers: {
    "Content-Type": "application/json"
  },
  body: {
    "id": "={{$json.record_id}}",
    "status": "success"
  }
}
```

---

## Error Handling

### Pattern 1: Try-Catch with Error Trigger
```
Main Flow:
  Webhook → [nodes...] → Success Response

Error Flow:
  Error Trigger → Log Error → Slack Alert → Error Response
```

**Error Trigger Configuration**:
```javascript
{
  workflowId: "current-workflow-id"
}
```

**Error Response** (if responseMode: "lastNode"):
```javascript
{
  statusCode: 500,
  body: {
    "status": "error",
    "message": "Processing failed"
  }
}
```

### Pattern 2: Validation Early Exit
```
Webhook → IF (validate) → [True: Process]
                       └→ [False: Error Response]
```

**False Branch Response**:
```javascript
{
  statusCode: 400,
  body: {
    "status": "error",
    "message": "Invalid data: missing email"
  }
}
```

### Pattern 3: Continue On Fail
**Per-node setting**: Continue even if node fails

**Use case**: Non-critical notifications
```
Webhook → Database (critical) → Slack (continueOnFail: true)
```

---

## Testing Webhooks

### 1. Use Manual Trigger
Replace Webhook with Manual Trigger for testing:
```
Manual Trigger → [set test data] → rest of workflow
```

### 2. Use curl
```bash
curl -X POST https://n8n.example.com/webhook/form-submit \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test User"}'
```

### 3. Use Postman/Insomnia
- Create request collection
- Test different payloads
- Verify responses

### 4. Webhook.site
- Use webhook.site for testing
- Copy webhook.site URL to your service
- View requests and debug

---

## Performance Considerations

### Large Payloads
- Webhook timeout: 120 seconds (default)
- For large data, consider async processing:
  ```
  Webhook → Queue (Redis/DB) → Response (immediate)

  Separate Workflow:
  Schedule → Check Queue → Process
  ```

### High Volume
- Use "Execute Once" mode if processing all items together
- Consider rate limiting
- Monitor execution times
- Scale n8n instance if needed

### Retries
- Webhook calls typically don't retry automatically
- Implement retry logic on caller side
- Or use queue pattern for guaranteed processing

---

## Common Gotchas

### 1. ❌ Wrong: Accessing webhook data
```javascript
{{$json.email}}  // Empty or undefined
```

### ✅ Correct
```javascript
{{$json.body.email}}  // Data is under .body
```

### 2. ❌ Wrong: Response mode confusion
Using Webhook Response node with responseMode: "onReceived" (ignored)

### ✅ Correct
Set responseMode: "responseNode" to use a Respond to Webhook node (`lastNode` returns the last node's output instead)

### 3. ❌ Wrong: No validation
Assuming data is always present and valid

### ✅ Correct
Validate data early with an IF node (per-field messages: the Code validator in `n8n-error-handling`)

### 4. ❌ Wrong: Hardcoded paths
Using same path for dev/prod

### ✅ Correct
Use environment variables: `{{$env.WEBHOOK_PATH_PREFIX}}/form-submit`

---

## Real Template Examples

From n8n template library (1,085 webhook templates):

**Simple Form to Slack**:
```
Webhook → Set → Slack
```

**Payment Processing**:
```
Webhook → Verify Signature → Update Database → Send Receipt → Notify Admin
```

**Chat Bot**:
```
Webhook → Parse Command → AI Agent → Format Response → Webhook Response
```

Use `search_templates({query: "webhook"})` to find more!

---

## Checklist for Webhook Workflows

### Setup
- [ ] Choose descriptive webhook path
- [ ] Configure HTTP method (POST most common)
- [ ] Choose response mode (onReceived vs lastNode)
- [ ] Test webhook URL before connecting services

### Security
- [ ] Add authentication (token, signature, IP whitelist)
- [ ] Validate incoming data
- [ ] Sanitize user input (if storing/displaying)
- [ ] Use HTTPS (always)

### Data Handling
- [ ] Remember data is under $json.body
- [ ] Handle missing fields gracefully
- [ ] Transform data to desired format
- [ ] Log important data (for debugging)

### Error Handling
- [ ] Add Error Trigger workflow
- [ ] Validate required fields
- [ ] Return appropriate error responses
- [ ] Alert team on failures

### Testing
- [ ] Test with curl/Postman
- [ ] Test error scenarios
- [ ] Verify response format
- [ ] Monitor first executions

---

## Summary

**Key Points**:
1. **Data under $json.body** (most common mistake!)
2. **Validate early** to catch bad data
3. **Choose response mode** based on use case
4. **Secure webhooks** with auth
5. **Handle errors** gracefully

**Pattern**: Webhook → Validate → Transform → Action → Response

**Related**:
- [n8n Expression Syntax](../../n8n-expression-syntax/SKILL.md) - Accessing webhook data correctly
- [http_api_integration.md](http_api_integration.md) - Making HTTP requests in response
