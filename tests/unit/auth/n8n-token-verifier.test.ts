import { describe, it, expect, afterEach, vi } from 'vitest';
import { N8nTokenVerifier } from '../../../src/auth/n8n-token-verifier';

describe('N8nTokenVerifier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns AuthInfo with token and n8nBaseUrl on successful verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    const verifier = new N8nTokenVerifier('https://n8n.example.com');
    const result = await verifier.verifyAccessToken('test-token-123');

    expect(result.token).toBe('test-token-123');
    expect(result.clientId).toBe('n8n-oauth-user');
    expect(result.scopes).toEqual(['tool:listWorkflows', 'tool:getWorkflowDetails']);
    expect(result.extra).toEqual({ n8nBaseUrl: 'https://n8n.example.com' });
  });

  it('calls n8n MCP endpoint with correct method and headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', result: {}, id: 1 }), { status: 200 })
    );

    const verifier = new N8nTokenVerifier('https://n8n.example.com');
    await verifier.verifyAccessToken('my-token');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://n8n.example.com/mcp-server/http',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer my-token',
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: 1,
        }),
      }
    );
  });

  it('strips trailing slashes from base URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', result: {}, id: 1 }), { status: 200 })
    );

    const verifier = new N8nTokenVerifier('https://n8n.example.com///');
    await verifier.verifyAccessToken('token');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://n8n.example.com/mcp-server/http',
      expect.anything()
    );
  });

  it('throws on 401 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    );

    const verifier = new N8nTokenVerifier('https://n8n.example.com');
    await expect(verifier.verifyAccessToken('bad-token'))
      .rejects.toThrow('Invalid or expired n8n access token');
  });

  it('throws on 403 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403 })
    );

    const verifier = new N8nTokenVerifier('https://n8n.example.com');
    await expect(verifier.verifyAccessToken('bad-token'))
      .rejects.toThrow('Invalid or expired n8n access token');
  });

  it('throws on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const verifier = new N8nTokenVerifier('https://n8n.example.com');
    await expect(verifier.verifyAccessToken('token'))
      .rejects.toThrow('Failed to verify token against n8n');
  });
});
