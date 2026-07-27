import { logger } from '../utils/logger';
import { NodeRepository, CommunityNodeFields } from '../database/node-repository';
import { ParsedNode } from '../parsers/node-parser';
import { parseTypeVersion } from '../utils/typeversion';
import {
  CommunityNodeFetcher,
  StrapiCommunityNode,
  NpmSearchResult,
} from './community-node-fetcher';

export interface CommunityStats {
  total: number;
  verified: number;
  unverified: number;
}

export interface SyncResult {
  verified: {
    fetched: number;
    saved: number;
    skipped: number;
    errors: string[];
  };
  npm: {
    fetched: number;
    saved: number;
    skipped: number;
    errors: string[];
  };
  duration: number;
}

export interface SyncOptions {
  /** Only sync verified nodes from Strapi API (fast) */
  verifiedOnly?: boolean;
  /** Maximum number of npm packages to sync (default: 100) */
  npmLimit?: number;
  /** Skip nodes already in database */
  skipExisting?: boolean;
  /** Environment for Strapi API */
  environment?: 'production' | 'staging';
}

/**
 * package.json lookups during the npm sync are best-effort: one attempt with a
 * short timeout. A miss falls back to the package-name heuristic, so a slow
 * registry must not stretch a sync of hundreds of packages by hours.
 */
const NPM_MANIFEST_FETCH = { maxRetries: 1, timeout: 5000 } as const;

/**
 * Derive a node name from an n8n node entry point declared in package.json.
 * e.g., "dist/nodes/GlobalConstants/GlobalConstants.node.js" -> "globalConstants"
 * Returns undefined when the entry is not a node file.
 */
function extractNodeNameFromEntryPath(entryPath: string): string | undefined {
  const match = /([^\\/]+)\.node\.(?:js|ts)$/.exec(entryPath);
  if (!match) {
    return undefined;
  }

  const className = match[1];

  // A leading acronym is lowercased as a unit: PDFGeneration publishes as
  // pdfGeneration, while plain PascalCase keeps the single-letter form
  // (GlobalConstants -> globalConstants).
  const acronym = /^[A-Z]+(?=[A-Z][a-z])/.exec(className);
  if (acronym) {
    return acronym[0].toLowerCase() + className.slice(acronym[0].length);
  }

  return className.charAt(0).toLowerCase() + className.slice(1);
}

/**
 * Service for syncing community nodes from n8n Strapi API and npm registry.
 *
 * Key insight: Verified nodes from Strapi include full `nodeDescription` schemas,
 * so we can store them directly without downloading/parsing npm packages.
 */
export class CommunityNodeService {
  private fetcher: CommunityNodeFetcher;
  private repository: NodeRepository;

  constructor(repository: NodeRepository, environment: 'production' | 'staging' = 'production') {
    this.repository = repository;
    this.fetcher = new CommunityNodeFetcher(environment);
  }

  /**
   * Sync community nodes from both Strapi API and npm registry.
   */
  async syncCommunityNodes(
    options: SyncOptions = {},
    progressCallback?: (message: string, current: number, total: number) => void
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      verified: { fetched: 0, saved: 0, skipped: 0, errors: [] },
      npm: { fetched: 0, saved: 0, skipped: 0, errors: [] },
      duration: 0,
    };

    // Step 1: Sync verified nodes from Strapi API
    logger.info('Syncing verified community nodes from Strapi API...');
    try {
      result.verified = await this.syncVerifiedNodes(progressCallback, options.skipExisting);
    } catch (error: any) {
      logger.error('Failed to sync verified nodes:', error);
      result.verified.errors.push(`Strapi sync failed: ${error.message}`);
    }

    // Step 2: Sync popular npm packages (unless verifiedOnly)
    if (!options.verifiedOnly) {
      const npmLimit = options.npmLimit ?? 100;
      logger.info(`Syncing top ${npmLimit} npm community packages...`);
      try {
        result.npm = await this.syncNpmNodes(npmLimit, progressCallback, options.skipExisting);
      } catch (error: any) {
        logger.error('Failed to sync npm nodes:', error);
        result.npm.errors.push(`npm sync failed: ${error.message}`);
      }
    }

    result.duration = Date.now() - startTime;
    logger.info(
      `Community node sync complete in ${(result.duration / 1000).toFixed(1)}s: ` +
        `${result.verified.saved} verified, ${result.npm.saved} npm`
    );

