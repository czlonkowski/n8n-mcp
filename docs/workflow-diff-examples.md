# Workflow Diff Examples

This guide demonstrates how to use the `n8n_update_partial_workflow` tool for efficient workflow editing.

## Overview

The `n8n_update_partial_workflow` tool allows you to make targeted changes to workflows without sending the entire workflow JSON. This results in:
- 80-90% reduction in token usage
- More precise edits
- Clearer intent
- Reduced risk of accidentally modifying unrelated parts

## Basic Usage

```json
{
  "id": "workflow-id-here",
  "operations": [
    {
      "type": "operation-type",
      "...operation-specific-fields..."
    }
  ]
}
```

## Operation Types

### 1. Node Operations

#### Add Node
```json
{
  "type": "addNode",
  "description": "Add HTTP Request node to fetch data",
  "node": {
    "name": "Fetch User Data",
    "type": "n8n-nodes-base.httpRequest",
    "position": [600, 300],
    "parameters": {
      "url": "https://api.example.com/users",
      "method": "GET",
      "authentication": "none"
    }
  }
}
```

#### Remove Node
```json
{
  "type": "removeNode",
  "nodeName": "Old Node Name",
  "description": "Remove deprecated node"
}
```

#### Update Node
```json
{
  "type": "updateNode",
  "nodeName": "HTTP Request",
  "changes": {
    "parameters.url": "https://new-api.example.com/v2/users",
    "parameters.headers.parameters": [
      {
        "name": "Authorization",
        "value": "Bearer {{$credentials.apiKey}}"
      }
    ]
  },
  "description": "Update API endpoint to v2"
}
```

#### Move Node
```json
{
  "type": "moveNode",
  "nodeName": "Set Variable",
  "position": [800, 400],
  "description": "Reposition for better layout"
}
```

#### Enable/Disable Node
```json
{
  "type": "disableNode",
  "nodeName": "Debug Node",
  "description": "Disable debug output for production"
}
```

### 2. Connection Operations

#### Add Connection
```json
{
  "type": "addConnection",
  "source": "Webhook",
  "target": "Process Data",
  "sourceOutput": "main",
  "targetInput": "main",
  "description": "Connect webhook to processor"
}
```

#### Remove Connection
```json
{
  "type": "removeConnection",
  "source": "Old Source",
  "target": "Old Target",
  "description": "Remove unused connection"
}
```

#### Rewire Connection
```json
{
  "type": "rewireConnection",
  "source": "Webhook",
  "from": "Old Handler",
  "to": "New Handler",
  "description": "Rewire connection to new handler"
}
```

#### Smart Parameters for IF Nodes
```json
{
  "type": "addConnection",
  "source": "IF",
  "target": "Success Handler",
  "branch": "true",  // Semantic parameter instead of sourceIndex
  "description": "Route true branch to success handler"
}
```

```json
{
  "type": "addConnection",
  "source": "IF",
  "target": "Error Handler",
  "branch": "false",  // Routes to false branch (sourceIndex=1)
  "description": "Route false branch to error handler"
}
```

#### Smart Parameters for Switch Nodes
```json
{
  "type": "addConnection",
  "source": "Switch",
  "target": "Handler A",
  "case": 0,  // First output
  "description": "Route case 0 to Handler A"
}
```

### 3. Workflow Metadata Operations

#### Update Workflow Name
```json
{
  "type": "updateName",
  "name": "Production User Sync v2",
  "description": "Update workflow name for versioning"
}
```

#### Update Settings
```json
{
  "type": "updateSettings",
  "settings": {
    "executionTimeout": 300,
    "saveDataErrorExecution": "all",
    "timezone": "America/New_York"
  },
  "description": "Configure production settings"
}
```

#### Manage Tags
```json
{
  "type": "addTag",
  "tag": "production",
  "description": "Mark as production workflow"
}
```

## Complete Examples

