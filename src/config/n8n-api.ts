import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// n8n API configuration schema
const n8nApiConfigSchema = z.object({
  N8N_API_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(1).optional(),
  N8N_API_TIMEOUT: z.coerce.number().positive().default(30000),
  N8N_API_MAX_RETRIES: z.coerce.number().positive().default(3),
  N8N_CERT_PATH: z.string().optional(),
  N8N_SKIP_SSL_VERIFICATION: z.string().transform(val => val === 'true').optional(),
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
  
  // Validate and read certificate if provided
  let cert: Buffer | undefined;
  if (config.N8N_CERT_PATH) {
    try {
      const certPath = path.resolve(config.N8N_CERT_PATH);
      if (!fs.existsSync(certPath)) {
        logger.error(`Certificate file not found: ${certPath}`);
        throw new Error(`Certificate file not found: ${certPath}`);
      }
      cert = fs.readFileSync(path.resolve(config.N8N_CERT_PATH));
      logger.info(`Custom SSL certificate loaded from: ${certPath}`);
    } catch (error) {
      logger.error(`Failed to load certificate from ${config.N8N_CERT_PATH}:`, error);
      throw error;
    }
  }
  
  // Log warning if SSL verification is disabled
  if (config.N8N_SKIP_SSL_VERIFICATION) {
    logger.warn('⚠️  N8N_SKIP_SSL_VERIFICATION is enabled. SSL certificate verification is disabled.');
    logger.warn('⚠️  This is insecure and should only be used for development purposes.');
  }

  return {
    baseUrl: config.N8N_API_URL,
    apiKey: config.N8N_API_KEY,
    timeout: config.N8N_API_TIMEOUT,
    maxRetries: config.N8N_API_MAX_RETRIES,
    cert,
    skipSslVerification: config.N8N_SKIP_SSL_VERIFICATION,
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
  };
}

// Type export
export type N8nApiConfig = NonNullable<ReturnType<typeof getN8nApiConfig>>;