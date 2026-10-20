/**
 * Deployment policy for tools and their operations, parsed from the
 * `DISABLED_TOOLS` and `DISABLED_TOOL_OPERATIONS` environment variables.
 *
 * Extracted from `N8NDocumentationMCPServer` so handlers (and services such as
 * `mcp-exposure`) can consult the same policy without importing the server.
 * `server.ts` re-uses these functions and keeps its own per-instance caches on
 * top; the parsing, the safety limits and the operator-facing warnings all live
 * here.
 *
 * Caching is keyed on the raw environment value rather than "parsed once":
 * environment variables do not change at runtime in production, but tests set
 * them per case and a value-keyed cache stays correct for both.
 */
import { logger } from '../utils/logger';
import {
  n8nManagementTools,
  TOOL_OPERATION_PARAM,
  TOOL_OPERATION_DEFAULT,
  DESTRUCTIVE_TOOL_OPERATIONS,
} from './tools-n8n-manager';

const MAX_ENV_LENGTH = 10000;
const MAX_DISABLED_TOOLS = 200;
const MAX_OPERATION_ENTRIES = 50;

let disabledToolsCache: { env: string; value: Set<string> } | null = null;
let disabledOperationsCache: { env: string; value: Map<string, Set<string>> } | null = null;

/**
 * Parse `DISABLED_TOOLS` into the set of tool names to filter out of
 * registration and refuse at call time.
 *
 * Safety limits: at most 10KB of environment value, at most 200 tool names.
 */
export function getDisabledTools(): Set<string> {
  const env = process.env.DISABLED_TOOLS || '';
  if (disabledToolsCache?.env === env) return disabledToolsCache.value;

  if (!env) {
    disabledToolsCache = { env, value: new Set() };
    return disabledToolsCache.value;
  }

  let raw = env;
  if (raw.length > MAX_ENV_LENGTH) {
    logger.warn(`DISABLED_TOOLS environment variable too long (${raw.length} chars), truncating to ${MAX_ENV_LENGTH}`);
    raw = raw.substring(0, MAX_ENV_LENGTH);
  }

  let tools = raw
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  if (tools.length > MAX_DISABLED_TOOLS) {
    logger.warn(`DISABLED_TOOLS contains ${tools.length} tools, limiting to first ${MAX_DISABLED_TOOLS}`);
    tools = tools.slice(0, MAX_DISABLED_TOOLS);
  }

  if (tools.length > 0) {
    logger.info(`Disabled tools configured: ${tools.join(', ')}`);
  }

  disabledToolsCache = { env, value: new Set(tools) };
  return disabledToolsCache.value;
}

/** Whether the whole tool is disabled by `DISABLED_TOOLS`. */
export function isToolDisabled(toolName: string): boolean {
  return getDisabledTools().has(toolName);
}

/**
 * Every operation value a `DISABLED_TOOL_OPERATIONS` entry may name for a tool:
 * the schema enum for its operation parameter, UNION its destructive-operation
 * set.
 *
 * The union matters for virtual operations — entries in
 * `DESTRUCTIVE_TOOL_OPERATIONS` that are not selectable values of the operation
 * parameter (`expose`, which stands for "enabling Available in MCP through
 * exposeToMcp"). Without the union they would be reported as invalid and would
 * also be invisible to the read-only annotation recompute, which would then
 * call a tool read-only while a write path was still reachable.
 */
export function getValidOperations(toolName: string): Set<string> {
  const paramName = TOOL_OPERATION_PARAM[toolName];
  const valid = new Set<string>();
  if (!paramName) return valid;

  const tool = n8nManagementTools.find(t => t.name === toolName);
  const enumValues: unknown[] = (tool?.inputSchema as any)?.properties?.[paramName]?.enum ?? [];
  for (const value of enumValues) valid.add(String(value).toLowerCase());
  for (const value of DESTRUCTIVE_TOOL_OPERATIONS[toolName] ?? []) valid.add(value.toLowerCase());
  return valid;
}

/**
 * Parse `DISABLED_TOOL_OPERATIONS` into a map of tool name -> disabled
 * operation names (lowercased).
 *
 * Format: semicolon-separated `<tool_name>:<comma_separated_operations>`, e.g.
 * `n8n_workflow_versions:delete,rollback,prune;n8n_executions:delete`.
 *
 * Safety limits mirror `DISABLED_TOOLS`: 10KB of environment value, 50 entries.
 */
