import { ToolDocumentation } from '../types';

export const n8nListWorkflowsDoc: ToolDocumentation = {
  name: 'n8n_list_workflows',
  category: 'workflow_management',
  essentials: {
    description: 'List workflows (minimal metadata only - no nodes/connections). Supports pagination via cursor.',
    keyParameters: ['limit', 'active', 'tags'],
    example: 'n8n_list_workflows({limit: 20, active: true})',
    performance: 'Fast (100-300ms)',
    tips: [
      'Use cursor for pagination',
      'Filter by active status',
      'Tag filtering for organization'
    ]
  },
  full: {
    description: 'Lists workflows from n8n with powerful filtering options. Returns ONLY minimal metadata (id, name, active, dates, tags, nodeCount) - no workflow structure, nodes, or connections. Use n8n_get_workflow to fetch full workflow details.',
    parameters: {
      limit: { type: 'number', description: 'Number of workflows to return (1-100, default: 100)' },
      cursor: { type: 'string', description: 'Pagination cursor from previous response for next page' },
      active: { type: 'boolean', description: 'Filter by active/inactive status' },
      tags: { type: 'array', description: 'Filter by exact tag matches (AND logic)' },
      projectId: { type: 'string', description: 'Filter by project ID (enterprise feature)' },
      excludePinnedData: { type: 'boolean', description: 'Exclude pinned data from response (default: true)' }
    },
    returns: 'Object with: workflows array (minimal fields: id, name, active, createdAt, updatedAt, tags, nodeCount), returned (count in this response), hasMore (boolean), nextCursor (for pagination), and _note (guidance when more data exists)',
    examples: [
      'n8n_list_workflows({limit: 20}) - First 20 workflows',
      'n8n_list_workflows({active: true, tags: ["production"]}) - Active production workflows',
      'n8n_list_workflows({cursor: "abc123", limit: 50}) - Next page of results'
    ],
    useCases: [
      'Build workflow dashboards',
      'Find workflows by status',
      'Organize by tags',
      'Bulk workflow operations',
      'Generate workflow reports'
    ],
    performance: 'Very fast - typically 50-200ms. Returns only minimal metadata without workflow structure.',
    bestPractices: [
      'Always check hasMore flag to determine if pagination is needed',
      'Use cursor from previous response to get next page',
      'The returned count is NOT the total in the system',
      'Iterate with cursor until hasMore is false for complete list'
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) configured',
      'Maximum 100 workflows per request',
      'Server may return fewer than requested limit',
      'returned field is count of current page only, not system total'
    ],
    relatedTools: ['n8n_get_workflow', 'n8n_update_partial_workflow', 'n8n_executions']
  }
};