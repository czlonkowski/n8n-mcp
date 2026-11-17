# HTTP API Integration Pattern

**Use Case**: Fetch data from REST APIs, transform it, and use it in workflows.

---

## Pattern Structure

```
Trigger → HTTP Request → [Transform] → [Action] → [Error Handler]
```

**Key Characteristic**: External data fetching with error handling

---

## Core Components

### 1. Trigger
**Options**:
- **Schedule** - Periodic fetching (most common)
- **Webhook** - Triggered by external event
- **Manual** - On-demand execution

### 2. HTTP Request Node
**Purpose**: Call external REST APIs

**Configuration**:
```javascript
{
  method: "GET",                    // GET, POST, PUT, DELETE, PATCH
  url: "https://api.example.com/users",
  authentication: "predefinedCredentialType",
  sendQuery: true,
  queryParameters: {
    "page": "={{$json.page}}",
    "limit": "100"
  },
  sendHeaders: true,
  headerParameters: {
    "Accept": "application/json",
    "X-API-Version": "v1"
  }
}
```

### 3. Response Processing
**Purpose**: Extract and transform API response data

**Typical flow**:
```
Service node or HTTP Request → Split Out (when the body wraps an array) → Filter → Action
```

Map fields in the action node's own slots; add an Edit Fields node only when several nodes read the same mapped values.

### 4. Action
**Common actions**:
- Store in database
- Send to another API
- Create notifications
- Update spreadsheet

### 5. Error Handler
**Purpose**: Handle API failures gracefully

**Error Trigger Workflow**:
```
Error Trigger → Log Error → Notify Admin → Retry Logic (optional)
```

---

## Common Use Cases

### 1. Data Fetching & Storage
**Flow**: Schedule → HTTP Request → Transform → Database

**Example** (Fetch GitHub issues):
```
1. Schedule (every hour)
2. GitHub (Repository → Get Issues, Return All; filters: state = open, labels = bug)
3. Postgres (upsert issues; map id, title, created_at in the node's column slots)
```

The service node pages, authenticates and filters by label itself. With HTTP Request instead (only when the GitHub
node lacks the operation — note it as `Why HTTP:`), use the pagination option and a Filter node with the condition
`{{ $json.labels.pluck('name').includes('bug') }}` is true.

### 2. API to API Integration
**Flow**: Trigger → Fetch from API A → Transform → Send to API B

**Example** (Jira to Slack):
```
1. Schedule (every 15 minutes)
2. Jira (Issue → Get Many, Return All; options.jql = `updated >= startOfDay()`)
3. Slack (post the message; the text maps the issue fields with expressions)
```

No IF is needed for "tickets exist": when Jira returns no items, the Slack node doesn't run.

### 3. Data Enrichment
**Flow**: Trigger → Fetch base data → Call enrichment API → Combine → Store

**Example** (Enrich contacts with company data):
```
1. Postgres "Get new contacts" (SELECT new contacts)
2. Clearbit (Company → Enrich; domain = `{{ $json.email.extractDomain() }}`)
3. Postgres (UPDATE contacts; contact fields from `$('Get new contacts').item.json`, company fields from `$json`)
```

The domain is one helper expression, and each enrichment pairs back to its contact through `$('Node').item`, so
neither a Code nor a Set node is needed.

### 4. Monitoring & Alerting
**Flow**: Schedule → Check API health → IF unhealthy → Alert

**Example** (API health check):
```
1. Schedule (every 5 minutes)
2. HTTP Request (GET /health endpoint)
3. IF (status !== 200 OR response time > 2000ms)
4. Slack (alert #ops-team)
5. PagerDuty (create incident)
```

### 5. Batch Processing
**Flow**: Trigger → Fetch large dataset → Split in Batches → Process → Loop

**Example** (Process all users):
```
1. Manual Trigger
2. HTTP Request (GET /api/users?limit=1000)
3. Split In Batches (100 items per batch)
4. HTTP Request (POST /api/process for each batch)
5. Wait (2 seconds between batches - rate limiting)
6. Loop (back to step 4 until all processed)
```

---

## Authentication Methods

### 1. None (Public APIs)
```javascript
{
  authentication: "none"
}
```

