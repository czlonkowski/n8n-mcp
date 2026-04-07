import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// n8n API configuration schema
const n8nApiConfigSchema = z.object({
  N8N_API_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(1).optional(),
  /** Session cookie for browser-session-based authentication (alternative to N8N_API_KEY) */
  N8N_API_COOKIE: z.string().min(1).optional(),
  N8N_API_TIMEOUT: z.coerce.number().positive().default(30000),
  N8N_API_MAX_RETRIES: z.coerce.number().positive().default(3),
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
  
  // Require URL and at least one credential (API key or cookie)
  if (!config.N8N_API_URL || (!config.N8N_API_KEY && !config.N8N_API_COOKIE)) {
    return null;
  }
  
  return {
    baseUrl: config.N8N_API_URL,
    apiKey: config.N8N_API_KEY,
    cookie: config.N8N_API_COOKIE,
    timeout: config.N8N_API_TIMEOUT,
    maxRetries: config.N8N_API_MAX_RETRIES,
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
  n8nApiCookie?: string;
  n8nApiTimeout?: number;
  n8nApiMaxRetries?: number;
}): N8nApiConfig | null {
  if (!context.n8nApiUrl || (!context.n8nApiKey && !context.n8nApiCookie)) {
    return null;
  }

  return {
    baseUrl: context.n8nApiUrl,
    apiKey: context.n8nApiKey,
    cookie: context.n8nApiCookie,
    timeout: context.n8nApiTimeout ?? 30000,
    maxRetries: context.n8nApiMaxRetries ?? 3,
  };
}

// Type export
export type N8nApiConfig = NonNullable<ReturnType<typeof getN8nApiConfig>>;