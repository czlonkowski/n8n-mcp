/**
 * Thin adapter exposing n8n's instance-level Agent tools as `n8n_manage_agents`.
 *
 * Validates the action/timeout envelope, resolves the current alias for the
 * requested action against the connected instance's tool list, forwards
 * `args` verbatim to the official tool, and maps the official response
 * shapes onto this server's response envelope. All business logic for
 * *what* an action does lives in n8n's own MCP server; this file only
 * translates between the two contracts.
 */
import { z } from 'zod';
import { InstanceContext } from '../types/instance-context';
import { McpToolResponse } from '../types/n8n-api';
import { getOfficialMcpClient, notConfiguredResponse, officialFailure, officialErrorText } from './official-mcp-access';
import {
  AGENT_ACTION_MAP,
  AGENT_ACTIONS,
  AgentAction,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  resolveOfficialTool,
} from './agents-action-map';
import { N8nOfficialMcpClient, OfficialMcpError, OFFICIAL_MCP_HINTS, OfficialToolResult } from '../services/n8n-official-mcp-client';
import { AGENT_SUPPORTED_CREDENTIAL_TYPES, AGENT_UNSUPPORTED_CREDENTIAL_TYPES } from '../constants/agent-model-providers';
import { getN8nApiClient } from './handlers-n8n-manager';
import { logger } from '../utils/logger';

// Strict at the top level so a misspelled envelope key (`arg`, `timeOutMs`)
// is reported as INVALID_ARGS naming the key, instead of being dropped and
// producing a confusing failure from n8n. `args` itself stays an opaque
// record — its contents belong to n8n's own tool schemas.
const inputSchema = z.object({
  action: z.enum(AGENT_ACTIONS as [AgentAction, ...AgentAction[]]),
  args: z.record(z.string(), z.unknown()).optional().default({}),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
}).strict();

/** Official `{ok:false, code}` → this server's error code and a fixed, non-interpolated hint. */
const OFFICIAL_CODE_MAP: Record<string, { code: string; hint: string }> = {
  stale_config: {
    code: 'STALE_CONFIG',
    hint: 'The agent config changed since baseConfigHash was read. Call action=get and retry the mutate with the returned configHash.',
  },
  agent_misconfigured: {
    code: 'AGENT_NOT_RUNNABLE',
    hint: 'Run action=validate and fix the listed errors/missing items before calling or publishing.',
  },
  agent_tool_error: {
    code: 'AGENT_TOOL_ERROR',
    hint: "n8n's agent tooling reported an error — see officialError.error. Typical causes: unknown agentId, or a custom tool that failed to compile (TypeScript; only @n8n/agents and zod imports).",
  },
};

function invalid(action: string | undefined, message: string): McpToolResponse {
  return { success: false, action, code: 'INVALID_ARGS', error: message };
}

/**
 * Resolves the credential id implicated by a "missing credential" outcome,
 * from the official result alone — `args` never carries a credential id for
 * any agent tool (e.g. `validate_agent`'s schema is `{agentId}` with
 * `additionalProperties:false`, so an `args.credential` would be rejected
 * by n8n before ever reaching this code).
 *
 * Source (a): `data.config.credential` — present on `get_agent` results and
 * on any other result that happens to echo the config back (`config.model`
 * is the model string; `credential` is its sibling field, not nested under
 * it — see docs/local/official-agent-tools-2026-08-27/spike-log-3-azure-incompatible.json
 * `get_agent` result: `config:{model:"azure-openai/gpt-5.4-mini", credential:"fFdF…"}`).
 * Source (b): when (a) is absent but the result reports `missing:["credential"]`
 * and `args.agentId` is known, one best-effort `get_agent` lookup to read the
 * same field from the agent's current config. Any failure here (including no
 * `agentId`) means no hint — the original official result is returned as-is.
 */
