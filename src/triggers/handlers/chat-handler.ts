/**
 * Chat trigger handler
 *
 * Handles chat-based workflow triggers:
 * - POST to webhook endpoint with chat payload
 * - Payload structure: { action: 'sendMessage', sessionId, chatInput }
 * - Sync mode only (no SSE streaming)
 */

import { z } from 'zod';
import axios, { AxiosRequestConfig } from 'axios';
import { randomUUID } from 'crypto';
import { Workflow } from '../../types/n8n-api';
import {
  TriggerType,
  TriggerResponse,
  TriggerHandlerCapabilities,
  DetectedTrigger,
  ChatTriggerInput,
} from '../types';
import { BaseTriggerHandler } from './base-handler';
import { buildTriggerUrl } from '../trigger-detector';

/**
 * Zod schema for chat input validation
 */
const chatInputSchema = z.object({
  workflowId: z.string(),
  triggerType: z.literal('chat'),
  message: z.string(),
  sessionId: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  waitForResponse: z.boolean().optional(),
});

/**
 * Generate a unique, unguessable session ID.
 *
 * Uses `crypto.randomUUID` (CSPRNG, 122 bits of entropy) rather than
 * `Math.random` so an attacker observing one session ID cannot predict
 * another. Addresses CodeQL js/insecure-randomness.
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${randomUUID()}`;
}

/**
 * Chat trigger handler
 */
export class ChatHandler extends BaseTriggerHandler<ChatTriggerInput> {
  readonly triggerType: TriggerType = 'chat';

  readonly capabilities: TriggerHandlerCapabilities = {
    requiresActiveWorkflow: true,
    canPassInputData: true,
  };

  readonly inputSchema = chatInputSchema;

  async execute(
    input: ChatTriggerInput,
    workflow: Workflow,
    triggerInfo?: DetectedTrigger
  ): Promise<TriggerResponse> {
    const startTime = Date.now();

    try {
      // Build chat webhook URL
      const baseUrl = this.getBaseUrl();
      if (!baseUrl) {
        return this.errorResponse(input, 'Cannot determine n8n base URL', startTime);
      }

      // Use trigger info to build URL or fallback to default pattern
      let chatUrl: string;
      if (triggerInfo?.webhookPath) {
        chatUrl = buildTriggerUrl(baseUrl, triggerInfo, 'production');
      } else {
        // Default chat webhook path pattern
        chatUrl = `${baseUrl.replace(/\/+$/, '')}/webhook/${input.workflowId}`;
      }

      // SSRF protection
      const { SSRFProtection } = await import('../../utils/ssrf-protection');
      const validation = await SSRFProtection.validateWebhookUrl(chatUrl);
      if (!validation.valid) {
        return this.errorResponse(input, `SSRF protection: ${validation.reason}`, startTime);
      }

      // Generate or use provided session ID
      const sessionId = input.sessionId || generateSessionId();

      // Build chat payload
      const chatPayload = {
        action: 'sendMessage',
        sessionId,
        chatInput: input.message,
        // Include any additional data
        ...input.data,
      };

      // Build request config
      const config: AxiosRequestConfig = {
        method: 'POST',
        url: chatUrl,
        headers: {
          'Content-Type': 'application/json',
          ...input.headers,
        },
        data: chatPayload,
        timeout: input.timeout || (input.waitForResponse !== false ? 120000 : 30000),
        validateStatus: (status) => status < 500,
      };

      // Make the request (sync mode - no streaming)
      const response = await axios.request(config);

      // Extract the chat response
      const chatResponse = response.data;

      return this.normalizeResponse(chatResponse, input, startTime, {
        status: response.status,
        statusText: response.statusText,
        metadata: {
          duration: Date.now() - startTime,
          sessionId,
          webhookPath: triggerInfo?.webhookPath,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Try to extract execution ID from error if available
      const errorDetails = (error as any)?.response?.data;
      const executionId = errorDetails?.executionId || errorDetails?.id;

      return this.errorResponse(input, errorMessage, startTime, {
        executionId,
        code: (error as any)?.code,
        details: errorDetails,
      });
    }
  }
}
