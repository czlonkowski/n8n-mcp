import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryOAuthProvider } from '../../../src/auth/oauth-provider';
import { InMemoryClientsStore } from '../../../src/auth/oauth-clients-store';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

describe('InMemoryOAuthProvider', () => {
  let provider: InMemoryOAuthProvider;
  let clientsStore: InMemoryClientsStore;
  let testClient: OAuthClientInformationFull;

  beforeEach(() => {
    clientsStore = new InMemoryClientsStore();
    provider = new InMemoryOAuthProvider(clientsStore);

    // Register a test client
    testClient = clientsStore.registerClient({
      redirect_uris: ['https://example.com/callback'],
      client_name: 'Test Client',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }) as OAuthClientInformationFull;
  });

  afterEach(() => {
    provider.destroy();
  });

  describe('clientsStore', () => {
    it('returns the clients store', () => {
      expect(provider.clientsStore).toBe(clientsStore);
    });
  });

  describe('authorize', () => {
    it('redirects with authorization code and state', async () => {
      const res = {
        redirect: vi.fn(),
      } as any;

      await provider.authorize(testClient, {
        codeChallenge: 'test-challenge',
        redirectUri: 'https://example.com/callback',
        state: 'test-state',
        scopes: ['mcp:read'],
      }, res);

      expect(res.redirect).toHaveBeenCalledOnce();
      const [status, url] = res.redirect.mock.calls[0];
      expect(status).toBe(302);

      const redirectUrl = new URL(url);
      expect(redirectUrl.searchParams.get('code')).toBeTruthy();
      expect(redirectUrl.searchParams.get('state')).toBe('test-state');
      expect(redirectUrl.origin + redirectUrl.pathname).toBe('https://example.com/callback');
    });

    it('redirects without state when not provided', async () => {
      const res = { redirect: vi.fn() } as any;

      await provider.authorize(testClient, {
        codeChallenge: 'test-challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const redirectUrl = new URL(res.redirect.mock.calls[0][1]);
      expect(redirectUrl.searchParams.has('state')).toBe(false);
    });
  });

  describe('challengeForAuthorizationCode', () => {
    it('returns the code challenge', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'my-challenge-123',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const challenge = await provider.challengeForAuthorizationCode(testClient, code);
      expect(challenge).toBe('my-challenge-123');
    });

    it('throws for invalid code', async () => {
      await expect(
        provider.challengeForAuthorizationCode(testClient, 'nonexistent')
      ).rejects.toThrow('Invalid or expired');
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('returns tokens for valid code', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
        scopes: ['mcp:read'],
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.token_type).toBe('bearer');
      expect(tokens.expires_in).toBeGreaterThan(0);
      expect(tokens.scope).toBe('mcp:read');
    });

    it('consumes the code (one-time use)', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      await provider.exchangeAuthorizationCode(testClient, code);

      await expect(
        provider.exchangeAuthorizationCode(testClient, code)
      ).rejects.toThrow('Invalid authorization code');
    });

    it('rejects wrong client', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const otherClient = { ...testClient, client_id: 'other-id' };

      await expect(
        provider.exchangeAuthorizationCode(otherClient, code)
      ).rejects.toThrow('Client ID mismatch');
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid token', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
        scopes: ['mcp:read', 'mcp:write'],
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);

      const authInfo = await provider.verifyAccessToken(tokens.access_token);
      expect(authInfo.clientId).toBe(testClient.client_id);
      expect(authInfo.scopes).toEqual(['mcp:read', 'mcp:write']);
      expect(authInfo.token).toBe(tokens.access_token);
      expect(authInfo.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('rejects invalid token', async () => {
      await expect(
        provider.verifyAccessToken('invalid-token')
      ).rejects.toThrow('Invalid access token');
    });
  });

  describe('exchangeRefreshToken', () => {
    it('issues new tokens from refresh token', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
        scopes: ['mcp:read'],
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);

      const newTokens = await provider.exchangeRefreshToken(
        testClient, tokens.refresh_token!
      );

      expect(newTokens.access_token).toBeTruthy();
      expect(newTokens.access_token).not.toBe(tokens.access_token);
      expect(newTokens.refresh_token).toBeTruthy();
      expect(newTokens.refresh_token).not.toBe(tokens.refresh_token);
    });

    it('rotates refresh token (old one invalid)', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);

      await provider.exchangeRefreshToken(testClient, tokens.refresh_token!);

      await expect(
        provider.exchangeRefreshToken(testClient, tokens.refresh_token!)
      ).rejects.toThrow('Invalid or expired');
    });

    it('rejects wrong client', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);
      const otherClient = { ...testClient, client_id: 'other-id' };

      await expect(
        provider.exchangeRefreshToken(otherClient, tokens.refresh_token!)
      ).rejects.toThrow('Client ID mismatch');
    });
  });

  describe('revokeToken', () => {
    it('revokes an access token', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);

      await provider.revokeToken!(testClient, {
        token: tokens.access_token,
        token_type_hint: 'access_token',
      });

      await expect(
        provider.verifyAccessToken(tokens.access_token)
      ).rejects.toThrow('Invalid access token');
    });

    it('revokes a refresh token', async () => {
      const res = { redirect: vi.fn() } as any;
      await provider.authorize(testClient, {
        codeChallenge: 'challenge',
        redirectUri: 'https://example.com/callback',
      }, res);

      const code = new URL(res.redirect.mock.calls[0][1]).searchParams.get('code')!;
      const tokens = await provider.exchangeAuthorizationCode(testClient, code);

      await provider.revokeToken!(testClient, {
        token: tokens.refresh_token!,
        token_type_hint: 'refresh_token',
      });

      await expect(
        provider.exchangeRefreshToken(testClient, tokens.refresh_token!)
      ).rejects.toThrow('Invalid or expired');
    });

    it('does nothing for invalid token (per RFC 7009)', async () => {
      await expect(
        provider.revokeToken!(testClient, { token: 'nonexistent' })
      ).resolves.toBeUndefined();
    });
  });
});
