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

/** Shared "call one official tool, wrap the result" path for the passthrough tools. */
export async function callOfficialTool(
  context: InstanceContext | undefined,
  toolAliases: string[],
  args: Record<string, unknown>,
  timeoutMs: number,
  label: string,
): Promise<McpToolResponse> {
  const client = getOfficialMcpClient(context);
  if (!client) return notConfiguredResponse(context, label) as McpToolResponse;
  try {
    const caps = await client.capabilities();
    if (!caps.reachable) return officialFailure(new OfficialMcpError(caps.error ?? 'OFFICIAL_MCP_TRANSPORT_ERROR', 'n8n MCP server is not reachable'), label) as McpToolResponse;
    const tool = toolAliases.find(t => caps.toolNames.includes(t));
    if (!tool) return officialFailure(new OfficialMcpError('OFFICIAL_MCP_TOOL_UNAVAILABLE', `This instance does not expose ${toolAliases.join(' / ')}`), label) as McpToolResponse;
    const result = await client.callTool(tool, args, { timeoutMs });
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
  return callOfficialTool(context, EXPLORE_TOOLS, forwarded, timeoutMs ?? DEFAULT_TIMEOUT_MS, 'explore_node_resources');
}
