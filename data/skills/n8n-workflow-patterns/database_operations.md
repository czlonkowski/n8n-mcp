# Database Operations Pattern

**Use Case**: Read, write, sync, and manage database data in workflows.

---

## Pattern Structure

```
Trigger → [Query/Read] → [Transform] → [Write/Update] → [Verify/Log]
```

**Key Characteristic**: Data persistence and synchronization

---

## Core Components

### 1. Trigger
**Options**:
- **Schedule** - Periodic sync/maintenance (most common)
- **Webhook** - Event-driven writes
- **Manual** - One-time operations

### 2. Database Read Nodes
**Supported databases**:
- Postgres
- MySQL
- MongoDB
- Microsoft SQL
- SQLite
- Redis
- And more via community nodes

### 3. Transform
**Purpose**: Map between different database schemas or formats

**Typical nodes**:
- **None** - Map fields in the write node's own column slots
- **Edit Fields (Set)** - A named step when several nodes read the mapped values
- **Merge / Compare Datasets** - Combine sources, diff them for a sync
- **Summarize / Remove Duplicates** - Totals, dedupe
- **Code** - Only the closed list (see `n8n-code-javascript`)

### 4. Database Write Nodes
**Operations**:
- INSERT - Create new records
- UPDATE - Modify existing records
- UPSERT - Insert or update
- DELETE - Remove records

### 5. Verification
**Purpose**: Confirm operations succeeded

**Methods**:
- Query to verify records
- Count rows affected
- Log results

---

## Common Use Cases

### 1. Data Synchronization
**Flow**: Schedule → Read Source DB → Transform → Write Target DB → Log

**Example** (Postgres to MySQL sync):
```
1. Schedule (every 15 minutes)
2. Postgres "Get changed users" (SELECT * FROM users WHERE updated_at > $1; queryReplacement = {{ $json.last_sync }})
3. MySQL (INSERT or UPDATE users; map columns in the node's column slots)
4. Postgres (UPDATE sync_log SET last_sync = NOW(); executeOnce: true)
5. Slack (notify: "Synced {{ $('Get changed users').all().length }} users"; executeOnce: true)
```

No IF for "records exist": with no items, the downstream nodes don't run.


**Incremental sync query**:
```sql
SELECT *
FROM users
WHERE updated_at > $1
ORDER BY updated_at ASC
LIMIT 1000
```

**Parameters**:
```javascript
{
  "parameters": [
    "={{$node['Get Last Sync'].json.last_sync}}"
  ]
}
```

### 2. ETL (Extract, Transform, Load)
**Flow**: Extract from multiple sources → Transform → Load into warehouse

**Example** (Consolidate data):
```
1. Schedule (daily at 2 AM)
2. [Parallel branches]
   ├─ Postgres (SELECT orders)
   ├─ MySQL (SELECT customers)
   └─ MongoDB (SELECT products)
3. Merge (combine by fields: orders.customer_id = customers.id, then a second Merge for products; or one SQL-mode Merge with numberInputs 3)
4. Postgres (warehouse - INSERT into fact_sales; columns mapped in the node)
6. Email (send summary report)
```

### 3. Data Validation & Cleanup
**Flow**: Schedule → Query → Validate → Update/Delete invalid records

**Example** (Clean orphaned records):
```
1. Schedule (weekly)
2. Postgres (SELECT users WHERE email IS NULL OR email = '')
3. IF (invalid records exist)
4. Postgres (UPDATE users SET status='inactive' WHERE email IS NULL)
5. Postgres (DELETE FROM users WHERE created_at < NOW() - INTERVAL '1 year' AND status='inactive')
6. Slack (alert: "Cleaned X invalid records")
```

### 4. Backup & Archive
**Flow**: Schedule → Query → Export → Store

**Example** (Archive old records):
```
1. Schedule (monthly)
2. Postgres (SELECT * FROM orders WHERE created_at < NOW() - INTERVAL '2 years')
3. Convert To File (operation toJson)
4. Read/Write Files from Disk (save to archive.json)
5. Google Drive (upload archive)
6. Postgres (DELETE FROM orders WHERE created_at < NOW() - INTERVAL '2 years')
```

### 5. Real-time Data Updates
**Flow**: Webhook → Parse → Update Database

**Example** (Update user status):
```
1. Webhook (receive status update)
2. Postgres (UPDATE users SET status = {{$json.body.status}} WHERE id = {{$json.body.user_id}})
3. IF (rows affected > 0)
4. Redis (SET user:{{$json.body.user_id}}:status {{$json.body.status}})
5. Webhook Response ({"success": true})
```

---

## Database Node Configuration

### Postgres

