import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { jsonSchemaValidator, JsonSchemaValidatorResult } from '@modelcontextprotocol/sdk/validation/index.js';
import { SSRFProtection, PinnedFetch } from '../utils/ssrf-protection';
import { PROJECT_VERSION } from '../utils/version';
import { logger } from '../utils/logger';

/**
 * The SDK client validates a tool result's `structuredContent` against the
 * `outputSchema` the server advertised for that tool, and turns a mismatch
 * into `McpError(InvalidParams)`. n8n declares output schemas that describe
 * only the success shape, then answers refusals and errors with a different
 * payload — `prepare_workflow_pin_data` on a workflow that is not exposed to
 * MCP returns `isError: true` with `{ error: 'Workflow is not available in
 * MCP. …' }` — so enforcing the schema here converts a server refusal our
 * callers need to read into an opaque transport error.
 *
 * Results are untrusted data that we forward and size-cap regardless of what
 * the schema claims, so client-side enforcement buys nothing. This validator
 * accepts everything, which disables that comparison.
 *
 * It does NOT disable every client-side output check: the SDK still throws
 * `McpError(InvalidRequest, -32600)` when a tool that declares an outputSchema
 * answers `isError: false` with no `structuredContent` at all
 * (`client/index.js:487-489` — the guard is gated on a validator existing, and
 * this one does exist). `mapOfficialTransportError` names that case.
 */
const PERMISSIVE_JSON_SCHEMA_VALIDATOR: jsonSchemaValidator = {
  getValidator: <T>() => (input: unknown): JsonSchemaValidatorResult<T> => ({ valid: true, data: input as T, errorMessage: undefined }),
};

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
  /**
   * `retryable` marks a connection-level failure: the request never got an
   * HTTP status and never got a JSON-RPC reply, so the transport itself is
   * suspect (socket reset, DNS failure, "fetch failed"). Only such a failure
   * justifies discarding the shared transport and re-sending an idempotent
   * call. Anything the server answered — an HTTP status or a JSON-RPC error —
   * proves the request reached n8n, so it is surfaced instead.
   */
  constructor(
    public readonly code: OfficialMcpErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
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
/**
 * `sizeBytes` is the size of the payload as received from n8n (the larger of
 * the text and the structured content), measured before any capping, so a
 * caller can see how much was cut. `truncated` says whether `text` / `json`
 * are smaller than that.
 */
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
  // SECURITY: an `McpError`'s message is built by the SDK from the server's
  // own JSON-RPC `error.message`, so it is attacker-controlled text — a buggy
  // instance or an intermediary proxy can echo the request (including the
  // `Authorization: Bearer …` header) back into it. Never copy it: every
  // generic protocol error gets a fixed message naming only the numeric
  // JSON-RPC code.
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) {
      return new OfficialMcpError('OFFICIAL_MCP_TIMEOUT', 'Request to n8n MCP server timed out');
    }
    // InvalidParams now only reaches here from n8n itself rejecting the
    // request's arguments (JSON-RPC -32602): the client opts out of the SDK's
    // client-side output-schema comparison (see PERMISSIVE_JSON_SCHEMA_VALIDATOR).
    if (err.code === ErrorCode.InvalidParams) {
      return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', 'n8n MCP server rejected the request arguments (JSON-RPC -32602)');
    }
    // The opt-out does not cover this one: the SDK raises InvalidRequest itself
    // when a tool that declares an outputSchema answers a non-error result with
    // no structuredContent at all. n8n answering -32600 on the wire lands here
    // too, which the fixed message stays true for.
    if (err.code === ErrorCode.InvalidRequest) {
      return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', 'n8n returned a result without structured content for a tool that declares an output schema (JSON-RPC -32600)');
    }
    const code = typeof err.code === 'number' ? err.code : 'unknown';
    return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', `n8n MCP server returned a protocol error (JSON-RPC code ${code})`);
  }
  if (err instanceof Error) {
    // No HTTP status and no JSON-RPC reply: a connection-level failure whose
    // message comes from the local fetch/socket stack, not from the remote
    // server, so it is safe to surface (still capped — never include response
    // bodies or stacks: proxies echo request details into error pages).
    return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', err.message.slice(0, 200), undefined, true);
  }
  // A thrown non-Error cannot be attributed to the connection, so it is not
  // retried, and its stringification is not surfaced either.
  return new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', 'Request to n8n MCP server failed');
}

/** Serialized size of a structured payload; an unserializable value (a cycle) counts as over the cap. */
function structuredSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return OFFICIAL_RESULT_MAX_BYTES + 1;
  }
}

/**
 * A bounded stand-in for an oversized structured payload that reports a
 * failure at its root.
 *
 * Callers read the failure flags (`success: false` / `ok: false`) off the
 * structured content, so dropping an oversized payload wholesale would turn a
 * failure into a success. Keeping the flag, a capped message and the code
 * preserves that mapping at a fixed size. Returns `undefined` for anything
 * that is not a root-level failure — those are dropped as before.
 */
function boundedFailureProjection(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  const flag = root.success === false ? 'success' : root.ok === false ? 'ok' : undefined;
  if (!flag) return undefined;

  const message =
    typeof root.error === 'string' ? root.error
    : typeof root.message === 'string' ? root.message
    : 'n8n returned an error payload too large to include';
  return {
    [flag]: false,
    error: message.slice(0, 2000),
    ...(typeof root.code === 'string' ? { code: root.code } : {}),
  };
}

