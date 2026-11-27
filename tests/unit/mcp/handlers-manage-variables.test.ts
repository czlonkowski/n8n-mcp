import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { N8nApiClient } from '@/services/n8n-api-client';
import { N8nApiError } from '@/utils/n8n-errors';

vi.mock('@/services/n8n-api-client');
vi.mock('@/config/n8n-api', () => ({
  getN8nApiConfig: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  Logger: vi.fn().mockImplementation(function () { return ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }); }),
  LogLevel: { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 },
}));

const project = {
  id: 'proj1',
  name: 'Marketing',
  type: 'team',
  icon: null,
  description: null,
  customTelemetryTags: [],
  creatorId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};
const globalVar = { id: 'v1', key: 'API_URL', value: 'https://api.example.com', type: 'string', project: null };
const projectVar = { id: 'v2', key: 'API_URL', value: 'https://mkt.example.com', type: 'string', project };
const otherVar = { id: 'v3', key: 'CHANNEL', value: '#alerts', type: 'string', project: null };

describe('Variable Handlers (n8n_manage_variables)', () => {
  let mockApiClient: any;
  let handlers: any;
  let getN8nApiConfig: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockApiClient = {
      listVariables: vi.fn().mockResolvedValue({ data: [globalVar, projectVar, otherVar], nextCursor: null }),
      createVariable: vi.fn().mockResolvedValue(undefined),
      updateVariable: vi.fn().mockResolvedValue(undefined),
      deleteVariable: vi.fn().mockResolvedValue(undefined),
    };
    getN8nApiConfig = (await import('@/config/n8n-api')).getN8nApiConfig;
    vi.mocked(getN8nApiConfig).mockReturnValue({
      baseUrl: 'https://n8n.test.com',
      apiKey: 'test-key',
      timeout: 30000,
      maxRetries: 3,
    });
    vi.mocked(N8nApiClient).mockImplementation(function () { return mockApiClient; });
    handlers = await import('@/mcp/handlers-n8n-manager');
  });

  afterEach(() => {
    // Reset the module-level default client singleton so the next test's mock is used.
    if (handlers?.getN8nApiClient) {
      vi.mocked(getN8nApiConfig).mockReturnValue(null);
      handlers.getN8nApiClient();
    }
  });

  describe('list', () => {
    it("maps projectId 'global' to n8n's 'null' filter and drops empty-string fields", async () => {
      await handlers.handleListVariables({ action: 'list', projectId: 'global', cursor: '', state: '' });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ projectId: 'null' });
    });

    it('returns compact project info and the next cursor', async () => {
      mockApiClient.listVariables.mockResolvedValue({ data: [projectVar], nextCursor: 'next1' });
      const result = await handlers.handleListVariables({ action: 'list', limit: 1, state: 'empty' });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ limit: 1, state: 'empty' });
      expect(result.success).toBe(true);
      expect(result.data.variables[0].project).toEqual({ id: 'proj1', name: 'Marketing' });
      expect(result.data.nextCursor).toBe('next1');
    });

    it('treats a null projectId as no filter', async () => {
      await handlers.handleListVariables({ action: 'list', projectId: null });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({});
    });

    it('treats a blank limit as omitted', async () => {
      const result = await handlers.handleListVariables({ action: 'list', limit: '' });
      expect(result.success).toBe(true);
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({});
    });

    it('rejects a limit above the 250 n8n accepts', async () => {
      const result = await handlers.handleListVariables({ action: 'list', limit: 500 });
      expect(result.success).toBe(false);
      expect(mockApiClient.listVariables).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('finds a variable by id across pages', async () => {
      mockApiClient.listVariables
        .mockResolvedValueOnce({ data: [globalVar], nextCursor: 'c2' })
        .mockResolvedValueOnce({ data: [otherVar], nextCursor: null });
      const result = await handlers.handleGetVariable({ action: 'get', id: 'v3' });
      expect(mockApiClient.listVariables).toHaveBeenNthCalledWith(2, { limit: 250, cursor: 'c2' });
      expect(result.success).toBe(true);
      expect(result.data.key).toBe('CHANNEL');
    });

    it('refuses to guess when a key exists both globally and in a project', async () => {
      const result = await handlers.handleGetVariable({ action: 'get', key: 'API_URL' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/2 variables share key "API_URL"/);
      expect(result.details.matches.map((m: any) => m.id)).toEqual(['v1', 'v2']);
    });

    it('narrows a key lookup to the global scope', async () => {
      mockApiClient.listVariables.mockResolvedValue({ data: [globalVar, otherVar], nextCursor: null });
      const result = await handlers.handleGetVariable({ action: 'get', key: 'API_URL', projectId: 'global' });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ limit: 250, projectId: 'null' });
      expect(result.data.id).toBe('v1');
    });

    it('fails instead of picking the id when id and key name different variables', async () => {
      const result = await handlers.handleGetVariable({ action: 'get', id: 'v3', key: 'API_URL' });
      expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
      expect(result.error).toContain('id v3 and key "API_URL"');
    });

    it('accepts a null projectId', async () => {
      const result = await handlers.handleGetVariable({ action: 'get', id: 'v3', projectId: null });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ limit: 250 });
      expect(result.success).toBe(true);
    });

    it('fails with INCOMPLETE_SEARCH when an unscoped key scan hit the page cap', async () => {
      mockApiClient.listVariables
        .mockResolvedValueOnce({ data: [otherVar], nextCursor: 'more' })
        .mockResolvedValue({ data: [globalVar], nextCursor: 'more' });
      const result = await handlers.handleGetVariable({ action: 'get', key: 'CHANNEL' });
      expect(mockApiClient.listVariables).toHaveBeenCalledTimes(40);
      expect(result).toMatchObject({ success: false, code: 'INCOMPLETE_SEARCH' });
      expect(result.details.matches).toHaveLength(1);
    });

    it('stops paging once an id lookup finds its variable', async () => {
      mockApiClient.listVariables.mockResolvedValue({ data: [globalVar], nextCursor: 'more' });
      const result = await handlers.handleGetVariable({ action: 'get', id: 'v1' });
      expect(mockApiClient.listVariables).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('stops paging once a scoped key lookup finds its variable', async () => {
      mockApiClient.listVariables.mockResolvedValue({ data: [globalVar], nextCursor: 'more' });
      const result = await handlers.handleGetVariable({ action: 'get', key: 'API_URL', projectId: 'global' });
      expect(mockApiClient.listVariables).toHaveBeenCalledTimes(1);
      expect(result.data.id).toBe('v1');
    });

    it('returns NOT_FOUND for an unknown id', async () => {
      const result = await handlers.handleGetVariable({ action: 'get', id: 'missing' });
      expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
    });

    it('requires id or key', async () => {
      const result = await handlers.handleGetVariable({ action: 'get', id: '', key: '' });
      expect(result.success).toBe(false);
      expect(mockApiClient.listVariables).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a global variable and reads its id back from the global scope', async () => {
      const created = { id: 'v9', key: 'NEW_KEY', value: 'x', type: 'string', project: null };
      mockApiClient.listVariables.mockResolvedValue({ data: [globalVar, created], nextCursor: null });
      const result = await handlers.handleCreateVariable({ action: 'create', key: 'NEW_KEY', value: 'x', projectId: '' });
      expect(mockApiClient.createVariable).toHaveBeenCalledWith({ key: 'NEW_KEY', value: 'x' });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ limit: 250, projectId: 'null' });
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('v9');
      expect(result.message).toContain('{{ $vars.NEW_KEY }}');
    });

    it('reads the id back from the project when created in one', async () => {
      const created = { id: 'v10', key: 'NEW_KEY', value: 'x', type: 'string', project };
      mockApiClient.listVariables.mockResolvedValue({ data: [created], nextCursor: null });
      const result = await handlers.handleCreateVariable({ action: 'create', key: 'NEW_KEY', value: 'x', projectId: 'proj1' });
      expect(mockApiClient.createVariable).toHaveBeenCalledWith({ key: 'NEW_KEY', value: 'x', projectId: 'proj1' });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ limit: 250, projectId: 'proj1' });
      expect(result.data.id).toBe('v10');
    });

    it.each([null, 'global', 'Global'])('creates a global variable for projectId %s', async (projectId) => {
      await handlers.handleCreateVariable({ action: 'create', key: 'NEW_KEY', value: 'x', projectId });
      expect(mockApiClient.createVariable).toHaveBeenCalledWith({ key: 'NEW_KEY', value: 'x' });
      expect(mockApiClient.listVariables).toHaveBeenCalledWith({ limit: 250, projectId: 'null' });
    });

    it('accepts an empty value', async () => {
      await handlers.handleCreateVariable({ action: 'create', key: 'EMPTY', value: '' });
      expect(mockApiClient.createVariable).toHaveBeenCalledWith({ key: 'EMPTY', value: '' });
    });

    it('still reports success when the id lookup fails after the create', async () => {
      mockApiClient.listVariables.mockRejectedValue(new N8nApiError('boom', 500, 'SERVER_ERROR'));
      const result = await handlers.handleCreateVariable({ action: 'create', key: 'NEW_KEY', value: 'x' });
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/could not be read back/);
    });

    it.each(['1ABC', 'has-dash', 'a'.repeat(51)])('rejects key %s before calling n8n', async (key) => {
      const result = await handlers.handleCreateVariable({ action: 'create', key, value: 'x' });
      expect(result.success).toBe(false);
      // The field is named in the message itself, since some clients drop `details`.
      expect(result.error).toMatch(/^Invalid input - key: /);
      expect(mockApiClient.createVariable).not.toHaveBeenCalled();
    });

    it('states the key rule in the error message', async () => {
      const result = await handlers.handleCreateVariable({ action: 'create', key: '1bad-key', value: 'x' });
      expect(result.error).toBe(
        'Invalid input - key: key may contain only letters, digits and underscores, and must not start with a digit'
      );
      expect(result.details.errors[0].path).toEqual(['key']);
    });

    it('rejects a value over 1000 characters', async () => {
      const result = await handlers.handleCreateVariable({ action: 'create', key: 'K', value: 'x'.repeat(1001) });
      expect(result.success).toBe(false);
      expect(mockApiClient.createVariable).not.toHaveBeenCalled();
    });

    it('points a duplicate key at update', async () => {
      mockApiClient.createVariable.mockRejectedValue(
        new N8nApiError('A global variable with key "API_URL" already exists', 400, 'VALIDATION_ERROR')
      );
      const result = await handlers.handleCreateVariable({ action: 'create', key: 'API_URL', value: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists\. Keys are unique per scope/);
    });

    it('explains the license requirement on 403', async () => {
      mockApiClient.createVariable.mockRejectedValue(
        new N8nApiError('Your license does not allow for feat:variables', 403, 'API_ERROR')
      );
      const result = await handlers.handleCreateVariable({ action: 'create', key: 'K', value: 'x' });
      expect(result.error).toMatch(/feat:variables\. Variables need an n8n license/);
    });
  });

  describe('update', () => {
    it('fills the omitted key from the current variable, since n8n PUT needs both', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v3', value: '#ops' });
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v3', { key: 'CHANNEL', value: '#ops' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'v3', key: 'CHANNEL', value: '#ops', project: null });
    });

    it('does not wipe the value when a client sends an empty string for it', async () => {
      await handlers.handleUpdateVariable({ action: 'update', id: 'v3', key: 'ALERT_CHANNEL', value: '', projectId: '' });
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v3', { key: 'ALERT_CHANNEL', value: '#alerts' });
    });

    it('keeps the scope and skips the lookup when key and value are both given', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v2', key: 'API_URL', value: 'z' });
      expect(mockApiClient.listVariables).not.toHaveBeenCalled();
      // No projectId in the body: sending null would silently make the variable global.
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v2', { key: 'API_URL', value: 'z' });
      expect(result.data).toEqual({ id: 'v2', key: 'API_URL', value: 'z' });
    });

    it('empties the value with clearValue', async () => {
      await handlers.handleUpdateVariable({ action: 'update', id: 'v3', clearValue: true, value: '' });
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v3', { key: 'CHANNEL', value: '' });
    });

    it('treats a blank clearValue as omitted', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v1', value: 'new', clearValue: '' });
      expect(result.success).toBe(true);
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v1', expect.objectContaining({ value: 'new' }));
    });

    it('stops paging once the lookup finds the variable to update', async () => {
      mockApiClient.listVariables.mockResolvedValue({ data: [globalVar], nextCursor: 'more' });
      await handlers.handleUpdateVariable({ action: 'update', id: 'v1', value: 'new' });
      expect(mockApiClient.listVariables).toHaveBeenCalledTimes(1);
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v1', { key: 'API_URL', value: 'new' });
    });

    it('rejects clearValue together with a value', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v3', clearValue: true, value: 'x' });
      expect(result.success).toBe(false);
      expect(mockApiClient.updateVariable).not.toHaveBeenCalled();
    });

    it('keeps a whitespace-only value as a real value', async () => {
      await handlers.handleUpdateVariable({ action: 'update', id: 'v3', value: ' ' });
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v3', { key: 'CHANNEL', value: ' ' });
    });

    it('rejects renaming to a key that starts with a digit', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v3', key: '1CHANNEL' });
      expect(result.error).toMatch(/^Invalid input - key: key may contain only letters/);
      expect(mockApiClient.updateVariable).not.toHaveBeenCalled();
    });

    it.each([null, 'global', 'GLOBAL'])('moves the variable to the global scope for projectId %s', async (projectId) => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v2', key: 'API_URL', value: 'y', projectId });
      expect(mockApiClient.listVariables).not.toHaveBeenCalled();
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v2', { key: 'API_URL', value: 'y', projectId: null });
      expect(result.message).toMatch(/moved to the global scope/);
    });

    it('moves the variable into a project', async () => {
      await handlers.handleUpdateVariable({ action: 'update', id: 'v1', projectId: 'proj1' });
      expect(mockApiClient.updateVariable).toHaveBeenCalledWith('v1', {
        key: 'API_URL', value: 'https://api.example.com', projectId: 'proj1',
      });
    });

    it('returns NOT_FOUND without calling PUT when the id is unknown', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'missing', value: 'x' });
      expect(result).toMatchObject({ success: false, code: 'NOT_FOUND' });
      expect(mockApiClient.updateVariable).not.toHaveBeenCalled();
    });

    it('rejects an update with nothing to change', async () => {
      const result = await handlers.handleUpdateVariable({ action: 'update', id: 'v1', key: '', value: '' });
      expect(result.success).toBe(false);
      expect(mockApiClient.updateVariable).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes by id', async () => {
      const result = await handlers.handleDeleteVariable({ action: 'delete', id: 'v1' });
      expect(mockApiClient.deleteVariable).toHaveBeenCalledWith('v1');
      expect(result.data).toEqual({ id: 'v1', deleted: true });
    });

    it('adds a lookup hint on 404', async () => {
      mockApiClient.deleteVariable.mockRejectedValue(new N8nApiError('Variable with id v1 not found', 404, 'NOT_FOUND'));
      const result = await handlers.handleDeleteVariable({ action: 'delete', id: 'v1' });
      expect(result.error).toMatch(/not found\. Check the variable id/);
    });

    // n8n answers 403 (not 404) when the id does not exist.
    const forbidden = () => new N8nApiError('You are not allowed to delete this variable', 403, 'API_ERROR');

    it('reports NOT_FOUND when n8n returns 403 for an id no visible variable has', async () => {
      mockApiClient.deleteVariable.mockRejectedValue(forbidden());
      const result = await handlers.handleDeleteVariable({ action: 'delete', id: 'missing' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.error).toMatch(/No variable with id missing is visible/);
      expect(result.error).not.toMatch(/license/);
    });

    it('keeps the license hint on 403 when the variable exists', async () => {
      mockApiClient.deleteVariable.mockRejectedValue(forbidden());
      const result = await handlers.handleDeleteVariable({ action: 'delete', id: 'v2' });
      expect(result.code).not.toBe('NOT_FOUND');
      expect(result.error).toMatch(/Variables need an n8n license/);
    });

    it('keeps the license hint on 403 when the lookup itself fails', async () => {
      mockApiClient.deleteVariable.mockRejectedValue(forbidden());
      mockApiClient.listVariables.mockRejectedValue(new N8nApiError('Forbidden', 403, 'API_ERROR'));
      const result = await handlers.handleDeleteVariable({ action: 'delete', id: 'missing' });
      expect(result.code).not.toBe('NOT_FOUND');
      expect(result.error).toMatch(/Variables need an n8n license/);
    });

    it('keeps the license hint on 403 when the lookup stops at the page cap', async () => {
      mockApiClient.deleteVariable.mockRejectedValue(forbidden());
      mockApiClient.listVariables.mockResolvedValue({ data: [otherVar], nextCursor: 'more' });
      const result = await handlers.handleDeleteVariable({ action: 'delete', id: 'missing' });
      expect(result.code).not.toBe('NOT_FOUND');
      expect(result.error).toMatch(/Variables need an n8n license/);
    });
  });
});
