import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { N8NMCPEngine } from '../../../src/mcp-engine';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import * as n8nHandlers from '../../../src/mcp/handlers-n8n-manager';
import { SSRFProtection } from '../../../src/utils/ssrf-protection';
import { UIAppRegistry } from '../../../src/mcp/ui/registry';
import { runWithRequestContext } from '../../../src/utils/request-context';
import type { InstanceContext } from '../../../src/types/instance-context';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

const contexts: Record<string, InstanceContext> = {
  a: { instanceId: 'tenant-a', n8nApiUrl: 'https://a.example.com', n8nApiKey: 'key-a' },
  b: { instanceId: 'tenant-b', n8nApiUrl: 'https://b.example.com', n8nApiKey: 'key-b' },
  'a-rotated': { instanceId: 'tenant-a', n8nApiUrl: 'https://a.example.com', n8nApiKey: 'key-a2', uiAppsEnabled: false },
  'b-cards-off': { instanceId: 'tenant-b', n8nApiUrl: 'https://b.example.com', n8nApiKey: 'key-b', uiAppsEnabled: false },
  'key-only': { n8nApiKey: 'key-x' },
  'no-instance-id': { n8nApiUrl: 'https://a.example.com', n8nApiKey: 'key-x' },
};

const describeContext = (context?: InstanceContext) =>
  `${context?.instanceId}|${context?.n8nApiUrl}|${context?.n8nApiKey}`;

