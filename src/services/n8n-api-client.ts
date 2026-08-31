import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { logger } from '../utils/logger';
import {
  Workflow,
  WorkflowListParams,
  WorkflowListResponse,
  Execution,
  ExecutionListParams,
  ExecutionListResponse,
  TestRunSummary,
  TestCaseExecution,
  TestRunListParams,
  TestCaseListParams,
  TestRunListResponse,
  TestCaseListResponse,
  TestRunTriggerResult,
  TestRunCancelResult,
  Credential,
  CredentialListParams,
  CredentialListResponse,
  Tag,
  TagListParams,
  TagListResponse,
  HealthCheckResponse,
  N8nVersionInfo,
  Variable,
  WebhookRequest,
  WorkflowExport,
  WorkflowImport,
  SourceControlStatus,
  SourceControlPullResult,
  SourceControlPushResult,
  DataTable,
  DataTableColumn,
  DataTableListParams,
  DataTableRow,
  DataTableRowListParams,
  DataTableInsertRowsParams,
  DataTableUpdateRowsParams,
  DataTableUpsertRowParams,
  DataTableDeleteRowsParams,
  WorkflowNodeGroup,
  Folder,
  FolderListParams,
  FolderListResponse,
  ProjectSummary,
  Project,
} from '../types/n8n-api';
import { enrichUnknownPropertyError, handleN8nApiError, logN8nError, N8nApiError, N8nValidationError } from '../utils/n8n-errors';
import { encodeApiPathSegment } from '../utils/validation-schemas';
import { cleanWorkflowForCreate, cleanWorkflowForUpdate } from './n8n-validation';
import {
  classifyGroupError,
  dropRejectedGroup,
  repairNodeGroups,
  sanitizeGroupsForApi,
  type GroupErrorClassification,
} from './node-groups';
import {
  fetchN8nVersion,
  cleanSettingsForVersion,
  getCachedVersion,
  versionAtLeast,
} from './n8n-version';
import type { PinnedAgents } from '../utils/ssrf-protection';

export interface N8nApiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  maxRetries?: number;
  cfClientId?: string;
  cfClientSecret?: string;
}

/**
 * Warnings for the two capability limits. Shared constants because they are emitted from two
 * places each — the write that discovers the limit, and every later write that already knows it.
 */
const GROUPS_UNSUPPORTED_WARNING =
  'This n8n version does not support canvas groups (added in 2.28); the workflow was saved without them.';
const GROUP_DESCRIPTIONS_UNSUPPORTED_WARNING =
  'This n8n version does not support canvas group descriptions (added in 2.32); the descriptions were not saved.';

/**
 * Statuses that mean "this instance does not serve that route". A router without the route may
 * answer 404 or 405 depending on whether it matches the path prefix before the method, and a
 * politely retired alias may answer 410 rather than disappearing outright.
 */
const ROUTE_ABSENT_STATUSES = new Set([404, 405, 410]);

/**
 * HTTP status of a failed request from this client.
 *
 * The response interceptor converts every rejection to an `N8nApiError`, which carries
 * `statusCode` and no `response`. Reading `error.response.status` on a rejection from
 * `this.client` therefore always yields undefined - which silently disables any fallback
 * keyed on a specific status. The raw-axios branch is kept for callers that bypass the
 * interceptor, such as tests.
 */
function failureStatus(error: unknown): number | undefined {
  if (error instanceof N8nApiError) return error.statusCode;
  return (error as any)?.response?.status;
}

/**
 * Whether a response carries an RFC 9745 `Deprecation` header.
 *
 * n8n sets one on the legacy activate/deactivate routes (`Deprecation: @<epoch>`), from a
 * middleware that runs before the permission checks. Its presence proves the instance knows those
 * routes are superseded, and therefore serves the routes that replaced them. The value is not
 * parsed: a deprecation date tells us nothing we act on, only the header's presence does.
 *
 * Absence proves nothing - an older n8n has no header, and a proxy may drop it - so this is only
 * ever read as a positive signal.
 */
function hasDeprecationHeader(headers: unknown): boolean {
  if (!headers || typeof headers !== 'object') return false;
  // Axios lowercases response header names, but a mock or a raw response may not.
  return Object.entries(headers as Record<string, unknown>).some(
    ([name, value]) => name.toLowerCase() === 'deprecation' && value !== undefined && value !== ''
  );
}

/** The same write payload without `nodeGroups`, for instances whose schema has no such field. */
function withoutNodeGroups(payload: Record<string, unknown>): Record<string, unknown> {
  const { nodeGroups, ...rest } = payload;
  return rest;
}

/** Options for workflow writes that carry canvas groups. */
export interface WorkflowWriteOptions {
  /**
   * Names of groups the caller authored in THIS request. These are never silently dropped: if
   * n8n rejects one, the error is surfaced instead. Groups that merely came back from a GET are
   * dropped with a warning so an unrelated edit still lands.
   */
  authoredGroups?: Set<string>;
  /** Called for each non-fatal adjustment (a pruned member, a dropped group, an unsupported field). */
  onWarning?: (message: string) => void;
}

export class N8nApiClient {
  private client: AxiosInstance;
  private maxRetries: number;
  private baseUrl: string;
  private versionInfo: N8nVersionInfo | null = null;
  private versionPromise: Promise<N8nVersionInfo | null> | null = null;
  /** Resolved `personal` project alias, cached for the client's lifetime (see resolvePersonalProjectId). */
  private personalProjectId: string | null = null;
  // SECURITY (GHSA-cmrh-wvq6-wm9r): cached pinned transport agents.
  private pinnedAgentsPromise: Promise<PinnedAgents> | null = null;
  // #978/#989/#990: when the cached agents were last (re-)resolved, so a
  // long-lived client periodically re-validates DNS instead of pinning to
  // one address (possibly a stale CDN/Cloudflare edge) for its whole life.
  private pinnedAgentsResolvedAt = 0;
  private static readonly PINNED_AGENTS_TTL_MS = 60_000;
  private cfClientId?: string;
  private cfClientSecret?: string;
  /**
   * What this instance's write schema accepts for canvas groups. Optimistic until a SCHEMA error
   * proves otherwise — semantic rejections of particular groups never touch this, or one invalid
   * group would permanently disable groups for the instance. Per-client, which is per-instance.
   */
  private groupSupport = { groups: true, descriptions: true };
  /**
   * Whether this instance is known to serve the modern publish/unpublish routes. Positive-only,
   * and per-client, which is per-instance: it is set when the instance proves the routes exist
   * and never cleared, because no response proves the opposite. See postPublishRoute.
   */
  private modernPublishRoute = false;