### Example 1: Add Slack Notification to Workflow
```json
{
  "id": "workflow-123",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "name": "Send Slack Alert",
        "type": "n8n-nodes-base.slack",
        "position": [1000, 300],
        "parameters": {
          "resource": "message",
          "operation": "post",
          "channel": "#alerts",
          "text": "Workflow completed successfully!"
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Process Data",
      "target": "Send Slack Alert"
    }
  ]
}
```

### Example 2: Update Multiple Webhook Paths
```json
{
  "id": "workflow-456",
  "operations": [
    {
      "type": "updateNode",
      "nodeName": "Webhook 1",
      "changes": {
        "parameters.path": "v2/webhook1"
      }
    },
    {
      "type": "updateNode",
      "nodeName": "Webhook 2",
      "changes": {
        "parameters.path": "v2/webhook2"
      }
    },
    {
      "type": "updateName",
      "name": "API v2 Webhooks"
    }
  ]
}
```

### Example 3: Refactor Workflow Structure
```json
{
  "id": "workflow-789",
  "operations": [
    {
      "type": "removeNode",
      "nodeName": "Legacy Processor"
    },
    {
      "type": "addNode",
      "node": {
        "name": "Modern Processor",
        "type": "n8n-nodes-base.code",
        "position": [600, 300],
        "parameters": {
          "mode": "runOnceForEachItem",
          "jsCode": "// Process items\nreturn item;"
        }
      }
    },
    {
      "type": "addConnection",
      "source": "HTTP Request",
      "target": "Modern Processor"
    },
    {
      "type": "addConnection",
      "source": "Modern Processor",
      "target": "Save to Database"
    }
  ]
}
```

### Example 4: Add Error Handling
```json
{
  "id": "workflow-999",
  "operations": [
    {
      "type": "addNode",
      "node": {
        "name": "Error Handler",
        "type": "n8n-nodes-base.errorTrigger",
        "position": [200, 500]
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Send Error Email",
        "type": "n8n-nodes-base.emailSend",
        "position": [400, 500],
        "parameters": {
          "toEmail": "admin@example.com",
          "subject": "Workflow Error: {{$node['Error Handler'].json.error.message}}",
          "text": "Error details: {{$json}}"
        }
      }
    },
    {
      "type": "addConnection",
      "source": "Error Handler",
      "target": "Send Error Email"
    },
    {
      "type": "updateSettings",
      "settings": {
        "errorWorkflow": "workflow-999"
      }
    }
  ]
}
```

### Example 5: Large Batch Workflow Refactoring
Demonstrates handling many operations in a single request - no longer limited to 5 operations!

