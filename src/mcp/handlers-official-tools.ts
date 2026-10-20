/**
 * Handlers for the thin passthrough tools that forward a single call to
 * n8n's instance-level MCP server (not the multi-action `n8n_manage_agents`
 * adapter). Each handler validates its own args locally — before any
 * network call — then hands off to `callOfficialTool`, which resolves the
 * live tool name, forwards the call, and wraps the result in the shared
 * envelope.
 */
import { z } from 'zod';
import { InstanceContext } from '../types/instance-context';
import { McpToolResponse } from '../types/n8n-api';
import { getOfficialMcpClient, notConfiguredResponse, officialFailure, officialErrorText } from './official-mcp-access';
import { OfficialMcpError } from '../services/n8n-official-mcp-client';
import { MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from './agents-action-map';
import { logger } from '../utils/logger';
import { getN8nApiClient } from './handlers-n8n-manager';
import { publicApiMatchesContext, PUBLIC_API_CONTEXT_HINT } from '../services/mcp-exposure';
import { N8nApiError } from '../utils/n8n-errors';

// Strict: a misspelled key (`currentNodeParameter`, `timeOutMs`) is reported
// as INVALID_ARGS naming the key rather than silently dropped.
const exploreSchema = z.object({
  nodeType: z.string().min(1),
  version: z.number(),
  methodName: z.string().min(1),
  methodType: z.enum(['listSearch', 'loadOptions']),
  credentialType: z.string().min(1),
  credentialId: z.string().min(1),
  filter: z.string().optional(),
  paginationToken: z.string().optional(),
  currentNodeParameters: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
}).strict();

const EXPLORE_TOOLS = ['explore_node_resources'];

/**
 * The n8n minor version that first shipped each official tool we route to, used
 * only to make `OFFICIAL_MCP_TOOL_UNAVAILABLE` actionable ("upgrade to X" rather
 * than "not available"). Absent entries fall back to `DEFAULT_MIN_VERSION`, the
 * release that introduced the instance-level MCP server's workflow tools.
 */
export const OFFICIAL_TOOL_MIN_VERSION: Record<string, string> = {
  get_workflow_versions_diff: '2.36',
  get_workflow_history: '2.34',
  get_workflow_version: '2.34',
  restore_workflow_version: '2.34',
  prepare_workflow_pin_data: '2.34',
  test_workflow: '2.34',
  execute_workflow: '2.34',
  add_data_table_column: '2.34',
  delete_data_table_column: '2.34',
  rename_data_table_column: '2.34',
  explore_node_resources: '2.34',
  search_projects: '2.34',
};

const DEFAULT_MIN_VERSION = '2.34';

/**
 * Shared "call one official tool, wrap the result" path for the passthrough
 * tools. `idempotent` says whether the call may be re-sent after a
 * connection-level failure — see `N8nOfficialMcpClient.callTool`.
 */
export async function callOfficialTool(
  context: InstanceContext | undefined,
  toolAliases: string[],
  args: Record<string, unknown>,
  timeoutMs: number,
  label: string,
  idempotent: boolean,
): Promise<McpToolResponse> {
  const client = getOfficialMcpClient(context);
  if (!client) return notConfiguredResponse(context, label) as McpToolResponse;
  try {
    const caps = await client.capabilities();
    if (!caps.reachable) return officialFailure(new OfficialMcpError(caps.error ?? 'OFFICIAL_MCP_TRANSPORT_ERROR', 'n8n MCP server is not reachable'), label) as McpToolResponse;
    const tool = toolAliases.find(t => caps.toolNames.includes(t));
    if (!tool) {
      const minVersion = OFFICIAL_TOOL_MIN_VERSION[toolAliases[0]] ?? DEFAULT_MIN_VERSION;
      return officialFailure(new OfficialMcpError('OFFICIAL_MCP_TOOL_UNAVAILABLE', `This instance does not expose ${toolAliases.join(' / ')} (needs n8n >= ${minVersion})`), label) as McpToolResponse;
    }
    const result = await client.callTool(tool, args, { timeoutMs, idempotent });
    const data = result.json ?? result.text;
    // "Input validation error" is the literal prefix n8n's MCP server puts on
    // an arguments-rejected response (observed on n8n 2.36.7 — see the spike
    // logs under docs/local/official-agent-tools-2026-08-27/). If n8n changes
    // that wording, invalid args stop mapping to INVALID_ARGS and degrade to
    // OFFICIAL_MCP_ERROR; nothing else breaks.
    if (result.text.startsWith('Input validation error')) return { success: false, action: label, code: 'INVALID_ARGS', error: result.text.slice(0, 2000) };
    // Failure shapes across the official tool families: an MCP-level error
    // (`isError`), the agent tools' root `ok: false`, and the version /
    // data-table / execution tools' root `success: false`.
    //
    // `execute_workflow` reports a failed dispatch as `{ executionId, status:
    // 'error', error }` with no `success` field, so it needs its own rule — and
    // that rule is scoped to that one tool: `test_workflow` uses the same
    // `status` field for the outcome of a RUN that started fine
    // (`error | crashed | canceled`). Precedence: tool-level failures are
    // OFFICIAL_MCP_ERROR here; run outcomes belong to the calling handler,
    // which maps them to EXECUTION_FAILED with the executionId.
    //
    // `error` is optional in that shape, so the status alone decides: a failed
    // dispatch that carries no message must not come back as a success.
    const root = data as any;
    const executeDispatchFailed = tool === 'execute_workflow' && root?.status === 'error';
    const isFailure =
      result.isError ||
      root?.ok === false ||
      root?.success === false ||
      executeDispatchFailed;
    if (isFailure) {
      const hasText = typeof root?.message === 'string' || typeof root?.error === 'string';
      const error = executeDispatchFailed && !hasText
        ? 'execute_workflow reported status "error" without an error message'
        : officialErrorText(data, undefined);
      return { success: false, action: label, officialTool: tool, code: 'OFFICIAL_MCP_ERROR', error, officialError: data };
    }
    return { success: true, action: label, officialTool: tool, data, ...(result.truncated ? { truncated: true } : {}) };
  } catch (err) {
    const failure = officialFailure(err, label);
    logger.warn(`${label} failed`, { code: failure.code });
    return failure as McpToolResponse;
  }
}

export async function handleExploreNodeResources(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const parsed = exploreSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, action: 'explore_node_resources', code: 'INVALID_ARGS', error: parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') };
  }
  const { timeoutMs, ...forwarded } = parsed.data;
  // explore_node_resources only reads a node's dynamic option list.
  return callOfficialTool(context, EXPLORE_TOOLS, forwarded, timeoutMs ?? DEFAULT_TIMEOUT_MS, 'explore_node_resources', true);
}

