import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { startFakeOfficialMcp, FakeOfficialMcp } from '../../helpers/fake-official-mcp-server';
import { N8nOfficialMcpClient, probeOfficialMcp, OFFICIAL_MCP_FAILURE_TTL_MS } from '@/services/n8n-official-mcp-client';
import { SSRFProtection } from '@/utils/ssrf-protection';

let savedMode: string | undefined;
beforeAll(() => { savedMode = process.env.WEBHOOK_SECURITY_MODE; process.env.WEBHOOK_SECURITY_MODE = 'moderate'; });
afterAll(() => { if (savedMode === undefined) delete process.env.WEBHOOK_SECURITY_MODE; else process.env.WEBHOOK_SECURITY_MODE = savedMode; });

function spyOnPinnedFetch() {
  const original = SSRFProtection.createPinnedFetch.bind(SSRFProtection);
  let failNext = false;
  const spy = vi.spyOn(SSRFProtection, 'createPinnedFetch').mockImplementation((addresses) => {
    const real = original(addresses);
    return {
      fetch: (url, init) => {
        // A genuine connection-level error: rejects with no HTTP status, the
        // same shape a socket reset or DNS failure produces.
        if (failNext) { failNext = false; return Promise.reject(new Error('simulated socket reset')); }
        return real.fetch(url, init);
      },
      close: () => real.close(),
    };
  });
  return { spy, breakNextFetch: () => { failNext = true; } };
}

