import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import zlib from 'zlib';

vi.mock('../../../src/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(function () { return ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }); }),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SingleSessionHTTPServer } from '../../../src/http-server-single-session';

const TOKEN = 'request-body-encoding-test-token-0123456789';

function post(port: number, path: string, body: Buffer, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), ...headers } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('HTTP server request body encoding', () => {
  let server: SingleSessionHTTPServer;
  let port: number;
  const saved = { token: process.env.AUTH_TOKEN, port: process.env.PORT, host: process.env.HOST };
  const json = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));

  beforeAll(async () => {
    process.env.AUTH_TOKEN = TOKEN;
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    server = new SingleSessionHTTPServer();
    await server.start();
    const listening = (server as any).expressServer as http.Server;
    if (!listening.listening) await new Promise((resolve) => listening.once('listening', resolve));
    port = (listening.address() as { port: number }).port;
  });

  afterAll(async () => {
    await server.shutdown();
    vi.restoreAllMocks();
    for (const [key, value] of [['AUTH_TOKEN', saved.token], ['PORT', saved.port], ['HOST', saved.host]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  for (const path of ['/mcp', '/messages']) {
    it(`refuses compressed ${path} bodies with 415 without decompressing them`, async () => {
      const gunzip = vi.spyOn(zlib, 'createGunzip');
      const brotli = vi.spyOn(zlib, 'createBrotliDecompress');
      try {
        expect(await post(port, path, zlib.gzipSync(json), { 'Content-Encoding': 'gzip' })).toBe(415);
        expect(await post(port, path, zlib.brotliCompressSync(json), { 'Content-Encoding': 'br' })).toBe(415);
        expect(gunzip).not.toHaveBeenCalled();
        expect(brotli).not.toHaveBeenCalled();
      } finally {
        gunzip.mockRestore();
        brotli.mockRestore();
      }
    });
  }

  it('still answers 401 to an uncompressed body without a token', async () => {
    expect(await post(port, '/mcp', json, {})).toBe(401);
  });
});
