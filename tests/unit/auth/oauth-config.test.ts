import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAuthMode, loadOAuthConfig, fetchN8nOAuthMetadata } from '../../../src/auth/oauth-config';

describe('loadAuthMode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to "token" when AUTH_MODE is not set', () => {
    delete process.env.AUTH_MODE;
    expect(loadAuthMode()).toBe('token');
  });

  it('returns "oauth" when AUTH_MODE=oauth', () => {
    process.env.AUTH_MODE = 'oauth';
    expect(loadAuthMode()).toBe('oauth');
  });

  it('returns "both" when AUTH_MODE=both', () => {
    process.env.AUTH_MODE = 'both';
    expect(loadAuthMode()).toBe('both');
  });

  it('is case-insensitive', () => {
    process.env.AUTH_MODE = 'OAuth';
    expect(loadAuthMode()).toBe('oauth');
  });

  it('falls back to "token" for invalid values', () => {
    process.env.AUTH_MODE = 'invalid';
    expect(loadAuthMode()).toBe('token');
  });
});

describe('loadOAuthConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null for token mode', () => {
    expect(loadOAuthConfig('token')).toBeNull();
  });

  it('throws when OAUTH_ISSUER_URL is missing in oauth mode', () => {
    delete process.env.OAUTH_ISSUER_URL;
    expect(() => loadOAuthConfig('oauth')).toThrow('OAUTH_ISSUER_URL is required');
  });

  it('throws when OAUTH_ISSUER_URL is invalid', () => {
    process.env.OAUTH_ISSUER_URL = 'not-a-url';
    expect(() => loadOAuthConfig('oauth')).toThrow('not a valid URL');
  });

  it('loads base config with defaults', () => {
    process.env.OAUTH_ISSUER_URL = 'https://n8n.example.com';
    delete process.env.OAUTH_SERVER_URL;

    const config = loadOAuthConfig('oauth');
    expect(config).not.toBeNull();
    expect(config!.issuerUrl).toBe('https://n8n.example.com');
    expect(config!.serverUrl).toMatch(/^http:\/\//);
  });

  it('does not include scopesSupported (comes from n8n metadata)', () => {
    process.env.OAUTH_ISSUER_URL = 'https://n8n.example.com';
    const config = loadOAuthConfig('oauth');
    expect(config).not.toHaveProperty('scopesSupported');
    expect(config).not.toHaveProperty('n8nOAuthMetadata');
  });

  it('uses OAUTH_SERVER_URL when provided', () => {
    process.env.OAUTH_ISSUER_URL = 'https://n8n.example.com';
    process.env.OAUTH_SERVER_URL = 'https://server.example.com';

    const config = loadOAuthConfig('both');
    expect(config!.serverUrl).toBe('https://server.example.com');
  });
});

describe('fetchN8nOAuthMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns valid metadata', async () => {
    const mockMetadata = {
      issuer: 'https://n8n.example.com',
      authorization_endpoint: 'https://n8n.example.com/mcp-oauth/authorize',
      token_endpoint: 'https://n8n.example.com/mcp-oauth/token',
      registration_endpoint: 'https://n8n.example.com/mcp-oauth/register',
      response_types_supported: ['code'],
      scopes_supported: ['tool:listWorkflows', 'tool:getWorkflowDetails'],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockMetadata), { status: 200 })
    );

    const result = await fetchN8nOAuthMetadata('https://n8n.example.com');
    expect(result.issuer).toBe('https://n8n.example.com');
    expect(result.authorization_endpoint).toBe('https://n8n.example.com/mcp-oauth/authorize');
    expect(result.scopes_supported).toEqual(['tool:listWorkflows', 'tool:getWorkflowDetails']);
  });

  it('throws on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );

    await expect(fetchN8nOAuthMetadata('https://n8n.example.com'))
      .rejects.toThrow('Failed to fetch OAuth metadata');
  });

  it('throws on missing required fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ issuer: 'https://n8n.example.com' }), { status: 200 })
    );

    await expect(fetchN8nOAuthMetadata('https://n8n.example.com'))
      .rejects.toThrow('missing required fields');
  });

  it('strips trailing slash from issuer URL', async () => {
    const mockMetadata = {
      issuer: 'https://n8n.example.com',
      authorization_endpoint: 'https://n8n.example.com/mcp-oauth/authorize',
      token_endpoint: 'https://n8n.example.com/mcp-oauth/token',
      response_types_supported: ['code'],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockMetadata), { status: 200 })
    );

    await fetchN8nOAuthMetadata('https://n8n.example.com/');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://n8n.example.com/.well-known/oauth-authorization-server'
    );
  });
});
