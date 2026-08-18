/**
 * n8n Version Detection and Version-Aware Settings Filtering
 *
 * This module provides version detection for n8n instances and filters
 * workflow settings based on what the target n8n version supports.
 *
 * Which property arrived in which version lives in constants/workflow-settings.ts, together
 * with the pass-through floor at or above which settings are forwarded untouched.
 *
 * References:
 * - https://github.com/n8n-io/n8n/pull/21297 (PR adding 4 new properties in 1.119.0)
 * - https://community.n8n.io/t/n8n-api-update-workflow-does-not-accept-executionorder-setting/44512
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { N8nVersionInfo, N8nSettingsResponse } from '../types/n8n-api';
import type { PinnedAgents } from '../utils/ssrf-protection';
import {
  DERIVED_SETTINGS_PROPERTIES,
  SETTINGS_PASS_THROUGH_FLOOR,
  WORKFLOW_SETTINGS_PROPERTIES,
} from '../constants/workflow-settings';

// Cache version info per base URL with TTL to handle server upgrades
interface CachedVersion {
  info: N8nVersionInfo;
  fetchedAt: number;
}

// Cache TTL: 5 minutes - allows for server upgrades without requiring restart
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;

const versionCache = new Map<string, CachedVersion>();

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
 * Known settings properties a given n8n version accepts on a write.
 *
 * Derived properties are excluded: n8n ignores them on write, so they are never something a
 * caller can set. This answers "what did n8n accept at version X", which is only the whole
 * story below {@link SETTINGS_PASS_THROUGH_FLOOR} - above it {@link cleanSettingsForVersion}
 * forwards unknown properties too, because this list trails n8n's releases.
 */
export function getSupportedSettingsProperties(version: N8nVersionInfo): Set<string> {
  const supported = new Set<string>();

  for (const [name, meta] of Object.entries(WORKFLOW_SETTINGS_PROPERTIES)) {
    if (meta.derived) continue;
    if (versionAtLeast(version, meta.since.major, meta.since.minor, meta.since.patch)) {
      supported.add(name);
    }
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
  options?: { headers?: Record<string, string>; pinnedAgents?: PinnedAgents; forceRefresh?: boolean }
): Promise<N8nVersionInfo | null> {
  const { headers, pinnedAgents, forceRefresh } = options ?? {};
  // Check cache first (with TTL), unless the caller needs a current reading
  // because it is about to blame the instance version for a failure.
  const cached = forceRefresh ? undefined : versionCache.get(baseUrl);
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
 * Clean workflow settings for an API write against a specific n8n version.
 *
 * Derived properties are always dropped - n8n ignores them on write but echoes them on GET,
 * and our writes merge over a GET.
 *
 * Everything else depends on the instance:
 * - At or above {@link SETTINGS_PASS_THROUGH_FLOOR}, or when the version could not be detected,
 *   properties are forwarded untouched. Our property list trails n8n's weekly releases, and a
 *   setting dropped here is dropped silently; n8n's own 400 is at least actionable.
 * - Below the floor, only properties that version is known to accept survive. Those instances
 *   predate properties we know about, so forwarding one is a guaranteed rejection of the whole
 *   request rather than a risk worth taking.
 *
 * @param settings - The workflow settings to clean
 * @param version - The target n8n version, or null when detection failed
 * @returns Cleaned settings object
 */
export function cleanSettingsForVersion(
  settings: Record<string, unknown> | undefined,
  version: N8nVersionInfo | null
): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') {
    return {};
  }

  const passThrough =
    !version ||
    versionAtLeast(
      version,
      SETTINGS_PASS_THROUGH_FLOOR.major,
      SETTINGS_PASS_THROUGH_FLOOR.minor,
      SETTINGS_PASS_THROUGH_FLOOR.patch
    );
  const supportedProperties = passThrough ? null : getSupportedSettingsProperties(version);
  const target = version ? `n8n ${version.version}` : 'n8n version unknown';

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (DERIVED_SETTINGS_PROPERTIES.has(key)) {
      logger.debug(`Dropped derived settings property n8n ignores on write: ${key}`);
      continue;
    }

    if (supportedProperties && !supportedProperties.has(key)) {
      logger.debug(`Filtered out unsupported settings property: ${key} (${target})`);
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}

// Export version thresholds for testing
export const VERSION_THRESHOLDS = {
  EXECUTION_ORDER: { major: 1, minor: 37, patch: 0 },
  CALLER_POLICY: { major: 1, minor: 119, patch: 0 },
  SETTINGS_PASS_THROUGH: SETTINGS_PASS_THROUGH_FLOOR,
};
