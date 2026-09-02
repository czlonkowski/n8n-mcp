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
  type SettingsVersion,
} from '../constants/workflow-settings';

/**
 * What to tell a caller who asked for the instance version and got nothing. Reported instead of
 * "unknown", which reads as a lookup that failed and invites a retry: no retry can succeed.
 */
export const N8N_VERSION_UNAVAILABLE_NOTE =
  'Not reported. n8n stopped exposing its version to API clients in 1.119.0, so this is expected ' +
  'and is not an error. Feature availability is detected from API responses instead.';

// Cache version info per base URL with TTL to handle server upgrades
interface CachedVersion {
  /** null when the instance answered but reported no version - see rememberProbe. */
  info: N8nVersionInfo | null;
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
export function compareVersions(a: SettingsVersion, b: SettingsVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Check if version meets minimum requirement
 */
export function versionAtLeast(version: N8nVersionInfo, major: number, minor: number, patch = 0): boolean {
  return compareVersions(version, { major, minor, patch }) >= 0;
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
    if (compareVersions(version, meta.since) >= 0) {
      supported.add(name);
    }
  }

  return supported;
}

/**
 * Fetch the n8n version from the instance's `/rest/settings` endpoint.
 *
 * **This returns null against every n8n from 1.119.0 onward.** That endpoint is n8n's internal
 * editor route, and since 1.119.0 it answers unauthenticated callers from a fixed allowlist that
 * carries no version field; only a browser session gets the full settings. We authenticate with a
 * Public API key, so the version is never in the response. The Public API itself exposes no
 * version anywhere, so there is no route to switch to.
 *
 * Callers must treat null as "unknown", never as "old" - and new behaviour should be gated on
 * what the API actually answers, not on a version number. A probe that reaches the instance and
 * finds no version is cached like a successful one, so the request happens at most once per TTL
 * rather than on every write.
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
    logger.debug(`Using cached n8n version for ${baseUrl}: ${cached.info?.version ?? 'none reported'}`);
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

    // n8n wraps the settings in a "data" property
    const settings = response.status === 200 ? response.data?.data : undefined;

    // n8n can return version in different fields - validate type
    const versionString = typeof settings?.n8nVersion === 'string'
      ? settings.n8nVersion
      : typeof settings?.versionCli === 'string'
        ? settings.versionCli
        : null;
    const versionInfo = versionString ? parseVersion(versionString) : null;

    // A missing version is expected against any n8n >= 1.119.0, so it is not a warning - see the
    // doc comment.
    return rememberProbe(
      baseUrl,
      versionInfo,
      versionInfo
        ? `detected n8n version ${versionInfo.version}`
        : `no version in the response from ${settingsUrl}`
    );
  } catch (error) {
    // Everything that produced no usable response lands here: a timeout, a refused connection,
    // and any status at or above 500, which `validateStatus` rejects. None of them says what the
    // instance reports when it is healthy, so none is cached - that would suppress detection for
    // the whole TTL over a blip.
    logger.debug(`Failed to fetch n8n version: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

/**
 * Cache the outcome of a probe that reached the instance, and return it.
 *
 * A null outcome is cached too: it is the normal answer from every current n8n, and re-probing on
 * every workflow write would cost a round trip per write to learn the same thing.
 */
function rememberProbe(
  baseUrl: string,
  info: N8nVersionInfo | null,
  reason: string
): N8nVersionInfo | null {
  versionCache.set(baseUrl, { info, fetchedAt: Date.now() });
  logger.debug(`n8n version probe for ${baseUrl}: ${reason}`);
  return info;
}

/**
 * Clear version cache (useful for testing or when server changes)
 */
export function clearVersionCache(): void {
  versionCache.clear();
}

/**
 * Get cached version for a base URL. Null when nothing is cached, the entry expired, or the
 * instance was probed and reported no version.
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

  const passThrough = !version || compareVersions(version, SETTINGS_PASS_THROUGH_FLOOR) >= 0;
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

/**
 * Instances below this version still report their version, so {@link cleanSettingsForVersion}
 * filters for them precisely. The rejection ladder only needs to cover what arrived later.
 */
const SETTINGS_LADDER_FLOOR: SettingsVersion = { major: 1, minor: 119, patch: 0 };

/**
 * Which settings keys to drop, and in what order, when n8n rejects a write with
 * `request/body/settings must NOT have additional properties` and does not name the key.
 *
 * Each returned step is one retry. Keys absent from our settings table go first, together: the
 * usual cause is an instance whose GET echoes a property its write schema does not accept, and
 * one we have never heard of is the likeliest candidate. Known keys follow one at a time from
 * newest to oldest, since the instance evidently predates at least one of them. Keys introduced
 * at or before the floor are never dropped here; an instance that old is handled by version.
 */
export function settingsRejectionLadder(settings: unknown): string[][] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const keys = Object.keys(settings as Record<string, unknown>);
  const known = (key: string) => Object.prototype.hasOwnProperty.call(WORKFLOW_SETTINGS_PROPERTIES, key);
  const since = (key: string) => WORKFLOW_SETTINGS_PROPERTIES[key].since;

  const unknown = keys.filter(key => !known(key));
  const newestFirst = keys
    .filter(key => known(key) && compareVersions(since(key), SETTINGS_LADDER_FLOOR) > 0)
    .sort((a, b) => compareVersions(since(b), since(a)));

  return [
    ...(unknown.length > 0 ? [unknown] : []),
    ...newestFirst.map(key => [key]),
  ];
}

// Export version thresholds for testing
export const VERSION_THRESHOLDS = {
  EXECUTION_ORDER: { major: 1, minor: 37, patch: 0 },
  CALLER_POLICY: { major: 1, minor: 119, patch: 0 },
  SETTINGS_PASS_THROUGH: SETTINGS_PASS_THROUGH_FLOOR,
};
