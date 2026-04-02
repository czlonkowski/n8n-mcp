import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { logger } from '../utils/logger';

/**
 * Verifies OAuth access tokens issued by n8n's authorization server.
 * n8n's OAuth tokens are only accepted by the /mcp-server/http endpoint,
 * not by the public REST API (/api/v1/ which requires X-N8N-API-KEY).
 * We validate by sending a lightweight JSON-RPC ping to n8n's MCP endpoint.
 */
export class N8nTokenVerifier implements OAuthTokenVerifier {
  private n8nBaseUrl: string;

  constructor(n8nBaseUrl: string) {
    // Strip trailing slash
    this.n8nBaseUrl = n8nBaseUrl.replace(/\/+$/, '');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // Validate by sending a JSON-RPC ping to n8n's MCP endpoint.
      // The /mcp-server/http endpoint accepts OAuth Bearer tokens,
      // unlike /api/v1/ which only accepts X-N8N-API-KEY.
      const response = await fetch(`${this.n8nBaseUrl}/mcp-server/http`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: 1,
        }),
      });

      if (!response.ok) {
        logger.warn('n8n token verification failed', {
          status: response.status,
        });
        throw new Error('Invalid or expired n8n access token');
      }

      logger.info('n8n token verified successfully');

      return {
        token,
        clientId: 'n8n-oauth-user',
        scopes: ['tool:listWorkflows', 'tool:getWorkflowDetails'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        extra: { n8nBaseUrl: this.n8nBaseUrl },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('n8n access token')) {
        throw error;
      }
      logger.error('n8n token verification error', error);
      throw new Error('Failed to verify token against n8n');
    }
  }
}
