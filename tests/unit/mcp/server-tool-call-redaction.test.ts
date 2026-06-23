import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/database/database-adapter');
vi.mock('../../../src/database/node-repository');
vi.mock('../../../src/templates/template-service');
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  Logger: class {},
  LogLevel: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 },
}));

import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { logger } from '../../../src/utils/logger';

const SECRET = 'Bearer DEMO_SECRET_DO_NOT_LEAK';

class TestableServer extends N8NDocumentationMCPServer {
  public callCoerce(toolName: string, args: Record<string, any>) {
    return (this as any).coerceStringifiedJsonParams(toolName, args);
  }
  public callValidateExtracted(toolName: string, args: Record<string, any>) {
    return (this as any).validateExtractedArgs(toolName, args);
  }
}

function allLogPayloads(): string {
  const calls = [
    ...(logger.info as any).mock.calls,
    ...(logger.warn as any).mock.calls,
    ...(logger.debug as any).mock.calls,
    ...(logger.error as any).mock.calls,
  ];
  return JSON.stringify(calls);
}

describe('server tool-call log redaction (GHSA-wg4g-395p-mqv3)', () => {
  let server: TestableServer;

  beforeEach(() => {
    process.env.NODE_DB_PATH = ':memory:';
    vi.clearAllMocks();
    server = new TestableServer();
  });

  afterEach(() => {
    delete process.env.NODE_DB_PATH;
  });

  it('does not leak secret values when executeTool is called with credential payload', async () => {
    await server.executeTool('n8n_manage_credentials', {
      action: 'create',
      name: 'demo',
      type: 'httpHeaderAuth',
      data: { name: 'Authorization', value: SECRET },
    }).catch(() => {
      // executeTool may throw because n8n API is not configured in test env;
      // we only care about what was logged BEFORE the throw.
    });

    // 'DEMO_SECRET' is a substring of SECRET, so this also rules out full-value leaks.
    expect(allLogPayloads()).not.toContain('DEMO_SECRET');
  });

  it('does not leak secret values when coerceStringifiedJsonParams runs', () => {
    server.callCoerce('validate_node', {
      nodeType: 'nodes-base.slack',
      config: SECRET,
    });

    expect(allLogPayloads()).not.toContain('DEMO_SECRET');
  });

  it('does not leak secret values from validateExtractedArgs type-mismatch path', () => {
    server.callValidateExtracted('search_nodes', {
      query: 123 as any,
      extra: SECRET,
    });

    expect(allLogPayloads()).not.toContain('DEMO_SECRET');
  });

  it('logs metadata (tool name, key list, types) so debugging stays useful', async () => {
    await server.executeTool('n8n_manage_credentials', {
      action: 'create',
      name: 'demo',
      data: { value: SECRET },
    }).catch(() => {});

    const infoCalls = (logger.info as any).mock.calls;
    const executionLog = infoCalls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('Tool execution')
    );
    expect(executionLog).toBeDefined();
    expect(executionLog[1]).toMatchObject({
      argsType: 'object',
      argsKeys: ['action', 'name', 'data'],
    });
    expect(JSON.stringify(executionLog[1])).not.toContain('DEMO_SECRET');
  });
});