describe('instance context per request', () => {
  let listener: HttpServer;
  let url: string;
  let engine: N8NMCPEngine;
  let gate: { entered: Promise<void>; release: () => void } | null = null;
  let requestId = 0;
  let ensureInitialized: ReturnType<typeof vi.spyOn>;

  const post = async (contextName: string, sessionId: string | undefined, method: string, params: unknown) => {
    const isNotification = method.startsWith('notifications/');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-test-context': contextName,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(isNotification ? {} : { id: ++requestId }) }),
    });
    const text = await response.text();
    const payload = text.split('\n').find(line => line.startsWith('data: '))?.slice(6) ?? text;
    return { sessionId: response.headers.get('mcp-session-id'), body: payload ? JSON.parse(payload) : undefined };
  };

  const openSession = async (contextName: string) => {
    const init = await post(contextName, undefined, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'request-context-test', version: '1.0.0' },
    });
    await post(contextName, init.sessionId!, 'notifications/initialized', {});
    return init.sessionId!;
  };

  const callTool = (contextName: string, sessionId: string, name: string, args: Record<string, unknown> = {}) =>
    post(contextName, sessionId, 'tools/call', { name, arguments: args });

  const resultText = (response: { body: any }): string => response.body.result.content[0].text;
  const heldResult = (response: { body: any }) => JSON.parse(resultText(response)).data;

  /** Hold the next built-in tool call until released. */
  const holdNextToolCall = () => {
    let release!: () => void;
    let markEntered!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    ensureInitialized.mockImplementationOnce(async () => {
      markEntered();
      await released;
    });
    gate = { entered, release };
    return gate;
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.post('/mcp', (req, res) => {
      const context = contexts[req.headers['x-test-context'] as string];
      engine.processRequest(req, res, context ? { ...context } : undefined).catch(() => {
        if (!res.headersSent) res.status(500).end();
      });
    });
    listener = app.listen(0);
    url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`;
  });

  afterAll(() => { listener.close(); });

  beforeEach(() => {
    vi.stubEnv('AUTH_TOKEN', 'request-context-test-token-0123456789abcdef');
    vi.stubEnv('ENABLE_MULTI_TENANT', 'true');
    vi.spyOn(SSRFProtection, 'validateWebhookUrl').mockResolvedValue({ valid: true });
    vi.stubEnv('NODE_DB_PATH', ':memory:');
    // The database is mocked; tool calls only need initialization to resolve.
    ensureInitialized = vi.spyOn(N8NDocumentationMCPServer.prototype as any, 'ensureInitialized').mockResolvedValue(undefined);
    vi.spyOn(n8nHandlers, 'handleValidateWorkflow').mockImplementation(async (_args, _repository, context) => ({
      success: true,
      data: { seen: describeContext(context), uiAppsEnabled: context?.uiAppsEnabled ?? null },
    }) as any);
    engine = new N8NMCPEngine({
      additionalTools: [{
        tool: { name: 'context_probe', description: 'Reports the instance context', inputSchema: { type: 'object', properties: {} } },
        handler: async (_args, { instanceContext }) => ({ content: [{ type: 'text', text: describeContext(instanceContext) }] }),
      }],
    });
  });

  afterEach(async () => {
    gate?.release();
    gate = null;
    await engine.shutdown();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses the request context in the shared strategy', async () => {
    vi.stubEnv('MULTI_TENANT_SESSION_STRATEGY', 'shared');
    const sessionId = await openSession('a');

    const held = holdNextToolCall();
    const first = callTool('a', sessionId, 'n8n_validate_workflow', { id: 'wf-1' });
    try {
      await held.entered;
      expect(resultText(await callTool('b', sessionId, 'context_probe'))).toBe(describeContext(contexts.b));
    } finally {
      held.release();
    }
    expect(heldResult(await first).seen).toBe(describeContext(contexts.a));

    expect(resultText(await callTool('a', sessionId, 'context_probe'))).toBe(describeContext(contexts.a));
    expect(resultText(await callTool('b', sessionId, 'context_probe'))).toBe(describeContext(contexts.b));
    expect(resultText(await callTool('none', sessionId, 'context_probe'))).toBe(describeContext(undefined));
  });

  it('uses the request context in the instance strategy', async () => {
    vi.stubEnv('MULTI_TENANT_SESSION_STRATEGY', 'instance');
    const sessionId = await openSession('a');

    const held = holdNextToolCall();
    const first = callTool('a', sessionId, 'n8n_validate_workflow', { id: 'wf-1' });
    try {
      await held.entered;
      expect(resultText(await callTool('a-rotated', sessionId, 'context_probe'))).toBe(describeContext(contexts['a-rotated']));
    } finally {
      held.release();
    }
    expect(heldResult(await first)).toEqual({ seen: describeContext(contexts.a), uiAppsEnabled: null });
  });

  it.each(['b', 'key-only', 'no-instance-id', 'none'])('keeps the session context for a %s request in the instance strategy', async contextName => {
    vi.stubEnv('MULTI_TENANT_SESSION_STRATEGY', 'instance');
    const sessionId = await openSession('a');
    expect(resultText(await callTool(contextName, sessionId, 'context_probe'))).toBe(describeContext(contexts.a));
  });

  it.each([['shared', true], ['instance', false]] as const)('requires a request context in the %s strategy: %s', async (strategy, required) => {
    vi.stubEnv('MULTI_TENANT_SESSION_STRATEGY', strategy);
    const sessionId = await openSession('a');
    expect((engine as any).server.servers[sessionId].requireRequestContext).toBe(required);
  });

  it('applies the request context to listings', async () => {
    vi.stubEnv('MULTI_TENANT_SESSION_STRATEGY', 'shared');
    const sessionId = await openSession('a');
    // The registry is loaded per server; give it card HTML whether or not the UI is built.
    for (const app of UIAppRegistry.getAllApps()) app.html = '<html></html>';
    const cards = async (contextName: string) => ({
      tools: (await post(contextName, sessionId, 'tools/list', {})).body.result.tools.filter((tool: any) => tool._meta?.ui).length,
      resources: (await post(contextName, sessionId, 'resources/list', {})).body.result.resources.filter((resource: any) => resource.uri.startsWith('ui://')).length,
    });
    const on = await cards('b');
    expect(on.tools).toBeGreaterThan(0);
    expect(on.resources).toBeGreaterThan(0);
    expect(await cards('b-cards-off')).toEqual({ tools: 0, resources: 0 });
    expect(await cards('b')).toEqual(on);
  });
});

describe('instance context without a request scope', () => {
  beforeEach(() => { vi.stubEnv('NODE_DB_PATH', ':memory:'); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  const probeTool = (seen: Array<InstanceContext | undefined>) => ({
    tool: { name: 'context_probe', description: 'Reports the instance context', inputSchema: { type: 'object' as const, properties: {} } },
    handler: async (_args: unknown, { instanceContext }: { instanceContext?: InstanceContext }) => {
      seen.push(instanceContext);
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  });
  const call = (server: N8NDocumentationMCPServer): Promise<any> =>
    (server as any).server._requestHandlers.get('tools/call')({ method: 'tools/call', params: { name: 'context_probe', arguments: {} } }, {});

  it('uses the constructor context when no request scope is required', async () => {
    const seen: Array<InstanceContext | undefined> = [];
    const server = new N8NDocumentationMCPServer(contexts.a, undefined, { additionalTools: [probeTool(seen)] });
    await call(server);
    expect(seen).toEqual([contexts.a]);
    await server.shutdown();
  });

  it('prefers the request scope over the constructor context', async () => {
    const seen: Array<InstanceContext | undefined> = [];
    const server = new N8NDocumentationMCPServer(contexts.a, undefined, { additionalTools: [probeTool(seen)] });
    await runWithRequestContext(server, contexts.b, () => call(server));
    await runWithRequestContext(server, undefined, () => call(server));
    // A scope opened for another server does not apply to this one.
    await runWithRequestContext({}, contexts.b, () => call(server));
    expect(seen).toEqual([contexts.b, undefined, contexts.a]);
    await server.shutdown();
  });

  it('refuses a tool call when a request scope is required and missing', async () => {
    const seen: Array<InstanceContext | undefined> = [];
    const server = new N8NDocumentationMCPServer(contexts.a, undefined, {
      additionalTools: [probeTool(seen)],
      requireRequestContext: true,
    });
    // The call may reject or resolve with an error result; either is a refusal.
    const refused = await call(server).catch(() => ({ isError: true }));
    expect(refused.isError).toBe(true);
    expect(seen).toEqual([]);

    const allowed = await runWithRequestContext(server, contexts.b, () => call(server));
    expect(allowed.isError).not.toBe(true);
    expect(seen).toEqual([contexts.b]);
    await server.shutdown();
  });
});
