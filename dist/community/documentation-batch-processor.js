"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentationBatchProcessor = void 0;
const community_node_fetcher_1 = require("./community-node-fetcher");
const documentation_generator_1 = require("./documentation-generator");
const logger_1 = require("../utils/logger");
class DocumentationBatchProcessor {
    constructor(repository, fetcher, generator) {
        this.repository = repository;
        this.fetcher = fetcher || new community_node_fetcher_1.CommunityNodeFetcher();
        this.generator = generator || (0, documentation_generator_1.createDocumentationGenerator)();
    }
    async processAll(options = {}) {
        const startTime = Date.now();
        const result = {
            readmesFetched: 0,
            readmesFailed: 0,
            summariesGenerated: 0,
            summariesFailed: 0,
            skipped: 0,
            durationSeconds: 0,
            errors: [],
        };
        const { skipExistingReadme = false, skipExistingSummary = false, readmeOnly = false, summaryOnly = false, limit, readmeConcurrency = 5, llmConcurrency = 3, progressCallback, } = options;
        try {
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
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Batch processing failed: ${errorMessage}`);
            result.durationSeconds = (Date.now() - startTime) / 1000;
            return result;
        }
    }
    async fetchReadmes(options) {
        const { skipExisting = false, limit, concurrency = 5, progressCallback } = options;
        let nodes = skipExisting
            ? this.repository.getCommunityNodesWithoutReadme()
            : this.repository.getCommunityNodes({ orderBy: 'downloads' });
        if (limit) {
            nodes = nodes.slice(0, limit);
        }
        logger_1.logger.info(`Fetching READMEs for ${nodes.length} community nodes...`);
        if (nodes.length === 0) {
            return { fetched: 0, failed: 0, skipped: 0, errors: [] };
        }
        const packageNames = nodes
            .map((n) => n.npmPackageName)
            .filter((name) => !!name);
        const readmeMap = await this.fetcher.fetchReadmesBatch(packageNames, progressCallback, concurrency);
        let fetched = 0;
        let failed = 0;
        const errors = [];
        for (const node of nodes) {
            if (!node.npmPackageName)
                continue;
            const readme = readmeMap.get(node.npmPackageName);
            if (readme) {
                try {
                    this.repository.updateNodeReadme(node.nodeType, readme);
                    fetched++;
                }
                catch (error) {
                    const msg = `Failed to save README for ${node.nodeType}: ${error}`;
                    errors.push(msg);
                    failed++;
                }
            }
            else {
                failed++;
            }
        }
        logger_1.logger.info(`README fetch complete: ${fetched} fetched, ${failed} failed`);
        return { fetched, failed, skipped: 0, errors };
    }
    async generateSummaries(options) {
        const { skipExisting = false, limit, concurrency = 3, progressCallback } = options;
        let nodes = skipExisting
            ? this.repository.getCommunityNodesWithoutAISummary()
            : this.repository.getCommunityNodes({ orderBy: 'downloads' }).filter((n) => n.npmReadme && n.npmReadme.length > 0);
        if (limit) {
            nodes = nodes.slice(0, limit);
        }
        logger_1.logger.info(`Generating AI summaries for ${nodes.length} nodes...`);
        if (nodes.length === 0) {
            return { generated: 0, failed: 0, skipped: 0, errors: [] };
        }
        const connectionTest = await this.generator.testConnection();
        if (!connectionTest.success) {
            const error = `LLM connection failed: ${connectionTest.message}`;
            logger_1.logger.error(error);
            return { generated: 0, failed: nodes.length, skipped: 0, errors: [error] };
        }
        logger_1.logger.info(`LLM connection successful: ${connectionTest.message}`);
        const inputs = nodes.map((node) => ({
            nodeType: node.nodeType,
            displayName: node.displayName,
            description: node.description,
            readme: node.npmReadme || '',
            npmPackageName: node.npmPackageName,
        }));
        const results = await this.generator.generateBatch(inputs, concurrency, progressCallback);
        let generated = 0;
        let failed = 0;
        const errors = [];
        for (const result of results) {
            if (result.error) {
                errors.push(`${result.nodeType}: ${result.error}`);
                failed++;
            }
            else {
                try {
                    this.repository.updateNodeAISummary(result.nodeType, result.summary);
                    generated++;
                }
                catch (error) {
                    const msg = `Failed to save summary for ${result.nodeType}: ${error}`;
                    errors.push(msg);
                    failed++;
                }
            }
        }
        logger_1.logger.info(`AI summary generation complete: ${generated} generated, ${failed} failed`);
        return { generated, failed, skipped: 0, errors };
    }
    getStats() {
        return this.repository.getDocumentationStats();
    }
}
exports.DocumentationBatchProcessor = DocumentationBatchProcessor;
//# sourceMappingURL=documentation-batch-processor.js.map