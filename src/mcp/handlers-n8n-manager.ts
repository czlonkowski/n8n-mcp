import { randomUUID } from 'crypto';
import { N8nApiClient } from '../services/n8n-api-client';
import { scanWorkflows, type CustomCheckType } from '../services/workflow-security-scanner';
import { buildAuditReport } from '../services/audit-report-builder';
import { getN8nApiConfig, getN8nApiConfigFromContext } from '../config/n8n-api';
import {
  Workflow,
  WorkflowNode,
  WorkflowConnection,
  ExecutionStatus,
  WebhookRequest,
  McpToolResponse,
  ExecutionFilterOptions,
  ExecutionMode,
  Credential,
  TestRunStatus,
} from '../types/n8n-api';
import type { TriggerType, TestWorkflowInput } from '../triggers/types';
import {
  validateWorkflowStructure,
  hasWebhookTrigger,
  getWebhookUrl
} from '../services/n8n-validation';
import { nodeGroupsField, parseNodeGroupsInput } from '../services/node-groups';
import { versionAtLeast, N8N_VERSION_UNAVAILABLE_NOTE } from '../services/n8n-version';
import {
  N8nApiError,
  N8nNotFoundError,
  getUserFriendlyErrorMessage,
  formatExecutionError,
  formatNoExecutionError
} from '../utils/n8n-errors';
import { logger } from '../utils/logger';
import { z } from 'zod';
import { WorkflowValidator } from '../services/workflow-validator';
import { EnhancedConfigValidator } from '../services/enhanced-config-validator';
import { NodeRepository } from '../database/node-repository';
import { InstanceContext, validateInstanceContext, getInstanceScopeId } from '../types/instance-context';
import { NodeTypeNormalizer } from '../utils/node-type-normalizer';
import { WorkflowAutoFixer, AutoFixConfig } from '../services/workflow-auto-fixer';
import { ExpressionFormatValidator, ExpressionFormatIssue } from '../services/expression-format-validator';
import { WorkflowVersioningService, VERSION_OWNERSHIP_ERROR_PREFIX } from '../services/workflow-versioning-service';
import { handleUpdatePartialWorkflow } from './handlers-workflow-diff';
import { telemetry } from '../telemetry';
import { TemplateService } from '../templates/template-service';
import {
  createCacheKey,
  createInstanceCache,
  CacheMutex,
  cacheMetrics,
  withRetry,
  getCacheStatistics
} from '../utils/cache-utils';
import { processExecution } from '../services/execution-processor';
import { checkNpmVersion, formatVersionMessage } from '../utils/npm-version-checker';
import {
  normalizeMcpJsonValue,
  normalizeMcpWorkflowConnections,
  normalizeMcpWorkflowNodes,
} from '../utils/mcp-input-normalizer';
import { buildOfficialMcpHealth, OfficialMcpHealth } from './official-mcp-access';
import { callOfficialTool, resolveProjectChoices } from './handlers-official-tools';
import { withMcpExposure, publicApiMatchesContext, PUBLIC_API_CONTEXT_HINT } from '../services/mcp-exposure';
import { isOperationDisabled } from './tool-policy';
import {
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  PINNED_TIMEOUT_MS,
} from './agents-action-map';

// ========================================================================
// TypeScript Interfaces for Type Safety
// ========================================================================

/**
 * Health Check Response Data Structure
 */
interface HealthCheckResponseData {
  status: string;
  instanceId?: string;
  n8nVersion?: string;
  /** Present only when the instance did not report a version - see N8N_VERSION_UNAVAILABLE_NOTE. */
  n8nVersionNote?: string;
  features?: Record<string, unknown>;
  apiUrl?: string;
  mcpVersion: string;
  supportedN8nVersion?: string;
  versionCheck: {
    current: string;
    latest: string | null;
    upToDate: boolean;
    message: string;
    updateCommand?: string;
  };
  performance: {
    responseTimeMs: number;
    cacheHitRate: string;
    cachedInstances: number;
  };
  officialMcp?: OfficialMcpHealth;
  nextSteps?: string[];
  updateWarning?: string;
}

/**
 * Cloud Platform Guide Structure
 */
interface CloudPlatformGuide {
  name: string;
  troubleshooting: string[];
}

/**
 * Applied Fix from Auto-Fix Operation
 */
interface AppliedFix {
  node: string;
  field: string;
  type: string;
  before: string;
  after: string;
  confidence: string;
}

/**
 * Auto-Fix Result Data from handleAutofixWorkflow
 */
interface AutofixResultData {
  fixesApplied?: number;
  fixes?: AppliedFix[];
  workflowId?: string;
  workflowName?: string;
  message?: string;
  summary?: string;
  stats?: Record<string, number>;
}

/**
 * Workflow Validation Response Data
 */
interface WorkflowValidationResponse {
  valid: boolean;
  workflowId?: string;
  workflowName?: string;
  summary: {
    totalNodes: number;
    enabledNodes: number;
    triggerNodes: number;
    validConnections: number;
    invalidConnections: number;
    expressionsValidated: number;
    errorCount: number;
    warningCount: number;
  };
  errors?: Array<{
    node: string;
    nodeName?: string;
    message: string;
    details?: Record<string, unknown>;
  }>;
  warnings?: Array<{
    node: string;
    nodeName?: string;
    message: string;
    details?: Record<string, unknown>;
  }>;
  suggestions?: unknown[];
}

/**
 * Diagnostic Response Data Structure
 */
interface DiagnosticResponseData {
  timestamp: string;
  environment: {
    N8N_API_URL: string | null;
    N8N_API_KEY: string | null;
    NODE_ENV: string;
    MCP_MODE: string;
    isDocker: boolean;
    cloudPlatform: string | null;
    nodeVersion: string;
    platform: string;
  };
  apiConfiguration: {
    configured: boolean;
    status: {
      configured: boolean;
      connected: boolean;
      error: string | null;
      version: string | null;
    };
    config: {
      baseUrl: string;
      timeout: number;
      maxRetries: number;
    } | null;
  };
  versionInfo: {
    current: string;
    latest: string | null;
    upToDate: boolean;
    message: string;
    updateCommand?: string;
  };
  toolsAvailability: {
    documentationTools: {
      count: number;
      enabled: boolean;
      description: string;
    };
    managementTools: {
      count: number;
      enabled: boolean;
      description: string;
    };
    totalAvailable: number;
  };
  performance: {
    diagnosticResponseTimeMs: number;
    cacheHitRate: string;
    cachedInstances: number;
  };
  officialMcp?: OfficialMcpHealth;
  modeSpecificDebug: Record<string, unknown>;
  dockerDebug?: Record<string, unknown>;
  cloudPlatformDebug?: CloudPlatformGuide;
  nextSteps?: Record<string, unknown>;
  troubleshooting?: Record<string, unknown>;
  setupGuide?: Record<string, unknown>;
  updateWarning?: Record<string, unknown>;
  debug?: Record<string, unknown>;
  [key: string]: unknown; // Allow dynamic property access for optional fields
}

// ========================================================================
// Singleton n8n API client instance (backward compatibility)
let defaultApiClient: N8nApiClient | null = null;
let lastDefaultConfigUrl: string | null = null;

// Mutex for cache operations to prevent race conditions
const cacheMutex = new CacheMutex();

// Instance-specific API clients cache with LRU eviction and TTL
const instanceClients = createInstanceCache<N8nApiClient>((client, key) => {
  // Clean up when evicting from cache
  logger.debug('Evicting API client from cache', {
    cacheKey: key.substring(0, 8) + '...' // Only log partial key for security
  });
});

/**
 * Get or create API client with flexible instance support
 * Supports both singleton mode (using environment variables) and instance-specific mode.
 * Uses LRU cache with mutex protection for thread-safe operations.
 *
 * @param context - Optional instance context for instance-specific configuration
 * @returns API client configured for the instance or environment, or null if not configured
 *
 * @example
 * // Using environment variables (singleton mode)
 * const client = getN8nApiClient();
 *
 * @example
 * // Using instance context
 * const client = getN8nApiClient({
 *   n8nApiUrl: 'https://customer.n8n.cloud',
 *   n8nApiKey: 'api-key-123',
 *   instanceId: 'customer-1'
 * });
 */
/**
 * Get cache statistics for monitoring
 * @returns Formatted cache statistics string
 */
export function getInstanceCacheStatistics(): string {
  return getCacheStatistics();
}

/**
 * Get raw cache metrics for detailed monitoring
 * @returns Raw cache metrics object
 */
export function getInstanceCacheMetrics() {
  return cacheMetrics.getMetrics();
}

/**
 * Clear the instance cache for testing or maintenance
 */
export function clearInstanceCache(): void {
  instanceClients.clear();
  cacheMetrics.recordClear();
  cacheMetrics.updateSize(0, instanceClients.max);
}

export function getN8nApiClient(context?: InstanceContext): N8nApiClient | null {
  // If context provided with n8n config, use instance-specific client
  if (context?.n8nApiUrl && context?.n8nApiKey) {
    // Validate context before using
    const validation = validateInstanceContext(context);
    if (!validation.valid) {
      logger.warn('Invalid instance context provided', {
        instanceId: context.instanceId,
        errors: validation.errors
      });
      return null;
    }
    // Create secure hash of credentials for cache key using memoization
    const cacheKey = createCacheKey(
      `${context.n8nApiUrl}:${context.n8nApiKey}:${context.instanceId || ''}`
    );

    // Check cache first
    if (instanceClients.has(cacheKey)) {
      cacheMetrics.recordHit();
      return instanceClients.get(cacheKey) || null;
    }

    cacheMetrics.recordMiss();

    // Check if already being created (simple lock check)
    if (cacheMutex.isLocked(cacheKey)) {
      // Wait briefly and check again
      const waitTime = 100; // 100ms
      const start = Date.now();
      while (cacheMutex.isLocked(cacheKey) && (Date.now() - start) < 1000) {
        // Busy wait for up to 1 second
      }
      // Check if it was created while waiting
      if (instanceClients.has(cacheKey)) {
        cacheMetrics.recordHit();
        return instanceClients.get(cacheKey) || null;
      }
    }

    const config = getN8nApiConfigFromContext(context);
    if (config) {
      // Sanitized logging - never log API keys
      logger.info('Creating instance-specific n8n API client', {
        url: config.baseUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1'), // Only log domain
        instanceId: context.instanceId,
        cacheKey: cacheKey.substring(0, 8) + '...' // Only log partial hash
      });

      const client = new N8nApiClient(config);
      instanceClients.set(cacheKey, client);
      cacheMetrics.recordSet();
      cacheMetrics.updateSize(instanceClients.size, instanceClients.max);
      return client;
    }

    return null;
  }

  // SECURITY (GHSA-jxx9-px88-pj69): never fall back to process-level credentials
  // when multi-tenant mode is enabled. A missing or incomplete tenant context
  // must result in no client, not the operator's N8N_API_KEY.
  if (process.env.ENABLE_MULTI_TENANT === 'true') {
    logger.warn('Refusing env-credential fallback in multi-tenant mode');
    return null;
  }

  // Fall back to default singleton from environment
  logger.info('Falling back to environment configuration for n8n API client');
  const config = getN8nApiConfig();

  if (!config) {
    if (defaultApiClient) {
      logger.info('n8n API configuration removed, clearing default client');
      defaultApiClient = null;
      lastDefaultConfigUrl = null;
    }
    return null;
  }

  // Check if config has changed
  if (!defaultApiClient || lastDefaultConfigUrl !== config.baseUrl) {
    logger.info('n8n API client initialized from environment', { url: config.baseUrl });
    defaultApiClient = new N8nApiClient(config);
    lastDefaultConfigUrl = config.baseUrl;
  }

  return defaultApiClient;
}

/**
 * Helper to ensure API is configured
 * @param context - Optional instance context
 * @returns Configured API client
 * @throws Error if API is not configured
 */
function ensureApiConfigured(context?: InstanceContext): N8nApiClient {
  const client = getN8nApiClient(context);
  if (!client) {
    if (context?.instanceId) {
      throw new Error(`n8n API not configured for instance ${context.instanceId}. Please provide n8nApiUrl and n8nApiKey in the instance context.`);
    }
    throw new Error('n8n API not configured. Please set N8N_API_URL and N8N_API_KEY environment variables.');
  }
  return client;
}

/**
 * Resolve the n8n API config to surface in a tool response (apiUrl,
 * baseUrl for workflow links, etc.). Prefers the per-request tenant
 * context; falls back to the process-env config only in single-tenant
 * mode.
 *
 * SECURITY (GHSA-jxx9-px88-pj69): in multi-tenant mode this never returns
 * the operator's env config, so handler responses cannot disclose the
 * operator's apiUrl to a tenant whose context was missing or incomplete.
 */
function resolveN8nApiConfigForResponse(context?: InstanceContext) {
  const fromContext = context ? getN8nApiConfigFromContext(context) : null;
  if (fromContext) {
    return fromContext;
  }
  if (process.env.ENABLE_MULTI_TENANT === 'true') {
    return null;
  }
  return getN8nApiConfig();
}

// MCP transports may serialize JSON objects/arrays as strings.
// Parse them back, but return the original value on failure so Zod reports a proper type error.
export function tryParseJson(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

// n8n's draft/publish model returns a full `activeVersion` object on every workflow GET,
// duplicating the live graph's nodes/connections alongside the draft. That payload roughly
// doubles the response size and pushes large workflows past MCP host caps. Strip the
// heavy object here while preserving `activeVersionId` as a lightweight pointer. Callers
// that need the published graph should use mode='active' (handleGetWorkflowActive).
function stripActiveVersion(workflow: Workflow): Workflow {
  const { activeVersion, ...rest } = workflow;
  return rest;
}

// Some MCP clients (e.g. opencode) serialize all schema fields including optional ones,
// sending '' instead of omitting them. Coerce blank strings to undefined so the n8n API
// doesn't receive `?cursor=&projectId=` and reject the request. See issue #774.
const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;
const optionalEmptyAware = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

// Zod schemas for input validation
const createWorkflowSchema = z.object({
  name: z.string(),
  nodes: z.preprocess(normalizeMcpWorkflowNodes, z.array(z.any())),
  // Two-arg z.record(keySchema, valueSchema) — see services/n8n-validation.ts for the
  // Zod 3/4 compatibility rationale (#744).
  connections: z.preprocess(normalizeMcpWorkflowConnections, z.record(z.string(), z.any())),
  // The typed keys are validated; every other key is forwarded, as on the update path.
  // A closed object here silently dropped `availableInMCP`, `callerPolicy` and the other
  // settings added since n8n 1.119 before they reached the cleaner (issue #1026).
  settings: z.preprocess(normalizeMcpJsonValue, z.object({
    executionOrder: z.enum(['v0', 'v1']).optional(),
    timezone: z.string().optional(),
    saveDataErrorExecution: z.enum(['all', 'none']).optional(),
    saveDataSuccessExecution: z.enum(['all', 'none']).optional(),
    saveManualExecutions: z.boolean().optional(),
    saveExecutionProgress: z.boolean().optional(),
    executionTimeout: z.number().optional(),
    errorWorkflow: z.string().optional(),
  }).passthrough()).optional(),
  // Validated by parseNodeGroupsInput() — see services/node-groups.ts
  nodeGroups: z.any().optional(),
  projectId: z.string().optional(),
  // Folder placement (n8n 2.32+). Omit for the project root; blank strings from
  // lossy MCP clients are treated as omitted (issue #774 pattern). Trimmed to match
  // the folder handlers and the moveToFolder diff operation.
  parentFolderId: optionalEmptyAware(z.string().trim().min(1)),
});

const updateWorkflowSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  nodes: z.preprocess(normalizeMcpWorkflowNodes, z.array(z.any())).optional(),
  connections: z.preprocess(normalizeMcpWorkflowConnections, z.record(z.string(), z.any())).optional(),
  settings: z.preprocess(normalizeMcpJsonValue, z.any()).optional(),
  // Validated by parseNodeGroupsInput() — see services/node-groups.ts
  nodeGroups: z.any().optional(),
  // Folder move (n8n 2.32+): a folder ID moves the workflow there, null moves it to the
  // project root, omitting the field leaves the current folder unchanged. Write-only in
  // n8n's schema, so the merged GET response can never re-send a stale value. Trimmed to
  // match the folder handlers and the moveToFolder diff operation.
  parentFolderId: optionalEmptyAware(z.string().trim().min(1).nullable()),
  createBackup: z.boolean().optional(),
  intent: z.string().optional(),
});

const listWorkflowsSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  cursor: optionalEmptyAware(z.string()),
  active: z.boolean().optional(),
  tags: z.preprocess(normalizeMcpJsonValue, z.array(z.string())).optional(),
  projectId: optionalEmptyAware(z.string()),
  excludePinnedData: z.boolean().optional(),
});

const validateWorkflowSchema = z.object({
  id: z.string(),
  options: z.object({
    validateNodes: z.boolean().optional(),
    validateConnections: z.boolean().optional(),
    validateExpressions: z.boolean().optional(),
    profile: z.enum(['minimal', 'runtime', 'ai-friendly', 'strict']).optional(),
  }).optional(),
});

const autofixWorkflowSchema = z.object({
  id: z.string(),
  applyFixes: z.boolean().optional().default(false),
  fixTypes: z.array(z.enum([
    'expression-format',
    'typeversion-correction',
    'error-output-config',
    'node-type-correction',
    'webhook-missing-path',
    'typeversion-upgrade',
    'version-migration',
    'tool-variant-correction',
    'connection-numeric-keys',
    'connection-invalid-type',
    'connection-id-to-name',
    'connection-duplicate-removal',
    'connection-input-index'
  ])).optional(),
  confidenceThreshold: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  maxFixes: z.number().optional().default(50)
});

// Schema for n8n_test_workflow tool
const testWorkflowSchema = z.object({
  workflowId: z.string(),
  method: optionalEmptyAware(z.enum(['auto', 'trigger', 'prepare', 'pinned', 'direct'])),
  triggerType: optionalEmptyAware(z.enum(['webhook', 'form', 'chat'])),
  httpMethod: optionalEmptyAware(z.enum(['GET', 'POST', 'PUT', 'DELETE'])),
  webhookPath: optionalEmptyAware(z.string()),
  message: optionalEmptyAware(z.string()),
  sessionId: optionalEmptyAware(z.string()),
  data: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  waitForResponse: z.boolean().optional(),
  // Official-MCP methods only.
  exposeToMcp: z.boolean().optional(),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
  pinData: z.record(z.array(z.unknown())).optional(),
  triggerNodeName: optionalEmptyAware(z.string()),
  executionMode: optionalEmptyAware(z.enum(['manual', 'production'])),
});

const listExecutionsSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  cursor: optionalEmptyAware(z.string()),
  workflowId: optionalEmptyAware(z.string()),
  projectId: optionalEmptyAware(z.string()),
  status: optionalEmptyAware(z.enum(['success', 'error', 'waiting'])),
  includeData: z.boolean().optional(),
});

// Evaluation ids become API path segments; trim and require content so a blank
// or whitespace-only value fails here as "Invalid input" rather than surfacing
// later as a transport-layer error.
const testRunPathId = z.string().trim().min(1);

const listTestRunsSchema = z.object({
  workflowId: testRunPathId,
  status: optionalEmptyAware(z.enum(['new', 'running', 'completed', 'error', 'cancelled'])),
  limit: z.number().min(1).max(250).optional(),
  cursor: optionalEmptyAware(z.string()),
});

const getTestRunSchema = z.object({
  workflowId: testRunPathId,
  runId: testRunPathId,
});

const listTestCasesSchema = z.object({
  workflowId: testRunPathId,
  runId: testRunPathId,
  limit: z.number().min(1).max(250).optional(),
  cursor: optionalEmptyAware(z.string()),
});

const triggerTestRunSchema = z.object({
  workflowId: testRunPathId,
});

const cancelTestRunSchema = z.object({
  workflowId: testRunPathId,
  runId: testRunPathId,
});

/**
 * A version id from either store. Local snapshots are numbered integers; n8n's
 * own history uses opaque string ids. The MCP inputSchema deliberately leaves
 * these two properties untyped so the server's argument coercion
 * (`coerceStringifiedJsonParams`, which only touches properties declaring a
 * scalar `type`) lets both shapes through to this union.
 */
const versionIdValue = z.union([z.number().int(), z.string().min(1)]);

const workflowVersionsSchema = z.object({
  mode: z.enum(['list', 'get', 'rollback', 'delete', 'prune', 'diff']),
  source: z.enum(['local', 'native']).optional(),
  workflowId: z.string().optional(),
  versionId: versionIdValue.optional(),
  toVersionId: versionIdValue.optional(),
  limit: z.number().default(10).optional(),
  offset: z.number().int().min(0).optional(),
  validateBefore: z.boolean().default(true).optional(),
  deleteAll: z.boolean().default(false).optional(),
  maxVersions: z.number().default(10).optional(),
  exposeToMcp: z.boolean().optional(),
  timeoutMs: z.number().int().min(5000).max(600000).optional(),
});

// Workflow Management Handlers

