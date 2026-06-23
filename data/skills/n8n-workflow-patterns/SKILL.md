---
name: n8n-workflow-patterns
description: Proven workflow architectural patterns from real n8n workflows. Use when building new workflows, designing workflow structure, choosing workflow patterns, planning workflow architecture, or asking about webhook processing, HTTP API integration, database operations, AI agent workflows, batch processing, or scheduled tasks. Always consult this skill when the user asks to create, build, or design an n8n workflow, automate a process, or connect services — even if they don't explicitly mention 'patterns'. Covers webhook, API, database, AI, batch processing, and scheduled automation architectures.
---

# n8n Workflow Patterns

Proven architectural patterns for building n8n workflows.

---

## The 6 Core Patterns

Based on analysis of real workflow usage:

1. **[Webhook Processing](webhook_processing.md)** (Most Common)
   - Receive HTTP requests → Process → Output
   - Pattern: Webhook → Validate → Transform → Respond/Notify

2. **[HTTP API Integration](http_api_integration.md)**
   - Fetch from REST APIs → Transform → Store/Use
   - Pattern: Trigger → HTTP Request → Transform → Action → Error Handler

3. **[Database Operations](database_operations.md)**
   - Read/Write/Sync database data
   - Pattern: Schedule → Query → Transform → Write → Verify

4. **[AI Agent Workflow](ai_agent_workflow.md)**
   - AI agents with tools and memory
   - Pattern: Trigger → AI Agent (Model + Tools + Memory) → Output

5. **[Scheduled Tasks](scheduled_tasks.md)**
   - Recurring automation workflows
   - Pattern: Schedule → Fetch → Process → Deliver → Log

6. **Batch Processing** (below)
   - Process large datasets in chunks with API rate limits
   - Pattern: Prepare → SplitInBatches → Process per batch → Accumulate → Aggregate

---

## Pattern Selection Guide

### When to use each pattern:

**Webhook Processing** - Use when:
- Receiving data from external systems
- Building integrations (Slack commands, form submissions, GitHub webhooks)
- Need instant response to events
- Example: "Receive Stripe payment webhook → Update database → Send confirmation"

**HTTP API Integration** - Use when:
- Fetching data from external APIs
- Synchronizing with third-party services
- Building data pipelines
- Example: "Fetch GitHub issues → Transform → Create Jira tickets"

**Database Operations** - Use when:
- Syncing between databases
- Running database queries on schedule
- ETL workflows
- Example: "Read Postgres records → Transform → Write to MySQL"

**AI Agent Workflow** - Use when:
- Building conversational AI
- Need AI with tool access
- Multi-step reasoning tasks
- Example: "Chat with AI that can search docs, query database, send emails"

**Scheduled Tasks** - Use when:
- Recurring reports or summaries
- Periodic data fetching
- Maintenance tasks
- Example: "Daily: Fetch analytics → Generate report → Email team"

**Batch Processing** - Use when:
- Processing large datasets that exceed API batch limits
- Need to accumulate results across multiple API calls
- Nested loops (e.g., multiple categories × paginated API calls per category)
- Example: "Fetch products for 4 markets × 1000 per API call → Aggregate all results"

---

## Common Workflow Components

All patterns share these building blocks:

### 1. Triggers
- **Webhook** - HTTP endpoint (instant)
- **Schedule** - Cron-based timing (periodic)
- **Manual** - Click to execute (testing)
- **Polling** - Check for changes (intervals)

### 2. Data Sources
- **HTTP Request** - REST APIs
- **Database nodes** - Postgres, MySQL, MongoDB
- **Service nodes** - Slack, Google Sheets, etc.
- **Code** - Custom JavaScript/Python

### 3. Transformation
- **Set** - Map/transform fields
- **Code** - Complex logic
- **IF/Switch** - Conditional routing
- **Merge** - Combine data streams

### 4. Outputs
- **HTTP Request** - Call APIs
- **Database** - Write data
- **Communication** - Email, Slack, Discord
- **Storage** - Files, cloud storage

