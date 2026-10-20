import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isValidMcpAccessToken, deriveOfficialMcpEndpoint,
  getOfficialMcpConfig, getOfficialMcpConfigFromContext, isOfficialMcpConfigured,
} from '@/config/n8n-api';

// getN8nApiConfig() calls dotenv.config() on its first invocation in this module
// context, which would otherwise repopulate N8N_API_URL/N8N_API_KEY from the
// repo's real .env file after the beforeEach below deletes them. Stub it out so
// the env manipulation in this file is authoritative.
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

const ENV = ['N8N_API_URL', 'N8N_API_KEY', 'N8N_MCP_ACCESS_TOKEN'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); ENV.forEach(k => delete process.env[k]); });
afterEach(() => { ENV.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

describe('isValidMcpAccessToken', () => {
  it('accepts a non-empty token without whitespace', () => { expect(isValidMcpAccessToken('eyJhbGciOi.abc')).toBe(true); });
  it('rejects empty, whitespace, non-string and oversized tokens', () => {
    expect(isValidMcpAccessToken('')).toBe(false);
    expect(isValidMcpAccessToken('a b')).toBe(false);
    expect(isValidMcpAccessToken('a\n')).toBe(false);
    expect(isValidMcpAccessToken(42)).toBe(false);
    expect(isValidMcpAccessToken('x'.repeat(4097))).toBe(false);
  });
});

describe('deriveOfficialMcpEndpoint', () => {
  it('uses the origin only, whatever path the instance URL carries', () => {
    expect(deriveOfficialMcpEndpoint('https://n8n.example.com')).toBe('https://n8n.example.com/mcp-server/http');
    expect(deriveOfficialMcpEndpoint('https://n8n.example.com/api/v1')).toBe('https://n8n.example.com/mcp-server/http');
    expect(deriveOfficialMcpEndpoint('http://localhost:5678/')).toBe('http://localhost:5678/mcp-server/http');
  });
});

describe('getOfficialMcpConfig (env)', () => {
  it('returns null without N8N_API_URL', () => { process.env.N8N_MCP_ACCESS_TOKEN = 'tok'; expect(getOfficialMcpConfig()).toBeNull(); });
  it('returns null without a token', () => { process.env.N8N_API_URL = 'https://n8n.example.com'; process.env.N8N_API_KEY = 'k'; expect(getOfficialMcpConfig()).toBeNull(); expect(isOfficialMcpConfigured()).toBe(false); });
  it('derives the endpoint from N8N_API_URL', () => {
    process.env.N8N_API_URL = 'https://n8n.example.com/api/v1'; process.env.N8N_API_KEY = 'k'; process.env.N8N_MCP_ACCESS_TOKEN = 'tok';
    expect(getOfficialMcpConfig()).toEqual({ endpoint: 'https://n8n.example.com/mcp-server/http', token: 'tok' });
    expect(isOfficialMcpConfigured()).toBe(true);
  });
});

describe('getOfficialMcpConfigFromContext', () => {
  it('returns null when either field is missing or the token is invalid', () => {
    expect(getOfficialMcpConfigFromContext({ n8nApiUrl: 'https://n8n.example.com' })).toBeNull();
    expect(getOfficialMcpConfigFromContext({ n8nMcpAccessToken: 'tok' })).toBeNull();
    expect(getOfficialMcpConfigFromContext({ n8nApiUrl: 'https://n8n.example.com', n8nMcpAccessToken: 'bad token' })).toBeNull();
  });
  it('derives the endpoint from n8nApiUrl', () => {
    expect(getOfficialMcpConfigFromContext({ n8nApiUrl: 'https://n8n.example.com/api/v1', n8nMcpAccessToken: 'tok' }))
      .toEqual({ endpoint: 'https://n8n.example.com/mcp-server/http', token: 'tok' });
  });
});
