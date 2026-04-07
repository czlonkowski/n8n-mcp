import { ToolDocumentation } from '../types';

export const n8nDeleteWorkflowDoc: ToolDocumentation = {
  name: 'n8n_delete_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Permanently delete a workflow. This action cannot be undone.',
    keyParameters: ['id'],
    example: 'n8n_delete_workflow({id: "workflow_123"})',
    performance: 'Fast (50-150ms)',
    tips: [
      'Action is irreversible',
      'Deletes all execution history',
      'Check workflow first with n8n_get_workflow({mode: "minimal"})'
    ]
  },
  full: {
    description: 'Permanently deletes a workflow from n8n including all associated data, execution history, and settings. This is an irreversible operation that should be used with caution. The workflow must exist and the user must have appropriate permissions.',
    parameters: {
      id: { type: 'string', required: true, description: 'Workflow ID to delete permanently' }
    },
    returns: 'Minimal confirmation (id, name, deleted: true) for token efficiency.',
    examples: [
      'n8n_delete_workflow({id: "abc123"}) - Delete specific workflow',
      'if (confirm) { n8n_delete_workflow({id: wf.id}); } // With confirmation'
    ],
    useCases: [
      'Remove obsolete workflows',
      'Clean up test workflows',
      'Delete failed experiments',
      'Manage workflow limits',
      'Remove duplicates'
    ],
    performance: 'Fast operation - typically 50-150ms. May take longer if workflow has extensive execution history.',
    bestPractices: [
      'Always confirm before deletion',
      'Check workflow with n8n_get_workflow({mode: "minimal"}) first',
      'Consider deactivating instead of deleting',
      'Export workflow before deletion for backup'
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) configured',
      'Cannot be undone - permanent deletion',
      'Deletes all execution history',
      'Active workflows can be deleted',
      'No built-in confirmation'
    ],
    relatedTools: ['n8n_get_workflow', 'n8n_list_workflows', 'n8n_update_partial_workflow', 'n8n_executions']
  }
};