describe('N8nOfficialMcpClient', () => {
  let fake: FakeOfficialMcp;
  afterEach(async () => { await fake?.close(); });

  it('lists tools from the fake server with the bearer token', async () => {
    fake = await startFakeOfficialMcp({ token: 'tok', tools: [{ name: 'search_agents' }, { name: 'get_agent' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const caps = await client.capabilities();
    expect(caps.reachable).toBe(true);
    expect(caps.toolNames).toEqual(['search_agents', 'get_agent']);
    expect(caps.agentTools).toBe(true);
    expect(fake.requests.every(r => r.authorization === 'Bearer tok')).toBe(true);
    await client.close();
  });

  it('calls a tool and parses JSON text', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'get_agent', handler: (a) => ({ ok: true, agent: { id: a.agentId } }) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('get_agent', { agentId: 'a1' });
    expect(result.isError).toBe(false);
    expect(result.json).toEqual({ ok: true, agent: { id: 'a1' } });
    expect(result.truncated).toBe(false);
    await client.close();
  });

  it('keeps non-JSON text as text', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'echo', handler: () => 'plain words' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('echo', {});
    expect(result.text).toBe('plain words'); expect(result.json).toBeUndefined();
    await client.close();
  });

  it('marks isError results without throwing', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'mutate_agent', isError: true, handler: () => ({ ok: false, code: 'stale_config' }) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('mutate_agent', {});
    expect(result.isError).toBe(true); expect(result.json).toEqual({ ok: false, code: 'stale_config' });
    await client.close();
  });

  it('truncates oversized results', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'big', handler: () => 'x'.repeat(300 * 1024) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const result = await client.callTool('big', {});
    expect(result.truncated).toBe(true); expect(result.text.length).toBeLessThanOrEqual(256 * 1024 + 64); expect(result.sizeBytes).toBe(300 * 1024);
    await client.close();
  });

  it('maps 401 to OFFICIAL_MCP_AUTH_FAILED', async () => {
    fake = await startFakeOfficialMcp({ token: 'right', tools: [{ name: 'search_agents' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'wrong' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code: 'OFFICIAL_MCP_AUTH_FAILED', status: 401 });
    const caps = await client.capabilities(true);
    expect(caps).toMatchObject({ reachable: false, error: 'OFFICIAL_MCP_AUTH_FAILED' });
    await client.close();
  });

  it.each([
    [{ status: 404, body: 'Not found', contentType: 'text/plain' }, 'OFFICIAL_MCP_NOT_ENABLED'],
    [{ status: 200, body: '<html>n8n</html>', contentType: 'text/html' }, 'OFFICIAL_MCP_NOT_ENABLED'],
    [{ status: 429, body: 'Too many requests', contentType: 'text/plain' }, 'OFFICIAL_MCP_RATE_LIMITED'],
    [{ status: 500, body: 'boom', contentType: 'text/plain' }, 'OFFICIAL_MCP_TRANSPORT_ERROR'],
  ])('maps raw response %j to %s', async (raw, code) => {
    fake = await startFakeOfficialMcp({ raw });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code });
    await client.close();
  });

  // The pinned fetch never follows redirects, so a 3xx reaches the SDK as a
  // non-ok response. The message has to explain that, or "HTTP 302" reads as
  // an unexplained protocol failure.
  it('surfaces a redirect as a transport error that says redirects are not followed', async () => {
    fake = await startFakeOfficialMcp({ raw: { status: 302, body: '', contentType: 'text/plain' } });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({
      code: 'OFFICIAL_MCP_TRANSPORT_ERROR',
      status: 302,
      message: expect.stringContaining('redirects are not followed'),
    });
    await client.close();
  });

  it('maps a request timeout to OFFICIAL_MCP_TIMEOUT', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'call_agent', handler: () => new Promise(r => setTimeout(() => r({ ok: true }), 400)) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await expect(client.callTool('call_agent', {}, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'OFFICIAL_MCP_TIMEOUT' });
    await client.close();
  });

  it('rejects a private endpoint before any request (strict mode)', async () => {
    process.env.WEBHOOK_SECURITY_MODE = 'strict';
    try {
      const client = new N8nOfficialMcpClient({ endpoint: 'http://10.0.0.8/mcp-server/http', token: 'tok' });
      await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code: 'OFFICIAL_MCP_URL_REJECTED' });
      await client.close();
    } finally { process.env.WEBHOOK_SECURITY_MODE = 'moderate'; }
  });

  it('caches capabilities and reference for the TTL', async () => {
    let listCalls = 0;
    fake = await startFakeOfficialMcp({ tools: [{ name: 'get_agent_builder_reference', handler: () => { listCalls++; return { ok: true, guide: '# guide', configSchema: {} }; } }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await client.capabilities(); await client.capabilities();
    const before = fake.requests.length;
    await client.capabilities();
    expect(fake.requests.length).toBe(before);           // served from cache
    await client.reference(); await client.reference();
    expect(listCalls).toBe(1);
    await client.close();
  });

  // A negative probe is cached for 30 s, not the 10 min a success gets: a
  // token that was just fixed, or MCP being switched on in n8n's settings,
  // must not leave every official-MCP-backed tool answering "not reachable"
  // for ten minutes. Only Date is faked here — the transport's own timers and
  // the loopback server keep running for real.
  it('re-probes a failed capabilities result after the short failure TTL', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }], raw: { status: 401, body: '{}', contentType: 'application/json' } });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      expect(await client.capabilities()).toMatchObject({ reachable: false, error: 'OFFICIAL_MCP_AUTH_FAILED' });
      fake.setRaw(undefined);

      const postsAfterFailure = fake.requests.filter(r => r.method === 'POST').length;
      vi.setSystemTime(Date.now() + OFFICIAL_MCP_FAILURE_TTL_MS - 1_000);
      expect(await client.capabilities()).toMatchObject({ reachable: false });          // still inside the failure TTL
      expect(fake.requests.filter(r => r.method === 'POST').length).toBe(postsAfterFailure);

      vi.setSystemTime(Date.now() + 2_000);
      expect(await client.capabilities()).toMatchObject({ reachable: true, toolCount: 1 });   // TTL expired: probed again
    } finally {
      vi.useRealTimers();
      await client.close();
    }
  });

  // A failed reference must not be cached: an instance whose agents module is
  // still starting would otherwise serve that failure as the guide for the
  // whole success TTL.
  it('does not cache a failed reference', async () => {
    let calls = 0;
    fake = await startFakeOfficialMcp({ tools: [{ name: 'get_agent_builder_reference', handler: () => { calls++; return calls === 1 ? { ok: false, code: 'unavailable' } : { ok: true, guide: '# guide' }; } }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    try {
      await expect(client.reference()).rejects.toMatchObject({ code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE' });
      expect(await client.reference()).toMatchObject({ ok: true, guide: '# guide' });   // retried, not served from cache
      expect(calls).toBe(2);
    } finally {
      await client.close();
    }
  });

  it('reconnects once after the transport drops', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    await client.callTool('search_agents', {});
    fake.setRaw({ status: 503, body: 'restarting', contentType: 'text/plain' });
    await expect(client.callTool('search_agents', {})).rejects.toMatchObject({ code: 'OFFICIAL_MCP_TRANSPORT_ERROR' });
    fake.setRaw(undefined);
    const result = await client.callTool('search_agents', {});   // fresh transport, no stale state
    expect(result.isError).toBe(false);
    await client.close();
  });

  // Regression test for review round 1, issue 3: the retry gate used to read
  // `this.caps?.reachable`, which stays null for a client that only ever
  // calls callTool() (never capabilities()) — making the retry dead code for
  // that usage pattern. This exercises a REAL second attempt end to end: the
  // shared client/pinned pair created by the first successful call is made
  // to fail exactly once with a genuine connection-level error (no HTTP
  // status — the same shape a socket reset or DNS failure would produce),
  // and a spy on SSRFProtection.createPinnedFetch proves a second transport
  // was actually created and used within the same callTool() invocation
  // (variant 2 from the review: a real dead keep-alive socket via port reuse
  // was tried first and found non-deterministic on this machine — undici's
  // pool silently opens a fresh connection instead of surfacing an error —
  // so this test forces the failure directly instead).
  it('retries once on a genuine connection failure, using a freshly created transport', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const { spy, breakNextFetch } = spyOnPinnedFetch();
    try {
      const first = await client.callTool('search_agents', {}, { idempotent: true });
      expect(first.isError).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);

      breakNextFetch();   // breaks the next request on the already-connected client
      const requestsBeforeRetry = fake.requests.length;
      const result = await client.callTool('search_agents', {}, { idempotent: true });
      expect(result.isError).toBe(false);
      expect(spy).toHaveBeenCalledTimes(2);                       // a fresh transport was created for the retry
      expect(fake.requests.length).toBeGreaterThan(requestsBeforeRetry); // the retry really hit the server again
    } finally {
      spy.mockRestore();
      await client.close();
    }
  });

  // A dead socket does not prove the request never reached n8n: create_agent,
  // publish_agent and call_agent may already have run. Only a call the caller
  // declares idempotent is re-sent.
  it('does not retry a non-idempotent call after a connection failure', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'create_agent' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const { spy, breakNextFetch } = spyOnPinnedFetch();
    try {
      await client.callTool('create_agent', { name: 'a' }, { idempotent: true });   // establishes the connection
      expect(spy).toHaveBeenCalledTimes(1);

      breakNextFetch();
      const postsBefore = fake.requests.filter(r => r.method === 'POST').length;
      await expect(client.callTool('create_agent', { name: 'b' })).rejects.toMatchObject({ code: 'OFFICIAL_MCP_TRANSPORT_ERROR' });
      expect(spy).toHaveBeenCalledTimes(1);                  // no second transport: the call was not re-sent
      // The discarded transport's own teardown may still send a DELETE; no
      // second POST is what proves the call itself was not repeated.
      expect(fake.requests.filter(r => r.method === 'POST').length).toBe(postsBefore);
    } finally {
      spy.mockRestore();
      await client.close();
    }
  });

  // An HTTP status means the request reached n8n, so even an idempotent call
  // is surfaced rather than re-sent.
  it('does not retry when the failure carries an HTTP status', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    try {
      await client.callTool('search_agents', {}, { idempotent: true });
      fake.setRaw({ status: 503, body: 'restarting', contentType: 'text/plain' });
      const postsBefore = fake.requests.filter(r => r.method === 'POST').length;
      await expect(client.callTool('search_agents', {}, { idempotent: true }))
        .rejects.toMatchObject({ code: 'OFFICIAL_MCP_TRANSPORT_ERROR', status: 503 });
      expect(fake.requests.filter(r => r.method === 'POST').length).toBe(postsBefore + 1);   // exactly one attempt
    } finally {
      await client.close();
    }
  });

  // Regression test for review round 1, issue 4: a single failed call used
  // to unconditionally reset the shared transport, which closes the whole
  // MCP Client and rejects every other in-flight request on it. Two
  // concurrent calls share one connection (connect() coalesces concurrent
  // callers into a single handshake); call A's timeout must not abort call
  // B, which is still waiting on the same transport.
  it('does not let one concurrent call\'s timeout abort another call sharing the transport', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'sleepy', handler: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 300)) }] });
    const client = new N8nOfficialMcpClient({ endpoint: fake.url, token: 'tok' });
    const [a, b] = await Promise.allSettled([
      client.callTool('sleepy', {}, { timeoutMs: 50 }),
      client.callTool('sleepy', {}),
    ]);
    expect(a.status).toBe('rejected');
    if (a.status === 'rejected') expect(a.reason).toMatchObject({ code: 'OFFICIAL_MCP_TIMEOUT' });
    expect(b.status).toBe('fulfilled');
    if (b.status === 'fulfilled') { expect(b.value.isError).toBe(false); expect(b.value.json).toEqual({ ok: true }); }
    await client.close();
  });

  it('probeOfficialMcp returns capabilities from a throwaway client', async () => {
    fake = await startFakeOfficialMcp({ tools: [{ name: 'search_agents' }] });
    const caps = await probeOfficialMcp({ endpoint: fake.url, token: 'tok' });
    expect(caps).toMatchObject({ reachable: true, toolCount: 1, agentTools: true });
    fake.setRaw({ status: 401, body: '{}', contentType: 'application/json' });
    expect(await probeOfficialMcp({ endpoint: fake.url, token: 'tok' })).toMatchObject({ reachable: false, error: 'OFFICIAL_MCP_AUTH_FAILED' });
  });
});