```json
{
  "id": "workflow-batch",
  "operations": [
    // Add 10 processing nodes
    {
      "type": "addNode",
      "node": {
        "name": "Filter Active Users",
        "type": "n8n-nodes-base.filter",
        "position": [400, 200],
        "parameters": { "conditions": { "boolean": [{ "value1": "={{$json.active}}", "value2": true }] } }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Transform User Data",
        "type": "n8n-nodes-base.set",
        "position": [600, 200],
        "parameters": { "values": { "string": [{ "name": "formatted_name", "value": "={{$json.firstName}} {{$json.lastName}}" }] } }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Validate Email",
        "type": "n8n-nodes-base.if",
        "position": [800, 200],
        "parameters": { "conditions": { "string": [{ "value1": "={{$json.email}}", "operation": "contains", "value2": "@" }] } }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Enrich with API",
        "type": "n8n-nodes-base.httpRequest",
        "position": [1000, 150],
        "parameters": { "url": "https://api.example.com/enrich", "method": "POST" }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Log Invalid Emails",
        "type": "n8n-nodes-base.code",
        "position": [1000, 350],
        "parameters": { "jsCode": "console.log('Invalid email:', $json.email);\nreturn $json;" }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Merge Results",
        "type": "n8n-nodes-base.merge",
        "position": [1200, 250]
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Deduplicate",
        "type": "n8n-nodes-base.removeDuplicates",
        "position": [1400, 250],
        "parameters": { "propertyName": "id" }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Sort by Date",
        "type": "n8n-nodes-base.sort",
        "position": [1600, 250],
        "parameters": { "sortFieldsUi": { "sortField": [{ "fieldName": "created_at", "order": "descending" }] } }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Batch for DB",
        "type": "n8n-nodes-base.splitInBatches",
        "position": [1800, 250],
        "parameters": { "batchSize": 100 }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Save to Database",
        "type": "n8n-nodes-base.postgres",
        "position": [2000, 250],
        "parameters": { "operation": "insert", "table": "processed_users" }
      }
    },
    // Connect all the nodes
    {
      "type": "addConnection",
      "source": "Get Users",
      "target": "Filter Active Users"
    },
    {
      "type": "addConnection",
      "source": "Filter Active Users",
      "target": "Transform User Data"
    },
    {
      "type": "addConnection",
      "source": "Transform User Data",
      "target": "Validate Email"
    },
    {
      "type": "addConnection",
      "source": "Validate Email",
      "sourceOutput": "true",
      "target": "Enrich with API"
    },
    {
      "type": "addConnection",
      "source": "Validate Email",
      "sourceOutput": "false",
      "target": "Log Invalid Emails"
    },
    {
      "type": "addConnection",
      "source": "Enrich with API",
      "target": "Merge Results"
    },
    {
      "type": "addConnection",
      "source": "Log Invalid Emails",
      "target": "Merge Results",
      "targetInput": "input2"
    },
    {
      "type": "addConnection",
      "source": "Merge Results",
      "target": "Deduplicate"
    },
    {
      "type": "addConnection",
      "source": "Deduplicate",
      "target": "Sort by Date"
    },
    {
      "type": "addConnection",
      "source": "Sort by Date",
      "target": "Batch for DB"
    },
    {
      "type": "addConnection",
      "source": "Batch for DB",
      "target": "Save to Database"
    },
    // Update workflow metadata
    {
      "type": "updateName",
      "name": "User Processing Pipeline v2"
    },
    {
      "type": "updateSettings",
      "settings": {
        "executionOrder": "v1",
        "timezone": "UTC",
        "saveDataSuccessExecution": "all"
      }
    },
    {
      "type": "addTag",
      "tag": "production"
    },
    {
      "type": "addTag",
      "tag": "user-processing"
    },
    {
      "type": "addTag",
      "tag": "v2"
    }
  ]
}
```

This example shows 26 operations in a single request, creating a complete data processing pipeline with proper error handling, validation, and batch processing.

## Best Practices

1. **Use Descriptive Names**: Always provide clear node names and descriptions for operations
2. **Batch Related Changes**: Group related operations in a single request
3. **Validate First**: Use `validateOnly: true` to test your operations before applying
4. **Reference by Name**: Prefer node names over IDs for better readability
5. **Small, Focused Changes**: Make targeted edits rather than large structural changes

## Common Patterns

### Add Processing Step
```json
{
  "operations": [
    {
      "type": "removeConnection",
      "source": "Source Node",
      "target": "Target Node"
    },
    {
      "type": "addNode",
      "node": {
        "name": "Process Step",
        "type": "n8n-nodes-base.set",
        "position": [600, 300],
        "parameters": { /* ... */ }
      }
    },
    {
      "type": "addConnection",
      "source": "Source Node",
      "target": "Process Step"
    },
    {
      "type": "addConnection",
      "source": "Process Step",
      "target": "Target Node"
    }
  ]
}
```

### Replace Node
```json
{
  "operations": [
    {
      "type": "addNode",
      "node": {
        "name": "New Implementation",
        "type": "n8n-nodes-base.httpRequest",
        "position": [600, 300],
        "parameters": { /* ... */ }
      }
    },
    {
      "type": "removeConnection",
      "source": "Previous Node",
      "target": "Old Implementation"
    },
    {
      "type": "removeConnection",
      "source": "Old Implementation",
      "target": "Next Node"
    },
    {
      "type": "addConnection",
      "source": "Previous Node",
      "target": "New Implementation"
    },
    {
      "type": "addConnection",
      "source": "New Implementation",
      "target": "Next Node"
    },
    {
      "type": "removeNode",
      "nodeName": "Old Implementation"
    }
  ]
}
```

