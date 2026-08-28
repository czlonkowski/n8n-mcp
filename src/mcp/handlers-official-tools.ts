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
import { N8nApiError } from '../utils/n8n-errors';

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
});

const EXPLORE_TOOLS = ['explore_node_resources'];

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
    if (!tool) return officialFailure(new OfficialMcpError('OFFICIAL_MCP_TOOL_UNAVAILABLE', `This instance does not expose ${toolAliases.join(' / ')}`), label) as McpToolResponse;
    const result = await client.callTool(tool, args, { timeoutMs, idempotent });
    const data = result.json ?? result.text;
    if (result.text.startsWith('Input validation error')) return { success: false, action: label, code: 'INVALID_ARGS', error: result.text.slice(0, 2000) };
    if (result.isError || (data as any)?.ok === false) {
      return { success: false, action: label, officialTool: tool, code: 'OFFICIAL_MCP_ERROR', error: officialErrorText(data, undefined), officialError: data };
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
});

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

  try {
    const projects = (await api.listProjects()).map(p => ({ id: p.id, name: p.name, type: p.type, personal: p.type === 'personal' }));
    // GET /projects is itself licence-gated (Community instances answer 403 before this
    // point is reached), so a successful listing means team projects ARE licensed here —
    // regardless of whether any happen to be visible to this API key.
    return {
      success: true,
      kind,
      backend: 'public-api',
      data: { teamProjectsEnabled: true, items: filterItems(projects, query, limit) },
    } as McpToolResponse;
  } catch (err) {
    const status = err instanceof N8nApiError ? err.statusCode : undefined;
    if (status !== 403 && status !== 404) {
      return { success: false, kind, code: 'API_ERROR', error: err instanceof Error ? err.message : String(err) } as McpToolResponse;
    }
  }

  // Licence refusal (team projects are Enterprise-only): the official server
  // lists projects regardless of the Public API's licence gate.
  if (getOfficialMcpClient(context)) {
    const official = await callOfficialTool(context, CATALOG_TOOLS, {}, DEFAULT_TIMEOUT_MS, 'list_catalog', true);
    if (!official.success) return official;
    // search_projects output schema (docs/local/official-agent-tools-2026-08-27/all-official-tools-2026-08-27.json): { data: [{id, name, type}], count, teamProjectsEnabled?, hint? }.
    const officialData = official.data as any;
    const raw = (officialData?.data ?? []) as any[];
    const items: CatalogItem[] = raw.map(p => ({ id: String(p.id), name: String(p.name), type: p.type, personal: p.type === 'personal' }));
    const teamProjectsEnabled = typeof officialData?.teamProjectsEnabled === 'boolean'
      ? officialData.teamProjectsEnabled
      : items.some(p => !p.personal);
    return {
      success: true,
      kind,
      backend: 'official-mcp',
      data: { teamProjectsEnabled, items: filterItems(items, query, limit) },
    } as McpToolResponse;
  }

  try {
    const personalId = await api.resolvePersonalProjectId();
    return {
      success: true,
      kind,
      backend: 'public-api',
      data: { teamProjectsEnabled: false, items: filterItems([{ id: personalId, name: 'Personal', type: 'personal', personal: true }], query, limit) },
    } as McpToolResponse;
  } catch (err) {
    return {
      success: false,
      kind,
      backend: 'public-api',
      code: 'API_ERROR',
      error: err instanceof Error ? err.message : String(err),
      hint: 'Team projects are not available through the Public API on this instance and the personal project could not be resolved. Pass projectId explicitly, or configure N8N_MCP_ACCESS_TOKEN so projects can be listed through n8n\'s MCP server.',
    } as McpToolResponse;
  }
}