    return result;
  }

  /**
   * Sync verified nodes from n8n Strapi API.
   * These nodes include full nodeDescription - no parsing needed!
   */
  async syncVerifiedNodes(
    progressCallback?: (message: string, current: number, total: number) => void,
    skipExisting?: boolean
  ): Promise<SyncResult['verified']> {
    const result = { fetched: 0, saved: 0, skipped: 0, errors: [] as string[] };

    // Fetch verified nodes from Strapi API
    const strapiNodes = await this.fetcher.fetchVerifiedNodes(progressCallback);
    result.fetched = strapiNodes.length;

    if (strapiNodes.length === 0) {
      logger.warn('No verified nodes returned from Strapi API');
      return result;
    }

    logger.info(`Processing ${strapiNodes.length} verified community nodes...`);

    for (const strapiNode of strapiNodes) {
      try {
        const { attributes } = strapiNode;

        // Skip if node already exists and skipExisting is true
        if (skipExisting && this.repository.hasNodeByNpmPackage(attributes.packageName)) {
          result.skipped++;
          continue;
        }

        // Convert Strapi node to ParsedNode format
        const parsedNode = this.strapiNodeToParsedNode(strapiNode);
        if (!parsedNode) {
          result.errors.push(`Failed to parse: ${attributes.packageName}`);
          continue;
        }

        // Save to database
        this.repository.saveNode(parsedNode);
        result.saved++;

        if (progressCallback) {
          progressCallback(
            `Saving verified nodes`,
            result.saved + result.skipped,
            strapiNodes.length
          );
        }
      } catch (error: any) {
        result.errors.push(`Error saving ${strapiNode.attributes.packageName}: ${error.message}`);
      }
    }

    logger.info(`Verified nodes: ${result.saved} saved, ${result.skipped} skipped`);
    return result;
  }

  /**
   * Sync popular npm packages.
   * NOTE: This only stores metadata - full schema extraction requires tarball download.
   * For now, we store basic metadata and mark them for future parsing.
   */
  async syncNpmNodes(
    limit: number = 100,
    progressCallback?: (message: string, current: number, total: number) => void,
    skipExisting?: boolean
  ): Promise<SyncResult['npm']> {
    const result = { fetched: 0, saved: 0, skipped: 0, errors: [] as string[] };

    // Fetch npm packages
    const npmPackages = await this.fetcher.fetchNpmPackages(limit, progressCallback);
    result.fetched = npmPackages.length;

    if (npmPackages.length === 0) {
      logger.warn('No npm packages returned from registry');
      return result;
    }

    // Get list of verified package names to skip (already synced from Strapi)
    const verifiedPackages = new Set(
      this.repository
        .getCommunityNodes({ verified: true })
        .map((n) => n.npmPackageName)
        .filter(Boolean)
    );

    logger.info(
      `Processing ${npmPackages.length} npm packages (skipping ${verifiedPackages.size} verified)...`
    );

    for (const pkg of npmPackages) {
      try {
        const packageName = pkg.package.name;

        // Skip if already verified from Strapi
        if (verifiedPackages.has(packageName)) {
          result.skipped++;
          continue;
        }

        const existing = this.repository.getNodeByNpmPackage(packageName);

        // For npm packages, we create a basic node entry with metadata
        // Full schema extraction would require downloading and parsing the tarball
        const parsedNode = await this.npmPackageToParsedNode(pkg);
        const staleRow = this.staleCommunityRow(existing, parsedNode.nodeType);

        // Skip if already exists and skipExisting is true. A row keyed by an
        // outdated node type is the one case that must not be skipped — only a
        // re-key corrects it.
        if (skipExisting && existing && !staleRow) {
          result.skipped++;
          continue;
        }

        // Save to database
        this.repository.saveNode(parsedNode);

        if (staleRow) {
          this.replaceStaleCommunityRow(packageName, staleRow, parsedNode.nodeType);
        }

        result.saved++;

        if (progressCallback) {
          progressCallback(`Saving npm packages`, result.saved + result.skipped, npmPackages.length);
        }
      } catch (error: any) {
        result.errors.push(`Error saving ${pkg.package.name}: ${error.message}`);
      }
    }

    logger.info(`npm packages: ${result.saved} saved, ${result.skipped} skipped`);
    return result;
  }

  /**
   * Convert Strapi community node to ParsedNode format.
   * Strapi nodes include full nodeDescription - no parsing needed!
   */
  private strapiNodeToParsedNode(
    strapiNode: StrapiCommunityNode
  ): (ParsedNode & CommunityNodeFields) | null {
    const { attributes } = strapiNode;

    // Strapi includes the full nodeDescription (n8n node schema)
    const nodeDesc = attributes.nodeDescription;

    if (!nodeDesc) {
      logger.warn(`No nodeDescription for ${attributes.packageName}`);
      return null;
    }

    // Extract node type from the description
    // Strapi uses "preview" format (e.g., n8n-nodes-preview-brightdata.brightData)
    // but actual installed nodes use the npm package name (e.g., n8n-nodes-brightdata.brightData)
    // We need to transform preview names to actual names
    let nodeType = nodeDesc.name || `${attributes.packageName}.${attributes.name}`;

    // Transform preview node type to actual node type
    // Pattern: n8n-nodes-preview-{name} -> n8n-nodes-{name}
    // Also handles scoped packages: @scope/n8n-nodes-preview-{name} -> @scope/n8n-nodes-{name}
    if (nodeType.includes('n8n-nodes-preview-')) {
      nodeType = nodeType.replace('n8n-nodes-preview-', 'n8n-nodes-');
    }

    // n8n types usableAsTool as `true | UsableAsToolDescription`, so any value
    // other than false/absent is a declared capability, matching the core parser.
    // The codex AI category stays as an inference because community metadata
    // often omits usableAsTool. The node's name is never a signal: "ai" as a
    // substring matches packages like fireflies*ai* that are not tools (#954).
    const usableAsTool = nodeDesc.usableAsTool;
    const declaresToolUse =
      usableAsTool !== undefined && usableAsTool !== null && usableAsTool !== false;
    const hasAICategory = nodeDesc.codex?.categories?.includes('AI') ?? false;
    const isAITool = declaresToolUse || hasAICategory;

    return {
      // Core ParsedNode fields
      nodeType,
      packageName: attributes.packageName,
      displayName: nodeDesc.displayName || attributes.displayName,
      description: nodeDesc.description || attributes.description,
      category: nodeDesc.codex?.categories?.[0] || 'Community',
      style: 'declarative', // Most community nodes are declarative
      properties: nodeDesc.properties || [],
      credentials: nodeDesc.credentials || [],
      operations: this.extractOperations(nodeDesc),
      isAITool,
      isTrigger: nodeDesc.group?.includes('trigger') || false,
      isWebhook:
        nodeDesc.name?.toLowerCase().includes('webhook') ||
        nodeDesc.group?.includes('webhook') ||
        false,
      isVersioned: (attributes.nodeVersions?.length || 0) > 1,
      // typeVersion is the descriptor's version, NOT the npm package version.
      // npm version (e.g. "0.2.21") is exposed separately via npmVersion below.
      version: (parseTypeVersion(nodeDesc.version) ?? 1).toString(),
      outputs: nodeDesc.outputs,
      outputNames: nodeDesc.outputNames,

      // Community-specific fields
      isCommunity: true,
      isVerified: true, // Strapi nodes are verified
      authorName: attributes.authorName,
      authorGithubUrl: attributes.authorGithubUrl,
      npmPackageName: attributes.packageName,
      npmVersion: attributes.npmVersion,
      npmDownloads: attributes.numberOfDownloads || 0,
      communityFetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Convert npm package info to basic ParsedNode.
   * Note: This is a minimal entry - full schema requires tarball parsing.
   */
  private async npmPackageToParsedNode(
    pkg: NpmSearchResult
  ): Promise<ParsedNode & CommunityNodeFields> {
    const { package: pkgInfo, score } = pkg;

    const nodeName = await this.resolveNpmNodeName(pkgInfo.name, pkgInfo.version);
    const nodeType = `${pkgInfo.name}.${nodeName}`;

    return {
      // Core ParsedNode fields (minimal - no schema available)
      nodeType,
      packageName: pkgInfo.name,
      displayName: nodeName,
      description: pkgInfo.description || `Community node from ${pkgInfo.name}`,
      category: 'Community',
      style: 'declarative',
      properties: [], // Would need tarball parsing
      credentials: [],
      operations: [],
      isAITool: false,
      isTrigger: pkgInfo.name.includes('trigger'),
      isWebhook: pkgInfo.name.includes('webhook'),
      isVersioned: false,
      // No descriptor available without parsing the npm tarball — declarative community
      // nodes default to typeVersion 1 at runtime when version isn't declared.
      // npm package version is preserved in the npmVersion field below.
      version: '1',

      // Community-specific fields
      isCommunity: true,
      isVerified: false, // npm nodes are not verified
      authorName: pkgInfo.author?.name || pkgInfo.publisher?.username,
      authorGithubUrl: pkgInfo.links?.repository,
      npmPackageName: pkgInfo.name,
      npmVersion: pkgInfo.version,
      npmDownloads: Math.round(score.detail.popularity * 10000), // Approximate
      communityFetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract operations from node description.
   */
  private extractOperations(nodeDesc: any): any[] {
    const operations: any[] = [];

    // Check properties for resource/operation pattern
    // Nodes can have multiple operation properties, each mapped to a resource via displayOptions
    if (nodeDesc.properties) {
      for (const prop of nodeDesc.properties) {
        if ((prop.name === 'operation' || prop.name === 'action') && prop.options) {
          const resource = prop.displayOptions?.show?.resource?.[0];
          for (const op of prop.options) {
            operations.push({
              ...op,
              ...(resource ? { resource } : {})
            });
          }
        }
      }
    }

    return operations;
  }

  /**
   * A stored row is stale when this sync resolves a different node type for the
   * same npm package, which happens for packages saved under the fabricated
   * package-name type (#949). Verified rows carry the real node name from
   * Strapi and are never re-keyed.
   */
  private staleCommunityRow(existing: any, nodeType: string): any | undefined {
    if (!existing || !existing.isCommunity || existing.isVerified) {
      return undefined;
    }
    return existing.nodeType && existing.nodeType !== nodeType ? existing : undefined;
  }

  /**
   * Drop the rows this package no longer resolves to and carry the generated
   * documentation over to the new row, which saveNode could not preserve
   * because preservation is keyed by node type.
   */
  private replaceStaleCommunityRow(packageName: string, staleRow: any, nodeType: string): void {
    const removed = this.repository.deleteStaleCommunityNodes(packageName, nodeType);
    logger.info(
      `Re-keyed ${packageName}: "${staleRow.nodeType}" -> "${nodeType}" (${removed} outdated row(s) removed)`
    );

    if (staleRow.npmReadme) {
      this.repository.updateNodeReadme(nodeType, staleRow.npmReadme);
    }
    if (staleRow.aiDocumentationSummary) {
      this.repository.updateNodeAISummary(nodeType, staleRow.aiDocumentationSummary);
    }
  }

  /**
   * Resolve the node name for an npm-only package.
   *
   * The package.json `n8n.nodes` array lists the package's node entry points
   * (e.g. "dist/nodes/GlobalConstants/GlobalConstants.node.js"), which carry the
   * real node name. Deriving it from the package name instead fabricated node
   * types that do not exist in n8n (#949).
   *
   * Only the first entry is used: the npm path stores one row per package.
   */
  private async resolveNpmNodeName(packageName: string, version?: string): Promise<string> {
    let entries: unknown[] = [];

    try {
      const packageJson = await this.fetcher.fetchPackageJson(
        packageName,
        version,
        NPM_MANIFEST_FETCH
      );
      if (Array.isArray(packageJson?.n8n?.nodes)) {
        entries = packageJson.n8n.nodes;
      }
    } catch (error: any) {
      logger.warn(`Could not fetch package.json for ${packageName}: ${error.message}`);
    }

    for (const entry of entries) {
      const nodeName = typeof entry === 'string' ? extractNodeNameFromEntryPath(entry) : undefined;
      if (nodeName) {
        return nodeName;
      }
    }

    const fallback = this.extractNodeNameFromPackage(packageName);
    logger.warn(
      `No usable n8n.nodes entry for ${packageName}, falling back to the package-name heuristic: "${fallback}"`
    );
    return fallback;
  }

  /**
   * Extract node name from npm package name.
   * n8n community nodes typically use lowercase node class names.
   * e.g., "n8n-nodes-chatwoot" -> "chatwoot"
   * e.g., "@company/n8n-nodes-mynode" -> "mynode"
   *
   * Note: We use lowercase because most community nodes follow this convention.
   * Verified nodes from Strapi have the correct casing in nodeDesc.name.
   * Only a fallback — see resolveNpmNodeName.
   */
  private extractNodeNameFromPackage(packageName: string): string {
    // Remove scope if present
    let name = packageName.replace(/^@[^/]+\//, '');

    // Remove n8n-nodes- prefix
    name = name.replace(/^n8n-nodes-/, '');

    // Remove hyphens and keep lowercase (n8n community node convention)
    // e.g., "bright-data" -> "brightdata", "chatwoot" -> "chatwoot"
    return name.replace(/-/g, '').toLowerCase();
  }

  /**
   * Get community node statistics.
   */
  getCommunityStats(): CommunityStats {
    return this.repository.getCommunityStats();
  }

  /**
   * Delete all community nodes (for rebuild).
   */
  deleteCommunityNodes(): number {
    return this.repository.deleteCommunityNodes();
  }
}
