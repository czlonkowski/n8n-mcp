import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { SSRFProtection } from '@/utils/ssrf-protection';

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as AddressInfo).port };
}

/** A port nothing listens on: bind one, note it, release it. Guessing `port + 1` races with anything else on the machine. */
async function reserveClosedPort(): Promise<number> {
  const { server, port } = await listen(() => {});
  await new Promise<void>(r => server.close(() => r()));
  return port;
}

let server: http.Server; let port: number;
beforeAll(async () => {
  ({ server, port } = await listen((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ host: req.headers.host })); }));
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('SSRFProtection.createPinnedFetch', () => {
  it('connects to the pinned address regardless of the hostname', async () => {
    const pinned = SSRFProtection.createPinnedFetch([{ address: '127.0.0.1', family: 4 }]);
    try {
      const res = await pinned.fetch(`http://pinned-host.invalid:${port}/probe`, { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ host: `pinned-host.invalid:${port}` });
    } finally { await pinned.close(); }
  });
  it('rejects an empty address list', () => {
    expect(() => SSRFProtection.createPinnedFetch([])).toThrow('at least one validated address');
  });
  it('does not fall back to DNS when the pinned address refuses the connection', async () => {
    const pinned = SSRFProtection.createPinnedFetch([{ address: '127.0.0.1', family: 4 }]);
    const closedPort = await reserveClosedPort();
    try { await expect(pinned.fetch(`http://localhost:${closedPort}/`)).rejects.toThrow(); } finally { await pinned.close(); }
  });

  // Address pinning only constrains the URL the caller validated. Following a
  // 3xx would let the server pick the next request's host, port and path —
  // including another port on the same pinned address, which validateWebhookUrl
  // never saw. The redirect must surface as a plain non-ok response instead.
  it('does not follow redirects', async () => {
    const target = await listen((_req, res) => { res.statusCode = 200; res.end('reached'); });
    const origin = await listen((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${target.port}/`);
      res.end();
    });
    const pinned = SSRFProtection.createPinnedFetch([{ address: '127.0.0.1', family: 4 }]);
    let targetHits = 0;
    target.server.on('request', () => { targetHits++; });
    try {
      const res = await pinned.fetch(`http://127.0.0.1:${origin.port}/mcp-server/http`, { method: 'GET' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`http://127.0.0.1:${target.port}/`);
      await res.arrayBuffer();
      expect(targetHits).toBe(0);
    } finally {
      await pinned.close();
      await new Promise<void>(r => origin.server.close(() => r()));
      await new Promise<void>(r => target.server.close(() => r()));
    }
  });
});
