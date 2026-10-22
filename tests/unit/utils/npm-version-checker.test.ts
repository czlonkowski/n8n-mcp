import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../../src/utils/logger';
import {
  checkNpmVersion,
  clearVersionCheckCache,
  formatVersionMessage,
  getUpToDate,
  isVersionCheckDisabled,
} from '../../../src/utils/npm-version-checker';

vi.mock('../../../src/utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const currentVersion: string = require('../../../package.json').version;

function registryReply(version: string) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ version }) };
}

describe('npm version checker', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearVersionCheckCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.N8N_MCP_VERSION_CHECK_DISABLED;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.N8N_MCP_VERSION_CHECK_DISABLED;
  });

  describe('opt-out', () => {
    // First in the file: the warning is logged once per process
    it('warns about an unrecognised value instead of ignoring it silently', () => {
      process.env.N8N_MCP_VERSION_CHECK_DISABLED = 'yes';
      expect(isVersionCheckDisabled()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('N8N_MCP_VERSION_CHECK_DISABLED="yes"'));
    });

    it.each(['true', 'TRUE', ' 1 '])('skips the registry request when set to %j', async (value) => {
      process.env.N8N_MCP_VERSION_CHECK_DISABLED = value;

      const result = await checkNpmVersion();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.status).toBe('disabled');
      expect(result.latestVersion).toBeNull();
      expect(getUpToDate(result)).toBeNull();
      expect(formatVersionMessage(result)).toContain('disabled');
    });

    it.each(['false', '0', '', 'yes'])('keeps the check enabled for %j', (value) => {
      process.env.N8N_MCP_VERSION_CHECK_DISABLED = value;
      expect(isVersionCheckDisabled()).toBe(false);
    });

    it('skips the request even when a successful result is cached', async () => {
      fetchMock.mockResolvedValue(registryReply(currentVersion));
      await checkNpmVersion();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      process.env.N8N_MCP_VERSION_CHECK_DISABLED = 'true';
      const result = await checkNpmVersion(true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('disabled');
    });
  });

  describe('registry results', () => {
    it('reports up to date when the registry has the running version', async () => {
      fetchMock.mockResolvedValue(registryReply(currentVersion));

      const result = await checkNpmVersion();

      expect(result.status).toBe('ok');
      expect(getUpToDate(result)).toBe(true);
    });

    it('reports outdated when the registry has a newer version', async () => {
      fetchMock.mockResolvedValue(registryReply('999.0.0'));

      const result = await checkNpmVersion();

      expect(result.status).toBe('ok');
      expect(getUpToDate(result)).toBe(false);
      expect(result.updateCommand).toBe('npm install -g n8n-mcp@999.0.0');
    });

    it('reports an unknown state, not up to date, when the request fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await checkNpmVersion();

      expect(result.status).toBe('failed');
      expect(result.latestVersion).toBeNull();
      expect(getUpToDate(result)).toBeNull();
      expect(formatVersionMessage(result)).toContain('fetch failed');
    });

    it('reports an unknown state when the registry returns a non-OK status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });

      const result = await checkNpmVersion();

      expect(result.status).toBe('failed');
      expect(getUpToDate(result)).toBeNull();
    });
  });

  describe('caching', () => {
    it('keeps a successful result for an hour', async () => {
      fetchMock.mockResolvedValue(registryReply(currentVersion));
      await checkNpmVersion();

      vi.advanceTimersByTime(59 * 60 * 1000);
      await checkNpmVersion();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2 * 60 * 1000);
      await checkNpmVersion();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries a failed check after a few minutes instead of holding it for an hour', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      const failed = await checkNpmVersion();
      expect(failed.status).toBe('failed');

      // Within the failure window the cached failure is returned
      vi.advanceTimersByTime(60 * 1000);
      expect((await checkNpmVersion()).status).toBe('failed');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce(registryReply('999.0.0'));
      vi.advanceTimersByTime(5 * 60 * 1000);
      const recovered = await checkNpmVersion();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(recovered.status).toBe('ok');
      expect(getUpToDate(recovered)).toBe(false);
    });
  });
});
