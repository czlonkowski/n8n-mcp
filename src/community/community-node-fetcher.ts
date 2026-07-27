import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';

/**
 * Configuration constants for community node fetching
 */
const FETCH_CONFIG = {
  /** Default timeout for Strapi API requests (ms) */
  STRAPI_TIMEOUT: 30000,
  /** Default timeout for npm registry requests (ms) */
  NPM_REGISTRY_TIMEOUT: 15000,
  /** Default timeout for npm downloads API (ms) */
  NPM_DOWNLOADS_TIMEOUT: 10000,
  /** Base delay between retries (ms) */
  RETRY_DELAY: 1000,
  /** Maximum number of retry attempts */
  MAX_RETRIES: 3,
  /** Default delay between requests for rate limiting (ms) */
  RATE_LIMIT_DELAY: 300,
  /** Default delay after hitting 429 (ms) */
  RATE_LIMIT_429_DELAY: 60000,
} as const;

/**
 * Strapi API response types for verified community nodes
 */
export interface StrapiCommunityNodeAttributes {
  name: string;
  displayName: string;
  description: string;
  packageName: string;
  authorName: string;
  authorGithubUrl?: string;
  npmVersion: string;
  numberOfDownloads: number;
  numberOfStars: number;
  isOfficialNode: boolean;
  isPublished: boolean;
  nodeDescription: any; // Complete n8n node schema
  nodeVersions?: any[];
  checksum?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StrapiCommunityNode {
  id: number;
  attributes: StrapiCommunityNodeAttributes;
}

export interface StrapiPaginatedResponse<T> {
  data: Array<{ id: number; attributes: T }>;
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

/**
 * npm registry search response types
 */
export interface NpmPackageInfo {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  date: string;
  links: {
    npm: string;
    homepage?: string;
    repository?: string;
  };
  author?: {
    name?: string;
    email?: string;
    username?: string;
  };
  publisher?: {
    username: string;
    email: string;
  };
  maintainers: Array<{ username: string; email: string }>;
}

export interface NpmSearchResult {
  package: NpmPackageInfo;
  score: {
    final: number;
    detail: {
      quality: number;
      popularity: number;
      maintenance: number;
    };
  };
  searchScore: number;
}

export interface NpmSearchResponse {
  objects: NpmSearchResult[];
  total: number;
  time: string;
}

/**
 * Response type for full package data including README
 */
export interface NpmPackageWithReadme {
  name: string;
  version: string;
  description?: string;
  readme?: string;
  readmeFilename?: string;
  homepage?: string;
  repository?: {
    type?: string;
    url?: string;
  };
  keywords?: string[];
  license?: string;
  'dist-tags'?: {
    latest?: string;
  };
}

/**
 * Fetches community nodes from n8n Strapi API and npm registry.
 * Follows the pattern from template-fetcher.ts.
 */
export class CommunityNodeFetcher {
  private readonly strapiBaseUrl: string;
  private readonly npmSearchUrl = 'https://registry.npmjs.org/-/v1/search';
  private readonly npmRegistryUrl = 'https://registry.npmjs.org';
  private readonly maxRetries = FETCH_CONFIG.MAX_RETRIES;
  private readonly retryDelay = FETCH_CONFIG.RETRY_DELAY;
  private readonly strapiPageSize = 25;
  private readonly npmPageSize = 250; // npm API max

  /** Regex for validating npm package names per npm naming rules */
  private readonly npmPackageNameRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

  constructor(environment: 'production' | 'staging' = 'production') {
    this.strapiBaseUrl =
      environment === 'production'
        ? 'https://api.n8n.io/api/community-nodes'
        : 'https://api-staging.n8n.io/api/community-nodes';
  }

  /**
   * Validates npm package name to prevent path traversal and injection attacks.
   * @see https://github.com/npm/validate-npm-package-name
   */
  private validatePackageName(packageName: string): boolean {
    if (!packageName || typeof packageName !== 'string') {
      return false;
    }
    // Max length per npm spec
    if (packageName.length > 214) {
      return false;
    }
    // Must match npm naming pattern
    if (!this.npmPackageNameRegex.test(packageName)) {
      return false;
    }
    // Block path traversal attempts
    if (packageName.includes('..') || packageName.includes('//')) {
      return false;
    }
    return true;
  }

  /**
   * Checks if an error is a rate limit (429) response
   */
  private isRateLimitError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 429;
  }

