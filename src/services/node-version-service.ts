/**
 * Node Version Service
 *
 * Central service for node version discovery, comparison, and upgrade path recommendation.
 * Provides caching for performance and integrates with the database and breaking change detector.
 */

import { NodeRepository } from '../database/node-repository';
import { normalizeNodeVersion } from '../parsers/node-parser';
import { BreakingChangeDetector } from './breaking-change-detector';

export interface NodeVersion {
  nodeType: string;
  version: string;
  packageName: string;
  displayName: string;
  isCurrentMax: boolean;
  minimumN8nVersion?: string;
  breakingChanges: any[];
  deprecatedProperties: string[];
  addedProperties: string[];
  releasedAt?: Date;
}

export interface VersionComparison {
  nodeType: string;
  currentVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  versionGap: number; // How many versions behind
  hasBreakingChanges: boolean;
  recommendUpgrade: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

export interface UpgradePath {
  nodeType: string;
  fromVersion: string;
  toVersion: string;
  direct: boolean; // Can upgrade directly or needs intermediate steps
  intermediateVersions: string[]; // If multi-step upgrade needed
  totalBreakingChanges: number;
  autoMigratableChanges: number;
  manualRequiredChanges: number;
  estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  steps: UpgradeStep[];
}

export interface UpgradeStep {
  fromVersion: string;
  toVersion: string;
  breakingChanges: number;
  migrationHints: string[];
}

/**
 * Node Version Service with caching
 */
export class NodeVersionService {
  private versionCache: Map<string, NodeVersion[]> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
  private cacheTimestamps: Map<string, number> = new Map();

  constructor(
    private nodeRepository: NodeRepository,
    private breakingChangeDetector: BreakingChangeDetector
  ) {}

  /**
   * Get all available versions for a node type
   */
  getAvailableVersions(nodeType: string): NodeVersion[] {
    // Check cache first
    const cached = this.getCachedVersions(nodeType);
    if (cached) return cached;

    // Query from database
    const versions = this.nodeRepository.getNodeVersions(nodeType);

    // Cache the result
    this.cacheVersions(nodeType, versions);

    return versions;
  }

  /**
   * Get the latest available version for a node type
   */
  getLatestVersion(nodeType: string): string | null {
    const versions = this.getAvailableVersions(nodeType);

    if (versions.length === 0) {
      // Fallback to main nodes table
      const node = this.nodeRepository.getNode(nodeType);
      return node?.version || null;
    }

    // Find version marked as current max
    const maxVersion = versions.find(v => v.isCurrentMax);
    if (maxVersion) return maxVersion.version;

    // Fallback: sort and get highest
    const sorted = versions.sort((a, b) => this.compareVersions(b.version, a.version));
    return sorted[0]?.version || null;
  }

  /**
   * Compare a node's current version against the latest available
   */
  compareVersions(currentVersion: string, latestVersion: string): number {
    const parts1 = currentVersion.split('.').map(Number);
    const parts2 = latestVersion.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }

    return 0;
  }

  /**
   * Analyze if a node version is outdated and should be upgraded
   */
  analyzeVersion(nodeType: string, currentVersion: string): VersionComparison {
    const latestVersion = this.getLatestVersion(nodeType);

    if (!latestVersion) {
      return {
        nodeType,
        currentVersion,
        latestVersion: currentVersion,
        isOutdated: false,
        versionGap: 0,
        hasBreakingChanges: false,
        recommendUpgrade: false,
        confidence: 'HIGH',
        reason: 'No version information available. Using current version.'
      };
    }

    const comparison = this.compareVersions(currentVersion, latestVersion);
    const isOutdated = comparison < 0;

    if (!isOutdated) {
      return {
        nodeType,
        currentVersion,
        latestVersion,
        isOutdated: false,
        versionGap: 0,
        hasBreakingChanges: false,
        recommendUpgrade: false,
        confidence: 'HIGH',
        reason: 'Node is already at the latest version.'
      };
    }

    // Calculate version gap
    const versionGap = this.calculateVersionGap(currentVersion, latestVersion);

    // Check for breaking changes
    const hasBreakingChanges = this.breakingChangeDetector.hasBreakingChanges(
      nodeType,
      currentVersion,
      latestVersion
    );

    // Determine upgrade recommendation and confidence
    let recommendUpgrade = true;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
    let reason = `Version ${latestVersion} available. `;

    if (hasBreakingChanges) {
      confidence = 'MEDIUM';
      reason += 'Contains breaking changes. Review before upgrading.';
    } else {
      reason += 'Safe to upgrade (no breaking changes detected).';
    }

    if (versionGap > 2) {
      confidence = 'LOW';
      reason += ` Version gap is large (${versionGap} versions). Consider incremental upgrade.`;
    }

    return {
      nodeType,
      currentVersion,
      latestVersion,
      isOutdated,
      versionGap,
      hasBreakingChanges,
      recommendUpgrade,
      confidence,
      reason
    };
  }

