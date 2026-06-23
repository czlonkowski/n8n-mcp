/**
 * Event Validator for Telemetry
 * Validates and sanitizes telemetry events using Zod schemas
 */

import { z } from 'zod';
import { TelemetryEvent, WorkflowTelemetry } from './telemetry-types';
import { logger } from '../utils/logger';

// Base property schema that sanitizes strings
const sanitizedString = z.string().transform(val => {
  // Remove URLs
  let sanitized = val.replace(/https?:\/\/[^\s]+/gi, '[URL]');
  // Remove potential API keys
  sanitized = sanitized.replace(/[a-zA-Z0-9_-]{32,}/g, '[KEY]');
  // Remove emails
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  return sanitized;
});

// Schema for generic event properties
const eventPropertiesSchema = z.record(z.unknown()).transform(obj => {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip sensitive keys
    if (isSensitiveKey(key)) {
      continue;
    }

    // Sanitize string values
    if (typeof value === 'string') {
      sanitized[key] = sanitizedString.parse(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (value === null || value === undefined) {
      sanitized[key] = null;
    } else if (typeof value === 'object') {
      // Recursively sanitize nested objects (limited depth)
      sanitized[key] = sanitizeNestedObject(value, 3);
    }
  }

  return sanitized;
});

// Schema for telemetry events
export const telemetryEventSchema = z.object({
  user_id: z.string().min(1).max(64),
  event: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  properties: eventPropertiesSchema,
  created_at: z.string().datetime().optional()
});

// SECURITY (GHSA-f3rg-xqjj-cj9w): strict allow-list for sanitized workflow
// nodes so the validator rejects payloads whose node-level fields drift from
// the sanitizer's output. Maintained independently from `workflowNodeSchema`
// in `src/services/n8n-validation.ts` — derivation via `.omit().extend()`
// would silently widen this allow-list every time the general schema gains a
// field, defeating the purpose of `.strict()`. Differences vs. that schema:
// omits `credentials` (deleted by `WorkflowSanitizer.sanitizeNode`), adds
// `onError` and `webhookId` (legitimate post-sanitization node fields not
// yet covered by `workflowNodeSchema`), and applies `.strict()` so an unknown
// node-level key surfaces as a validation failure rather than silently
// propagating to Supabase.
const sanitizedNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  typeVersion: z.number(),
  position: z.tuple([z.number(), z.number()]),
  parameters: z.record(z.string(), z.unknown()),
  disabled: z.boolean().optional(),
  notes: z.string().optional(),
  notesInFlow: z.boolean().optional(),
  continueOnFail: z.boolean().optional(),
  retryOnFail: z.boolean().optional(),
  maxTries: z.number().optional(),
  waitBetweenTries: z.number().optional(),
  alwaysOutputData: z.boolean().optional(),
  executeOnce: z.boolean().optional(),
  onError: z.enum(['continueRegularOutput', 'continueErrorOutput', 'stopWorkflow']).optional(),
  webhookId: z.string().optional(),
}).strict();

// Schema for workflow telemetry
export const workflowTelemetrySchema = z.object({
  user_id: z.string().min(1).max(64),
  workflow_hash: z.string().min(1).max(64),
  node_count: z.number().int().min(0).max(1000),
  node_types: z.array(z.string()).max(100),
  has_trigger: z.boolean(),
  has_webhook: z.boolean(),
  complexity: z.enum(['simple', 'medium', 'complex']),
  sanitized_workflow: z.object({
    nodes: z.array(sanitizedNodeSchema).max(1000),
    connections: z.record(z.any())
  }),
  created_at: z.string().datetime().optional()
});

// Specific event property schemas for common events
const toolUsagePropertiesSchema = z.object({
  tool: z.string().max(100),
  success: z.boolean(),
  duration: z.number().min(0).max(3600000), // Max 1 hour
});

const searchQueryPropertiesSchema = z.object({
  query: z.string().max(100).transform(val => {
    // Apply same sanitization as sanitizedString
    let sanitized = val.replace(/https?:\/\/[^\s]+/gi, '[URL]');
    sanitized = sanitized.replace(/[a-zA-Z0-9_-]{32,}/g, '[KEY]');
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
    return sanitized;
  }),
  resultsFound: z.number().int().min(0),
  searchType: z.string().max(50),
  hasResults: z.boolean(),
  isZeroResults: z.boolean()
});

const validationDetailsPropertiesSchema = z.object({
  nodeType: z.string().max(100),
  errorType: z.string().max(100),
  errorCategory: z.string().max(50),
  details: z.record(z.any()).optional()
});

const performanceMetricPropertiesSchema = z.object({
  operation: z.string().max(100),
  duration: z.number().min(0).max(3600000),
  isSlow: z.boolean(),
  isVerySlow: z.boolean(),
  metadata: z.record(z.any()).optional()
});

// Schema for startup_error event properties (v2.18.2)
const startupErrorPropertiesSchema = z.object({
  checkpoint: z.string().max(100),
  errorMessage: z.string().max(500),
  errorType: z.string().max(100),
  checkpointsPassed: z.array(z.string()).max(20),
  checkpointsPassedCount: z.number().int().min(0).max(20),
  startupDuration: z.number().min(0).max(300000), // Max 5 minutes
  platform: z.string().max(50),
  arch: z.string().max(50),
  nodeVersion: z.string().max(50),
  isDocker: z.boolean()
});