  /**
   * Retry helper for API calls (same pattern as TemplateFetcher)
   * Handles 429 rate limit responses with extended delay
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string,
    maxRetries: number = this.maxRetries
  ): Promise<T | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;

        if (attempt < maxRetries) {
          // Handle 429 rate limit with longer delay
          if (this.isRateLimitError(error)) {
            const delay = FETCH_CONFIG.RATE_LIMIT_429_DELAY;
            logger.warn(
              `${context} - Rate limited (429), waiting ${delay / 1000}s before retry...`
            );
            await this.sleep(delay);
          } else {
            const delay = this.retryDelay * attempt; // Exponential backoff
            logger.warn(
              `${context} - Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`
            );
            await this.sleep(delay);
          }
        }
      }
    }

    logger.error(`${context} - All ${maxRetries} attempts failed, skipping`, lastError);
    return null;
  }

  /**
   * Fetch all verified community nodes from n8n Strapi API.
   * These nodes include full nodeDescription schemas - no parsing needed!
   */
  async fetchVerifiedNodes(
    progressCallback?: (message: string, current: number, total: number) => void
  ): Promise<StrapiCommunityNode[]> {
    const allNodes: StrapiCommunityNode[] = [];
    let page = 1;
    let hasMore = true;
    let total = 0;

    logger.info('Fetching verified community nodes from n8n Strapi API...');

    while (hasMore) {
      const result = await this.retryWithBackoff(
        async () => {
          const response = await axios.get<StrapiPaginatedResponse<StrapiCommunityNodeAttributes>>(
            this.strapiBaseUrl,
            {
              params: {
                'pagination[page]': page,
                'pagination[pageSize]': this.strapiPageSize,
              },
              timeout: FETCH_CONFIG.STRAPI_TIMEOUT,
            }
          );
          return response.data;
        },
        `Fetching verified nodes page ${page}`
      );

      if (result === null) {
        logger.warn(`Skipping page ${page} after failed attempts`);
        page++;
        continue;
      }

      const nodes = result.data.map((item) => ({
        id: item.id,
        attributes: item.attributes,
      }));

      allNodes.push(...nodes);
      total = result.meta.pagination.total;

      if (progressCallback) {
        progressCallback(`Fetching verified nodes`, allNodes.length, total);
      }

      logger.debug(
        `Fetched page ${page}/${result.meta.pagination.pageCount}: ${nodes.length} nodes (total: ${allNodes.length}/${total})`
      );

      // Check if there are more pages
      if (page >= result.meta.pagination.pageCount) {
        hasMore = false;
      }

      page++;

      // Rate limiting
      if (hasMore) {
        await this.sleep(FETCH_CONFIG.RATE_LIMIT_DELAY);
      }
    }

    logger.info(`Fetched ${allNodes.length} verified community nodes from Strapi API`);
    return allNodes;
  }

  /**
   * Fetch popular community node packages from npm registry.
   * Sorted by popularity (downloads). Returns package metadata only.
   * To get node schemas, packages need to be downloaded and parsed.
   *
   * @param limit Maximum number of packages to fetch (default: 100)
   */
  async fetchNpmPackages(
    limit: number = 100,
    progressCallback?: (message: string, current: number, total: number) => void
  ): Promise<NpmSearchResult[]> {
    const allPackages: NpmSearchResult[] = [];
    let offset = 0;
    const targetLimit = Math.min(limit, 1000); // npm API practical limit

    logger.info(`Fetching top ${targetLimit} community node packages from npm registry...`);

    while (allPackages.length < targetLimit) {
      const remaining = targetLimit - allPackages.length;
      const size = Math.min(this.npmPageSize, remaining);

      const result = await this.retryWithBackoff(
        async () => {
          const response = await axios.get<NpmSearchResponse>(this.npmSearchUrl, {
            params: {
              text: 'keywords:n8n-community-node-package',
              size,
              from: offset,
              // Sort by popularity (downloads)
              quality: 0,
              popularity: 1,
              maintenance: 0,
            },
            timeout: FETCH_CONFIG.STRAPI_TIMEOUT,
          });
          return response.data;
        },
        `Fetching npm packages (offset ${offset})`
      );

      if (result === null) {
        logger.warn(`Skipping npm fetch at offset ${offset} after failed attempts`);
        break;
      }

      if (result.objects.length === 0) {
        break; // No more packages
      }

      allPackages.push(...result.objects);

      if (progressCallback) {
        progressCallback(`Fetching npm packages`, allPackages.length, Math.min(result.total, targetLimit));
      }

      logger.debug(
        `Fetched ${result.objects.length} packages (total: ${allPackages.length}/${Math.min(result.total, targetLimit)})`
      );

      offset += size;

      // Rate limiting
      await this.sleep(FETCH_CONFIG.RATE_LIMIT_DELAY);
    }

    // Sort by popularity score (highest first)
    allPackages.sort((a, b) => b.score.detail.popularity - a.score.detail.popularity);

    logger.info(`Fetched ${allPackages.length} community node packages from npm`);
    return allPackages.slice(0, limit);
  }

