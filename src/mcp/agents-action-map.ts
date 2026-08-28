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
  /**
   * Writes to the instance. Every action that creates, changes, runs or
   * removes an agent — a create/mutate leaves a persisted draft behind and a
   * call runs the agent's real tools, so neither is a read. Source of truth
   * for `DESTRUCTIVE_TOOL_OPERATIONS['n8n_manage_agents']`, which drives
   * `DISABLED_TOOL_OPERATIONS` filtering.
   */
  destructive: boolean;
  /**
   * Safe to send twice. Only an idempotent call is retried after a
   * connection-level failure (see `N8nOfficialMcpClient.callTool`): a dead
   * socket does not prove the request never reached n8n, so retrying a
   * create/mutate/call could run it a second time.
   */
  idempotent: boolean;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const CALL_TIMEOUT_MS = 180_000;
export const MIN_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 600_000;
/**
 * Client-side deadline for the official calls that run a workflow
 * (`test_workflow`, `execute_workflow`). Runs routinely outlast the 30 s
 * default that read calls use.
 */
export const PINNED_TIMEOUT_MS = 300_000;

export const AGENT_ACTION_MAP: Record<AgentAction, AgentActionSpec> = {
  reference: { tools: ['get_agent_builder_reference'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  search: { tools: ['search_agents'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  get: { tools: ['get_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  create: { tools: ['create_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
  mutate: { tools: ['mutate_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
  validate: { tools: ['validate_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  call: { tools: ['call_agent'], defaultTimeoutMs: CALL_TIMEOUT_MS, destructive: true, idempotent: false },
  publish: { tools: ['publish_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
  unpublish: { tools: ['unpublish_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
  revert: { tools: ['revert_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
  versions: { tools: ['list_agent_versions'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  delete: { tools: ['delete_agent'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
  discover_assets: { tools: ['discover_agent_assets'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  verify_mcp_server: { tools: ['verify_agent_mcp_server'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: false, idempotent: true },
  update_integration: { tools: ['update_agent_integration'], defaultTimeoutMs: DEFAULT_TIMEOUT_MS, destructive: true, idempotent: false },
};

export const AGENT_ACTIONS = Object.keys(AGENT_ACTION_MAP) as AgentAction[];

/** The write actions, derived from the map so the two never drift apart. */
export const DESTRUCTIVE_AGENT_ACTIONS = AGENT_ACTIONS.filter(a => AGENT_ACTION_MAP[a].destructive);

/** Returns the first tool name from `spec.tools` that appears in `available`, or null. */
export function resolveOfficialTool(spec: AgentActionSpec, available: string[]): string | null {
  return spec.tools.find(t => available.includes(t)) ?? null;
}
