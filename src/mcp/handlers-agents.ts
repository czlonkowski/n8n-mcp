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
import { getOfficialMcpClient, notConfiguredResponse, officialFailure } from './official-mcp-access';
import {
  AGENT_ACTION_MAP,
  AGENT_ACTIONS,
  AgentAction,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  resolveOfficialTool,
} from './agents-action-map';
import { OfficialMcpError, OFFICIAL_MCP_HINTS, OfficialToolResult } from '../services/n8n-official-mcp-client';
import { AGENT_SUPPORTED_CREDENTIAL_TYPES, AGENT_UNSUPPORTED_CREDENTIAL_TYPES } from '../constants/agent-model-providers';
import { getN8nApiClient } from './handlers-n8n-manager';
import { logger } from '../utils/logger';

const inputSchema = z.object({
  action: z.enum(AGENT_ACTIONS as [AgentAction, ...AgentAction[]]),
  args: z.record(z.string(), z.unknown()).optional().default({}),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
});

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
    code: 'AGENT_TOOL_COMPILE_ERROR',
    hint: 'A custom tool failed to compile. Custom tools are TypeScript with only @n8n/agents and zod imports; fix the source in the error and re-run the customTool.upsert operation.',
  },
};

function invalid(action: string | undefined, message: string): McpToolResponse {
  return { success: false, action, code: 'INVALID_ARGS', error: message };
}

/**
 * Attaches a hint when a `validate`/`call`/`mutate` result reports a missing
 * credential and that credential is a type the agents runtime is known not
 * to accept. Result-shape-based (looks at `missing`, not `isError`): n8n
 * reports this outcome as a normal result, not a protocol-level error (see
 * docs/local/official-agent-tools-2026-08-27/spike-log-3-azure-incompatible.json).
 * Never interpolates anything from the official result itself beyond the
 * credential id/type — both are opaque identifiers, not free text.
 */
async function credentialTypeHint(args: Record<string, unknown>, data: unknown, context?: InstanceContext): Promise<string | undefined> {
  const missing = (data as any)?.missing;
  if (!Array.isArray(missing) || !missing.includes('credential')) return undefined;
  const credentialId =
    typeof args.credential === 'string'
      ? args.credential
      : typeof (data as any)?.config?.model?.credential === 'string'
        ? (data as any).config.model.credential
        : undefined;
  if (!credentialId) return undefined;
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
    if (action === 'reference') {
      const data = await client.reference();
      return { success: true, action, officialTool: spec.tools[0], data };
    }
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

    const result: OfficialToolResult = await client.callTool(tool, toolArgs, { timeoutMs: timeoutMs ?? spec.defaultTimeoutMs });
    const data = result.json ?? result.text;

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
        error:
          (data as any)?.message ??
          (data as any)?.error ??
          (typeof data === 'string' ? data.slice(0, 2000) : `n8n returned ${officialCode ?? 'an error'}`),
        officialError: data,
      };
      if (mapped?.hint) response.hint = mapped.hint;
      return response;
    }

    const response: McpToolResponse = { success: true, action, officialTool: tool, data };
    if (result.truncated) response.truncated = true;
    const hint = await credentialTypeHint(toolArgs, data, context);
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
