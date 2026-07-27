import { ToolDocumentation } from '../types';

export const n8nEvaluationsDoc: ToolDocumentation = {
  name: 'n8n_evaluations',
  category: 'workflow_management',
  essentials: {
    description: 'Run and read evaluation test runs for a workflow: trigger a run, cancel one, list runs, get a run with aggregated metrics, or fetch per-case results. Reading requires n8n >= 2.30; run and cancel require n8n >= 2.32.',
    keyParameters: ['action', 'workflowId', 'runId', 'status'],
    example: 'n8n_evaluations({action: "list_runs", workflowId: "abc123", status: "completed"})',
    performance: 'Fast (50-200ms); list_cases payloads can be large - paginate',
    tips: [
      'action="run": trigger a run - returns immediately, then poll get_run until the status is terminal',
      'action="cancel": stop a run that is still new or running',
      'action="list_runs": runs for a workflow, filterable by status, newest first',
      'action="get_run": one run with aggregated metrics and final result',
      'action="list_cases": per-case inputs/outputs/metrics - default limit 20, paginate rather than raising it',
      'Requires an API key created on n8n 2.30+ for reads and 2.32+ for run/cancel (older keys lack the scopes - re-create the key)'
    ]
  },
  full: {
    description: `**Actions:**
- run: Trigger an evaluation test run for a workflow; returns { id, status, createdAt } once the run is persisted, before any case executes
- cancel: Stop a run that is still new or running; returns { id, status: "cancelled" } once the cancellation is accepted
- list_runs: List evaluation test runs for a workflow (paginated, status filter, newest first)
- get_run: Retrieve a single test run with aggregated metrics, final result, and case count
- list_cases: Retrieve per-case results of a run - inputs, outputs, metrics, and the executionId of each case

**Prerequisites:**
- n8n 2.30.0 or later for the read actions (the evaluation Public API shipped in 2.30)
- n8n 2.32.0 or later for run and cancel (the trigger/cancel routes shipped in 2.32)
- API key with testRun scopes - reads need testRun:read/testRun:list (2.30+), run needs testRun:create and cancel needs testRun:cancel (2.32+). Keys created before those releases lack the scopes and must be re-created
- The key's owner also needs the workflow:execute project scope for run and cancel
- The workflow must contain a configured evaluation trigger with a dataset; without one, run returns 409

**Running and polling:**
- run starts the cases asynchronously - the response only confirms the run was created
- Poll get_run with the returned id until status is completed, error, or cancelled
- cancel is accepted with the run still winding down; confirm with get_run that it reached "cancelled"

**Reading results:**
- Run metrics are a flat map of metric name to number/boolean (aggregates across cases)
- finalResult is success/error/warning once a run completes
- Each case links to its underlying execution via executionId - use n8n_executions with that id to inspect the full execution
- Compare metrics across runs of the same workflow to track prompt/model regressions`,
    parameters: {
      action: { type: 'string', required: true, description: 'Operation: "run", "cancel", "list_runs", "get_run", or "list_cases"' },
      workflowId: { type: 'string', required: true, description: 'Workflow ID the test runs belong to' },
      runId: { type: 'string', required: false, description: 'Test run ID (required for get_run, list_cases, and cancel)' },
      status: { type: 'string', required: false, description: 'For list_runs: filter by "new", "running", "completed", "error", or "cancelled"' },
      limit: { type: 'number', required: false, description: 'Results per page, 1-250. Defaults: 100 (list_runs), 20 (list_cases)' },
      cursor: { type: 'string', required: false, description: 'Pagination cursor from a previous response' }
    },
    returns: `run: { id, status, createdAt }. cancel: { id, status: "cancelled" }. list_runs: { testRuns, returned, nextCursor, hasMore }. get_run: run object { id, status, runAt, completedAt, metrics, errorCode, errorDetails, finalResult, testCaseCount, createdAt, updatedAt }. list_cases: { testCases, returned, nextCursor, hasMore } where each case has { id, status, runAt, completedAt, metrics, errorCode, errorDetails, inputs, outputs, executionId }.`,
    examples: [
      'n8n_evaluations({action: "run", workflowId: "abc123"}) - trigger a run, then poll get_run with the returned id',
      'n8n_evaluations({action: "cancel", workflowId: "abc123", runId: "run456"}) - stop a run in progress',
      'n8n_evaluations({action: "list_runs", workflowId: "abc123"}) - all runs, newest first',
      'n8n_evaluations({action: "list_runs", workflowId: "abc123", status: "completed", limit: 10}) - recent completed runs',
      'n8n_evaluations({action: "get_run", workflowId: "abc123", runId: "run456"}) - aggregated metrics for one run',
      'n8n_evaluations({action: "list_cases", workflowId: "abc123", runId: "run456"}) - first 20 case results'
    ],
    useCases: [
      'Trigger an evaluation run after changing a prompt and poll it to completion',
      'Cancel a long-running evaluation that was started by mistake',
      'Compare metric aggregates across runs to catch prompt or model regressions',
      'Pull per-case failures and inspect the underlying executions via n8n_executions',
      'Export evaluation results to an external dashboard'
    ],
    performance: 'Each call is a single n8n API request. run returns before any case executes, so budget polling time separately. list_cases responses carry raw per-case inputs/outputs - keep limit small and paginate.',
    errorHandling: 'A 402 means the plan\'s evaluation quota is used up - it caps how many workflows may have test runs, and re-running a workflow that already has runs is always allowed. A 403 means the API key lacks the scope for the action (testRun:create and testRun:cancel only exist on keys created on n8n 2.32+), evaluations are not licensed on the plan, or the key\'s owner lacks access to the workflow. A 409 on run means the workflow has no evaluation trigger; a 409 on cancel means the run already finished. A 404 (or a 405 on run) can mean the instance predates the required version, the workflow id is wrong, or the runId belongs to a different workflow - the tool checks the instance version to disambiguate.',
    bestPractices: [
      'Validate the workflow has an evaluation trigger before calling run - a missing trigger is a 409, not a silent no-op',
      'Poll get_run rather than assuming run completed; cases execute asynchronously',
      'Filter list_runs by status="completed" when you only need finished results',
      'Keep list_cases limit at the default 20 and paginate; raise it only when cases are known to be small',
      'Store run ids, not case payloads, when tracking results over time'
    ],
    pitfalls: [
      'API keys created before the relevant n8n release silently lack the testRun scopes - a 403 means re-create the key, not a bug',
      'run and cancel need n8n 2.32+; on 2.30/2.31 the routes do not exist and n8n answers 405 (run) or 404 (cancel)',
      'run does not wait for the cases - a successful response only means the run was created',
      'Evaluations are license/quota-gated in n8n - an unlicensed instance returns 403 and an exhausted quota returns 402'
    ],
    relatedTools: ['n8n_executions', 'n8n_test_workflow', 'n8n_workflow_versions']
  }
};