  /**
   * Fetch package.json for a specific npm package to get the n8n node configuration.
   * Validates package name to prevent path traversal attacks.
   *
   * Callers that can proceed without the manifest may pass a smaller retry
   * budget or timeout so one slow package does not hold up a bulk sync.
   */
  async fetchPackageJson(
    packageName: string,
    version?: string,
    options?: { maxRetries?: number; timeout?: number }
  ): Promise<any | null> {
    // Validate package name to prevent path traversal
    if (!this.validatePackageName(packageName)) {
      logger.warn(`Invalid package name rejected: ${packageName}`);
      return null;
    }

    const url = version
      ? `${this.npmRegistryUrl}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
      : `${this.npmRegistryUrl}/${encodeURIComponent(packageName)}/latest`;

    return this.retryWithBackoff(
      async () => {
        const response = await axios.get(url, {
          timeout: options?.timeout ?? FETCH_CONFIG.NPM_REGISTRY_TIMEOUT
        });
        return response.data;
      },
      `Fetching package.json for ${packageName}${version ? `@${version}` : ''}`,
      options?.maxRetries ?? this.maxRetries
    );
  }

  /**
   * Download package tarball URL for a specific package version.
   * Returns the tarball URL that can be used to download and extract the package.
   */
  async getPackageTarballUrl(packageName: string, version?: string): Promise<string | null> {
    const packageJson = await this.fetchPackageJson(packageName, version);

    if (!packageJson) {
      return null;
    }

    // For specific version fetch, dist.tarball is directly available
    if (packageJson.dist?.tarball) {
      return packageJson.dist.tarball;
    }

    // For full package fetch, get the latest version's tarball
    const latestVersion = packageJson['dist-tags']?.latest;
    if (latestVersion && packageJson.versions?.[latestVersion]?.dist?.tarball) {
      return packageJson.versions[latestVersion].dist.tarball;
    }

    return null;
  }

  /**
   * Fetch full package data including README from npm registry.
   * Uses the base package URL (not /latest) to get the README field.
   * Validates package name to prevent path traversal attacks.
   *
   * @param packageName npm package name (e.g., "n8n-nodes-brightdata")
   * @returns Full package data including readme, or null if fetch failed
   */
  async fetchPackageWithReadme(packageName: string): Promise<NpmPackageWithReadme | null> {
    // Validate package name to prevent path traversal
    if (!this.validatePackageName(packageName)) {
      logger.warn(`Invalid package name rejected for README fetch: ${packageName}`);
      return null;
    }

    const url = `${this.npmRegistryUrl}/${encodeURIComponent(packageName)}`;

    return this.retryWithBackoff(
      async () => {
        const response = await axios.get<NpmPackageWithReadme>(url, {
          timeout: FETCH_CONFIG.NPM_REGISTRY_TIMEOUT,
        });
        return response.data;
      },
      `Fetching package with README for ${packageName}`
    );
  }

  /**
   * Fetch READMEs for multiple packages in batch with rate limiting.
   * Returns a Map of packageName -> readme content.
   *
   * @param packageNames Array of npm package names
   * @param progressCallback Optional callback for progress updates
   * @param concurrency Number of concurrent requests (default: 1 for rate limiting)
   * @returns Map of packageName to README content (null if not found)
   */
  async fetchReadmesBatch(
    packageNames: string[],
    progressCallback?: (message: string, current: number, total: number) => void,
    concurrency: number = 1
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const total = packageNames.length;

    logger.info(`Fetching READMEs for ${total} packages (concurrency: ${concurrency})...`);

    // Process in batches based on concurrency
    for (let i = 0; i < packageNames.length; i += concurrency) {
      const batch = packageNames.slice(i, i + concurrency);

      // Process batch concurrently
      const batchPromises = batch.map(async (packageName) => {
        const data = await this.fetchPackageWithReadme(packageName);
        return { packageName, readme: data?.readme || null };
      });

      const batchResults = await Promise.all(batchPromises);

      for (const { packageName, readme } of batchResults) {
        results.set(packageName, readme);
      }

      if (progressCallback) {
        progressCallback('Fetching READMEs', Math.min(i + concurrency, total), total);
      }

      // Rate limiting between batches
      if (i + concurrency < packageNames.length) {
        await this.sleep(FETCH_CONFIG.RATE_LIMIT_DELAY);
      }
    }

    const foundCount = Array.from(results.values()).filter((v) => v !== null).length;
    logger.info(`Fetched ${foundCount}/${total} READMEs successfully`);

    return results;
  }

  /**
   * Get download statistics for a package from npm.
   * Validates package name to prevent path traversal attacks.
   */
  async getPackageDownloads(
    packageName: string,
    period: 'last-week' | 'last-month' = 'last-week'
  ): Promise<number | null> {
    // Validate package name to prevent path traversal
    if (!this.validatePackageName(packageName)) {
      logger.warn(`Invalid package name rejected for downloads: ${packageName}`);
      return null;
    }

    return this.retryWithBackoff(
      async () => {
        const response = await axios.get(
          `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(packageName)}`,
          { timeout: FETCH_CONFIG.NPM_DOWNLOADS_TIMEOUT }
        );
        return response.data.downloads;
      },
      `Fetching downloads for ${packageName}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
