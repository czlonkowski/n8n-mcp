/**
 * Client registry for n8n's instance-level MCP server.
 *
 * Resolves configuration (instance context first, environment as a
 * fallback only when there is no instance context at all), caches
 * connected `N8nOfficialMcpClient` instances per endpoint+token+instance,
 * and provides the two failure envelopes shared by every official-MCP-backed
 * tool handler (not configured / transport or protocol error).
 */
import { InstanceContext } from '../types/instance-context';
import { getOfficialMcpConfig, getOfficialMcpConfigFromContext, OfficialMcpConfig } from '../config/n8n-api';
import { N8nOfficialMcpClient, OfficialMcpError, OFFICIAL_MCP_HINTS, mapOfficialTransportError } from '../services/n8n-official-mcp-client';
import { createCacheKey, createInstanceCache, cacheMetrics } from '../utils/cache-utils';
import { logger } from '../utils/logger';

export interface OfficialMcpFailure {
  success: false;
  action?: string;
  code: string;
  error: string;
  hint?: string;
  officialError?: unknown;
  details?: Record<string, unknown>;
}

// createInstanceCache's own dispose wrapper already records the eviction
// metric before invoking this callback, so this only handles closing the
// discarded client's transport; it never sees the disposed value again.
const clientCache = createInstanceCache<N8nOfficialMcpClient>((client, key) => {
  client.close().catch(err => logger.debug('Error closing evicted MCP client', { key: key.slice(0, 8), error: (err as Error).message }));
});

/**
 * Resolve official-MCP config for this request.
 *
 * Precedence mirrors `getN8nApiClient` (handlers-n8n-manager.ts): when the
 * instance context carries `n8nApiUrl` plus either `n8nApiKey` or a valid
 * `n8nMcpAccessToken`, it is authoritative for that request — there is no
 * environment fallback, even if the context's own token turns out to be
 * missing or invalid (that context is simply "not configured", not a
 * license to reach for the host's token). `getOfficialMcpConfigFromContext`
 * only needs `{ n8nApiUrl, n8nMcpAccessToken }`, so a context that carries a
 * token but no `n8nApiKey` is still context-authoritative.
 *
 * Only when there is no such instance context at all do environment
 * variables come into play — and even then, multi-tenant mode
 * (SECURITY, GHSA-jxx9-px88-pj69-style gate) refuses that fallback outright,
 * since a missing/incomplete tenant context must never resolve to the
 * operator's own token.
 */
export function resolveOfficialMcpConfig(context?: InstanceContext): OfficialMcpConfig | null {
  if (context?.n8nApiUrl && (context?.n8nApiKey || context?.n8nMcpAccessToken)) {
    return getOfficialMcpConfigFromContext(context);
  }
  if (process.env.ENABLE_MULTI_TENANT === 'true') {
    logger.warn('Refusing env-credential fallback for official MCP in multi-tenant mode');
    return null;
  }
  return getOfficialMcpConfig();
}

export function getOfficialMcpClient(context?: InstanceContext): N8nOfficialMcpClient | null {
  const config = resolveOfficialMcpConfig(context);
  if (!config) return null;

  const cacheKey = createCacheKey(`${config.endpoint}:${config.token}:${context?.instanceId ?? 'default'}`);
  const cached = clientCache.get(cacheKey);
  if (cached) {
    cacheMetrics.recordHit();
    return cached;
  }
  cacheMetrics.recordMiss();

  const client = new N8nOfficialMcpClient({ endpoint: config.endpoint, token: config.token, instanceId: context?.instanceId });
  clientCache.set(cacheKey, client);
  cacheMetrics.recordSet();
  // Never log the token or the full cache key — only enough of a hash
  // prefix to correlate log lines, plus the endpoint's host.
  logger.info('Created n8n MCP client', { host: new URL(config.endpoint).host, cacheKey: cacheKey.slice(0, 8) + '...' });
  return client;
}

const SETUP_HINT_MAX_LENGTH = 500;

/**
 * An embedder may supply a plain-text setup hint (e.g. a link to their own
 * onboarding page) via `context.metadata.officialMcpSetupHint`. Treated as
 * plain text only: any tag-like content is stripped and the result is
 * capped, so an embedder-supplied string can never inject markup or grow
 * unbounded into a tool response.
 */
function embedderSetupHint(context?: InstanceContext): string | undefined {
  const raw = context?.metadata?.officialMcpSetupHint;
  if (typeof raw !== 'string') return undefined;
  const stripped = raw.replace(/<[^>]*>/g, '').trim();
  if (stripped.length === 0) return undefined;
  return stripped.slice(0, SETUP_HINT_MAX_LENGTH);
}

export function notConfiguredResponse(context?: InstanceContext, action?: string): OfficialMcpFailure {
  return {
    success: false,
    action,
    code: 'NOT_CONFIGURED',
    error: 'n8n instance-level MCP access is not configured for this instance',
    hint: embedderSetupHint(context) ?? OFFICIAL_MCP_HINTS.NOT_CONFIGURED,
  };
}

/** Normalises an official error's message: only a string `message`/`error` field is trusted; everything else falls back, and the result is always capped at 2000 chars — n8n's error text is untrusted output. */
export function officialErrorText(data: unknown, officialCode: string | undefined): string {
  const obj = data as any;
  const raw =
    typeof obj?.message === 'string'
      ? obj.message
      : typeof obj?.error === 'string'
        ? obj.error
        : typeof data === 'string'
          ? data
          : `n8n returned ${officialCode ?? 'an error'}`;
  return String(raw).slice(0, 2000);
}

/** Maps an `OfficialMcpError` (or any other thrown value) to the shared failure envelope. */
export function officialFailure(err: unknown, action?: string): OfficialMcpFailure {
  const mapped = err instanceof OfficialMcpError ? err : mapOfficialTransportError(err);
  return {
    success: false,
    action,
    code: mapped.code,
    error: mapped.message,
    hint: mapped.hint,
    ...(mapped.status !== undefined ? { details: { status: mapped.status } } : {}),
  };
}

/** Closes and drops every cached client. Used by tests to reset state between cases and on server shutdown. */
export async function clearOfficialMcpClientCache(): Promise<void> {
  const clients = [...clientCache.values()];
  clientCache.clear();
  await Promise.all(clients.map(c => c.close().catch(() => undefined)));
}