export async function handleCreateWorkflow(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = createWorkflowSchema.parse(args);

    // Proactively detect SHORT form node types (common mistake)
    const shortFormErrors: string[] = [];
    input.nodes?.forEach((node: any, index: number) => {
      if (node.type?.startsWith('nodes-base.') || node.type?.startsWith('nodes-langchain.')) {
        const fullForm = node.type.startsWith('nodes-base.')
          ? node.type.replace('nodes-base.', 'n8n-nodes-base.')
          : node.type.replace('nodes-langchain.', '@n8n/n8n-nodes-langchain.');
        shortFormErrors.push(
          `Node ${index} ("${node.name}") uses SHORT form "${node.type}". ` +
          `The n8n API requires FULL form. Change to "${fullForm}"`
        );
      }
    });

    if (shortFormErrors.length > 0) {
      telemetry.trackWorkflowCreation(input, false);
      return {
        success: false,
        error: 'Node type format error: n8n API requires FULL form node types',
        details: {
          errors: shortFormErrors,
          hint: 'Use n8n-nodes-base.* instead of nodes-base.* for standard nodes'
        }
      };
    }

    // Validate workflow structure (n8n API expects FULL form: n8n-nodes-base.*)
    const errors = validateWorkflowStructure(input);
    if (errors.length > 0) {
      // Track validation failure
      telemetry.trackWorkflowCreation(input, false);

      return {
        success: false,
        error: 'Workflow validation failed',
        details: { errors }
      };
    }

    // Canvas groups are kept out of the spread so an ungrouped create sends no `nodeGroups` key
    // at all: Zod emits an own `nodeGroups: undefined` for a caller that sent null.
    const { nodeGroups: rawNodeGroups, ...createPayload } = input;
    const nodeGroups = parseNodeGroupsInput(rawNodeGroups);
    const groupWarnings: string[] = [];

    // Create workflow (n8n API expects node types in FULL form)
    const workflow = await client.createWorkflow(
      nodeGroups !== undefined ? { ...createPayload, nodeGroups } : createPayload,
      {
        authoredGroups: new Set((nodeGroups ?? []).map(group => group.name)),
        onWarning: message => groupWarnings.push(message),
      }
    );

    // Defensive check: ensure the API returned a valid workflow with an ID
    if (!workflow || !workflow.id) {
      return {
        success: false,
        error: 'Workflow creation failed: n8n API returned an empty or invalid response. Verify your N8N_API_URL points to the correct /api/v1 endpoint and that the n8n instance supports workflow creation.',
        details: {
          response: workflow ? { keys: Object.keys(workflow) } : null
        }
      };
    }

    // Track successful workflow creation
    telemetry.trackWorkflowCreation(workflow, true);

    return {
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        nodeCount: workflow.nodes?.length || 0
      },
      message: `Workflow "${workflow.name}" created successfully with ID: ${workflow.id}. Use n8n_get_workflow with mode 'structure' to verify current state.`,
      ...(groupWarnings.length > 0 ? { details: { warnings: groupWarnings } } : {})
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code,
        details: error.details as Record<string, unknown> | undefined
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleGetWorkflow(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);

    const workflow = await client.getWorkflow(id);

    return {
      success: true,
      data: stripActiveVersion(workflow)
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleGetWorkflowDetails(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);

    const workflow = await client.getWorkflow(id);

    // Get recent executions for this workflow
    const executions = await client.listExecutions({
      workflowId: id,
      limit: 10
    });

    // Calculate execution statistics
    const stats = {
      totalExecutions: executions.data.length,
      successCount: executions.data.filter(e => e.status === ExecutionStatus.SUCCESS).length,
      errorCount: executions.data.filter(e => e.status === ExecutionStatus.ERROR).length,
      lastExecutionTime: executions.data[0]?.startedAt || null
    };

    return {
      success: true,
      data: {
        workflow: stripActiveVersion(workflow),
        executionStats: stats,
        hasWebhookTrigger: hasWebhookTrigger(workflow),
        webhookPath: getWebhookUrl(workflow)
      }
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleGetWorkflowStructure(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);
    
    const workflow = await client.getWorkflow(id);
    
    // Simplify nodes to just essential structure
    const simplifiedNodes = workflow.nodes.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      position: node.position,
      disabled: node.disabled || false
    }));
    
    return {
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        isArchived: workflow.isArchived,
        nodes: simplifiedNodes,
        connections: workflow.connections,
        // Canvas groups are part of the topology an editor sees, so structure mode reports them.
        ...nodeGroupsField(workflow.nodeGroups),
        nodeCount: workflow.nodes.length,
        connectionCount: Object.keys(workflow.connections).length
      }
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleGetWorkflowMinimal(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);
    
    const workflow = await client.getWorkflow(id);
    
    return {
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        isArchived: workflow.isArchived,
        tags: workflow.tags || [],
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt
      }
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Returns the full config of only the requested nodes, identified by node name or node ID.
 * Large workflows with long Code-node source can exceed client-side response limits when
 * fetched whole (issue #101); this mode lets a caller pull one heavy node's `parameters`
 * without the rest of the graph. Discover node names cheaply with mode='structure' first.
 *
 * `nodeNames` accepts both node names and node IDs; any entries that match nothing are
 * reported back in `notFound` so the caller knows the lookup was partial.
 */
export async function handleGetWorkflowFiltered(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id, nodeNames } = z.object({
      id: z.string(),
      nodeNames: z.array(z.string()).min(1)
    }).parse(args);

    const workflow = await client.getWorkflow(id);

    const requested = new Set(nodeNames);
    const matchedNodes = workflow.nodes.filter(
      node => requested.has(node.name) || requested.has(node.id)
    );

    // Report any requested keys that resolved to no node so partial requests are transparent.
    const matchedKeys = new Set(matchedNodes.flatMap(node => [node.name, node.id]));
    const notFound = nodeNames.filter(key => !matchedKeys.has(key));

    // Only groups touching the requested nodes. Their nodeIds may reference nodes outside this
    // response — filtered mode returns a slice of the workflow, not a valid whole.
    const matchedIds = new Set(matchedNodes.map(node => node.id));
    const touchedGroups = (workflow.nodeGroups ?? []).filter(group =>
      Array.isArray(group?.nodeIds) && group.nodeIds.some(nodeId => matchedIds.has(nodeId))
    );

    return {
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        isArchived: workflow.isArchived,
        nodes: matchedNodes,
        ...nodeGroupsField(touchedGroups),
        nodeCount: workflow.nodes.length,
        returnedCount: matchedNodes.length,
        ...(notFound.length > 0 ? { notFound } : {})
      }
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Returns the workflow's published (active) graph. n8n's draft/publish model exposes
 * the live version under `activeVersion`; this handler surfaces that as a single-shaped
 * response with `nodes`/`connections` populated from the published version. Use this when
 * you need to see what is actually running in production rather than the latest editor draft.
 *
 * Returns `code: 'NO_ACTIVE_VERSION'` when the workflow has never been published.
 */
export async function handleGetWorkflowActive(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);

    const workflow = await client.getWorkflow(id);
    const activeVersion = workflow.activeVersion;

    // Common metadata fields returned regardless of which graph source we use.
    const baseMeta = {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      isArchived: workflow.isArchived,
      tags: workflow.tags || [],
      settings: workflow.settings,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    };

    if (workflow.activeVersionId && activeVersion) {
      return {
        success: true,
        data: {
          ...baseMeta,
          activeVersionId: workflow.activeVersionId,
          // The version row's creation timestamp, not the publish-event time. n8n doesn't
          // expose a dedicated "publishedAt" on the active version; in current n8n the two
          // are within ~1s of each other but we don't claim they're identical.
          versionCreatedAt: activeVersion.createdAt ?? null,
          versionName: activeVersion.name ?? null,
          nodes: activeVersion.nodes,
          connections: activeVersion.connections,
          // The published version's own groups — NOT workflow.nodeGroups, which is the draft's
          // and would describe frames around nodes that may not exist in this graph.
          ...nodeGroupsField(activeVersion.nodeGroups),
        }
      };
    }

    // Fallback: older n8n versions don't have a draft/publish split — workflow.nodes IS
    // the running graph when workflow.active is true. The same fallback covers the rare
    // orphan case in newer n8n where activeVersionId got nulled but the workflow is still
    // running. In both cases, returning the workflow body honors the "what is actually
    // running" semantic of mode='active'.
    if (workflow.active === true) {
      return {
        success: true,
        data: {
          ...baseMeta,
          activeVersionId: null,
          versionCreatedAt: null,
          versionName: null,
          nodes: workflow.nodes,
          connections: workflow.connections,
          // No draft/publish split here: the workflow body IS the running graph, so its groups apply.
          ...nodeGroupsField(workflow.nodeGroups),
        }
      };
    }

    return {
      success: false,
      error: 'No published version. Workflow is inactive and has never been activated. Use mode="full" to see the draft.',
      code: 'NO_ACTIVE_VERSION'
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleUpdateWorkflow(
  args: unknown,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  const startTime = Date.now();
  // Correlation ID for telemetry. CSPRNG (randomUUID) rather than
  // Math.random — addresses CodeQL js/insecure-randomness.
  const sessionId = `mutation_${Date.now()}_${randomUUID()}`;
  let workflowBefore: any = null;
  let userIntent = 'Full workflow update';
  // Tracked outside the try: a failed PUT that carried parentFolderId may still have
  // persisted the folder move (write-only in n8n, so it can be neither read back nor
  // rolled back), and the error path below must say so.
  let sentParentFolderId = false;

  try {
    const client = ensureApiConfigured(context);
    const input = updateWorkflowSchema.parse(args);
    const { id, createBackup, intent, ...updateData } = input;
    userIntent = intent || 'Full workflow update';
    sentParentFolderId = updateData.parentFolderId !== undefined;

    // n8n's Public API PUT /workflows is a FULL replace: the write schema requires name,
    // nodes, connections AND settings to all be present. This tool exposes them as optional,
    // so we always fetch the current workflow and merge the caller's partial update over it.
    // Without this, omitting e.g. `name` fails with
    // "request/body must have required property 'name'".
    const current = await client.getWorkflow(id);
    workflowBefore = JSON.parse(JSON.stringify(current));

    // Preserve credentials from current workflow for nodes that don't specify them.
    // AI-generated node updates typically omit credential references because they
    // aren't included in the context provided to the AI. Without this merge, the
    // n8n API rejects the PUT with missing credentials.
    if (updateData.nodes && current.nodes) {
      const currentById = new Map<string, any>();
      const currentByName = new Map<string, any>();
      for (const node of current.nodes) {
        if (node.id) currentById.set(node.id, node);
        currentByName.set(node.name, node);
      }
      for (const node of updateData.nodes as any[]) {
        const hasCredentials = node.credentials && typeof node.credentials === 'object' && Object.keys(node.credentials).length > 0;
        if (!hasCredentials) {
          const match = (node.id && currentById.get(node.id)) || currentByName.get(node.name);
          if (match?.credentials) {
            node.credentials = match.credentials;
          }
        }
      }
    }

    // Merge the partial update over the current workflow so all API-required fields are
    // present. cleanWorkflowForUpdate() (inside client.updateWorkflow) strips the read-only
    // fields carried in from the GET response.
    //
    // Settings are handled separately from the spread: the Zod schema allows `settings` to be
    // null / any value, and a null (or otherwise non-object) value spread over `current` would
    // clobber the existing settings and then get reduced to minimal defaults downstream. n8n's
    // PUT is a full replace and requires settings to be present, so we only override when the
    // caller supplied a real settings object — and then we merge it over the current settings
    // so a partial payload (e.g. { executionOrder: 'v0' }) doesn't drop untouched keys like
    // timezone/errorWorkflow. A missing/null/non-object settings value leaves current settings
    // untouched.
    // Canvas groups are kept out of the spread for the same reason: Zod emits an own
    // `nodeGroups: undefined` key when the caller sends null, and spreading that would wipe the
    // stored groups. The contract is: key absent (or null) => keep the stored groups,
    // `nodeGroups: []` => ungroup everything, a non-empty array => replace.
    const { settings: settingsUpdate, nodeGroups: rawNodeGroups, ...nonSettingsUpdate } = updateData;
    const nodeGroupsUpdate = parseNodeGroupsInput(rawNodeGroups);
    const fullWorkflow = {
      ...current,
      ...nonSettingsUpdate
    };

    if (settingsUpdate && typeof settingsUpdate === 'object') {
      fullWorkflow.settings = {
        ...((current.settings as Record<string, unknown>) ?? {}),
        ...(settingsUpdate as Record<string, unknown>),
      };
    }

    if (nodeGroupsUpdate !== undefined) {
      fullWorkflow.nodeGroups = nodeGroupsUpdate;
    }

    // Backup + structure validation when the graph or its grouping changed.
    if (updateData.nodes || updateData.connections || nodeGroupsUpdate !== undefined) {
      // Create backup before modifying workflow (default: true)
      if (createBackup !== false) {
        try {
          const versioningService = new WorkflowVersioningService(repository, client, getInstanceScopeId(context));
          const backupResult = await versioningService.createBackup(id, current, {
            trigger: 'full_update'
          });

          logger.info('Workflow backup created', {
            workflowId: id,
            versionId: backupResult.versionId,
            versionNumber: backupResult.versionNumber,
            pruned: backupResult.pruned
          });
        } catch (error: any) {
          logger.warn('Failed to create workflow backup', {
            workflowId: id,
            error: error.message
          });
          // Continue with update even if backup fails (non-blocking)
        }
      }

      // Validate workflow structure (n8n API expects FULL form: n8n-nodes-base.*)
      const errors = validateWorkflowStructure(fullWorkflow);
      if (errors.length > 0) {
        return {
          success: false,
          error: 'Workflow validation failed',
          details: { errors }
        };
      }
    }

    // Update workflow with the merged full payload. Groups the caller supplied here are
    // "authored": if n8n rejects one, that surfaces as an error rather than being ungrouped
    // silently. Groups carried in from the GET degrade with a warning instead.
    const groupWarnings: string[] = [];
    const workflow = await client.updateWorkflow(id, fullWorkflow as Partial<Workflow>, {
      authoredGroups: new Set((nodeGroupsUpdate ?? []).map(group => group.name)),
      onWarning: message => groupWarnings.push(message),
    });

    // Track successful mutation
    if (workflowBefore) {
      void trackWorkflowMutationForFullUpdate({
        sessionId,
        toolName: 'n8n_update_full_workflow',
        userIntent,
        operations: [], // Full update doesn't use diff operations
        workflowBefore,
        workflowAfter: workflow,
        mutationSuccess: true,
        durationMs: Date.now() - startTime,
      }).catch(err => {
        logger.warn('Failed to track mutation telemetry:', err);
      });
    }

    return {
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        active: workflow.active,
        nodeCount: workflow.nodes?.length || 0
      },
      message: `Workflow "${workflow.name}" updated successfully. Use n8n_get_workflow with mode 'structure' to verify current state.`,
      ...(groupWarnings.length > 0 ? { details: { warnings: groupWarnings } } : {})
    };
  } catch (error) {
    // Track failed mutation
    if (workflowBefore) {
      void trackWorkflowMutationForFullUpdate({
        sessionId,
        toolName: 'n8n_update_full_workflow',
        userIntent,
        operations: [],
        workflowBefore,
        workflowAfter: workflowBefore, // No change since it failed
        mutationSuccess: false,
        mutationError: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      }).catch(err => {
        logger.warn('Failed to track mutation telemetry for failed operation:', err);
      });
    }

    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      const baseDetails = error.details as Record<string, unknown> | undefined;
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error) + (sentParentFolderId
          ? ' A folder move in the failed update may still have persisted - n8n cannot report or restore folder placement.'
          : ''),
        code: error.code,
        details: sentParentFolderId
          ? { ...(baseDetails ?? {}), folderMoveMayHavePersisted: true }
          : baseDetails
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Track workflow mutation for telemetry (full workflow updates)
 */
async function trackWorkflowMutationForFullUpdate(data: any): Promise<void> {
  try {
    const { telemetry } = await import('../telemetry/telemetry-manager.js');
    await telemetry.trackWorkflowMutation(data);
  } catch (error) {
    // Silently fail - telemetry should never break core functionality
    logger.debug('Telemetry tracking failed:', error);
  }
}

export async function handleDeleteWorkflow(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);

    const deleted = await client.deleteWorkflow(id);

    return {
      success: true,
      data: {
        id: deleted?.id || id,
        name: deleted?.name,
        deleted: true
      },
      message: `Workflow "${deleted?.name || id}" deleted successfully.`
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleListWorkflows(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = listWorkflowsSchema.parse(args || {});

    // Convert tags array to comma-separated string (n8n API format)
    const tagsParam = input.tags && input.tags.length > 0
      ? input.tags.join(',')
      : undefined;

    const response = await client.listWorkflows({
      limit: input.limit || 100,
      cursor: input.cursor,
      active: input.active,
      tags: tagsParam as any,  // API expects string, not array
      projectId: input.projectId,
      excludePinnedData: input.excludePinnedData ?? true
    });
    
    // Strip down workflows to only essential metadata
    const minimalWorkflows = response.data.map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      isArchived: workflow.isArchived,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      tags: workflow.tags || [],
      nodeCount: workflow.nodes?.length || 0
    }));

    return {
      success: true,
      data: {
        workflows: minimalWorkflows,
        returned: minimalWorkflows.length,
        nextCursor: response.nextCursor,
        hasMore: !!response.nextCursor,
        ...(response.nextCursor ? { 
          _note: "More workflows available. Use cursor to get next page." 
        } : {})
      }
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleValidateWorkflow(
  args: unknown,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = validateWorkflowSchema.parse(args);
    
    // First, fetch the workflow from n8n
    const workflowResponse = await handleGetWorkflow({ id: input.id }, context);
    
    if (!workflowResponse.success) {
      return workflowResponse; // Return the error from fetching
    }
    
    const workflow = workflowResponse.data as Workflow;
    
    // Create validator instance using the provided repository
    const validator = new WorkflowValidator(repository, EnhancedConfigValidator);
    
    // Run validation
    const validationResult = await validator.validateWorkflow(workflow, input.options);
    
    // Format the response (same format as the regular validate_workflow tool)
    const response: WorkflowValidationResponse = {
      valid: validationResult.valid,
      workflowId: workflow.id,
      workflowName: workflow.name,
      summary: {
        totalNodes: validationResult.statistics.totalNodes,
        enabledNodes: validationResult.statistics.enabledNodes,
        triggerNodes: validationResult.statistics.triggerNodes,
        validConnections: validationResult.statistics.validConnections,
        invalidConnections: validationResult.statistics.invalidConnections,
        expressionsValidated: validationResult.statistics.expressionsValidated,
        errorCount: validationResult.errors.length,
        warningCount: validationResult.warnings.length
      }
    };
    
    if (validationResult.errors.length > 0) {
      response.errors = validationResult.errors.map(e => ({
        node: e.nodeName || 'workflow',
        nodeName: e.nodeName, // Also set nodeName for compatibility
        message: e.message,
        details: e.details
      }));
    }

    if (validationResult.warnings.length > 0) {
      response.warnings = validationResult.warnings.map(w => ({
        node: w.nodeName || 'workflow',
        nodeName: w.nodeName, // Also set nodeName for compatibility
        message: w.message,
        details: w.details
      }));
    }
    
    if (validationResult.suggestions.length > 0) {
      response.suggestions = validationResult.suggestions;
    }

    // Track successfully validated workflows in telemetry
    if (validationResult.valid) {
      telemetry.trackWorkflowCreation(workflow, true);
    }

    return {
      success: true,
      data: response
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleAutofixWorkflow(
  args: unknown,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = autofixWorkflowSchema.parse(args);

    // First, fetch the workflow from n8n
    const workflowResponse = await handleGetWorkflow({ id: input.id }, context);

    if (!workflowResponse.success) {
      return workflowResponse; // Return the error from fetching
    }

    const workflow = workflowResponse.data as Workflow;

    // Create validator instance using the provided repository
    const validator = new WorkflowValidator(repository, EnhancedConfigValidator);

    // Run validation to identify issues
    const validationResult = await validator.validateWorkflow(workflow, {
      validateNodes: true,
      validateConnections: true,
      validateExpressions: true,
      profile: 'ai-friendly'
    });

    // Check for expression format issues
    const allFormatIssues: ExpressionFormatIssue[] = [];
    for (const node of workflow.nodes) {
      const formatContext = {
        nodeType: node.type,
        nodeName: node.name,
        nodeId: node.id
      };

      const nodeFormatIssues = ExpressionFormatValidator.validateNodeParameters(
        node.parameters,
        formatContext
      );

      // Add node information to each format issue
      const enrichedIssues = nodeFormatIssues.map(issue => ({
        ...issue,
        nodeName: node.name,
        nodeId: node.id
      }));

      allFormatIssues.push(...enrichedIssues);
    }

    // Generate fixes using WorkflowAutoFixer
    const autoFixer = new WorkflowAutoFixer(repository);
    const fixResult = await autoFixer.generateFixes(
      workflow,
      validationResult,
      allFormatIssues,
      {
        applyFixes: input.applyFixes,
        fixTypes: input.fixTypes,
        confidenceThreshold: input.confidenceThreshold,
        maxFixes: input.maxFixes
      }
    );

    // If no fixes available
    if (fixResult.fixes.length === 0) {
      return {
        success: true,
        data: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          message: 'No automatic fixes available for this workflow',
          validationSummary: {
            errors: validationResult.errors.length,
            warnings: validationResult.warnings.length
          }
        }
      };
    }

    // If preview mode (applyFixes = false)
    if (!input.applyFixes) {
      return {
        success: true,
        data: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          preview: true,
          fixesAvailable: fixResult.fixes.length,
          fixes: fixResult.fixes,
          summary: fixResult.summary,
          stats: fixResult.stats,
          message: `${fixResult.fixes.length} fixes available. Set applyFixes=true to apply them.`
        }
      };
    }

    // Apply fixes using the diff engine
    if (fixResult.operations.length > 0) {
      const updateResult = await handleUpdatePartialWorkflow(
        {
          id: workflow.id,
          operations: fixResult.operations,
          createBackup: true  // Ensure backup is created with autofix metadata
        },
        repository,
        context
      );

      if (!updateResult.success) {
        return {
          success: false,
          error: 'Failed to apply fixes',
          details: {
            fixes: fixResult.fixes,
            updateError: updateResult.error
          }
        };
      }

      return {
        success: true,
        data: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          fixesApplied: fixResult.fixes.length,
          fixes: fixResult.fixes,
          summary: fixResult.summary,
          stats: fixResult.stats,
          message: `Successfully applied ${fixResult.fixes.length} fixes to workflow "${workflow.name}"`
        }
      };
    }

    return {
      success: true,
      data: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        message: 'No fixes needed'
      }
    };

  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Execution Management Handlers

/** The action label every official call from n8n_test_workflow reports. */
const OFFICIAL_TEST_ACTION = 'test_workflow';

/**
 * Statuses `test_workflow` reports for a run that STARTED but did not end
 * well. The call itself succeeded, so `callOfficialTool` returns a success and
 * this handler is the one that turns the run's outcome into a failure.
 */
const FAILED_RUN_STATUSES = new Set(['error', 'crashed', 'canceled']);

/**
 * `timeout` only ever governs the HTTP trigger path (method auto/trigger);
 * the official methods use `timeoutMs`. A caller who passes both on a
 * prepare/pinned/direct call gets this note rather than a silently ignored
 * `timeout`.
 */
const LEGACY_TIMEOUT_SCOPE_WARNING =
  'timeout applies to the HTTP trigger path only; use timeoutMs for method prepare/pinned/direct';

/** The `n8n_test_workflow` methods routed through n8n's own MCP server. */
const OFFICIAL_TEST_METHODS = new Set(['prepare', 'pinned', 'direct']);

/**
 * Handler for n8n_test_workflow tool
 *
 * `method` picks the backend:
 * - `trigger` (and `auto` when the workflow has a webhook/form/chat trigger)
 *   runs the existing Public-API HTTP path.
 * - `prepare` / `pinned` / `direct` go through n8n's instance-level MCP server,
 *   behind the "Available in MCP" consent flow.
 *
 * `auto` never executes anything through the official server: without a
 * detected trigger it returns the same error it always has, naming the two
 * official methods in its hint so the caller chooses one deliberately.
 */
export async function handleTestWorkflow(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const input = testWorkflowSchema.parse(args);
    const method = input.method ?? 'auto';

    // Nullable on purpose: `prepare` needs no Public API call, so it must not
    // require N8N_API_KEY. Every other method resolves the same client through
    // ensureApiConfigured below, which turns a null into the NOT_CONFIGURED error.
    const apiClient = getN8nApiClient(context);

    // Reads default to 30 s; a run gets the longer deadline.
    const officialTimeoutMs = input.timeoutMs ?? (method === 'prepare' ? DEFAULT_TIMEOUT_MS : PINNED_TIMEOUT_MS);
    const routeOfficial = async (
      aliases: string[],
      officialArgs: Record<string, unknown>,
      idempotent: boolean,
      resolvedMethod: 'prepare' | 'pinned' | 'direct'
    ): Promise<McpToolResponse> => {
      // withMcpExposure returns the envelope undecorated (and may already carry
      // warnings from the consent write) — spread first, then label it.
      const response = await withMcpExposure(
        {
          apiClient,
          workflowId: input.workflowId,
          exposeToMcp: input.exposeToMcp,
          action: OFFICIAL_TEST_ACTION,
          toolName: 'n8n_test_workflow',
          context,
        },
        () => callOfficialTool(context, aliases, officialArgs, officialTimeoutMs, OFFICIAL_TEST_ACTION, idempotent)
      );
      const decorated = { ...response, method: resolvedMethod, backend: 'official-mcp' };
      if (input.timeout !== undefined && decorated.success) {
        decorated.warnings = [...(decorated.warnings ?? []), LEGACY_TIMEOUT_SCOPE_WARNING];
      }
      return decorated;
    };

    // An EMPTY pinData is refused like a missing one: n8n would run the
    // workflow with nothing pinned, so every credentialed and HTTP node in it
    // would do real work — the opposite of what "pinned" asks for.
    if (method === 'pinned' && Object.keys(input.pinData ?? {}).length === 0) {
      return {
        success: false,
        code: 'INVALID_ARGS',
        method: 'pinned',
        error: 'pinData is required for method: pinned (keys are node names, values are arrays of items wrapped as { "json": { ... } }). Run method: prepare first to see which nodes need pinned data.',
      };
    }

    // The effective operation of `auto` is `trigger`: it is the only thing auto
    // ever executes. Disabling `trigger` therefore stops `auto` as well.
    if ((method === 'auto' || method === 'trigger') && isOperationDisabled('n8n_test_workflow', 'trigger')) {
      return {
        success: false,
        code: 'OPERATION_DISABLED',
        method: 'trigger',
        backend: 'public-api',
        error: "Operation 'trigger' on tool 'n8n_test_workflow' is disabled by server policy.",
        details: { requestedMethod: method },
      };
    }

    // Every path of this tool except a plain `prepare` depends on the Public
    // API client: `auto`/`trigger` run through it, `pinned`/`direct` read the
    // workflow through it for trigger detection, and any `exposeToMcp` consent
    // write goes through it. On a url+token context that client silently falls
    // back to the operator's own instance while the official-MCP client is
    // context-authoritative, so refuse before any read, trigger or write.
    // A plain `prepare` touches none of it and stays open.
    const isPlainPrepare = method === 'prepare' && input.exposeToMcp !== true;
    if (!isPlainPrepare && !publicApiMatchesContext(context)) {
      return {
        success: false,
        code: 'NOT_CONFIGURED',
        method,
        backend: OFFICIAL_TEST_METHODS.has(method) ? 'official-mcp' : 'public-api',
        error: PUBLIC_API_CONTEXT_HINT,
      };
    }

    // prepare only needs the workflow id — no trigger analysis, no workflow
    // GET, and no Public API key: it runs before ensureApiConfigured.
    if (method === 'prepare') {
      return routeOfficial(['prepare_workflow_pin_data'], { workflowId: input.workflowId }, true, 'prepare');
    }

    const client = ensureApiConfigured(context);

    // Import trigger system (lazy to avoid circular deps)
    const {
      detectTriggerFromWorkflow,
      classifyTriggerNode,
      ensureRegistryInitialized,
      TriggerRegistry,
    } = await import('../triggers');

    // Fetch the workflow to analyze its trigger
    const workflow = await client.getWorkflow(input.workflowId);

    // Auto-detect from workflow
    const detection = detectTriggerFromWorkflow(workflow);
    const detectedNodeName = detection.trigger?.node.name;

    if (method === 'pinned') {
      const pinnedTriggerNode = input.triggerNodeName ?? detectedNodeName;
      const response = await routeOfficial(
        ['test_workflow'],
        {
          workflowId: input.workflowId,
          pinData: input.pinData,
          ...(pinnedTriggerNode ? { triggerNodeName: pinnedTriggerNode } : {}),
          // Keep n8n's own deadline inside ours, so a slow run is reported by
          // n8n rather than cut short by the client's timeout.
          timeout: Math.max(1, Math.floor(officialTimeoutMs / 1000) - 5),
        },
        false,
        'pinned'
      );
      if (!response.success) return response;

      const run = (response.data ?? {}) as { executionId?: unknown; status?: unknown; error?: unknown };
      const executionId = typeof run.executionId === 'string' ? run.executionId : undefined;
      const status = typeof run.status === 'string' ? run.status : undefined;
      if (status && FAILED_RUN_STATUSES.has(status)) {
        return {
          ...response,
          success: false,
          code: 'EXECUTION_FAILED',
          error: typeof run.error === 'string' ? run.error : `Run finished with status ${status}`,
          ...(executionId ? { executionId } : {}),
        };
      }
      return { ...response, ...(executionId ? { executionId } : {}) };
    }

    if (method === 'direct') {
      // An explicitly named trigger node decides the payload shape; only
      // without one does the workflow's first detected trigger decide it.
      const namedNode = input.triggerNodeName
        ? (workflow.nodes ?? []).find(node => node.name === input.triggerNodeName)
        : undefined;
      if (input.triggerNodeName && !namedNode) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          method: 'direct',
          backend: 'official-mcp',
          error: `triggerNodeName "${input.triggerNodeName}" is not a node of workflow ${input.workflowId}`,
        };
      }
      const triggerKind: TriggerType | null = input.triggerNodeName
        ? (namedNode ? classifyTriggerNode(namedNode) : null)
        : (detection.trigger?.type ?? null);

      let inputs: Record<string, unknown> | undefined;
      if (input.message !== undefined) {
        inputs = { chatInput: input.message };
      } else if (input.data && triggerKind === 'form') {
        inputs = { formData: input.data };
      } else if (input.data || input.headers || input.httpMethod) {
        inputs = {
          webhookData: {
            method: input.httpMethod ?? 'POST',
            ...(input.data ? { body: input.data } : {}),
            ...(input.headers ? { headers: input.headers } : {}),
          },
        };
      }

      // n8n requires triggerNodeName whenever inputs are given.
      const directTriggerNode = input.triggerNodeName ?? (inputs ? detectedNodeName : undefined);
      if (inputs && !directTriggerNode) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          method: 'direct',
          error: 'triggerNodeName is required when inputs are given and no trigger node could be detected',
          details: { workflowId: input.workflowId, reason: detection.reason },
        };
      }

      const response = await routeOfficial(
        ['execute_workflow'],
        {
          workflowId: input.workflowId,
          executionMode: input.executionMode ?? 'manual',
          ...(directTriggerNode ? { triggerNodeName: directTriggerNode } : {}),
          ...(inputs ? { inputs } : {}),
        },
        false,
        'direct'
      );
      if (!response.success) return response;

      const executionId = (response.data as { executionId?: unknown } | undefined)?.executionId;
      return {
        ...response,
        ...(typeof executionId === 'string' ? { executionId } : {}),
        hint: 'execute_workflow returns as soon as the run starts; poll n8n_executions with the executionId for the result.',
      };
    }

    // Ensure registry is initialized
    await ensureRegistryInitialized();

    // Determine trigger type
    let triggerType: TriggerType | undefined = input.triggerType as TriggerType | undefined;
    let triggerInfo;

    if (!triggerType) {
      if (detection.detected && detection.trigger) {
        triggerType = detection.trigger.type;
        triggerInfo = detection.trigger;
      } else {
        // No externally-triggerable trigger found
        return {
          success: false,
          error: 'Workflow cannot be triggered externally',
          method,
          backend: 'public-api',
          details: {
            workflowId: input.workflowId,
            reason: detection.reason,
            hint: 'Only workflows with webhook, form, or chat triggers can be executed via the API. Add one of these trigger nodes to your workflow.'
              + ' To run it anyway through n8n\'s MCP server, call again with method: direct (executionMode manual) or method: pinned with pinData from method: prepare — both need N8N_MCP_ACCESS_TOKEN.',
          },
        };
      }
    } else {
      // User specified a trigger type, verify it matches workflow
      if (detection.detected && detection.trigger?.type === triggerType) {
        triggerInfo = detection.trigger;
      } else if (!detection.detected || detection.trigger?.type !== triggerType) {
        return {
          success: false,
          error: `Workflow does not have a ${triggerType} trigger`,
          method: 'trigger',
          backend: 'public-api',
          details: {
            workflowId: input.workflowId,
            requestedTrigger: triggerType,
            detectedTrigger: detection.trigger?.type || 'none',
            hint: detection.detected
              ? `Workflow has a ${detection.trigger?.type} trigger. Either use that type or omit triggerType for auto-detection.`
              : 'Workflow has no externally-triggerable triggers (webhook, form, or chat).',
          },
        };
      }
    }

    // Get handler for trigger type
    const handler = TriggerRegistry.getHandler(triggerType, client, context);
    if (!handler) {
      return {
        success: false,
        error: `No handler registered for trigger type: ${triggerType}`,
        method: 'trigger',
        backend: 'public-api',
        details: {
          supportedTypes: TriggerRegistry.getRegisteredTypes(),
        },
      };
    }

    // Check if workflow is active (if required by handler)
    if (handler.capabilities.requiresActiveWorkflow && !workflow.active) {
      return {
        success: false,
        error: 'Workflow must be active to trigger via this method',
        method: 'trigger',
        backend: 'public-api',
        details: {
          workflowId: input.workflowId,
          triggerType,
          hint: 'Activate the workflow in n8n using n8n_update_partial_workflow with [{type: "activateWorkflow"}]',
        },
      };
    }

    // Validate chat trigger has message
    if (triggerType === 'chat' && !input.message) {
      return {
        success: false,
        error: 'Chat trigger requires a message parameter',
        method: 'trigger',
        backend: 'public-api',
        details: {
          hint: 'Provide message="your message" for chat triggers',
        },
      };
    }

    // Build trigger-specific input
    const triggerInput = {
      workflowId: input.workflowId,
      triggerType,
      httpMethod: input.httpMethod,
      webhookPath: input.webhookPath,
      message: input.message || '',
      sessionId: input.sessionId,
      data: input.data,
      formData: input.data, // For form triggers
      headers: input.headers,
      timeout: input.timeout,
      waitForResponse: input.waitForResponse,
    };

    // Execute the trigger
    const response = await handler.execute(triggerInput as any, workflow, triggerInfo);

    return {
      success: response.success,
      data: response.data,
      message: response.success
        ? `Workflow triggered successfully via ${triggerType}`
        : response.error,
      executionId: response.executionId,
      workflowId: input.workflowId,
      method: 'trigger',
      backend: 'public-api',
      details: {
        triggerType,
        metadata: response.metadata,
        ...(response.details || {}),
      },
    };
  } catch (error) {
    // A schema failure happens before `input` exists, so the labels come from
    // the raw arguments here. A blank `method` is the default one, matching
    // what the schema would have resolved it to.
    const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const rawMethod =
      typeof raw.method === 'string' && raw.method.trim() !== '' ? raw.method : 'auto';
    const label = {
      method: rawMethod,
      backend: OFFICIAL_TEST_METHODS.has(rawMethod) ? 'official-mcp' : 'public-api',
    };

    if (error instanceof z.ZodError) {
      return {
        success: false,
        ...label,
        error: 'Invalid input',
        details: { errors: error.errors },
      };
    }

    if (error instanceof N8nApiError) {
      return {
        success: false,
        ...label,
        error: getUserFriendlyErrorMessage(error),
        code: error.code,
        details: error.details as Record<string, unknown> | undefined,
      };
    }

    return {
      success: false,
      ...label,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function handleGetExecution(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);

    // Parse and validate input with new parameters
    const schema = z.object({
      id: z.string(),
      // Filtering parameters
      mode: z.enum(['preview', 'summary', 'filtered', 'full', 'error']).optional(),
      nodeNames: z.array(z.string()).optional(),
      itemsLimit: z.number().optional(),
      includeInputData: z.boolean().optional(),
      // Legacy parameter (backward compatibility)
      includeData: z.boolean().optional(),
      // Error mode specific parameters
      errorItemsLimit: z.number().min(0).max(100).optional(),
      includeStackTrace: z.boolean().optional(),
      includeExecutionPath: z.boolean().optional(),
      fetchWorkflow: z.boolean().optional()
    });

    const params = schema.parse(args);
    const {
      id,
      mode,
      nodeNames,
      itemsLimit,
      includeInputData,
      includeData,
      errorItemsLimit,
      includeStackTrace,
      includeExecutionPath,
      fetchWorkflow
    } = params;

    /**
     * Map legacy includeData parameter to mode for backward compatibility
     *
     * Legacy behavior:
     * - includeData: undefined -> minimal execution summary (no data)
     * - includeData: false -> minimal execution summary (no data)
     * - includeData: true -> full execution data
     *
     * New behavior mapping:
     * - includeData: undefined -> no mode (minimal)
     * - includeData: false -> no mode (minimal)
     * - includeData: true -> mode: 'summary' (2 items per node, not full)
     *
     * Note: Legacy true behavior returned ALL data, which could exceed token limits.
     * New behavior caps at 2 items for safety. Users can use mode: 'full' for old behavior.
     */
    let effectiveMode = mode;
    if (!effectiveMode && includeData !== undefined) {
      effectiveMode = includeData ? 'summary' : undefined;
    }

    // Determine if we need to fetch full data from API
    // We fetch full data if any mode is specified (including preview) or legacy includeData is true
    // Preview mode needs the data to analyze structure and generate recommendations
    const fetchFullData = effectiveMode !== undefined || includeData === true;

    // Fetch execution from n8n API
    const execution = await client.getExecution(id, fetchFullData);

    // If no filtering options specified, return original execution (backward compatibility)
    if (!effectiveMode && !nodeNames && itemsLimit === undefined) {
      return {
        success: true,
        data: execution
      };
    }

    // For error mode, optionally fetch workflow for accurate upstream detection
    let workflow: Workflow | undefined;
    if (effectiveMode === 'error' && fetchWorkflow !== false && execution.workflowId) {
      try {
        workflow = await client.getWorkflow(execution.workflowId);
      } catch (e) {
        // Workflow fetch failed - continue without it (use heuristics)
        logger.debug('Could not fetch workflow for error analysis', {
          workflowId: execution.workflowId,
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      }
    }

    // Apply filtering using ExecutionProcessor
    const filterOptions: ExecutionFilterOptions = {
      mode: effectiveMode,
      nodeNames,
      itemsLimit,
      includeInputData,
      // Error mode specific options
      errorItemsLimit,
      includeStackTrace,
      includeExecutionPath
    };

    const processedExecution = processExecution(execution, filterOptions, workflow);

    return {
      success: true,
      data: processedExecution
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleListExecutions(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = listExecutionsSchema.parse(args || {});
    
    const response = await client.listExecutions({
      limit: input.limit || 20,
      cursor: input.cursor,
      workflowId: input.workflowId,
      projectId: input.projectId,
      status: input.status as ExecutionStatus | undefined,
      includeData: input.includeData || false
    });
    
    return {
      success: true,
      data: {
        executions: response.data,
        returned: response.data.length,
        nextCursor: response.nextCursor,
        hasMore: !!response.nextCursor,
        ...(response.nextCursor ? { 
          _note: "More executions available. Use cursor to get next page." 
        } : {})
      }
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

export async function handleDeleteExecution(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = z.object({ id: z.string() }).parse(args);
    
    await client.deleteExecution(id);
    
    return {
      success: true,
      message: `Execution ${id} deleted successfully`
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Evaluation Test Run Handlers (reads n8n >= 2.30, run/cancel n8n >= 2.32)

const TEST_RUN_QUOTA_HINT =
  'n8n rejected the request (402): the plan\'s evaluation quota is used up. It caps how many workflows may have test runs, and this workflow does not hold one of the slots. Re-run a workflow that already has runs, or raise the limit on your n8n plan.';

/**
 * 403 guidance for the write actions. All three causes - a key without the
 * scope, an unlicensed instance, and a key owner without workflow:execute -
 * surface identically, so name them all.
 */
function testRunWriteScopeHint(scope: 'testRun:create' | 'testRun:cancel'): string {
  return `n8n rejected the request (403). The API key lacks the ${scope} scope - that scope only exists on keys created on n8n 2.32+, so re-create the key there. Other causes: evaluations not licensed on this plan, or the key's owner lacks workflow:execute on this workflow.`;
}

const TEST_RUN_IDS_HINT =
  'Workflow or test run not found. A runId must belong to the given workflowId; check both ids.';

/** For the actions that take no runId, where TEST_RUN_IDS_HINT would misdirect. */
const TEST_RUN_WORKFLOW_HINT =
  "Workflow not found. Check the workflowId, and that the API key's owner has access to that workflow.";

/** Per-action tuning for handleTestRunError. */
interface TestRunErrorOptions {
  /** Minimum n8n 2.x minor whose Public API serves the route. */
  minMinor: number;
  /** Completes "Upgrade the instance to ..." in the version-gate message. */
  capability: string;
  /** 403 guidance; each action names the scope it needs. */
  scopeHint: string;
  /** 404 guidance once the instance version is ruled out. */
  notFoundHint: string;
  /** 409 guidance; only the write actions can produce one. */
  conflictHint?: string;
  /**
   * True for the actions whose route is POST. Only they can read a 405 as "the
   * instance does not document this method"; the read routes are GET, so a 405
   * on one of those comes from something in front of n8n, not from its version.
   */
  postRoute?: boolean;
}

/** Common to the read actions; they differ only in their 404 guidance. */
const READ_TEST_RUN_BASE = {
  minMinor: 30,
  capability: 'read test runs',
  scopeHint:
    'n8n rejected the request (403). The API key lacks testRun scopes - keys created before n8n 2.30 do not have them; re-create the API key on n8n 2.30+. Other causes: evaluations not licensed on this plan, or the key\'s owner lacks access to this workflow.',
};

const LIST_TEST_RUNS_ERRORS: TestRunErrorOptions = {
  ...READ_TEST_RUN_BASE,
  notFoundHint: TEST_RUN_WORKFLOW_HINT,
};

/** get_run and list_cases both address a run within a workflow. */
const READ_TEST_RUN_ERRORS: TestRunErrorOptions = {
  ...READ_TEST_RUN_BASE,
  notFoundHint: TEST_RUN_IDS_HINT,
};

const TRIGGER_TEST_RUN_ERRORS: TestRunErrorOptions = {
  minMinor: 32,
  capability: 'trigger runs from the API',
  scopeHint: testRunWriteScopeHint('testRun:create'),
  notFoundHint: TEST_RUN_WORKFLOW_HINT,
  conflictHint:
    'The workflow has no evaluation trigger node. Add an evaluation trigger (n8n-nodes-base.evaluationTrigger) pointing at a dataset, save the workflow, then trigger the run.',
  postRoute: true,
};

const CANCEL_TEST_RUN_ERRORS: TestRunErrorOptions = {
  minMinor: 32,
  capability: 'cancel runs from the API',
  scopeHint: testRunWriteScopeHint('testRun:cancel'),
  notFoundHint: TEST_RUN_IDS_HINT,
  conflictHint:
    "The test run already finished (status completed, error, or cancelled), so there is nothing to cancel. Use action='get_run' to see its final state.",
  postRoute: true,
};

/**
 * Guidance for the two statuses an instance without the route produces: 404 when
 * the path is undocumented, 405 when the path exists for another method (a
 * pre-2.32 instance serves GET /test-runs but not POST). Returns null when the
 * instance is new enough, leaving the status to the caller's normal mapping.
 */
async function testRunRouteGate(
  statusCode: number,
  context: InstanceContext | undefined,
  options: TestRunErrorOptions
): Promise<string | null> {
  // Re-read the version rather than trusting the cache: it lives as long as the
  // client, so an instance upgraded mid-session would still be blamed for a
  // genuine bad-id 404. One extra request, only on these two statuses.
  const client = getN8nApiClient(context);
  const version = client ? await client.refreshVersion().catch(() => null) : null;

  if (version) {
    return versionAtLeast(version, 2, options.minMinor)
      ? null
      : `The evaluation API requires n8n 2.${options.minMinor}.0 or later; this instance runs ${version.version}. Upgrade the instance to ${options.capability}.`;
  }

  // Version unreadable, so the gate cannot be asserted. On a POST route a 405
  // still has one cause - the instance does not document the method - while a
  // 404 is equally consistent with wrong ids, so offer both.
  const requirement = `This endpoint requires n8n 2.${options.minMinor}.0 or later, and this instance's n8n version could not be read.`;
  return statusCode === 405 && options.postRoute
    ? `${requirement} It rejected POST on the route, which is what an instance predating 2.${options.minMinor}.0 does. Upgrade the instance to ${options.capability}.`
    : `${requirement} Either the instance predates it, or the request simply did not match. ${options.notFoundHint}`;
}

/**
 * Builds the error response for the evaluation handlers. Mirrors handleCrudError
 * but adds evaluation-specific guidance for the failure modes that are easy to
 * confuse from raw HTTP statuses alone: an instance too old for the route, an
 * API key without testRun scopes, an exhausted evaluation quota, a workflow
 * without an evaluation trigger, and a runId that does not belong to the given
 * workflow.
 */
async function handleTestRunError(
  error: unknown,
  context: InstanceContext | undefined,
  options: TestRunErrorOptions
): Promise<McpToolResponse> {
  if (error instanceof z.ZodError) {
    return { success: false, error: 'Invalid input', details: { errors: error.errors } };
  }
  if (error instanceof N8nApiError) {
    if (error.statusCode === 402) {
      return { success: false, error: TEST_RUN_QUOTA_HINT, code: error.code };
    }
    if (error.statusCode === 403) {
      return { success: false, error: options.scopeHint, code: error.code };
    }
    if (error.statusCode === 409 && options.conflictHint) {
      return { success: false, error: options.conflictHint, code: error.code };
    }
    if (error.statusCode === 404 || error.statusCode === 405) {
      const gate = await testRunRouteGate(error.statusCode, context, options);
      if (gate) {
        return { success: false, error: gate, code: error.code };
      }
    }
    // On a current instance only the 404 form is about the request; a 405 falls through.
    if (error.statusCode === 404) {
      return { success: false, error: options.notFoundHint, code: error.code };
    }
    return { success: false, error: getUserFriendlyErrorMessage(error), code: error.code };
  }
  return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
}

export async function handleListTestRuns(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = listTestRunsSchema.parse(args || {});

    // Send limit only when the caller sets one: n8n's server default is the
    // same 100, and pre-2.30 instances (no test-runs routes) reject unknown
    // query params before returning the 404 our error mapping explains.
    const response = await client.listTestRuns(input.workflowId, {
      status: input.status as TestRunStatus | undefined,
      limit: input.limit,
      cursor: input.cursor,
    });

    const note = response.data.length === 0
      ? (input.status
          ? `No test runs with status '${input.status}' for this workflow.`
          : 'No test runs. Runs exist only for workflows with an evaluation trigger that have been executed at least once.')
      : response.nextCursor
        ? 'More test runs available. Use cursor to get next page.'
        : undefined;

    return {
      success: true,
      data: {
        testRuns: response.data,
        returned: response.data.length,
        nextCursor: response.nextCursor,
        hasMore: !!response.nextCursor,
        ...(note ? { _note: note } : {})
      }
    };
  } catch (error) {
    return handleTestRunError(error, context, LIST_TEST_RUNS_ERRORS);
  }
}

export async function handleGetTestRun(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = getTestRunSchema.parse(args || {});

    const response = await client.getTestRun(input.workflowId, input.runId);

    return {
      success: true,
      data: response
    };
  } catch (error) {
    return handleTestRunError(error, context, READ_TEST_RUN_ERRORS);
  }
}

export async function handleListTestCases(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = listTestCasesSchema.parse(args || {});

    const response = await client.listTestCases(input.workflowId, input.runId, {
      limit: input.limit || 20,
      cursor: input.cursor,
    });

    return {
      success: true,
      data: {
        testCases: response.data,
        returned: response.data.length,
        nextCursor: response.nextCursor,
        hasMore: !!response.nextCursor,
        ...(response.nextCursor ? {
          _note: 'More test cases available. Paginate rather than raising limit - per-case inputs/outputs can be large.'
        } : {})
      }
    };
  } catch (error) {
    return handleTestRunError(error, context, READ_TEST_RUN_ERRORS);
  }
}

export async function handleTriggerTestRun(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = triggerTestRunSchema.parse(args || {});

    const response = await client.triggerTestRun(input.workflowId);

    return {
      success: true,
      data: {
        ...response,
        _note: `Run started. Cases execute asynchronously - poll with action='get_run', runId='${response.id}' until status is completed, error, or cancelled.`
      }
    };
  } catch (error) {
    return handleTestRunError(error, context, TRIGGER_TEST_RUN_ERRORS);
  }
}

export async function handleCancelTestRun(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = cancelTestRunSchema.parse(args || {});

    const response = await client.cancelTestRun(input.workflowId, input.runId);

    return {
      success: true,
      data: {
        ...response,
        _note: "Cancellation accepted. In-flight cases stop asynchronously - use action='get_run' to confirm the run reached status 'cancelled'."
      }
    };
  } catch (error) {
    return handleTestRunError(error, context, CANCEL_TEST_RUN_ERRORS);
  }
}

// System Tools Handlers

export async function handleHealthCheck(context?: InstanceContext): Promise<McpToolResponse> {
  const startTime = Date.now();

  try {
    const client = ensureApiConfigured(context);
    const health = await client.healthCheck();

    // Get MCP version from package.json
    const packageJson = require('../../package.json');
    const mcpVersion = packageJson.version;
    const supportedN8nVersion = packageJson.dependencies?.n8n?.replace(/[^0-9.]/g, '');

    // Check npm for latest version (async, non-blocking)
    const versionCheck = await checkNpmVersion();

    // Get cache metrics for performance monitoring
    const cacheMetricsData = getInstanceCacheMetrics();

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Build response data
    const responseData: HealthCheckResponseData = {
      status: health.status,
      instanceId: health.instanceId,
      n8nVersion: health.n8nVersion,
      ...(health.n8nVersion ? {} : { n8nVersionNote: N8N_VERSION_UNAVAILABLE_NOTE }),
      features: health.features,
      apiUrl: resolveN8nApiConfigForResponse(context)?.baseUrl,
      mcpVersion,
      supportedN8nVersion,
      versionCheck: {
        current: versionCheck.currentVersion,
        latest: versionCheck.latestVersion,
        upToDate: !versionCheck.isOutdated,
        message: formatVersionMessage(versionCheck),
        ...(versionCheck.updateCommand ? { updateCommand: versionCheck.updateCommand } : {})
      },
      performance: {
        responseTimeMs: responseTime,
        cacheHitRate: (cacheMetricsData.hits + cacheMetricsData.misses) > 0
          ? ((cacheMetricsData.hits / (cacheMetricsData.hits + cacheMetricsData.misses)) * 100).toFixed(2) + '%'
          : 'N/A',
        cachedInstances: cacheMetricsData.size
      }
    };

    // Official n8n MCP (n8n_manage_agents) reachability — status mode reports
    // whatever the cached client already knows, without a live network probe.
    responseData.officialMcp = await buildOfficialMcpHealth(context, false);

    // Add next steps guidance based on telemetry insights
    responseData.nextSteps = [
      '• Create workflow: n8n_create_workflow',
      '• List workflows: n8n_list_workflows',
      '• Search nodes: search_nodes',
      '• Browse templates: search_templates'
    ];

    // Add update warning if outdated
    if (versionCheck.isOutdated && versionCheck.latestVersion) {
      responseData.updateWarning = `⚠️  n8n-mcp v${versionCheck.latestVersion} is available (you have v${versionCheck.currentVersion}). Update recommended.`;
    }

    // Track result in telemetry
    telemetry.trackEvent('health_check_completed', {
      success: true,
      responseTimeMs: responseTime,
      upToDate: !versionCheck.isOutdated,
      apiConnected: true
    });

    return {
      success: true,
      data: responseData
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Track failure in telemetry
    telemetry.trackEvent('health_check_failed', {
      success: false,
      responseTimeMs: responseTime,
      errorType: error instanceof N8nApiError ? error.code : 'unknown'
    });

    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code,
        details: {
          apiUrl: resolveN8nApiConfigForResponse(context)?.baseUrl,
          hint: 'Check if n8n is running and API is enabled',
          troubleshooting: [
            '1. Verify n8n instance is running',
            '2. Check N8N_API_URL is correct',
            '3. Verify N8N_API_KEY has proper permissions',
            '4. Run n8n_health_check with mode="diagnostic" for detailed analysis'
          ]
        }
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Environment-aware debugging helpers

/**
 * Detect cloud platform from environment variables
 * Returns platform name or null if not in cloud
 */
function detectCloudPlatform(): string | null {
  if (process.env.RAILWAY_ENVIRONMENT) return 'railway';
  if (process.env.RENDER) return 'render';
  if (process.env.FLY_APP_NAME) return 'fly';
  if (process.env.HEROKU_APP_NAME) return 'heroku';
  if (process.env.AWS_EXECUTION_ENV) return 'aws';
  if (process.env.KUBERNETES_SERVICE_HOST) return 'kubernetes';
  if (process.env.GOOGLE_CLOUD_PROJECT) return 'gcp';
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT) return 'azure';
  return null;
}

/**
 * Get mode-specific debugging suggestions
 */
function getModeSpecificDebug(mcpMode: string) {
  if (mcpMode === 'http') {
    const port = process.env.MCP_PORT || process.env.PORT || 3000;
    return {
      mode: 'HTTP Server',
      port,
      authTokenConfigured: !!(process.env.MCP_AUTH_TOKEN || process.env.AUTH_TOKEN),
      corsEnabled: true,
      serverUrl: `http://localhost:${port}`,
      healthCheckUrl: `http://localhost:${port}/health`,
      troubleshooting: [
        `1. Test server health: curl http://localhost:${port}/health`,
        '2. Check browser console for CORS errors',
        '3. Verify MCP_AUTH_TOKEN or AUTH_TOKEN if authentication enabled',
        `4. Ensure port ${port} is not in use: lsof -i :${port} (macOS/Linux) or netstat -ano | findstr :${port} (Windows)`,
        '5. Check firewall settings for port access',
        '6. Review server logs for connection errors'
      ],
      commonIssues: [
        'CORS policy blocking browser requests',
        'Port already in use by another application',
        'Authentication token mismatch',
        'Network firewall blocking connections'
      ]
    };
  } else {
    // stdio mode
    const configLocation = process.platform === 'darwin'
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : process.platform === 'win32'
      ? '%APPDATA%\\Claude\\claude_desktop_config.json'
      : '~/.config/Claude/claude_desktop_config.json';

    return {
      mode: 'Standard I/O (Claude Desktop)',
      configLocation,
      troubleshooting: [
        '1. Verify Claude Desktop config file exists and is valid JSON',
        '2. Check MCP server entry: {"mcpServers": {"n8n": {"command": "npx", "args": ["-y", "n8n-mcp"]}}}',
        '3. Restart Claude Desktop after config changes',
        '4. Check Claude Desktop logs for startup errors',
        '5. Test npx can run: npx -y n8n-mcp --version',
        '6. Verify executable permissions if using local installation'
      ],
      commonIssues: [
        'Invalid JSON in claude_desktop_config.json',
        'Incorrect command or args in MCP server config',
        'Claude Desktop not restarted after config changes',
        'npx unable to download or run package',
        'Missing execute permissions on local binary'
      ]
    };
  }
}

/**
 * Get Docker-specific debugging suggestions
 */
function getDockerDebug(isDocker: boolean) {
  if (!isDocker) return null;

  return {
    containerDetected: true,
    troubleshooting: [
      '1. Verify volume mounts for data/nodes.db',
      '2. Check network connectivity to n8n instance',
      '3. Ensure ports are correctly mapped',
      '4. Review container logs: docker logs <container-name>',
      '5. Verify environment variables passed to container',
      '6. Check IS_DOCKER=true is set correctly'
    ],
    commonIssues: [
      'Volume mount not persisting database',
      'Network isolation preventing n8n API access',
      'Port mapping conflicts',
      'Missing environment variables in container'
    ]
  };
}

/**
 * Get cloud platform-specific suggestions
 */
function getCloudPlatformDebug(cloudPlatform: string | null) {
  if (!cloudPlatform) return null;

  const platformGuides: Record<string, CloudPlatformGuide> = {
    railway: {
      name: 'Railway',
      troubleshooting: [
        '1. Check Railway environment variables are set',
        '2. Verify deployment logs in Railway dashboard',
        '3. Ensure PORT matches Railway assigned port (automatic)',
        '4. Check networking configuration for external access'
      ]
    },
    render: {
      name: 'Render',
      troubleshooting: [
        '1. Verify Render environment variables',
        '2. Check Render logs for startup errors',
        '3. Ensure health check endpoint is responding',
        '4. Verify instance type has sufficient resources'
      ]
    },
    fly: {
      name: 'Fly.io',
      troubleshooting: [
        '1. Check Fly.io logs: flyctl logs',
        '2. Verify fly.toml configuration',
        '3. Ensure volumes are properly mounted',
        '4. Check app status: flyctl status'
      ]
    },
    heroku: {
      name: 'Heroku',
      troubleshooting: [
        '1. Check Heroku logs: heroku logs --tail',
        '2. Verify Procfile configuration',
        '3. Ensure dynos are running: heroku ps',
        '4. Check environment variables: heroku config'
      ]
    },
    kubernetes: {
      name: 'Kubernetes',
      troubleshooting: [
        '1. Check pod logs: kubectl logs <pod-name>',
        '2. Verify service and ingress configuration',
        '3. Check persistent volume claims',
        '4. Verify resource limits and requests'
      ]
    },
    aws: {
      name: 'AWS',
      troubleshooting: [
        '1. Check CloudWatch logs',
        '2. Verify IAM roles and permissions',
        '3. Check security groups and networking',
        '4. Verify environment variables in service config'
      ]
    }
  };

  return platformGuides[cloudPlatform] || {
    name: cloudPlatform.toUpperCase(),
    troubleshooting: [
      '1. Check cloud platform logs',
      '2. Verify environment variables are set',
      '3. Check networking and port configuration',
      '4. Review platform-specific documentation'
    ]
  };
}

// Handler: n8n_diagnostic
export async function handleDiagnostic(request: any, context?: InstanceContext): Promise<McpToolResponse> {
  const startTime = Date.now();
  const verbose = request.params?.arguments?.verbose || false;

  // Detect environment for targeted debugging
  const mcpMode = process.env.MCP_MODE || 'stdio';
  const isDocker = process.env.IS_DOCKER === 'true';
  const cloudPlatform = detectCloudPlatform();

  // Check environment variables. SECURITY (GHSA-jxx9-px88-pj69): in
  // multi-tenant mode the operator's env credentials are not part of the
  // tenant's view of the system, so we mask them out of the diagnostic
  // payload rather than letting them leak through `environment.*`.
  const isMultiTenant = process.env.ENABLE_MULTI_TENANT === 'true';
  const envVars = {
    N8N_API_URL: isMultiTenant ? null : (process.env.N8N_API_URL || null),
    N8N_API_KEY: isMultiTenant ? null : (process.env.N8N_API_KEY ? '***configured***' : null),
    NODE_ENV: process.env.NODE_ENV || 'production',
    MCP_MODE: mcpMode,
    isDocker,
    cloudPlatform,
    nodeVersion: process.version,
    platform: process.platform
  };

  // Check API configuration
  const apiConfig = resolveN8nApiConfigForResponse(context);
  const apiConfigured = apiConfig !== null;
  const apiClient = getN8nApiClient(context);

  // Test API connectivity if configured
  let apiStatus = {
    configured: apiConfigured,
    connected: false,
    error: null as string | null,
    version: null as string | null
  };

  if (apiClient) {
    try {
      const health = await apiClient.healthCheck();
      apiStatus.connected = true;
      apiStatus.version = health.n8nVersion || N8N_VERSION_UNAVAILABLE_NOTE;
    } catch (error) {
      apiStatus.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  // Check which tools are available
  const documentationTools = 7; // Base documentation tools (after v2.26.0 consolidation)
  const managementTools = apiConfigured ? 14 : 0; // Management tools requiring API (includes n8n_manage_datatable)
  const totalTools = documentationTools + managementTools;

  // Check npm version
  const versionCheck = await checkNpmVersion();

  // Get performance metrics
  const cacheMetricsData = getInstanceCacheMetrics();
  const responseTime = Date.now() - startTime;

  // Build diagnostic report
  const diagnostic: DiagnosticResponseData = {
    timestamp: new Date().toISOString(),
    environment: envVars,
    apiConfiguration: {
      configured: apiConfigured,
      status: apiStatus,
      config: apiConfig ? {
        baseUrl: apiConfig.baseUrl,
        timeout: apiConfig.timeout,
        maxRetries: apiConfig.maxRetries
      } : null
    },
    versionInfo: {
      current: versionCheck.currentVersion,
      latest: versionCheck.latestVersion,
      upToDate: !versionCheck.isOutdated,
      message: formatVersionMessage(versionCheck),
      ...(versionCheck.updateCommand ? { updateCommand: versionCheck.updateCommand } : {})
    },
    toolsAvailability: {
      documentationTools: {
        count: documentationTools,
        enabled: true,
        description: 'Always available - node info, search, validation, etc.'
      },
      managementTools: {
        count: managementTools,
        enabled: apiConfigured,
        description: apiConfigured ?
          'Management tools are ENABLED - create, update, execute workflows' :
          'Management tools are DISABLED - configure N8N_API_URL and N8N_API_KEY to enable'
      },
      totalAvailable: totalTools
    },
    performance: {
      diagnosticResponseTimeMs: responseTime,
      cacheHitRate: (cacheMetricsData.hits + cacheMetricsData.misses) > 0
        ? ((cacheMetricsData.hits / (cacheMetricsData.hits + cacheMetricsData.misses)) * 100).toFixed(2) + '%'
        : 'N/A',
      cachedInstances: cacheMetricsData.size
    },
    modeSpecificDebug: getModeSpecificDebug(mcpMode)
  };

  // Official n8n MCP (n8n_manage_agents) reachability — diagnostic mode
  // always forces a live probe, unlike the status-mode health check.
  diagnostic.officialMcp = await buildOfficialMcpHealth(context, true);

  // Enhanced guidance based on telemetry insights
  if (apiConfigured && apiStatus.connected) {
    // API is working - provide next steps
    diagnostic.nextSteps = {
      message: '✓ API connected! Here\'s what you can do:',
      recommended: [
        {
          action: 'n8n_list_workflows',
          description: 'See your existing workflows',
          timing: 'Fast (6 seconds median)'
        },
        {
          action: 'n8n_create_workflow',
          description: 'Create a new workflow',
          timing: 'Typically 6-14 minutes to build'
        },
        {
          action: 'search_nodes',
          description: 'Discover available nodes',
          timing: 'Fast - explore 500+ nodes'
        },
        {
          action: 'search_templates',
          description: 'Browse pre-built workflows',
          timing: 'Find examples quickly'
        }
      ],
      tips: [
        '82% of users start creating workflows after diagnostics - you\'re ready to go!',
        'Most common first action: n8n_update_partial_workflow (managing existing workflows)',
        'Use n8n_validate_workflow before deploying to catch issues early'
      ]
    };
  } else if (apiConfigured && !apiStatus.connected) {
    // API configured but not connecting - troubleshooting
    diagnostic.troubleshooting = {
      issue: '⚠️ API configured but connection failed',
      error: apiStatus.error,
      steps: [
        '1. Verify n8n instance is running and accessible',
        '2. Check N8N_API_URL is correct (currently: ' + apiConfig?.baseUrl + ')',
        '3. Test URL in browser: ' + apiConfig?.baseUrl + '/healthz',
        '4. Verify N8N_API_KEY has proper permissions',
        '5. Check firewall/network settings if using remote n8n',
        '6. Try running n8n_health_check again after fixes'
      ],
      commonIssues: [
        'Wrong port number in N8N_API_URL',
        'API key doesn\'t have sufficient permissions',
        'n8n instance not running or crashed',
        'Network firewall blocking connection'
      ],
      documentation: 'https://github.com/czlonkowski/n8n-mcp?tab=readme-ov-file#n8n-management-tools-optional---requires-api-configuration'
    };
  } else {
    // API not configured - setup guidance
    diagnostic.setupGuide = {
      message: 'n8n API not configured. You can still use documentation tools!',
      whatYouCanDoNow: {
        documentation: [
          {
            tool: 'search_nodes',
            description: 'Search 500+ n8n nodes',
            example: 'search_nodes({query: "slack"})'
          },
          {
            tool: 'get_node_essentials',
            description: 'Get node configuration details',
            example: 'get_node_essentials({nodeType: "nodes-base.httpRequest"})'
          },
          {
            tool: 'search_templates',
            description: 'Browse workflow templates',
            example: 'search_templates({query: "chatbot"})'
          },
          {
            tool: 'validate_workflow',
            description: 'Validate workflow JSON',
            example: 'validate_workflow({workflow: {...}})'
          }
        ],
        note: '14 documentation tools available without API configuration'
      },
      whatYouCannotDo: [
        '✗ Create/update workflows in n8n instance',
        '✗ List your workflows',
        '✗ Execute workflows',
        '✗ View execution results'
      ],
      howToEnable: {
        steps: [
          '1. Get your n8n API key: [Your n8n instance]/settings/api',
          '2. Set environment variables:',
          '   N8N_API_URL=https://your-n8n-instance.com',
          '   N8N_API_KEY=your_api_key_here',
          '3. Restart the MCP server',
          '4. Run n8n_health_check with mode="diagnostic" to verify',
          '5. All 19 tools will be available!'
        ],
        documentation: 'https://github.com/czlonkowski/n8n-mcp?tab=readme-ov-file#n8n-management-tools-optional---requires-api-configuration'
      }
    };
  }

  // Add version warning if outdated
  if (versionCheck.isOutdated && versionCheck.latestVersion) {
    diagnostic.updateWarning = {
      message: `⚠️ Update available: v${versionCheck.currentVersion} → v${versionCheck.latestVersion}`,
      command: versionCheck.updateCommand,
      benefits: [
        'Latest bug fixes and improvements',
        'New features and tools',
        'Better performance and reliability'
      ]
    };
  }

  // Add Docker-specific debugging if in container
  const dockerDebug = getDockerDebug(isDocker);
  if (dockerDebug) {
    diagnostic.dockerDebug = dockerDebug;
  }

  // Add cloud platform-specific debugging if detected
  const cloudDebug = getCloudPlatformDebug(cloudPlatform);
  if (cloudDebug) {
    diagnostic.cloudPlatformDebug = cloudDebug;
  }

  // Add verbose debug info if requested
  if (verbose) {
    diagnostic.debug = {
      processEnv: Object.keys(process.env).filter(key =>
        key.startsWith('N8N_') || key.startsWith('MCP_')
      ),
      nodeVersion: process.version,
      platform: process.platform,
      workingDirectory: process.cwd(),
      cacheMetrics: cacheMetricsData
    };
  }

  // Track diagnostic usage with result data
  telemetry.trackEvent('diagnostic_completed', {
    success: true,
    apiConfigured,
    apiConnected: apiStatus.connected,
    toolsAvailable: totalTools,
    responseTimeMs: responseTime,
    upToDate: !versionCheck.isOutdated,
    verbose
  });

  return {
    success: true,
    data: diagnostic
  };
}

const VERSIONS_ACTION = 'workflow_versions';
const VERSIONS_TIMEOUT_MS = 30000;
/** n8n's `get_workflow_history` refuses anything above 50. */
const NATIVE_VERSIONS_LIMIT_CAP = 50;
/**
 * Why native rollback never pre-validates: the official `get_workflow_version`
 * payload lists only `name`/`type`/`credentials` per node, without `position`,
 * `typeVersion` or `parameters`, so the workflow validator has nothing to check.
 */
const NATIVE_VALIDATION_NOTE = 'not available for native versions';

type WorkflowVersionsInput = z.infer<typeof workflowVersionsSchema>;

/**
 * Tags a `data` payload with the diff dialect it is written in. `format` is set
 * last so an official payload that happens to carry the key cannot shadow it.
 */
function withDiffFormat(data: unknown, format: 'n8n' | 'n8n-mcp'): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), format }
    : { diff: data, format };
}

/**
 * Coerce a version id for the local store, which numbers its snapshots.
 * A decimal-integer string is accepted; anything else is refused by name
 * rather than silently becoming NaN — or, worse, a different snapshot:
 * `Number()` also reads `0x10` as 16 and `1e3` as 1000, so a malformed or
 * n8n-shaped id has to fail the shape check before any conversion.
 */
const LOCAL_VERSION_ID_PATTERN = /^-?\d+$/;

function parseLocalVersionId(
  value: number | string | undefined,
  field: string
): { ok: true; value?: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value === 'string' && value.trim() === '') {
    return { ok: false, error: `${field} must be an integer version id for source: local` };
  }
  if (typeof value === 'string' && !LOCAL_VERSION_ID_PATTERN.test(value.trim())) {
    return {
      ok: false,
      error: `${field} must be an integer version id for source: local (got ${JSON.stringify(value)}). n8n's own string version ids need source: native.`,
    };
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(parsed)) {
    return {
      ok: false,
      error: `${field} must be an integer version id for source: local (got ${JSON.stringify(value)}). n8n's own string version ids need source: native.`,
    };
  }
  return { ok: true, value: parsed };
}

/**
 * `source: native` — n8n's own workflow history, the same list the n8n UI
 * shows, read through the instance's MCP server. It covers edits made in the
 * UI, unlike the local store, and n8n owns its retention: `delete` and `prune`
 * have no counterpart there.
 */
async function handleNativeWorkflowVersions(
  input: WorkflowVersionsInput,
  context?: InstanceContext
): Promise<McpToolResponse> {
  const mode = input.mode;
  const label = (response: McpToolResponse): McpToolResponse => ({
    ...response,
    mode,
    source: 'native',
    backend: 'official-mcp',
  });
  const invalid = (error: string): McpToolResponse =>
    label({ success: false, action: VERSIONS_ACTION, code: 'INVALID_ARGS', error });

  if (mode === 'delete' || mode === 'prune') {
    return label({
      success: false,
      action: VERSIONS_ACTION,
      code: 'MODE_NOT_SUPPORTED_FOR_SOURCE',
      error: `n8n's own version history cannot be ${mode === 'delete' ? 'deleted' : 'pruned'} through MCP; use source: local for n8n-mcp snapshots`,
    });
  }

  const workflowId = input.workflowId;
  if (!workflowId) {
    return invalid(`workflowId is required for source: native (mode: ${mode})`);
  }
  if (mode !== 'list' && input.versionId === undefined) {
    return invalid(`versionId is required for mode: ${mode}`);
  }
  if (mode === 'diff' && input.toVersionId === undefined) {
    return invalid('toVersionId is required for mode: diff');
  }

  // n8n's version ids are strings; a caller who passed a number gets it
  // stringified rather than an argument-validation error from n8n.
  const versionId = input.versionId === undefined ? undefined : String(input.versionId);
  const toVersionId = input.toVersionId === undefined ? undefined : String(input.toVersionId);

  let aliases: string[];
  let officialArgs: Record<string, unknown>;
  let idempotent = true;

  switch (mode) {
    case 'list':
      aliases = ['get_workflow_history'];
      officialArgs = {
        workflowId,
        // n8n rejects a non-integer or out-of-range page, so the bounds are
        // applied here rather than forwarded and refused. The schema already
        // constrains `offset`; the floor keeps both fields normalised the same way.
        limit: Math.max(1, Math.min(NATIVE_VERSIONS_LIMIT_CAP, Math.floor(input.limit ?? 10))),
        offset: Math.max(0, Math.floor(input.offset ?? 0)),
      };
      break;
    case 'get':
      aliases = ['get_workflow_version'];
      officialArgs = { workflowId, versionId };
      break;
    case 'diff':
      aliases = ['get_workflow_versions_diff'];
      officialArgs = { workflowId, fromVersionId: versionId, toVersionId };
      break;
    case 'rollback':
      aliases = ['restore_workflow_version'];
      officialArgs = { workflowId, versionId };
      // A restore writes the workflow, so a retry after a connection failure
      // could land twice.
      idempotent = false;
      break;
    default:
      return invalid(`Unknown mode: ${mode}`);
  }

  // withMcpExposure returns the envelope undecorated (and may already carry
  // warnings from the consent write) — spread first, then label it.
  const response = await withMcpExposure(
    {
      apiClient: getN8nApiClient(context),
      workflowId,
      exposeToMcp: input.exposeToMcp,
      action: VERSIONS_ACTION,
      toolName: 'n8n_workflow_versions',
      context,
    },
    () =>
      callOfficialTool(
        context,
        aliases,
        officialArgs,
        input.timeoutMs ?? VERSIONS_TIMEOUT_MS,
        VERSIONS_ACTION,
        idempotent
      )
  );

  const labelled = label(response);
  if (mode === 'diff' && labelled.success) {
    labelled.data = withDiffFormat(labelled.data, 'n8n');
  }
  if (mode === 'rollback' && labelled.success) {
    labelled.validation = NATIVE_VALIDATION_NOTE;
  }
  return labelled;
}

/**
 * `source: local` — the snapshots n8n-mcp takes before it changes a workflow.
 * Numbered per workflow, scoped to the instance, and independent of the n8n
 * version in use.
 */
async function handleLocalWorkflowVersions(
  input: WorkflowVersionsInput,
  versionId: number | undefined,
  toVersionId: number | undefined,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  // Resolve the client the same way every other tool does. Gating on `context` skipped
  // getN8nApiClient's environment-variable fallback, so on a plain N8N_API_URL setup — no
  // instance context — `rollback` always answered "n8n API not configured" while `list`/`get`
  // worked, because they read the local version store instead. Multi-tenant isolation is
  // enforced inside getN8nApiClient and by the scope check above, not by this ternary.
  const client = getN8nApiClient(context);
  const versioningService = new WorkflowVersioningService(repository, client || undefined, getInstanceScopeId(context));

  switch (input.mode) {
    case 'list': {
      if (!input.workflowId) {
        return {
          success: false,
          error: 'workflowId is required for list mode'
        };
      }

      const versions = await versioningService.getVersionHistory(input.workflowId, input.limit);

      return {
        success: true,
        data: {
          workflowId: input.workflowId,
          versions,
          count: versions.length,
          message: `Found ${versions.length} version(s) for workflow ${input.workflowId}`
        }
      };
    }

    case 'get': {
      if (!versionId) {
        return {
          success: false,
          error: 'versionId is required for get mode'
        };
      }

      const version = await versioningService.getVersion(versionId);

      if (!version) {
        return {
          success: false,
          error: `Version ${versionId} not found`
        };
      }

      return {
        success: true,
        data: version
      };
    }

    case 'rollback': {
      if (!input.workflowId) {
        return {
          success: false,
          error: 'workflowId is required for rollback mode'
        };
      }

      if (!client) {
        return {
          success: false,
          error: 'n8n API not configured. Cannot perform rollback without API access.'
        };
      }

      const result = await versioningService.restoreVersion(
        input.workflowId,
        versionId,
        input.validateBefore
      );

      return {
        success: result.success,
        data: result.success ? result : undefined,
        error: result.success ? undefined : result.message,
        details: result.success ? undefined : {
          validationErrors: result.validationErrors
        }
      };
    }

    case 'delete': {
      if (input.deleteAll) {
        if (!input.workflowId) {
          return {
            success: false,
            error: 'workflowId is required for deleteAll mode'
          };
        }

        const result = await versioningService.deleteAllVersions(input.workflowId);

        return {
          success: true,
          data: {
            workflowId: input.workflowId,
            deleted: result.deleted,
            message: result.message
          }
        };
      } else {
        if (!versionId) {
          return {
            success: false,
            error: 'versionId is required for single version delete'
          };
        }

        const result = await versioningService.deleteVersion(versionId);

        return {
          success: result.success,
          data: result.success ? { message: result.message } : undefined,
          error: result.success ? undefined : result.message
        };
      }
    }

    case 'prune': {
      if (!input.workflowId) {
        return {
          success: false,
          error: 'workflowId is required for prune mode'
        };
      }

      const result = await versioningService.pruneVersions(
        input.workflowId,
        input.maxVersions || 10
      );

      return {
        success: true,
        data: {
          workflowId: input.workflowId,
          pruned: result.pruned,
          remaining: result.remaining,
          message: `Pruned ${result.pruned} old version(s), ${result.remaining} version(s) remaining`
        }
      };
    }

    case 'diff': {
      if (!input.workflowId) {
        return {
          success: false,
          error: 'workflowId is required for diff mode'
        };
      }

      if (versionId === undefined || toVersionId === undefined) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          error: 'versionId and toVersionId are both required for diff mode'
        };
      }

      try {
        const diff = await versioningService.compareVersions(versionId, toVersionId, input.workflowId);

        return {
          success: true,
          data: withDiffFormat(diff, 'n8n-mcp')
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The service refuses a snapshot belonging to another workflow; that is
        // a caller mistake, not a failure of the comparison.
        if (message.includes(VERSION_OWNERSHIP_ERROR_PREFIX)) {
          return {
            success: false,
            code: 'INVALID_ARGS',
            error: message
          };
        }
        throw error;
      }
    }

    default:
      return {
        success: false,
        error: `Unknown mode: ${input.mode}`
      };
  }
}

export async function handleWorkflowVersions(
  args: unknown,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  try {
    const input = workflowVersionsSchema.parse(args);

    // SECURITY (GHSA-2cf7-hpwf-47h9): multi-tenant requests must resolve a
    // complete tenant scope; fail closed otherwise.
    if (process.env.ENABLE_MULTI_TENANT === 'true' && getInstanceScopeId(context) === '') {
      const source = input.source ?? 'local';
      return {
        success: false,
        mode: input.mode,
        source,
        backend: source === 'native' ? 'official-mcp' : 'n8n-mcp',
        error: source === 'native'
          ? "Reading n8n's own version history needs an instance-scoped context for this tenant"
          : 'Workflow version storage is not available for this tenant context'
      };
    }

    if ((input.source ?? 'local') === 'native') {
      return handleNativeWorkflowVersions(input, context);
    }

    // Local snapshots are numbered; coerce both ids up front so every mode
    // below works with numbers.
    const invalidLocalVersionId = (error: string): McpToolResponse => ({
      success: false,
      mode: input.mode,
      source: 'local',
      backend: 'n8n-mcp',
      code: 'INVALID_ARGS',
      error,
    });
    const parsedVersionId = parseLocalVersionId(input.versionId, 'versionId');
    if (!parsedVersionId.ok) return invalidLocalVersionId(parsedVersionId.error);
    const parsedToVersionId = parseLocalVersionId(input.toVersionId, 'toVersionId');
    if (!parsedToVersionId.ok) return invalidLocalVersionId(parsedToVersionId.error);
    const versionId = parsedVersionId.value;
    const toVersionId = parsedToVersionId.value;

    const localResult = await handleLocalWorkflowVersions(input, versionId, toVersionId, repository, context);
    return { ...localResult, mode: input.mode, source: 'local', backend: 'n8n-mcp' };
  } catch (error) {
    // A schema failure happens before `input` exists, so the labels come from
    // the raw arguments here.
    const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const source = raw.source === 'native' ? 'native' : 'local';
    const label = {
      ...(typeof raw.mode === 'string' ? { mode: raw.mode } : {}),
      source,
      backend: source === 'native' ? 'official-mcp' : 'n8n-mcp',
    };

    if (error instanceof z.ZodError) {
      return {
        success: false,
        ...label,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    return {
      success: false,
      ...label,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// ========================================================================
// Template Deployment Handler
// ========================================================================

const deployTemplateSchema = z.object({
  templateId: z.number().positive().int(),
  name: z.string().optional(),
  autoUpgradeVersions: z.boolean().default(true),
  autoFix: z.boolean().default(true),  // Auto-apply fixes after deployment
  stripCredentials: z.boolean().default(true)
});

interface RequiredCredential {
  nodeType: string;
  nodeName: string;
  credentialType: string;
}

/**
 * Deploy a workflow template from n8n.io directly to the user's n8n instance.
 *
 * This handler:
 * 1. Fetches the template from the local template database
 * 2. Extracts credential requirements for user guidance
 * 3. Optionally strips credentials (for user to configure in n8n UI)
 * 4. Optionally upgrades node typeVersions to latest supported
 * 5. Optionally validates the workflow structure
 * 6. Creates the workflow in the n8n instance
 */
export async function handleDeployTemplate(
  args: unknown,
  templateService: TemplateService,
  repository: NodeRepository,
  context?: InstanceContext
): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = deployTemplateSchema.parse(args);

    // Fetch template
    const template = await templateService.getTemplate(input.templateId, 'full');
    if (!template) {
      return {
        success: false,
        error: `Template ${input.templateId} not found`,
        details: {
          hint: 'Use search_templates to find available templates',
          templateUrl: `https://n8n.io/workflows/${input.templateId}`
        }
      };
    }

    // Extract workflow from template (deep copy to avoid mutation)
    const workflow = JSON.parse(JSON.stringify(template.workflow));
    if (!workflow || !workflow.nodes) {
      return {
        success: false,
        error: 'Template has invalid workflow structure',
        details: { templateId: input.templateId }
      };
    }

    // Set workflow name
    const workflowName = input.name || template.name;

    // Collect required credentials before stripping
    const requiredCredentials: RequiredCredential[] = [];
    for (const node of workflow.nodes) {
      if (node.credentials && typeof node.credentials === 'object') {
        for (const [credType] of Object.entries(node.credentials)) {
          requiredCredentials.push({
            nodeType: node.type,
            nodeName: node.name,
            credentialType: credType
          });
        }
      }
    }

    // Strip credentials if requested
    if (input.stripCredentials) {
      workflow.nodes = workflow.nodes.map((node: any) => {
        const { credentials, ...rest } = node;
        return rest;
      });
    }

    // Auto-upgrade typeVersions if requested
    if (input.autoUpgradeVersions) {
      const autoFixer = new WorkflowAutoFixer(repository);

      // Run validation to get issues to fix
      const validator = new WorkflowValidator(repository, EnhancedConfigValidator);
      const validationResult = await validator.validateWorkflow(workflow, {
        validateNodes: true,
        validateConnections: false,
        validateExpressions: false,
        profile: 'runtime'
      });

      // Generate fixes focused on typeVersion upgrades
      const fixResult = await autoFixer.generateFixes(
        workflow,
        validationResult,
        [],
        { fixTypes: ['typeversion-upgrade', 'typeversion-correction'] }
      );

      // Apply fixes to workflow
      if (fixResult.operations.length > 0) {
        for (const op of fixResult.operations) {
          if (op.type === 'updateNode' && op.updates) {
            const node = workflow.nodes.find((n: any) =>
              n.id === op.nodeId || n.name === op.nodeName
            );
            if (node) {
              for (const [path, value] of Object.entries(op.updates)) {
                if (path === 'typeVersion') {
                  node.typeVersion = value;
                }
              }
            }
          }
        }
      }
    }

    // Identify trigger type
    const triggerNode = workflow.nodes.find((n: any) =>
      n.type?.includes('Trigger') ||
      n.type?.includes('webhook') ||
      n.type === 'n8n-nodes-base.webhook'
    );
    const triggerType = triggerNode?.type?.split('.').pop() || 'manual';

    // Create workflow via API (always creates inactive)
    // Deploy first, then fix - this ensures the workflow exists before we modify it
    const templateGroupWarnings: string[] = [];
    const createdWorkflow = await client.createWorkflow({
      name: workflowName,
      nodes: workflow.nodes,
      connections: workflow.connections,
      // Templates keep their node IDs through deployment (only typeVersion and credentials are
      // touched), so any canvas groups they carry still address the right nodes.
      ...nodeGroupsField(workflow.nodeGroups),
      settings: workflow.settings || { executionOrder: 'v1' }
    }, {
      onWarning: message => templateGroupWarnings.push(message)
    });

    // Get base URL for workflow link
    const apiConfig = resolveN8nApiConfigForResponse(context);
    const baseUrl = apiConfig?.baseUrl?.replace('/api/v1', '') || '';

    // Auto-fix common issues after deployment (expression format, etc.)
    let fixesApplied: AppliedFix[] = [];
    let fixSummary = '';
    let autoFixStatus: 'success' | 'failed' | 'skipped' = 'skipped';

    if (input.autoFix) {
      try {
        // Run autofix on the deployed workflow
        const autofixResult = await handleAutofixWorkflow(
          {
            id: createdWorkflow.id,
            applyFixes: true,
            fixTypes: ['expression-format', 'typeversion-upgrade'],
            confidenceThreshold: 'medium'
          },
          repository,
          context
        );

        if (autofixResult.success && autofixResult.data) {
          const fixData = autofixResult.data as AutofixResultData;
          autoFixStatus = 'success';
          if (fixData.fixesApplied && fixData.fixesApplied > 0) {
            fixesApplied = fixData.fixes || [];
            fixSummary = ` Auto-fixed ${fixData.fixesApplied} issue(s).`;
          }
        }
      } catch (fixError) {
        // Log but don't fail - autofix is best-effort
        autoFixStatus = 'failed';
        logger.warn('Auto-fix failed after template deployment', {
          workflowId: createdWorkflow.id,
          error: fixError instanceof Error ? fixError.message : 'Unknown error'
        });
        fixSummary = ' Auto-fix failed (workflow deployed successfully).';
      }
    }

    return {
      success: true,
      data: {
        workflowId: createdWorkflow.id,
        name: createdWorkflow.name,
        active: false,
        nodeCount: workflow.nodes.length,
        triggerType,
        requiredCredentials: requiredCredentials.length > 0 ? requiredCredentials : undefined,
        url: baseUrl ? `${baseUrl}/workflow/${createdWorkflow.id}` : undefined,
        templateId: input.templateId,
        templateUrl: template.url || `https://n8n.io/workflows/${input.templateId}`,
        autoFixStatus,
        fixesApplied: fixesApplied.length > 0 ? fixesApplied : undefined,
        // Canvas groups a template carried that this n8n could not store. Without this the tool
        // would report an unqualified success while the template's frames were dropped.
        warnings: templateGroupWarnings.length > 0 ? templateGroupWarnings : undefined
      },
      message: `Workflow "${createdWorkflow.name}" deployed successfully from template ${input.templateId}.${fixSummary} ${
        requiredCredentials.length > 0
          ? `Configure ${requiredCredentials.length} credential(s) in n8n to activate.`
          : ''
      }`
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code,
        details: error.details as Record<string, unknown> | undefined
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Backward-compatible webhook trigger handler
 *
 * @deprecated Use handleTestWorkflow instead. This function is kept for
 * backward compatibility with existing integration tests.
 */
export async function handleTriggerWebhookWorkflow(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const triggerWebhookSchema = z.object({
    webhookUrl: z.string().url(),
    httpMethod: optionalEmptyAware(z.enum(['GET', 'POST', 'PUT', 'DELETE'])),
    data: z.record(z.unknown()).optional(),
    headers: z.record(z.string()).optional(),
    waitForResponse: z.boolean().optional(),
  });

  try {
    const client = ensureApiConfigured(context);
    const input = triggerWebhookSchema.parse(args);

    const webhookRequest: WebhookRequest = {
      webhookUrl: input.webhookUrl,
      httpMethod: input.httpMethod || 'POST',
      data: input.data,
      headers: input.headers,
      waitForResponse: input.waitForResponse ?? true
    };

    const response = await client.triggerWebhook(webhookRequest);

    return {
      success: true,
      data: response,
      message: 'Webhook triggered successfully'
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }

    if (error instanceof N8nApiError) {
      const errorData = error.details as any;
      const executionId = errorData?.executionId || errorData?.id || errorData?.execution?.id;
      const workflowId = errorData?.workflowId || errorData?.workflow?.id;

      if (executionId) {
        return {
          success: false,
          error: formatExecutionError(executionId, workflowId),
          code: error.code,
          executionId,
          workflowId: workflowId || undefined
        };
      }

      if (error.code === 'SERVER_ERROR' || error.statusCode && error.statusCode >= 500) {
        return {
          success: false,
          error: formatNoExecutionError(),
          code: error.code
        };
      }

      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
        code: error.code,
        details: error.details as Record<string, unknown> | undefined
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// ========================================================================
// Data Table Handlers
// ========================================================================

// Shared Zod schemas for data table operations
const dataTableFilterConditionSchema = z.object({
  columnName: z.string().min(1),
  condition: z.enum(['eq', 'neq', 'like', 'ilike', 'gt', 'gte', 'lt', 'lte']),
  value: z.any(),
});

const dataTableFilterSchema = z.object({
  type: z.enum(['and', 'or']).optional().default('and'),
  filters: z.array(dataTableFilterConditionSchema).min(1, 'At least one filter condition is required'),
});

// Shared base schema for actions requiring a tableId
const tableIdSchema = z.object({
  tableId: z.string().min(1, 'tableId is required'),
});

// Per-action Zod schemas
const createTableSchema = z.object({
  name: z.string().min(1, 'Table name cannot be empty'),
  columns: z.array(z.object({
    name: z.string().min(1, 'Column name cannot be empty'),
    type: z.enum(['string', 'number', 'boolean', 'date']).optional(),
  })).min(1, 'At least one column is required'),
  projectId: optionalEmptyAware(z.string()),
});

const listTablesSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  cursor: optionalEmptyAware(z.string()),
});

const updateTableSchema = tableIdSchema.extend({
  name: z.string().min(1, 'New table name cannot be empty'),
});

const coerceJsonArray = z.preprocess(tryParseJson, z.array(z.record(z.unknown())));
const coerceJsonObject = z.preprocess(tryParseJson, z.record(z.unknown()));
const coerceJsonFilter = z.preprocess(tryParseJson, dataTableFilterSchema);

const getRowsSchema = tableIdSchema.extend({
  limit: z.number().min(1).max(100).optional(),
  cursor: optionalEmptyAware(z.string()),
  filter: z.union([coerceJsonFilter, z.string()]).optional(),
  sortBy: optionalEmptyAware(z.string()),
  search: optionalEmptyAware(z.string()),
});

const insertRowsSchema = tableIdSchema.extend({
  data: coerceJsonArray.pipe(z.array(z.record(z.unknown())).min(1, 'At least one row is required')),
  returnType: z.enum(['count', 'id', 'all']).optional(),
});

// Shared schema for update/upsert (identical structure)
const mutateRowsSchema = tableIdSchema.extend({
  filter: coerceJsonFilter,
  data: coerceJsonObject,
  returnData: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

const deleteRowsSchema = tableIdSchema.extend({
  filter: coerceJsonFilter,
  returnData: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

/** Shared error handler for data table and credential operations. */
function handleCrudError(error: unknown): McpToolResponse {
  if (error instanceof z.ZodError) {
    return { success: false, error: 'Invalid input', details: { errors: error.errors } };
  }
  if (error instanceof N8nApiError) {
    return {
      success: false,
      error: getUserFriendlyErrorMessage(error),
      code: error.code,
      details: error.details as Record<string, unknown> | undefined,
    };
  }
  return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
}

export async function handleCreateTable(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = createTableSchema.parse(args);
    const dataTable = await client.createDataTable(input);
    if (!dataTable || !dataTable.id) {
      return { success: false, error: 'Data table creation failed: n8n API returned an empty or invalid response' };
    }
    return {
      success: true,
      data: { id: dataTable.id, name: dataTable.name },
      message: `Data table "${dataTable.name}" created with ID: ${dataTable.id}`,
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleListTables(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = listTablesSchema.parse(args || {});
    const result = await client.listDataTables(input);
    return {
      success: true,
      data: {
        tables: result.data,
        count: result.data.length,
        nextCursor: result.nextCursor || undefined,
      },
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleGetTable(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId } = tableIdSchema.parse(args);
    const dataTable = await client.getDataTable(tableId);
    return { success: true, data: dataTable };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleUpdateTable(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId, name } = updateTableSchema.parse(args);
    const dataTable = await client.updateDataTable(tableId, { name });
    const rawArgs = args as Record<string, unknown>;
    const hasColumns = rawArgs && typeof rawArgs === 'object' && 'columns' in rawArgs;
    return {
      success: true,
      data: dataTable,
      message: `Data table renamed to "${dataTable.name}"` +
        (hasColumns ? '. Note: columns parameter was ignored — table schema is immutable after creation via the public API' : ''),
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleDeleteTable(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId } = tableIdSchema.parse(args);
    await client.deleteDataTable(tableId);
    return { success: true, message: `Data table ${tableId} deleted successfully` };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleGetRows(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId, filter, sortBy, ...params } = getRowsSchema.parse(args);
    const queryParams: Record<string, unknown> = { ...params };
    if (filter) {
      queryParams.filter = typeof filter === 'string' ? filter : JSON.stringify(filter);
    }
    if (sortBy) {
      queryParams.sortBy = sortBy;
    }
    const result = await client.getDataTableRows(tableId, queryParams as any);
    return {
      success: true,
      data: {
        rows: result.data,
        count: result.data.length,
        nextCursor: result.nextCursor || undefined,
      },
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleInsertRows(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId, ...params } = insertRowsSchema.parse(args);
    const result = await client.insertDataTableRows(tableId, params);
    return {
      success: true,
      data: result,
      message: `Rows inserted into data table ${tableId}`,
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleUpdateRows(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId, ...params } = mutateRowsSchema.parse(args);
    const result = await client.updateDataTableRows(tableId, params);
    return {
      success: true,
      data: result,
      message: params.dryRun ? 'Dry run: rows matched (no changes applied)' : 'Rows updated successfully',
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleUpsertRows(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId, ...params } = mutateRowsSchema.parse(args);
    const result = await client.upsertDataTableRow(tableId, params);
    return {
      success: true,
      data: result,
      message: params.dryRun ? 'Dry run: upsert previewed (no changes applied)' : 'Row upserted successfully',
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleDeleteRows(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { tableId, filter, ...params } = deleteRowsSchema.parse(args);
    const queryParams = {
      filter: JSON.stringify(filter),
      ...params,
    };
    const result = await client.deleteDataTableRows(tableId, queryParams as any);

    // Strip meaningless all-null "after" rows from dryRun responses — after a
    // delete there is no "after" state, so the template row with null fields
    // surfaces as noise for callers (QA #10).
    const cleanedResult = params.dryRun && Array.isArray(result)
      ? result.filter((row: any) => row?.dryRunState !== 'after')
      : result;

    return {
      success: true,
      data: cleanedResult,
      message: params.dryRun ? 'Dry run: rows matched for deletion (no changes applied)' : 'Rows deleted successfully',
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

// ========================================================================
// Data Table Column Actions (routed to n8n's own MCP server)
// ========================================================================

/**
 * n8n's Public API can create and drop whole data tables but cannot change a
 * table's columns; the instance-level MCP server can. These three actions are
 * therefore the only part of `n8n_manage_datatable` that needs
 * `N8N_MCP_ACCESS_TOKEN`. Renaming a TABLE stays on the Public API path
 * (`updateTable`).
 */
const DATATABLE_ACTION = 'manage_datatable';
const DATATABLE_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

type ColumnAction = 'addColumn' | 'deleteColumn' | 'renameColumn';

const COLUMN_TOOLS: Record<ColumnAction, string[]> = {
  addColumn: ['add_data_table_column'],
  deleteColumn: ['delete_data_table_column'],
  renameColumn: ['rename_data_table_column'],
};

/** n8n's own rule for a data table column name: identifier-shaped, at most 63 characters. */
const columnNameSchema = z
  .string()
  .min(1, 'Column name cannot be empty')
  .max(63, 'Column name must be at most 63 characters')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    'Column name must start with a letter and contain only letters, digits and underscores'
  );

const columnTargetSchema = tableIdSchema.extend({
  projectId: optionalEmptyAware(z.string()),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
});

const addColumnSchema = columnTargetSchema.extend({
  column: z.preprocess(
    tryParseJson,
    z.object({
      name: columnNameSchema,
      type: z.enum(['string', 'number', 'boolean', 'date']),
    })
  ),
});

const deleteColumnSchema = columnTargetSchema.extend({
  columnId: z.string().min(1, 'columnId is required'),
});

const renameColumnSchema = deleteColumnSchema.extend({
  name: columnNameSchema,
});

function columnInvalidArgs(action: ColumnAction, error: z.ZodError): McpToolResponse {
  return {
    success: false,
    action,
    code: 'INVALID_ARGS',
    error: error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
  };
}

/**
 * The official column tools require a `projectId` the Public-API data table
 * actions never asked for. An explicit one always wins; otherwise the shared
 * project resolution is used, and only an unambiguous single project is taken
 * automatically — picking one of several would silently target the wrong
 * project.
 */
async function resolveDataTableProjectId(
  input: { projectId?: string },
  action: ColumnAction,
  context?: InstanceContext
): Promise<{ projectId: string } | { failure: McpToolResponse }> {
  if (input.projectId) return { projectId: input.projectId };

  const resolved = await resolveProjectChoices(context);
  if ('failure' in resolved) return { failure: { ...resolved.failure, action } };

  const items = resolved.choices.items;
  if (items.length === 1) return { projectId: items[0].id };

  // Project resolution is I/O, so the envelope says which backend answered it
  // — the routed-response contract holds for these failures too.
  const backend = resolved.choices.backend;
  if (items.length === 0) {
    return {
      failure: {
        success: false,
        action,
        backend,
        code: 'PROJECT_REQUIRED',
        error: 'No project could be resolved for this instance; pass projectId',
      },
    };
  }
  return {
    failure: {
      success: false,
      action,
      backend,
      code: 'PROJECT_REQUIRED',
      error: 'Several projects are accessible; pass projectId',
      details: { candidates: items },
    },
  };
}

async function callColumnTool(
  action: ColumnAction,
  officialArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  context?: InstanceContext
): Promise<McpToolResponse> {
  // Column writes are not idempotent: a retry after a connection-level failure
  // could add or rename twice.
  const response = await callOfficialTool(
    context,
    COLUMN_TOOLS[action],
    officialArgs,
    timeoutMs ?? DATATABLE_TIMEOUT_MS,
    DATATABLE_ACTION,
    false
  );
  return { ...response, action, backend: 'official-mcp' };
}

export async function handleAddColumn(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const parsed = addColumnSchema.safeParse(args);
  if (!parsed.success) return columnInvalidArgs('addColumn', parsed.error);

  const resolved = await resolveDataTableProjectId(parsed.data, 'addColumn', context);
  if ('failure' in resolved) return resolved.failure;

  return callColumnTool(
    'addColumn',
    {
      dataTableId: parsed.data.tableId,
      projectId: resolved.projectId,
      name: parsed.data.column.name,
      type: parsed.data.column.type,
    },
    parsed.data.timeoutMs,
    context
  );
}

export async function handleDeleteColumn(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const parsed = deleteColumnSchema.safeParse(args);
  if (!parsed.success) return columnInvalidArgs('deleteColumn', parsed.error);

  const resolved = await resolveDataTableProjectId(parsed.data, 'deleteColumn', context);
  if ('failure' in resolved) return resolved.failure;

  return callColumnTool(
    'deleteColumn',
    { dataTableId: parsed.data.tableId, projectId: resolved.projectId, columnId: parsed.data.columnId },
    parsed.data.timeoutMs,
    context
  );
}

export async function handleRenameColumn(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  const parsed = renameColumnSchema.safeParse(args);
  if (!parsed.success) return columnInvalidArgs('renameColumn', parsed.error);

  const resolved = await resolveDataTableProjectId(parsed.data, 'renameColumn', context);
  if ('failure' in resolved) return resolved.failure;

  return callColumnTool(
    'renameColumn',
    {
      dataTableId: parsed.data.tableId,
      projectId: resolved.projectId,
      columnId: parsed.data.columnId,
      name: parsed.data.name,
    },
    parsed.data.timeoutMs,
    context
  );
}

// ========================================================================
// Credential Management Handlers
// ========================================================================

// SECURITY: Never log credential data values (they contain secrets like API keys, passwords).
// Only log credential name, type, and ID.

const listCredentialsSchema = z.object({
  includeUsage: z.boolean().optional(),
  // Mirror listWorkflowsSchema: bound limit and normalize an empty-string cursor
  // to undefined so an echoed-back empty nextCursor isn't forwarded to the n8n API.
  cursor: optionalEmptyAware(z.string()),
  limit: z.number().min(1).max(100).optional(),
}).passthrough();

const getCredentialSchema = z.object({
  id: z.string({ required_error: 'Credential ID is required' }),
  includeUsage: z.boolean().optional(),
});

interface CredentialUsageEntry {
  id: string;
  name: string;
  active: boolean;
}

async function buildCredentialUsageMap(
  client: N8nApiClient
): Promise<Map<string, CredentialUsageEntry[]>> {
  const usage = new Map<string, CredentialUsageEntry[]>();
  const workflows = await client.listAllWorkflows();
  for (const wf of workflows) {
    if (!wf.id) continue;
    const entry: CredentialUsageEntry = {
      id: wf.id,
      name: wf.name,
      active: wf.active ?? false,
    };
    const seenForThisWorkflow = new Set<string>();
    for (const node of wf.nodes ?? []) {
      if (!node.credentials) continue;
      for (const credConfig of Object.values(node.credentials)) {
        const credId = (credConfig as { id?: unknown } | null)?.id;
        if (typeof credId !== 'string' || credId === '') continue;
        if (seenForThisWorkflow.has(credId)) continue;
        seenForThisWorkflow.add(credId);
        const list = usage.get(credId);
        if (list) {
          list.push(entry);
        } else {
          usage.set(credId, [entry]);
        }
      }
    }
  }
  return usage;
}

const createCredentialSchema = z.object({
  name: z.string({ required_error: 'Credential name is required' }),
  type: z.string({ required_error: 'Credential type is required' }),
  data: z.record(z.any(), { required_error: 'Credential data is required' }),
});

const updateCredentialSchema = z.object({
  id: z.string({ required_error: 'Credential ID is required' }),
  name: z.string().optional(),
  type: z.string().optional(),
  data: z.record(z.any()).optional(),
});

const deleteCredentialSchema = z.object({
  id: z.string({ required_error: 'Credential ID is required' }),
});

const getCredentialSchemaTypeSchema = z.object({
  type: z.string({ required_error: 'Credential type is required' }),
});

type CredentialWithUsage = Credential & {
  usedIn?: CredentialUsageEntry[];
  usageCount?: number;
};

// Strip the sensitive `data` field from a credential before returning it.
// Defense in depth against future n8n versions returning decrypted values.
function stripCredentialData(credential: Credential): CredentialWithUsage {
  const { data: _sensitiveData, ...safeCred } = credential;
  return safeCred;
}

// Not every n8n deployment allows credential reads through its public API:
// older versions reject GET /credentials with 405 (#809), and API-key scopes
// or instance settings can block it with 403. Detect that so list/get can
// explain the limitation instead of surfacing a bare "GET method not allowed".
function isCredentialReadUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status = (error as { statusCode?: number }).statusCode;
  if (status === 405 || status === 403) {
    return true;
  }
  // Some errors arrive unwrapped, without a statusCode — fall back to the
  // reason phrase then, but never override a concrete non-405/403 status.
  if (status !== undefined) {
    return false;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('not allowed');
}

// Fresh object per call: the response carries per-error details, and a shared
// singleton could be mutated downstream by future response decoration.
function credentialReadUnsupportedResponse(error: unknown): McpToolResponse {
  return {
    success: false,
    error:
      'This n8n instance\'s public API rejected the credential read. On older n8n versions the public API ' +
      'does not expose GET /credentials at all; on newer ones this can mean the API key or instance settings ' +
      'do not permit credential reads. The create, delete, and getSchema actions generally still work, and ' +
      'update does too where the API version supports it (it needs a known credential ID, not list/get). ' +
      'To find an existing credential\'s ID, open it in the n8n UI — the ID is in the URL.',
    code: 'NOT_SUPPORTED',
    details: {
      statusCode: (error as { statusCode?: number }).statusCode,
      cause: error instanceof Error ? error.message : String(error),
    },
  };
}

export async function handleListCredentials(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { includeUsage, cursor, limit } = listCredentialsSchema.parse(args);

    if (includeUsage) {
      // Full audit: scan ALL credential pages so usage reporting is complete.
      // Cursor/limit paging does not apply here — return every credential at once.
      const allCredentials = await client.listAllCredentials();
      // Strip sensitive data field — defense in depth, consistent with the get path.
      let credentials: CredentialWithUsage[] = allCredentials.map(stripCredentialData);
      let usageScanError: string | undefined;
      try {
        const usageMap = await buildCredentialUsageMap(client);
        credentials = credentials.map((cred) => {
          const usedIn = (cred.id ? usageMap.get(cred.id) : undefined) ?? [];
          return { ...cred, usedIn, usageCount: usedIn.length };
        });
      } catch (scanError) {
        // Degrade gracefully: still return the full credential list rather than
        // failing the whole call when only the workflow scan failed.
        usageScanError = scanError instanceof Error ? scanError.message : String(scanError);
      }
      return {
        success: true,
        data: {
          credentials,
          count: credentials.length,
          ...(usageScanError ? { usageScanError } : {}),
        },
      };
    }

    // Standard single-page cursor paging (mirrors n8n_list_workflows).
    const result = await client.listCredentials({ cursor, limit });
    const credentials = result.data.map(stripCredentialData);
    return {
      success: true,
      data: {
        credentials,
        count: credentials.length,
        nextCursor: result.nextCursor || undefined,
      },
    };
  } catch (error) {
    if (isCredentialReadUnsupported(error)) {
      return credentialReadUnsupportedResponse(error);
    }
    return handleCrudError(error);
  }
}

export async function handleGetCredential(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id, includeUsage } = getCredentialSchema.parse(args);
    let credential;
    try {
      credential = await client.getCredential(id);
    } catch (getError: unknown) {
      // GET /credentials/:id is not always in the n8n public API — fall back to list + filter
      if (!isCredentialReadUnsupported(getError)) {
        throw getError;
      }
      // Paginate through ALL credentials — the target id may live beyond page 1.
      // If the list endpoint is rejected too, the instance supports no credential
      // reads at all; the outer catch turns that into the NOT_SUPPORTED response.
      const all = await client.listAllCredentials();
      credential = all.find((c) => c.id === id);
      if (!credential) {
        return { success: false, error: `Credential ${id} not found` };
      }
    }
    // Strip sensitive data field — defense in depth against future n8n versions returning decrypted values
    const { data: _sensitiveData, ...safeCred } = credential;
    let enriched: CredentialWithUsage = safeCred;
    let usageScanError: string | undefined;
    if (includeUsage) {
      try {
        const usageMap = await buildCredentialUsageMap(client);
        const usedIn = usageMap.get(id) ?? [];
        enriched = { ...safeCred, usedIn, usageCount: usedIn.length };
      } catch (scanError) {
        usageScanError = scanError instanceof Error ? scanError.message : String(scanError);
      }
    }
    return {
      success: true,
      data: usageScanError ? { ...enriched, usageScanError } : enriched,
    };
  } catch (error) {
    if (isCredentialReadUnsupported(error)) {
      return credentialReadUnsupportedResponse(error);
    }
    return handleCrudError(error);
  }
}

/**
 * Workaround for n8n's oAuth2Api credential schema (#740).
 *
 * The upstream Ajv schema has two interacting bugs that make `clientCredentials`
 * grant unusable as-is:
 *   1. `additionalProperties: false` at the root with `useDynamicClientRegistration`
 *      missing from `properties`, so sending it triggers an "additional property"
 *      rejection.
 *   2. The `if/then/else` on `useDynamicClientRegistration` uses
 *      `properties.x.enum` to test value, which evaluates true vacuously when the
 *      field is absent — so both `then` branches fire simultaneously, and `serverUrl`
 *      (a Dynamic Client Registration field) becomes required even on plain
 *      client-credentials flows that have no DCR involvement.
 *
 * The shim normalizes data for that specific combination so the Ajv schema is
 * satisfied: strip the rejected `useDynamicClientRegistration` field, inject
 * the `sendAdditionalBodyProperties` / `additionalBodyProperties` defaults
 * the schema's grant-type `then` branch requires, and inject `serverUrl: ''`
 * to satisfy the spuriously-fired DCR `then` branch.
 *
 * Filed upstream against n8n. Remove this shim when their schema is fixed.
 */
function applyCredentialDataShims(
  type: string,
  data: Record<string, any> | undefined
): Record<string, any> | undefined {
  if (!data || type !== 'oAuth2Api' || data.grantType !== 'clientCredentials') {
    return data;
  }
  const shimmed: Record<string, any> = { ...data };
  if ('useDynamicClientRegistration' in shimmed && !shimmed.useDynamicClientRegistration) {
    delete shimmed.useDynamicClientRegistration;
  }
  if (!('sendAdditionalBodyProperties' in shimmed)) {
    shimmed.sendAdditionalBodyProperties = false;
  }
  if (!('additionalBodyProperties' in shimmed)) {
    shimmed.additionalBodyProperties = '';
  }
  // Only inject serverUrl when the DCR branch fires spuriously (DCR is absent/false).
  // If the caller explicitly opted into DCR (true), let n8n surface a real
  // "missing serverUrl" error rather than masking it with our empty-string default.
  const dcrActive = shimmed.useDynamicClientRegistration === true;
  if (!dcrActive && !('serverUrl' in shimmed)) {
    shimmed.serverUrl = '';
  }
  return shimmed;
}

export async function handleCreateCredential(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { name, type, data } = createCredentialSchema.parse(args);
    const shimmedData = applyCredentialDataShims(type, data);
    logger.info(`Creating credential: name="${name}", type="${type}"`);
    const credential = await client.createCredential({ name, type, data: shimmedData });
    const { data: _sensitiveData, ...safeCred } = credential;
    return {
      success: true,
      data: safeCred,
      message: `Credential "${name}" (type: ${type}) created with ID ${credential.id}`,
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleUpdateCredential(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id, name, type, data } = updateCredentialSchema.parse(args);
    logger.info(`Updating credential: id="${id}"${name ? `, name="${name}"` : ''}`);
    const updatePayload: Record<string, any> = {};
    if (name !== undefined) updatePayload.name = name;
    if (type !== undefined) updatePayload.type = type;
    // Apply the same oAuth2 clientCredentials shim as the create path (#740) — n8n's
    // schema rejects the same payload shape on update, so re-saving an existing
    // credential would re-trigger the bug without this. When the caller omits `type`
    // (common partial-update pattern) but `data.grantType === 'clientCredentials'`,
    // fetch the existing credential to derive its type — otherwise the shim would
    // silently skip and the update would fail.
    if (data !== undefined) {
      let derivedType = type;
      if (derivedType === undefined && data?.grantType === 'clientCredentials') {
        try {
          const existing = await client.getCredential(id);
          derivedType = existing?.type;
        } catch {
          // GET /credentials/:id may not be exposed by n8n's public API; falling
          // back to listCredentials adds a costly round-trip. If the lookup fails,
          // skip the shim — n8n will surface its own validation error.
        }
      }
      updatePayload.data = applyCredentialDataShims(derivedType ?? '', data);
    }
    const credential = await client.updateCredential(id, updatePayload);
    const { data: _sensitiveData, ...safeCred } = credential;
    return {
      success: true,
      data: safeCred,
      message: `Credential ${id} updated successfully`,
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleDeleteCredential(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { id } = deleteCredentialSchema.parse(args);
    logger.info(`Deleting credential: id="${id}"`);
    await client.deleteCredential(id);
    return {
      success: true,
      message: `Credential ${id} deleted successfully`,
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

export async function handleGetCredentialSchema(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const { type } = getCredentialSchemaTypeSchema.parse(args);
    const schema = await client.getCredentialSchema(type);
    return {
      success: true,
      data: schema,
      message: `Schema for credential type "${type}"`,
    };
  } catch (error) {
    return handleCrudError(error);
  }
}

// ── Manage Folders ─────────────────────────────────────────────────────────
//
// Workflow folders (n8n public API 2.19+, licensed via feat:folders — available from
// the registered free Community tier up). Only the folder-create route accepts the
// `personal` project alias, so every other action resolves it through
// N8nApiClient.resolvePersonalProjectId(). Moves use n8n's PROJECT_ROOT sentinel '0'
// for "the project root" (folder.service.ts special-cases it; the id is reserved).

/** n8n's sentinel for "the project root" in folder parent/transfer targets. */
const FOLDER_PROJECT_ROOT = '0';

const folderProjectSchema = z.object({
  // The alias is the documented default: most folder users are on registered
  // Community instances, which have exactly one (personal) project. The default is
  // applied via transform, NOT .default(): ZodDefault fires only on a raw undefined,
  // while lossy MCP clients send '' for omitted fields (issue #774) — the preprocess
  // turns that into undefined only after the default check has already passed.
  projectId: optionalEmptyAware(z.string().trim().min(1)).transform((v) => v ?? 'personal'),
});

const folderIdSchema = folderProjectSchema.extend({
  folderId: z.string().trim().min(1),
});

// The published tool schema declares parentFolderId as string|null tool-wide (null is
// how `move` addresses the project root). For create/list, null simply means "no
// parent" — the same as omitting the field — so accept it instead of failing a
// spec-compliant client on a Zod error.
const nullOrEmptyToUndefined = (v: unknown) => (v === null ? undefined : emptyToUndefined(v));
const optionalParentFolderId = z.preprocess(nullOrEmptyToUndefined, z.string().trim().min(1).optional());

const createFolderSchema = folderProjectSchema.extend({
  name: z.string().trim().min(1),
  parentFolderId: optionalParentFolderId,
});

const listFoldersSchema = folderProjectSchema.extend({
  nameFilter: optionalEmptyAware(z.string().trim().min(1)),
  parentFolderId: optionalParentFolderId,
  sortBy: z.enum(['name:asc', 'name:desc', 'createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc']).optional(),
  skip: z.number().int().min(0).optional(),
  take: z.number().int().min(1).max(100).optional(),
});

const renameFolderSchema = folderIdSchema.extend({
  name: z.string().trim().min(1),
});

const moveFolderSchema = folderIdSchema.extend({
  // null = move to the project root; mapped to the PROJECT_ROOT sentinel below.
  parentFolderId: z.preprocess(emptyToUndefined, z.string().trim().min(1).nullable()),
});

const deleteFolderSchema = folderIdSchema.extend({
  transferToFolderId: optionalEmptyAware(z.string().trim().min(1)),
});

/**
 * Folder-specific error shaping on top of the generic CRUD mapping. n8n's answers here
 * are terse: a 403 covers both a key without folder:* scopes and an instance whose
 * license lacks feat:folders (folders unlock at the registered free Community tier);
 * a 404 covers a missing project/folder and an instance too old to have the folders
 * API at all (added in n8n 2.19).
 */
function handleFolderError(error: unknown): McpToolResponse {
  const response = handleCrudError(error);
  if (error instanceof N8nApiError) {
    // n8n's own messages often end without punctuation - normalize before appending.
    const appendHint = (hint: string) => {
      const base = (response.error ?? '').trimEnd();
      response.error = `${base}${/[.!?]$/.test(base) ? '' : '.'} ${hint}`;
    };
    if (error.statusCode === 403) {
      appendHint('Folders need an API key with folder:* scopes AND a licensed instance: folders unlock on the registered free Community tier (Settings -> Usage and plan -> register) and up.');
    } else if (error.statusCode === 404) {
      appendHint('Check the projectId and folderId; on n8n older than 2.19 the folders API does not exist at all.');
    }
  }
  return response;
}

/** Resolve the `personal` alias for the folder routes that require a real project ID. */
async function resolveFolderProjectId(client: N8nApiClient, projectId: string): Promise<string> {
  return projectId === 'personal' ? await client.resolvePersonalProjectId() : projectId;
}

/**
 * Fields requested from the folder list endpoint. Fixed rather than caller-selectable:
 * counts and the path breadcrumb are what make a listing useful to an agent, and the
 * n8n default (id/name/timestamps only) would hide them.
 */
const FOLDER_LIST_SELECT = ['id', 'name', 'createdAt', 'updatedAt', 'parentFolder', 'workflowCount', 'subFolderCount', 'path'];

export async function handleCreateFolder(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = createFolderSchema.parse(args);
    // The create route resolves `personal` server-side - pass it through untouched.
    const folder = await client.createFolder(input.projectId, {
      name: input.name,
      ...(input.parentFolderId ? { parentFolderId: input.parentFolderId } : {}),
    });
    if (!folder || !folder.id) {
      return { success: false, error: 'Folder creation failed: n8n API returned an empty or invalid response' };
    }
    return {
      success: true,
      data: { id: folder.id, name: folder.name, parentFolderId: folder.parentFolderId ?? null },
      message: `Folder "${folder.name}" created with ID: ${folder.id}. Place workflows in it via n8n_create_workflow's parentFolderId or the moveToFolder operation of n8n_update_partial_workflow.`,
    };
  } catch (error) {
    return handleFolderError(error);
  }
}

export async function handleListFolders(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = listFoldersSchema.parse(args || {});
    const projectId = await resolveFolderProjectId(client, input.projectId);
    const filter: Record<string, string> = {};
    if (input.nameFilter) filter.name = input.nameFilter;
    if (input.parentFolderId) filter.parentFolderId = input.parentFolderId;
    const result = await client.listFolders(projectId, {
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
      select: FOLDER_LIST_SELECT,
      sortBy: input.sortBy ?? 'updatedAt:desc',
      skip: input.skip ?? 0,
      take: input.take ?? 50,
    });
    return {
      success: true,
      data: {
        folders: result.data,
        count: result.count, // Total matching the query, not the page size
        projectId,
      },
    };
  } catch (error) {
    return handleFolderError(error);
  }
}

export async function handleGetFolder(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = folderIdSchema.parse(args);
    const projectId = await resolveFolderProjectId(client, input.projectId);
    const folder = await client.getFolder(projectId, input.folderId);
    return { success: true, data: { ...folder, projectId } };
  } catch (error) {
    return handleFolderError(error);
  }
}

export async function handleRenameFolder(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = renameFolderSchema.parse(args);
    const projectId = await resolveFolderProjectId(client, input.projectId);
    const folder = await client.updateFolder(projectId, input.folderId, { name: input.name });
    return {
      success: true,
      data: { id: folder.id, name: folder.name },
      message: `Folder renamed to "${folder.name}"`,
    };
  } catch (error) {
    return handleFolderError(error);
  }
}

export async function handleMoveFolder(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = moveFolderSchema.parse(args);
    const projectId = await resolveFolderProjectId(client, input.projectId);
    const target = input.parentFolderId ?? FOLDER_PROJECT_ROOT;
    const folder = await client.updateFolder(projectId, input.folderId, { parentFolderId: target });
    return {
      success: true,
      data: { id: folder.id, name: folder.name, parentFolderId: folder.parentFolderId ?? null },
      message: target === FOLDER_PROJECT_ROOT
        ? `Folder "${folder.name}" moved to the project root`
        : `Folder "${folder.name}" moved under folder ${target}`,
    };
  } catch (error) {
    return handleFolderError(error);
  }
}

export async function handleDeleteFolder(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = deleteFolderSchema.parse(args);
    const projectId = await resolveFolderProjectId(client, input.projectId);
    await client.deleteFolder(projectId, input.folderId, input.transferToFolderId);
    return {
      success: true,
      data: { id: input.folderId, deleted: true },
      message: input.transferToFolderId
        ? `Folder ${input.folderId} deleted; contents transferred to ${input.transferToFolderId === FOLDER_PROJECT_ROOT ? 'the project root' : `folder ${input.transferToFolderId}`}`
        : `Folder ${input.folderId} deleted; its workflows were moved to the project root and ARCHIVED, sub-folders were deleted`,
    };
  } catch (error) {
    return handleFolderError(error);
  }
}

// ── Audit Instance ─────────────────────────────────────────────────────────

const auditInstanceSchema = z.object({
  categories: z.array(z.enum([
    'credentials', 'database', 'nodes', 'instance', 'filesystem',
  ])).optional(),
  includeCustomScan: z.boolean().optional().default(true),
  daysAbandonedWorkflow: z.number().optional(),
  customChecks: z.array(z.enum([
    'hardcoded_secrets', 'unauthenticated_webhooks', 'error_handling', 'data_retention',
  ])).optional(),
});

export async function handleAuditInstance(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    const client = ensureApiConfigured(context);
    const input = auditInstanceSchema.parse(args);

    const totalStart = Date.now();
    const warnings: string[] = [];

    // Phase A: n8n built-in audit
    let builtinAudit: any = null;
    let builtinAuditMs = 0;
    const auditStart = Date.now();
    try {
      builtinAudit = await client.generateAudit({
        categories: input.categories,
        daysAbandonedWorkflow: input.daysAbandonedWorkflow,
      });
      builtinAuditMs = Date.now() - auditStart;
    } catch (auditError: any) {
      builtinAuditMs = Date.now() - auditStart;
      // Surface HTTP status in the warning so users can tell server-side errors
      // (n8n internal failures, missing N8N_HOST/N8N_PROTOCOL env, etc.) apart
      // from client-side ones. Pre-fix the message hid this and the bare
      // "Invalid URL" string from n8n's response body looked like a client bug. (#736)
      const status = auditError?.statusCode;
      const reason = auditError?.message || 'unknown error';
      let msg: string;
      if (status === 404) {
        msg = 'Built-in audit endpoint not available on this n8n version.';
      } else if (status !== undefined) {
        msg = `Built-in audit failed (HTTP ${status}): ${reason}`;
      } else {
        msg = `Built-in audit failed (no response from n8n): ${reason}`;
      }
      warnings.push(msg);
      logger.warn(`Audit: ${msg}`);
    }

    // Phase B: Custom workflow scanning
    let customReport = null;
    let workflowFetchMs = 0;
    let customScanMs = 0;

    if (input.includeCustomScan) {
      try {
        const fetchStart = Date.now();
        const allWorkflows = await client.listAllWorkflows();
        workflowFetchMs = Date.now() - fetchStart;

        logger.info(`Audit: fetched ${allWorkflows.length} workflows for scanning`);

        const scanStart = Date.now();
        customReport = scanWorkflows(
          allWorkflows,
          input.customChecks as CustomCheckType[] | undefined,
        );
        customScanMs = Date.now() - scanStart;

        logger.info(`Audit: custom scan found ${customReport.summary.total} findings across ${customReport.workflowsScanned} workflows`);
      } catch (scanError: any) {
        warnings.push(`Custom scan failed: ${scanError?.message || 'unknown error'}`);
        logger.warn(`Audit: custom scan failed: ${scanError?.message}`);
      }
    }

    const totalMs = Date.now() - totalStart;

    // Build the API URL for the report (mask the key)
    const apiConfig = resolveN8nApiConfigForResponse(context);
    const instanceUrl = apiConfig?.baseUrl || 'unknown';

    // Build unified markdown report
    const report = buildAuditReport({
      builtinAudit,
      customReport,
      performance: { builtinAuditMs, workflowFetchMs, customScanMs, totalMs },
      instanceUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
    });

    return {
      success: true,
      data: {
        report: report.markdown,
        summary: report.summary,
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid audit parameters',
        details: { issues: error.errors },
      };
    }
    if (error instanceof N8nApiError) {
      return {
        success: false,
        error: getUserFriendlyErrorMessage(error),
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
