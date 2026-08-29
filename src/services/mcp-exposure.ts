/**
 * The "Available in MCP" consent flow shared by every workflow-scoped call we
 * route through n8n's instance-level MCP server.
 *
 * n8n refuses any workflow-scoped MCP call for a workflow whose
 * "Available in MCP" setting is off. That refusal is a deliberate, visible
 * per-workflow switch, so this module never flips it silently: the caller has
 * to pass `exposeToMcp: true`, and the change is reported back through
 * `exposedToMcp: true` on the response.
 */
import { N8nApiClient } from './n8n-api-client';
import { McpToolResponse, Workflow } from '../types/n8n-api';
import { getDisabledTools, isOperationDisabled } from '../mcp/tool-policy';
import { InstanceContext } from '../types/instance-context';
import { logger } from '../utils/logger';

/**
 * The start of n8n's refusal text (n8n 2.36.7, live-verified 2026-08-28):
 * "Workflow is not available in MCP. Enable MCP access from the workflow card
 * in the workflows list, or from the workflow settings."
 *
 * Matched as a PREFIX, never as a loose substring: an execution result or a
 * validation message that happens to contain the phrase must not be mistaken
 * for the refusal and trigger a workflow write.
 */
export const NOT_EXPOSED_PREFIX = 'Workflow is not available in MCP';

/** Fixed consent hint returned with every WORKFLOW_NOT_EXPOSED refusal. */
export const WORKFLOW_NOT_EXPOSED_HINT =
  'This workflow is not exposed to n8n\'s MCP server ("Available in MCP" in workflow settings). ' +
  'Re-run with exposeToMcp: true to enable it — this is a visible, persistent setting on the workflow; ' +
  'confirm with the user first.';

/**
 * Fixed hint returned when a request names an n8n instance via context but
 * cannot be matched to it on the Public API side (url without key).
 */
export const PUBLIC_API_CONTEXT_HINT =
  'This request names an n8n instance (x-n8n-url) without its Public API key (x-n8n-key). ' +
  'Enabling "Available in MCP", the pinned/direct trigger lookup and the HTTP trigger path ' +
  'all need the Public API credentials of the same instance — add x-n8n-key alongside x-n8n-url.';

/**
 * Whether the Public API client resolved for this request (`getN8nApiClient`)
 * addresses the same n8n instance as the official-MCP client
 * (`resolveOfficialMcpConfig`).
 *
 * `getN8nApiClient` only builds an instance-specific client when both
 * `n8nApiUrl` and `n8nApiKey` are set on the context; otherwise it falls back
 * to the environment's Public API client. `resolveOfficialMcpConfig` accepts
 * `n8nApiUrl` with either `n8nApiKey` or `n8nMcpAccessToken`. A context that
 * names a url with a token but no key is therefore official-MCP-authoritative
 * while the Public API client silently falls back to the operator's own
 * instance. Returns false whenever the context names a url without a key
 * (with or without a token): that is the only shape in which the Public API
 * client cannot address the instance the context names. True for no context,
 * key-only and url + key.
 */
export function publicApiMatchesContext(context?: InstanceContext | null): boolean {
  const hasUrl = typeof context?.n8nApiUrl === 'string' && context.n8nApiUrl.length > 0;
  const hasKey = typeof context?.n8nApiKey === 'string' && context.n8nApiKey.length > 0;
  return !(hasUrl && !hasKey);
}

/**
 * The tool whose policy governs the consent write. Enabling "Available in MCP"
 * is a workflow update, so a deployment that disabled workflow updates has
 * disabled this too.
 */
const CONSENT_WRITE_TOOL = 'n8n_update_partial_workflow';

/** The virtual operation name that gates the consent write per calling tool. */
const EXPOSE_OPERATION = 'expose';

/** Candidate error strings inside an official error payload. */
function errorTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [record.error, record.message].filter((text): text is string => typeof text === 'string');
  }
  return [];
}

/**
 * Whether an official-call FAILURE envelope carries n8n's not-exposed refusal.
 *
 * Only failures are considered: `callOfficialTool` maps every refusal shape
 * n8n uses — plain text with `isError`, `{ error }` with `isError`, and a root
 * `{ success: false, …, error }` result without `isError` — to a failure
 * envelope, so a success can never be a refusal.
 */
export function isNotExposedResponse(response: McpToolResponse): boolean {
  if (response.success !== false) return false;
  const candidates = [
    ...errorTexts(response.officialError),
    ...(typeof response.error === 'string' ? [response.error] : []),
  ];
  // trimStart only: leading whitespace from a wrapped payload must not defeat
  // the check, but the prefix rule itself is unchanged.
  return candidates.some(text => text.trimStart().startsWith(NOT_EXPOSED_PREFIX));
}

/**
 * Turn on `settings.availableInMCP` for one workflow, with the smallest write
 * that the n8n Public API allows: read the workflow, merge the one setting,
 * write it back. `cleanWorkflowForUpdate` (inside `updateWorkflow`) strips the
 * read-only fields the GET echoed and keeps `availableInMCP`.
 *
 * The read-modify-write window is the one every n8n-mcp workflow write has:
 * n8n's PUT takes the whole workflow and the Public API offers no conditional
 * write. Side effects are those of any workflow update — n8n may normalise
 * webhook ids, and inherited canvas groups may be repaired or dropped. Those
 * non-fatal adjustments are returned as `warnings` so the caller can surface
 * them alongside the result.
 */
