import { ToolDocumentation } from '../types';

export const n8nEvaluationsDoc: ToolDocumentation = {
  name: 'n8n_evaluations',
  category: 'workflow_management',
  essentials: {
    description: 'Read evaluation test runs for a workflow: list runs, get a run with aggregated metrics, or fetch per-case results. Read-only; requires n8n >= 2.30.',
    keyParameters: ['action', 'workflowId', 'runId', 'status'],
    example: 'n8n_evaluations({action: "list_runs", workflowId: "abc123", status: "completed"})',
    performance: 'Fast (50-200ms); list_cases payloads can be large - paginate',
    tips: [
      'action="list_runs": runs for a workflow, filterable by status, newest first',
      'action="get_run": one run with aggregated metrics and final result',
      'action="list_cases": per-case inputs/outputs/metrics - default limit 20, paginate rather than raising it',
      'Requires an API key created on n8n 2.30+ (older keys lack testRun scopes - re-create the key)',
      'Runs exist only for workflows with an evaluation trigger that have been executed'
    ]
  },
  full: {
    description: `**Actions:**
- list_runs: List evaluation test runs for a workflow (paginated, status filter, newest first)
- get_run: Retrieve a single test run with aggregated metrics, final result, and case count
- list_cases: Retrieve per-case results of a run - inputs, outputs, metrics, and the executionId of each case

**Prerequisites:**
- n8n 2.30.0 or later (the evaluation Public API shipped in 2.30)
- API key with testRun scopes - keys created before 2.30 do not have them and must be re-created
- Evaluation runs exist only for workflows with a configured evaluation trigger that have been run from the n8n editor (triggering runs via the public API is not yet supported by n8n)

**Reading results:**
- Run metrics are a flat map of metric name to number/boolean (aggregates across cases)
- finalResult is success/error/warning once a run completes
- Each case links to its underlying execution via executionId - use n8n_executions with that id to inspect the full execution
- Compare metrics across runs of the same workflow to track prompt/model regressions`,
    parameters: {
      action: { type: 'string', required: true, description: 'Operation: "list_runs", "get_run", or "list_cases"' },
      workflowId: { type: 'string', required: true, description: 'Workflow ID the test runs belong to' },
      runId: { type: 'string', required: false, description: 'Test run ID (required for get_run and list_cases)' },
      status: { type: 'string', required: false, description: 'For list_runs: filter by "new", "running", "completed", "error", or "cancelled"' },
      limit: { type: 'number', required: false, description: 'Results per page, 1-250. Defaults: 100 (list_runs), 20 (list_cases)' },
      cursor: { type: 'string', required: false, description: 'Pagination cursor from a previous response' }
    },
    returns: `list_runs: { testRuns, returned, nextCursor, hasMore }. get_run: run object { id, status, runAt, completedAt, metrics, errorCode, errorDetails, finalResult, testCaseCount, createdAt, updatedAt }. list_cases: { testCases, returned, nextCursor, hasMore } where each case has { id, status, runAt, completedAt, metrics, errorCode, errorDetails, inputs, outputs, executionId }.`,
    examples: [
      'n8n_evaluations({action: "list_runs", workflowId: "abc123"}) - all runs, newest first',
      'n8n_evaluations({action: "list_runs", workflowId: "abc123", status: "completed", limit: 10}) - recent completed runs',
      'n8n_evaluations({action: "get_run", workflowId: "abc123", runId: "run456"}) - aggregated metrics for one run',
      'n8n_evaluations({action: "list_cases", workflowId: "abc123", runId: "run456"}) - first 20 case results',
      'n8n_evaluations({action: "list_cases", workflowId: "abc123", runId: "run456", cursor: "..."}) - next page'
    ],
    useCases: [
      'Poll a run started in the n8n editor and report when it completes',
      'Compare metric aggregates across runs to catch prompt or model regressions',
      'Pull per-case failures and inspect the underlying executions via n8n_executions',
      'Export evaluation results to an external dashboard'
    ],
    performance: 'Each call is a single n8n API request. list_cases responses carry raw per-case inputs/outputs - keep limit small and paginate.',
    errorHandling: 'A 403 means the API key lacks testRun scopes (keys created before n8n 2.30 must be re-created), evaluations are not licensed on the plan, or the key\'s owner lacks access to the workflow. A 404 can mean the instance predates 2.30, the workflow id is wrong, or the runId belongs to a different workflow - the tool checks the instance version to disambiguate.',
    bestPractices: [
      'Filter list_runs by status="completed" when you only need finished results',
      'Keep list_cases limit at the default 20 and paginate; raise it only when cases are known to be small',
      'Store run ids, not case payloads, when tracking results over time'
    ],
    pitfalls: [
      'API keys created before n8n 2.30 silently lack testRun scopes - a 403 means re-create the key, not a bug',
      'A 404 can mean the instance predates 2.30, the workflow id is wrong, or the runId belongs to a different workflow',
      'Evaluations are license/quota-gated in n8n - instances without the feature simply have no runs'
    ],
    relatedTools: ['n8n_executions', 'n8n_test_workflow', 'n8n_workflow_versions']
  }
};
