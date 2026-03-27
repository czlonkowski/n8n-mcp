import { ToolDocumentation } from '../types';

export const n8nUpdatePartialWorkflowDoc: ToolDocumentation = {
  name: 'n8n_update_partial_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Update workflow incrementally with diff operations. Types: addNode, removeNode, updateNode, moveNode, enable/disableNode, addConnection, removeConnection, rewireConnection, cleanStaleConnections, replaceConnections, updateSettings, updateName, add/removeTag, activateWorkflow, deactivateWorkflow, transferWorkflow. Supports smart parameters (branch, case) for multi-output nodes. Full support for AI connections (ai_languageModel, ai_tool, ai_memory, ai_embedding, ai_vectorStore, ai_document, ai_textSplitter, ai_outputParser).',
    keyParameters: ['id', 'operations', 'continueOnError'],
    example: 'n8n_update_partial_workflow({id: "wf_123", operations: [{type: "rewireConnection", source: "IF", from: "Old", to: "New", branch: "true"}]})',
    performance: 'Fast (50-200ms)',
    tips: [
      'ALWAYS provide intent parameter describing what you\'re doing (e.g., "Add error handling", "Fix webhook URL", "Connect Slack to error output")',
      'DON\'T use generic intent like "update workflow" or "partial update" - be specific about your goal',
      'Use rewireConnection to change connection targets',
      'Use branch="true"/"false" for IF nodes',
      'Use case=N for Switch nodes',
      'Use cleanStaleConnections to auto-remove broken connections',
      'Set ignoreErrors:true on removeConnection for cleanup',
      'Use continueOnError mode for best-effort bulk operations',
      'Validate with validateOnly first',
      'For AI connections, specify sourceOutput type (ai_languageModel, ai_tool, etc.)',
      'Batch AI component connections for atomic updates',
      'Auto-sanitization: ALL nodes auto-fixed during updates (operator structures, missing metadata)',
      'Node renames automatically update all connection references - no manual connection operations needed',
      'Activate/deactivate workflows: Use activateWorkflow/deactivateWorkflow operations (requires activatable triggers like webhook/schedule)',
      'Transfer workflows between projects: Use transferWorkflow with destinationProjectId (enterprise feature)'
    ]
  },
  full: {
    description: `Updates workflows using surgical diff operations instead of full replacement. Supports 17 operation types for precise modifications. Operations are validated and applied atomically by default - all succeed or none are applied.

## Available Operations:

### Node Operations (6 types):
- **addNode**: Add a new node with name, type, and position (required)
- **removeNode**: Remove a node by ID or name
- **updateNode**: Update node properties using dot notation (e.g., 'parameters.url')
- **moveNode**: Change node position [x, y]
- **enableNode**: Enable a disabled node
- **disableNode**: Disable an active node

### Connection Operations (5 types):
- **addConnection**: Connect nodes (source→target). Supports smart parameters: branch="true"/"false" for IF nodes, case=N for Switch nodes.
- **removeConnection**: Remove connection between nodes (supports ignoreErrors flag)
- **rewireConnection**: Change connection target from one node to another. Supports smart parameters.
- **cleanStaleConnections**: Auto-remove all connections referencing non-existent nodes
- **replaceConnections**: Replace entire connections object

### Metadata Operations (4 types):
- **updateSettings**: Modify workflow settings
- **updateName**: Rename the workflow
- **addTag**: Add a workflow tag
- **removeTag**: Remove a workflow tag

### Workflow Activation Operations (2 types):
- **activateWorkflow**: Activate the workflow to enable automatic execution via triggers
- **deactivateWorkflow**: Deactivate the workflow to prevent automatic execution

### Project Management Operations (1 type):
- **transferWorkflow**: Transfer the workflow to a different project. Requires \`destinationProjectId\`. Enterprise/cloud feature.

## Smart Parameters for Multi-Output Nodes

For **IF nodes**, use semantic 'branch' parameter instead of technical sourceIndex:
- **branch="true"**: Routes to true branch (sourceIndex=0)
- **branch="false"**: Routes to false branch (sourceIndex=1)

For **Switch nodes**, use semantic 'case' parameter:
- **case=0**: First output
- **case=1**: Second output
- **case=N**: Nth output

Works with addConnection and rewireConnection operations. Explicit sourceIndex overrides smart parameters.

## AI Connection Support

Full support for all 8 AI connection types used in n8n AI workflows:

**Connection Types**:
- **ai_languageModel**: Connect language models (OpenAI, Anthropic, Google Gemini) to AI Agents
- **ai_tool**: Connect tools (HTTP Request Tool, Code Tool, etc.) to AI Agents
- **ai_memory**: Connect memory systems (Window Buffer, Conversation Summary) to AI Agents
- **ai_outputParser**: Connect output parsers (Structured, JSON) to AI Agents
- **ai_embedding**: Connect embedding models to Vector Stores
- **ai_vectorStore**: Connect vector stores to Vector Store Tools
- **ai_document**: Connect document loaders to Vector Stores
- **ai_textSplitter**: Connect text splitters to document processing chains

**AI Connection Examples**:
- Single connection: \`{type: "addConnection", source: "OpenAI", target: "AI Agent", sourceOutput: "ai_languageModel"}\`
- Fallback model: Use targetIndex (0=primary, 1=fallback) for dual language model setup
- Multiple tools: Batch multiple \`sourceOutput: "ai_tool"\` connections to one AI Agent
- Vector retrieval: Chain ai_embedding → ai_vectorStore → ai_tool → AI Agent

**Important Notes**:
- **AI nodes do NOT require main connections**: Nodes like OpenAI Chat Model, Postgres Chat Memory, Embeddings OpenAI, and Supabase Vector Store use AI-specific connection types exclusively. They should ONLY have connections like \`ai_languageModel\`, \`ai_memory\`, \`ai_embedding\`, or \`ai_tool\` - NOT \`main\` connections.

**Best Practices**:
- Always specify \`sourceOutput\` for AI connections (defaults to "main" if omitted)
- Connect language model BEFORE creating/enabling AI Agent (validation requirement)
- Use atomic mode (default) when setting up AI workflows to ensure complete configuration
- Validate AI workflows after changes with \`n8n_validate_workflow\` tool

## Cleanup & Recovery Features

### Automatic Cleanup
The **cleanStaleConnections** operation automatically removes broken connection references after node renames/deletions. Essential for workflow recovery.

### Best-Effort Mode
Set **continueOnError: true** to apply valid operations even if some fail. Returns detailed results showing which operations succeeded/failed. Perfect for bulk cleanup operations.

### Graceful Error Handling
Add **ignoreErrors: true** to removeConnection operations to prevent failures when connections don't exist.

## Auto-Sanitization System

### What Gets Auto-Fixed
When ANY workflow update is made, ALL nodes in the workflow are automatically sanitized to ensure complete metadata and correct structure:

1. **Operator Structure Fixes**:
   - Binary operators (equals, contains, greaterThan, etc.) automatically have \`singleValue\` removed
   - Unary operators (empty, notEmpty, true, false) automatically get \`singleValue: true\` added
   - Invalid operator structures (e.g., \`{type: "notEmpty"}\`) are corrected to \`{type: "object", operation: "notEmpty"}\`

2. **Missing Metadata Added**:
   - IF nodes with conditions get complete \`conditions.options\` structure if missing
   - Switch nodes with conditions get complete \`conditions.options\` for all rules
   - Required fields: \`{version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict"}\`

### Sanitization Scope
- Runs on **ALL nodes** in the workflow, not just modified ones
- Triggered by ANY update operation (addNode, updateNode, addConnection, etc.)
- Prevents workflow corruption that would make UI unrenderable

### Limitations
Auto-sanitization CANNOT fix:
- Broken connections (connections referencing non-existent nodes) - use \`cleanStaleConnections\`
- Branch count mismatches (e.g., Switch with 3 rules but only 2 outputs) - requires manual connection fixes
- Workflows in paradoxical corrupt states (API returns corrupt data, API rejects updates) - must recreate workflow

### Recovery Guidance
If validation still fails after auto-sanitization:
1. Check error details for specific issues
2. Use \`validate_workflow\` to see all validation errors
3. For connection issues, use \`cleanStaleConnections\` operation
4. For branch mismatches, add missing output connections
5. For paradoxical corrupted workflows, create new workflow and migrate nodes

## Automatic Connection Reference Updates

When you rename a node using **updateNode**, all connection references throughout the workflow are automatically updated. Both the connection source keys and target references are updated for all connection types (main, error, ai_tool, ai_languageModel, ai_memory, etc.) and all branch configurations (IF node branches, Switch node cases, error outputs).

### Basic Example
\`\`\`javascript
// Rename a node - connections update automatically
n8n_update_partial_workflow({
  id: "wf_123",
  operations: [{
    type: "updateNode",
    nodeId: "node_abc",
    updates: { name: "Data Processor" }
  }]
});
// All incoming and outgoing connections now reference "Data Processor"
\`\`\`

### Multi-Output Node Example
\`\`\`javascript
// Rename nodes in a branching workflow
n8n_update_partial_workflow({
  id: "workflow_id",
  operations: [
    {
      type: "updateNode",
      nodeId: "if_node_id",
      updates: { name: "Value Checker" }
    },
    {
      type: "updateNode",
      nodeId: "error_node_id",
      updates: { name: "Error Handler" }
    }
  ]
});
// IF node branches and error connections automatically updated
\`\`\`

### Name Collision Protection
Attempting to rename a node to an existing name returns a clear error:
\`\`\`
Cannot rename node "Old Name" to "New Name": A node with that name already exists (id: abc123...).
Please choose a different name.
\`\`\`

### Usage Notes
- Simply rename nodes with updateNode - no manual connection operations needed
- Multiple renames in one call work atomically
- Can rename a node and add/remove connections using the new name in the same batch
- Use \`validateOnly: true\` to preview effects before applying

## Removing Properties with null

To remove a property from a node, set its value to \`null\` in the updates object. This is essential when migrating from deprecated properties or cleaning up optional configuration fields.

### Why Use null?
- **Property removal**: Setting a property to \`null\` removes it completely from the node object
- **Validation constraints**: Some properties are mutually exclusive (e.g., \`continueOnFail\` and \`onError\`). Simply setting one without removing the other will fail validation
- **Deprecated property migration**: When n8n deprecates properties, you must remove the old property before the new one will work

### Basic Property Removal
\`\`\`javascript
// Remove error handling configuration
n8n_update_partial_workflow({
  id: "wf_123",
  operations: [{
    type: "updateNode",
    nodeName: "HTTP Request",
    updates: { onError: null }
  }]
});

// Remove disabled flag
n8n_update_partial_workflow({
  id: "wf_456",
  operations: [{
    type: "updateNode",
    nodeId: "node_abc",
    updates: { disabled: null }
  }]
});
\`\`\`

### Nested Property Removal
Use dot notation to remove nested properties:
\`\`\`javascript
// Remove nested parameter
n8n_update_partial_workflow({
  id: "wf_789",
  operations: [{
    type: "updateNode",
    nodeName: "API Request",
    updates: { "parameters.authentication": null }
  }]
});

// Remove entire array property
n8n_update_partial_workflow({
  id: "wf_012",
  operations: [{
    type: "updateNode",
    nodeName: "HTTP Request",
    updates: { "parameters.headers": null }
  }]
});
\`\`\`

### Migrating from Deprecated Properties
Common scenario: replacing \`continueOnFail\` with \`onError\`:
\`\`\`javascript
// WRONG: Setting only the new property leaves the old one
n8n_update_partial_workflow({
  id: "wf_123",
  operations: [{
    type: "updateNode",
    nodeName: "HTTP Request",
    updates: { onError: "continueErrorOutput" }
  }]
});
// Error: continueOnFail and onError are mutually exclusive

// CORRECT: Remove the old property first
n8n_update_partial_workflow({
  id: "wf_123",
  operations: [{
    type: "updateNode",
    nodeName: "HTTP Request",
    updates: {
      continueOnFail: null,
      onError: "continueErrorOutput"
    }
  }]
});
\`\`\`

### Batch Property Removal
Remove multiple properties in one operation:
\`\`\`javascript
n8n_update_partial_workflow({
  id: "wf_345",
  operations: [{
    type: "updateNode",
    nodeName: "Data Processor",
    updates: {
      continueOnFail: null,
      alwaysOutputData: null,
      "parameters.legacy_option": null
    }
  }]
});
\`\`\`

### When to Use null
- Removing deprecated properties during migration
- Cleaning up optional configuration flags
- Resolving mutual exclusivity validation errors
- Removing stale or unnecessary node metadata
- Simplifying node configuration`,
    parameters: {
      id: { type: 'string', required: true, description: 'Workflow ID to update' },
      operations: {
        type: 'array',
        required: true,
        description: 'Array of diff operations. Each must have "type" field and operation-specific properties. Nodes can be referenced by ID or name.'
      },
      validateOnly: { type: 'boolean', description: 'If true, only validate operations without applying them' },
      continueOnError: { type: 'boolean', description: 'If true, apply valid operations even if some fail (best-effort mode). Returns applied and failed operation indices. Default: false (atomic)' },
      intent: { type: 'string', description: 'Intent of the change - helps to return better response. Include in every tool call. Example: "Add error handling for API failures".' }
    },
    returns: 'Minimal summary (id, name, active, nodeCount, operationsApplied) for token efficiency. Use n8n_get_workflow with mode "structure" to verify current state if needed. Returns validation results if validateOnly=true.',
    examples: [
      '// Include intent parameter for better responses\nn8n_update_partial_workflow({id: "abc", intent: "Add error handling for API failures", operations: [{type: "addConnection", source: "HTTP Request", target: "Error Handler"}]})',
      '// Add a basic node (minimal configuration)\nn8n_update_partial_workflow({id: "abc", operations: [{type: "addNode", node: {name: "Process Data", type: "n8n-nodes-base.set", position: [400, 300], parameters: {}}}]})',
      '// Add node with full configuration\nn8n_update_partial_workflow({id: "def", operations: [{type: "addNode", node: {name: "Send Slack Alert", type: "n8n-nodes-base.slack", position: [600, 300], typeVersion: 2, parameters: {resource: "message", operation: "post", channel: "#alerts", text: "Success!"}}}]})',
      '// Add node AND connect it (common pattern)\nn8n_update_partial_workflow({id: "ghi", operations: [\n  {type: "addNode", node: {name: "HTTP Request", type: "n8n-nodes-base.httpRequest", position: [400, 300], parameters: {url: "https://api.example.com", method: "GET"}}},\n  {type: "addConnection", source: "Webhook", target: "HTTP Request"}\n]})',
      '// Rewire connection from one target to another\nn8n_update_partial_workflow({id: "xyz", operations: [{type: "rewireConnection", source: "Webhook", from: "Old Handler", to: "New Handler"}]})',
      '// Smart parameter: IF node true branch\nn8n_update_partial_workflow({id: "abc", operations: [{type: "addConnection", source: "IF", target: "Success Handler", branch: "true"}]})',
      '// Smart parameter: IF node false branch\nn8n_update_partial_workflow({id: "def", operations: [{type: "addConnection", source: "IF", target: "Error Handler", branch: "false"}]})',
      '// Smart parameter: Switch node case routing\nn8n_update_partial_workflow({id: "ghi", operations: [\n  {type: "addConnection", source: "Switch", target: "Handler A", case: 0},\n  {type: "addConnection", source: "Switch", target: "Handler B", case: 1},\n  {type: "addConnection", source: "Switch", target: "Handler C", case: 2}\n]})',
      '// Rewire with smart parameter\nn8n_update_partial_workflow({id: "jkl", operations: [{type: "rewireConnection", source: "IF", from: "Old True Handler", to: "New True Handler", branch: "true"}]})',
      '// Add multiple nodes in batch\nn8n_update_partial_workflow({id: "mno", operations: [\n  {type: "addNode", node: {name: "Filter", type: "n8n-nodes-base.filter", position: [400, 300], parameters: {}}},\n  {type: "addNode", node: {name: "Transform", type: "n8n-nodes-base.set", position: [600, 300], parameters: {}}},\n  {type: "addConnection", source: "Filter", target: "Transform"}\n]})',
      '// Clean up stale connections after node renames/deletions\nn8n_update_partial_workflow({id: "pqr", operations: [{type: "cleanStaleConnections"}]})',
      '// Remove connection gracefully (no error if it doesn\'t exist)\nn8n_update_partial_workflow({id: "stu", operations: [{type: "removeConnection", source: "Old Node", target: "Target", ignoreErrors: true}]})',
      '// Best-effort mode: apply what works, report what fails\nn8n_update_partial_workflow({id: "vwx", operations: [\n  {type: "updateName", name: "Fixed Workflow"},\n  {type: "removeConnection", source: "Broken", target: "Node"},\n  {type: "cleanStaleConnections"}\n], continueOnError: true})',
      '// Update node parameter\nn8n_update_partial_workflow({id: "yza", operations: [{type: "updateNode", nodeName: "HTTP Request", updates: {"parameters.url": "https://api.example.com"}}]})',
      '// Validate before applying\nn8n_update_partial_workflow({id: "bcd", operations: [{type: "removeNode", nodeName: "Old Process"}], validateOnly: true})',
      '// Surgically edit code using __patch_find_replace (avoids replacing entire code block)\nn8n_update_partial_workflow({id: "pfr1", operations: [{type: "updateNode", nodeName: "Code", updates: {"parameters.jsCode": {"__patch_find_replace": [{"find": "const limit = 10;", "replace": "const limit = 50;"}]}}}]})',
      '// Multiple sequential patches on the same property\nn8n_update_partial_workflow({id: "pfr2", operations: [{type: "updateNode", nodeName: "Code", updates: {"parameters.jsCode": {"__patch_find_replace": [{"find": "api.old-domain.com", "replace": "api.new-domain.com"}, {"find": "Authorization: Bearer old_token", "replace": "Authorization: Bearer new_token"}]}}}]})',
      '\n// ============ AI CONNECTION EXAMPLES ============',
      '// Connect language model to AI Agent\nn8n_update_partial_workflow({id: "ai1", operations: [{type: "addConnection", source: "OpenAI Chat Model", target: "AI Agent", sourceOutput: "ai_languageModel"}]})',
      '// Connect tool to AI Agent\nn8n_update_partial_workflow({id: "ai2", operations: [{type: "addConnection", source: "HTTP Request Tool", target: "AI Agent", sourceOutput: "ai_tool"}]})',
      '// Connect memory to AI Agent\nn8n_update_partial_workflow({id: "ai3", operations: [{type: "addConnection", source: "Window Buffer Memory", target: "AI Agent", sourceOutput: "ai_memory"}]})',
      '// Connect output parser to AI Agent\nn8n_update_partial_workflow({id: "ai4", operations: [{type: "addConnection", source: "Structured Output Parser", target: "AI Agent", sourceOutput: "ai_outputParser"}]})',
      '// Complete AI Agent setup: Add language model, tools, and memory\nn8n_update_partial_workflow({id: "ai5", operations: [\n  {type: "addConnection", source: "OpenAI Chat Model", target: "AI Agent", sourceOutput: "ai_languageModel"},\n  {type: "addConnection", source: "HTTP Request Tool", target: "AI Agent", sourceOutput: "ai_tool"},\n  {type: "addConnection", source: "Code Tool", target: "AI Agent", sourceOutput: "ai_tool"},\n  {type: "addConnection", source: "Window Buffer Memory", target: "AI Agent", sourceOutput: "ai_memory"}\n]})',
      '// Add fallback model to AI Agent for reliability\nn8n_update_partial_workflow({id: "ai6", operations: [\n  {type: "addConnection", source: "OpenAI Chat Model", target: "AI Agent", sourceOutput: "ai_languageModel", targetIndex: 0},\n  {type: "addConnection", source: "Anthropic Chat Model", target: "AI Agent", sourceOutput: "ai_languageModel", targetIndex: 1}\n]})',
      '// Vector Store setup: Connect embeddings and documents\nn8n_update_partial_workflow({id: "ai7", operations: [\n  {type: "addConnection", source: "Embeddings OpenAI", target: "Pinecone Vector Store", sourceOutput: "ai_embedding"},\n  {type: "addConnection", source: "Default Data Loader", target: "Pinecone Vector Store", sourceOutput: "ai_document"}\n]})',
      '// Connect Vector Store Tool to AI Agent (retrieval setup)\nn8n_update_partial_workflow({id: "ai8", operations: [\n  {type: "addConnection", source: "Pinecone Vector Store", target: "Vector Store Tool", sourceOutput: "ai_vectorStore"},\n  {type: "addConnection", source: "Vector Store Tool", target: "AI Agent", sourceOutput: "ai_tool"}\n]})',
      '// Rewire AI Agent to use different language model\nn8n_update_partial_workflow({id: "ai9", operations: [{type: "rewireConnection", source: "AI Agent", from: "OpenAI Chat Model", to: "Anthropic Chat Model", sourceOutput: "ai_languageModel"}]})',
      '// Replace all AI tools for an agent\nn8n_update_partial_workflow({id: "ai10", operations: [\n  {type: "removeConnection", source: "Old Tool 1", target: "AI Agent", sourceOutput: "ai_tool"},\n  {type: "removeConnection", source: "Old Tool 2", target: "AI Agent", sourceOutput: "ai_tool"},\n  {type: "addConnection", source: "New HTTP Tool", target: "AI Agent", sourceOutput: "ai_tool"},\n  {type: "addConnection", source: "New Code Tool", target: "AI Agent", sourceOutput: "ai_tool"}\n]})',
      '\n// ============ REMOVING PROPERTIES EXAMPLES ============',
      '// Remove a simple property\nn8n_update_partial_workflow({id: "rm1", operations: [{type: "updateNode", nodeName: "HTTP Request", updates: {onError: null}}]})',
      '// Migrate from deprecated continueOnFail to onError\nn8n_update_partial_workflow({id: "rm2", operations: [{type: "updateNode", nodeName: "HTTP Request", updates: {continueOnFail: null, onError: "continueErrorOutput"}}]})',
      '// Remove nested property\nn8n_update_partial_workflow({id: "rm3", operations: [{type: "updateNode", nodeName: "API Request", updates: {"parameters.authentication": null}}]})',
      '// Remove multiple properties\nn8n_update_partial_workflow({id: "rm4", operations: [{type: "updateNode", nodeName: "Data Processor", updates: {continueOnFail: null, alwaysOutputData: null, "parameters.legacy_option": null}}]})',
      '// Remove entire array property\nn8n_update_partial_workflow({id: "rm5", operations: [{type: "updateNode", nodeName: "HTTP Request", updates: {"parameters.headers": null}}]})',
      '\n// ============ PROJECT TRANSFER EXAMPLES ============',
      '// Transfer workflow to a different project\nn8n_update_partial_workflow({id: "tf1", operations: [{type: "transferWorkflow", destinationProjectId: "project-abc-123"}]})',
      '// Transfer and activate in one call\nn8n_update_partial_workflow({id: "tf2", operations: [{type: "transferWorkflow", destinationProjectId: "project-abc-123"}, {type: "activateWorkflow"}]})'
    ],
    useCases: [
      'Rewire connections when replacing nodes',
      'Route IF/Switch node outputs with semantic parameters',
      'Clean up broken workflows after node renames/deletions',
      'Bulk connection cleanup with best-effort mode',
      'Update single node parameters',
      'Replace all connections at once',
      'Graceful cleanup operations that don\'t fail',
      'Enable/disable nodes',
      'Rename workflows or nodes',
      'Manage tags efficiently',
      'Connect AI components (language models, tools, memory, parsers)',
      'Set up AI Agent workflows with multiple tools',
      'Add fallback language models to AI Agents',
      'Configure Vector Store retrieval systems',
      'Swap language models in existing AI workflows',
      'Batch-update AI tool connections',
      'Transfer workflows between team projects (enterprise)'
    ],
    performance: 'Very fast - typically 50-200ms. Much faster than full updates as only changes are processed.',
    bestPractices: [
      'Always include intent parameter with specific description (e.g., "Add error handling to HTTP Request node", "Fix authentication flow", "Connect Slack notification to errors"). Avoid generic phrases like "update workflow" or "partial update"',
      'Use rewireConnection instead of remove+add for changing targets',
      'Use branch="true"/"false" for IF nodes instead of sourceIndex',
      'Use case=N for Switch nodes instead of sourceIndex',
      'Use cleanStaleConnections after renaming/removing nodes',
      'Use continueOnError for bulk cleanup operations',
      'Set ignoreErrors:true on removeConnection for graceful cleanup',
      'Use validateOnly to test operations before applying',
      'Group related changes in one call',
      'Check operation order for dependencies',
      'Use atomic mode (default) for critical updates',
      'For AI connections, always specify sourceOutput (ai_languageModel, ai_tool, ai_memory, etc.)',
      'Connect language model BEFORE adding AI Agent to ensure validation passes',
      'Use targetIndex for fallback models (primary=0, fallback=1)',
      'Batch AI component connections in a single operation for atomicity',
      'Validate AI workflows after connection changes to catch configuration errors',
      'To remove properties, set them to null in the updates object',
      'When migrating from deprecated properties, remove the old property and add the new one in the same operation',
      'Use null to resolve mutual exclusivity validation errors between properties',
      'Batch multiple property removals in a single updateNode operation for efficiency'
    ],
    pitfalls: [
      '**REQUIRES N8N_API_URL and N8N_API_KEY environment variables** - will not work without n8n API access',
      'Atomic mode (default): all operations must succeed or none are applied',
      'continueOnError breaks atomic guarantees - use with caution',
      'Order matters for dependent operations (e.g., must add node before connecting to it)',
      'Node references accept ID or name, but name must be unique',
      'Node names with special characters (apostrophes, quotes) work correctly',
      'For best compatibility, prefer node IDs over names when dealing with special characters',
      'Use "updates" property for updateNode operations: {type: "updateNode", updates: {...}}',
      'Smart parameters (branch, case) only work with IF and Switch nodes - ignored for other node types',
      'Explicit sourceIndex overrides smart parameters (branch, case) if both provided',
      '**CRITICAL**: For If nodes, ALWAYS use branch="true"/"false" instead of sourceIndex. Using sourceIndex=0 for multiple connections will put them ALL on the TRUE branch (main[0]), breaking your workflow logic!',
      '**CRITICAL**: For Switch nodes, ALWAYS use case=N instead of sourceIndex. Using same sourceIndex for multiple connections will put them on the same case output.',
      'cleanStaleConnections removes ALL broken connections - cannot be selective',
      'replaceConnections overwrites entire connections object - all previous connections lost',
      '**Auto-sanitization behavior**: Binary operators (equals, contains) automatically have singleValue removed; unary operators (empty, notEmpty) automatically get singleValue:true added',
      '**Auto-sanitization runs on ALL nodes**: When ANY update is made, ALL nodes in the workflow are sanitized (not just modified ones)',
      '**Auto-sanitization cannot fix everything**: It fixes operator structures and missing metadata, but cannot fix broken connections or branch mismatches',
      '**Corrupted workflows beyond repair**: Workflows in paradoxical states (API returns corrupt, API rejects updates) cannot be fixed via API - must be recreated',
      '**__patch_find_replace for code edits**: Instead of replacing entire code blocks, use `{"parameters.jsCode": {"__patch_find_replace": [{"find": "old text", "replace": "new text"}]}}` to surgically edit string properties',
      '__patch_find_replace replaces the FIRST occurrence of each find string. Patches are applied sequentially — order matters',
      'To remove a property, set it to null in the updates object',
      'When properties are mutually exclusive (e.g., continueOnFail and onError), setting only the new property will fail - you must remove the old one with null',
      'Removing a required property may cause validation errors - check node documentation first',
      'Nested property removal with dot notation only removes the specific nested field, not the entire parent object',
      'Array index notation (e.g., "parameters.headers[0]") is not supported - remove the entire array property instead'
    ],
    relatedTools: ['n8n_update_full_workflow', 'n8n_get_workflow', 'validate_workflow', 'tools_documentation']
  }
};