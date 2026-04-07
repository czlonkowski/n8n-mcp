import { ToolDocumentation } from '../types';

export const n8nGetWorkflowDoc: ToolDocumentation = {
  name: 'n8n_get_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Get workflow by ID with different detail levels. Use mode to control response size and content.',
    keyParameters: ['id', 'mode'],
    example: 'n8n_get_workflow({id: "workflow_123", mode: "structure"})',
    performance: 'Fast (50-200ms)',
    tips: [
      'mode="full" (default): Complete workflow with all data',
      'mode="details": Full workflow + execution stats',
      'mode="structure": Just nodes and connections (topology)',
      'mode="minimal": Only id, name, active status, tags'
    ]
  },
  full: {
    description: `**Modes:**
- full (default): Complete workflow including all nodes with parameters, connections, and settings
- details: Full workflow plus execution statistics (success/error counts, last execution time)
- structure: Nodes and connections only - useful for topology analysis
- minimal: Just id, name, active status, and tags - fastest response`,
    parameters: {
      id: { type: 'string', required: true, description: 'Workflow ID to retrieve' },
      mode: { type: 'string', required: false, description: 'Detail level: "full" (default), "details", "structure", "minimal"' }
    },
    returns: `Depends on mode:
- full: Complete workflow object (id, name, active, nodes[], connections{}, settings, createdAt, updatedAt)
- details: Full workflow + executionStats (successCount, errorCount, lastExecution, etc.)
- structure: { nodes: [...], connections: {...} } - topology only
- minimal: { id, name, active, tags, createdAt, updatedAt }`,
    examples: [
      '// Get complete workflow (default)\nn8n_get_workflow({id: "abc123"})',
      '// Get workflow with execution stats\nn8n_get_workflow({id: "abc123", mode: "details"})',
      '// Get just the topology\nn8n_get_workflow({id: "abc123", mode: "structure"})',
      '// Quick metadata check\nn8n_get_workflow({id: "abc123", mode: "minimal"})'
    ],
    useCases: [
      'View and edit workflow (mode=full)',
      'Analyze workflow performance (mode=details)',
      'Clone or compare workflow structure (mode=structure)',
      'List workflows with status (mode=minimal)',
      'Debug workflow issues'
    ],
    performance: `Response times vary by mode:
- minimal: ~20-50ms (smallest response)
- structure: ~30-80ms (nodes + connections only)
- full: ~50-200ms (complete workflow)
- details: ~100-300ms (includes execution queries)`,
    bestPractices: [
      'Use mode="minimal" when listing or checking status',
      'Use mode="structure" for workflow analysis or cloning',
      'Use mode="full" (default) when editing',
      'Use mode="details" for debugging execution issues',
      'Validate workflow after retrieval if planning modifications'
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) configured',
      'mode="details" adds database queries for execution stats',
      'Workflow must exist or returns 404 error',
      'Credentials are referenced by ID but values not included'
    ],
    relatedTools: ['n8n_list_workflows', 'n8n_update_full_workflow', 'n8n_update_partial_workflow', 'n8n_validate_workflow']
  }
};