### 2. Bearer Token (Most Common)
**Setup**: Create credential
```javascript
{
  authentication: "predefinedCredentialType",
  nodeCredentialType: "httpHeaderAuth",
  headerAuth: {
    name: "Authorization",
    value: "Bearer YOUR_TOKEN"
  }
}
```

**Access in workflow**:
```javascript
{
  authentication: "predefinedCredentialType",
  nodeCredentialType: "httpHeaderAuth"
}
```

### 3. API Key (Header or Query)
**Header auth**:
```javascript
{
  sendHeaders: true,
  headerParameters: {
    "X-API-Key": "={{$credentials.apiKey}}"
  }
}
```

**Query auth**:
```javascript
{
  sendQuery: true,
  queryParameters: {
    "api_key": "={{$credentials.apiKey}}"
  }
}
```

### 4. Basic Auth
**Setup**: Create "Basic Auth" credential
```javascript
{
  authentication: "predefinedCredentialType",
  nodeCredentialType: "httpBasicAuth"
}
```

### 5. OAuth2
**Setup**: Create OAuth2 credential with:
- Authorization URL
- Token URL
- Client ID
- Client Secret
- Scopes

```javascript
{
  authentication: "predefinedCredentialType",
  nodeCredentialType: "oAuth2Api"
}
```

---

## Handling API Responses

### Success Response (200-299)
**Default**: Data flows to next node

**Access response**:
```javascript
// Entire response
{{$json}}

// Specific fields
{{$json.data.id}}
{{$json.results[0].name}}
```

### Pagination

