import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { logger } from '../utils/logger';

export type AuthMode = 'token' | 'oauth' | 'both';

export interface OAuthConfig {
  issuerUrl: string;
  serverUrl: string;
  n8nOAuthMetadata: OAuthMetadata;
}

/**
 * Fetch n8n's OAuth authorization server metadata.
 */
export async function fetchN8nOAuthMetadata(issuerUrl: string): Promise<OAuthMetadata> {
  const metadataUrl = `${issuerUrl.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`;
  logger.info('Fetching n8n OAuth metadata', { metadataUrl });

  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OAuth metadata from ${metadataUrl}: ${response.status} ${response.statusText}`
    );
  }

  const metadata = await response.json() as OAuthMetadata;

  // Validate required fields
  if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(
      'Invalid OAuth metadata: missing required fields (issuer, authorization_endpoint, token_endpoint)'
    );
  }

  logger.info('n8n OAuth metadata fetched', {
    issuer: metadata.issuer,
    scopes: metadata.scopes_supported,
    hasRegistration: !!metadata.registration_endpoint,
  });

  return metadata;
}

/**
 * Load and validate OAuth configuration from environment variables.
 * Returns null if OAuth is not configured (AUTH_MODE=token).
 *
 * This is a synchronous pre-validation step. Call fetchN8nOAuthMetadata()
 * separately to complete the async metadata fetch.
 */
export function loadOAuthConfig(authMode: AuthMode): Omit<OAuthConfig, 'n8nOAuthMetadata'> | null {
  if (authMode === 'token') {
    return null;
  }

  const issuerUrl = process.env.OAUTH_ISSUER_URL;
  if (!issuerUrl) {
    throw new Error(
      'OAUTH_ISSUER_URL is required when AUTH_MODE includes OAuth. ' +
      'Set it to your n8n instance URL (e.g., https://n8n.example.com).'
    );
  }

  // Validate issuerUrl is a valid URL
  try {
    new URL(issuerUrl);
  } catch {
    throw new Error(`OAUTH_ISSUER_URL is not a valid URL: ${issuerUrl}`);
  }

  const host = process.env.HOST || '0.0.0.0';
  const port = process.env.PORT || '3000';
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const serverUrl = process.env.OAUTH_SERVER_URL || `http://${displayHost}:${port}`;

  logger.info('OAuth configuration loaded (pending metadata fetch)', {
    issuerUrl,
    serverUrl,
  });

  return { issuerUrl, serverUrl };
}

/**
 * Parse AUTH_MODE from environment, defaulting to 'token' for backward compatibility.
 */
export function loadAuthMode(): AuthMode {
  const raw = (process.env.AUTH_MODE || 'token').toLowerCase().trim();
  if (raw === 'token' || raw === 'oauth' || raw === 'both') {
    return raw;
  }
  logger.warn(`Invalid AUTH_MODE "${raw}", falling back to "token"`);
  return 'token';
}
