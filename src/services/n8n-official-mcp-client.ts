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
  NOT_CONFIGURED: 'Set N8N_MCP_ACCESS_TOKEN to the MCP API key from n8n Settings → Instance-level MCP → set MCP status to Enabled (a separate key from N8N_API_KEY). The endpoint is derived from N8N_API_URL.',
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
/**
 * How long an unreachable probe result is trusted. Much shorter than the
 * success TTL: a token that was just fixed, an instance that was restarting,
 * or MCP being switched on in n8n's settings should not leave every
 * official-MCP-backed tool answering "not reachable" for ten minutes.
 */
export const OFFICIAL_MCP_FAILURE_TTL_MS = 30_000;
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
    // The pinned fetch never follows redirects (see createPinnedFetch), so a
    // 3xx arrives here as an ordinary non-ok response. Say so, otherwise
    // "returned HTTP 302" reads as an unexplained protocol failure.
    if (status !== undefined && status >= 300 && status < 400) {
      return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', `n8n MCP server returned HTTP ${status}; redirects are not followed`, status);
    }
    return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', `n8n MCP server returned HTTP ${status}`, status ?? undefined);
  }
  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
    return new OfficialMcpError('OFFICIAL_MCP_TIMEOUT', 'Request to n8n MCP server timed out');
  }
  // callTool validates a tool's `structuredContent` against the output schema
  // the server advertised for it; when n8n's schema and payload drift apart
  // the SDK raises InvalidParams from inside the client, not from the wire.
  // Map it to a transport error with a message that names the cause.
  if (err instanceof McpError && err.code === ErrorCode.InvalidParams) {
    return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', "Result did not match the tool's output schema");
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

interface Connected { client: Client; generation: number }

export class N8nOfficialMcpClient {
  readonly endpoint: string;
  private readonly token: string;
  private readonly host: string;
  private client: Client | null = null;
  private pinned: PinnedFetch | null = null;
  private connecting: Promise<Connected> | null = null;
  private caps: OfficialMcpCapabilities | null = null;
  private ref: { value: AgentBuilderReference; at: number } | null = null;
  // Bumped every time the stored client/pinned pair is discarded (by a reset
  // or by close()). Callers that captured the generation their transport
  // belonged to can tell, after an await, whether it is still the live one —
  // this lets a failure scope its cleanup to "only if nobody already
  // replaced this transport" instead of blindly tearing down whatever is
  // stored, which could be a different call's live connection.
  private generation = 0;
  private closed = false;
  // Set once a connect() has actually completed the MCP handshake. Distinct
  // from `caps`/`caps.reachable`, which stays null for a client that only
  // ever calls callTool() — a retry gate keyed off `caps` would never fire
  // for that (common) usage pattern.
  private hasConnectedSuccessfully = false;

  constructor(opts: { endpoint: string; token: string; instanceId?: string }) {
    this.endpoint = opts.endpoint;
    this.token = opts.token;
    this.host = new URL(opts.endpoint).host;
  }

  private async connect(): Promise<Connected> {
    // A closed client is terminal: reconnecting here would resurrect a
    // transport the owner already disposed of (an evicted cache entry, a
    // shut-down server).
    if (this.closed) throw new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', 'Client is closed');
    if (this.client) return { client: this.client, generation: this.generation };
    if (this.connecting) return this.connecting;
    const myGeneration = this.generation;
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
      if (this.closed || this.generation !== myGeneration) {
        // close() (or a concurrent reset) ran while this handshake was in
        // flight. Nothing else references this client/pinned pair, so it
        // must be torn down here — otherwise the transport and its pinned
        // undici dispatcher leak.
        await client.close().catch(() => undefined);
        await pinned.close().catch(() => undefined);
        throw new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', 'Client was closed while connecting');
      }
      this.client = client; this.pinned = pinned; this.hasConnectedSuccessfully = true;
      logger.debug('Connected to n8n MCP server', { host: this.host });
      return { client, generation: this.generation };
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  /** Discards the stored client/pinned pair, but only if it is still the one identified by `generation` — a stale caller (superseded by a later reset or reconnect) is a no-op. */
  private async resetTransport(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const client = this.client; const pinned = this.pinned;
    this.client = null; this.pinned = null;
    this.generation++;
    await client?.close().catch(() => undefined);
    await pinned?.close().catch(() => undefined);
  }

  async capabilities(force = false): Promise<OfficialMcpCapabilities> {
    const ttl = this.caps?.reachable === false ? OFFICIAL_MCP_FAILURE_TTL_MS : OFFICIAL_MCP_CACHE_TTL_MS;
    if (!force && this.caps && Date.now() - this.caps.checkedAt < ttl) return this.caps;
    let generation: number | undefined;
    try {
      const connected = await this.connect();
      generation = connected.generation;
      const { tools } = await connected.client.listTools(undefined, { timeout: DEFAULT_TIMEOUT_MS });
      const toolNames = tools.map(t => t.name);
      this.caps = { reachable: true, toolCount: toolNames.length, toolNames, agentTools: toolNames.some(n => (AGENT_TOOL_NAMES as readonly string[]).includes(n)), checkedAt: Date.now() };
    } catch (err) {
      const mapped = mapOfficialTransportError(err);
      // A request timeout is local to that one request (see the comment in
      // callTool) and never indicates the transport itself is broken.
      if (mapped.code !== 'OFFICIAL_MCP_TIMEOUT' && generation !== undefined) await this.resetTransport(generation);
      this.caps = { reachable: false, toolCount: 0, toolNames: [], agentTools: false, checkedAt: Date.now(), error: mapped.code };
    }
    return this.caps;
  }

  async hasTool(name: string): Promise<boolean> {
    const caps = await this.capabilities();
    return caps.toolNames.includes(name);
  }

  /**
   * Forwards one tool call. `idempotent` must be true for the connection-level
   * retry below to fire — see the comment at the retry gate.
   *
   * The SDK validates a tool's `structuredContent` against the `outputSchema`
   * the server advertised for it, so a drift between n8n's declared schema and
   * what it actually returns rejects here as `McpError(InvalidParams)`;
   * `mapOfficialTransportError` turns that into a readable transport error.
   */
  async callTool(name: string, args: Record<string, unknown>, opts: { timeoutMs?: number; idempotent?: boolean } = {}): Promise<OfficialToolResult> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const state: { generation?: number } = {};
    const attempt = async (): Promise<OfficialToolResult> => {
      const { client, generation } = await this.connect();
      state.generation = generation;
      const raw = await client.callTool({ name, arguments: args }, undefined, { timeout });
      return parseResult(raw as any);
    };
    logger.debug('Calling n8n MCP tool', { host: this.host, tool: name });
    try {
      return await attempt();
    } catch (err) {
      const mapped = mapOfficialTransportError(err);
      // A request timeout only rejects that one request's own promise —
      // the SDK's Protocol tracks timeouts per message id and never tears
      // down the transport for one (see shared/protocol.js: `cancel()`
      // rejects a single response handler; `_onclose()`, which rejects
      // every pending request, only runs when the transport itself
      // closes). Resetting here would abort any other call still in
      // flight on the same shared transport, so a plain timeout is never
      // retried and never triggers a reset.
      if (mapped.code === 'OFFICIAL_MCP_TIMEOUT') throw mapped;
      if (state.generation !== undefined) await this.resetTransport(state.generation);
      // Retry only a genuine connection-level failure — no HTTP status at
      // all (a socket error, DNS failure, or "fetch failed"). An HTTP
      // status (401/404/429/500/503/…) means the request reached n8n and
      // may have already mutated state; retrying it here would risk
      // duplicating that side effect, so it is surfaced instead. Also
      // require that this client has connected successfully before, so a
      // first-ever call against an unreachable endpoint fails fast instead
      // of doubling the wait.
      //
      // Even a connection-level failure is only safe to retry for a call the
      // caller declared idempotent. "No HTTP status" does not mean "no
      // request reached n8n": a socket that dies while the response is being
      // read leaves a create_agent/publish_agent/call_agent that already ran
      // on the instance, and a blind retry would run it twice.
      const isConnectionFailure = mapped.code === 'OFFICIAL_MCP_TRANSPORT_ERROR' && mapped.status === undefined;
      if (!isConnectionFailure || !this.hasConnectedSuccessfully || opts.idempotent !== true) throw mapped;
      try {
        return await attempt();
      } catch (again) {
        const mappedAgain = mapOfficialTransportError(again);
        if (mappedAgain.code !== 'OFFICIAL_MCP_TIMEOUT' && state.generation !== undefined) {
          await this.resetTransport(state.generation);
        }
        throw mappedAgain;
      }
    }
  }

  /**
   * The agent-builder guide, cached for the success TTL — it is large and
   * static. A failed call is never cached: an instance that answered
   * `isError` or `{ok:false}` once (agents module still starting, tool
   * refused) would otherwise keep serving that failure as if it were the
   * guide for the next ten minutes. It throws instead, so the caller maps it
   * like any other failed action.
   */
  async reference(): Promise<AgentBuilderReference> {
    if (this.ref && Date.now() - this.ref.at < OFFICIAL_MCP_CACHE_TTL_MS) return this.ref.value;
    const result = await this.callTool('get_agent_builder_reference', {}, { idempotent: true });
    const value = (result.json && typeof result.json === 'object' ? result.json : { guide: result.text }) as AgentBuilderReference;
    if (result.isError || value.ok === false) {
      throw new OfficialMcpError('OFFICIAL_MCP_TOOL_UNAVAILABLE', 'n8n did not return the agent builder reference');
    }
    this.ref = { value, at: Date.now() };
    return value;
  }

  /** Last probed capabilities, or null if this client has never probed (or was just closed). Never triggers a network call. */
  cachedCapabilities(): OfficialMcpCapabilities | null {
    return this.caps;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.generation++; // invalidates any in-flight connect(); it tears itself down instead of storing
    if (this.connecting) await this.connecting.catch(() => undefined);
    const client = this.client; const pinned = this.pinned;
    this.client = null; this.pinned = null;
    await client?.close().catch(() => undefined);
    await pinned?.close().catch(() => undefined);
    this.caps = null; this.ref = null;
  }
}

/**
 * One-off capability probe against an endpoint/token pair that isn't backed
 * by a cached client (e.g. health-check diagnostics for a config that may
 * not even be the resolved instance client). Always closes the throwaway
 * client, and — like `capabilities()` — never throws for a reachability
 * failure; it resolves with `{ reachable: false, error }` instead.
 */
export async function probeOfficialMcp(opts: { endpoint: string; token: string }): Promise<OfficialMcpCapabilities> {
  const client = new N8nOfficialMcpClient(opts);
  try {
    return await client.capabilities(true);
  } finally {
    await client.close();
  }
}
