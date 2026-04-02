import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Response } from 'express';
import crypto from 'crypto';
import { InMemoryClientsStore } from './oauth-clients-store';
import { logger } from '../utils/logger';

// TTL constants
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;    // 1 hour
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;     // 15 minutes

interface AuthCode {
  code: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
}

interface StoredToken {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  type: 'access' | 'refresh';
}

/**
 * In-memory OAuth 2.1 server provider for MCP.
 * Implements the full authorization code flow with PKCE.
 */
export class InMemoryOAuthProvider implements OAuthServerProvider {
  private _clientsStore: InMemoryClientsStore;
  private authCodes = new Map<string, AuthCode>();
  private accessTokens = new Map<string, StoredToken>();
  private refreshTokens = new Map<string, StoredToken>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(clientsStore?: InMemoryClientsStore) {
    this._clientsStore = clientsStore || new InMemoryClientsStore();
    this.startCleanup();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Auto-approve authorization: the user already initiated the MCP connection,
   * so we redirect back immediately with an auth code.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const code = crypto.randomBytes(32).toString('hex');

    this.authCodes.set(code, {
      code,
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes || [],
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    logger.info('OAuth: authorization code issued', { clientId: client.client_id });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (params.state) {
      redirectUrl.searchParams.set('state', params.state);
    }
    res.redirect(302, redirectUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const entry = this.authCodes.get(authorizationCode);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new Error('Invalid or expired authorization code');
    }
    return entry.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const entry = this.authCodes.get(authorizationCode);
    if (!entry) {
      throw new Error('Invalid authorization code');
    }
    if (entry.expiresAt < Date.now()) {
      this.authCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }
    if (entry.clientId !== client.client_id) {
      throw new Error('Client ID mismatch');
    }

    // Consume the auth code (one-time use)
    this.authCodes.delete(authorizationCode);

    return this.issueTokens(client.client_id, entry.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    const stored = this.refreshTokens.get(refreshToken);
    if (!stored || stored.expiresAt < Date.now()) {
      if (stored) this.refreshTokens.delete(refreshToken);
      throw new Error('Invalid or expired refresh token');
    }
    if (stored.clientId !== client.client_id) {
      throw new Error('Client ID mismatch');
    }

    // Revoke old refresh token (rotation)
    this.refreshTokens.delete(refreshToken);

    // Use requested scopes if subset of original, otherwise use original
    const effectiveScopes = scopes && scopes.every(s => stored.scopes.includes(s))
      ? scopes
      : stored.scopes;

    return this.issueTokens(client.client_id, effectiveScopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = this.accessTokens.get(token);
    if (!stored) {
      throw new Error('Invalid access token');
    }
    if (stored.expiresAt < Date.now()) {
      this.accessTokens.delete(token);
      throw new Error('Access token expired');
    }

    return {
      token: stored.token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: Math.floor(stored.expiresAt / 1000),
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const { token, token_type_hint } = request;

    if (token_type_hint === 'refresh_token' || !token_type_hint) {
      const refreshEntry = this.refreshTokens.get(token);
      if (refreshEntry && refreshEntry.clientId === client.client_id) {
        this.refreshTokens.delete(token);
        return;
      }
    }

    if (token_type_hint === 'access_token' || !token_type_hint) {
      const accessEntry = this.accessTokens.get(token);
      if (accessEntry && accessEntry.clientId === client.client_id) {
        this.accessTokens.delete(token);
        return;
      }
    }
    // Per RFC 7009: if token is invalid/already revoked, do nothing
  }

  /**
   * Stop the cleanup timer (for graceful shutdown).
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private issueTokens(clientId: string, scopes: string[]): OAuthTokens {
    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.accessTokens.set(accessToken, {
      token: accessToken,
      clientId,
      scopes,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
      type: 'access',
    });

    this.refreshTokens.set(refreshToken, {
      token: refreshToken,
      clientId,
      scopes,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
      type: 'refresh',
    });

    const expiresInSec = Math.floor(ACCESS_TOKEN_TTL_MS / 1000);

    logger.info('OAuth: tokens issued', { clientId, scopes, expiresIn: expiresInSec });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresInSec,
      scope: scopes.join(' '),
      refresh_token: refreshToken,
    };
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.purgeExpired();
    }, CLEANUP_INTERVAL_MS);
    // Allow process to exit even if timer is running
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    let purged = 0;

    for (const [key, entry] of this.authCodes) {
      if (entry.expiresAt < now) { this.authCodes.delete(key); purged++; }
    }
    for (const [key, entry] of this.accessTokens) {
      if (entry.expiresAt < now) { this.accessTokens.delete(key); purged++; }
    }
    for (const [key, entry] of this.refreshTokens) {
      if (entry.expiresAt < now) { this.refreshTokens.delete(key); purged++; }
    }

    if (purged > 0) {
      logger.debug('OAuth: purged expired entries', { purged });
    }
  }
}
