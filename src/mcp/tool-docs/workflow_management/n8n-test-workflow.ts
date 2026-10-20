import { ToolDocumentation } from '../types';

export const n8nTestWorkflowDoc: ToolDocumentation = {
  name: 'n8n_test_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Run a workflow. method=auto (default) triggers it over HTTP via its webhook/form/chat trigger; method=prepare/pinned/direct run it through n8n\'s own MCP server.',
    keyParameters: ['workflowId', 'method', 'data', 'message', 'pinData'],
    example: 'n8n_test_workflow({workflowId: "123"}) - auto-detect trigger',
    performance: 'Immediate trigger, response time depends on workflow complexity',
    tips: [
      'Auto-detects trigger type from workflow if not specified',
      'Workflows without a webhook/form/chat trigger need method=direct or method=pinned',
      'method=prepare first, then method=pinned with the pinData you built from it',
      'For chat triggers, message is required',
      'HTTP trigger types require the workflow to be ACTIVE'
    ]
  },
  full: {
    description: `Run an n8n workflow, either over HTTP through its own trigger or through n8n's instance-level MCP server.

**Methods (\`method\` parameter):**

| method | backend | What it does |
|---|---|---|
| \`auto\` (default) | Public API | Detects a webhook/form/chat trigger and triggers it over HTTP. Without such a trigger it reports that the workflow cannot be triggered externally and names the official methods. It never runs anything through n8n's MCP server. |
| \`trigger\` | Public API | The same HTTP path, requested explicitly. Detection, the trigger types below and the error when no trigger exists are identical to \`auto\`. |
| \`prepare\` | n8n MCP server | Read-only: lists the nodes that need pinned data and the schemas n8n can generate for them. Build \`pinData\` from this. |
| \`pinned\` | n8n MCP server | Runs the workflow with \`pinData\` standing in for trigger, credentialed and HTTP Request nodes, and waits for the run to finish. Every other node still executes for real. |
| \`direct\` | n8n MCP server | Starts a run with optional \`inputs\` and returns as soon as it has started. Nothing is pinned — every node runs. |

**Trigger types (HTTP path):**
- **webhook**: HTTP-based triggers (GET/POST/PUT/DELETE)
- **form**: Form submission triggers
- **chat**: AI chat triggers with conversation support

n8n's public API does not support direct workflow execution, which is why \`prepare\`/\`pinned\`/\`direct\` go through n8n's own MCP server instead. Those three need \`N8N_MCP_ACCESS_TOKEN\` (n8n 2.34+).

**Consent: "Available in MCP".** n8n refuses MCP calls for a workflow whose "Available in MCP" setting is off, and this tool returns \`WORKFLOW_NOT_EXPOSED\` rather than changing it. Re-run with \`exposeToMcp: true\` to enable it — a visible, persistent setting on the workflow, so confirm with the user first. This flow only ever turns the setting on - disabling it again is a deliberate \`updateSettings\` write (\`availableInMCP: false\`) or a change in the n8n UI. A response that enabled it carries \`exposedToMcp: true\`. In a per-request (multi-tenant or header-driven) deployment, every method except a plain \`prepare\` (the HTTP trigger path, the \`pinned\`/\`direct\` trigger lookup and the \`exposeToMcp\` write all read or write through the Public API) needs the Public API key (\`x-n8n-key\`) for the same instance as \`x-n8n-url\` — without it the call returns \`NOT_CONFIGURED\` rather than acting against a different instance.

**Both run methods can cause real side effects.** \`direct\` runs every node, so any node that calls an external service calls it for real. \`pinned\` pins only trigger nodes, nodes with credentials and HTTP Request nodes; everything else — Code, Set, If, and credential-free I/O such as Execute Command or file read/write — executes normally. Treat both as live runs and confirm with the user before running a workflow that writes anywhere.

**executionMode: production.** \`method: direct\` runs as a manual execution unless you explicitly pass \`executionMode: 'production'\`. That changes the execution context, not whether the run has side effects: a production run uses the production execution path and shows up as one in n8n's execution list. It is never chosen for you.

**Typical sequence for a workflow with no external trigger:**
1. \`{workflowId, method: 'prepare'}\` — see which nodes need pinned data.
2. Build sample items per node name (\`{"Webhook": [{"json": {...}}]}\`).
3. \`{workflowId, method: 'pinned', pinData}\` — run it and read the result.

Every response states \`method\` and \`backend\` ('public-api' or 'official-mcp').`,
    parameters: {
      workflowId: {
        type: 'string',
        required: true,
        description: 'Workflow ID to execute ("id" is accepted as an alias)'
      },
      method: {
        type: 'string',
        required: false,
        enum: ['auto', 'trigger', 'prepare', 'pinned', 'direct'],
        description: 'How to run the workflow (default: auto). See the methods table above.'
      },
      triggerType: {
        type: 'string',
        required: false,
        enum: ['webhook', 'form', 'chat'],
        description: 'Trigger type. Auto-detected if not specified. Workflow must have matching trigger node.'
      },
      httpMethod: {
        type: 'string',
        required: false,
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'For webhook: HTTP method (default: from workflow config or POST)'
      },
      webhookPath: {
        type: 'string',
        required: false,
        description: 'For webhook: override the webhook path'
      },
      message: {
        type: 'string',
        required: false,
        description: 'For chat: message to send (required for chat triggers)'
      },
      sessionId: {
        type: 'string',
        required: false,
        description: 'For chat: session ID for conversation continuity'
      },
      data: {
        type: 'object',
        required: false,
        description: 'Input data/payload for webhook or form fields'
      },
      headers: {
        type: 'object',
        required: false,
        description: 'Custom HTTP headers'
      },
      timeout: {
        type: 'number',
        required: false,
        description: 'Timeout in ms (default: 120000). HTTP trigger path only (method auto/trigger) — the official methods (prepare/pinned/direct) use timeoutMs instead.'
      },
      waitForResponse: {
        type: 'boolean',
        required: false,
        description: 'Wait for workflow completion (default: true)'
      },
      pinData: {
        type: 'object',
        required: false,
        description: 'For method=pinned (required, non-empty): pinned trigger data keyed by node name. Each value is an array of ITEMS, and every item must be wrapped as { "json": { ... } } - e.g. {"Webhook": [{"json": {"id": "123"}}]}, never a flat object. Build it from method=prepare.'
      },
      triggerNodeName: {
        type: 'string',
        required: false,
        description: 'For method=pinned/direct: which trigger node to start from. Defaults to the detected trigger node; n8n requires it whenever inputs are given.'
      },
      executionMode: {
        type: 'string',
        required: false,
        enum: ['manual', 'production'],
        description: 'For method=direct: manual (default) or production. Production runs have real side effects and are never chosen implicitly.'
      },
      exposeToMcp: {
        type: 'boolean',
        required: false,
        description: 'For the official methods: enable the workflow\'s persistent "Available in MCP" setting when n8n refuses the call. Confirm with the user first.'
      },
      timeoutMs: {
        type: 'integer',
        required: false,
        description: 'Client-side deadline for the official call, 5000-600000 (default: 30000 for prepare, 300000 for pinned/direct)'
      }
    },
    returns: `Execution response including:
- success: boolean
- method: which method ran ('trigger', 'prepare', 'pinned', 'direct')
- backend: 'public-api' or 'official-mcp'
- data: workflow output data (or the official tool's payload)
- executionId: for tracking/debugging
- triggerType: detected or specified trigger type (HTTP path)
- metadata: timing and request details
- exposedToMcp: true when the call enabled "Available in MCP" on the workflow`,
    examples: [
      'n8n_test_workflow({workflowId: "123"}) - Auto-detect and trigger',
      'n8n_test_workflow({workflowId: "123", triggerType: "webhook", data: {name: "John"}}) - Webhook with data',
      'n8n_test_workflow({workflowId: "123", triggerType: "chat", message: "Hello AI"}) - Chat trigger',
      'n8n_test_workflow({workflowId: "123", triggerType: "form", data: {email: "test@example.com"}}) - Form submission',
      'n8n_test_workflow({workflowId: "123", method: "prepare"}) - Which nodes need pinned data',
      'n8n_test_workflow({workflowId: "123", method: "pinned", pinData: {Webhook: [{json: {name: "John"}}]}}) - Run with pinned trigger data',
      'n8n_test_workflow({workflowId: "123", method: "direct", message: "Hello"}) - Start a manual run through n8n\'s MCP server',
      'n8n_test_workflow({workflowId: "123", method: "prepare", exposeToMcp: true}) - Enable "Available in MCP" first (confirm with the user)'
    ],
    useCases: [
      'Test workflows during development',
      'Trigger AI chat workflows with messages',
      'Submit form data to form-triggered workflows',
      'Integrate n8n workflows with external systems via webhooks',
      'Run a workflow that has no webhook/form/chat trigger (schedule, manual, sub-workflow)',
      'Exercise a workflow with pinned trigger data instead of a live request'
    ],
    performance: `Performance varies based on workflow complexity and waitForResponse setting:
- Webhook: Immediate trigger, depends on workflow
- Form: Immediate trigger, depends on workflow
- Chat: May have additional AI processing time`,
    errorHandling: `**Error Response with Execution Guidance**

When execution fails, the response includes guidance for debugging:

**With Execution ID** (workflow started but failed):
- Use n8n_executions({action: 'get', id: executionId, mode: 'preview'}) to investigate

**Without Execution ID** (workflow didn't start):
- Use n8n_executions({action: 'list', workflowId: 'wf_id'}) to find recent executions

**Common Errors:**
- "Workflow not found" - Check workflow ID exists
- "Workflow not active" - Activate workflow (HTTP trigger path only; pinned/direct run inactive workflows)
- "Workflow cannot be triggered externally" - Workflow has no webhook/form/chat trigger; use method=direct or method=pinned
- WORKFLOW_NOT_EXPOSED - The workflow's "Available in MCP" setting is off; re-run with exposeToMcp: true after confirming with the user
- EXECUTION_FAILED - method=pinned started the run and it ended in error/crashed/canceled; the executionId is on the response
- OFFICIAL_MCP_TOOL_UNAVAILABLE - This n8n version does not expose the tool (the message names the minimum version)
- NOT_CONFIGURED - The official methods need N8N_MCP_ACCESS_TOKEN
- "Chat message required" - Provide message parameter for chat triggers
- "SSRF protection" - URL validation failed`,
    bestPractices: [
      'Let auto-detection choose the trigger type when possible',
      'Ensure workflow has a webhook, form, or chat trigger before testing',
      'For chat workflows, provide sessionId for multi-turn conversations',
      'Use mode="preview" with n8n_executions for efficient debugging',
      'Test with small data payloads first',
      'Activate workflows before testing (use n8n_update_partial_workflow with activateWorkflow)',
      'Run method=prepare before method=pinned so pinData matches the nodes n8n expects',
      'Keep method=direct on executionMode manual unless a production run is genuinely wanted',
      'Confirm with the user before passing exposeToMcp: true - it changes a visible workflow setting'
    ],
    pitfalls: [
      'method=auto never runs a workflow through n8n\'s MCP server - it reports the workflow cannot be triggered instead',
      'method=direct returns as soon as the run starts; poll n8n_executions with the executionId for the outcome',
      'executionMode: production runs the workflow for real',
      'All HTTP trigger types require the workflow to be ACTIVE',
      'Workflows without webhook/form/chat triggers cannot be triggered over HTTP - run them with method=pinned or method=direct instead',
      'Chat trigger requires message parameter',
      'Form data must match expected form fields',
      'Webhook method must match node configuration'
    ],
    relatedTools: ['n8n_executions', 'n8n_get_workflow', 'n8n_create_workflow', 'n8n_validate_workflow']
  }
};