const CATALOG_TOOLS = ['search_projects'];

const catalogSchema = z.object({
  kind: z.enum(['projects', 'tags']),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict();

interface CatalogItem {
  id: string;
  name: string;
  type?: string;
  personal?: boolean;
}

function filterItems(items: CatalogItem[], query?: string, limit?: number): CatalogItem[] {
  const q = query?.trim().toLowerCase();
  const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
  return limit ? filtered.slice(0, limit) : filtered;
}

/**
 * Lists instance-level catalog entries needed as inputs elsewhere (projectId
 * for agents/data tables, tag names for workflow filters). Public API first;
 * `projects` only falls back to the official MCP server (or, when that isn't
 * configured, the caller's own personal project) when the Public API refuses
 * with a licence-shaped error (403/404) — team projects are Enterprise-only.
 * `tags` never falls back: `list_workflow_tags` on the official server would
 * add nothing the Public API doesn't already return.
 */
export async function handleListCatalog(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const parsed = catalogSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, code: 'INVALID_ARGS', error: parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') };
  }
  const { kind, query, limit } = parsed.data;
  const api = getN8nApiClient(context);
  if (!api) return { success: false, code: 'NOT_CONFIGURED', error: 'n8n API not configured. Set N8N_API_URL and N8N_API_KEY.' };

  if (kind === 'tags') {
    try {
      const tags = (await api.listTags({ limit: 250 })).data.map(t => ({ id: String(t.id), name: t.name }));
      return { success: true, kind, backend: 'public-api', data: { items: filterItems(tags, query, limit) } } as McpToolResponse;
    } catch (err) {
      return { success: false, kind, code: 'API_ERROR', error: err instanceof Error ? err.message : String(err) } as McpToolResponse;
    }
  }

  const resolved = await resolveProjectChoices(context);
  if ('failure' in resolved) return { ...resolved.failure, kind } as McpToolResponse;
  const { backend, teamProjectsEnabled, items } = resolved.choices;
  return {
    success: true,
    kind,
    backend,
    data: { teamProjectsEnabled, items: filterItems(items, query, limit) },
  } as McpToolResponse;
}

export interface ProjectChoice {
  id: string;
  name: string;
  type?: string;
  personal?: boolean;
}

export interface ProjectChoices {
  backend: 'public-api' | 'official-mcp';
  teamProjectsEnabled: boolean;
  items: ProjectChoice[];
}

/**
 * Resolve the projects this instance offers, in the order `n8n_list_catalog`
 * uses: the Public API first, then — only on a licence-shaped refusal (403/404)
 * — the official MCP server's `search_projects`, and finally the caller's own
 * personal project when no official client is configured.
 *
 * A url+token context skips the Public API steps entirely: there the
 * official-MCP client is context-authoritative while `getN8nApiClient` falls
 * back to the operator's own instance, so listing projects through it would
 * read another instance's projects — and hand their ids back to the caller,
 * who then forwards one to a call on the context instance.
 *
 * Returns either the resolved choices or an undecorated failure envelope for
 * the caller to decorate (`kind`, `action`, ...).
 */
export async function resolveProjectChoices(
  context?: InstanceContext
): Promise<{ choices: ProjectChoices } | { failure: McpToolResponse }> {
  const contextMatches = publicApiMatchesContext(context);
  const api = contextMatches ? getN8nApiClient(context) : null;

  if (contextMatches) {
    if (!api) {
      return { failure: { success: false, code: 'NOT_CONFIGURED', error: 'n8n API not configured. Set N8N_API_URL and N8N_API_KEY.' } };
    }

    try {
      const projects = (await api.listProjects()).map(p => ({ id: p.id, name: p.name, type: p.type, personal: p.type === 'personal' }));
      // GET /projects is itself licence-gated (Community instances answer 403 before this
      // point is reached), so a successful listing means team projects ARE licensed here —
      // regardless of whether any happen to be visible to this API key.
      return { choices: { backend: 'public-api', teamProjectsEnabled: true, items: projects } };
    } catch (err) {
      const status = err instanceof N8nApiError ? err.statusCode : undefined;
      if (status !== 403 && status !== 404) {
        return { failure: { success: false, code: 'API_ERROR', error: err instanceof Error ? err.message : String(err) } };
      }
    }
  }

  // Licence refusal (team projects are Enterprise-only): the official server
  // lists projects regardless of the Public API's licence gate.
  if (getOfficialMcpClient(context)) {
    const official = await callOfficialTool(context, CATALOG_TOOLS, {}, DEFAULT_TIMEOUT_MS, 'list_catalog', true);
    if (!official.success) return { failure: { ...official, backend: 'official-mcp' } as McpToolResponse };
    // search_projects output schema (docs/local/official-agent-tools-2026-08-27/all-official-tools-2026-08-27.json): { data: [{id, name, type}], count, teamProjectsEnabled?, hint? }.
    const officialData = official.data as any;
    const raw = (officialData?.data ?? []) as any[];
    const items: ProjectChoice[] = raw.map(p => ({ id: String(p.id), name: String(p.name), type: p.type, personal: p.type === 'personal' }));
    const teamProjectsEnabled = typeof officialData?.teamProjectsEnabled === 'boolean'
      ? officialData.teamProjectsEnabled
      : items.some(p => !p.personal);
    return { choices: { backend: 'official-mcp', teamProjectsEnabled, items } };
  }

  if (!api) {
    // Only reachable on a url+token context with no official client: there is
    // no resolver left that addresses the instance this request names.
    return { failure: { success: false, code: 'NOT_CONFIGURED', backend: 'official-mcp', error: PUBLIC_API_CONTEXT_HINT } as McpToolResponse };
  }

  try {
    const personalId = await api.resolvePersonalProjectId();
    return {
      choices: {
        backend: 'public-api',
        teamProjectsEnabled: false,
        items: [{ id: personalId, name: 'Personal', type: 'personal', personal: true }],
      },
    };
  } catch (err) {
    return {
      failure: {
        success: false,
        backend: 'public-api',
        code: 'API_ERROR',
        error: err instanceof Error ? err.message : String(err),
        hint: 'Team projects are not available through the Public API on this instance and the personal project could not be resolved. Pass projectId explicitly, or configure N8N_MCP_ACCESS_TOKEN so projects can be listed through n8n\'s MCP server.',
      } as McpToolResponse,
    };
  }
}