#### SELECT Query
```javascript
{
  operation: "executeQuery",
  query: "SELECT id, name, email FROM users WHERE created_at > $1 LIMIT $2",
  parameters: [
    "={{$json.since_date}}",
    "100"
  ]
}
```

#### INSERT
```javascript
{
  operation: "insert",
  table: "users",
  columns: "id, name, email, created_at",
  values: [
    {
      id: "={{$json.id}}",
      name: "={{$json.name}}",
      email: "={{$json.email}}",
      created_at: "={{$now}}"
    }
  ]
}
```

#### UPDATE
```javascript
{
  operation: "update",
  table: "users",
  updateKey: "id",
  columns: "name, email, updated_at",
  values: {
    id: "={{$json.id}}",
    name: "={{$json.name}}",
    email: "={{$json.email}}",
    updated_at: "={{$now}}"
  }
}
```

#### UPSERT (INSERT ... ON CONFLICT)
```javascript
{
  operation: "executeQuery",
  query: `
    INSERT INTO users (id, name, email)
    VALUES ($1, $2, $3)
    ON CONFLICT (id)
    DO UPDATE SET name = $2, email = $3, updated_at = NOW()
  `,
  parameters: [
    "={{$json.id}}",
    "={{$json.name}}",
    "={{$json.email}}"
  ]
}
```

### MySQL

#### SELECT with JOIN
```javascript
{
  operation: "executeQuery",
  query: `
    SELECT u.id, u.name, o.order_id, o.total
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.created_at > ?
  `,
  parameters: [
    "={{$json.since_date}}"
  ]
}
```

#### Bulk INSERT
```javascript
{
  operation: "insert",
  table: "orders",
  columns: "user_id, total, status",
  values: $json.orders  // Array of objects
}
```

### MongoDB

#### Find Documents
```javascript
{
  operation: "find",
  collection: "users",
  query: JSON.stringify({
    created_at: { $gt: new Date($json.since_date) },
    status: "active"
  }),
  limit: 100
}
```

#### Insert Document
```javascript
{
  operation: "insert",
  collection: "users",
  document: JSON.stringify({
    name: $json.name,
    email: $json.email,
    created_at: new Date()
  })
}
```

#### Update Document
```javascript
{
  operation: "update",
  collection: "users",
  query: JSON.stringify({ _id: $json.user_id }),
  update: JSON.stringify({
    $set: {
      status: $json.status,
      updated_at: new Date()
    }
  })
}
```

---

## Batch Processing

### Pattern 1: Split In Batches
**Use when**: Processing large datasets to avoid memory issues

```
Postgres (SELECT 10000 records)
  → Split In Batches (100 items per batch)
  → Transform
  → MySQL (write batch)
  → Loop (until all processed)
```

### Pattern 2: Paginated Queries
**Use when**: Database has millions of records

```
Set (initialize: offset=0, limit=1000)
  → Loop Start
  → Postgres (SELECT * FROM large_table LIMIT {{$json.limit}} OFFSET {{$json.offset}})
  → IF (records returned)
    ├─ Process records
    ├─ Set (increment offset by 1000)
    └─ Loop back
  └─ [No records] → End
```

**Query**:
```sql
SELECT * FROM large_table
ORDER BY id
LIMIT $1 OFFSET $2
```

### Pattern 3: Cursor-Based Pagination
**Better performance for large datasets**:

```
Set (initialize: last_id=0)
  → Loop Start
  → Postgres (SELECT * FROM table WHERE id > {{$json.last_id}} ORDER BY id LIMIT 1000)
  → IF (records returned)
    ├─ Process records
    ├─ Summarize (max of id) → the next query's last_id
    └─ Loop back
  └─ [No records] → End
```

**Query**:
```sql
SELECT * FROM table
WHERE id > $1
ORDER BY id ASC
LIMIT 1000
```

---

## Transaction Handling

### Pattern 1: BEGIN/COMMIT/ROLLBACK
**For databases that support transactions**:

```javascript
// Node 1: Begin Transaction
{
  operation: "executeQuery",
  query: "BEGIN"
}

// Node 2-N: Your operations
{
  operation: "executeQuery",
  query: "INSERT INTO ...",
  continueOnFail: true
}

// Node N+1: Commit or Rollback
{
  operation: "executeQuery",
  query: "={{$node['Operation'].json.error ? 'ROLLBACK' : 'COMMIT'}}"
}
```

### Pattern 2: Atomic Operations
**Use database features for atomicity**:

```sql
-- Upsert example (atomic)
INSERT INTO inventory (product_id, quantity)
VALUES ($1, $2)
ON CONFLICT (product_id)
DO UPDATE SET quantity = inventory.quantity + $2
```

