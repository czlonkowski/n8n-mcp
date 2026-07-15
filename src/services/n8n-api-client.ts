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
} from '../types/n8n-api';
import { handleN8nApiError, logN8nError } from '../utils/n8n-errors';
import { encodeApiPathSegment } from '../utils/validation-schemas';
import { cleanWorkflowForCreate, cleanWorkflowForUpdate } from './n8n-validation';
import {
  fetchN8nVersion,
  cleanSettingsForVersion,
  getCachedVersion,
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

export class N8nApiClient {
  private client: AxiosInstance;
  private maxRetries: number;
  private baseUrl: string;
  private versionInfo: N8nVersionInfo | null = null;
  private versionPromise: Promise<N8nVersionInfo | null> | null = null;
  // SECURITY (GHSA-cmrh-wvq6-wm9r): cached pinned transport agents.
  private pinnedAgentsPromise: Promise<PinnedAgents> | null = null;
  private cfClientId?: string;
  private cfClientSecret?: string;

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

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response: any) => {
        logger.debug(`n8n API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error: unknown) => {
        const n8nError = handleN8nApiError(error);
        logN8nError(n8nError, 'n8n API Response');
        return Promise.reject(n8nError);
      }
    );
  }

  /**
   * Resolve the configured baseUrl once and return HTTP/HTTPS agents that
   * pin every connection to the validated IP.
   *
   * @security GHSA-cmrh-wvq6-wm9r — without this, axios performs an
   * independent DNS lookup on every request, opening a TOCTOU window.
   */
  private getPinnedAgents(): Promise<PinnedAgents> {
    if (!this.pinnedAgentsPromise) {
      const promise = (async () => {
        const { SSRFProtection } = await import('../utils/ssrf-protection');
        const validation = await SSRFProtection.validateWebhookUrl(this.baseUrl);
        if (!validation.valid || !validation.address || !validation.family) {
          throw new Error(`SSRF protection: ${validation.reason || 'baseUrl rejected'}`);
        }
        return SSRFProtection.createPinnedAgents(validation.address, validation.family);
      })();
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

  // Workflow Management
  async createWorkflow(workflow: Partial<Workflow>): Promise<Workflow> {
    try {
      const cleanedWorkflow = cleanWorkflowForCreate(workflow);
      const response = await this.client.post('/workflows', cleanedWorkflow);
      return response.data;
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

  async updateWorkflow(id: string, workflow: Partial<Workflow>): Promise<Workflow> {
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
        logger.warn('Could not determine n8n version, sending all known settings properties');
        // Without version info, we send all known properties (might fail on old n8n)
      }

      const safeId = encodeApiPathSegment(id, 'workflowId');
      // First, try PUT method (newer n8n versions)
      try {
        const response = await this.client.put(`/workflows/${safeId}`, cleanedWorkflow);
        return response.data;
      } catch (putError: any) {
        // If PUT fails with 405 (Method Not Allowed), try PATCH
        if (putError.response?.status === 405) {
          logger.debug('PUT method not supported, falling back to PATCH');
          const response = await this.client.patch(`/workflows/${safeId}`, cleanedWorkflow);
          return response.data;
        }
        throw putError;
      }
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

  async activateWorkflow(id: string): Promise<Workflow> {
    try {
      const response = await this.client.post(`/workflows/${encodeApiPathSegment(id, 'workflowId')}/activate`, {});
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  async deactivateWorkflow(id: string): Promise<Workflow> {
    try {
      const response = await this.client.post(`/workflows/${encodeApiPathSegment(id, 'workflowId')}/deactivate`, {});
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
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

  // Evaluation test runs (n8n >= 2.30)

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
        ? SSRFProtection.createPinnedAgents(validation.address, validation.family)
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
        paramsSerializer: (p) => this.serializeDataTableParams(p),
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
        paramsSerializer: (p) => this.serializeDataTableParams(p),
      });
      return response.data;
    } catch (error) {
      throw handleN8nApiError(error);
    }
  }

  /**
   * Serializes data table query params with explicit encodeURIComponent.
   * Axios's default serializer doesn't encode some reserved chars that n8n rejects.
   */
  private serializeDataTableParams(params: Record<string, any>): string {
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