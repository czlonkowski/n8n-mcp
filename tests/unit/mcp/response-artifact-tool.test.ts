import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { persistResponseArtifact } from '../../../src/services/mcp-response-bounding';
import { getInstanceScopeId, type InstanceContext } from '../../../src/types/instance-context';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

class TestableN8NMCPServer extends N8NDocumentationMCPServer {
  public async testExecuteTool(name: string, args: any): Promise<any> {
    return (this as any).executeTool(name, args);
  }

  public async testListTools(): Promise<any> {
    const handler = (this as any).server._requestHandlers?.get('tools/list');
    if (!handler) throw new Error('tools/list handler not registered');
    return handler({ method: 'tools/list', params: {} }, {});
  }

  public testFindToolSchema(name: string): any {
    return (this as any).findToolSchema(name);
  }

  public async testCallTool(name: string, args: Record<string, unknown>): Promise<any> {
    const handler = (this as any).server._requestHandlers?.get('tools/call');
    if (!handler) throw new Error('tools/call handler not registered');
    // SDK v2 wraps tools/call (and prompts/get, resources/read) in an
    // input-required-capable handler that reads ctx.mcpReq.requestState()
    // before invoking the registered handler. Our own handler ignores ctx,
    // but the SDK wrapper still requires the accessor to exist.
    return handler(
      { method: 'tools/call', params: { name, arguments: args } },
      { mcpReq: { requestState: () => undefined } }
    );
  }

  public stubExecuteTool(result: unknown): void {
    (this as any).executeTool = vi.fn().mockResolvedValue(result);
  }

  public async testReadResource(uri: string): Promise<any> {
    const handler = (this as any).server._requestHandlers?.get('resources/read');
    if (!handler) throw new Error('resources/read handler not registered');
    return handler(
      { method: 'resources/read', params: { uri } },
      { mcpReq: { requestState: () => undefined } },
    );
  }
}

