/**
 * Webhook trigger handler
 *
 * Handles webhook-based workflow triggers:
 * - Supports GET, POST, PUT, DELETE methods
 * - Passes data as body (POST/PUT/DELETE) or query params (GET)
 * - Includes SSRF protection
 */

import { z } from 'zod';
import { Workflow, WebhookRequest } from '../../types/n8n-api';
import {
  TriggerType,
  TriggerResponse,
  TriggerHandlerCapabilities,
  DetectedTrigger,
  WebhookTriggerInput,
} from '../types';
import { BaseTriggerHandler } from './base-handler';
import { buildTriggerUrl } from '../trigger-detector';
import { stripTrailingSlashes } from '../../utils/strip-trailing-slashes';

/**
 * Zod schema for webhook input validation
 */
const webhookInputSchema = z.object({
  workflowId: z.string(),
  triggerType: z.literal('webhook'),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
  webhookPath: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  waitForResponse: z.boolean().optional(),
});

/**
 * Webhook trigger handler
 */
export class WebhookHandler extends BaseTriggerHandler<WebhookTriggerInput> {
  readonly triggerType: TriggerType = 'webhook';

  readonly capabilities: TriggerHandlerCapabilities = {
    requiresActiveWorkflow: true,
    supportedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    canPassInputData: true,
  };

  readonly inputSchema = webhookInputSchema;

  async execute(
    input: WebhookTriggerInput,
    workflow: Workflow,
    triggerInfo?: DetectedTrigger
  ): Promise<TriggerResponse> {
    const startTime = Date.now();

    try {
      // Build webhook URL
      const baseUrl = this.getBaseUrl();
      if (!baseUrl) {
        return this.errorResponse(input, 'Cannot determine n8n base URL', startTime);
      }

      // Use provided webhook path or extract from trigger info
      let webhookUrl: string;
      if (input.webhookPath) {
        // User provided explicit path
        webhookUrl = `${stripTrailingSlashes(baseUrl)}/webhook/${input.webhookPath}`;
      } else if (triggerInfo?.webhookPath) {
        // Use detected path from workflow
        webhookUrl = buildTriggerUrl(baseUrl, triggerInfo, 'production');
      } else {
        return this.errorResponse(
          input,
          'No webhook path available. Provide webhookPath parameter or ensure workflow has a webhook trigger.',
          startTime
        );
      }

      if (!this.isUnderTriggerPrefix(webhookUrl, baseUrl, 'webhook')) {
        return this.errorResponse(input, 'Invalid webhook path', startTime);
      }

      // Determine HTTP method
      const httpMethod = input.httpMethod || triggerInfo?.httpMethod || 'POST';

      // SSRF protection - validate the webhook URL before making the request
      const { SSRFProtection } = await import('../../utils/ssrf-protection');
      const validation = await SSRFProtection.validateWebhookUrl(webhookUrl);
      if (!validation.valid) {
        return this.errorResponse(input, `SSRF protection: ${validation.reason}`, startTime);
      }

      // Build webhook request
      const webhookRequest: WebhookRequest = {
        webhookUrl,
        httpMethod: httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE',
        data: input.data,
        headers: input.headers,
        waitForResponse: input.waitForResponse ?? true,
      };

      // Trigger the webhook
      const response = await this.client.triggerWebhook(webhookRequest);

      return this.normalizeResponse(response, input, startTime, {
        status: response.status,
        statusText: response.statusText,
        metadata: {
          duration: Date.now() - startTime,
          webhookPath: input.webhookPath || triggerInfo?.webhookPath,
          httpMethod,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Try to extract execution ID from error if available
      const errorDetails = (error as any)?.details;
      const executionId = errorDetails?.executionId || errorDetails?.id;

      return this.errorResponse(input, errorMessage, startTime, {
        executionId,
        code: (error as any)?.code,
        details: errorDetails,
      });
    }
  }
}
