"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunityNodeFetcher = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const FETCH_CONFIG = {
    STRAPI_TIMEOUT: 30000,
    NPM_REGISTRY_TIMEOUT: 15000,
    NPM_DOWNLOADS_TIMEOUT: 10000,
    RETRY_DELAY: 1000,
    MAX_RETRIES: 3,
    RATE_LIMIT_DELAY: 300,
    RATE_LIMIT_429_DELAY: 60000,
};
class CommunityNodeFetcher {
    constructor(environment = 'production') {
        this.npmSearchUrl = 'https://registry.npmjs.org/-/v1/search';
        this.npmRegistryUrl = 'https://registry.npmjs.org';
        this.maxRetries = FETCH_CONFIG.MAX_RETRIES;
        this.retryDelay = FETCH_CONFIG.RETRY_DELAY;
        this.strapiPageSize = 25;
        this.npmPageSize = 250;
        this.npmPackageNameRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
        this.strapiBaseUrl =
            environment === 'production'
                ? 'https://api.n8n.io/api/community-nodes'
                : 'https://api-staging.n8n.io/api/community-nodes';
    }
    validatePackageName(packageName) {
        if (!packageName || typeof packageName !== 'string') {
            return false;
        }
        if (packageName.length > 214) {
            return false;
        }
        if (!this.npmPackageNameRegex.test(packageName)) {
            return false;
        }
        if (packageName.includes('..') || packageName.includes('//')) {
            return false;
        }
        return true;
    }
    isRateLimitError(error) {
        return axios_1.default.isAxiosError(error) && error.response?.status === 429;
    }
    async retryWithBackoff(fn, context, maxRetries = this.maxRetries) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    if (this.isRateLimitError(error)) {
                        const delay = FETCH_CONFIG.RATE_LIMIT_429_DELAY;
                        logger_1.logger.warn(`${context} - Rate limited (429), waiting ${delay / 1000}s before retry...`);
                        await this.sleep(delay);
                    }
                    else {
                        const delay = this.retryDelay * attempt;
                        logger_1.logger.warn(`${context} - Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
                        await this.sleep(delay);
                    }
                }
            }
        }
        logger_1.logger.error(`${context} - All ${maxRetries} attempts failed, skipping`, lastError);
        return null;
    }
    async fetchVerifiedNodes(progressCallback) {
        const allNodes = [];
        let page = 1;
        let hasMore = true;
        let total = 0;
        logger_1.logger.info('Fetching verified community nodes from n8n Strapi API...');
        while (hasMore) {
            const result = await this.retryWithBackoff(async () => {
                const response = await axios_1.default.get(this.strapiBaseUrl, {
                    params: {
                        'pagination[page]': page,
                        'pagination[pageSize]': this.strapiPageSize,
                    },
                    timeout: FETCH_CONFIG.STRAPI_TIMEOUT,
                });
                return response.data;
            }, `Fetching verified nodes page ${page}`);
            if (result === null) {
                logger_1.logger.warn(`Skipping page ${page} after failed attempts`);
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
            logger_1.logger.debug(`Fetched page ${page}/${result.meta.pagination.pageCount}: ${nodes.length} nodes (total: ${allNodes.length}/${total})`);
            if (page >= result.meta.pagination.pageCount) {
                hasMore = false;
            }
            page++;
            if (hasMore) {
                await this.sleep(FETCH_CONFIG.RATE_LIMIT_DELAY);
            }
        }
        logger_1.logger.info(`Fetched ${allNodes.length} verified community nodes from Strapi API`);
        return allNodes;
    }
    async fetchNpmPackages(limit = 100, progressCallback) {
        const allPackages = [];
        let offset = 0;
        const targetLimit = Math.min(limit, 1000);
        logger_1.logger.info(`Fetching top ${targetLimit} community node packages from npm registry...`);
        while (allPackages.length < targetLimit) {
            const remaining = targetLimit - allPackages.length;
            const size = Math.min(this.npmPageSize, remaining);
            const result = await this.retryWithBackoff(async () => {
                const response = await axios_1.default.get(this.npmSearchUrl, {
                    params: {
                        text: 'keywords:n8n-community-node-package',
                        size,
                        from: offset,
                        quality: 0,
                        popularity: 1,
                        maintenance: 0,
                    },
                    timeout: FETCH_CONFIG.STRAPI_TIMEOUT,
                });
                return response.data;
            }, `Fetching npm packages (offset ${offset})`);
            if (result === null) {
                logger_1.logger.warn(`Skipping npm fetch at offset ${offset} after failed attempts`);
                break;
            }
            if (result.objects.length === 0) {
                break;
            }
            allPackages.push(...result.objects);
            if (progressCallback) {
                progressCallback(`Fetching npm packages`, allPackages.length, Math.min(result.total, targetLimit));
            }
            logger_1.logger.debug(`Fetched ${result.objects.length} packages (total: ${allPackages.length}/${Math.min(result.total, targetLimit)})`);
            offset += size;
            await this.sleep(FETCH_CONFIG.RATE_LIMIT_DELAY);
        }
        allPackages.sort((a, b) => b.score.detail.popularity - a.score.detail.popularity);
        logger_1.logger.info(`Fetched ${allPackages.length} community node packages from npm`);
        return allPackages.slice(0, limit);
    }
    async fetchPackageJson(packageName, version) {
        if (!this.validatePackageName(packageName)) {
            logger_1.logger.warn(`Invalid package name rejected: ${packageName}`);
            return null;
        }
        const url = version
            ? `${this.npmRegistryUrl}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
            : `${this.npmRegistryUrl}/${encodeURIComponent(packageName)}/latest`;
        return this.retryWithBackoff(async () => {
            const response = await axios_1.default.get(url, { timeout: FETCH_CONFIG.NPM_REGISTRY_TIMEOUT });
            return response.data;
        }, `Fetching package.json for ${packageName}${version ? `@${version}` : ''}`);
    }
    async getPackageTarballUrl(packageName, version) {
        const packageJson = await this.fetchPackageJson(packageName, version);
        if (!packageJson) {
            return null;
        }
        if (packageJson.dist?.tarball) {
            return packageJson.dist.tarball;
        }
        const latestVersion = packageJson['dist-tags']?.latest;
        if (latestVersion && packageJson.versions?.[latestVersion]?.dist?.tarball) {
            return packageJson.versions[latestVersion].dist.tarball;
        }
        return null;
    }
    async fetchPackageWithReadme(packageName) {
        if (!this.validatePackageName(packageName)) {
            logger_1.logger.warn(`Invalid package name rejected for README fetch: ${packageName}`);
            return null;
        }
        const url = `${this.npmRegistryUrl}/${encodeURIComponent(packageName)}`;
        return this.retryWithBackoff(async () => {
            const response = await axios_1.default.get(url, {
                timeout: FETCH_CONFIG.NPM_REGISTRY_TIMEOUT,
            });
            return response.data;
        }, `Fetching package with README for ${packageName}`);
    }
    async fetchReadmesBatch(packageNames, progressCallback, concurrency = 1) {
        const results = new Map();
        const total = packageNames.length;
        logger_1.logger.info(`Fetching READMEs for ${total} packages (concurrency: ${concurrency})...`);
        for (let i = 0; i < packageNames.length; i += concurrency) {
            const batch = packageNames.slice(i, i + concurrency);
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
            if (i + concurrency < packageNames.length) {
                await this.sleep(FETCH_CONFIG.RATE_LIMIT_DELAY);
            }
        }
        const foundCount = Array.from(results.values()).filter((v) => v !== null).length;
        logger_1.logger.info(`Fetched ${foundCount}/${total} READMEs successfully`);
        return results;
    }
    async getPackageDownloads(packageName, period = 'last-week') {
        if (!this.validatePackageName(packageName)) {
            logger_1.logger.warn(`Invalid package name rejected for downloads: ${packageName}`);
            return null;
        }
        return this.retryWithBackoff(async () => {
            const response = await axios_1.default.get(`https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(packageName)}`, { timeout: FETCH_CONFIG.NPM_DOWNLOADS_TIMEOUT });
            return response.data.downloads;
        }, `Fetching downloads for ${packageName}`);
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.CommunityNodeFetcher = CommunityNodeFetcher;
//# sourceMappingURL=community-node-fetcher.js.map