### 5. Error Handling
- **Error Trigger** - Catch workflow errors
- **IF** - Check for error conditions
- **Stop and Error** - Explicit failure
- **Continue On Fail** - Per-node setting

---

## Workflow Creation Checklist

When building ANY workflow, follow this checklist:

### Planning Phase
- [ ] Identify the pattern (webhook, API, database, AI, scheduled)
- [ ] List required nodes (use search_nodes)
- [ ] Understand data flow (input → transform → output)
- [ ] Plan error handling strategy

### Implementation Phase
- [ ] Create workflow with appropriate trigger
- [ ] Add data source nodes
- [ ] Configure authentication/credentials
- [ ] Add transformation nodes (Set, Code, IF)
- [ ] Add output/action nodes
- [ ] Configure error handling

### Validation Phase
- [ ] Validate each node configuration (validate_node)
- [ ] Validate complete workflow (validate_workflow)
- [ ] Test with sample data
- [ ] Handle edge cases (empty data, errors)

### Deployment Phase
- [ ] Review workflow settings (execution order, timeout, error handling)
- [ ] Activate workflow using `activateWorkflow` operation
- [ ] Monitor first executions
- [ ] Document workflow purpose and data flow

---

## Data Flow Patterns

### Linear Flow
```
Trigger → Transform → Action → End
```
**Use when**: Simple workflows with single path

### Branching Flow
```
Trigger → IF → [True Path]
             └→ [False Path]
```
**Use when**: Different actions based on conditions

### Parallel Processing
```
Trigger → [Branch 1] → Merge
       └→ [Branch 2] ↗
```
**Use when**: Independent operations that can run simultaneously

### Loop Pattern
```
Trigger → Split in Batches → Process → Loop (until done)
```
**Use when**: Processing large datasets in chunks

### Error Handler Pattern
```
Main Flow → [Success Path]
         └→ [Error Trigger → Error Handler]
```
**Use when**: Need separate error handling workflow

---

## Batch Processing Pattern

### SplitInBatches Loop

The SplitInBatches node splits a large dataset into smaller chunks for processing. Understanding its outputs is critical:

- `main[0]` = **done** — fires ONCE after all batches complete
- `main[1]` = **each batch** — fires per batch (this is the loop body)

```
Prepare Items → SplitInBatches → [main[1]: Process Batch] → (loops back)
                                  [main[0]: Done] → Limit 1 → Aggregate
```

Always add a **Limit 1** node after the done output.

### Cross-Iteration Data

After the loop, `$('Node Inside Loop').all()` returns **ONLY the last batch's items**. To accumulate across all iterations, use `$getWorkflowStaticData('global')` in a Code node inside the loop. See the n8n Code JavaScript skill for the full pattern.

### Nested Loops

When processing N categories × M items per category (where an API has a batch limit):

```
Define Categories (N items)
  → Outer Loop (SplitInBatches, batchSize=1)
    → Prepare category data
    → Inner Loop (SplitInBatches, batchSize=1000)
      → API Call → Verify → (loops back to Inner Loop via main[1])
    → Inner done[0] → Rate Limit Delay → back to Outer Loop
  → Outer done[0] → Limit 1 → Final Aggregate
```

**Wiring gotcha**: The inner done[0] must connect back to the OUTER loop input, not to the aggregate. The outer done[0] feeds the final aggregate.

### API Pagination

For APIs without multi-ID filtering, use `id_from` + date windowing for efficient pagination:

```
Schedule → Set Date Window → Fetch Page → Process
  → IF has more? → [true] Update id_from → Fetch Page (loop)
                  → [false] → Aggregate → Output
```

### Dry-Run / Verification Tolerance

When testing with API write nodes disabled (for dry runs), downstream verification nodes receive the request body instead of the response. Make verification tolerant:

```javascript
// In verification Code node
const body = $input.first().json;
const looksLikeRequest = body.method && body.parameters && !body.status;
if (looksLikeRequest) {
  return [{ json: { status: 'SKIPPED', message: 'Upstream disabled for testing' }}];
}
// Normal response verification below...
```