export function getDisabledToolOperations(): Map<string, Set<string>> {
  const env = process.env.DISABLED_TOOL_OPERATIONS || '';
  if (disabledOperationsCache?.env === env) return disabledOperationsCache.value;

  const result = new Map<string, Set<string>>();
  if (!env) {
    disabledOperationsCache = { env, value: result };
    return result;
  }

  let raw = env;
  if (raw.length > MAX_ENV_LENGTH) {
    logger.warn(`DISABLED_TOOL_OPERATIONS environment variable too long (${raw.length} chars), truncating to ${MAX_ENV_LENGTH}`);
    raw = raw.substring(0, MAX_ENV_LENGTH);
  }

  let entries = raw.split(';').map(e => e.trim()).filter(Boolean);

  if (entries.length > MAX_OPERATION_ENTRIES) {
    logger.warn(`DISABLED_TOOL_OPERATIONS contains ${entries.length} entries, limiting to first ${MAX_OPERATION_ENTRIES}`);
    entries = entries.slice(0, MAX_OPERATION_ENTRIES);
  }

  for (const entry of entries) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) continue;

    const toolName = entry.substring(0, colonIdx).trim();
    const opsStr = entry.substring(colonIdx + 1).trim();

    if (!toolName || !opsStr) continue;

    // Lowercase ops so matching is case-insensitive and consistent with the
    // (lowercase) operation enum values used for schema stripping and dispatch.
    const ops = opsStr.split(',').map(o => o.trim().toLowerCase()).filter(Boolean);
    if (ops.length === 0) continue;

    const existing = result.get(toolName) ?? new Set<string>();
    ops.forEach(op => existing.add(op));
    result.set(toolName, existing);
  }

  // Warn (don't fail) on entries that can never match, so a typo such as
  // `n8n_execution:delete` (wrong tool) or `n8n_executions:remove` (wrong op)
  // is visible rather than silently leaving an operation enabled.
  for (const [toolName, ops] of result) {
    if (!TOOL_OPERATION_PARAM[toolName]) {
      logger.warn(`DISABLED_TOOL_OPERATIONS: unknown tool '${toolName}' — no per-operation filtering applied. Eligible tools: ${Object.keys(TOOL_OPERATION_PARAM).join(', ')}`);
      continue;
    }
    const paramName = TOOL_OPERATION_PARAM[toolName];
    const validOps = getValidOperations(toolName);
    for (const op of ops) {
      if (validOps.size > 0 && !validOps.has(op)) {
        logger.warn(`DISABLED_TOOL_OPERATIONS: '${op}' is not a valid ${paramName} for '${toolName}' (valid: ${[...validOps].join(', ')}); it will have no effect.`);
      }
    }
  }

  if (result.size > 0) {
    const summary = [...result.entries()]
      .map(([t, ops]) => `${t}: [${[...ops].join(', ')}]`)
      .join('; ');
    logger.info(`Disabled tool operations configured: ${summary}`);
  }

  disabledOperationsCache = { env, value: result };
  return result;
}

/** The disabled operations for one tool (lowercased); empty when none. */
export function getDisabledOperations(toolName: string): Set<string> {
  return getDisabledToolOperations().get(toolName) ?? new Set<string>();
}

/**
 * The operation a call will actually run, as the policy gate must see it.
 *
 * The handlers' operation parameters are `optionalEmptyAware`, so a blank or
 * whitespace-only value from a lossy MCP client is mapped to `undefined` by Zod
 * and then resolved to the tool's default. The policy gate runs before Zod, so
 * it has to apply the same normalisation — otherwise `method: ''` would present
 * itself as "no operation named" to the gate and run as the default operation
 * in the handler, sidestepping a rule that names that default.
 *
 * Returns `undefined` when no operation can be determined (no value and no
 * default), which the gate treats as "nothing to check".
 */
export function resolveRequestedOperation(toolName: string, args: any): unknown {
  const paramName = TOOL_OPERATION_PARAM[toolName];
  if (!paramName) return undefined;

  const raw = args?.[paramName];
  if (raw === undefined || raw === null) return TOOL_OPERATION_DEFAULT[toolName];
  if (typeof raw === 'string' && raw.trim() === '') return TOOL_OPERATION_DEFAULT[toolName];
  return raw;
}

/** Whether one operation of a tool is disabled by server policy. */
export function isOperationDisabled(toolName: string, operation: string): boolean {
  return getDisabledOperations(toolName).has(String(operation).toLowerCase());
}

/** Drops the parsed-policy caches. Tests use this after changing the environment. */
export function resetToolPolicyCache(): void {
  disabledToolsCache = null;
  disabledOperationsCache = null;
}
