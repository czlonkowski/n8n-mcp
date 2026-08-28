/**
 * Tests for the data table column actions of `n8n_manage_datatable`
 * (`addColumn`, `deleteColumn`, `renameColumn`), which n8n's Public API cannot
 * do and which therefore route to the instance's own MCP server.
 *
 * Two groups:
 *  - a routing matrix that intercepts `callOfficialTool` and
 *    `resolveProjectChoices` (both are the unit's output, not its collaborators), and
 *  - a wire group that lets the real `callOfficialTool` run against the fake
 *    official MCP server through a real `N8nOfficialMcpClient`.
 *
 * The interception is a delegating wrapper rather than a plain `vi.fn()` so the
 * same file can do both: the overrides short-circuit the calls in the matrix
 * group and are left null in the wire group.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { startFakeOfficialMcp, FakeOfficialMcp, FakeTool } from '../../helpers/fake-official-mcp-server';

const officialMock = vi.hoisted(() => ({
  spy: vi.fn(),
  override: null as null | ((...args: any[]) => any),
  projects: null as null | ((...args: any[]) => any),
}));

const configMock = vi.hoisted(() => ({ getN8nApiConfig: vi.fn() }));

vi.mock('@/services/n8n-api-client');
vi.mock('@/config/n8n-api', async (orig) => ({
  ...(await orig<any>()),
  getN8nApiConfig: configMock.getN8nApiConfig,
}));
vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  Logger: vi.fn().mockImplementation(() => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() })),
  LogLevel: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 },
}));
vi.mock('@/mcp/handlers-official-tools', async (orig) => {
  const actual = await orig<any>();
  return {
    ...actual,
    callOfficialTool: (...args: any[]) => {
      officialMock.spy(...args);
      return officialMock.override ? officialMock.override(...args) : actual.callOfficialTool(...args);
    },
    resolveProjectChoices: (...args: any[]) =>
      officialMock.projects ? officialMock.projects(...args) : actual.resolveProjectChoices(...args),
  };
});

function choices(
  items: Array<{ id: string; name: string; type?: string }>,
  backend: 'public-api' | 'official-mcp' = 'public-api'
) {
  return async () => ({ choices: { backend, teamProjectsEnabled: true, items } });
}

/**
 * `getN8nApiClient` keeps a module-level default client keyed on the API URL,
 * so a fresh mock per test would otherwise never be reached. A null config
 * drops the cached one; the real config then rebuilds it.
 */
function resetDefaultApiClient(handlers: any) {
  configMock.getN8nApiConfig.mockReturnValue(null);
  handlers.getN8nApiClient();
  configMock.getN8nApiConfig.mockReturnValue({
    baseUrl: 'https://n8n.test.com',
    apiKey: 'test-key',
    timeout: 30000,
    maxRetries: 3,
  });
}

