import crypto from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthMode } from '../auth/oauth-config';
import { logger } from './logger';

export class AuthManager {
  private validTokens: Set<string>;
  private tokenExpiry: Map<string, number>;

  constructor() {
    this.validTokens = new Set();
    this.tokenExpiry = new Map();
  }

  /**
   * Validate an authentication token
   */
  validateToken(token: string | undefined, expectedToken?: string): boolean {
    if (!expectedToken) {
      // No authentication required
      return true;
    }

    if (!token) {
      return false;
    }

    // SECURITY: Use timing-safe comparison for static token
    // See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-02)
    if (AuthManager.timingSafeCompare(token, expectedToken)) {
      return true;
    }

    // Check dynamic tokens
    if (this.validTokens.has(token)) {
      const expiry = this.tokenExpiry.get(token);
      if (expiry && expiry > Date.now()) {
        return true;
      } else {
        // Token expired
        this.validTokens.delete(token);
        this.tokenExpiry.delete(token);
        return false;
      }
    }

    return false;
  }

  /**
   * Generate a new authentication token
   */
  generateToken(expiryHours: number = 24): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiryTime = Date.now() + (expiryHours * 60 * 60 * 1000);

    this.validTokens.add(token);
    this.tokenExpiry.set(token, expiryTime);

    // Clean up expired tokens
    this.cleanupExpiredTokens();

    return token;
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): void {
    this.validTokens.delete(token);
    this.tokenExpiry.delete(token);
  }

  /**
   * Clean up expired tokens
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, expiry] of this.tokenExpiry.entries()) {
      if (expiry <= now) {
        this.validTokens.delete(token);
        this.tokenExpiry.delete(token);
      }
    }
  }

  /**
   * Hash a password or token for secure storage
   */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Compare a plain token with a hashed token
   */
  static compareTokens(plainToken: string, hashedToken: string): boolean {
    const hashedPlainToken = AuthManager.hashToken(plainToken);
    return crypto.timingSafeEqual(
      Buffer.from(hashedPlainToken),
      Buffer.from(hashedToken)
    );
  }

  /**
   * Compare two tokens using constant-time algorithm to prevent timing attacks
   *
   * @param plainToken - Token from request
   * @param expectedToken - Expected token value
   * @returns true if tokens match, false otherwise
   *
   * @security This uses crypto.timingSafeEqual to prevent timing attack vulnerabilities.
   * Never use === or !== for token comparison as it allows attackers to discover
   * tokens character-by-character through timing analysis.
   *
   * @example
   * const isValid = AuthManager.timingSafeCompare(requestToken, serverToken);
   * if (!isValid) {
   *   return res.status(401).json({ error: 'Unauthorized' });
   * }
   *
   * @see https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-02)
   */
  static timingSafeCompare(plainToken: string, expectedToken: string): boolean {
    try {
      // Tokens must be non-empty
      if (!plainToken || !expectedToken) {
        return false;
      }

      // Convert to buffers
      const plainBuffer = Buffer.from(plainToken, 'utf8');
      const expectedBuffer = Buffer.from(expectedToken, 'utf8');

      // Check length first (constant time not needed for length comparison)
      if (plainBuffer.length !== expectedBuffer.length) {
        return false;
      }

      // Constant-time comparison
      return crypto.timingSafeEqual(plainBuffer, expectedBuffer);
    } catch (error) {
      // Buffer conversion or comparison failed
      return false;
    }
  }

  /**
   * Create an Express middleware that handles authentication based on the configured mode.
   *
   * - 'token': validates static Bearer token (existing behavior)
   * - 'oauth': delegates to SDK's requireBearerAuth middleware
   * - 'both': tries OAuth middleware first, falls back to static token
   *
   * @param mode - The auth mode
   * @param oauthMiddleware - SDK's requireBearerAuth middleware (for 'oauth' and 'both' modes)
   * @param staticToken - Static auth token (required for 'token' and 'both' modes)
   * @param resourceMetadataUrl - OAuth resource metadata URL for WWW-Authenticate header
   */
  static createAuthMiddleware(
    mode: AuthMode,
    oauthMiddleware?: RequestHandler,
    staticToken?: string | null,
    resourceMetadataUrl?: string
  ): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        logger.warn('Authentication failed: Missing Authorization header', {
          ip: req.ip,
          userAgent: req.get('user-agent'),
          reason: 'no_auth_header'
        });
        const headers: Record<string, string> = {};
        if (resourceMetadataUrl && (mode === 'oauth' || mode === 'both')) {
          headers['WWW-Authenticate'] = `Bearer resource_metadata="${resourceMetadataUrl}"`;
        }
        res.set(headers).status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null
        });
        return;
      }

      if (!authHeader.startsWith('Bearer ')) {
        logger.warn('Authentication failed: Invalid Authorization header format', {
          ip: req.ip,
          reason: 'invalid_auth_format'
        });
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null
        });
        return;
      }

      // Try OAuth middleware first for 'oauth' and 'both' modes
      if ((mode === 'oauth' || mode === 'both') && oauthMiddleware) {
        // Wrap the SDK middleware to intercept its response for 'both' mode fallback
        const oauthResult = await new Promise<'success' | 'failed'>((resolve) => {
          const mockRes = mode === 'both' ? createInterceptRes(res, () => resolve('failed')) : res;
          const mockNext: NextFunction = () => resolve('success');
          try {
            const result = oauthMiddleware(req, mockRes as Response, mockNext);
            // Handle async middleware
            if (result && typeof (result as any).catch === 'function') {
              (result as any).catch(() => resolve('failed'));
            }
          } catch {
            resolve('failed');
          }
        });

        if (oauthResult === 'success') {
          logger.info('OAuth authentication successful');
          next();
          return;
        }

        // In pure 'oauth' mode, the SDK middleware already sent the 401
        if (mode === 'oauth') {
          return;
        }
        // In 'both' mode, fall through to static token check
      }

      const token = authHeader.slice(7).trim();

      // Static token check for 'token' and 'both' modes
      if ((mode === 'token' || mode === 'both') && staticToken) {
        if (AuthManager.timingSafeCompare(token, staticToken)) {
          logger.info('Static token authentication successful');
          next();
          return;
        }
      }

      logger.warn('Authentication failed: Invalid token', { ip: req.ip, reason: 'invalid_token' });
      const headers: Record<string, string> = {};
      if (resourceMetadataUrl && (mode === 'oauth' || mode === 'both')) {
        headers['WWW-Authenticate'] = `Bearer resource_metadata="${resourceMetadataUrl}"`;
      }
      res.set(headers).status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null
      });
    };
  }
}

/**
 * Create a proxy response object that intercepts status/json/send calls
 * so the SDK middleware doesn't actually write the 401 to the real response
 * when we want to fall back to static token auth in 'both' mode.
 */
function createInterceptRes(realRes: Response, onReject: () => void): Partial<Response> {
  return {
    status: () => {
      onReject();
      // Return a mock that absorbs .json()/.send()/.end()
      return { json: () => realRes, send: () => realRes, end: () => realRes, set: () => realRes } as any;
    },
    set: () => ({ status: () => ({ json: () => realRes, send: () => realRes, end: () => realRes }) }) as any,
    json: () => { onReject(); return realRes; },
    send: () => { onReject(); return realRes; },
    end: () => { onReject(); return realRes; },
    headersSent: false,
  } as Partial<Response>;
}