/**
 * Integration tests for URL validation in SingleSessionHTTPServer.handleRequest.
 * Regression tests for GHSA-4ggg-h7ph-26qr.
 *
 * Exercises the sync and async validation layers through the real
 * handleRequest codepath, with dns/promises mocked deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock DNS BEFORE importing anything that might load ssrf-protection.
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('dotenv');

vi.mock('../../../src/mcp/server', () => ({
  N8NDocumentationMCPServer: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Transport mock: if the gate allows the request through, respond 200.
// Tests use this as the "gate passed, transport reached" signal.
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    handleRequest: vi.fn().mockImplementation(async (_req: any, res: any) => {
      if (!res.headersSent) {
        res.status(200).json({ jsonrpc: '2.0', result: { success: true }, id: 1 });
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Use vi.hoisted so the mock consoleManager exists at import-time, avoiding
// the TDZ when the vi.mock factory runs before the const is initialized.
const { mockConsoleManager } = vi.hoisted(() => ({
  mockConsoleManager: {
    wrapOperation: vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn()),
  },
}));

vi.mock('../../../src/utils/console-manager', () => ({
  ConsoleManager: vi.fn(() => mockConsoleManager),
}));

vi.mock('../../../src/utils/url-detector', () => ({
  getStartupBaseUrl: vi.fn(() => 'http://localhost:3000'),
  formatEndpointUrls: vi.fn(() => ({ health: '', mcp: '' })),
  detectBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('../../../src/utils/version', () => ({
  PROJECT_VERSION: '2.47.4',
}));

const mockHandlers: Record<string, any[]> = {
  get: [],
  post: [],
  delete: [],
  use: [],
};

vi.mock('express', () => {
  const mockApp = {
    get: vi.fn((path: string, ...handlers: any[]) => {
      mockHandlers.get.push({ path, handlers });
      return mockApp;
    }),
    post: vi.fn((path: string, ...handlers: any[]) => {
      mockHandlers.post.push({ path, handlers });
      return mockApp;
    }),
    delete: vi.fn((path: string, ...handlers: any[]) => {
      mockHandlers.delete.push({ path, handlers });
      return mockApp;
    }),
    use: vi.fn((handler: any) => {
      mockHandlers.use.push(handler);
      return mockApp;
    }),
    set: vi.fn(),
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
      if (cb) cb();
      return {
        on: vi.fn(),
        close: (callback: () => void) => callback(),
        address: () => ({ port: 3000 }),
      };
    }),
  };

  interface ExpressMock {
    (): typeof mockApp;
    json(): (req: any, res: any, next: any) => void;
  }
  const expressMock = vi.fn(() => mockApp) as unknown as ExpressMock;
  expressMock.json = vi.fn(() => (_req: any, _res: any, next: any) => next());

  return {
    default: expressMock,
    Request: {},
    Response: {},
    NextFunction: {},
  };
});

import { SingleSessionHTTPServer } from '../../../src/http-server-single-session';
import * as dns from 'dns/promises';

describe('HTTP Server instance URL validation (GHSA-4ggg-h7ph-26qr)', () => {
  const originalEnv = process.env;
  const TEST_AUTH_TOKEN = 'test-auth-token-with-more-than-32-characters';
  let server: SingleSessionHTTPServer;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AUTH_TOKEN = TEST_AUTH_TOKEN;
    process.env.PORT = '0';
    // These tests assert default-strict behavior; clear any test-env override.
    delete process.env.WEBHOOK_SECURITY_MODE;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.clearAllMocks();
    mockHandlers.get = [];
    mockHandlers.post = [];
    mockHandlers.delete = [];
    mockHandlers.use = [];

    // Re-install wrapOperation implementation after clearAllMocks (Vitest 3
    // clears implementations via clearAllMocks on vi.fn().mockImplementation
    // mocks — need to re-apply every beforeEach).
    mockConsoleManager.wrapOperation.mockImplementation(async (fn: any) => fn());

    // Default DNS mock: public IP 8.8.8.8 for any hostname; IP literals resolve to themselves.
    vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
      if (hostname === 'localhost') return { address: '127.0.0.1', family: 4 } as any;
      const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipv4.test(hostname)) return { address: hostname, family: 4 } as any;
      return { address: '8.8.8.8', family: 4 } as any;
    });
  });

  afterEach(async () => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (server) {
      await server.shutdown();
      server = null as any;
    }
  });

  function findHandler(method: 'get' | 'post' | 'delete', path: string) {
    const routes = mockHandlers[method];
    const route = routes.find((r: any) => r.path === path);
    return route ? route.handlers[route.handlers.length - 1] : null;
  }

  function createMockReqRes() {
    const headers: Record<string, string> = {};
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      setHeader: vi.fn((key: string, value: string) => {
        headers[key.toLowerCase()] = value;
      }),
      sendStatus: vi.fn().mockReturnThis(),
      headersSent: false,
      getHeader: (key: string) => headers[key.toLowerCase()],
      on: vi.fn(),
      headers,
    };
    const req: any = {
      method: 'POST',
      path: '/mcp',
      url: '/mcp',
      headers: {} as Record<string, string>,
      body: {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ssrf-test', version: '1.0' },
        },
        id: 1,
      },
      ip: '127.0.0.1',
      get: vi.fn((h: string) => (req.headers as Record<string, string>)[h.toLowerCase()]),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    return { req, res };
  }

  function assertSsrfRejection(res: any) {
    expect(res.status).toHaveBeenCalledWith(400);
    const jsonArgs = (res.json as any).mock.calls[0][0];
    expect(jsonArgs).toMatchObject({
      jsonrpc: '2.0',
      error: {
        code: -32602,
        message: 'Invalid instance configuration',
      },
    });
  }

  describe('sync validation at the route handler', () => {
    it('rejects x-n8n-url with trailing fragment', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://169.254.169.254#',
        'x-n8n-key': 'attacker-key',
        'x-instance-id': 'attacker',
      };
      await handler(req, res);

      assertSsrfRejection(res);
      // Sync validation catches this without DNS.
      expect(vi.mocked(dns.lookup)).not.toHaveBeenCalled();
    });

    it('rejects x-n8n-url with cloud metadata IP literal', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://169.254.169.254',
        'x-n8n-key': 'attacker-key',
      };
      await handler(req, res);

      assertSsrfRejection(res);
    });

    it('rejects x-n8n-url with private IPv4 literal in default strict mode', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://10.0.0.1',
        'x-n8n-key': 'attacker-key',
      };
      await handler(req, res);

      assertSsrfRejection(res);
    });

    it('rejects x-n8n-url with userinfo', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://user:pw@evil.example.com',
        'x-n8n-key': 'attacker-key',
      };
      await handler(req, res);

      assertSsrfRejection(res);
    });
  });

  describe('async DNS check inside handleRequest', () => {
    it('rejects hostname that DNS-resolves to cloud metadata IP', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '169.254.169.254', family: 4 } as any);

      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://evil.example.com',
        'x-n8n-key': 'attacker-key',
      };
      await handler(req, res);

      assertSsrfRejection(res);
      expect(vi.mocked(dns.lookup)).toHaveBeenCalled();
    });

    it('rejects hostname that DNS-resolves to private IP in strict mode', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '10.0.0.1', family: 4 } as any);

      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://internal.example.com',
        'x-n8n-key': 'attacker-key',
      };
      await handler(req, res);

      assertSsrfRejection(res);
    });

    it('allows legitimate public URL through the gate', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '8.8.8.8', family: 4 } as any);

      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'https://n8n.example.com',
        'x-n8n-key': 'valid-key',
      };
      await handler(req, res);

      // Must not produce a 400 rejection for a legitimate public URL.
      expect(res.status).not.toHaveBeenCalledWith(400);
    });
  });

  describe('handler behavior preserved', () => {
    it('no multi-tenant headers → no DNS calls, no 400', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };
      await handler(req, res);

      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(vi.mocked(dns.lookup)).not.toHaveBeenCalled();
    });

    it('only x-n8n-url without x-n8n-key still runs sync validation on the URL', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'http://169.254.169.254#',
      };
      await handler(req, res);

      assertSsrfRejection(res);
    });
  });

  describe('GHSA-jxx9-px88-pj69, GHSA-2cf7-hpwf-47h9 — multi-tenant header omission', () => {
    beforeEach(() => {
      process.env.ENABLE_MULTI_TENANT = 'true';
      // Process-level credentials must not leak to tenants even when set.
      process.env.N8N_API_URL = 'https://operator-n8n.example.com';
      process.env.N8N_API_KEY = 'operator-api-key';
    });

    it('rejects request with no tenant headers in multi-tenant mode', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArgs = (res.json as any).mock.calls[0][0];
      expect(jsonArgs).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Multi-tenant headers required',
        },
      });
    });

    it('rejects with no headers even when partial-context validation would pass', async () => {
      // Defense-in-depth: the no-headers gate runs before validateInstanceContext,
      // so an attacker cannot avoid 400 by also omitting other optional headers.
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-instance-id': 'attacker-only-instance-id',
      };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects request with only the url tenant header', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'https://tenant-n8n.example.com',
      };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArgs = (res.json as any).mock.calls[0][0];
      expect(jsonArgs).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Multi-tenant headers required',
        },
      });
    });

    it('rejects request with only the key tenant header', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-key': 'tenant-api-key',
      };
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArgs = (res.json as any).mock.calls[0][0];
      expect(jsonArgs).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Multi-tenant headers required',
        },
      });
    });

    it('allows request with both tenant headers in multi-tenant mode', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const handler = findHandler('post', '/mcp');
      const { req, res } = createMockReqRes();
      req.headers = {
        authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'x-n8n-url': 'https://tenant-n8n.example.com',
        'x-n8n-key': 'tenant-api-key',
      };
      await handler(req, res);

      // Must not be a 400; the transport mock then returns 200.
      expect(res.status).not.toHaveBeenCalledWith(400);
    });
  });

  describe('library API path', () => {
    it('rejects malicious context passed directly to handleRequest', async () => {
      vi.mocked(dns.lookup).mockResolvedValue({ address: '169.254.169.254', family: 4 } as any);

      server = new SingleSessionHTTPServer();
      await server.start();

      const { req, res } = createMockReqRes();
      req.headers = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };

      await server.handleRequest(req as any, res as any, {
        n8nApiUrl: 'http://evil.example.com',
        n8nApiKey: 'attacker-key',
        instanceId: 'lib-api-attacker',
      });

      assertSsrfRejection(res);
    });

    it('rejects fragment-laden context passed directly to handleRequest', async () => {
      server = new SingleSessionHTTPServer();
      await server.start();

      const { req, res } = createMockReqRes();
      req.headers = { authorization: `Bearer ${TEST_AUTH_TOKEN}` };

      await server.handleRequest(req as any, res as any, {
        n8nApiUrl: 'http://169.254.169.254#',
        n8nApiKey: 'attacker-key',
      });

      assertSsrfRejection(res);
    });
  });
});