export async function enableWorkflowMcpExposure(
  apiClient: N8nApiClient,
  workflowId: string
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const current = await apiClient.getWorkflow(workflowId);
  const settings = {
    ...((current.settings as Record<string, unknown> | undefined) ?? {}),
    availableInMCP: true,
  };
  await apiClient.updateWorkflow(
    workflowId,
    { ...current, settings } as unknown as Partial<Workflow>,
    { onWarning: message => warnings.push(message) }
  );
  logger.info('Enabled MCP exposure for workflow', { workflowId });
  return { warnings };
}

export interface ExposureOptions {
  apiClient: N8nApiClient | null;
  workflowId: string;
  exposeToMcp?: boolean;
  action: string;
  toolName: 'n8n_test_workflow' | 'n8n_workflow_versions';
  /**
   * The instance context this call was made under, for the
   * `publicApiMatchesContext` check. Absent (or `null`) is treated as
   * matching — there is no instance-scoped mismatch without a context.
   */
  context?: InstanceContext | null;
}

/**
 * Why server policy refuses this consent write, or `null` when it allows it.
 */
function consentWriteRefusal(toolName: ExposureOptions['toolName']): string | null {
  if (getDisabledTools().has(CONSENT_WRITE_TOOL)) {
    return `enabling it is a workflow update and '${CONSENT_WRITE_TOOL}' is disabled by server policy`;
  }
  if (isOperationDisabled(toolName, EXPOSE_OPERATION)) {
    return `the '${EXPOSE_OPERATION}' operation of '${toolName}' is disabled by server policy`;
  }
  return null;
}

function notExposedFailure(opts: ExposureOptions, response: McpToolResponse): McpToolResponse {
  return {
    success: false,
    action: opts.action,
    code: 'WORKFLOW_NOT_EXPOSED',
    error: 'n8n\'s MCP server refused this workflow: it is not available in MCP',
    hint: WORKFLOW_NOT_EXPOSED_HINT,
    officialError: response.officialError,
  };
}

/**
 * Runs `call`; on n8n's not-exposed refusal returns `WORKFLOW_NOT_EXPOSED`
 * unless the caller passed `exposeToMcp: true`, in which case it enables
 * "Available in MCP" (subject to server policy), retries exactly once and
 * marks the result `exposedToMcp: true`.
 *
 * The envelope is returned undecorated — the calling handler adds `method`,
 * `source` and `backend`.
 */
export async function withMcpExposure(
  opts: ExposureOptions,
  call: () => Promise<McpToolResponse>
): Promise<McpToolResponse> {
  const first = await call();
  if (!isNotExposedResponse(first)) return first;

  if (opts.exposeToMcp !== true) return notExposedFailure(opts, first);

  // Refuse before the policy gate and before any write: a context that names
  // an instance via url but has no Public API key for it is authoritative
  // for the official call, but getN8nApiClient falls back to the operator's
  // environment client for `opts.apiClient` — writing through it would touch
  // a different instance's workflow.
  if (!publicApiMatchesContext(opts.context)) {
    return {
      success: false,
      action: opts.action,
      code: 'NOT_CONFIGURED',
      error: PUBLIC_API_CONTEXT_HINT,
    };
  }

  const refusal = consentWriteRefusal(opts.toolName);
  if (refusal) {
    return {
      success: false,
      action: opts.action,
      code: 'OPERATION_DISABLED',
      error: `Cannot enable "Available in MCP" on workflow ${opts.workflowId}: ${refusal}.`,
      hint: 'Enable the workflow\'s "Available in MCP" setting in the n8n UI, then re-run without exposeToMcp.',
    };
  }

  if (!opts.apiClient) {
    return {
      success: false,
      action: opts.action,
      code: 'NOT_CONFIGURED',
      error: 'Enabling MCP exposure needs the n8n Public API (N8N_API_URL and N8N_API_KEY)',
    };
  }

  let warnings: string[];
  try {
    ({ warnings } = await enableWorkflowMcpExposure(opts.apiClient, opts.workflowId));
  } catch (err) {
    return {
      success: false,
      action: opts.action,
      code: 'EXPOSE_FAILED',
      error: `Could not enable "Available in MCP" on workflow ${opts.workflowId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const second = await call();
  const merged = [...warnings, ...(second.warnings ?? [])];
  const extra = {
    exposedToMcp: true,
    ...(merged.length > 0 ? { warnings: merged } : {}),
  };

  if (isNotExposedResponse(second)) {
    return {
      ...notExposedFailure(opts, second),
      ...extra,
      hint: 'The setting was written, but n8n still refused the workflow. Check the workflow in the n8n UI (workflow settings → Available in MCP) and the instance-level MCP access list.',
    };
  }

  return { ...second, ...extra };
}
