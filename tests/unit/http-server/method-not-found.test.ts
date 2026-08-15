/**
 * Unit tests for the unimplemented-method guard on the Streamable HTTP transport.
 * Regression tests for #994.
 *
 * The session check used to run before the method was looked at, so any method
 * the server does not implement came back as a session error (-32000). Clients
 * speaking MCP revision 2026-07-28 probe with a session-less `server/discover`
 * and key on -32601 to fall back to the `initialize` handshake.
 *
 * Exercises both entry points: the POST /mcp route (which must answer before the
 * multi-tenant header check) and handleRequest directly (the embedder path).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('dotenv');

// Implementation passed to vi.fn() directly, so vi.clearAllMocks() cannot strip it.
vi.mock('../../../src/mcp/server', () => ({
  N8NDocumentationMCPServer: vi.fn(() => ({
    connect: async () => undefined,
  })),
}));

// Transport mock: reaching it means the guard let the request through.
const { transportHandleRequest, TransportMock, applyTransportMocks } = vi.hoisted(() => {
  const transportHandleRequest = vi.fn();
  const TransportMock = vi.fn();
  // vi.clearAllMocks() strips implementations from vi.fn().mockImplementation
  // mocks in Vitest 3, so both are re-applied in every beforeEach.
  const applyTransportMocks = () => {
    transportHandleRequest.mockImplementation(async (_req: any, res: any) => {
      if (!res.headersSent) {
        res.status(200).json({ jsonrpc: '2.0', result: { reachedTransport: true }, id: 1 });
      }
    });
    TransportMock.mockImplementation((opts: any) => ({
      sessionId: opts?.sessionIdGenerator?.(),
      handleRequest: transportHandleRequest,
      close: vi.fn().mockResolvedValue(undefined),
    }));
  };
  applyTransportMocks();
  return { transportHandleRequest, TransportMock, applyTransportMocks };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: TransportMock,
}));

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

import {
  SingleSessionHTTPServer,
  isImplementedMcpMethod,
} from '../../../src/http-server-single-session';
import * as sdkTypes from '@modelcontextprotocol/sdk/types.js';

const TEST_AUTH_TOKEN = 'test-auth-token-with-more-than-32-characters';

function createMockRes() {
  const headers: Record<string, string> = {};
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value;
    }),
    sendStatus: vi.fn().mockReturnThis(),
    headersSent: false,
    getHeader: (key: string) => headers[key.toLowerCase()],
    on: vi.fn(),
    headers,
  } as any;
}

function createMockReq(body: unknown, headers: Record<string, string> = {}) {
  const req: any = {
    method: 'POST',
    path: '/mcp',
    url: '/mcp',
    headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}`, ...headers },
    body,
    ip: '127.0.0.1',
    get: vi.fn((h: string) => req.headers[h.toLowerCase()]),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return req;
}

describe('Unimplemented JSON-RPC methods return -32601 (#994)', () => {
  const originalEnv = process.env;
  let server: SingleSessionHTTPServer;
  let consoleSpies: any[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AUTH_TOKEN = TEST_AUTH_TOKEN;
    process.env.PORT = '0';
    delete process.env.ENABLE_MULTI_TENANT;

    consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];

    vi.clearAllMocks();
    mockHandlers.get = [];
    mockHandlers.post = [];
    mockHandlers.delete = [];
    mockHandlers.use = [];

    mockConsoleManager.wrapOperation.mockImplementation(async (fn: any) => fn());
    applyTransportMocks();
  });

  afterEach(async () => {
    process.env = originalEnv;
    consoleSpies.forEach(spy => spy.mockRestore());
    if (server) {
      await server.shutdown();
      server = null as any;
    }
  });

  function findPostMcpHandler() {
    const route = mockHandlers.post.find((r: any) => r.path === '/mcp');
    return route ? route.handlers[route.handlers.length - 1] : null;
  }

  async function startServer() {
    server = new SingleSessionHTTPServer();
    await server.start();
    return findPostMcpHandler();
  }

  describe('through the POST /mcp route', () => {
    it('answers a session-less server/discover probe with 404 and -32601', async () => {
      const handler = await startServer();
      const req = createMockReq({ jsonrpc: '2.0', method: 'server/discover', id: 'probe-1', params: {} });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0]).toEqual({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not found: server/discover' },
        id: 'probe-1',
      });
      expect(transportHandleRequest).not.toHaveBeenCalled();
    });

    it('answers 200 and -32601 when a session id is present, leaving the session intact', async () => {
      const handler = await startServer();
      const sessionId = 'existing-session-id';
      const serverAny = server as any;
      serverAny.transports[sessionId] = { handleRequest: transportHandleRequest };
      serverAny.sessionMetadata[sessionId] = { lastAccess: new Date(0), createdAt: new Date(0) };

      const req = createMockReq(
        { jsonrpc: '2.0', method: 'server/discover', id: 7, params: {} },
        { 'mcp-session-id': sessionId }
      );
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0]).toMatchObject({
        error: { code: -32601 },
        id: 7,
      });
      // Session survives untouched: still registered, access time not bumped.
      expect(serverAny.transports[sessionId]).toBeDefined();
      expect(serverAny.sessionMetadata[sessionId].lastAccess).toEqual(new Date(0));
      expect(transportHandleRequest).not.toHaveBeenCalled();
    });

    it('accepts an unimplemented notification with 202 and no body', async () => {
      const handler = await startServer();
      const req = createMockReq({ jsonrpc: '2.0', method: 'server/discover', params: {} });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('preserves a JSON-RPC id of 0 instead of rewriting it to null', async () => {
      const handler = await startServer();
      const req = createMockReq({ jsonrpc: '2.0', method: 'server/discover', id: 0, params: {} });
      const res = createMockRes();

      await handler(req, res);

      expect(res.json.mock.calls[0][0].id).toBe(0);
    });

    it('answers -32601 before the multi-tenant header check rejects the probe', async () => {
      process.env.ENABLE_MULTI_TENANT = 'true';
      const handler = await startServer();
      // A probe carries no x-n8n-url / x-n8n-key, which multi-tenant mode
      // otherwise rejects with -32602 "Multi-tenant headers required".
      const req = createMockReq({ jsonrpc: '2.0', method: 'server/discover', id: 'probe-1' });
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].error.code).toBe(-32601);
    });

    it('does not intercept implemented methods', async () => {
      const handler = await startServer();
      const req = createMockReq({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 1,
      });
      const res = createMockRes();

      await handler(req, res);

      expect(transportHandleRequest).toHaveBeenCalled();
      expect(res.json.mock.calls[0][0]).toMatchObject({ result: { reachedTransport: true } });
    });

    it('leaves batch bodies to the existing handling', async () => {
      const handler = await startServer();
      const req = createMockReq([
        { jsonrpc: '2.0', method: 'server/discover', id: 1 },
        { jsonrpc: '2.0', method: 'tools/list', id: 2 },
      ]);
      const res = createMockRes();

      await handler(req, res);

      // Not classified as an unimplemented method: falls through to the
      // session dispatch, which reports a session error as before.
      const payload = res.json.mock.calls[0][0];
      expect(payload.error.code).toBe(-32000);
    });
  });

  describe('through handleRequest directly (embedder path)', () => {
    it('answers a session-less probe with 404 and -32601', async () => {
      server = new SingleSessionHTTPServer();
      const req = createMockReq({ jsonrpc: '2.0', method: 'server/discover', id: 'probe-1' });
      const res = createMockRes();

      await server.handleRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].error.code).toBe(-32601);
    });

    it('answers before the SSRF gate on an instance-supplied URL', async () => {
      server = new SingleSessionHTTPServer();
      const req = createMockReq({ jsonrpc: '2.0', method: 'server/discover', id: 'probe-1' });
      const res = createMockRes();

      await server.handleRequest(req, res, {
        n8nApiUrl: 'http://169.254.169.254',
        n8nApiKey: 'irrelevant',
      } as any);

      expect(res.json.mock.calls[0][0].error.code).toBe(-32601);
    });
  });

  describe('method surface', () => {
    it.each([
      'initialize',
      'ping',
      'tools/list',
      'tools/call',
      'resources/read',
      'resources/templates/list',
      'prompts/get',
      'completion/complete',
      'logging/setLevel',
      'sampling/createMessage',
      'roots/list',
      'elicitation/create',
      'tasks/get',
      'tasks/result',
      'tasks/cancel',
      'notifications/initialized',
      'notifications/tasks/status',
    ])('treats %s as implemented', method => {
      expect(isImplementedMcpMethod(method)).toBe(true);
    });

    it.each(['server/discover', 'subscriptions/listen', 'foo', 'initialized', 'tool/list'])(
      'treats %s as unimplemented',
      method => {
        expect(isImplementedMcpMethod(method)).toBe(false);
      }
    );

    it('covers every method the installed SDK defines', () => {
      // Drift guard: if an SDK bump introduces a method outside the namespaces
      // the guard knows about, that method would be wrongly answered -32601.
      // This fails loudly at that point so the prefix list gets extended.
      const sdkMethods = Object.values(sdkTypes as Record<string, any>)
        .map(schema => schema?.shape?.method?.value)
        .filter((value): value is string => typeof value === 'string');

      expect(sdkMethods.length).toBeGreaterThan(20);
      expect(sdkMethods.filter(method => !isImplementedMcpMethod(method))).toEqual([]);
    });
  });
});