describe('response artifact MCP tool', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'n8n-mcp-artifact-tool-'));
    process.env.MCP_RESPONSE_ARTIFACT_ROOT = root;
    process.env.NODE_DB_PATH = path.join(root, 'nodes.db');
  });

  afterEach(() => {
    delete process.env.MCP_RESPONSE_ARTIFACT_ROOT;
    delete process.env.NODE_DB_PATH;
    delete process.env.DISABLED_TOOLS;
    rmSync(root, { recursive: true, force: true });
  });

  it('lists only the semantic artifact query and omits it when disabled', async () => {
    const enabledServer = new TestableN8NMCPServer();
    const enabled = await enabledServer.testListTools();
    expect(enabled.tools.map((tool: any) => tool.name)).not.toContain('read_response_artifact');
    expect(enabled.tools.map((tool: any) => tool.name)).toContain('query_response_artifact');

    process.env.DISABLED_TOOLS = 'query_response_artifact';
    const disabledServer = new TestableN8NMCPServer();
    const disabled = await disabledServer.testListTools();
    expect(disabled.tools.map((tool: any) => tool.name)).not.toContain('read_response_artifact');
    expect(disabled.tools.map((tool: any) => tool.name)).not.toContain('query_response_artifact');
  });

  it('resolves the structured artifact query schema as a built-in tool', () => {
    const server = new TestableN8NMCPServer();
    const schema = server.testFindToolSchema('query_response_artifact');
    expect(schema).toMatchObject({
      name: 'query_response_artifact',
      inputSchema: { required: ['artifactId'], additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true },
    });
    expect(
      Object.keys(schema?.inputSchema.properties ?? {}).filter(name => name.includes('_')),
    ).toEqual([]);
  });

  it('queries artifacts in the configured tenant scope', async () => {
    const context: InstanceContext = {
      n8nApiUrl: 'https://example.n8n.cloud',
      n8nApiKey: 'api-key',
      instanceId: 'tenant-a',
    };
    const artifact = persistResponseArtifact(
      { rows: [{ id: 1, payload: 'large' }, { id: 2, payload: 'large' }] },
      getInstanceScopeId(context),
    );
    const server = new TestableN8NMCPServer(context);

    const response = await server.testCallTool('query_response_artifact', {
      artifactId: artifact.id,
      responsePath: '/rows',
      fields: ['id'],
      pageSize: 20,
    });
    const result = JSON.parse(response.content[0].text);

    expect(result.response).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.responseMeta).toMatchObject({
      complete: true,
      returnedCount: 2,
      totalCount: 2,
      remainingCount: 0,
    });
    expect(response.structuredContent).toEqual(result);
  });

  it('normalizes a non-empty response root through the MCP tool boundary', async () => {
    const artifact = persistResponseArtifact({
      response: { rows: [{ id: 1 }, { id: 2 }] },
    }, 'default-instance');
    const metaPath = path.join(root, `response-${artifact.id}.meta.json`);
    const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
    metadata.responseRoot = '/response';
    writeFileSync(metaPath, JSON.stringify(metadata));

    const response = await new TestableN8NMCPServer().testCallTool('query_response_artifact', {
      artifactId: artifact.id,
      responsePath: '/rows',
      fields: ['id'],
      pageSize: 1,
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      responsePath: '/response/rows',
      response: [{ id: 1 }],
      responseMeta: { inferredResponsePath: '/response/rows' },
    });
  });

  it.each([
    ['INVALID_RESPONSE_PATH', { responsePath: '/missing' }],
    ['INVALID_RESPONSE_CONTROLS', { responsePath: 'rows' }],
    ['INVALID_RESPONSE_CURSOR', { cursor: 'short' }],
  ])('returns a bounded structured %s error without generic diagnostics', async (code, controls) => {
    const artifact = persistResponseArtifact({ rows: [{ id: 1 }, { id: 2 }] }, 'default-instance');
    const response = await new TestableN8NMCPServer().testCallTool('query_response_artifact', {
      artifactId: artifact.id,
      responsePath: '/rows',
      pageSize: 1,
      ...controls,
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent.response.error.code).toBe(code);
    expect(response.structuredContent.responseMeta).toMatchObject({
      contractVersion: 3,
      complete: false,
      nextCursor: null,
    });
    expect(response.structuredContent.responseMeta.serializedBytes).toBeGreaterThan(0);
    expect(response.content[0].text).not.toContain('Error executing tool');
    expect(response.content[0].text).not.toContain('[Diagnostic]');
    expect(Buffer.byteLength(JSON.stringify(response.structuredContent))).toBeLessThan(8 * 1024);
  });

  it('returns a structured unusable-handle error without disclosing raw values', async () => {
    const response = await new TestableN8NMCPServer().testCallTool('query_response_artifact', {
      artifactId: 'a'.repeat(48),
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent.response.error.code).toBe('INVALID_ARTIFACT_HANDLE');
    expect(response.content[0].text).not.toContain('[Diagnostic]');
  });

  it('keeps corrupt artifact storage failures on the generic server-error path', async () => {
    const artifact = persistResponseArtifact({ rows: [{ id: 1 }] }, 'default-instance');
    writeFileSync(path.join(root, `response-${artifact.id}.json`), '{not-json');

    const response = await new TestableN8NMCPServer().testCallTool('query_response_artifact', {
      artifactId: artifact.id,
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect(response.content[0].text).toContain('Error executing tool query_response_artifact');
  });

  it('reads a small descriptor resource without exposing stored values', async () => {
    const artifact = persistResponseArtifact({ rows: [{ sensitive: 'stored-only' }] }, 'default-instance');
    const response = await new TestableN8NMCPServer().testReadResource(
      `artifact://n8n-mcp/${artifact.id}`,
    );
    const descriptor = JSON.parse(response.contents[0].text);

    expect(descriptor).toMatchObject({ id: artifact.id, rawReadable: false, responseRoot: '' });
    expect(Buffer.byteLength(response.contents[0].text)).toBeLessThanOrEqual(8 * 1024);
    expect(response.contents[0].text).not.toContain('stored-only');
  });

  it('does not disclose whether an artifact exists outside the active scope', async () => {
    const artifact = persistResponseArtifact({ value: 'private' }, 'default-instance');
    const context: InstanceContext = {
      n8nApiUrl: 'https://example.n8n.cloud',
      n8nApiKey: 'api-key',
      instanceId: 'tenant-b',
    };
    const server = new TestableN8NMCPServer(context);

    await expect(server.testReadResource(`artifact://n8n-mcp/${artifact.id}`))
      .rejects.toThrow('Artifact resource is unavailable for this caller');
    await expect(server.testReadResource('artifact://n8n-mcp/not-valid'))
      .rejects.toThrow('Artifact resource is unavailable for this caller');
  });

  it('adds a descriptor link and bounded structured envelope when an origin tool artifacts', async () => {
    const server = new TestableN8NMCPServer();
    server.stubExecuteTool({ providerPayload: 'stored-only-'.repeat(4000) });

    const response = await server.testCallTool('tools_documentation', {});
    const parsed = JSON.parse(response.content[0].text);
    const link = response.content.find((block: any) => block.type === 'resource_link');

    expect(response.structuredContent).toEqual(parsed);
    expect(link).toMatchObject({
      uri: `artifact://n8n-mcp/${parsed.responseMeta.artifact.id}`,
      mimeType: 'application/json',
      size: parsed.responseMeta.artifact.byteLength,
    });
    expect(Buffer.byteLength(response.content[0].text)).toBeLessThanOrEqual(8 * 1024);
    expect(response.content[0].text).not.toHaveLength(parsed.responseMeta.artifact.byteLength);
  });

  it('uses the default page size during direct tenant-scoped query dispatch', async () => {
    const context: InstanceContext = {
      n8nApiUrl: 'https://example.n8n.cloud',
      n8nApiKey: 'api-key',
      instanceId: 'tenant-default-page',
    };
    const artifact = persistResponseArtifact(
      { rows: Array.from({ length: 25 }, (_, id) => ({ id })) },
      getInstanceScopeId(context),
    );
    const server = new TestableN8NMCPServer(context);

    const result = await server.testExecuteTool('query_response_artifact', {
      artifactId: artifact.id,
      responsePath: '/rows',
    });

    expect(result.response).toHaveLength(20);
    expect(result.responseMeta).toMatchObject({
      returnedCount: 20,
      totalCount: 25,
      complete: false,
    });
  });

  it('requires an artifact id and defaults an omitted response path to the artifact root', async () => {
    const server = new TestableN8NMCPServer();
    await expect(server.testExecuteTool('query_response_artifact', {})).rejects.toThrow(
      'artifactId is required',
    );
    const artifact = persistResponseArtifact('root text', 'default-instance');
    const result = await server.testExecuteTool('query_response_artifact', { artifactId: artifact.id }) as any;
    expect(result).toMatchObject({ artifactId: artifact.id, responsePath: '', response: 'root text' });
    await expect(server.testExecuteTool('query_response_artifact', {
      artifactId: artifact.id,
      responsePath: 42,
    })).rejects.toThrow('responsePath must be an RFC 6901 string');
  });
});
