/**
 * n8n Version Detection and Version-Aware Settings Filtering
 *
 * This module provides version detection for n8n instances and filters
 * workflow settings based on what the target n8n version supports.
 *
 * VERSION HISTORY for workflowSettings in n8n Public API:
 * - All versions: 7 core properties (saveExecutionProgress, saveManualExecutions,
 *                 saveDataErrorExecution, saveDataSuccessExecution, executionTimeout,
 *                 errorWorkflow, timezone)
 * - 1.37.0+: Added executionOrder
 * - 1.119.0+: Added callerPolicy, callerIds, timeSavedPerExecution, availableInMCP
 *
 * References:
 * - https://github.com/n8n-io/n8n/pull/21297 (PR adding 4 new properties in 1.119.0)
 * - https://community.n8n.io/t/n8n-api-update-workflow-does-not-accept-executionorder-setting/44512
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { N8nVersionInfo, N8nSettingsResponse } from '../types/n8n-api';
import type { PinnedAgents } from '../utils/ssrf-protection';

// Cache version info per base URL with TTL to handle server upgrades
interface CachedVersion {
  info: N8nVersionInfo;
  fetchedAt: number;
}

// Cache TTL: 5 minutes - allows for server upgrades without requiring restart
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;

const versionCache = new Map<string, CachedVersion>();

// Settings properties supported by each n8n version range
// These are CUMULATIVE - each version adds to the previous
const SETTINGS_BY_VERSION = {
  // Core properties supported by all versions
  core: [
    'saveExecutionProgress',
    'saveManualExecutions',
    'saveDataErrorExecution',
    'saveDataSuccessExecution',
    'executionTimeout',
    'errorWorkflow',
    'timezone',
  ],
  // Added in n8n 1.37.0
  v1_37_0: [
    'executionOrder',
  ],
  // Added in n8n 1.119.0 (PR #21297)
  v1_119_0: [
    'callerPolicy',
    'callerIds',
    'timeSavedPerExecution',
    'availableInMCP',
  ],
};

/**
 * Parse version string into structured version info
 */
export function parseVersion(versionString: string): N8nVersionInfo | null {
  // Handle formats like "1.119.0", "1.37.0-beta.1", "0.200.0", "v1.2.3"
  // Support optional 'v' prefix for robustness
  const match = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    version: versionString,
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two versions: returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(a: N8nVersionInfo, b: N8nVersionInfo): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Check if version meets minimum requirement
 */
export function versionAtLeast(version: N8nVersionInfo, major: number, minor: number, patch = 0): boolean {
  const target = { version: '', major, minor, patch };
  return compareVersions(version, target) >= 0;
}

/**
 * Get supported settings properties for a given n8n version
 */
export function getSupportedSettingsProperties(version: N8nVersionInfo): Set<string> {
  const supported = new Set<string>(SETTINGS_BY_VERSION.core);

  // Add executionOrder if >= 1.37.0
  if (versionAtLeast(version, 1, 37, 0)) {
    SETTINGS_BY_VERSION.v1_37_0.forEach(prop => supported.add(prop));
  }

  // Add new properties if >= 1.119.0
  if (versionAtLeast(version, 1, 119, 0)) {
    SETTINGS_BY_VERSION.v1_119_0.forEach(prop => supported.add(prop));
  }

  return supported;
}

/**
 * Fetch n8n version from /rest/settings endpoint
 *
 * This endpoint is available on all n8n instances and doesn't require authentication.
 * Note: There's a security concern about this being unauthenticated (see n8n community),
 * but it's the only reliable way to get version info.
 */
export async function fetchN8nVersion(
  baseUrl: string,
  options?: { headers?: Record<string, string>; pinnedAgents?: PinnedAgents }
): Promise<N8nVersionInfo | null> {
  const { headers, pinnedAgents } = options ?? {};
  // Check cache first (with TTL)
  const cached = versionCache.get(baseUrl);
  if (cached && Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS) {
    logger.debug(`Using cached n8n version for ${baseUrl}: ${cached.info.version}`);
    return cached.info;
  }

  try {
    // Remove /api/v1 suffix if present to get base URL
    const cleanBaseUrl = baseUrl.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
    const settingsUrl = `${cleanBaseUrl}/rest/settings`;

    logger.debug(`Fetching n8n version from ${settingsUrl}`);

    // SECURITY (GHSA-cmrh-wvq6-wm9r): pin transport when caller supplied agents.
    const response = await axios.get<N8nSettingsResponse>(settingsUrl, {
      timeout: 5000,
      headers,
      validateStatus: (status: number) => status < 500,
      maxRedirects: 0,
      httpAgent: pinnedAgents?.httpAgent,
      httpsAgent: pinnedAgents?.httpsAgent,
    });

    if (response.status === 200 && response.data) {
      // n8n wraps the settings in a "data" property
      const settings = response.data.data;
      if (!settings) {
        logger.warn('No data in settings response');
        return null;
      }

      // n8n can return version in different fields - validate type
      const versionString = typeof settings.n8nVersion === 'string'
        ? settings.n8nVersion
        : typeof settings.versionCli === 'string'
          ? settings.versionCli
          : null;

      if (versionString) {
        const versionInfo = parseVersion(versionString);
        if (versionInfo) {
          // Cache the result with timestamp
          versionCache.set(baseUrl, { info: versionInfo, fetchedAt: Date.now() });
          logger.debug(`Detected n8n version: ${versionInfo.version}`);
          return versionInfo;
        }
      }
    }

    logger.warn(`Could not determine n8n version from ${settingsUrl}`);
    return null;
  } catch (error) {
    logger.warn(`Failed to fetch n8n version: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Clear version cache (useful for testing or when server changes)
 */
export function clearVersionCache(): void {
  versionCache.clear();
}

/**
 * Get cached version for a base URL (or null if not cached or expired)
 */
export function getCachedVersion(baseUrl: string): N8nVersionInfo | null {
  const cached = versionCache.get(baseUrl);
  if (cached && Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS) {
    return cached.info;
  }
  return null;
}

/**
 * Set cached version (useful for testing or when version is known)
 */
export function setCachedVersion(baseUrl: string, version: N8nVersionInfo): void {
  versionCache.set(baseUrl, { info: version, fetchedAt: Date.now() });
}

/**
 * Clean workflow settings for API update based on n8n version
 *
 * This function filters workflow settings to only include properties
 * that the target n8n version supports, preventing "additional properties" errors.
 *
 * @param settings - The workflow settings to clean
 * @param version - The target n8n version (if null, returns settings unchanged)
 * @returns Cleaned settings object
 */
export function cleanSettingsForVersion(
  settings: Record<string, unknown> | undefined,
  version: N8nVersionInfo | null
): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') {
    return {};
  }

  // If version unknown, return settings unchanged (let the API decide)
  if (!version) {
    return settings;
  }

  const supportedProperties = getSupportedSettingsProperties(version);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (supportedProperties.has(key)) {
      cleaned[key] = value;
    } else {
      logger.debug(`Filtered out unsupported settings property: ${key} (n8n ${version.version})`);
    }
  }

  return cleaned;
}

// Export version thresholds for testing
export const VERSION_THRESHOLDS = {
  EXECUTION_ORDER: { major: 1, minor: 37, patch: 0 },
  CALLER_POLICY: { major: 1, minor: 119, patch: 0 },
};
