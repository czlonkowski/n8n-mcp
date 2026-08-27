import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SSRFProtection, PinnedFetch } from '../utils/ssrf-protection';
import { PROJECT_VERSION } from '../utils/version';
import { logger } from '../utils/logger';

export type OfficialMcpErrorCode =
  | 'NOT_CONFIGURED' | 'OFFICIAL_MCP_AUTH_FAILED' | 'OFFICIAL_MCP_NOT_ENABLED'
  | 'OFFICIAL_MCP_RATE_LIMITED' | 'OFFICIAL_MCP_TOOL_UNAVAILABLE' | 'OFFICIAL_MCP_URL_REJECTED'
  | 'OFFICIAL_MCP_TIMEOUT' | 'OFFICIAL_MCP_TRANSPORT_ERROR';

export const OFFICIAL_MCP_HINTS: Record<OfficialMcpErrorCode, string> = {
  NOT_CONFIGURED: 'Set N8N_MCP_ACCESS_TOKEN to the MCP API key from n8n Settings → Instance-level MCP → "Enable MCP access" (a separate key from N8N_API_KEY). The endpoint is derived from N8N_API_URL.',
  OFFICIAL_MCP_AUTH_FAILED: 'The MCP access token was rejected. Regenerate it in n8n Settings → Instance-level MCP and update N8N_MCP_ACCESS_TOKEN.',
  OFFICIAL_MCP_NOT_ENABLED: 'n8n did not answer as an MCP server at <origin>/mcp-server/http. Enable instance-level MCP access in Settings (n8n >= 2.18.4), or the instance serves MCP from a different host (N8N_MCP_BASE_URL), which is not supported.',
  OFFICIAL_MCP_RATE_LIMITED: 'n8n limits the MCP server to 100 requests per window per token. Wait and retry.',
  OFFICIAL_MCP_TOOL_UNAVAILABLE: 'This n8n instance does not expose the required tool. Agents need n8n >= 2.34 with the agents module enabled; other tools depend on the n8n version.',
  OFFICIAL_MCP_URL_REJECTED: 'The derived MCP endpoint failed URL safety validation (private or reserved address). Use a public instance URL, or WEBHOOK_SECURITY_MODE=moderate for local development.',
  OFFICIAL_MCP_TIMEOUT: 'The request exceeded timeoutMs. The run continues in n8n: check n8n_executions for the execution, reuse the sessionId if you have one instead of re-sending the message, or raise timeoutMs.',
  OFFICIAL_MCP_TRANSPORT_ERROR: 'Could not complete the request to n8n\'s MCP server. Check that the instance is reachable and try again.',
};

export class OfficialMcpError extends Error {
  constructor(public readonly code: OfficialMcpErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = 'OfficialMcpError';
  }
  get hint(): string { return OFFICIAL_MCP_HINTS[this.code]; }
}

export const AGENT_TOOL_NAMES = [
  'search_agents', 'get_agent', 'create_agent', 'mutate_agent', 'validate_agent', 'call_agent',
  'publish_agent', 'unpublish_agent', 'revert_agent', 'list_agent_versions', 'delete_agent',
  'discover_agent_assets', 'verify_agent_mcp_server', 'update_agent_integration', 'get_agent_builder_reference',
] as const;

export interface OfficialMcpCapabilities { reachable: boolean; toolCount: number; toolNames: string[]; agentTools: boolean; checkedAt: number; error?: OfficialMcpErrorCode }
export interface OfficialToolResult { isError: boolean; text: string; json?: unknown; sizeBytes: number; truncated: boolean }
export interface AgentBuilderReference { ok?: boolean; uri?: string; guide?: string; configSchema?: unknown; [key: string]: unknown }

export const OFFICIAL_MCP_CACHE_TTL_MS = 10 * 60 * 1000;
export const OFFICIAL_RESULT_MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Errors are mapped by transport status first, then by MCP error code; anything else is a transport error. */
export function mapOfficialTransportError(err: unknown): OfficialMcpError {
  if (err instanceof OfficialMcpError) return err;
  if (err instanceof StreamableHTTPError) {
    const status = err.code;
    if (status === 401 || status === 403) return new OfficialMcpError('OFFICIAL_MCP_AUTH_FAILED', 'n8n rejected the MCP access token', status);
    if (status === 404 || status === -1) return new OfficialMcpError('OFFICIAL_MCP_NOT_ENABLED', 'No MCP server at the derived endpoint', status === -1 ? undefined : status);
    if (status === 429) return new OfficialMcpError('OFFICIAL_MCP_RATE_LIMITED', 'n8n MCP server rate limit reached', status);
    return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', `n8n MCP server returned HTTP ${status}`, status ?? undefined);
  }
  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
    return new OfficialMcpError('OFFICIAL_MCP_TIMEOUT', 'Request to n8n MCP server timed out');
  }
  const message = err instanceof Error ? err.message : String(err);
  // Never include response bodies or stacks: proxies echo request details into error pages.
  return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', message.slice(0, 200));
}

