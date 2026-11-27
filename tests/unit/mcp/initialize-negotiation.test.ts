import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION, type JSONRPCMessage, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { N8NDocumentationMCPServer } from '@/mcp/server';
import { closeSharedDatabase } from '@/database/shared-database';
import { telemetry } from '@/telemetry';
import { negotiateProtocolVersion } from '@/utils/protocol-version';

// n8n's MCP Client nodes report their node type as clientInfo.name.
const N8N_CLIENT_NAME = '@n8n/n8n-nodes-langchain.mcpClientTool';

describe('negotiateProtocolVersion', () => {
  it('echoes a revision the SDK supports', () => {
    for (const version of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) {
      expect(negotiateProtocolVersion(version)).toBe(version);
    }
  });

  it('answers anything else with the latest revision', () => {
    for (const version of ['2099-01-01', '2026-07-28', '2024-06-25', '', undefined, 42]) {
      expect(negotiateProtocolVersion(version)).toBe(LATEST_PROTOCOL_VERSION);
    }
  });
});

describe('SDK private API the server relies on', () => {
  // server.ts wraps Server#_oninitialize. If an SDK update renames it, the wrapper
  // is skipped and session-start telemetry stops, so fail here instead.
  it('Server still routes initialize through _oninitialize', () => {
    const server = new Server({ name: 't', version: '0' }, { capabilities: {} });
    expect(typeof (server as any)._oninitialize).toBe('function');
  });

  // The guard above passes even if the SDK bound the method at construction time,
  // which would leave an instance override unused. This needs no node database.
  it('uses an instance override of _oninitialize for initialize requests', async () => {
    const server = new Server({ name: 't', version: '0' }, { capabilities: {} });
    const sdkInitialize = (server as any)._oninitialize.bind(server);
    let called = false;
    (server as any)._oninitialize = async (request: unknown) => {
      called = true;
      return sdkInitialize(request);
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'override-test', version: '1.0.0' });
    await client.connect(clientTransport);
    expect(called).toBe(true);
    expect(server.getClientVersion()?.name).toBe('override-test');
    await client.close();
  });
});

const sourceDbPath = path.resolve(__dirname, '../../../data/nodes.db');

describe.skipIf(!fs.existsSync(sourceDbPath))('initialize handshake', () => {
  let tmpDir: string;
  const previousDbPath = process.env.NODE_DB_PATH;
  const servers: N8NDocumentationMCPServer[] = [];

  beforeAll(() => {
    // Work on a copy: opening the tracked database rewrites bytes in it.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-initialize-'));
    const dbCopy = path.join(tmpDir, 'nodes.db');
    fs.copyFileSync(sourceDbPath, dbCopy);
    process.env.NODE_DB_PATH = dbCopy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const server of servers) await server.close();
    await closeSharedDatabase();
    if (previousDbPath === undefined) delete process.env.NODE_DB_PATH;
    else process.env.NODE_DB_PATH = previousDbPath;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A fresh server per connection: an SDK Server accepts one transport. */
  async function connectServer(): Promise<{ server: N8NDocumentationMCPServer; transport: InMemoryTransport }> {
    const server = new N8NDocumentationMCPServer();
    servers.push(server);
    await (server as any).initialized;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await (server as any).server.connect(serverTransport);
    return { server, transport: clientTransport };
  }

  /** Sends a raw initialize, without the SDK client's version check, and never sends notifications/initialized. */
  async function rawInitialize(protocolVersion: string, clientName = 'raw-test-client'): Promise<any> {
    const { transport } = await connectServer();
    const response = new Promise<JSONRPCMessage>(resolve => {
      transport.onmessage = message => {
        if ('id' in message && message.id === 1) resolve(message);
      };
    });
    await transport.start();
    await transport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: {}, clientInfo: { name: clientName, version: '1.0.0' } },
    });
    const message: any = await response;
    await transport.close();
    return message.result;
  }

  async function connectClient(name: string): Promise<Client> {
    const { transport } = await connectServer();
    const client = new Client({ name, version: '1.0.0' });
    await client.connect(transport);
    return client;
  }

  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])(
    'settles on the requested revision %s',
    async version => {
      expect((await rawInitialize(version)).protocolVersion).toBe(version);
    },
    30000
  );

  it.each(['2099-01-01', '2026-07-28'])(
    'answers the unsupported revision %s with the latest one',
    async version => {
      expect((await rawInitialize(version)).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    },
    30000
  );

  it('gives n8n clients the revision they request', async () => {
    expect((await rawInitialize('2025-11-25', N8N_CLIENT_NAME)).protocolVersion).toBe('2025-11-25');
  }, 30000);

  it('returns the server info, icons and instructions declared on the Server', async () => {
    const result = await rawInitialize(LATEST_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('n8n-documentation-mcp');
    expect(result.serverInfo.icons?.length).toBeGreaterThan(0);
    expect(result.capabilities).toMatchObject({ tools: {}, resources: {} });
    expect(typeof result.instructions).toBe('string');
  }, 30000);

  it('records one session start per initialize, without waiting for notifications/initialized', async () => {
    const trackSessionStart = vi.spyOn(telemetry, 'trackSessionStart').mockImplementation(() => {});
    await rawInitialize(LATEST_PROTOCOL_VERSION);
    expect(trackSessionStart).toHaveBeenCalledTimes(1);
  }, 30000);

  it('keeps the client info available to tools/list for the n8n-friendly descriptions', async () => {
    const n8nClient = await connectClient(N8N_CLIENT_NAME);
    const otherClient = await connectClient('claude-code');
    try {
      const descriptionsByName = (tools: Tool[]) =>
        Object.fromEntries(tools.map(tool => [tool.name, tool.description]));
      const n8nDescriptions = descriptionsByName((await n8nClient.listTools()).tools);
      const otherDescriptions = descriptionsByName((await otherClient.listTools()).tools);
      const changed = Object.keys(n8nDescriptions).filter(name => n8nDescriptions[name] !== otherDescriptions[name]);
      expect(changed.length).toBeGreaterThan(0);
    } finally {
      await n8nClient.close();
      await otherClient.close();
    }
  }, 60000);
});
