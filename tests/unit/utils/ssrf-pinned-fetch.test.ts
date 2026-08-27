import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { SSRFProtection } from '@/utils/ssrf-protection';

let server: http.Server; let port: number;
beforeAll(async () => {
  server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ host: req.headers.host })); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
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
    const closedPort = port + 1; // nothing listens here
    try { await expect(pinned.fetch(`http://localhost:${closedPort}/`)).rejects.toThrow(); } finally { await pinned.close(); }
  });
});