describe('n8n_manage_datatable column actions', () => {
  let handlers: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    officialMock.override = async () => ({ success: true, action: 'manage_datatable', data: { success: true, message: 'ok' } });
    officialMock.projects = choices([{ id: 'p1', name: 'Personal', type: 'personal' }]);
    vi.mocked(N8nApiClient).mockImplementation(() => ({ healthCheck: vi.fn() }) as any);
    handlers = await import('@/mcp/handlers-n8n-manager');
    resetDefaultApiClient(handlers);
  });

  // --------------------------------------------------------------- forwarding

  it('addColumn resolves the single project and forwards to add_data_table_column', async () => {
    officialMock.override = async () => ({
      success: true,
      action: 'manage_datatable',
      officialTool: 'add_data_table_column',
      data: { success: true, message: 'ok', column: { id: 'c1', name: 'score', type: 'number' } },
    });

    const r = await handlers.handleAddColumn({ action: 'addColumn', tableId: 't1', column: { name: 'score', type: 'number' } });

    expect(officialMock.spy).toHaveBeenCalledWith(
      undefined,
      ['add_data_table_column'],
      { dataTableId: 't1', projectId: 'p1', name: 'score', type: 'number' },
      30000,
      'manage_datatable',
      false
    );
    expect(r).toMatchObject({
      success: true,
      action: 'addColumn',
      backend: 'official-mcp',
      data: { column: { id: 'c1' } },
    });
  });

  it('deleteColumn forwards the columnId and honours timeoutMs', async () => {
    await handlers.handleDeleteColumn({ action: 'deleteColumn', tableId: 't1', columnId: 'c1', timeoutMs: 60000 });

    expect(officialMock.spy.mock.calls[0][1]).toEqual(['delete_data_table_column']);
    expect(officialMock.spy.mock.calls[0][2]).toEqual({ dataTableId: 't1', projectId: 'p1', columnId: 'c1' });
    expect(officialMock.spy.mock.calls[0][3]).toBe(60000);
  });

  it('renameColumn forwards the new name', async () => {
    const r = await handlers.handleRenameColumn({ action: 'renameColumn', tableId: 't1', columnId: 'c1', name: 'renamed' });

    expect(officialMock.spy.mock.calls[0][1]).toEqual(['rename_data_table_column']);
    expect(officialMock.spy.mock.calls[0][2]).toEqual({ dataTableId: 't1', projectId: 'p1', columnId: 'c1', name: 'renamed' });
    expect(r).toMatchObject({ success: true, action: 'renameColumn', backend: 'official-mcp' });
  });

  it('an explicit projectId skips project resolution', async () => {
    const projectSpy = vi.fn(choices([{ id: 'p1', name: 'Personal' }]));
    officialMock.projects = projectSpy;

    await handlers.handleAddColumn({ action: 'addColumn', tableId: 't1', projectId: 'pX', column: { name: 'score', type: 'number' } });

    expect(projectSpy).not.toHaveBeenCalled();
    expect(officialMock.spy.mock.calls[0][2]).toMatchObject({ projectId: 'pX' });
  });

  // ---------------------------------------------------------- projectId rules

  it('reports PROJECT_REQUIRED with candidates when several projects are accessible', async () => {
    officialMock.projects = choices([
      { id: 'p1', name: 'Personal', type: 'personal' },
      { id: 'p2', name: 'Team', type: 'team' },
    ]);

    const r = await handlers.handleRenameColumn({ action: 'renameColumn', tableId: 't1', columnId: 'c1', name: 'renamed' });

    expect(r).toMatchObject({
      success: false,
      action: 'renameColumn',
      backend: 'public-api',
      code: 'PROJECT_REQUIRED',
      details: { candidates: [{ id: 'p1' }, { id: 'p2' }] },
    });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('names the resolver backend that answered on a PROJECT_REQUIRED envelope', async () => {
    officialMock.projects = choices(
      [{ id: 'p1', name: 'Personal', type: 'personal' }, { id: 'p2', name: 'Team', type: 'team' }],
      'official-mcp'
    );

    const r = await handlers.handleRenameColumn({ action: 'renameColumn', tableId: 't1', columnId: 'c1', name: 'renamed' });

    expect(r).toMatchObject({ success: false, code: 'PROJECT_REQUIRED', backend: 'official-mcp' });
  });

  it('reports PROJECT_REQUIRED when no project could be resolved', async () => {
    officialMock.projects = choices([]);

    const r = await handlers.handleDeleteColumn({ action: 'deleteColumn', tableId: 't1', columnId: 'c1' });

    expect(r).toMatchObject({ success: false, action: 'deleteColumn', backend: 'public-api', code: 'PROJECT_REQUIRED' });
    expect(r.error).toContain('No project');
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('passes a resolver failure through unchanged', async () => {
    officialMock.projects = async () => ({
      failure: { success: false, code: 'API_ERROR', error: 'projects unavailable', backend: 'public-api' },
    });

    const r = await handlers.handleDeleteColumn({ action: 'deleteColumn', tableId: 't1', columnId: 'c1' });

    expect(r).toMatchObject({
      success: false,
      action: 'deleteColumn',
      code: 'API_ERROR',
      error: 'projects unavailable',
      backend: 'public-api',
    });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------- local checks

  it('rejects a column name that does not start with a letter', async () => {
    const r = await handlers.handleAddColumn({ action: 'addColumn', tableId: 't1', projectId: 'pX', column: { name: '1bad', type: 'number' } });

    expect(r).toMatchObject({ success: false, action: 'addColumn', code: 'INVALID_ARGS' });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('rejects a column name longer than 63 characters', async () => {
    const r = await handlers.handleAddColumn({
      action: 'addColumn',
      tableId: 't1',
      projectId: 'pX',
      column: { name: 'a'.repeat(64), type: 'string' },
    });

    expect(r).toMatchObject({ success: false, action: 'addColumn', code: 'INVALID_ARGS' });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('rejects an unknown column type', async () => {
    const r = await handlers.handleAddColumn({ action: 'addColumn', tableId: 't1', projectId: 'pX', column: { name: 'score', type: 'json' } });

    expect(r).toMatchObject({ success: false, action: 'addColumn', code: 'INVALID_ARGS' });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('rejects an empty rename target name', async () => {
    const r = await handlers.handleRenameColumn({ action: 'renameColumn', tableId: 't1', projectId: 'pX', columnId: 'c1', name: '' });

    expect(r).toMatchObject({ success: false, action: 'renameColumn', code: 'INVALID_ARGS' });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  it('rejects a missing columnId', async () => {
    const r = await handlers.handleDeleteColumn({ action: 'deleteColumn', tableId: 't1', projectId: 'pX' });

    expect(r).toMatchObject({ success: false, action: 'deleteColumn', code: 'INVALID_ARGS' });
    expect(officialMock.spy).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------- passthroughs

  it('passes NOT_CONFIGURED through with the action label', async () => {
    officialMock.override = async () => ({ success: false, action: 'manage_datatable', code: 'NOT_CONFIGURED', error: 'no token' });

    const r = await handlers.handleAddColumn({ action: 'addColumn', tableId: 't1', projectId: 'pX', column: { name: 'score', type: 'number' } });

    expect(r).toMatchObject({ success: false, action: 'addColumn', code: 'NOT_CONFIGURED', backend: 'official-mcp' });
  });
});

// ---------------------------------------------------------------------------
// Wire group: real callOfficialTool + real client against the fake server.
// ---------------------------------------------------------------------------

describe('n8n_manage_datatable column actions over the wire', () => {
  let handlers: any;
  let fake: FakeOfficialMcp | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    officialMock.override = null;
    officialMock.projects = null;
    vi.mocked(N8nApiClient).mockImplementation(() => ({ healthCheck: vi.fn() }) as any);
    handlers = await import('@/mcp/handlers-n8n-manager');
    resetDefaultApiClient(handlers);
  });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  async function contextFor(tools: FakeTool[]) {
    fake = await startFakeOfficialMcp({ tools });
    return { n8nApiUrl: new URL(fake.url).origin, n8nMcpAccessToken: 'tok' };
  }

  it('adds a column through the official server', async () => {
    const context = await contextFor([
      {
        name: 'add_data_table_column',
        handler: (args: any) => ({ success: true, message: 'added', column: { id: 'c9', name: args.name, type: args.type } }),
      },
    ]);

    const r = await handlers.handleAddColumn(
      { action: 'addColumn', tableId: 't1', projectId: 'p1', column: { name: 'score', type: 'number' } },
      context
    );

    expect(r).toMatchObject({
      success: true,
      action: 'addColumn',
      backend: 'official-mcp',
      officialTool: 'add_data_table_column',
      data: { column: { id: 'c9', name: 'score', type: 'number' } },
    });
  });

  it('maps a root success:false answer to OFFICIAL_MCP_ERROR', async () => {
    // n8n reports a refused column write as a non-isError result whose root
    // `success` is false — the rule callOfficialTool applies for this tool family.
    const context = await contextFor([
      { name: 'add_data_table_column', handler: () => ({ success: false, message: 'duplicate column' }) },
    ]);

    const r = await handlers.handleAddColumn(
      { action: 'addColumn', tableId: 't1', projectId: 'p1', column: { name: 'score', type: 'number' } },
      context
    );

    expect(r).toMatchObject({
      success: false,
      action: 'addColumn',
      backend: 'official-mcp',
      code: 'OFFICIAL_MCP_ERROR',
      error: 'duplicate column',
    });
  });

  it('reports a missing official tool with the minimum n8n version', async () => {
    const context = await contextFor([{ name: 'search_workflows', handler: () => ({ data: [] }) }]);

    const r = await handlers.handleDeleteColumn(
      { action: 'deleteColumn', tableId: 't1', projectId: 'p1', columnId: 'c1' },
      context
    );

    expect(r).toMatchObject({
      success: false,
      action: 'deleteColumn',
      backend: 'official-mcp',
      code: 'OFFICIAL_MCP_TOOL_UNAVAILABLE',
    });
  });
});