  constructor(config: N8nApiClientConfig) {
    const { baseUrl, apiKey, timeout = 30000, maxRetries = 3, cfClientId, cfClientSecret } = config;

    this.maxRetries = maxRetries;
    this.cfClientId = cfClientId;
    this.cfClientSecret = cfClientSecret;

    // SECURITY (GHSA-4ggg-h7ph-26qr): defense-in-depth baseUrl normalization.
    let normalizedBase: string;
    try {
      const parsed = new URL(baseUrl);
      parsed.hash = '';
      parsed.username = '';
      parsed.password = '';
      normalizedBase = parsed.toString().replace(/\/$/, '');
    } catch {
      // Unparseable input falls through to raw; downstream axios call will
      // fail cleanly. Preserves backward compat for tests that pass
      // placeholder strings.
      normalizedBase = baseUrl;
    }

    this.baseUrl = normalizedBase;

    // Ensure baseUrl ends with /api/v1
    const apiUrl = normalizedBase.endsWith('/api/v1')
      ? normalizedBase
      : `${normalizedBase}/api/v1`;

    const headers: Record<string, string> = {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
      ...this.cfAccessHeaders(),
    };

    this.client = axios.create({
      baseURL: apiUrl,
      timeout,
      headers,
      // SECURITY (GHSA-cmrh-wvq6-wm9r): no redirect-following on the
      // authenticated client; pinned agent neutralizes cross-host hops anyway.
      maxRedirects: 0,
    });

    // Request interceptor for logging + transport pinning
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // SECURITY (GHSA-cmrh-wvq6-wm9r): pin transport to validated IP.
        const agents = await this.getPinnedAgents();
        config.httpAgent = agents.httpAgent;
        config.httpsAgent = agents.httpsAgent;

        // Redact request body for credential endpoints to prevent secret leakage
        const isSensitive = config.url?.includes('/credentials') && config.method !== 'get';
        logger.debug(`n8n API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          params: config.params,
          data: isSensitive ? '[REDACTED]' : config.data,
        });
        return config;
      },
      (error: unknown) => {
        logger.error('n8n API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging + connection-failure retry
    this.client.interceptors.response.use(
      (response: any) => {
        logger.debug(`n8n API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error: unknown) => {
        // #978/#989/#990: retry connection-level failures (no response at
        // all) before mapping to N8nApiError. Re-issuing goes back through
        // this same interceptor pipeline, so a further failure is retried
        // again automatically until maxRetries is exhausted.
        const retryAttempt = this.tryRetry(error);
        if (retryAttempt) {
          return retryAttempt;
        }

        const n8nError = handleN8nApiError(error);
        if (n8nError.code === 'NO_RESPONSE') {
          // SECURITY (GHSA-cmrh-wvq6-wm9r resilience): the pinned IP may be
          // dead (CDN edge rotated, instance moved) - clear the cache so the
          // *next* request re-resolves DNS instead of retrying the same bad
          // address forever.
          this.pinnedAgentsPromise = null;
        }
        logN8nError(n8nError, 'n8n API Response');
        return Promise.reject(n8nError);
      }
    );
  }

  /**
   * Retry a connection-level axios failure (no response received) when it
   * looks safe to retry and attempts remain. Returns a promise for the
   * retried request when a retry is attempted, or `undefined` when the
   * caller should fall through to normal error mapping.
   *
   * @security GHSA-cmrh-wvq6-wm9r follow-up (#978/#989/#990) - the failure
   * may mean the pinned IP has gone stale, so the pinned-agent cache is
   * cleared before each retry to force fresh DNS resolution.
   */
  private tryRetry(error: unknown): Promise<any> | undefined {
    const axiosError = error as any;
    const config = axiosError?.config;
    const noResponse = !!(axiosError && axiosError.request && !axiosError.response);
    if (!noResponse || !config) {
      return undefined;
    }

    const retryCount = (config as any).__retryCount || 0;
    if (retryCount >= this.maxRetries) {
      return undefined;
    }

    // Default to a non-idempotent classification when the method is missing:
    // only pre-connection failures are then eligible for retry.
    const method = String(config.method || '');
    if (!this.isRetryableConnectionError(axiosError, method)) {
      return undefined;
    }

    (config as any).__retryCount = retryCount + 1;
    // Force fresh DNS on the retried attempt.
    this.pinnedAgentsPromise = null;

    const backoffMs = 250 * Math.pow(2, retryCount);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        this.client.request(config).then(resolve, reject);
      }, backoffMs);
    });
  }

  /**
   * Whether a connection-level axios error is safe to retry for the given
   * HTTP method. Errors that occurred before any bytes reached the wire
   * (connection refused/unreachable/DNS failure) are safe to retry
   * regardless of method - the server never saw the request. Errors that may
   * have interrupted an in-flight request (reset, timeout) are only retried
   * for idempotent methods.
   */
  private isRetryableConnectionError(axiosError: any, method: string): boolean {
    const codes = this.extractErrorCodes(axiosError);
    if (codes.length === 0) return false;

    const isIdempotent = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
    const anyMethodCodes = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);
    const idempotentOnlyCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED']);

    return codes.some(code => anyMethodCodes.has(code) || (isIdempotent && idempotentOnlyCodes.has(code)));
  }

  /**
   * Collect every error `code` relevant to the retry decision: the error's
   * own code, plus each member's code when the error is an AggregateError
   * (e.g. from `autoSelectFamily` trying multiple pinned addresses).
   */
  private extractErrorCodes(error: any): string[] {
    const codes: string[] = [];
    if (error?.code) codes.push(error.code);

    const aggregateMembers = error?.errors ?? error?.cause?.errors;
    if (Array.isArray(aggregateMembers)) {
      for (const member of aggregateMembers) {
        if (member?.code) codes.push(member.code);
      }
    }
    return codes;
  }

  /**
   * Resolve the configured baseUrl once and return HTTP/HTTPS agents that
   * pin every connection to the validated address(es). Re-resolved when the
   * cache is empty, has expired (TTL), or was invalidated after a
   * connection failure — see {@link tryRetry} and the NO_RESPONSE branch of
   * the response interceptor.
   *
   * @security GHSA-cmrh-wvq6-wm9r — without this, axios performs an
   * independent DNS lookup on every request, opening a TOCTOU window.
   */
  private getPinnedAgents(): Promise<PinnedAgents> {
    const isExpired = this.pinnedAgentsPromise !== null &&
      Date.now() - this.pinnedAgentsResolvedAt > N8nApiClient.PINNED_AGENTS_TTL_MS;
    if (isExpired) {
      // #978/#989/#990: don't stay pinned to a possibly-stale address (e.g.
      // a rotated CDN/Cloudflare edge) for the whole process lifetime.
      this.pinnedAgentsPromise = null;
    }

    if (!this.pinnedAgentsPromise) {
      const promise = (async () => {
        const { SSRFProtection } = await import('../utils/ssrf-protection');
        const validation = await SSRFProtection.validateWebhookUrl(this.baseUrl);
        if (!validation.valid || !validation.address || !validation.family) {
          throw new Error(`SSRF protection: ${validation.reason || 'baseUrl rejected'}`);
        }
        return SSRFProtection.createPinnedAgents(
          validation.addresses ?? [{ address: validation.address, family: validation.family }]
        );
      })();
      // Stamp at dispatch so concurrent callers during an in-flight
      // re-resolution see a fresh TTL and don't each kick off their own
      // lookup; refresh on fulfillment (only while still the current
      // promise) so the window restarts from when the addresses actually
      // became valid.
      this.pinnedAgentsResolvedAt = Date.now();
      promise.then(() => {
        if (this.pinnedAgentsPromise === promise) {
          this.pinnedAgentsResolvedAt = Date.now();
        }
      }, () => {});
      // Reset on rejection so transient DNS failures don't brick the client.
      promise.catch(() => {
        if (this.pinnedAgentsPromise === promise) {
          this.pinnedAgentsPromise = null;
        }
      });
      this.pinnedAgentsPromise = promise;
    }
    return this.pinnedAgentsPromise;
  }

  /**
   * Get the n8n version, fetching it if not already cached.
   * Uses promise-based locking to prevent concurrent requests.
   *
   * **Returns null against every n8n from 1.119.0 onward**, which in practice means every
   * instance: the version is only reachable through an internal editor route that answers
   * Public API clients without it, and the Public API exposes no version of its own. See
   * {@link fetchN8nVersion}.
   *
   * So do not gate behaviour on this. Null means "unknown", never "old", and a feature gated on
   * a minimum version here is a feature that is off for everyone. Probe the instance instead -
   * `groupSupport` and {@link postPublishRoute} read what the API actually answers - and keep the
   * unprobed path the one that works on every version.
   */
  async getVersion(): Promise<N8nVersionInfo | null> {
    // If we already have version info, return it
    if (this.versionInfo) {
      return this.versionInfo;
    }

    // If a fetch is already in progress, wait for it
    if (this.versionPromise) {
      return this.versionPromise;
    }

    // Start a new fetch with promise-based locking
    this.versionPromise = this.fetchVersionOnce();
    try {
      this.versionInfo = await this.versionPromise;
      return this.versionInfo;
    } finally {
      // Clear the promise so future calls can retry if needed
      this.versionPromise = null;
    }
  }

  /**
   * Cloudflare Access service-token headers when configured, empty object otherwise.
   */
  private cfAccessHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.cfClientId) headers['CF-Access-Client-Id'] = this.cfClientId;
    if (this.cfClientSecret) headers['CF-Access-Client-Secret'] = this.cfClientSecret;
    return headers;
  }

  /**
   * Cloudflare Access headers for axios `headers` slots that should be omitted
   * entirely when unset: the configured headers, or undefined when none apply.
   */
  private cfAccessHeadersOrUndefined(): Record<string, string> | undefined {
    const headers = this.cfAccessHeaders();
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  /**
   * Whether targetUrl shares the configured n8n instance origin. Used to confine
   * instance credentials (e.g. Cloudflare Access headers) to the instance host.
   */
  private isSameOrigin(targetUrl: string): boolean {
    try {
      return new URL(targetUrl).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }

  /**
   * Internal method to fetch version once
   */
  private async fetchVersionOnce(): Promise<N8nVersionInfo | null> {
    const cached = getCachedVersion(this.baseUrl);
    if (cached) return cached;

    // SECURITY (GHSA-cmrh-wvq6-wm9r): reuse the validated transport agents,
    // and forward any Cloudflare Access headers so the probe clears the edge.
    const agents = await this.getPinnedAgents();
    return await fetchN8nVersion(this.baseUrl, {
      headers: this.cfAccessHeadersOrUndefined(),
      pinnedAgents: agents,
    });
  }

  /**
   * Get cached version info without fetching
   */
  getCachedVersionInfo(): N8nVersionInfo | null {
    return this.versionInfo;
  }

  /**
   * Re-read the instance version, bypassing both the per-client and the shared
   * TTL cache. `versionInfo` lives as long as the client, so an instance
   * upgraded mid-session keeps reporting its old version - callers that are
   * about to blame the version for a failure need a current reading. Returns
   * null when the version cannot be read, leaving any cached value in place.
   */
  async refreshVersion(): Promise<N8nVersionInfo | null> {
    const agents = await this.getPinnedAgents();
    const version = await fetchN8nVersion(this.baseUrl, {
      headers: this.cfAccessHeadersOrUndefined(),
      pinnedAgents: agents,
      forceRefresh: true,
    });
    if (version) {
      this.versionInfo = version;
    }
    return version;
  }

  // Health check to verify API connectivity
  async healthCheck(): Promise<HealthCheckResponse> {
    try {
      // Try the standard healthz endpoint (available on all n8n instances)
      const baseUrl = this.client.defaults.baseURL || '';
      const healthzUrl = baseUrl.replace(/\/api\/v\d+\/?$/, '') + '/healthz';

      // SECURITY (GHSA-cmrh-wvq6-wm9r): pin transport for the unauthenticated probe.
      const agents = await this.getPinnedAgents();
      const response = await axios.get(healthzUrl, {
        timeout: 5000,
        // Forward Cloudflare Access headers so the probe clears the edge when the
        // instance sits behind Cloudflare Access (healthzUrl is always the instance origin).
        headers: this.cfAccessHeadersOrUndefined(),
        validateStatus: (status) => status < 500,
        maxRedirects: 0,
        httpAgent: agents.httpAgent,
        httpsAgent: agents.httpsAgent,
      });

      // Also fetch version info (will be cached)
      const versionInfo = await this.getVersion();

      if (response.status === 200 && response.data?.status === 'ok') {
        return {
          status: 'ok',
          n8nVersion: versionInfo?.version,
          features: {}
        };
      }

      // If healthz doesn't work, fall back to API check
      throw new Error('healthz endpoint not available');
    } catch (error) {
      // If healthz endpoint doesn't exist, try listing workflows with limit 1
      // This is a fallback for older n8n versions
      try {
        await this.client.get('/workflows', { params: { limit: 1 } });

        // Still try to get version
        const versionInfo = await this.getVersion();

        return {
          status: 'ok',
          n8nVersion: versionInfo?.version,
          features: {}
        };
      } catch (fallbackError) {
        throw handleN8nApiError(fallbackError);
      }
    }
  }

  /**
   * Send a workflow write. This is the one seam where the outgoing body is still in scope when
   * n8n rejects it, so an unlocatable "must NOT have additional properties" 400 is enriched here
   * with the keys that were sent (#1047) before it propagates to the handlers.
   *
   * The group ladder can retry with a different body than the caller's payload (groups dropped,
   * or the field omitted when the instance is known not to support it), so each failed attempt
   * records the body it actually sent and the enrichment reports that one — never a key the
   * failing request did not carry. handleN8nApiError returns an existing N8nApiError unchanged,
   * so the ladder's own mapping rethrows the same tracked instance.
   */
  private async sendWorkflowWrite(
    payload: Record<string, unknown>,
    send: (body: Record<string, unknown>) => Promise<Workflow>,
    options: WorkflowWriteOptions
  ): Promise<Workflow> {
    const sentBodies = new WeakMap<N8nApiError, Record<string, unknown>>();
    const trackedSend = async (body: Record<string, unknown>): Promise<Workflow> => {
      try {
        return await send(body);
      } catch (error) {
        const apiError = handleN8nApiError(error);
        sentBodies.set(apiError, body);
        throw apiError;
      }
    };
    try {
      return await this.sendWorkflowWriteWithGroupFallback(payload, trackedSend, options);
    } catch (error) {
      const apiError = handleN8nApiError(error);
      const enriched = enrichUnknownPropertyError(apiError, sentBodies.get(apiError) ?? payload);
      if (enriched !== apiError) {
        // The axios interceptor has already logged n8n's generic message; without this
        // line the key list reaches only the MCP caller, never the server logs (#1047).
        logger.warn('n8n rejected a workflow write with an unnamed additional property', {
          message: enriched.message
        });
      }
      throw enriched;
    }
  }

  /**
   * Send a workflow write, degrading `nodeGroups` only as far as the instance forces.
   *
   * n8n validates canvas groups on every write and names the offending group when it rejects one,
   * so the server — not a local copy of its rules — decides what is valid. The ladder is:
   *
   *   1. group schema has no `description` (n8n 2.28–2.31)  -> strip descriptions, retry
   *   2. workflow schema has no `nodeGroups` (before 2.28)  -> omit the field, retry
   *   3. a named group is invalid and was NOT authored here -> drop that group, retry
   *   4. a named group is invalid and WAS authored here     -> surface n8n's message
   *   5. groups rejected without naming one                 -> send [] (ungroup all), retry
   *
   * Omitting the field is not a fix for case 3: n8n backfills the stored groups when the field is
   * absent, so the same rejection returns. Each attempt must make progress or the loop stops.
   */
  private async sendWorkflowWriteWithGroupFallback(
    payload: Record<string, unknown>,
    send: (body: Record<string, unknown>) => Promise<Workflow>,
    options: WorkflowWriteOptions
  ): Promise<Workflow> {
    if (!Array.isArray(payload.nodeGroups)) {
      return await send(payload);
    }

    // Known-unsupported from an earlier write against this instance. Warn EVERY time, not just on
    // the write that discovered it: this client outlives a single request, so a caller authoring a
    // brand-new grouping later in the session would otherwise get plain success and no group.
    if (!this.groupSupport.groups) {
      options.onWarning?.(GROUPS_UNSUPPORTED_WARNING);
      return await send(withoutNodeGroups(payload));
    }

    let groups = sanitizeGroupsForApi(payload.nodeGroups, {
      includeDescription: this.groupSupport.descriptions,
    });

    // Same reasoning for descriptions, but only worth saying when one was actually supplied.
    if (
      !this.groupSupport.descriptions &&
      (payload.nodeGroups as WorkflowNodeGroup[]).some(group => group?.description !== undefined)
    ) {
      options.onWarning?.(GROUP_DESCRIPTIONS_UNSUPPORTED_WARNING);
    }

    // Bounded: each iteration must remove a group, strip descriptions, or drop the field.
    const maxAttempts = groups.length + 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await send({ ...payload, nodeGroups: groups });
      } catch (error) {
        const apiError = handleN8nApiError(error);
        const next = this.degradeGroupsAfterRejection(
          classifyGroupError(apiError),
          groups,
          options
        );

        if (next === 'give-up') throw apiError;

        if (next === 'omit-field') {
          // n8n could not say WHICH unknown property it rejected, so find out: send the same body
          // without nodeGroups. Success means the field was the culprit and this instance predates
          // it — worth remembering. Failure means something else in the body was wrong, so the
          // original complaint is the honest answer and the capability memo stays untouched.
          let result: Workflow;
          try {
            result = await send(withoutNodeGroups(payload));
          } catch {
            throw apiError;
          }
          this.groupSupport.groups = false;
          options.onWarning?.(GROUPS_UNSUPPORTED_WARNING);
          return result;
        }

        groups = next;
      }
    }

    // Unreachable in practice: every branch above either returns, throws, or shrinks the payload.
    throw new Error('Could not save workflow: n8n kept rejecting its canvas groups');
  }

  /**
   * Decide how to retry after n8n rejected a write, per the ladder in sendWorkflowWriteWithGroupFallback:
   * the groups to send next, `omit-field` to send no groups at all, or `give-up` to surface n8n's error.
   */
  private degradeGroupsAfterRejection(
    classification: GroupErrorClassification,
    groups: WorkflowNodeGroup[],
    options: WorkflowWriteOptions
  ): WorkflowNodeGroup[] | 'omit-field' | 'give-up' {
    const warn = (message: string) => options.onWarning?.(message);
    const authored = options.authoredGroups ?? new Set<string>();

    if (classification.kind === 'schema-description' && this.groupSupport.descriptions) {
      this.groupSupport.descriptions = false;
      warn(GROUP_DESCRIPTIONS_UNSUPPORTED_WARNING);
      return sanitizeGroupsForApi(groups, { includeDescription: false });
    }

    // Deliberately does not latch groupSupport or warn: whether the field really is the problem is
    // only known once the retry without it succeeds. sendWorkflowWriteWithGroupFallback records it there.
    if (classification.kind === 'schema-field') return 'omit-field';

    if (classification.kind !== 'semantic') return 'give-up';

    const { groupName, groupId } = classification;

    if (groupName || groupId) {
      const { groups: remaining, dropped } = dropRejectedGroup(groups, { groupId, groupName });

      // Never silently discard a group the caller asked for in this request.
      if (dropped && authored.has(dropped.name)) return 'give-up';

      if (dropped) {
        warn(
          `n8n rejected node group "${dropped.name}", so it was ungrouped to save the workflow (nodes and connections are unchanged). n8n said: ${classification.message}`
        );
        return remaining;
      }

      // n8n identified a group we do not hold — most likely its message did not survive matching
      // (a quote in the name). Surface its error rather than guess which group to destroy.
      return 'give-up';
    }

    // n8n complained about groups without naming any. Drop the inherited ones and keep whatever the
    // caller authored: if that is still rejected, the next pass surfaces the error instead of
    // destroying content the caller explicitly asked for.
    const keepAuthored = groups.filter(group => authored.has(group.name));
    if (keepAuthored.length < groups.length) {
      warn(
        `n8n rejected the canvas groups on this workflow, so ${keepAuthored.length > 0 ? 'the ones it did not ask about were' : 'all of them were'} removed to save it (nodes and connections are unchanged). n8n said: ${classification.message}`
      );
      return keepAuthored;
    }

    return 'give-up';
  }

  /** Save a workflow with PUT, falling back to PATCH on n8n versions that answer PUT with 405. */
  private async putOrPatchWorkflow(
    safeId: string,
    body: Record<string, unknown>
  ): Promise<Workflow> {
    try {
      const response = await this.client.put(`/workflows/${safeId}`, body);
      return response.data;
    } catch (putError: any) {
      if (failureStatus(putError) !== 405) throw putError;
      logger.debug('PUT method not supported, falling back to PATCH');
      const response = await this.client.patch(`/workflows/${safeId}`, body);
      return response.data;
    }
  }

  /**
   * Prune canvas-group members that no longer exist and report what changed. Runs on every write
   * so it also covers rollbacks and version restores, whose snapshots can predate a node deletion.
   */
  private repairGroupsForWrite(
    payload: Record<string, unknown>,
    options: WorkflowWriteOptions
  ): Record<string, unknown> {
    // A payload without `nodes` says nothing about which nodes exist — treating that as "none" would
    // prune every group. Callers always merge over a GET today; this keeps that assumption explicit.
    if (!Array.isArray(payload.nodeGroups) || !Array.isArray(payload.nodes)) return payload;

    const { nodeGroups, issues, errors } = repairNodeGroups(
      {
        nodes: payload.nodes as Workflow['nodes'],
        nodeGroups: payload.nodeGroups as Workflow['nodeGroups'],
      },
      { authoredGroups: options.authoredGroups }
    );

    // A group the caller authored in this request referencing a node that does not exist is a
    // mistake in the request, not something to repair silently — n8n would have said the same.
    if (errors && errors.length > 0) {
      throw new N8nValidationError(errors.join(' '), { nodeGroups: errors });
    }

    for (const issue of issues) {
      options.onWarning?.(issue.message);
    }

    return nodeGroups === payload.nodeGroups ? payload : { ...payload, nodeGroups };
  }

  // Workflow Management
  async createWorkflow(
    workflow: Partial<Workflow>,
    options: WorkflowWriteOptions = {}
  ): Promise<Workflow> {
    try {
      const cleanedWorkflow = cleanWorkflowForCreate(workflow) as Record<string, unknown>;
      const payload = this.repairGroupsForWrite(cleanedWorkflow, options);
      return await this.sendWorkflowWrite(
        payload,
        async body => (await this.client.post('/workflows', body)).data,
        options
      );
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async getWorkflow(id: string): Promise<Workflow> {
    try {
      const response = await this.client.get(`/workflows/${encodeApiPathSegment(id, 'workflowId')}`);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateWorkflow(
    id: string,
    workflow: Partial<Workflow>,
    options: WorkflowWriteOptions = {}
  ): Promise<Workflow> {
    try {
      // Step 1: Basic cleaning (remove read-only fields, filter to known settings)
      const cleanedWorkflow = cleanWorkflowForUpdate(workflow as Workflow);

      // Step 2: Version-aware settings filtering for older n8n compatibility
      // This prevents "additional properties" errors on n8n < 1.119.0
      const versionInfo = await this.getVersion();
      if (versionInfo) {
        logger.debug(`Updating workflow with n8n version ${versionInfo.version}`);
        // Apply version-specific filtering to settings
        cleanedWorkflow.settings = cleanSettingsForVersion(
          cleanedWorkflow.settings as Record<string, unknown>,
          versionInfo
        );
      } else {
        // The normal case since n8n 1.119.0 (see getVersion). Settings are forwarded untouched;
        // n8n rejects anything it does not accept, which reads better than dropping it silently.
        logger.debug('n8n version unknown, forwarding workflow settings unfiltered');
      }

      const safeId = encodeApiPathSegment(id, 'workflowId');
      const payload = this.repairGroupsForWrite(
        cleanedWorkflow as Record<string, unknown>,
        options
      );

      // Canvas-group degradation is independent of the method fallback: it inspects only
      // 400 responses, while the fallback reacts to 405.
      return await this.sendWorkflowWrite(
        payload,
        body => this.putOrPatchWorkflow(safeId, body),
        options
      );
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteWorkflow(id: string): Promise<Workflow> {
    try {
      const response = await this.client.delete(`/workflows/${encodeApiPathSegment(id, 'workflowId')}`);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async transferWorkflow(id: string, destinationProjectId: string): Promise<void> {
    try {
      await this.client.put(`/workflows/${encodeApiPathSegment(id, 'workflowId')}/transfer`, { destinationProjectId });
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  /**
   * POST the publish-family route a workflow needs, preferring the name the target n8n uses.
   *
   * n8n 2.33 renamed `/activate` to `/publish` and `/deactivate` to `/unpublish`, and marked the
   * old pair deprecated (2026-07-23). The deprecated routes are literal aliases of the new
   * handlers — same service call, same result — so this is a rename, not a behaviour change.
   * `/publish` additionally accepts an optional body naming a version to publish; we send none,
   * which keeps the semantics identical to `/activate`.
   *
   * The new route is used only when the instance is *confirmed* to have it. The legacy pair
   * works on every supported version - on 2.33+ they are the same handler - so an unconfirmed
   * instance is served by the legacy route rather than probed, which would waste a request per
   * call on every pre-2.33 instance.
   *
   * Confirmation comes from the instance, not from a version number, because version detection
   * returns null on every n8n from 1.119.0 (see {@link getVersion}). Two things confirm it, both
   * one-way: a `Deprecation` header on a legacy response, which only an n8n that has the
   * replacement sends, and a fallback to the modern route that succeeds. A version reading is
   * still honoured when one is somehow available.
   *
   * The fallback runs in both directions on a 404, 405 or 410. A router with no route may report
   * either, depending on whether it matches the path prefix before the method; n8n answers 405
   * here, so keying on 404 alone left the fallback dead in practice. Symmetry matters because
   * the legacy routes are deprecated (2026-07-23, no sunset announced): when n8n eventually
   * removes them, an instance we could not version-detect would otherwise lose activation
   * entirely, rather than moving to the route that replaced it.
   *
   * The cost is one extra request on a workflow id that does not exist, since n8n answers 404
   * for an absent workflow and an absent route alike. Both attempts end in the same error. That
   * also costs the confirmation: the response interceptor keeps a failure's status but not its
   * headers, so only a legacy call that succeeds can carry the deprecation signal.
   */
  private async postPublishRoute(
    id: string,
    modernPath: 'publish' | 'unpublish',
    legacyPath: 'activate' | 'deactivate'
  ): Promise<Workflow> {
    const safeId = encodeApiPathSegment(id, 'workflowId');
    let preferModern = this.modernPublishRoute;
    if (!preferModern) {
      // Only read while the routes are unconfirmed: once they are, no version could change the
      // choice, and asking costs a request every time the version cache has expired.
      const version = await this.getVersion();
      preferModern = version !== null && versionAtLeast(version, 2, 33, 0);
    }
    const [primaryPath, fallbackPath] = preferModern
      ? [modernPath, legacyPath]
      : [legacyPath, modernPath];
    const post = async (path: string): Promise<Workflow> => {
      const response = await this.client.post(`/workflows/${safeId}/${path}`, {});
      if (path === legacyPath && hasDeprecationHeader(response.headers)) {
        this.confirmModernPublishRoute(`/${legacyPath} answered with a Deprecation header`);
      }
      return response.data;
    };
    let status: number | undefined;

    let primaryError: unknown;
    try {
      return await post(primaryPath);
    } catch (error: any) {
      status = failureStatus(error);
      if (!ROUTE_ABSENT_STATUSES.has(status as number)) {
        throw handleN8nApiError(error);
      }
      primaryError = error;
    }

    // n8n answers 404 for a workflow that does not exist as well as for a route it does not
    // have, so this retry also fires on a bad workflow ID. That costs one request and ends in
    // the same error, which is why the status is logged as a route probe, not a failure.
    logger.debug(
      `POST /workflows/{id}/${primaryPath} returned ${status} - retrying /${fallbackPath} ` +
        '(this n8n does not serve that route, or the workflow does not exist)'
    );
    try {
      const workflow = await post(fallbackPath);
      if (fallbackPath === modernPath) {
        this.confirmModernPublishRoute(`/${legacyPath} is absent and /${modernPath} answered`);
      }
      return workflow;
    } catch (fallbackError) {
      // When the fallback fails the same way, neither route exists and the first attempt is the
      // more faithful account - a missing workflow should read as a missing workflow rather than
      // as confusion about the second route. A substantive failure (say a 400 naming a missing
      // trigger) is the useful one, so that is surfaced instead.
      const fallbackStatus = failureStatus(fallbackError);
      throw handleN8nApiError(
        ROUTE_ABSENT_STATUSES.has(fallbackStatus as number) ? primaryError : fallbackError
      );
    }
  }

  /**
   * Latch that this instance serves the modern publish routes, so later calls go there first.
   * Only ever called from evidence that the routes exist; nothing clears it.
   *
   * Nothing clears it because no response proves the routes are absent - a 404 is equally a
   * missing workflow. If some intermediary ever produced the evidence spuriously (a proxy that
   * adds a Deprecation header while blocking `/publish`), the cost is one wasted request per
   * call, not a failure: the fallback still lands on the legacy route.
   */
  private confirmModernPublishRoute(evidence: string): void {
    if (this.modernPublishRoute) return;
    this.modernPublishRoute = true;
    logger.debug(`Using the publish/unpublish routes for this instance: ${evidence}`);
  }

  async activateWorkflow(id: string): Promise<Workflow> {
    return this.postPublishRoute(id, 'publish', 'activate');
  }

  async deactivateWorkflow(id: string): Promise<Workflow> {
    return this.postPublishRoute(id, 'unpublish', 'deactivate');
  }

  /**
   * Lists workflows from n8n instance.
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of workflows
   *
   * @remarks
   * This method handles two response formats for backwards compatibility:
   * - Modern (n8n v0.200.0+): {data: Workflow[], nextCursor?: string}
   * - Legacy (older versions): Workflow[] (wrapped automatically)
   *
   * @see https://github.com/czlonkowski/n8n-mcp/issues/349
   */
  async listWorkflows(params: WorkflowListParams = {}): Promise<WorkflowListResponse> {
    try {
      const response = await this.client.get('/workflows', { params });
      return this.validateListResponse<Workflow>(response.data, 'workflows');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Audit
  async generateAudit(options?: { categories?: string[]; daysAbandonedWorkflow?: number }): Promise<any> {
    try {
      const additionalOptions: Record<string, unknown> = {};
      if (options?.categories) additionalOptions.categories = options.categories;
      if (options?.daysAbandonedWorkflow !== undefined) additionalOptions.daysAbandonedWorkflow = options.daysAbandonedWorkflow;

      const body = Object.keys(additionalOptions).length > 0 ? { additionalOptions } : {};
      const response = await this.client.post('/audit', body);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Fetch all workflows with pagination (for audit scanning)
  async listAllWorkflows(): Promise<Workflow[]> {
    const allWorkflows: Workflow[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50; // Safety limit: 5000 workflows max

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: WorkflowListParams = { limit: PAGE_SIZE, cursor };
      const response = await this.listWorkflows(params);
      allWorkflows.push(...response.data);
      if (!response.nextCursor || seenCursors.has(response.nextCursor)) break;
      seenCursors.add(response.nextCursor);
      cursor = response.nextCursor;
    }
    return allWorkflows;
  }

  // Execution Management
  async getExecution(id: string, includeData = false): Promise<Execution> {
    try {
      const response = await this.client.get(`/executions/${encodeApiPathSegment(id, 'executionId')}`, {
        params: { includeData },
      });
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  /**
   * Lists executions from n8n instance.
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of executions
   *
   * @remarks
   * This method handles two response formats for backwards compatibility:
   * - Modern (n8n v0.200.0+): {data: Execution[], nextCursor?: string}
   * - Legacy (older versions): Execution[] (wrapped automatically)
   *
   * @see https://github.com/czlonkowski/n8n-mcp/issues/349
   */
  async listExecutions(params: ExecutionListParams = {}): Promise<ExecutionListResponse> {
    try {
      const response = await this.client.get('/executions', { params });
      return this.validateListResponse<Execution>(response.data, 'executions');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteExecution(id: string): Promise<void> {
    try {
      await this.client.delete(`/executions/${encodeApiPathSegment(id, 'executionId')}`);
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Evaluation test runs (reads n8n >= 2.30, trigger/cancel n8n >= 2.32)

  async listTestRuns(workflowId: string, params: TestRunListParams = {}): Promise<TestRunListResponse> {
    try {
      const response = await this.client.get(
        `/workflows/${encodeApiPathSegment(workflowId, 'workflowId')}/test-runs`,
        { params }
      );
      return this.validateListResponse<TestRunSummary>(response.data, 'test runs');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async getTestRun(workflowId: string, runId: string): Promise<TestRunSummary> {
    try {
      const response = await this.client.get(
        `/workflows/${encodeApiPathSegment(workflowId, 'workflowId')}/test-runs/${encodeApiPathSegment(runId, 'runId')}`
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async listTestCases(
    workflowId: string,
    runId: string,
    params: TestCaseListParams = {}
  ): Promise<TestCaseListResponse> {
    try {
      const response = await this.client.get(
        `/workflows/${encodeApiPathSegment(workflowId, 'workflowId')}/test-runs/${encodeApiPathSegment(runId, 'runId')}/test-cases`,
        { params }
      );
      return this.validateListResponse<TestCaseExecution>(response.data, 'test cases');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async triggerTestRun(workflowId: string): Promise<TestRunTriggerResult> {
    try {
      const response = await this.client.post(
        `/workflows/${encodeApiPathSegment(workflowId, 'workflowId')}/test-runs`,
        {}
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async cancelTestRun(workflowId: string, runId: string): Promise<TestRunCancelResult> {
    try {
      const response = await this.client.post(
        `/workflows/${encodeApiPathSegment(workflowId, 'workflowId')}/test-runs/${encodeApiPathSegment(runId, 'runId')}/cancel`,
        {}
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Webhook Execution
  async triggerWebhook(request: WebhookRequest): Promise<any> {
    try {
      const { webhookUrl, httpMethod, data, headers, waitForResponse = true } = request;

      // SECURITY: Validate URL for SSRF protection (includes DNS resolution)
      // See: https://github.com/czlonkowski/n8n-mcp/issues/265 (HIGH-03)
      const { SSRFProtection } = await import('../utils/ssrf-protection');
      const validation = await SSRFProtection.validateWebhookUrl(webhookUrl);

      if (!validation.valid) {
        throw new Error(`SSRF protection: ${validation.reason}`);
      }

      // Extract path from webhook URL
      const url = new URL(webhookUrl);
      const webhookPath = url.pathname;

      // SECURITY: only forward Cloudflare Access service-token headers when the
      // webhook targets the configured n8n instance origin, so the token is never
      // leaked to an unrelated host supplied via webhookUrl.
      const forwardCfHeaders = this.isSameOrigin(webhookUrl);
      if (!forwardCfHeaders && Object.keys(this.cfAccessHeaders()).length > 0) {
        // Withheld by design; log so a resulting Cloudflare Access 403 on a
        // split webhook host (WEBHOOK_URL origin != N8N_API_URL origin) is diagnosable.
        logger.debug('Withholding Cloudflare Access headers: webhook host differs from the configured n8n instance origin');
      }

      // Make request directly to webhook endpoint
      const config: AxiosRequestConfig = {
        method: httpMethod,
        url: webhookPath,
        headers: {
          ...headers,
          ...(forwardCfHeaders ? this.cfAccessHeaders() : {}),
          // Don't override API key header for webhook endpoints
          'X-N8N-API-KEY': undefined,
        },
        data: httpMethod !== 'GET' ? data : undefined,
        params: httpMethod === 'GET' ? data : undefined,
        // Webhooks might take longer
        timeout: waitForResponse ? 120000 : 30000,
      };

      // SECURITY (GHSA-cmrh-wvq6-wm9r): pin transport to validated IP.
      const pinned = validation.address && validation.family
        ? SSRFProtection.createPinnedAgents(
            validation.addresses ?? [{ address: validation.address, family: validation.family }]
          )
        : undefined;

      // Create a new axios instance for webhook requests to avoid API interceptors
      const webhookClient = axios.create({
        baseURL: new URL('/', webhookUrl).toString(),
        validateStatus: (status: number) => status < 500, // Don't throw on 4xx
        // SECURITY (GHSA-8g7g-hmwm-6rv2): no redirect-following on validated URLs.
        maxRedirects: 0,
        httpAgent: pinned?.httpAgent,
        httpsAgent: pinned?.httpsAgent,
      });

      const response = await webhookClient.request(config);
      
      return {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        headers: response.headers,
      };
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Credential Management
  /**
   * Lists credentials from n8n instance.
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of credentials
   *
   * @remarks
   * This method handles two response formats for backwards compatibility:
   * - Modern (n8n v0.200.0+): {data: Credential[], nextCursor?: string}
   * - Legacy (older versions): Credential[] (wrapped automatically)
   *
   * @see https://github.com/czlonkowski/n8n-mcp/issues/349
   */
  async listCredentials(params: CredentialListParams = {}): Promise<CredentialListResponse> {
    try {
      const response = await this.client.get('/credentials', { params });
      return this.validateListResponse<Credential>(response.data, 'credentials');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Fetch all credentials with pagination (for full inventory / get-by-id fallback)
  async listAllCredentials(): Promise<Credential[]> {
    const allCredentials: Credential[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50; // Safety limit: 5000 credentials max

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: CredentialListParams = { limit: PAGE_SIZE, cursor };
      const response = await this.listCredentials(params);
      allCredentials.push(...response.data);
      if (!response.nextCursor || seenCursors.has(response.nextCursor)) break;
      seenCursors.add(response.nextCursor);
      cursor = response.nextCursor;
    }
    return allCredentials;
  }

  async getCredential(id: string): Promise<Credential> {
    try {
      const response = await this.client.get(`/credentials/${encodeApiPathSegment(id, 'credentialId')}`);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async createCredential(credential: Partial<Credential>): Promise<Credential> {
    try {
      const response = await this.client.post('/credentials', credential);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateCredential(id: string, credential: Partial<Credential>): Promise<Credential> {
    try {
      const response = await this.client.patch(`/credentials/${encodeApiPathSegment(id, 'credentialId')}`, credential);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteCredential(id: string): Promise<void> {
    try {
      await this.client.delete(`/credentials/${encodeApiPathSegment(id, 'credentialId')}`);
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async getCredentialSchema(typeName: string): Promise<any> {
    try {
      const response = await this.client.get(`/credentials/schema/${encodeApiPathSegment(typeName, 'credentialTypeName')}`);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Tag Management
  /**
   * Lists tags from n8n instance.
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of tags
   *
   * @remarks
   * This method handles two response formats for backwards compatibility:
   * - Modern (n8n v0.200.0+): {data: Tag[], nextCursor?: string}
   * - Legacy (older versions): Tag[] (wrapped automatically)
   *
   * @see https://github.com/czlonkowski/n8n-mcp/issues/349
   */
  async listTags(params: TagListParams = {}): Promise<TagListResponse> {
    try {
      const response = await this.client.get('/tags', { params });
      return this.validateListResponse<Tag>(response.data, 'tags');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async createTag(tag: Partial<Tag>): Promise<Tag> {
    try {
      const response = await this.client.post('/tags', tag);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateTag(id: string, tag: Partial<Tag>): Promise<Tag> {
    try {
      const response = await this.client.patch(`/tags/${encodeApiPathSegment(id, 'tagId')}`, tag);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteTag(id: string): Promise<void> {
    try {
      await this.client.delete(`/tags/${encodeApiPathSegment(id, 'tagId')}`);
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateWorkflowTags(workflowId: string, tagIds: string[]): Promise<Tag[]> {
    try {
      const response = await this.client.put(`/workflows/${encodeApiPathSegment(workflowId, 'workflowId')}/tags`, tagIds.filter(id => id).map(id => ({ id })));
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Source Control Management (Enterprise feature)
  async getSourceControlStatus(): Promise<SourceControlStatus> {
    try {
      const response = await this.client.get('/source-control/status');
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async pullSourceControl(force = false): Promise<SourceControlPullResult> {
    try {
      const response = await this.client.post('/source-control/pull', { force });
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async pushSourceControl(
    message: string,
    fileNames?: string[]
  ): Promise<SourceControlPushResult> {
    try {
      const response = await this.client.post('/source-control/push', {
        message,
        fileNames,
      });
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Variable Management (via Source Control API)
  async getVariables(): Promise<Variable[]> {
    try {
      const response = await this.client.get('/variables');
      return response.data.data || [];
    } catch (error) {
      // Variables might not be available in all n8n versions
      logger.warn('Variables API not available, returning empty array');
      return [];
    }
  }

  async createVariable(variable: Partial<Variable>): Promise<Variable> {
    try {
      const response = await this.client.post('/variables', variable);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateVariable(id: string, variable: Partial<Variable>): Promise<Variable> {
    try {
      const response = await this.client.patch(`/variables/${encodeApiPathSegment(id, 'variableId')}`, variable);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteVariable(id: string): Promise<void> {
    try {
      await this.client.delete(`/variables/${encodeApiPathSegment(id, 'variableId')}`);
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async createDataTable(params: { name: string; columns?: DataTableColumn[]; projectId?: string }): Promise<DataTable> {
    try {
      const response = await this.client.post('/data-tables', params);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async listDataTables(params: DataTableListParams = {}): Promise<{ data: DataTable[]; nextCursor?: string | null }> {
    try {
      const response = await this.client.get('/data-tables', { params });
      return this.validateListResponse<DataTable>(response.data, 'data-tables');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async getDataTable(id: string): Promise<DataTable> {
    try {
      const response = await this.client.get(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}`);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateDataTable(id: string, params: { name: string }): Promise<DataTable> {
    try {
      const response = await this.client.patch(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}`, params);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteDataTable(id: string): Promise<void> {
    try {
      await this.client.delete(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}`);
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async getDataTableRows(id: string, params: DataTableRowListParams = {}): Promise<{ data: DataTableRow[]; nextCursor?: string | null }> {
    try {
      const response = await this.client.get(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}/rows`, {
        params,
        paramsSerializer: (p) => this.serializeQueryParams(p),
      });
      return this.validateListResponse<DataTableRow>(response.data, 'data-table-rows');
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async insertDataTableRows(id: string, params: DataTableInsertRowsParams): Promise<any> {
    try {
      const response = await this.client.post(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}/rows`, params);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateDataTableRows(id: string, params: DataTableUpdateRowsParams): Promise<any> {
    try {
      const response = await this.client.patch(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}/rows/update`, params);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async upsertDataTableRow(id: string, params: DataTableUpsertRowParams): Promise<any> {
    try {
      const response = await this.client.post(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}/rows/upsert`, params);
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteDataTableRows(id: string, params: DataTableDeleteRowsParams): Promise<any> {
    try {
      const response = await this.client.delete(`/data-tables/${encodeApiPathSegment(id, 'dataTableId')}/rows/delete`, {
        params,
        paramsSerializer: (p) => this.serializeQueryParams(p),
      });
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  // Folder operations (/projects/{projectId}/folders, n8n public API 2.19+).
  // Only createFolder accepts the literal `personal` as projectId — n8n resolves
  // it server-side for that route alone. Every other folder route needs a real
  // project ID; resolvePersonalProjectId() below turns the alias into one.

  async createFolder(
    projectId: string,
    data: { name: string; parentFolderId?: string }
  ): Promise<Folder> {
    try {
      const response = await this.client.post(
        `/projects/${encodeApiPathSegment(projectId, 'projectId')}/folders`,
        data
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async listFolders(projectId: string, params: FolderListParams = {}): Promise<FolderListResponse> {
    try {
      const { filter, select, ...rest } = params;
      const response = await this.client.get(
        `/projects/${encodeApiPathSegment(projectId, 'projectId')}/folders`,
        {
          params: {
            ...rest,
            // n8n expects these two as JSON-encoded strings, not repeated params
            ...(filter && Object.keys(filter).length > 0 ? { filter: JSON.stringify(filter) } : {}),
            ...(select && select.length > 0 ? { select: JSON.stringify(select) } : {}),
          },
          // The JSON values carry reserved chars ({ } [ ] " :) that axios's default
          // serializer leaves raw and n8n's validator rejects ("must be url encoded").
          paramsSerializer: (p) => this.serializeQueryParams(p),
        }
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async getFolder(projectId: string, folderId: string): Promise<Folder> {
    try {
      const response = await this.client.get(
        `/projects/${encodeApiPathSegment(projectId, 'projectId')}/folders/${encodeApiPathSegment(folderId, 'folderId')}`
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async updateFolder(
    projectId: string,
    folderId: string,
    data: { name?: string; parentFolderId?: string }
  ): Promise<Folder> {
    try {
      const response = await this.client.patch(
        `/projects/${encodeApiPathSegment(projectId, 'projectId')}/folders/${encodeApiPathSegment(folderId, 'folderId')}`,
        data
      );
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deleteFolder(projectId: string, folderId: string, transferToFolderId?: string): Promise<void> {
    try {
      await this.client.delete(
        `/projects/${encodeApiPathSegment(projectId, 'projectId')}/folders/${encodeApiPathSegment(folderId, 'folderId')}`,
        { params: transferToFolderId ? { transferToFolderId } : {} }
      );
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  /**
   * GET /projects. Team projects are a licensed feature: unlicensed instances answer
   * 403 (older ones 404). Callers decide the fallback; this method only reports.
   */
  async listProjects(limit = 100): Promise<Project[]> {
    try {
      const response = await this.client.get('/projects', { params: { limit } });
      const payload = response.data;
      return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  /**
   * Resolve the `personal` project alias to a real project ID, for the folder
   * routes that don't accept the alias. Two-step ladder:
   *
   * 1. GET /projects (Enterprise-licensed): when the listing is available it is
   *    authoritative — exactly one visible personal project resolves, anything
   *    else (none, several, or a truncated listing) errors out rather than
   *    guessing another project.
   * 2. GET /workflows?limit=1, ONLY when the projects API answered 403/404
   *    (Community / pre-projects instances): there, every project is the
   *    caller's personal one and workflow sharing does not exist, so any
   *    workflow's `shared[].projectId` is the personal project. On an instance
   *    where /projects merely failed transiently or showed no personal project,
   *    this probe could return a team project - which is why it never runs then.
   *
   * The result is cached for the client's lifetime — project IDs never change.
   */
  async resolvePersonalProjectId(): Promise<string> {
    if (this.personalProjectId) return this.personalProjectId;

    let projects: ProjectSummary[] = [];
    let truncated = false;
    let projectsApiAvailable = true;
    try {
      const response = await this.client.get('/projects', { params: { limit: 100 } });
      if (Array.isArray(response.data?.data)) projects = response.data.data;
      truncated = Boolean(response.data?.nextCursor);
    } catch (error) {
      // Community answers 403 (projects API is enterprise-licensed) and very old
      // instances 404 - both mean "no projects API here", where the workflow probe
      // below is authoritative. Anything else (timeout, 429, 5xx) must NOT fall
      // through: on a multi-project instance the probe would silently resolve
      // 'personal' to whatever project the first workflow lives in, and cache it.
      const apiError = handleN8nApiError(error);
      if (apiError.statusCode !== 403 && apiError.statusCode !== 404) throw apiError;
      projectsApiAvailable = false;
    }

    if (projectsApiAvailable) {
      if (truncated) {
        // The caller's personal project may sit beyond page 1; filtering a truncated
        // listing could quietly pick another user's personal project instead.
        throw new N8nValidationError(
          `This instance has more projects than one listing page; resolving 'personal' from a ` +
            `truncated listing could pick the wrong project. Pass an explicit projectId.`
        );
      }

      const personal = projects.filter(p => p.type === 'personal');
      if (personal.length === 1) {
        this.personalProjectId = personal[0].id;
        return personal[0].id;
      }
      if (personal.length > 1) {
        throw new N8nValidationError(
          `This API key sees ${personal.length} personal projects, so 'personal' is ambiguous. ` +
            `Pass an explicit projectId. Visible personal projects: ` +
            personal.map(p => `${p.id} (${p.name})`).join(', ')
        );
      }
      // A successful listing with zero personal projects is authoritative too:
      // probing a workflow here could resolve to a team project.
      throw new N8nValidationError(
        `The projects listing shows no personal project for this API key. Pass an explicit projectId.`
      );
    }

    // Community / pre-projects instances only (see doc comment).
    try {
      const response = await this.client.get('/workflows', { params: { limit: 1 } });
      const workflow = Array.isArray(response.data?.data) ? response.data.data[0] : undefined;
      const projectId = workflow?.shared?.[0]?.projectId;
      if (typeof projectId === 'string' && projectId.length > 0) {
        this.personalProjectId = projectId;
        return projectId;
      }
    } catch (error) {
      throw handleN8nApiError(error);
    }

    throw new N8nValidationError(
      `Could not resolve the 'personal' project: the projects API is not available on this instance ` +
        `and no workflow exists to infer the project from. Create any workflow first, or pass an ` +
        `explicit projectId. (The folder 'create' action itself accepts 'personal' directly.)`
    );
  }

  /**
   * Serializes query params with explicit encodeURIComponent. Axios's default
   * serializer leaves some reserved chars raw ([ ] : ,) that n8n's OpenAPI
   * validator rejects — which breaks any JSON-in-a-query-param endpoint (data
   * table rows, folder filter/select).
   */
  private serializeQueryParams(params: Record<string, any>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      // Skip blank strings as well so MCP clients that serialize all fields
      // don't leak empty values into the query string. See issue #774.
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.join('&');
  }

  /**
   * Validates and normalizes n8n API list responses.
   * Handles both modern format {data: [], nextCursor?: string} and legacy array format.
   *
   * @param responseData - Raw response data from n8n API
   * @param resourceType - Resource type for error messages (e.g., 'workflows', 'executions')
   * @returns Normalized response in modern format
   * @throws Error if response structure is invalid
   */
  private validateListResponse<T>(
    responseData: any,
    resourceType: string
  ): { data: T[]; nextCursor?: string | null } {
    // Validate response structure
    if (!responseData || typeof responseData !== 'object') {
      throw new Error(`Invalid response from n8n API for ${resourceType}: response is not an object`);
    }

    // Handle legacy case where API returns array directly (older n8n versions)
    if (Array.isArray(responseData)) {
      logger.warn(
        `n8n API returned array directly instead of {data, nextCursor} object for ${resourceType}. ` +
        'Wrapping in expected format for backwards compatibility.'
      );
      return {
        data: responseData,
        nextCursor: null
      };
    }

    // Validate expected format {data: [], nextCursor?: string}
    if (!Array.isArray(responseData.data)) {
      const keys = Object.keys(responseData).slice(0, 5);
      const keysPreview = keys.length < Object.keys(responseData).length
        ? `${keys.join(', ')}...`
        : keys.join(', ');
      throw new Error(
        `Invalid response from n8n API for ${resourceType}: expected {data: [], nextCursor?: string}, ` +
        `got object with keys: [${keysPreview}]`
      );
    }

    return responseData;
  }
}