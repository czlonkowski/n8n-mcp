import http from 'http';
import { AddressInfo } from 'net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface FakeTool { name: string; handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>; isError?: boolean }
export interface FakeOfficialMcpOptions { tools?: FakeTool[]; token?: string; raw?: { status: number; body: string; contentType?: string } }
export interface FakeOfficialMcp {
  url: string;
  requests: Array<{ method: string; authorization?: string }>;
  setRaw(raw: FakeOfficialMcpOptions['raw'] | undefined): void;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); try { resolve(text ? JSON.parse(text) : undefined); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

export async function startFakeOfficialMcp(opts: FakeOfficialMcpOptions = {}): Promise<FakeOfficialMcp> {
  let raw = opts.raw;
  const requests: FakeOfficialMcp['requests'] = [];
  const mcp = new McpServer({ name: 'fake-n8n', version: '0.0.0' });
  for (const tool of opts.tools ?? []) {
    // A raw-shape inputSchema turns into a strict zod object that strips any key not
    // declared in the shape, which would silently drop the arguments callers pass in
    // (e.g. { id: 'agent-42' }). Passing an already-built passthrough object schema
    // keeps normalizeObjectSchema's "already an object schema" path and lets arbitrary
    // arguments flow through untouched — good enough for a test fake with no real schema.
    mcp.registerTool<any, any>(tool.name, { description: `fake ${tool.name}`, inputSchema: z.object({}).passthrough() as any }, async (args: any) => {
      const typedArgs = args as Record<string, unknown>;
      const value = tool.handler ? await tool.handler(typedArgs) : { ok: true, tool: tool.name, args: typedArgs };
      return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: tool.isError === true };
    });
  }
  // Stateless: no session id, plain JSON responses (no SSE) so tests stay simple.
  // SDK 1.30 stateless transports are single-use ("Stateless transport cannot be reused
  // across requests") — each HTTP request gets its own transport connected to the same
  // McpServer, then the transport is closed (which detaches it from the server) once the
  // request completes. GET is rejected with 405 up front: the real official server doesn't
  // offer a standalone SSE stream either, and the SDK client treats 405 on GET as "no
  // stream" rather than an error, so this keeps the single-transport-at-a-time model simple.
  let currentTransport: StreamableHTTPServerTransport | undefined;

  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method || '', authorization: req.headers.authorization });
    if (raw) { res.statusCode = raw.status; res.setHeader('content-type', raw.contentType ?? 'text/html'); res.end(raw.body); return; }
    if (opts.token !== undefined && req.headers.authorization !== `Bearer ${opts.token}`) {
      res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: 'Unauthorized' })); return;
    }
    if (req.method === 'GET') { res.statusCode = 405; res.end(); return; }
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    currentTransport = transport;
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally {
      await transport.close();
      if (currentTransport === transport) currentTransport = undefined;
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp-server/http`,
    requests,
    setRaw: r => { raw = r; },
    close: async () => { await currentTransport?.close(); await mcp.close(); await new Promise<void>(r => server.close(() => r())); },
  };
}