---

## Integration-Specific Gotchas

### Google Sheets

- **NEVER use `append`** on sheets with formula columns — it breaks formulas. Use Google Sheets API `values.update` (PUT) via HTTP Request node with a `googleApi` credential
- **Write numbers, not strings** for formula-dependent columns — string "4.98" breaks `ADD()` formulas. Use `parseFloat()` in a Code node
- **Per-item execution trap**: Google Sheets nodes execute once per input item. If you need a single bulk write, aggregate items into one in a Code node first
- **UNFORMATTED_VALUE returns numbers**, not text like "N/A" — filter explicitly in Code nodes

### Google Drive

- **`convertToGoogleDocument: true` creates a Google Doc (text)**, NOT a Google Sheet — to upload a CSV for download, omit this option entirely
- **CSV download link format**: `https://drive.google.com/uc?id={fileId}&export=download` — use instead of `/view` links

### Bidirectional Threshold Checking

When comparing values (prices, quantities, metrics), always check both directions:

```javascript
// ❌ Only catches increases
if (diff > threshold) { flag(); }

// ✅ Catches both spikes AND crashes — both are data-quality signals
if (Math.abs(diff) > threshold) { flag(); }
```

---

## Common Gotchas

### 1. Webhook Data Structure
**Problem**: Can't access webhook payload data

**Solution**: Data is nested under `$json.body`
```javascript
❌ {{$json.email}}
✅ {{$json.body.email}}
```
See: n8n Expression Syntax skill

### 2. Multiple Input Items
**Problem**: Node processes all input items, but I only want one

**Solution**: Use "Execute Once" mode or process first item only
```javascript
{{$json[0].field}}  // First item only
```

### 3. Authentication Issues
**Problem**: API calls failing with 401/403

**Solution**:
- Configure credentials properly
- Use the "Credentials" section, not parameters
- Test credentials before workflow activation

### 4. Node Execution Order
**Problem**: Nodes executing in unexpected order

**Solution**: Check workflow settings → Execution Order
- v0: Top-to-bottom (legacy)
- v1: Connection-based (recommended)

### 5. Expression Errors
**Problem**: Expressions showing as literal text

**Solution**: Use {{}} around expressions
- See n8n Expression Syntax skill for details

---

## Integration with Other Skills

These skills work together with Workflow Patterns:

**n8n MCP Tools Expert** - Use to:
- Find nodes for your pattern (search_nodes)
- Understand node operations (get_node)
- Create workflows (n8n_create_workflow)
- Deploy templates (n8n_deploy_template)
- Use `ai_agents_guide()` for AI pattern guidance
- Manage data tables with `n8n_manage_datatable`

**n8n Expression Syntax** - Use to:
- Write expressions in transformation nodes
- Access webhook data correctly ({{$json.body.field}})
- Reference previous nodes ({{$node["Node Name"].json.field}})

**n8n Node Configuration** - Use to:
- Configure specific operations for pattern nodes
- Understand node-specific requirements

**n8n Validation Expert** - Use to:
- Validate workflow structure
- Fix validation errors
- Ensure workflow correctness before deployment

---

## Pattern Statistics

Common workflow patterns:

**Most Common Triggers**:
1. Webhook - 35%
2. Schedule (periodic tasks) - 28%
3. Manual (testing/admin) - 22%
4. Service triggers (Slack, email, etc.) - 15%

**Most Common Transformations**:
1. Set (field mapping) - 68%
2. Code (custom logic) - 42%
3. IF (conditional routing) - 38%
4. Switch (multi-condition) - 18%

**Most Common Outputs**:
1. HTTP Request (APIs) - 45%
2. Slack - 32%
3. Database writes - 28%
4. Email - 24%

**Average Workflow Complexity**:
- Simple (3-5 nodes): 42%
- Medium (6-10 nodes): 38%
- Complex (11+ nodes): 20%