function parseResult(raw: { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown }): OfficialToolResult {
  let text = (raw.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text as string).join('\n');
  const textBytes = Buffer.byteLength(text, 'utf8');
  let truncated = textBytes > OFFICIAL_RESULT_MAX_BYTES;
  if (truncated) text = Buffer.from(text, 'utf8').subarray(0, OFFICIAL_RESULT_MAX_BYTES).toString('utf8') + '\n…[truncated]';
  // `structuredContent` is a second, independent payload: capping only the
  // text would let an oversized structured result through untouched and into
  // the caller's context.
  let json: unknown = raw.structuredContent;
  let structuredBytes = 0;
  if (json !== undefined) {
    structuredBytes = structuredSize(json);
    if (structuredBytes > OFFICIAL_RESULT_MAX_BYTES) {
      // A root-level failure keeps a bounded projection of itself; anything
      // else is dropped. An oversized failure must never read as a success.
      json = boundedFailureProjection(json);
      truncated = true;
    }
  }
  if (json === undefined && !truncated) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { json = JSON.parse(trimmed); } catch { /* keep text */ } }
  }
  return { isError: raw.isError === true, text, json, sizeBytes: Math.max(textBytes, structuredBytes), truncated };
}

interface Connected { client: Client; generation: number }

/** Closes a client/pinned-fetch pair, swallowing any error from either close(). */
async function closeTransport(client: Client | null, pinned: PinnedFetch | null): Promise<void> {
  await client?.close().catch(() => undefined);
  await pinned?.close().catch(() => undefined);
}

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
      // DNS validation is the first await in this handshake, and close() can
      // run while it is pending. Check before anything is created: the
      // post-handshake check below can only tear down a transport that was
      // already opened, which still sends a request to an instance the owner
      // has stopped talking to.
      if (this.closed || this.generation !== myGeneration) {
        throw new OfficialMcpError('OFFICIAL_MCP_TRANSPORT_ERROR', 'Client was closed while connecting');
      }
      const addresses = validation.addresses ?? (validation.address ? [{ address: validation.address, family: validation.family as 4 | 6 }] : []);
      const pinned = SSRFProtection.createPinnedFetch(addresses);
      const transport = new StreamableHTTPClientTransport(new URL(this.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
        fetch: pinned.fetch,
      });
      const client = new Client({ name: 'n8n-mcp', version: PROJECT_VERSION }, { capabilities: {}, jsonSchemaValidator: PERMISSIVE_JSON_SCHEMA_VALIDATOR });
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
        await closeTransport(client, pinned);
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
    await closeTransport(client, pinned);
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
      // Only a connection-level failure means the transport itself is broken.
      // A request timeout is local to that one request (see the comment in
      // callTool), and a protocol error means n8n answered — in both cases
      // the transport is still usable and may be shared with other calls.
      if (mapped.retryable && generation !== undefined) await this.resetTransport(generation);
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
   * Results are returned as n8n sent them — including `isError` refusals whose
   * payload does not match the tool's advertised `outputSchema` (see
   * PERMISSIVE_JSON_SCHEMA_VALIDATOR); callers decide what a refusal means. The
   * one client-side shape check the SDK still applies is the -32600 case below:
   * a non-error result with no `structuredContent` on a tool that declares an
   * output schema.
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
      // Reset and retry only for a genuine connection-level failure (see
      // `OfficialMcpError.retryable`). Everything else leaves the shared
      // transport alone:
      //  - A request timeout only rejects that one request's own promise —
      //    the SDK's Protocol tracks timeouts per message id and never tears
      //    down the transport for one (see shared/protocol.js: `cancel()`
      //    rejects a single response handler; `_onclose()`, which rejects
      //    every pending request, only runs when the transport itself
      //    closes). Resetting here would abort any other call still in
      //    flight on the same connection.
      //  - An HTTP status (401/404/429/500/503/…) or a JSON-RPC error means
      //    the request reached n8n and may have already mutated state;
      //    retrying it would risk duplicating that side effect, and the
      //    connection it arrived on is still healthy.
      if (!mapped.retryable) throw mapped;
      if (state.generation !== undefined) await this.resetTransport(state.generation);
      // Require that this client has connected successfully before, so a
      // first-ever call against an unreachable endpoint fails fast instead
      // of doubling the wait.
      //
      // Even a connection-level failure is only safe to retry for a call the
      // caller declared idempotent. "No HTTP status" does not mean "no
      // request reached n8n": a socket that dies while the response is being
      // read leaves a create_agent/publish_agent/call_agent that already ran
      // on the instance, and a blind retry would run it twice.
      if (!this.hasConnectedSuccessfully || opts.idempotent !== true) throw mapped;
      try {
        return await attempt();
      } catch (again) {
        const mappedAgain = mapOfficialTransportError(again);
        if (mappedAgain.retryable && state.generation !== undefined) {
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
   *
   * `tool` is the name resolved against the connected instance's tool list by
   * the caller; the default only serves the probe and the tests, so an
   * instance that renames or aliases the tool still reaches it.
   */
  async reference(tool: string = 'get_agent_builder_reference'): Promise<AgentBuilderReference> {
    if (this.ref && Date.now() - this.ref.at < OFFICIAL_MCP_CACHE_TTL_MS) return this.ref.value;
    const result = await this.callTool(tool, {}, { idempotent: true });
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
    await closeTransport(client, pinned);
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
