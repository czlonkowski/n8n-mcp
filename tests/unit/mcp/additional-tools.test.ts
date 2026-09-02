import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import type { AdditionalTool } from '../../../src/types/additional-tools';
import type { InstanceContext } from '../../../src/types/instance-context';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger');

class TestableN8NMCPServer extends N8NDocumentationMCPServer {
  public async testExecuteTool(name: string, args: any): Promise<any> {
    return (this as any).executeTool(name, args);
  }

  public testGetEnabledAdditionalTools(disabledTools: Set<string>): any[] {
    return (this as any).getEnabledAdditionalTools(disabledTools);
  }

  /**
   * Invoke the `tools/call` request handler directly, bypassing the transport
   * layer. Exercises the full CallToolRequestSchema dispatch path, including
   * the `isAdditionalTool` early-return branch.
   */
  public async simulateToolCallRequest(name: string, args: Record<string, any>): Promise<any> {
    const handler = (this as any).server._requestHandlers?.get('tools/call');
    if (!handler) {
      throw new Error('tools/call handler not registered');
    }
    return handler({ method: 'tools/call', params: { name, arguments: args } }, {});
  }

  public testEnsureTextContent(name: string, result: unknown): any {
    return (this as any).ensureTextContent(name, result);
  }

  public stubExecuteTool(result: unknown): void {
    (this as any).executeTool = vi.fn().mockResolvedValue(result);
  }
}