async function credentialIdFromResult(args: Record<string, unknown>, data: unknown, client: N8nOfficialMcpClient): Promise<string | undefined> {
  const direct = (data as any)?.config?.credential;
  if (typeof direct === 'string') return direct;
  const agentId = args.agentId;
  if (typeof agentId !== 'string') return undefined;
  try {
    const result = await client.callTool('get_agent', { agentId }, { timeoutMs: DEFAULT_TIMEOUT_MS, idempotent: true });
    const credential = (result.json as any)?.config?.credential;
    return typeof credential === 'string' ? credential : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attaches a hint when a result (success or failure alike — `call_agent`
 * reports this same condition as `isError:true` with `code:"agent_misconfigured"`,
 * per spike-log-3) reports a missing credential and that credential is a
 * type the agents runtime is known not to accept. Result-shape-based (keys
 * off `missing`, not `isError`). Never interpolates anything from the
 * official result itself beyond the credential id/type — both are opaque
 * identifiers, not free text.
 */
async function credentialTypeHint(args: Record<string, unknown>, data: unknown, client: N8nOfficialMcpClient, context?: InstanceContext): Promise<string | undefined> {
  const missing = (data as any)?.missing;
  if (!Array.isArray(missing) || !missing.includes('credential')) return undefined;
  const credentialId = await credentialIdFromResult(args, data, client);
  if (!credentialId) return undefined;
  // Only look the credential up when this request's own context can: with no
  // context at all the env instance IS the target, but a context carrying
  // only an MCP token must not fall through to the operator's N8N_API_KEY
  // just to decorate a hint.
  if (context && !context.n8nApiKey) return undefined;
  const api = getN8nApiClient(context);
  if (!api) return undefined;
  try {
    const credential = await api.getCredential(credentialId);
    const reason = AGENT_UNSUPPORTED_CREDENTIAL_TYPES[credential.type];
    if (!reason) return undefined;
    return `Credential ${credentialId} is type ${credential.type}, which n8n's agents runtime does not accept (${reason}). Use a credential of one of these types: ${AGENT_SUPPORTED_CREDENTIAL_TYPES.join(', ')}.`;
  } catch {
    return undefined; // no credential scope, or not found: the official result stands on its own
  }
}

export async function handleManageAgents(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return invalid((args as any)?.action, parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  }
  const { action, args: toolArgs, timeoutMs } = parsed.data;
  const client = getOfficialMcpClient(context);
  if (!client) return notConfiguredResponse(context, action);

  const spec = AGENT_ACTION_MAP[action];
  try {
    const caps = await client.capabilities();
    if (!caps.reachable) {
      return officialFailure(new OfficialMcpError(caps.error ?? 'OFFICIAL_MCP_TRANSPORT_ERROR', 'n8n MCP server is not reachable'), action);
    }
    const tool = resolveOfficialTool(spec, caps.toolNames);
    if (!tool) {
      return officialFailure(
        new OfficialMcpError('OFFICIAL_MCP_TOOL_UNAVAILABLE', `No tool for action "${action}" on this instance (looked for ${spec.tools.join(', ')})`),
        action
      );
    }

    // `reference` goes through the same alias resolution as everything else
    // (an instance without the tool must answer OFFICIAL_MCP_TOOL_UNAVAILABLE,
    // not a transport error), then through the client's own cache of the
    // guide, which is large and static.
    if (action === 'reference') {
      return { success: true, action, officialTool: tool, data: await client.reference(tool) };
    }

    const result: OfficialToolResult = await client.callTool(tool, toolArgs, { timeoutMs: timeoutMs ?? spec.defaultTimeoutMs, idempotent: spec.idempotent });
    const data = result.json ?? result.text;

    // "Input validation error" is the literal prefix n8n's MCP server puts on
    // an arguments-rejected response (observed on n8n 2.36.7 — see the spike
    // logs under docs/local/official-agent-tools-2026-08-27/). If n8n changes
    // that wording, invalid args stop mapping to INVALID_ARGS and degrade to
    // OFFICIAL_MCP_ERROR; nothing else breaks.
    // Error text is capped at 2000 chars — n8n's error text is untrusted output.
    if (result.text.startsWith('Input validation error')) return invalid(action, result.text.slice(0, 2000));

    const officialCode = (data as any)?.ok === false ? (data as any)?.code : undefined;
    if (result.isError || officialCode) {
      const mapped = officialCode && OFFICIAL_CODE_MAP[officialCode];
      const response: McpToolResponse = {
        success: false,
        action,
        officialTool: tool,
        code: mapped?.code ?? 'OFFICIAL_MCP_ERROR',
        error: officialErrorText(data, officialCode),
        officialError: data,
      };
      // A credential-type hint (derived from the result itself) takes
      // precedence over the generic mapped hint when both apply.
      const credHint = await credentialTypeHint(toolArgs, data, client, context);
      const hint = credHint ?? mapped?.hint;
      if (hint) response.hint = hint;
      return response;
    }

    const response: McpToolResponse = { success: true, action, officialTool: tool, data };
    if (result.truncated) response.truncated = true;
    const hint = await credentialTypeHint(toolArgs, data, client, context);
    if (hint) response.hint = hint;
    return response;
  } catch (err) {
    const failure = officialFailure(err, action);
    if (failure.code === 'OFFICIAL_MCP_TIMEOUT' && action === 'call') {
      failure.hint = OFFICIAL_MCP_HINTS.OFFICIAL_MCP_TIMEOUT + ' Each agent turn is one n8n execution; the executionId appears in n8n_executions once the turn finishes.';
    }
    // Never log args or results — action and error code only.
    logger.warn('n8n_manage_agents failed', { action, code: failure.code });
    return failure;
  }
}