## Error Handling

The tool validates all operations before applying any changes. Common errors include:

- **Duplicate node names**: Each node must have a unique name
- **Invalid node types**: Use full package prefixes (e.g., `n8n-nodes-base.webhook`)
- **Missing connections**: Referenced nodes must exist
- **Circular dependencies**: Connections cannot create loops

Always check the response for validation errors and adjust your operations accordingly.

## Transactional Updates

The diff engine processes operations **sequentially in the order you submit them**. Each operation validates against the workflow state as of its position in the batch — so a connection op only sees nodes that earlier ops have already added, and a `removeConnection` validates *before* any later `updateNode` rename projects onto its references. Rename projections (auto-updating connection references when a node is renamed) flush after the rename op runs, not at the end of the batch.

### How It Works

1. **Sequential Execution**: Operations apply in caller order; each op validates against the state of the workflow up to that point.
2. **Per-Op Rename Flush**: When `updateNode` renames a node, all connection references (both keys and target names) are rewritten before the next op validates.
3. **No Operation Limit**: Process unlimited operations in a single request.
4. **Atomic by Default**: Any operation failing aborts the batch; pass `continueOnError: true` for best-effort mode.

### Legacy Hoist: `addConnection` before `addNode`

For backward compatibility with the "list connections first, then nodes" pattern, an `addConnection` or `rewireConnection` that references a node added later in the same batch causes that `addNode` to be hoisted to just before its first earlier reference. This is the *only* automatic reordering. Other op kinds (e.g., `removeConnection X→Y` before `addNode X`, or `replaceConnections` referencing a not-yet-added node) are no longer reordered and will fail validation.

```json
{
  "id": "workflow-id",
  "operations": [
    // Hoisted: "Process Data" is added before this connection runs
    { "type": "addConnection", "source": "Webhook", "target": "Process Data" },
    { "type": "addConnection", "source": "Process Data", "target": "Send Email" },
    {
      "type": "addNode",
      "node": {
        "name": "Process Data",
        "type": "n8n-nodes-base.set",
        "position": [400, 300],
        "parameters": {}
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Send Email",
        "type": "n8n-nodes-base.emailSend",
        "position": [600, 300],
        "parameters": { "to": "user@example.com" }
      }
    }
  ]
}
```

### Recommendation

Even though the hoist exists, write operations in causal order — add the node first, then connect it. This matches what the diff engine actually does at runtime, makes batches easier to read, and avoids surprises if you ever switch on `continueOnError: true` (where the order in which failures occur matters).

### Benefits

- **Predictable Validation**: Each op sees the workflow state as it stands at that point in the batch, so errors point at the real cause instead of an end-state projection.
- **Atomic Updates**: All operations succeed or all fail (unless `continueOnError` is enabled).
- **No Hard Limits**: Process unlimited operations efficiently.

### Example: Complete Workflow Addition

```json
{
  "id": "workflow-id",
  "operations": [
    // Add three nodes
    {
      "type": "addNode",
      "node": {
        "name": "Schedule",
        "type": "n8n-nodes-base.schedule",
        "position": [200, 300],
        "parameters": {
          "rule": {
            "interval": [{ "field": "hours", "intervalValue": 1 }]
          }
        }
      }
    },
    {
      "type": "addNode", 
      "node": {
        "name": "Get Data",
        "type": "n8n-nodes-base.httpRequest",
        "position": [400, 300],
        "parameters": {
          "url": "https://api.example.com/data"
        }
      }
    },
    {
      "type": "addNode",
      "node": {
        "name": "Save to Database",
        "type": "n8n-nodes-base.postgres",
        "position": [600, 300],
        "parameters": {
          "operation": "insert"
        }
      }
    },
    // Connect them all
    {
      "type": "addConnection",
      "source": "Schedule",
      "target": "Get Data"
    },
    {
      "type": "addConnection",
      "source": "Get Data", 
      "target": "Save to Database"
    }
  ]
}
```

Operations execute top-to-bottom; nodes are added before the connections that reference them.