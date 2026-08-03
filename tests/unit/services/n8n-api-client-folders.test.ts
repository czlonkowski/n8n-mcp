import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { N8nApiClient, N8nApiClientConfig } from '../../../src/services/n8n-api-client';
import { N8nValidationError } from '../../../src/utils/n8n-errors';
import * as dns from 'dns/promises';

// Mock DNS module for SSRF protection
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

vi.mock('axios');
vi.mock('../../../src/utils/logger');

vi.mock('../../../src/services/n8n-validation', () => ({
  cleanWorkflowForCreate: vi.fn((workflow) => workflow),
  cleanWorkflowForUpdate: vi.fn((workflow) => workflow),
}));

describe('N8nApiClient folder operations', () => {
  let client: N8nApiClient;
  let mockAxiosInstance: any;

  const defaultConfig: N8nApiClientConfig = {
    baseUrl: 'https://n8n.example.com',
    apiKey: 'test-api-key',
  };

  const axiosError = (status: number, message = 'Request failed') => {
    const error = new Error(message) as any;
    error.isAxiosError = true;
    error.config = {};
    error.response = { status, data: { message } };
    return error;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(dns.lookup).mockResolvedValue({ address: '8.8.8.8', family: 4 } as any);

    mockAxiosInstance = {
      defaults: { baseURL: 'https://n8n.example.com/api/v1' },
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
    client = new N8nApiClient(defaultConfig);
  });

  describe('CRUD methods', () => {
    it('createFolder POSTs to the project folder route (personal alias intact)', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'f1', name: 'Prod' } });

      const folder = await client.createFolder('personal', { name: 'Prod', parentFolderId: 'p1' });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/projects/personal/folders',
        { name: 'Prod', parentFolderId: 'p1' }
      );
      expect(folder).toEqual({ id: 'f1', name: 'Prod' });
    });

    it('listFolders JSON-encodes filter and select, passes paging through', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { count: 0, data: [] } });

      await client.listFolders('proj1', {
        filter: { name: 'x', parentFolderId: 'p1' },
        select: ['id', 'name'],
        sortBy: 'name:asc',
        skip: 5,
        take: 10,
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/proj1/folders', {
        params: {
          sortBy: 'name:asc',
          skip: 5,
          take: 10,
          filter: JSON.stringify({ name: 'x', parentFolderId: 'p1' }),
          select: JSON.stringify(['id', 'name']),
        },
        paramsSerializer: expect.any(Function),
      });
    });

    it('listFolders fully percent-encodes the JSON params (n8n rejects raw reserved chars)', async () => {
      // Live-caught regression: axios's default serializer leaves { } [ ] " : raw and
      // n8n answers "Parameter 'filter' must be url encoded".
      mockAxiosInstance.get.mockResolvedValue({ data: { count: 0, data: [] } });

      await client.listFolders('proj1', { filter: { name: 'FOLDER-TEST' }, select: ['id', 'name'] });

      const config = mockAxiosInstance.get.mock.calls[0][1];
      const serialized = config.paramsSerializer(config.params);
      expect(serialized).not.toMatch(/[{}\[\]":]/);
      expect(serialized).toContain(`filter=${encodeURIComponent('{"name":"FOLDER-TEST"}')}`);
      expect(serialized).toContain(`select=${encodeURIComponent('["id","name"]')}`);
    });

    it('listFolders omits empty filter and select entirely', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { count: 0, data: [] } });

      await client.listFolders('proj1', { filter: {}, select: [] });

      const params = mockAxiosInstance.get.mock.calls[0][1].params;
      expect(params).not.toHaveProperty('filter');
      expect(params).not.toHaveProperty('select');
    });

    it('updateFolder PATCHes the folder route', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { id: 'f1', name: 'Renamed' } });

      await client.updateFolder('proj1', 'f1', { name: 'Renamed' });

      expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/projects/proj1/folders/f1', { name: 'Renamed' });
    });

    it('deleteFolder sends transferToFolderId as a query param only when given', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ status: 204 });

      await client.deleteFolder('proj1', 'f1');
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/projects/proj1/folders/f1', { params: {} });

      await client.deleteFolder('proj1', 'f1', '0');
      expect(mockAxiosInstance.delete).toHaveBeenLastCalledWith('/projects/proj1/folders/f1', {
        params: { transferToFolderId: '0' },
      });
    });

    it('maps API failures through handleN8nApiError', async () => {
      mockAxiosInstance.get.mockRejectedValue(axiosError(404, 'Folder not found'));

      await expect(client.getFolder('proj1', 'missing')).rejects.toMatchObject({
        name: 'N8nNotFoundError',
        statusCode: 404,
      });
    });
  });

  describe('resolvePersonalProjectId', () => {
    it('uses the single visible personal project and caches it', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: [
          { id: 'team1', name: 'Team', type: 'team' },
          { id: 'pers1', name: 'Me', type: 'personal' },
        ] },
      });

      const first = await client.resolvePersonalProjectId();
      const second = await client.resolvePersonalProjectId();

      expect(first).toBe('pers1');
      expect(second).toBe('pers1');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // cached
    });

    it('refuses to guess between multiple personal projects', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: [
          { id: 'pers1', name: 'Alice', type: 'personal' },
          { id: 'pers2', name: 'Bob', type: 'personal' },
        ] },
      });

      await expect(client.resolvePersonalProjectId()).rejects.toThrow(/ambiguous/);
      await expect(client.resolvePersonalProjectId()).rejects.toBeInstanceOf(N8nValidationError);
    });

    it('falls back to a workflow\'s owning project when the projects API is unlicensed (403)', async () => {
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/projects') throw axiosError(403, 'feature not licensed');
        if (url === '/workflows') {
          return { data: { data: [{ id: 'wf1', shared: [{ projectId: 'pers-comm' }] }] } };
        }
        throw new Error(`unexpected GET ${url}`);
      });

      const resolved = await client.resolvePersonalProjectId();

      expect(resolved).toBe('pers-comm');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/workflows', { params: { limit: 1 } });
    });

    it('errors with guidance when neither ladder step can resolve', async () => {
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/projects') throw axiosError(403, 'feature not licensed');
        if (url === '/workflows') return { data: { data: [] } };
        throw new Error(`unexpected GET ${url}`);
      });

      await expect(client.resolvePersonalProjectId()).rejects.toThrow(/explicit projectId/);
    });

    it('rethrows unexpected /projects failures instead of probing (no wrong-project fallback)', async () => {
      // A transient 500/429 on an Enterprise instance must NOT degrade to the
      // workflow probe: the probe's "one project only" assumption holds on
      // Community, and a cached wrong resolution would outlive the outage.
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/projects') throw axiosError(500, 'boom');
        throw new Error(`unexpected GET ${url}`);
      });

      await expect(client.resolvePersonalProjectId()).rejects.toMatchObject({ statusCode: 500 });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // no /workflows probe
    });

    it('falls through to the probe on 404 (instance without the projects API)', async () => {
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/projects') throw axiosError(404, 'not found');
        if (url === '/workflows') {
          return { data: { data: [{ id: 'wf1', shared: [{ projectId: 'pers-old' }] }] } };
        }
        throw new Error(`unexpected GET ${url}`);
      });

      await expect(client.resolvePersonalProjectId()).resolves.toBe('pers-old');
    });

    it('refuses to resolve from a truncated projects listing', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: [{ id: 'pers1', name: 'Me', type: 'personal' }],
          nextCursor: 'page2',
        },
      });

      await expect(client.resolvePersonalProjectId()).rejects.toThrow(/explicit projectId/);
    });

    it('refuses to probe when a successful projects listing shows no personal project', async () => {
      // A 200 listing is authoritative: probing a workflow here could resolve
      // 'personal' to the team project the first workflow happens to live in.
      mockAxiosInstance.get.mockImplementation(async (url: string) => {
        if (url === '/projects') return { data: { data: [{ id: 'team1', name: 'Team', type: 'team' }] } };
        throw new Error(`unexpected GET ${url}`);
      });

      await expect(client.resolvePersonalProjectId()).rejects.toThrow(/no personal project/);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // no /workflows probe
    });
  });
});