describe('Additional tools hook', () => {
  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
    delete process.env.DISABLED_TOOLS;
  });

  it('executes additional tool handlers with instanceContext', async () => {
    const instanceContext: InstanceContext = {
      n8nApiUrl: 'https://example.n8n.cloud',
      n8nApiKey: 'api-key',
      instanceId: 'tenant-1',
    };

    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_switch_instance',
          description: 'Switch active n8n instance',
          inputSchema: { type: 'object', properties: {} },
        },
        handler,
      },
    ];

    const server = new TestableN8NMCPServer(instanceContext, undefined, { additionalTools });
    const result = await server.testExecuteTool('host_switch_instance', { instanceId: 'tenant-2' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(handler).toHaveBeenCalledWith(
      { instanceId: 'tenant-2' },
      { instanceContext },
    );
  });

  it('rejects non-object arguments for additional tools', async () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_switch_instance',
          description: 'Switch active n8n instance',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });
    await expect(server.testExecuteTool('host_switch_instance', 'bad-args' as any))
      .rejects.toThrow('expected object');
  });

  it('filters additional tools via DISABLED_TOOLS list', () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_switch_instance',
          description: 'Switch active n8n instance',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
      {
        tool: {
          name: 'host_list_instances',
          description: 'List n8n instances',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });
    const enabled = server.testGetEnabledAdditionalTools(new Set(['host_list_instances']));

    expect(enabled.map(tool => tool.name)).toEqual(['host_switch_instance']);
  });

  it('throws when additional tool collides with built-in name', () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'tools_documentation',
          description: 'Conflicting name',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ];

    expect(() => new TestableN8NMCPServer(undefined, undefined, { additionalTools }))
      .toThrow('collides with a built-in tool');
  });

  it('throws when additional tool collides with a management tool name', () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'n8n_create_workflow',
          description: 'Conflicting with management tool',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ];

    expect(() => new TestableN8NMCPServer(undefined, undefined, { additionalTools }))
      .toThrow('collides with a built-in tool');
  });

  it('throws when duplicate additional tool names are provided', () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_switch_instance',
          description: 'Switch instance',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
      {
        tool: {
          name: 'host_switch_instance',
          description: 'Duplicate switch instance',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ];

    expect(() => new TestableN8NMCPServer(undefined, undefined, { additionalTools }))
      .toThrow('Duplicate additional tool');
  });

  it('request handler returns additional tool CallToolResult unchanged (no double-wrapping)', async () => {
    const handlerResult = { content: [{ type: 'text', text: 'direct-response' }] };

    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_list_instances',
          description: 'List tenant n8n instances',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue(handlerResult),
      },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });
    const result = await server.simulateToolCallRequest('host_list_instances', {});

    // The response must be exactly what the handler returned — not wrapped in
    // another content array as built-in tools are.
    expect(result).toEqual(handlerResult);
  });

  it('serializes non-string text blocks returned by a host tool', async () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_structured_text',
          description: 'Returns a non-string text block',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockResolvedValue({
          content: [
            { type: 'text', text: { id: 'instance-1', active: true } },
            { type: 'text', text: 'already-valid' },
          ],
        }),
      },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });
    const result = await server.simulateToolCallRequest('host_structured_text', {});

    expect(JSON.parse(result.content[0].text)).toEqual({ id: 'instance-1', active: true });
    expect(result.content[1].text).toBe('already-valid');
  });

  it('makes circular, bigint, and throwing values readable in host text blocks', () => {
    const server = new TestableN8NMCPServer();
    const circular: Record<string, unknown> = { count: 12n };
    circular.self = circular;

    const repaired = server.testEnsureTextContent('host_complex_text', {
      content: [{ type: 'text', text: circular }],
    });
    expect(repaired.content[0].text).toContain('12n');
    expect(repaired.content[0].text).toContain('[circular reference]');

    const throwing = {
      value: 'still-readable',
      toJSON: () => { throw new Error('cannot serialize'); },
    };
    const fallback = server.testEnsureTextContent('host_throwing_text', {
      content: [{ type: 'text', text: throwing }],
    });
    expect(fallback.content[0].text).toContain('still-readable');

    expect(server.testEnsureTextContent('host_plain_value', 'plain')).toBe('plain');
  });

  it('marks a self-bounded tool response as an error when normal serialization fails', async () => {
    const server = new TestableN8NMCPServer();
    const circular: Record<string, unknown> = { value: 'recoverable' };
    circular.self = circular;
    server.stubExecuteTool(circular);

    const result = await server.simulateToolCallRequest('query_response_artifact', {
      artifactId: 'a'.repeat(20),
      responsePath: '',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('recoverable');
    expect(result.content[0].text).toContain('[circular reference]');
  });

  it('serializes sanitized validation results as structured content', async () => {
    const server = new TestableN8NMCPServer();
    server.stubExecuteTool({
      nodeType: 'n8n-nodes-base.code',
      displayName: 'Code',
      valid: true,
      missingRequiredFields: [],
    });

    const result = await server.simulateToolCallRequest('validate_node_minimal', {
      nodeType: 'n8n-nodes-base.code',
      config: {},
    });

    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({
      nodeType: 'n8n-nodes-base.code',
      valid: true,
    });
  });

  it('handler rejection returns a plain isError response without n8n-specific guidance', async () => {
    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_failing_tool',
          description: 'Always fails',
          inputSchema: { type: 'object', properties: {} },
        },
        handler: vi.fn().mockRejectedValue(new Error('host tool failed')),
      },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });
    const result = await server.simulateToolCallRequest('host_failing_tool', {});

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Error executing tool host_failing_tool: host tool failed',
    });
    // Must NOT leak n8n-flavored guidance or arg diagnostic into host tool errors.
    expect(result.content[0].text).not.toContain('nodeType');
    expect(result.content[0].text).not.toContain('[Diagnostic]');
    expect(result.content[0].text).not.toContain('validation tools');
  });

  it('coerces string-encoded args for additional tools (Claude Desktop client-bug parity)', async () => {
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    const additionalTools: AdditionalTool[] = [
      {
        tool: {
          name: 'host_typed_tool',
          description: 'Has a typed input schema',
          inputSchema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              config: { type: 'object' },
            },
          },
        },
        handler,
      },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });
    // Simulate the Claude Desktop bug: object serialized as string, number as string.
    await server.simulateToolCallRequest('host_typed_tool', {
      count: '42' as any,
      config: '{"foo":"bar"}' as any,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [receivedArgs] = handler.mock.calls[0];
    // Coercion ran the same way it does for built-ins.
    expect(receivedArgs).toEqual({ count: 42, config: { foo: 'bar' } });
  });

  it('mutating the input tool descriptor after registration does not affect the registered tool', () => {
    const tool = {
      name: 'host_mutable_tool',
      description: 'original description',
      inputSchema: { type: 'object' as const, properties: {} },
    };

    const additionalTools: AdditionalTool[] = [
      { tool, handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }) },
    ];

    const server = new TestableN8NMCPServer(undefined, undefined, { additionalTools });

    // Mutate the caller's tool descriptor after registration.
    tool.description = 'mutated description';
    (tool.inputSchema as any).properties = { injected: { type: 'string' } };

    const enabled = server.testGetEnabledAdditionalTools(new Set());
    expect(enabled[0].description).toBe('original description');
    expect(enabled[0].inputSchema.properties).toEqual({});
  });
});
