/**
 * Batch processor for community node documentation generation.
 *
 * Orchestrates the full workflow:
 * 1. Fetch READMEs from npm registry
 * 2. Generate AI documentation summaries
 * 3. Store results in database
 */

import { NodeRepository } from '../database/node-repository';
import { CommunityNodeFetcher } from './community-node-fetcher';
import {
  DocumentationGenerator,
  DocumentationInput,
  DocumentationResult,
  createDocumentationGenerator,
} from './documentation-generator';
import { logger } from '../utils/logger';

/**
 * Options for batch processing
 */
export interface BatchProcessorOptions {
  /** Skip nodes that already have READMEs (default: false) */
  skipExistingReadme?: boolean;
  /** Skip nodes that already have AI summaries (default: false) */
  skipExistingSummary?: boolean;
  /** Only fetch READMEs, skip AI generation (default: false) */
  readmeOnly?: boolean;
  /** Only generate AI summaries, skip README fetch (default: false) */
  summaryOnly?: boolean;
  /** Max nodes to process (default: unlimited) */
  limit?: number;
  /** Concurrency for npm README fetches (default: 5) */
  readmeConcurrency?: number;
  /** Concurrency for LLM API calls (default: 3) */
  llmConcurrency?: number;
  /** Progress callback */
  progressCallback?: (message: string, current: number, total: number) => void;
}

/**
 * Result of batch processing
 */
export interface BatchProcessorResult {
  /** Number of READMEs fetched */
  readmesFetched: number;
  /** Number of READMEs that failed to fetch */
  readmesFailed: number;
  /** Number of AI summaries generated */
  summariesGenerated: number;
  /** Number of AI summaries that failed */
  summariesFailed: number;
  /** Nodes that were skipped (already had data) */
  skipped: number;
  /** Total duration in seconds */
  durationSeconds: number;
  /** Errors encountered */
  errors: string[];
}

/**
 * Batch processor for generating documentation for community nodes
 */
export class DocumentationBatchProcessor {
  private repository: NodeRepository;
  private fetcher: CommunityNodeFetcher;
  private generator: DocumentationGenerator;

  constructor(
    repository: NodeRepository,
    fetcher?: CommunityNodeFetcher,
    generator?: DocumentationGenerator
  ) {
    this.repository = repository;
    this.fetcher = fetcher || new CommunityNodeFetcher();
    this.generator = generator || createDocumentationGenerator();
  }