  /**
   * Calculate the version gap (number of versions between)
   */
  private calculateVersionGap(fromVersion: string, toVersion: string): number {
    const from = fromVersion.split('.').map(Number);
    const to = toVersion.split('.').map(Number);

    // Simple gap calculation based on version numbers
    let gap = 0;

    for (let i = 0; i < Math.max(from.length, to.length); i++) {
      const f = from[i] || 0;
      const t = to[i] || 0;
      gap += Math.abs(t - f);
    }

    return gap;
  }

  /**
   * Suggest the best upgrade path for a node
   */
  async suggestUpgradePath(nodeType: string, currentVersion: string): Promise<UpgradePath | null> {
    const latestVersion = this.getLatestVersion(nodeType);

    if (!latestVersion) return null;

    const comparison = this.compareVersions(currentVersion, latestVersion);
    if (comparison >= 0) return null; // Already at latest or newer

    // Get all available versions between current and latest
    const allVersions = this.getAvailableVersions(nodeType);
    const intermediateVersions = allVersions
      .filter(v =>
        this.compareVersions(v.version, currentVersion) > 0 &&
        this.compareVersions(v.version, latestVersion) < 0
      )
      .map(v => v.version)
      .sort((a, b) => this.compareVersions(a, b));

    // Analyze the upgrade
    const analysis = await this.breakingChangeDetector.analyzeVersionUpgrade(
      nodeType,
      currentVersion,
      latestVersion
    );

    // Determine if direct upgrade is safe
    const versionGap = this.calculateVersionGap(currentVersion, latestVersion);
    const direct = versionGap <= 1 || !analysis.hasBreakingChanges;

    // Generate upgrade steps
    const steps: UpgradeStep[] = [];

    if (direct || intermediateVersions.length === 0) {
      // Direct upgrade
      steps.push({
        fromVersion: currentVersion,
        toVersion: latestVersion,
        breakingChanges: analysis.changes.filter(c => c.isBreaking).length,
        migrationHints: analysis.recommendations
      });
    } else {
      // Multi-step upgrade through intermediate versions
      let stepFrom = currentVersion;

      for (const intermediateVersion of intermediateVersions) {
        const stepAnalysis = await this.breakingChangeDetector.analyzeVersionUpgrade(
          nodeType,
          stepFrom,
          intermediateVersion
        );

        steps.push({
          fromVersion: stepFrom,
          toVersion: intermediateVersion,
          breakingChanges: stepAnalysis.changes.filter(c => c.isBreaking).length,
          migrationHints: stepAnalysis.recommendations
        });

        stepFrom = intermediateVersion;
      }

      // Final step to latest
      const finalStepAnalysis = await this.breakingChangeDetector.analyzeVersionUpgrade(
        nodeType,
        stepFrom,
        latestVersion
      );

      steps.push({
        fromVersion: stepFrom,
        toVersion: latestVersion,
        breakingChanges: finalStepAnalysis.changes.filter(c => c.isBreaking).length,
        migrationHints: finalStepAnalysis.recommendations
      });
    }

    // Calculate estimated effort
    const totalBreakingChanges = steps.reduce((sum, step) => sum + step.breakingChanges, 0);
    let estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    if (totalBreakingChanges > 5 || steps.length > 3) {
      estimatedEffort = 'HIGH';
    } else if (totalBreakingChanges > 2 || steps.length > 1) {
      estimatedEffort = 'MEDIUM';
    }

    return {
      nodeType,
      fromVersion: currentVersion,
      toVersion: latestVersion,
      direct,
      intermediateVersions,
      totalBreakingChanges,
      autoMigratableChanges: analysis.autoMigratableCount,
      manualRequiredChanges: analysis.manualRequiredCount,
      estimatedEffort,
      steps
    };
  }

  /**
   * Check if a specific version exists for a node
   */
  versionExists(nodeType: string, version: string): boolean {
    const wanted = normalizeNodeVersion(version);
    return this.getAvailableVersions(nodeType).some(v => normalizeNodeVersion(v.version) === wanted);
  }

  /**
   * Get version metadata (breaking changes, added/deprecated properties)
   */
  getVersionMetadata(nodeType: string, version: string): NodeVersion | null {
    const versionData = this.nodeRepository.getNodeVersion(nodeType, version);
    return versionData;
  }

  /**
   * Clear the version cache
   */
  clearCache(nodeType?: string): void {
    if (nodeType) {
      this.versionCache.delete(nodeType);
      this.cacheTimestamps.delete(nodeType);
    } else {
      this.versionCache.clear();
      this.cacheTimestamps.clear();
    }
  }

  /**
   * Get cached versions if still valid
   */
  private getCachedVersions(nodeType: string): NodeVersion[] | null {
    const cached = this.versionCache.get(nodeType);
    const timestamp = this.cacheTimestamps.get(nodeType);

    if (cached && timestamp) {
      const age = Date.now() - timestamp;
      if (age < this.cacheTTL) {
        return cached;
      }
    }

    return null;
  }

  /**
   * Cache versions with timestamp
   */
  private cacheVersions(nodeType: string, versions: NodeVersion[]): void {
    this.versionCache.set(nodeType, versions);
    this.cacheTimestamps.set(nodeType, Date.now());
  }
}
