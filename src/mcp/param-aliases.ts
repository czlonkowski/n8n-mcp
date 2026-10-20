/**
 * Aliases for parameter vocabulary that agents keep sending after a tool was
 * renamed or consolidated. Each map is applied before validation so a caller
 * using the old spelling gets the canonical behaviour instead of an error.
 * The tool schemas and documentation advertise only the canonical values.
 */

import { logger } from '../utils/logger';

/**
 * `get_node` grew out of `get_node_essentials` / `get_node_info`, and prompts
 * written against those tools still send their vocabulary as `mode` or
 * `detail`. Retired values map onto the canonical `mode` + `detail` pair.
 */
const GET_NODE_MODE_ALIASES: Record<string, { mode: string; detail?: string }> = {
  essentials: { mode: 'info', detail: 'standard' },
  minimal: { mode: 'info', detail: 'minimal' },
  standard: { mode: 'info', detail: 'standard' },
  full: { mode: 'info', detail: 'full' },
  operations: { mode: 'info', detail: 'standard' },
  properties: { mode: 'search_properties' },
  search: { mode: 'search_properties' },
};

const GET_NODE_DETAIL_ALIASES: Record<string, string> = {
  essentials: 'standard',
  summary: 'minimal',
  short: 'minimal',
};

export interface GetNodeParams {
  mode?: string;
  detail?: string;
}

/**
 * Resolves retired `mode` / `detail` spellings for `get_node` to canonical
 * values. Unknown and non-string values pass through unchanged so the
 * existing validation still names them in its error. Undefined stays
 * undefined so the handler's own defaults apply.
 */
export function resolveGetNodeAliases(mode?: unknown, detail?: unknown): GetNodeParams {
  const aliased: string[] = [];
  let resolvedMode = mode as string | undefined;
  let resolvedDetail = detail as string | undefined;

  if (typeof resolvedDetail === 'string') {
    const detailAlias = GET_NODE_DETAIL_ALIASES[resolvedDetail.toLowerCase()];
    if (detailAlias) {
      aliased.push(`detail=${resolvedDetail}→${detailAlias}`);
      resolvedDetail = detailAlias;
    }
  }

  if (typeof resolvedMode === 'string') {
    const modeAlias = GET_NODE_MODE_ALIASES[resolvedMode.toLowerCase()];
    if (modeAlias) {
      // A retired mode value is the caller's statement of intent for the
      // detail level too (mode=full meant "everything"), so it wins over a
      // detail value that most clients only send because the schema defaults it.
      const target = modeAlias.detail
        ? `mode=${modeAlias.mode}, detail=${modeAlias.detail}`
        : `mode=${modeAlias.mode}`;
      aliased.push(`mode=${resolvedMode}→${target}`);
      resolvedMode = modeAlias.mode;
      if (modeAlias.detail) resolvedDetail = modeAlias.detail;
    }
  }

  if (aliased.length > 0) {
    logger.debug(`get_node: retired parameter vocabulary aliased (${aliased.join('; ')})`);
  }

  return { mode: resolvedMode, detail: resolvedDetail };
}

/**
 * Suggestions for `n8n_executions` action values seen in telemetry that belong
 * to other tools or to no tool. Returned text is appended to the unknown-action
 * error so the caller can correct itself in one step.
 */
const EXECUTIONS_ACTION_HINTS: Record<string, string> = {
  get_many: "Did you mean action='list'?",
  getmany: "Did you mean action='list'?",
  getall: "Did you mean action='list'?",
  get_all: "Did you mean action='list'?",
  list_executions: "Did you mean action='list'?",
  listexecutions: "Did you mean action='list'?",
  search: "Did you mean action='list'?",
  get_execution: "Did you mean action='get'?",
  getexecution: "Did you mean action='get'?",
  retry: "Retrying an execution is not supported; re-run the workflow with n8n_test_workflow.",
  list_runs: 'Evaluation test runs are managed by n8n_evaluations.',
  get_run: 'Evaluation test runs are managed by n8n_evaluations.',
  getrows: 'Data table rows are managed by n8n_manage_datatable.',
  get_rows: 'Data table rows are managed by n8n_manage_datatable.',
};

export function suggestExecutionsAction(action: string): string | undefined {
  return EXECUTIONS_ACTION_HINTS[action.toLowerCase()];
}

/**
 * Agents send `id` and `workflowId` interchangeably for tools whose only
 * identifier is a workflow id. Returns a copy of the arguments with
 * `workflowId` filled from `id` when the canonical key is absent or blank; a
 * blank `workflowId` that nothing replaces is removed.
 * `id` is not a schema property, so the server's type coercion never sees it
 * and a numeric value has to be accepted here.
 */
export function withWorkflowIdAlias<T extends Record<string, unknown>>(args: T): T {
  const workflowIdMissing = args.workflowId === undefined || args.workflowId === null
    || (typeof args.workflowId === 'string' && args.workflowId.trim() === '');
  if (!workflowIdMissing) {
    // A non-string workflowId is left for validation to reject rather than overwritten.
    return args;
  }
  const id = typeof args.id === 'number' ? String(args.id) : args.id;
  if (typeof id !== 'string' || id.trim() === '') {
    // A blank workflowId with nothing to replace it is dropped so handlers see it as absent.
    return typeof args.workflowId === 'string' ? { ...args, workflowId: undefined } : args;
  }
  return { ...args, workflowId: id };
}

/** True when the value is a string with content once trimmed. */
export function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