Use HTTP Request's built-in pagination option — not a Set → HTTP → Code → IF loop. It fetches every page in one node
and returns the combined items. (A service node's "Return All" usually pages for you; prefer the service node.)

| API style | `paginationMode` | Next page | Stop when (`completeExpression`) |
|---|---|---|---|
| Page number / offset | `updateAParameterInEachRequest` | `qs` param `page` = `{{ $pageCount + 1 }}` (offset: `{{ $pageCount * 100 }}`) | `{{ !$response.body.has_more }}`, or `responseIsEmpty` |
| Cursor in the body | `updateAParameterInEachRequest` | `qs` param `cursor` = `{{ $response.body.next_cursor }}` | `{{ !$response.body.next_cursor }}` |
| Next URL in the body | `responseContainsNextURL` | `nextURL` = `{{ $response.body.next }}` | `{{ !$response.body.next }}` |
| Link header | `responseContainsNextURL` | `nextURL` = `{{ $response.headers.link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] }}` | `{{ !$response.headers.link?.includes('rel="next"') }}` |

- **Always set `limitPagesFetched: true` and `maxRequests`.** Without a cap, a stop condition that never fires pages
  forever.
- A page whose body is an object (`{ "data": [...], "has_more": true }`) arrives as one item per page: add a Split Out on
  `data`. An array body is split into items automatically.
- Full JSON for each mode, the variables (`$pageCount`, `$response`, `$request`) and the traps are in
  `n8n-node-configuration` → NATIVE_NODES.md → "HTTP Request pagination".

### Error Responses (400-599)

**Configure HTTP Request**:
```javascript
{
  continueOnFail: true,  // Don't stop workflow on error
  ignoreResponseCode: true  // Get response even on error
}
```

**Handle errors**:
```
HTTP Request (continueOnFail: true)
  → IF (check error)
    ├─ [Success Path]
    └─ [Error Path] → Log → Retry or Alert
```

**IF condition**:
```javascript
{{$json.error}} is empty
// OR
{{$json.statusCode}} < 400
```

---

## Rate Limiting

### Pattern 1: Wait Between Requests

HTTP Request's batching option throttles without a loop: `options.batching.batch` with `batchSize: 1` and
`batchInterval: 1000` (ms between batches). Use a loop only when several nodes per item must be throttled together:

```
Loop Over Items (batch size = your limit)
  → HTTP Request
  → Wait (1 second)
  → back to Loop Over Items
```

### Pattern 2: Retries and Backoff

Start with the node settings: `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 2000` retries with a fixed delay
(see `n8n-error-handling`). When the API needs a growing delay, route the error output (`onError:
"continueErrorOutput"`) to a Wait node whose amount is `{{ 2 ** $runIndex }}` seconds and back into the request, with
an IF that stops after N runs (`{{ $runIndex < 4 }}`).

### Pattern 3: Respect Rate Limit Headers

Turn on the HTTP Request's "Include Response Headers and Status" response option, then:

```
HTTP Request (full response)
  → IF  {{ Number($json.headers['x-ratelimit-remaining'] ?? 999) < 10 }}
      ├─ true  → Wait (until {{ DateTime.fromSeconds(Number($json.headers['x-ratelimit-reset'])).toISO() }}) → next request
      └─ false → next request
```

---

## Request Configuration

### GET Request
```javascript
{
  method: "GET",
  url: "https://api.example.com/users",
  sendQuery: true,
  queryParameters: {
    "page": "1",
    "limit": "100",
    "filter": "active"
  }
}
```

### POST Request (JSON Body)
```javascript
{
  method: "POST",
  url: "https://api.example.com/users",
  sendBody: true,
  bodyParametersJson: JSON.stringify({
    name: "={{$json.name}}",
    email: "={{$json.email}}",
    role: "user"
  })
}
```

### POST Request (Form Data)
```javascript
{
  method: "POST",
  url: "https://api.example.com/upload",
  sendBody: true,
  bodyParametersUi: {
    parameter: [
      { name: "file", value: "={{$json.fileData}}" },
      { name: "filename", value: "={{$json.filename}}" }
    ]
  },
  sendHeaders: true,
  headerParameters: {
    "Content-Type": "multipart/form-data"
  }
}
```

### PUT/PATCH Request (Update)
```javascript
{
  method: "PATCH",
  url: "https://api.example.com/users/={{$json.userId}}",
  sendBody: true,
  bodyParametersJson: JSON.stringify({
    status: "active",
    last_updated: "={{$now}}"
  })
}
```

### DELETE Request
```javascript
{
  method: "DELETE",
  url: "https://api.example.com/users/={{$json.userId}}"
}
```

---

## Error Handling Patterns

### Pattern 1: Retry on Failure
```
HTTP Request (continueOnFail: true)
  → IF (error occurred)
    └→ Wait (5 seconds)
    └→ HTTP Request (retry)
```

### Pattern 2: Fallback API
```
HTTP Request (Primary API, continueOnFail: true)
  → IF (failed)
    └→ HTTP Request (Fallback API)
```

### Pattern 3: Error Trigger Workflow
**Main Workflow**:
```
HTTP Request → Process Data
```

**Error Workflow**:
```
Error Trigger
  ├─→ Slack (alert team; the message reads the trigger payload with expressions)
  └─→ Database (log error for analysis; same fields)
```

### Pattern 4: Circuit Breaker

A failure count that survives between executions is state across runs, one of the closed-list Code cases. Keep the
counter in `$getWorkflowStaticData('global')` and note the node `Why Code: state across runs (failure counter)`.

```javascript
// Code node - circuit breaker logic
const failures = $json.recentFailures || 0;
const threshold = 5;

if (failures >= threshold) {
  throw new Error('Circuit breaker open - too many failures');
}

return [{ json: { canProceed: true } }];
```

---

## Response Transformation

### Extract Nested Data

Split Out on the array (`fieldToSplitOut: "data.items"`), then read the nested fields where they're used
(`{{ $json.attributes.contact.email }}`), or in one Edit Fields node when several nodes read them. For one value in one
field, `$jmespath()` does it inline (see `n8n-expression-syntax`).

### Flatten Arrays

Split Out keeps parent fields when you ask it to: `fieldToSplitOut: "results"`, `include: "selectedOtherFields"`,
`fieldsToInclude: "id"` gives one item per result with the parent's `id` alongside. Arrays nested more than one level
deep take one Split Out per level; arbitrary depth (a tree) is a recursion case for Code.

### Combine Multiple API Responses
```
HTTP Request 1 (users)
  ├─→ HTTP Request 2 (orders for each user)
  └─→ Merge input 1
HTTP Request 2 → Merge input 2 (Combine by Fields: users.id = orders.user_id, joinMode enrichInput1)
```

---

## Testing & Debugging

### 1. Test with Manual Trigger
Replace Schedule with Manual Trigger for testing

### 2. Use Postman/Insomnia First
- Test API outside n8n
- Understand response structure
- Verify authentication

### 3. Log Responses
```javascript
// Code node - log for debugging
console.log('API Response:', JSON.stringify($input.first().json, null, 2));
return $input.all();
```

### 4. Check Execution Data
- View node output in n8n UI
- Check headers, body, status code
- Verify data structure

### 5. Use Binary Data Properly
For file downloads:
```javascript
{
  method: "GET",
  url: "https://api.example.com/download/file.pdf",
  responseFormat: "file",  // Important for binary data
  outputPropertyName: "data"
}
```

---

## Performance Optimization

### 1. Parallel Requests
Each input item becomes one request, and HTTP Request sends a batch of them together. Cap the concurrency with the
batching option (`options.batching.batch.batchSize`, plus `batchInterval` in ms between batches) — no Split In Batches
loop needed. With one item holding an array of IDs, put a Split Out on the array first.

### 2. Caching
```
IF (check cache exists)
  ├─ [Cache Hit] → Use cached data
  └─ [Cache Miss] → HTTP Request → Store in cache
```

### 3. Conditional Fetching
Only fetch if data changed:
```
HTTP Request (GET with If-Modified-Since header)
  → IF (status === 304)
    └─ Use existing data
  → IF (status === 200)
    └─ Process new data
```

### 4. Batch API Calls
If API supports batch operations:
```javascript
{
  method: "POST",
  url: "https://api.example.com/batch",
  bodyParametersJson: JSON.stringify({
    requests: $json.items.map(item => ({
      method: "GET",
      url: `/users/${item.id}`
    }))
  })
}
```

---

## Common Gotchas

### 1. ❌ Wrong: Hardcoded URLs
```javascript
url: "https://api.example.com/prod/users"
```

### ✅ Correct: Use environment variables
```javascript
url: "={{$env.API_BASE_URL}}/users"
```

### 2. ❌ Wrong: Credentials in parameters
```javascript
headerParameters: {
  "Authorization": "Bearer sk-abc123xyz"  // ❌ Exposed!
}
```

### ✅ Correct: Use credentials system
```javascript
authentication: "predefinedCredentialType",
nodeCredentialType: "httpHeaderAuth"
```

### 3. ❌ Wrong: No error handling
```javascript
HTTP Request → Process (fails if API down)
```

### ✅ Correct: Handle errors
```javascript
HTTP Request (continueOnFail: true) → IF (error) → Handle
```

### 4. ❌ Wrong: Blocking on large responses
Processing 10,000 items synchronously

### ✅ Correct: Use batching
```
Split In Batches (100 items) → Process → Loop
```

---

## Real Template Examples

From n8n template library (892 API integration templates):

**GitHub to Notion**:
```
Schedule → HTTP Request (GitHub API) → Transform → HTTP Request (Notion API)
```

**Weather to Slack**:
```
Schedule → HTTP Request (Weather API) → Set (format) → Slack
```

**CRM Sync**:
```
Schedule → HTTP Request (CRM A) → Transform → HTTP Request (CRM B)
```

Use `search_templates({query: "http api"})` to find more!

---

## Checklist for API Integration

### Planning
- [ ] Test API with Postman/curl first
- [ ] Understand response structure
- [ ] Check rate limits
- [ ] Review authentication method
- [ ] Plan error handling

### Implementation
- [ ] Use credentials (never hardcode)
- [ ] Configure proper HTTP method
- [ ] Set correct headers (Content-Type, Accept)
- [ ] Handle pagination if needed
- [ ] Add query parameters properly

### Error Handling
- [ ] Set continueOnFail: true if needed
- [ ] Check response status codes
- [ ] Implement retry logic
- [ ] Add Error Trigger workflow
- [ ] Alert on failures

### Performance
- [ ] Use batching for large datasets
- [ ] Add rate limiting if needed
- [ ] Consider caching
- [ ] Test with production load

### Security
- [ ] Use HTTPS only
- [ ] Store secrets in credentials
- [ ] Validate API responses
- [ ] Use environment variables

---

## Summary

**Key Points**:
1. **Authentication** via credentials system (never hardcode)
2. **Error handling** is critical (continueOnFail + IF checks)
3. **Pagination** for large datasets
4. **Rate limiting** to respect API limits
5. **Transform responses** to match your needs

**Pattern**: Trigger → HTTP Request → Transform → Action → Error Handler

**Related**:
- [webhook_processing.md](webhook_processing.md) - Receiving HTTP requests
- [database_operations.md](database_operations.md) - Storing API data
