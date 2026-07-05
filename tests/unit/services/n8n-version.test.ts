import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import {
  parseVersion,
  compareVersions,
  versionAtLeast,
  getSupportedSettingsProperties,
  cleanSettingsForVersion,
  clearVersionCache,
  setCachedVersion,
  getCachedVersion,
  fetchN8nVersion,
  VERSION_THRESHOLDS,
} from '@/services/n8n-version';
import type { N8nVersionInfo } from '@/types/n8n-api';
import type { PinnedAgents } from '@/utils/ssrf-protection';

vi.mock('axios');
vi.mock('@/utils/logger');

describe('n8n-version', () => {
  beforeEach(() => {
    clearVersionCache();
    vi.clearAllMocks();
  });

  describe('parseVersion', () => {
    it('should parse standard version strings', () => {
      expect(parseVersion('1.119.0')).toEqual({
        version: '1.119.0',
        major: 1,
        minor: 119,
        patch: 0,
      });

      expect(parseVersion('1.37.0')).toEqual({
        version: '1.37.0',
        major: 1,
        minor: 37,
        patch: 0,
      });

      expect(parseVersion('0.200.0')).toEqual({
        version: '0.200.0',
        major: 0,
        minor: 200,
        patch: 0,
      });
    });

    it('should parse beta/pre-release versions', () => {
      const result = parseVersion('1.119.0-beta.1');
      expect(result).toEqual({
        version: '1.119.0-beta.1',
        major: 1,
        minor: 119,
        patch: 0,
      });
    });

    it('should return null for invalid versions', () => {
      expect(parseVersion('invalid')).toBeNull();
      expect(parseVersion('')).toBeNull();
      expect(parseVersion('1.2')).toBeNull();
    });

    it('should handle v prefix in version strings', () => {
      const result = parseVersion('v1.2.3');
      expect(result).toEqual({
        version: 'v1.2.3',
        major: 1,
        minor: 2,
        patch: 3,
      });
    });
  });

  describe('compareVersions', () => {
    it('should compare major versions correctly', () => {
      const v1 = parseVersion('1.0.0')!;
      const v2 = parseVersion('2.0.0')!;
      expect(compareVersions(v1, v2)).toBeLessThan(0);
      expect(compareVersions(v2, v1)).toBeGreaterThan(0);
    });

    it('should compare minor versions correctly', () => {
      const v1 = parseVersion('1.37.0')!;
      const v2 = parseVersion('1.119.0')!;
      expect(compareVersions(v1, v2)).toBeLessThan(0);
      expect(compareVersions(v2, v1)).toBeGreaterThan(0);
    });

    it('should compare patch versions correctly', () => {
      const v1 = parseVersion('1.119.0')!;
      const v2 = parseVersion('1.119.1')!;
      expect(compareVersions(v1, v2)).toBeLessThan(0);
    });

    it('should return 0 for equal versions', () => {
      const v1 = parseVersion('1.119.0')!;
      const v2 = parseVersion('1.119.0')!;
      expect(compareVersions(v1, v2)).toBe(0);
    });
  });

  describe('versionAtLeast', () => {
    it('should return true when version meets requirement', () => {
      const v = parseVersion('1.119.0')!;
      expect(versionAtLeast(v, 1, 119, 0)).toBe(true);
      expect(versionAtLeast(v, 1, 37, 0)).toBe(true);
      expect(versionAtLeast(v, 1, 0, 0)).toBe(true);
      expect(versionAtLeast(v, 0, 200, 0)).toBe(true);
    });

    it('should return false when version is too old', () => {
      const v = parseVersion('1.36.0')!;
      expect(versionAtLeast(v, 1, 37, 0)).toBe(false);
      expect(versionAtLeast(v, 1, 119, 0)).toBe(false);
      expect(versionAtLeast(v, 2, 0, 0)).toBe(false);
    });

    it('should handle edge cases at version boundaries', () => {
      const v37 = parseVersion('1.37.0')!;
      const v36 = parseVersion('1.36.99')!;

      expect(versionAtLeast(v37, 1, 37, 0)).toBe(true);
      expect(versionAtLeast(v36, 1, 37, 0)).toBe(false);
    });
  });

  describe('getSupportedSettingsProperties', () => {
    it('should return core properties for old versions (< 1.37.0)', () => {
      const v = parseVersion('1.30.0')!;
      const supported = getSupportedSettingsProperties(v);

      // Core properties should be supported
      expect(supported.has('saveExecutionProgress')).toBe(true);
      expect(supported.has('saveManualExecutions')).toBe(true);
      expect(supported.has('saveDataErrorExecution')).toBe(true);
      expect(supported.has('saveDataSuccessExecution')).toBe(true);
      expect(supported.has('executionTimeout')).toBe(true);
      expect(supported.has('errorWorkflow')).toBe(true);
      expect(supported.has('timezone')).toBe(true);

      // executionOrder should NOT be supported
      expect(supported.has('executionOrder')).toBe(false);

      // New properties should NOT be supported
      expect(supported.has('callerPolicy')).toBe(false);
      expect(supported.has('callerIds')).toBe(false);
      expect(supported.has('timeSavedPerExecution')).toBe(false);
      expect(supported.has('availableInMCP')).toBe(false);
    });

    it('should return core + executionOrder for v1.37.0+', () => {
      const v = parseVersion('1.37.0')!;
      const supported = getSupportedSettingsProperties(v);

      // Core properties
      expect(supported.has('saveExecutionProgress')).toBe(true);
      expect(supported.has('timezone')).toBe(true);

      // executionOrder should be supported
      expect(supported.has('executionOrder')).toBe(true);

      // New properties should NOT be supported
      expect(supported.has('callerPolicy')).toBe(false);
    });

    it('should return all properties for v1.119.0+', () => {
      const v = parseVersion('1.119.0')!;
      const supported = getSupportedSettingsProperties(v);

      // All 12 properties should be supported
      expect(supported.has('saveExecutionProgress')).toBe(true);
      expect(supported.has('saveManualExecutions')).toBe(true);
      expect(supported.has('saveDataErrorExecution')).toBe(true);
      expect(supported.has('saveDataSuccessExecution')).toBe(true);
      expect(supported.has('executionTimeout')).toBe(true);
      expect(supported.has('errorWorkflow')).toBe(true);
      expect(supported.has('timezone')).toBe(true);
      expect(supported.has('executionOrder')).toBe(true);
      expect(supported.has('callerPolicy')).toBe(true);
      expect(supported.has('callerIds')).toBe(true);
      expect(supported.has('timeSavedPerExecution')).toBe(true);
      expect(supported.has('availableInMCP')).toBe(true);

      expect(supported.size).toBe(12);
    });
  });

  describe('cleanSettingsForVersion', () => {
    const fullSettings = {
      saveExecutionProgress: false,
      saveManualExecutions: true,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'none',
      executionTimeout: 3600,
      errorWorkflow: '',
      timezone: 'UTC',
      executionOrder: 'v1',
      callerPolicy: 'workflowsFromSameOwner',
      callerIds: '',
      timeSavedPerExecution: 0,
      availableInMCP: false,
    };

    it('should filter to core properties for old versions', () => {
      const v = parseVersion('1.30.0')!;
      const cleaned = cleanSettingsForVersion(fullSettings, v);

      expect(Object.keys(cleaned)).toHaveLength(7);
      expect(cleaned).toHaveProperty('saveExecutionProgress');
      expect(cleaned).toHaveProperty('timezone');
      expect(cleaned).not.toHaveProperty('executionOrder');
      expect(cleaned).not.toHaveProperty('callerPolicy');
    });

    it('should include executionOrder for v1.37.0+', () => {
      const v = parseVersion('1.37.0')!;
      const cleaned = cleanSettingsForVersion(fullSettings, v);

      expect(Object.keys(cleaned)).toHaveLength(8);
      expect(cleaned).toHaveProperty('executionOrder');
      expect(cleaned).not.toHaveProperty('callerPolicy');
    });

    it('should include all properties for v1.119.0+', () => {
      const v = parseVersion('1.119.0')!;
      const cleaned = cleanSettingsForVersion(fullSettings, v);

      expect(Object.keys(cleaned)).toHaveLength(12);
      expect(cleaned).toHaveProperty('callerPolicy');
      expect(cleaned).toHaveProperty('availableInMCP');
    });

    it('should return settings unchanged when version is null', () => {
      // When version unknown, return settings unchanged (let API decide)
      const cleaned = cleanSettingsForVersion(fullSettings, null);
      expect(cleaned).toEqual(fullSettings);
    });

    it('should handle empty settings', () => {
      const v = parseVersion('1.119.0')!;
      expect(cleanSettingsForVersion({}, v)).toEqual({});
      expect(cleanSettingsForVersion(undefined, v)).toEqual({});
    });
  });

  describe('Version cache', () => {
    it('should cache and retrieve versions', () => {
      const baseUrl = 'http://localhost:5678';
      const version: N8nVersionInfo = {
        version: '1.119.0',
        major: 1,
        minor: 119,
        patch: 0,
      };

      expect(getCachedVersion(baseUrl)).toBeNull();

      setCachedVersion(baseUrl, version);
      expect(getCachedVersion(baseUrl)).toEqual(version);

      clearVersionCache();
      expect(getCachedVersion(baseUrl)).toBeNull();
    });

    it('should handle multiple base URLs', () => {
      const url1 = 'http://localhost:5678';
      const url2 = 'http://production:5678';

      const v1: N8nVersionInfo = { version: '1.119.0', major: 1, minor: 119, patch: 0 };
      const v2: N8nVersionInfo = { version: '1.37.0', major: 1, minor: 37, patch: 0 };

      setCachedVersion(url1, v1);
      setCachedVersion(url2, v2);

      expect(getCachedVersion(url1)).toEqual(v1);
      expect(getCachedVersion(url2)).toEqual(v2);
    });
  });

  describe('fetchN8nVersion', () => {
    const baseUrl = 'https://n8n.example.com';
    const settingsUrl = 'https://n8n.example.com/rest/settings';

    const settingsResponse = {
      status: 200,
      data: { data: { n8nVersion: '1.119.0' } },
    };

    it('forwards Cloudflare Access headers when supplied', async () => {
      vi.mocked(axios.get).mockResolvedValue(settingsResponse);

      const headers = {
        'CF-Access-Client-Id': 'cf-id',
        'CF-Access-Client-Secret': 'cf-secret',
      };

      const version = await fetchN8nVersion(baseUrl, { headers });

      expect(version).toEqual({ version: '1.119.0', major: 1, minor: 119, patch: 0 });
      expect(axios.get).toHaveBeenCalledWith(
        settingsUrl,
        expect.objectContaining({ headers })
      );
    });

    it('omits headers when none are supplied', async () => {
      vi.mocked(axios.get).mockResolvedValue(settingsResponse);

      await fetchN8nVersion(baseUrl);

      expect(axios.get).toHaveBeenCalledWith(
        settingsUrl,
        expect.objectContaining({ headers: undefined })
      );
    });

    it('pins transport agents so SSRF protection stays intact', async () => {
      vi.mocked(axios.get).mockResolvedValue(settingsResponse);

      const pinnedAgents = {
        httpAgent: { pinned: 'http' },
        httpsAgent: { pinned: 'https' },
      } as unknown as PinnedAgents;

      await fetchN8nVersion(baseUrl, { pinnedAgents });

      expect(axios.get).toHaveBeenCalledWith(
        settingsUrl,
        expect.objectContaining({
          httpAgent: pinnedAgents.httpAgent,
          httpsAgent: pinnedAgents.httpsAgent,
          maxRedirects: 0,
        })
      );
    });

    it('forwards both CF headers and pinned agents together', async () => {
      vi.mocked(axios.get).mockResolvedValue(settingsResponse);

      const headers = { 'CF-Access-Client-Id': 'cf-id' };
      const pinnedAgents = {
        httpAgent: { pinned: 'http' },
        httpsAgent: { pinned: 'https' },
      } as unknown as PinnedAgents;

      await fetchN8nVersion(baseUrl, { headers, pinnedAgents });

      expect(axios.get).toHaveBeenCalledWith(
        settingsUrl,
        expect.objectContaining({
          headers,
          httpAgent: pinnedAgents.httpAgent,
          httpsAgent: pinnedAgents.httpsAgent,
        })
      );
    });

    it('returns cached version without issuing a second request', async () => {
      vi.mocked(axios.get).mockResolvedValue(settingsResponse);

      await fetchN8nVersion(baseUrl, { headers: { 'CF-Access-Client-Id': 'cf-id' } });
      const cached = await fetchN8nVersion(baseUrl);

      expect(cached).toEqual({ version: '1.119.0', major: 1, minor: 119, patch: 0 });
      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('VERSION_THRESHOLDS', () => {
    it('should have correct threshold values', () => {
      expect(VERSION_THRESHOLDS.EXECUTION_ORDER).toEqual({ major: 1, minor: 37, patch: 0 });
      expect(VERSION_THRESHOLDS.CALLER_POLICY).toEqual({ major: 1, minor: 119, patch: 0 });
    });
  });

  describe('Real-world version scenarios', () => {
    it('should handle n8n cloud versions', () => {
      // Cloud typically runs latest
      const cloudVersion = parseVersion('1.125.0')!;
      const supported = getSupportedSettingsProperties(cloudVersion);
      expect(supported.size).toBe(12);
    });

    it('should handle self-hosted older versions', () => {
      // Common self-hosted older version
      const selfHosted = parseVersion('1.50.0')!;
      const supported = getSupportedSettingsProperties(selfHosted);

      expect(supported.has('executionOrder')).toBe(true);
      expect(supported.has('callerPolicy')).toBe(false);
    });

    it('should handle workflow migration scenario', () => {
      // Workflow from n8n 1.119+ with all settings
      const fullSettings = {
        saveExecutionProgress: true,
        executionOrder: 'v1',
        callerPolicy: 'workflowsFromSameOwner',
        callerIds: '',
        timeSavedPerExecution: 5,
        availableInMCP: true,
      };

      // Updating to n8n 1.100 (older)
      const targetVersion = parseVersion('1.100.0')!;
      const cleaned = cleanSettingsForVersion(fullSettings, targetVersion);

      // Should filter out properties not supported in 1.100
      expect(cleaned).toHaveProperty('executionOrder');
      expect(cleaned).not.toHaveProperty('callerPolicy');
      expect(cleaned).not.toHaveProperty('availableInMCP');
    });
  });
});
