import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SingleSessionHTTPServer } from '../../../src/http-server-single-session';
import { logger } from '../../../src/utils/logger';

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('dotenv');

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-session-id-1234-5678-9012-345678901234'),
}));

const mockTransports: { [key: string]: any } = {};

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options: any) => {
    const mockTransport = {
      handleRequest: vi.fn().mockImplementation(async (req: any, res: any, body?: any) => {
        if (body && body.method === 'initialize') {
          res.setHeader('Mcp-Session-Id', mockTransport.sessionId || 'test-session-id');
        }
        res.status(200).json({
          jsonrpc: '2.0',
          result: { success: true },
          id: body?.id || 1,
        });
      }),
      close: vi.fn().mockResolvedValue(undefined),
      sessionId: null as string | null,
      onclose: null as (() => void) | null,
    };
    if (options?.sessionIdGenerator) {
      const sessionId = options.sessionIdGenerator();
      mockTransport.sessionId = sessionId;
      mockTransports[sessionId] = mockTransport;
    }
    return mockTransport;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: class {
    sessionId = 'sse-test';
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../../src/mcp/server', () => ({
  N8NDocumentationMCPServer: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../../src/utils/console-manager', () => ({
  ConsoleManager: vi.fn(() => ({
    wrapOperation: vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn()),
  })),
}));

vi.mock('../../../src/utils/url-detector', () => ({
  getStartupBaseUrl: vi.fn(() => 'http://localhost:3000'),
  formatEndpointUrls: vi.fn(() => ({ health: '/health', mcp: '/mcp' })),
  detectBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('../../../src/utils/version', () => ({
  PROJECT_VERSION: '2.47.11',
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: vi.fn((request: any) => request && request.method === 'initialize'),
}));

const mockHandlers: { [key: string]: any[] } = { get: [], post: [], delete: [], use: [] };

vi.mock('express', () => {
  const mockExpressApp = {
    get: vi.fn((path: string, ...handlers: any[]) => {
      mockHandlers.get.push({ path, handlers });
      return mockExpressApp;
    }),
    post: vi.fn((path: string, ...handlers: any[]) => {
      mockHandlers.post.push({ path, handlers });
      return mockExpressApp;
    }),
    delete: vi.fn((path: string, ...handlers: any[]) => {
      mockHandlers.delete.push({ path, handlers });
      return mockExpressApp;
    }),
    use: vi.fn((handler: any) => {
      mockHandlers.use.push(handler);
      return mockExpressApp;
    }),
    set: vi.fn(),
    listen: vi.fn((port: number, host: string, callback?: () => void) => {
      if (callback) callback();
      return { on: vi.fn(), close: vi.fn((cb: () => void) => cb()), address: () => ({ port: 3000 }) };
    }),
  };

  interface ExpressMock {
    (): typeof mockExpressApp;
    json(): (req: any, res: any, next: any) => void;
  }

  const expressMock = vi.fn(() => mockExpressApp) as unknown as ExpressMock;
  expressMock.json = vi.fn(() => (req: any, res: any, next: any) => {
    req.body = req.body || {};
    next();
  });

  return { default: expressMock, Request: {}, Response: {}, NextFunction: {} };
});

const CANARY_AUTH = 'CANARY_AUTH_TEST_abc123';
const CANARY_KEY = 'CANARY_N8N_KEY_TEST_def456';
const CANARY_BODY = 'CANARY_BODY_TEST_ghi789';
const CANARIES = [CANARY_AUTH, CANARY_KEY, CANARY_BODY];

function findHandler(method: 'get' | 'post' | 'delete', path: string) {
  const route = mockHandlers[method].find((r: any) => r.path === path);
  return route ? route.handlers[route.handlers.length - 1] : null;
}

function createMockReqRes() {
  const headers: { [key: string]: string } = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn((key: string, value: string) => {
      headers[key.toLowerCase()] = value;
    }),
    sendStatus: vi.fn().mockReturnThis(),
    headersSent: false,
    finished: false,
    statusCode: 200,
    getHeader: (key: string) => headers[key.toLowerCase()],
    headers,
  };
  const req = {
    method: 'POST',
    path: '/mcp',
    url: '/mcp',
    originalUrl: '/mcp',
    headers: {} as Record<string, string>,
    body: {},
    ip: '127.0.0.1',
    readable: true,
    readableEnded: false,
    complete: true,
    get: vi.fn((header: string) => (req.headers as Record<string, string>)[header.toLowerCase()]),
  } as any;
  return { req, res };
}

function serializeAllLoggerCalls(): string {
  const calls: Array<{ level: string; args: any[] }> = [];
  (['info', 'warn', 'debug', 'error'] as const).forEach((level) => {
    const mock = (logger as any)[level] as ReturnType<typeof vi.fn>;
    for (const call of mock.mock.calls) {
      calls.push({ level, args: call });
    }
  });
  return JSON.stringify(calls);
}

describe('POST /mcp log redaction', () => {
  const originalEnv = process.env;
  const TEST_AUTH_TOKEN = 'test-auth-token-with-more-than-32-characters';
  let server: SingleSessionHTTPServer;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AUTH_TOKEN = TEST_AUTH_TOKEN;
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';

    vi.clearAllMocks();
    mockHandlers.get = [];
    mockHandlers.post = [];
    mockHandlers.delete = [];
    mockHandlers.use = [];
    Object.keys(mockTransports).forEach((k) => delete mockTransports[k]);
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (server) {
      await server.shutdown();
      server = null as any;
    }
  });

  it('does not log request headers or body on unauthenticated POST /mcp', async () => {
    server = new SingleSessionHTTPServer();
    await server.start();

    const handler = findHandler('post', '/mcp');
    expect(handler).toBeTruthy();

    const { req, res } = createMockReqRes();
    req.headers = {
      authorization: `Bearer ${CANARY_AUTH}`,
      'x-n8n-key': CANARY_KEY,
      'content-type': 'application/json',
    };
    req.body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: CANARY_BODY, version: '1.0.0' } },
    };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);

    const serialized = serializeAllLoggerCalls();
    for (const canary of CANARIES) {
      expect(serialized).not.toContain(canary);
    }
  });

  it('does not log body payload on authenticated POST /mcp', async () => {
    server = new SingleSessionHTTPServer();
    await server.start();

    const handler = findHandler('post', '/mcp');
    expect(handler).toBeTruthy();

    const { req, res } = createMockReqRes();
    req.headers = {
      authorization: `Bearer ${TEST_AUTH_TOKEN}`,
      'x-n8n-key': CANARY_KEY,
      'content-type': 'application/json',
    };
    req.body = {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { clientInfo: { name: CANARY_BODY, version: '1.0.0' } },
    };

    await handler(req, res);
    await new Promise((r) => setTimeout(r, 10));

    const serialized = serializeAllLoggerCalls();
    expect(serialized).not.toContain(CANARY_KEY);
    expect(serialized).not.toContain(CANARY_BODY);
    expect(serialized).not.toContain(TEST_AUTH_TOKEN);
  });
});
