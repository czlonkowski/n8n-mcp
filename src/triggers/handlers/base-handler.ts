/**
 * Base trigger handler - abstract class for all trigger handlers
 */

import { z } from 'zod';
import { Workflow } from '../../types/n8n-api';
import { InstanceContext } from '../../types/instance-context';
import { N8nApiClient } from '../../services/n8n-api-client';
import { getN8nApiConfig } from '../../config/n8n-api';
import {
  TriggerType,
  TriggerResponse,
  TriggerHandlerCapabilities,
  DetectedTrigger,
  BaseTriggerInput,
} from '../types';

/**
 * Constructor type for trigger handlers
 */
export type TriggerHandlerConstructor = new (
  client: N8nApiClient,
  context?: InstanceContext
) => BaseTriggerHandler;

/**
 * Abstract base class for all trigger handlers
 *
 * Each handler implements:
 * - Input validation via Zod schema
 * - Capability declaration (active workflow required, etc.)
 * - Execution logic specific to the trigger type
 */
export abstract class BaseTriggerHandler<T extends BaseTriggerInput = BaseTriggerInput> {
  protected client: N8nApiClient;
  protected context?: InstanceContext;

  /** The trigger type this handler supports */
  abstract readonly triggerType: TriggerType;

  /** Handler capabilities */
  abstract readonly capabilities: TriggerHandlerCapabilities;

  /** Zod schema for input validation */
  abstract readonly inputSchema: z.ZodSchema<T>;

  constructor(client: N8nApiClient, context?: InstanceContext) {
    this.client = client;
    this.context = context;
  }

  /**
   * Validate input against schema
   * @throws ZodError if validation fails
   */
  validate(input: unknown): T {
    return this.inputSchema.parse(input);
  }

  /**
   * Execute the trigger
   *
   * @param input - Validated trigger input
   * @param workflow - The workflow being triggered
   * @param triggerInfo - Detected trigger information (may be undefined for 'execute' type)
   */
  abstract execute(
    input: T,
    workflow: Workflow,
    triggerInfo?: DetectedTrigger
  ): Promise<TriggerResponse>;

  /**
   * Get the n8n instance base URL from context or environment config
   */
  protected getBaseUrl(): string | undefined {
    // First try context (for multi-tenant scenarios)
    if (this.context?.n8nApiUrl) {
      return this.context.n8nApiUrl.replace(/\/api\/v1\/?$/, '');
    }
    // SECURITY (GHSA-jxx9-px88-pj69): in multi-tenant mode, refuse to fall
    // back to the operator's env URL. A handler running without a tenant
    // context must not surface the operator's instance URL.
    if (process.env.ENABLE_MULTI_TENANT === 'true') {
      return undefined;
    }
    // Fallback to environment config
    const config = getN8nApiConfig();
    if (config?.baseUrl) {
      return config.baseUrl.replace(/\/api\/v1\/?$/, '');
    }
    return undefined;
  }

  /**
   * Get the n8n API key from context or environment config
   */
  protected getApiKey(): string | undefined {
    // First try context (for multi-tenant scenarios)
    if (this.context?.n8nApiKey) {
      return this.context.n8nApiKey;
    }
    // SECURITY (GHSA-jxx9-px88-pj69): in multi-tenant mode, refuse to fall
    // back to the operator's env API key.
    if (process.env.ENABLE_MULTI_TENANT === 'true') {
      return undefined;
    }
    // Fallback to environment config
    const config = getN8nApiConfig();
    return config?.apiKey;
  }

  /**
   * Normalize response to unified format
   */
  protected normalizeResponse(
    result: unknown,
    input: T,
    startTime: number,
    extra?: Partial<TriggerResponse>
  ): TriggerResponse {
    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
      success: true,
      triggerType: this.triggerType,
      workflowId: input.workflowId,
      data: result,
      metadata: {
        duration,
      },
      ...extra,
    };
  }

  /**
   * Create error response
   */
  protected errorResponse(
    input: BaseTriggerInput,
    error: string,
    startTime: number,
    extra?: Partial<TriggerResponse>
  ): TriggerResponse {
    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
      success: false,
      triggerType: this.triggerType,
      workflowId: input.workflowId,
      error,
      metadata: {
        duration,
      },
      ...extra,
    };
  }
}
