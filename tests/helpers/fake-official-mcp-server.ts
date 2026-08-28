import http from 'http';
import { AddressInfo } from 'net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/**
 * `structured` makes the tool answer with `structuredContent` as well as text.
 * It requires an `outputSchema` on the registration (the SDK only emits
 * structuredContent for tools that declare one), so the tool is registered
 * with a passthrough object schema when `outputSchema` is not given.
 *
 * `outputSchema` declares a real shape instead, as a zod raw shape (what
 * `McpServer.registerTool` accepts; the SDK converts it to the JSON Schema the
 * client sees in `listTools`). Use it to reproduce n8n's tools, which advertise
 * a success-only schema and then answer refusals with a different payload —
 * note the server skips its own output validation for `isError` results, so
 * such a mismatch does reach the wire.
 */
export interface FakeTool {
  name: string;
  handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  /** A function is evaluated per call, so one tool can refuse once and then succeed. */
  isError?: boolean | ((args: Record<string, unknown>) => boolean);
  structured?: (args: Record<string, unknown>) => unknown;
  outputSchema?: Record<string, z.ZodTypeAny>;
}
/**
 * A JSON-RPC error to answer one method with, instead of dispatching it to the
 * McpServer. Needed because `McpServer` converts every failure inside a tool
 * callback into an `isError` result, so a fake tool can never produce a real
 * protocol-level error on the wire.
 */
export interface FakeJsonRpcError { method: string; code: number; message: string }
export interface FakeOfficialMcpOptions {
  tools?: FakeTool[];
  token?: string;
  raw?: { status: number; body: string; contentType?: string };
  jsonRpcError?: FakeJsonRpcError;
}
export interface FakeOfficialMcp {
  url: string;
  requests: Array<{ method: string; authorization?: string }>;
  /** Names of the tools invoked so far, in order — one entry per tools/call POST that reached a registered tool. */
  toolCalls: string[];
  setRaw(raw: FakeOfficialMcpOptions['raw'] | undefined): void;
  setJsonRpcError(err: FakeJsonRpcError | undefined): void;
  close(): Promise<void>;
}

// Distinguishes a malformed request body (400) from anything else that goes wrong
// while handling a request (500) in the top-level catch below.
class BodyParseError extends Error {}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : undefined); }
      catch (e) { reject(new BodyParseError(e instanceof Error ? e.message : String(e))); }
    });
    req.on('error', reject);
  });
}

export async function startFakeOfficialMcp(opts: FakeOfficialMcpOptions = {}): Promise<FakeOfficialMcp> {
  let raw = opts.raw;
  let jsonRpcError = opts.jsonRpcError;
  const requests: FakeOfficialMcp['requests'] = [];
  const toolCalls: string[] = [];

  // A fresh McpServer per request (see below) needs the same tools registered
  // each time; factored out so registration logic lives in one place.
  function createMcpServer(): McpServer {
    const mcp = new McpServer({ name: 'fake-n8n', version: '0.0.0' });
    for (const tool of opts.tools ?? []) {
      // A raw-shape inputSchema turns into a strict zod object that strips any key not
      // declared in the shape, which would silently drop the arguments callers pass in
      // (e.g. { id: 'agent-42' }). Passing an already-built passthrough object schema
      // keeps normalizeObjectSchema's "already an object schema" path and lets arbitrary
      // arguments flow through untouched — good enough for a test fake with no real schema.
      const config: any = { description: `fake ${tool.name}`, inputSchema: z.object({}).passthrough() as any };
      if (tool.outputSchema) config.outputSchema = tool.outputSchema as any;
      else if (tool.structured) config.outputSchema = z.object({}).passthrough() as any;
      mcp.registerTool<any, any>(tool.name, config, async (args: any) => {
        const typedArgs = args as Record<string, unknown>;
        toolCalls.push(tool.name);
        const value = tool.handler ? await tool.handler(typedArgs) : { ok: true, tool: tool.name, args: typedArgs };
        return {
          content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
          ...(tool.structured ? { structuredContent: tool.structured(typedArgs) as Record<string, unknown> } : {}),
          isError: typeof tool.isError === 'function' ? tool.isError(typedArgs) === true : tool.isError === true,
        };
      });
    }
    return mcp;
  }

  // Stateless: no session id, plain JSON responses (no SSE) so tests stay simple.
  // SDK 1.30 stateless transports are single-use ("Stateless transport cannot be reused
  // across requests"), and a single McpServer only supports one connected transport at a
  // time (Server.connect() throws "Already connected to a transport" on a second call) —
  // so each HTTP request gets its OWN McpServer + transport pair, closed once the request
  // completes. This also lets genuinely concurrent requests (e.g. two overlapping tool
  // calls from the same client) be served independently instead of racing on a shared
  // McpServer.connect(). GET is rejected with 405 up front: the real official server
  // doesn't offer a standalone SSE stream either, and the SDK client treats 405 on GET as
  // "no stream" rather than an error, so this keeps the per-request model simple.
  const activeTransports = new Set<StreamableHTTPServerTransport>();

  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method || '', authorization: req.headers.authorization });
    // Several paths answer before the request stream is consumed (raw, 401, 405), and
    // an unconsumed stream that errors would otherwise emit an unhandled 'error' event
    // and crash the process. Attach a no-op handler to every request up front; readBody
    // adds its own rejecting listener for the paths that do read the body.
    req.on('error', () => {});
    try {
      if (raw) { res.statusCode = raw.status; res.setHeader('content-type', raw.contentType ?? 'text/html'); res.end(raw.body); return; }
      if (opts.token !== undefined && req.headers.authorization !== `Bearer ${opts.token}`) {
        res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: 'Unauthorized' })); return;
      }
      if (req.method === 'GET') { res.statusCode = 405; res.end(); return; }
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const rpc = body as { id?: unknown; method?: string } | undefined;
      if (jsonRpcError && rpc?.method === jsonRpcError.method) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: jsonRpcError.code, message: jsonRpcError.message } }));
        return;
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = createMcpServer();
      activeTransports.add(transport);
      try {
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
      } finally {
        activeTransports.delete(transport);
        await transport.close();
        await mcp.close();
      }
    } catch (e) {
      // Fail closed: whatever went wrong (a malformed body, a transport error, ...),
      // always answer and end the response so the socket closes — an unanswered
      // request here would hang server.close()/fake.close() forever, and an
      // unhandled rejection from this listener is fatal in a bare vitest process.
      if (!res.headersSent) {
        res.statusCode = e instanceof BodyParseError ? 400 : 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ message: e instanceof Error ? e.message : 'Internal error' }));
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp-server/http`,
    requests,
    toolCalls,
    setRaw: r => { raw = r; },
    setJsonRpcError: e => { jsonRpcError = e; },
    close: async () => {
      await Promise.all([...activeTransports].map(t => t.close().catch(() => undefined)));
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}