// Schema for startup_completed event properties (v2.18.2)
const startupCompletedPropertiesSchema = z.object({
  version: z.string().max(50)
});

// Map of event names to their specific schemas
const EVENT_SCHEMAS: Record<string, z.ZodSchema<any>> = {
  'tool_used': toolUsagePropertiesSchema,
  'search_query': searchQueryPropertiesSchema,
  'validation_details': validationDetailsPropertiesSchema,
  'performance_metric': performanceMetricPropertiesSchema,
  'startup_error': startupErrorPropertiesSchema,
  'startup_completed': startupCompletedPropertiesSchema,
};

/**
 * Check if a key is sensitive
 * Handles various naming conventions: camelCase, snake_case, kebab-case, and case variations
 */
function isSensitiveKey(key: string): boolean {
  const sensitivePatterns = [
    // Core sensitive terms
    'password', 'passwd', 'pwd',
    'token', 'jwt', 'bearer',
    'apikey', 'api_key', 'api-key',
    'secret', 'private',
    'credential', 'cred', 'auth',

    // Network/Connection sensitive
    'url', 'uri', 'endpoint', 'host', 'hostname',
    'database', 'db', 'connection', 'conn',

    // Service-specific
    'slack', 'discord', 'telegram',
    'oauth', 'client_secret', 'client-secret', 'clientsecret',
    'access_token', 'access-token', 'accesstoken',
    'refresh_token', 'refresh-token', 'refreshtoken'
  ];

  const lowerKey = key.toLowerCase();

  // Check for exact matches first (most efficient)
  if (sensitivePatterns.includes(lowerKey)) {
    return true;
  }

  // Check for compound key terms specifically
  if (lowerKey.includes('key') && lowerKey !== 'key') {
    // Check if it's a compound term like apikey, api_key, etc.
    const keyPatterns = ['apikey', 'api_key', 'api-key', 'secretkey', 'secret_key', 'privatekey', 'private_key'];
    if (keyPatterns.some(pattern => lowerKey.includes(pattern))) {
      return true;
    }
  }

  // Check for substring matches with word boundaries
  return sensitivePatterns.some(pattern => {
    // Match as whole words or with common separators
    const regex = new RegExp(`(?:^|[_-])${pattern}(?:[_-]|$)`, 'i');
    return regex.test(key) || lowerKey.includes(pattern);
  });
}

/**
 * Sanitize nested objects with depth limit
 */
function sanitizeNestedObject(obj: any, maxDepth: number): any {
  if (maxDepth <= 0 || !obj || typeof obj !== 'object') {
    return '[NESTED]';
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map(item =>
      typeof item === 'object' ? sanitizeNestedObject(item, maxDepth - 1) : item
    );
  }

  const sanitized: Record<string, any> = {};
  let keyCount = 0;

  for (const [key, value] of Object.entries(obj)) {
    if (keyCount++ >= 20) { // Limit keys per object
      sanitized['...'] = 'truncated';
      break;
    }

    if (isSensitiveKey(key)) {
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] = sanitizedString.parse(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeNestedObject(value, maxDepth - 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export class TelemetryEventValidator {
  private validationErrors: number = 0;
  private validationSuccesses: number = 0;

  /**
   * Validate and sanitize a telemetry event
   */
  validateEvent(event: TelemetryEvent): TelemetryEvent | null {
    try {
      // Use specific schema if available for this event type
      const specificSchema = EVENT_SCHEMAS[event.event];

      if (specificSchema) {
        // Validate properties with specific schema first
        const validatedProperties = specificSchema.safeParse(event.properties);
        if (!validatedProperties.success) {
          logger.debug(`Event validation failed for ${event.event}:`, validatedProperties.error.errors);
          this.validationErrors++;
          return null;
        }
        event.properties = validatedProperties.data;
      }

      // Validate the complete event
      const validated = telemetryEventSchema.parse(event);
      this.validationSuccesses++;
      return validated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug('Event validation error:', error.errors);
      } else {
        logger.debug('Unexpected validation error:', error);
      }
      this.validationErrors++;
      return null;
    }
  }

  /**
   * Validate workflow telemetry
   */
  validateWorkflow(workflow: WorkflowTelemetry): WorkflowTelemetry | null {
    try {
      const validated = workflowTelemetrySchema.parse(workflow);
      this.validationSuccesses++;
      return validated;
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug('Workflow validation error:', error.errors);
      } else {
        logger.debug('Unexpected workflow validation error:', error);
      }
      this.validationErrors++;
      return null;
    }
  }

  /**
   * Get validation statistics
   */
  getStats() {
    return {
      errors: this.validationErrors,
      successes: this.validationSuccesses,
      total: this.validationErrors + this.validationSuccesses,
      errorRate: this.validationErrors / (this.validationErrors + this.validationSuccesses) || 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.validationErrors = 0;
    this.validationSuccesses = 0;
  }
}