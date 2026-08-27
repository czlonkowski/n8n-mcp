/**
 * Action → official-MCP-tool mapping for `n8n_manage_agents`.
 *
 * Each action maps to one or more candidate tool names on n8n's
 * instance-level MCP server. Alias arrays absorb official renames (the
 * 2.32→2.34 folder-tool rename is the precedent): the first name present
 * in the instance's tool list wins.
 */
export type AgentAction =
  | 'reference'
  | 'search'
  | 'get'
  | 'create'
  | 'mutate'
  | 'validate'
  | 'call'
  | 'publish'
  | 'unpublish'
  | 'revert'
  | 'versions'
  | 'delete'
  | 'discover_assets'
  | 'verify_mcp_server'
  | 'update_integration';

export interface AgentActionSpec {
  tools: string[];
  defaultTimeoutMs: number;
  destructive: boolean;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const CALL_TIMEOUT_MS = 180_000;
export const MIN_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 600_000;

export const AGENT_ACTION_MAP: Record<AgentAction, AgentActionSpec> = {
  reference: { tools: ['get_agent_builder_reference'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  search: { tools: ['search_agents'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  get: { tools: ['get_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  create: { tools: ['create_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  mutate: { tools: ['mutate_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  validate: { tools: ['validate_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  call: { tools: ['call_agent'], defaultTimeoutMs: CALL_TIMEOUT_MS, destructive: false },
  publish: { tools: ['publish_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true },
  unpublish: { tools: ['unpublish_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true },
  revert: { tools: ['revert_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true },
  versions: { tools: ['list_agent_versions'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  delete: { tools: ['delete_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true },
  discover_assets: { tools: ['discover_agent_assets'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  verify_mcp_server: { tools: ['verify_agent_mcp_server'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false },
  update_integration: { tools: ['update_agent_integration'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true },
};

export const AGENT_ACTIONS = Object.keys(AGENT_ACTION_MAP) as AgentAction[];

/** Returns the first tool name from `spec.tools` that appears in `available`, or null. */
export function resolveOfficialTool(spec: AgentActionSpec, available: string[]): string | null {
  return spec.tools.find(t => available.includes(t)) ?? null;
}
