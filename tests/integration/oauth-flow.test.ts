import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryOAuthProvider } from '../../src/auth/oauth-provider';
import { InMemoryClientsStore } from '../../src/auth/oauth-clients-store';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import crypto from 'crypto';

/**
 * End-to-end OAuth 2.1 flow test simulating a real client interaction.
 */
describe('OAuth 2.1 End-to-End Flow', () => {
  let provider: InMemoryOAuthProvider;
  let clientsStore: InMemoryClientsStore;

  beforeEach(() => {
    clientsStore = new InMemoryClientsStore();
    provider = new InMemoryOAuthProvider(clientsStore);
  });

  afterEach(() => {
    provider.destroy();
  });

  it('completes full OAuth flow: register -> authorize -> token -> access -> refresh -> revoke', async () => {
    // Step 1: Dynamic Client Registration (RFC 7591)
    const registeredClient = clientsStore.registerClient({
      redirect_uris: ['https://client.example.com/callback'],
      client_name: 'Integration Test Client',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }) as OAuthClientInformationFull;

    expect(registeredClient.client_id).toBeTruthy();
    expect(registeredClient.client_secret).toBeTruthy();

    // Verify client can be looked up
    const lookedUp = clientsStore.getClient(registeredClient.client_id);
    expect(lookedUp).toEqual(registeredClient);

    // Step 2: Generate PKCE challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Step 3: Authorization request
    let capturedRedirectUrl: string | undefined;
    const mockRes = {
      redirect: (_status: number, url: string) => {
        capturedRedirectUrl = url;
      },
    } as any;

    await provider.authorize(registeredClient, {
      codeChallenge,
      redirectUri: 'https://client.example.com/callback',
      state: 'random-state-value',
      scopes: ['mcp:read', 'mcp:write'],
    }, mockRes);

    expect(capturedRedirectUrl).toBeTruthy();
    const redirectUrl = new URL(capturedRedirectUrl!);
    expect(redirectUrl.searchParams.get('state')).toBe('random-state-value');
    const authCode = redirectUrl.searchParams.get('code')!;
    expect(authCode).toBeTruthy();

    // Step 4: Exchange authorization code for tokens
    const tokens = await provider.exchangeAuthorizationCode(
      registeredClient,
      authCode,
      codeVerifier,
      'https://client.example.com/callback'
    );

    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.scope).toBe('mcp:read mcp:write');

    // Step 5: Use access token
    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    expect(authInfo.clientId).toBe(registeredClient.client_id);
    expect(authInfo.scopes).toEqual(['mcp:read', 'mcp:write']);

    // Step 6: Refresh token
    const refreshedTokens = await provider.exchangeRefreshToken(
      registeredClient,
      tokens.refresh_token!
    );

    expect(refreshedTokens.access_token).not.toBe(tokens.access_token);
    expect(refreshedTokens.refresh_token).not.toBe(tokens.refresh_token);

    // Old access token should still work until it expires
    // New access token should also work
    const newAuthInfo = await provider.verifyAccessToken(refreshedTokens.access_token);
    expect(newAuthInfo.clientId).toBe(registeredClient.client_id);

    // Step 7: Revoke new access token
    await provider.revokeToken!(registeredClient, {
      token: refreshedTokens.access_token,
      token_type_hint: 'access_token',
    });

    // Revoked token should no longer work
    await expect(
      provider.verifyAccessToken(refreshedTokens.access_token)
    ).rejects.toThrow();

    // Step 8: Revoke refresh token
    await provider.revokeToken!(registeredClient, {
      token: refreshedTokens.refresh_token!,
      token_type_hint: 'refresh_token',
    });

    // Revoked refresh token should no longer work
    await expect(
      provider.exchangeRefreshToken(registeredClient, refreshedTokens.refresh_token!)
    ).rejects.toThrow();
  });

  it('prevents authorization code reuse', async () => {
    const client = clientsStore.registerClient({
      redirect_uris: ['https://example.com/cb'],
    }) as OAuthClientInformationFull;

    const mockRes = { redirect: vi.fn() } as any;
    await provider.authorize(client, {
      codeChallenge: 'challenge',
      redirectUri: 'https://example.com/cb',
    }, mockRes);

    const code = new URL(mockRes.redirect.mock.calls[0][1]).searchParams.get('code')!;

    // First exchange succeeds
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    expect(tokens.access_token).toBeTruthy();

    // Second exchange fails (code consumed)
    await expect(
      provider.exchangeAuthorizationCode(client, code)
    ).rejects.toThrow();
  });

  it('enforces refresh token rotation', async () => {
    const client = clientsStore.registerClient({
      redirect_uris: ['https://example.com/cb'],
    }) as OAuthClientInformationFull;

    const mockRes = { redirect: vi.fn() } as any;
    await provider.authorize(client, {
      codeChallenge: 'challenge',
      redirectUri: 'https://example.com/cb',
    }, mockRes);

    const code = new URL(mockRes.redirect.mock.calls[0][1]).searchParams.get('code')!;
    const tokens = await provider.exchangeAuthorizationCode(client, code);

    // First refresh succeeds and rotates token
    const newTokens = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
    expect(newTokens.refresh_token).not.toBe(tokens.refresh_token);

    // Using old refresh token fails
    await expect(
      provider.exchangeRefreshToken(client, tokens.refresh_token!)
    ).rejects.toThrow();

    // Using new refresh token succeeds
    const newerTokens = await provider.exchangeRefreshToken(client, newTokens.refresh_token!);
    expect(newerTokens.access_token).toBeTruthy();
  });
});