function parseResult(raw: { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown }): OfficialToolResult {
  let text = (raw.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text as string).join('\n');
  const sizeBytes = Buffer.byteLength(text, 'utf8');
  const truncated = sizeBytes > OFFICIAL_RESULT_MAX_BYTES;
  if (truncated) text = Buffer.from(text, 'utf8').subarray(0, OFFICIAL_RESULT_MAX_BYTES).toString('utf8') + '\n…[truncated]';
  let json: unknown = raw.structuredContent;
  if (json === undefined && !truncated) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { json = JSON.parse(trimmed); } catch { /* keep text */ } }
  }
  return { isError: raw.isError === true, text, json, sizeBytes, truncated };
}

export class N8nOfficialMcpClient {
  readonly endpoint: string;
  private readonly token: string;
  private readonly host: string;
  private client: Client | null = null;
  private pinned: PinnedFetch | null = null;
  private connecting: Promise<Client> | null = null;
  private caps: OfficialMcpCapabilities | null = null;
  private ref: { value: AgentBuilderReference; at: number } | null = null;

  constructor(opts: { endpoint: string; token: string; instanceId?: string }) {
    this.endpoint = opts.endpoint;
    this.token = opts.token;
    this.host = new URL(opts.endpoint).host;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const validation = await SSRFProtection.validateWebhookUrl(this.endpoint);
      if (!validation.valid) throw new OfficialMcpError('OFFICIAL_MCP_URL_REJECTED', validation.reason || 'Endpoint rejected');
      const addresses = validation.addresses ?? (validation.address ? [{ address: validation.address, family: validation.family as 4 | 6 }] : []);
      const pinned = SSRFProtection.createPinnedFetch(addresses);
      const transport = new StreamableHTTPClientTransport(new URL(this.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
        fetch: pinned.fetch,
      });
      const client = new Client({ name: 'n8n-mcp', version: PROJECT_VERSION }, { capabilities: {} });
      try {
        await client.connect(transport, { timeout: DEFAULT_TIMEOUT_MS });
      } catch (err) {
        await pinned.close().catch(() => undefined);
        throw mapOfficialTransportError(err);
      }
      this.client = client; this.pinned = pinned;
      logger.debug('Connected to n8n MCP server', { host: this.host });
      return client;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  private async resetTransport(): Promise<void> {
    const client = this.client; const pinned = this.pinned;
    this.client = null; this.pinned = null;
    await client?.close().catch(() => undefined);
    await pinned?.close().catch(() => undefined);
  }

  async capabilities(force = false): Promise<OfficialMcpCapabilities> {
    if (!force && this.caps && Date.now() - this.caps.checkedAt < OFFICIAL_MCP_CACHE_TTL_MS) return this.caps;
    try {
      const client = await this.connect();
      const { tools } = await client.listTools(undefined, { timeout: DEFAULT_TIMEOUT_MS });
      const toolNames = tools.map(t => t.name);
      this.caps = { reachable: true, toolCount: toolNames.length, toolNames, agentTools: toolNames.some(n => (AGENT_TOOL_NAMES as readonly string[]).includes(n)), checkedAt: Date.now() };
    } catch (err) {
      const mapped = mapOfficialTransportError(err);
      await this.resetTransport();
      this.caps = { reachable: false, toolCount: 0, toolNames: [], agentTools: false, checkedAt: Date.now(), error: mapped.code };
    }
    return this.caps;
  }

  async hasTool(name: string): Promise<boolean> {
    const caps = await this.capabilities();
    return caps.toolNames.includes(name);
  }

  async callTool(name: string, args: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<OfficialToolResult> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attempt = async (): Promise<OfficialToolResult> => {
      const client = await this.connect();
      const raw = await client.callTool({ name, arguments: args }, undefined, { timeout });
      return parseResult(raw as any);
    };
    logger.debug('Calling n8n MCP tool', { host: this.host, tool: name });
    try {
      return await attempt();
    } catch (err) {
      const mapped = mapOfficialTransportError(err);
      // The server is stateless: a dropped transport is recreated once. Auth,
      // enablement, rate-limit and timeout failures are not retried; a transport
      // error is retried only when a previous connection had already succeeded
      // (this.caps?.reachable) — otherwise the first attempt never worked at all
      // and a retry would just repeat the same failure.
      await this.resetTransport();
      if (mapped.code !== 'OFFICIAL_MCP_TRANSPORT_ERROR' || !this.caps?.reachable) throw mapped;
      try { return await attempt(); } catch (again) { await this.resetTransport(); throw mapOfficialTransportError(again); }
    }
  }

  async reference(): Promise<AgentBuilderReference> {
    if (this.ref && Date.now() - this.ref.at < OFFICIAL_MCP_CACHE_TTL_MS) return this.ref.value;
    const result = await this.callTool('get_agent_builder_reference', {});
    const value = (result.json && typeof result.json === 'object' ? result.json : { guide: result.text }) as AgentBuilderReference;
    this.ref = { value, at: Date.now() };
    return value;
  }

  async close(): Promise<void> {
    await this.resetTransport();
    this.caps = null; this.ref = null;
  }
}