  /**
   * Process all community nodes to generate documentation
   */
  async processAll(options: BatchProcessorOptions = {}): Promise<BatchProcessorResult> {
    const startTime = Date.now();
    const result: BatchProcessorResult = {
      readmesFetched: 0,
      readmesFailed: 0,
      summariesGenerated: 0,
      summariesFailed: 0,
      skipped: 0,
      durationSeconds: 0,
      errors: [],
    };

    const {
      skipExistingReadme = false,
      skipExistingSummary = false,
      readmeOnly = false,
      summaryOnly = false,
      limit,
      readmeConcurrency = 5,
      llmConcurrency = 3,
      progressCallback,
    } = options;

    try {
      // Step 1: Fetch READMEs (unless summaryOnly)
      if (!summaryOnly) {
        const readmeResult = await this.fetchReadmes({
          skipExisting: skipExistingReadme,
          limit,
          concurrency: readmeConcurrency,
          progressCallback,
        });
        result.readmesFetched = readmeResult.fetched;
        result.readmesFailed = readmeResult.failed;
        result.skipped += readmeResult.skipped;
        result.errors.push(...readmeResult.errors);
      }

      // Step 2: Generate AI summaries (unless readmeOnly)
      if (!readmeOnly) {
        const summaryResult = await this.generateSummaries({
          skipExisting: skipExistingSummary,
          limit,
          concurrency: llmConcurrency,
          progressCallback,
        });
        result.summariesGenerated = summaryResult.generated;
        result.summariesFailed = summaryResult.failed;
        result.skipped += summaryResult.skipped;
        result.errors.push(...summaryResult.errors);
      }

      result.durationSeconds = (Date.now() - startTime) / 1000;
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Batch processing failed: ${errorMessage}`);
      result.durationSeconds = (Date.now() - startTime) / 1000;
      return result;
    }
  }

  /**
   * Fetch READMEs for community nodes
   */
  private async fetchReadmes(options: {
    skipExisting?: boolean;
    limit?: number;
    concurrency?: number;
    progressCallback?: (message: string, current: number, total: number) => void;
  }): Promise<{ fetched: number; failed: number; skipped: number; errors: string[] }> {
    const { skipExisting = false, limit, concurrency = 5, progressCallback } = options;

    // Get nodes that need READMEs
    let nodes = skipExisting
      ? this.repository.getCommunityNodesWithoutReadme()
      : this.repository.getCommunityNodes({ orderBy: 'downloads' });

    if (limit) {
      nodes = nodes.slice(0, limit);
    }

    logger.info(`Fetching READMEs for ${nodes.length} community nodes...`);

    if (nodes.length === 0) {
      return { fetched: 0, failed: 0, skipped: 0, errors: [] };
    }

    // Get package names. READMEs are package-level, so the rows of a multi-node
    // package resolve to a single fetch (#967).
    const packageNames = [
      ...new Set(nodes.map((n) => n.npmPackageName).filter((name): name is string => !!name)),
    ];

    // Fetch READMEs in batches
    const readmeMap = await this.fetcher.fetchReadmesBatch(
      packageNames,
      progressCallback,
      concurrency
    );

    // Store READMEs in database
    let fetched = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const node of nodes) {
      if (!node.npmPackageName) continue;

      const readme = readmeMap.get(node.npmPackageName);
      if (readme) {
        try {
          this.repository.updateNodeReadme(node.nodeType, readme);
          fetched++;
        } catch (error) {
          const msg = `Failed to save README for ${node.nodeType}: ${error}`;
          errors.push(msg);
          failed++;
        }
      } else {
        failed++;
      }
    }

    logger.info(`README fetch complete: ${fetched} fetched, ${failed} failed`);
    return { fetched, failed, skipped: 0, errors };
  }

  /**
   * Generate AI documentation summaries
   */
  private async generateSummaries(options: {
    skipExisting?: boolean;
    limit?: number;
    concurrency?: number;
    progressCallback?: (message: string, current: number, total: number) => void;
  }): Promise<{ generated: number; failed: number; skipped: number; errors: string[] }> {
    const { skipExisting = false, limit, concurrency = 3, progressCallback } = options;

    // Get nodes that need summaries (must have READMEs first)
    let nodes = skipExisting
      ? this.repository.getCommunityNodesWithoutAISummary()
      : this.repository.getCommunityNodes({ orderBy: 'downloads' }).filter(
          (n) => n.npmReadme && n.npmReadme.length > 0
        );

    if (limit) {
      nodes = nodes.slice(0, limit);
    }

    logger.info(`Generating AI summaries for ${nodes.length} nodes...`);

    if (nodes.length === 0) {
      return { generated: 0, failed: 0, skipped: 0, errors: [] };
    }

    // Test LLM connection first
    const connectionTest = await this.generator.testConnection();
    if (!connectionTest.success) {
      const error = `LLM connection failed: ${connectionTest.message}`;
      logger.error(error);
      return { generated: 0, failed: nodes.length, skipped: 0, errors: [error] };
    }

    logger.info(`LLM connection successful: ${connectionTest.message}`);

    // The rows of a multi-node package share one README, so summarising each row
    // would repeat the same LLM call. Generate once per package and fan the
    // result out to its rows (#967).
    const packageGroups = new Map<string, any[]>();
    for (const node of nodes) {
      const key = node.npmPackageName || node.nodeType;
      const group = packageGroups.get(key);
      if (group) {
        group.push(node);
      } else {
        packageGroups.set(key, [node]);
      }
    }

    // Prepare inputs for batch generation - one per package, keyed by the
    // representative row's node type so results map back to their group. The
    // prompt gets the package's node names, not the representative's identity:
    // the summary is stored on every row of the package.
    const targetsByNodeType = new Map<string, any[]>();
    const inputs: DocumentationInput[] = [];
    for (const group of packageGroups.values()) {
      const [representative] = group;
      targetsByNodeType.set(representative.nodeType, group);
      inputs.push({
        nodeType: representative.nodeType,
        displayName: representative.displayName,
        description: representative.description,
        readme: representative.npmReadme || '',
        npmPackageName: representative.npmPackageName,
        nodeNames: group.map((node) => node.displayName || node.nodeType),
      });
    }

    // Generate summaries in parallel
    const results = await this.generator.generateBatch(inputs, concurrency, progressCallback);

    // Store summaries in database
    let generated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const result of results) {
      // A result that maps to no group is stored under its own node type.
      const targets = targetsByNodeType.get(result.nodeType) ?? [{ nodeType: result.nodeType }];

      if (result.error) {
        errors.push(`${result.nodeType}: ${result.error}`);
        failed += targets.length;
        continue;
      }

      for (const target of targets) {
        try {
          this.repository.updateNodeAISummary(target.nodeType, result.summary);
          generated++;
        } catch (error) {
          const msg = `Failed to save summary for ${target.nodeType}: ${error}`;
          errors.push(msg);
          failed++;
        }
      }
    }

    logger.info(
      `AI summary generation complete: ${generated} row(s) from ${inputs.length} package(s), ${failed} failed`
    );
    return { generated, failed, skipped: 0, errors };
  }

  /**
   * Get current documentation statistics
   */
  getStats(): ReturnType<NodeRepository['getDocumentationStats']> {
    return this.repository.getDocumentationStats();
  }
}