---

## Quick Start Examples

### Example 1: Simple Webhook → Slack
```
1. Webhook (path: "form-submit", POST)
2. Set (map form fields)
3. Slack (post message to #notifications)
```

### Example 2: Scheduled Report
```
1. Schedule (daily at 9 AM)
2. HTTP Request (fetch analytics)
3. Code (aggregate data)
4. Email (send formatted report)
5. Error Trigger → Slack (notify on failure)
```

### Example 3: Database Sync
```
1. Schedule (every 15 minutes)
2. Postgres (query new records)
3. IF (check if records exist)
4. MySQL (insert records)
5. Postgres (update sync timestamp)
```

### Example 4: AI Assistant
```
1. Webhook (receive chat message)
2. AI Agent
   ├─ OpenAI Chat Model (ai_languageModel)
   ├─ HTTP Request Tool (ai_tool)
   ├─ Database Tool (ai_tool)
   └─ Window Buffer Memory (ai_memory)
3. Webhook Response (send AI reply)
```

### Example 5: API Integration
```
1. Manual Trigger (for testing)
2. HTTP Request (GET /api/users)
3. Split In Batches (process 100 at a time)
4. Set (transform user data)
5. Postgres (upsert users)
6. Loop (back to step 3 until done)
```

---

## Detailed Pattern Files

For comprehensive guidance on each pattern:

- **[webhook_processing.md](webhook_processing.md)** - Webhook patterns, data structure, response handling
- **[http_api_integration.md](http_api_integration.md)** - REST APIs, authentication, pagination, retries
- **[database_operations.md](database_operations.md)** - Queries, sync, transactions, batch processing
- **[ai_agent_workflow.md](ai_agent_workflow.md)** - AI agents, tools, memory, langchain nodes
- **[scheduled_tasks.md](scheduled_tasks.md)** - Cron schedules, reports, maintenance tasks

---

## Real Template Examples

From n8n template library:

**Template #2947**: Weather to Slack
- Pattern: Scheduled Task
- Nodes: Schedule → HTTP Request (weather API) → Set → Slack
- Complexity: Simple (4 nodes)

**Webhook Processing**: Most common pattern
- Most common: Form submissions, payment webhooks, chat integrations

**HTTP API**: Common pattern
- Most common: Data fetching, third-party integrations

**Database Operations**: Common pattern
- Most common: ETL, data sync, backup workflows

**AI Agents**: Growing in usage
- Most common: Chatbots, content generation, data analysis

Use `search_templates` and `get_template` from n8n-mcp tools to find examples!

---

## Best Practices

### ✅ Do

- Start with the simplest pattern that solves your problem
- Plan your workflow structure before building
- Use error handling on all workflows
- Test with sample data before activation
- Follow the workflow creation checklist
- Use descriptive node names
- Document complex workflows (notes field)
- Monitor workflow executions after deployment

### ❌ Don't

- Build workflows in one shot (iterate! avg 56s between edits)
- Skip validation before activation
- Ignore error scenarios
- Use complex patterns when simple ones suffice
- Hardcode credentials in parameters
- Forget to handle empty data cases
- Mix multiple patterns without clear boundaries
- Deploy without testing

---

## Summary

**Key Points**:
1. **6 core patterns** cover 90%+ of workflow use cases
2. **Webhook processing** is the most common pattern
3. Use the **workflow creation checklist** for every workflow
4. **Plan pattern** → **Select nodes** → **Build** → **Validate** → **Deploy**
5. Integrate with other skills for complete workflow development

**Next Steps**:
1. Identify your use case pattern
2. Read the detailed pattern file
3. Use n8n MCP Tools Expert to find nodes
4. Follow the workflow creation checklist
5. Use n8n Validation Expert to validate

**Related Skills**:
- n8n MCP Tools Expert - Find and configure nodes
- n8n Expression Syntax - Write expressions correctly
- n8n Validation Expert - Validate and fix errors
- n8n Node Configuration - Configure specific operations
