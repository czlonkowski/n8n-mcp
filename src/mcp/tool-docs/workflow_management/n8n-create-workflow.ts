import { ToolDocumentation } from '../types';

export const n8nCreateWorkflowDoc: ToolDocumentation = {
  name: 'n8n_create_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Create workflow. Requires: name, nodes[], connections{}. Created inactive. Returns workflow with ID.',
    keyParameters: ['name', 'nodes', 'connections'],
    example: 'n8n_create_workflow({name: "My Flow", nodes: [...], connections: {...}})',
    performance: 'Network-dependent',
    tips: [
      'Workflow created inactive',
      'Returns ID for future updates',
      'Validate first with validate_workflow',
      'Auto-sanitization fixes operator structures and missing metadata during creation'
    ]
  },
  full: {
    description: 'Creates a new workflow in n8n with specified nodes and connections. Workflow is created in inactive state. Each node requires: id, name, type, typeVersion, position, and parameters.',
    parameters: {
      name: { type: 'string', required: true, description: 'Workflow name' },
      nodes: { type: 'array', required: true, description: 'Array of nodes with id, name, type, typeVersion, position, parameters' },
      connections: { type: 'object', required: true, description: 'Node connections. Keys are source node names (not IDs)' },
      settings: { type: 'object', description: 'Optional workflow settings (timezone, error handling, etc.). Every key the n8n Public API accepts is forwarded, including availableInMCP, which exposes the workflow to n8n\'s instance-level MCP server.' },
      nodeGroups: { type: 'array', description: 'Optional canvas groups (n8n 2.28+): [{name, nodeIds, description?}]. Members are node IDs from nodes[] and must form a connected run with no trigger among them. Dropped with a warning on n8n older than 2.28.' },
      projectId: { type: 'string', description: 'Optional project to create the workflow in (enterprise feature). Defaults to the personal project.' },
      parentFolderId: { type: 'string', description: 'Optional folder to place the workflow in (n8n 2.32+; rejected with a 400 on older instances). Omit for the project root. Manage folders with n8n_manage_folders.' }
    },
    returns: 'Minimal summary (id, name, active, nodeCount) for token efficiency. Use n8n_get_workflow with mode "structure" to verify current state if needed.',
    examples: [
      `// Basic webhook to Slack workflow
n8n_create_workflow({
  name: "Webhook to Slack",
  nodes: [
    {
      id: "webhook_1",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 1,
      position: [250, 300],
      parameters: {
        httpMethod: "POST",
        path: "slack-notify"
      }
    },
    {
      id: "slack_1",
      name: "Slack",
      type: "n8n-nodes-base.slack",
      typeVersion: 1,
      position: [450, 300],
      parameters: {
        resource: "message",
        operation: "post",
        channel: "#general",
        text: "={{$json.message}}"
      }
    }
  ],
  connections: {
    "Webhook": {
      "main": [[{node: "Slack", type: "main", index: 0}]]
    }
  }
})`,
      `// Workflow with settings and error handling
n8n_create_workflow({
  name: "Data Processing",
  nodes: [...],
  connections: {...},
  settings: {
    timezone: "America/New_York",
    errorWorkflow: "error_handler_workflow_id",
    saveDataSuccessExecution: "all",
    saveDataErrorExecution: "all",
    availableInMCP: true  // expose to n8n's instance-level MCP server
  }
})`
    ],
    useCases: [
      'Deploy validated workflows',
      'Automate workflow creation',
      'Clone workflow structures',
      'Template deployment'
    ],
    performance: 'Network-dependent - Typically 100-500ms depending on workflow size',
    bestPractices: [
      'Validate with validate_workflow first',
      'Use unique node IDs',
      'Position nodes for readability',
      'Test with n8n_test_workflow'
    ],
    pitfalls: [
      '**REQUIRES N8N_API_URL and N8N_API_KEY environment variables** - tool unavailable without n8n API access',
      'Workflows created in INACTIVE state - must activate separately',
      'Node IDs must be unique within workflow',
      'Credentials must be configured separately in n8n',
      'Node type names must include package prefix (e.g., "n8n-nodes-base.slack")',
      '**Auto-sanitization runs on creation**: All nodes sanitized before workflow created (operator structures fixed, missing metadata added)',
      '**Auto-sanitization cannot prevent all failures**: Broken connections or invalid node configurations may still cause creation to fail'
    ],
    relatedTools: ['validate_workflow', 'n8n_update_partial_workflow', 'n8n_test_workflow']
  }
};