### Pattern 3: Error Rollback
**Manual rollback on error**:

```
Try Operations:
  Postgres (INSERT orders)
  MySQL (INSERT order_items)

Error Trigger:
  Postgres (DELETE FROM orders WHERE id = {{$json.order_id}})
  MySQL (DELETE FROM order_items WHERE order_id = {{$json.order_id}})
```

---

## Data Transformation

### Schema Mapping, type conversion, aggregation

These are native jobs:

| Job | Native way |
|---|---|
| Rename / map fields | the write node's column slots, each a short expression (`{{ $json.first_name + ' ' + $json.last_name }}`) |
| Type conversion | in the same expression: `{{ $json.user_id.toNumber() }}`, `{{ $json.created_at.toDateTime().toISO() }}`, `{{ $json.metadata.parseJson() }}`, `{{ $json.active === 1 }}` |
| Defaults | `{{ $ifEmpty($json.status, 'active') }}` |
| Totals per day / group | Summarize: split by the date field, `count` and `sum` of `amount` — or `GROUP BY` in the query itself |
| Group by a derived key (the date part of a timestamp) | Edit Fields adds `day = {{ $json.created_at.toDateTime().format('yyyy-MM-dd') }}`, then Summarize splits by `day` |

A Code node is right here only when a mapping needs loops (one source row becomes a variable number of target rows in
ways Split Out can't express) — with a `Why Code:` note.

---

## Performance Optimization

### 1. Use Indexes
Ensure database has proper indexes:

```sql
-- Add index for sync queries
CREATE INDEX idx_users_updated_at ON users(updated_at);

-- Add index for lookups
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

### 2. Limit Result Sets
Always use LIMIT:

```sql
-- ✅ Good
SELECT * FROM large_table
WHERE created_at > $1
LIMIT 1000

-- ❌ Bad (unbounded)
SELECT * FROM large_table
WHERE created_at > $1
```

### 3. Use Prepared Statements
Parameterized queries are faster:

```javascript
// ✅ Good - prepared statement
{
  query: "SELECT * FROM users WHERE id = $1",
  parameters: ["={{$json.id}}"]
}

// ❌ Bad - string concatenation
{
  query: "SELECT * FROM users WHERE id = '={{$json.id}}'"
}
```

### 4. Batch Writes
Write multiple records at once:

```javascript
// ✅ Good - batch insert
{
  operation: "insert",
  table: "orders",
  values: $json.items  // Array of 100 items
}

// ❌ Bad - individual inserts in loop
// 100 separate INSERT statements
```

### 5. Connection Pooling
Configure in credentials:

```javascript
{
  host: "db.example.com",
  database: "mydb",
  user: "user",
  password: "pass",
  // Connection pool settings
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000
}
```

---

## Error Handling

### Pattern 1: Check Rows Affected
```
Database Operation (UPDATE users...)
  → IF ({{$json.rowsAffected === 0}})
    └─ Alert: "No rows updated - record not found"
```

### Pattern 2: Constraint Violations
```javascript
// Database operation with continueOnFail: true
{
  operation: "insert",
  continueOnFail: true
}

// Next node: Check for errors
IF ({{$json.error !== undefined}})
  → IF ({{$json.error.includes('duplicate key')}})
    └─ Log: "Record already exists - skipping"
  → ELSE
    └─ Alert: "Database error: {{$json.error}}"
```

### Pattern 3: Rollback on Error
```
Try Operations:
  → Database Write 1
  → Database Write 2
  → Database Write 3

Error Trigger:
  → Rollback Operations
  → Alert Admin
```

---

## Security Best Practices

### 1. Use Parameterized Queries (Prevent SQL Injection)
```javascript
// ✅ SAFE - parameterized
{
  query: "SELECT * FROM users WHERE email = $1",
  parameters: ["={{$json.email}}"]
}

// ❌ DANGEROUS - SQL injection risk
{
  query: "SELECT * FROM users WHERE email = '={{$json.email}}'"
}
```

### 2. Least Privilege Access
**Create dedicated workflow user**:

```sql
-- ✅ Good - limited permissions
CREATE USER n8n_workflow WITH PASSWORD 'secure_password';
GRANT SELECT, INSERT, UPDATE ON orders TO n8n_workflow;
GRANT SELECT ON users TO n8n_workflow;

-- ❌ Bad - too much access
GRANT ALL PRIVILEGES TO n8n_workflow;
```

### 3. Validate Input Data

Check before the write with an IF (or Filter) node, one condition per rule — `{{ $json.email.isEmail() }}` is true,
`{{ ($json.name ?? '').trim().length >= 2 }}` is true — and send failures to their own branch. Normalize in the write
node's slots: `{{ $json.email.toLowerCase().trim() }}`. For per-field error messages back to a caller, see the Code
validator exception in `n8n-error-handling`.

### 4. Encrypt Sensitive Data

Use the Crypto node (typeVersion 2), action `encrypt`: the passphrase or key comes from a `crypto` credential, never from
the workflow JSON (`$credentials` doesn't exist inside a Code node). Configure its mode and cipher from `get_node` on the
user's version. Prefer encryption the database provides (pgcrypto, column encryption) when it's available.

---

## Common Gotchas

### 1. ❌ Wrong: Unbounded queries
```sql
SELECT * FROM large_table  -- Could return millions
```

### ✅ Correct: Use LIMIT
```sql
SELECT * FROM large_table
ORDER BY created_at DESC
LIMIT 1000
```

### 2. ❌ Wrong: String concatenation in queries
```javascript
query: "SELECT * FROM users WHERE id = '{{$json.id}}'"
```

### ✅ Correct: Parameterized queries
```javascript
query: "SELECT * FROM users WHERE id = $1",
parameters: ["={{$json.id}}"]
```

### 3. ❌ Wrong: No transaction for multi-step operations
```
INSERT into orders
INSERT into order_items  // Fails → orphaned order record
```

### ✅ Correct: Use transaction
```
BEGIN
INSERT into orders
INSERT into order_items
COMMIT (or ROLLBACK on error)
```

### 4. ❌ Wrong: Processing all items at once
```
SELECT 1000000 records → Process all → OOM error
```

### ✅ Correct: Batch processing
```
SELECT records → Split In Batches (1000) → Process → Loop
```

### 5. ❌ Wrong: Expecting output items from write operations
```
INSERT INTO table ... → Next node never executes (0 output items)
```

Database write operations (INSERT, UPDATE, DELETE) may return **0 result rows** from the database engine — reliably so for raw query execution (e.g. `executeQuery` with an INSERT), while some database nodes return the affected rows instead.
When 0 rows come back, n8n translates this to **0 output items**, silently breaking any downstream chain.

### ✅ Correct: Set `alwaysOutputData` on write nodes
```
INSERT INTO table ... (alwaysOutputData: true) → Next node executes with 1 empty item
```

Set `alwaysOutputData: true` on any node that executes INSERT, UPDATE, or DELETE.
This ensures at least 1 empty item (`{json: {}}`) flows downstream.

> **Tip:** If downstream nodes need actual data (not the empty passthrough item),
> reference the upstream node directly: `$('DataSource Node').all()`

---

## Real Template Examples

From n8n template library (456 database templates):

**Data Sync**:
```
Schedule → Postgres (SELECT new records) → Transform → MySQL (INSERT)
```

**ETL Pipeline**:
```
Schedule → [Multiple DB reads] → Merge → Transform → Warehouse (INSERT)
```

**Backup**:
```
Schedule → Postgres (SELECT all) → JSON → Google Drive (upload)
```

Use `search_templates({query: "database"})` to find more!

---

## Checklist for Database Workflows

### Planning
- [ ] Identify source and target databases
- [ ] Understand schema differences
- [ ] Plan transformation logic
- [ ] Consider batch size for large datasets
- [ ] Design error handling strategy

### Implementation
- [ ] Use parameterized queries (never concatenate)
- [ ] Add LIMIT to all SELECT queries
- [ ] Use appropriate operation (INSERT/UPDATE/UPSERT)
- [ ] Configure credentials properly
- [ ] Test with small dataset first

### Performance
- [ ] Add database indexes for queries
- [ ] Use batch operations
- [ ] Implement pagination for large datasets
- [ ] Configure connection pooling
- [ ] Monitor query execution times

### Security
- [ ] Use parameterized queries (SQL injection prevention)
- [ ] Least privilege database user
- [ ] Validate and sanitize input
- [ ] Encrypt sensitive data
- [ ] Never log sensitive data

### Reliability
- [ ] Add transaction handling if needed
- [ ] Check rows affected
- [ ] Handle constraint violations
- [ ] Implement retry logic
- [ ] Add Error Trigger workflow

---

## Summary

**Key Points**:
1. **Always use parameterized queries** (prevent SQL injection)
2. **Batch processing** for large datasets
3. **Transaction handling** for multi-step operations
4. **Limit result sets** to avoid memory issues
5. **Validate input data** before writes

**Pattern**: Trigger → Query → Transform → Write → Verify

**Related**:
- [http_api_integration.md](http_api_integration.md) - Fetching data to store in DB
- [scheduled_tasks.md](scheduled_tasks.md) - Periodic database maintenance
