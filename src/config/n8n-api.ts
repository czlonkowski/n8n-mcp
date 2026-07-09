import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// n8n API configuration schema
const n8nApiConfigSchema = z.object({
  N8N_API_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(1).optional(),
  N8N_API_TIMEOUT: z.coerce.number().positive().default(30000),
  N8N_API_MAX_RETRIES: z.coerce.number().positive().default(3),
  // trim() so a whitespace-only value (e.g. "   ") normalizes to "" and is treated
  // as unset, rather than being forwarded as an invalid CF-Access header value.
  N8N_CF_CLIENT_ID: z.string().trim().optional(),
  N8N_CF_CLIENT_SECRET: z.string().trim().optional(),
});

// Track if we've loaded env vars
let envLoaded = false;

// Parse and validate n8n API configuration
export function getN8nApiConfig() {
  // Load environment variables on first access
  if (!envLoaded) {
    dotenv.config();
    envLoaded = true;
  }

  const result = n8nApiConfigSchema.safeParse(process.env);

  if (!result.success) {
    return null;
  }

  const config = result.data;

  // Check if both URL and API key are provided
  if (!config.N8N_API_URL || !config.N8N_API_KEY) {
    return null;
  }

  return {
    baseUrl: config.N8N_API_URL,
    apiKey: config.N8N_API_KEY,
    timeout: config.N8N_API_TIMEOUT,
    maxRetries: config.N8N_API_MAX_RETRIES,
    cfClientId: config.N8N_CF_CLIENT_ID,
    cfClientSecret: config.N8N_CF_CLIENT_SECRET,
  };
}

// Helper to check if n8n API is configured (lazy check)
export function isN8nApiConfigured(): boolean {
  const config = getN8nApiConfig();
  return config !== null;
}

/**
 * Create n8n API configuration from instance context
 * Used for flexible instance configuration support
 */
export function getN8nApiConfigFromContext(context: {
  n8nApiUrl?: string;
  n8nApiKey?: string;
  n8nApiTimeout?: number;
  n8nApiMaxRetries?: number;
}): N8nApiConfig | null {
  if (!context.n8nApiUrl || !context.n8nApiKey) {
    return null;
  }

  return {
    baseUrl: context.n8nApiUrl,
    apiKey: context.n8nApiKey,
    timeout: context.n8nApiTimeout ?? 30000,
    maxRetries: context.n8nApiMaxRetries ?? 3,
    // Cloudflare Access is configured via the N8N_CF_CLIENT_ID / N8N_CF_CLIENT_SECRET
    // env vars only; it is intentionally not threaded through the multi-tenant instance
    // context (would add a service-token credential to the per-request surface).
    cfClientId: undefined,
    cfClientSecret: undefined,
  };
}

// Type export
export type N8nApiConfig = NonNullable<ReturnType<typeof getN8nApiConfig>>;