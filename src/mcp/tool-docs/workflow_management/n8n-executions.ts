import { ToolDocumentation } from '../types';

export const n8nExecutionsDoc: ToolDocumentation = {
  name: 'n8n_executions',
  category: 'workflow_management',
  essentials: {
    description: 'Manage workflow executions: get details, list, or delete. Unified tool for all execution operations.',
    keyParameters: ['action', 'id', 'workflowId', 'status', 'mode'],
    example: 'n8n_executions({action: "get", id: "exec_456", mode: "error"})',
    performance: 'Fast (50-200ms)',
    tips: [
      'action="get": Get execution details by ID',
      'action="list": List executions with filters',
      'action="delete": Delete execution record',
      'Use mode="error" for efficient failure debugging (80-90% token savings)',
      'Use mode parameter for action=get to control detail level'
    ]
  },
  full: {
    description: `**Actions:**
- get: Retrieve execution details by ID with configurable detail level
- list: List executions with filtering and pagination
- delete: Remove an execution record from history

**Detail Modes for action="get":**
- preview: Structure only, no data
- summary: 2 items per node (default)
- filtered: Custom items limit, optionally filter by node names
- full: All execution data (can be very large)
- error: Optimized for debugging failures - extracts error info, upstream context, and AI suggestions

**Error Mode Features:**
- Extracts error message, type, and node configuration
- Samples input data from upstream node (configurable limit)
- Shows execution path leading to error
- Provides AI-friendly fix suggestions based on error patterns
- Token-efficient (80-90% smaller than full mode)`,
    parameters: {
      action: { type: 'string', required: true, description: 'Operation: "get", "list", or "delete"' },
      id: { type: 'string', required: false, description: 'Execution ID (required for action=get or action=delete)' },
      mode: { type: 'string', required: false, description: 'For action=get: "preview", "summary" (default), "filtered", "full", "error"' },
      nodeNames: { type: 'array', required: false, description: 'For action=get with mode=filtered: Filter to specific nodes by name' },
      itemsLimit: { type: 'number', required: false, description: 'For action=get with mode=filtered: Items per node (0=structure, 2=default, -1=unlimited)' },
      includeInputData: { type: 'boolean', required: false, description: 'For action=get: Include input data in addition to output (default: false)' },
      errorItemsLimit: { type: 'number', required: false, description: 'For action=get with mode=error: Sample items from upstream (default: 2, max: 100)' },
      includeStackTrace: { type: 'boolean', required: false, description: 'For action=get with mode=error: Include full stack trace (default: false, shows truncated)' },
      includeExecutionPath: { type: 'boolean', required: false, description: 'For action=get with mode=error: Include execution path (default: true)' },
      fetchWorkflow: { type: 'boolean', required: false, description: 'For action=get with mode=error: Fetch workflow for accurate upstream detection (default: true)' },
      workflowId: { type: 'string', required: false, description: 'For action=list: Filter by workflow ID' },
      status: { type: 'string', required: false, description: 'For action=list: Filter by status ("success", "error", "waiting")' },
      limit: { type: 'number', required: false, description: 'For action=list: Number of results (1-100, default: 100)' },
      cursor: { type: 'string', required: false, description: 'For action=list: Pagination cursor from previous response' },
      projectId: { type: 'string', required: false, description: 'For action=list: Filter by project ID (enterprise)' },
      includeData: { type: 'boolean', required: false, description: 'For action=list: Include execution data (default: false)' }
    },
    returns: `Depends on action:
- get (error mode): { errorInfo: { primaryError, upstreamContext, executionPath, suggestions }, summary }
- get (other modes): Execution object with data based on mode
- list: { data: [...executions], nextCursor?: string }
- delete: { success: boolean, message: string }`,
    examples: [
      '// Debug a failed execution (recommended for errors)\nn8n_executions({action: "get", id: "exec_456", mode: "error"})',
      '// Debug with more sample data from upstream\nn8n_executions({action: "get", id: "exec_456", mode: "error", errorItemsLimit: 5})',
      '// Debug with full stack trace\nn8n_executions({action: "get", id: "exec_456", mode: "error", includeStackTrace: true})',
      '// Debug without workflow fetch (faster but less accurate)\nn8n_executions({action: "get", id: "exec_456", mode: "error", fetchWorkflow: false})',
      '// List recent executions for a workflow\nn8n_executions({action: "list", workflowId: "abc123", limit: 10})',
      '// List failed executions\nn8n_executions({action: "list", status: "error"})',
      '// Get execution summary\nn8n_executions({action: "get", id: "exec_456"})',
      '// Get full execution data\nn8n_executions({action: "get", id: "exec_456", mode: "full"})',
      '// Get specific nodes from execution\nn8n_executions({action: "get", id: "exec_456", mode: "filtered", nodeNames: ["HTTP Request", "Slack"]})',
      '// Delete an execution\nn8n_executions({action: "delete", id: "exec_456"})'
    ],
    useCases: [
      'Debug workflow failures efficiently (mode=error) - 80-90% token savings',
      'Get AI suggestions for fixing common errors',
      'Analyze input data that caused failure',
      'Debug workflow failures with full data (mode=full)',
      'Monitor workflow health (list with status filter)',
      'Audit execution history',
      'Clean up old execution records',
      'Analyze specific node outputs'
    ],
    performance: `Response times:
- list: 50-150ms depending on filters
- get (preview/summary): 30-100ms
- get (error): 50-200ms (includes optional workflow fetch)
- get (full): 100-500ms+ depending on data size
- delete: 30-80ms`,
    bestPractices: [
      'Use mode="error" for debugging failed executions - 80-90% token savings vs full',
      'Use mode="summary" (default) for quick inspection',
      'Use mode="filtered" with nodeNames for large workflows',
      'Filter by workflowId when listing to reduce results',
      'Use cursor for pagination through large result sets',
      'Set fetchWorkflow=false if you already know the workflow structure',
      'Delete old executions to save storage'
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) configured',
      'mode="full" can return very large responses for complex workflows',
      'mode="error" fetches workflow by default (adds ~50-100ms), disable with fetchWorkflow=false',
      'Execution must exist or returns 404',
      'Delete is permanent - cannot undo'
    ],
    relatedTools: ['n8n_get_workflow', 'n8n_test_workflow', 'n8n_validate_workflow']
  }
};
