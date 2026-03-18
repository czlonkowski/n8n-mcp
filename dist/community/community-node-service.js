"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunityNodeService = void 0;
const logger_1 = require("../utils/logger");
const community_node_fetcher_1 = require("./community-node-fetcher");
class CommunityNodeService {
    constructor(repository, environment = 'production') {
        this.repository = repository;
        this.fetcher = new community_node_fetcher_1.CommunityNodeFetcher(environment);
    }
    async syncCommunityNodes(options = {}, progressCallback) {
        const startTime = Date.now();
        const result = {
            verified: { fetched: 0, saved: 0, skipped: 0, errors: [] },
            npm: { fetched: 0, saved: 0, skipped: 0, errors: [] },
            duration: 0,
        };
        logger_1.logger.info('Syncing verified community nodes from Strapi API...');
        try {
            result.verified = await this.syncVerifiedNodes(progressCallback, options.skipExisting);
        }
        catch (error) {
            logger_1.logger.error('Failed to sync verified nodes:', error);
            result.verified.errors.push(`Strapi sync failed: ${error.message}`);
        }
        if (!options.verifiedOnly) {
            const npmLimit = options.npmLimit ?? 100;
            logger_1.logger.info(`Syncing top ${npmLimit} npm community packages...`);
            try {
                result.npm = await this.syncNpmNodes(npmLimit, progressCallback, options.skipExisting);
            }
            catch (error) {
                logger_1.logger.error('Failed to sync npm nodes:', error);
                result.npm.errors.push(`npm sync failed: ${error.message}`);
            }
        }
        result.duration = Date.now() - startTime;
        logger_1.logger.info(`Community node sync complete in ${(result.duration / 1000).toFixed(1)}s: ` +
            `${result.verified.saved} verified, ${result.npm.saved} npm`);
        return result;
    }
    async syncVerifiedNodes(progressCallback, skipExisting) {
        const result = { fetched: 0, saved: 0, skipped: 0, errors: [] };
        const strapiNodes = await this.fetcher.fetchVerifiedNodes(progressCallback);
        result.fetched = strapiNodes.length;
        if (strapiNodes.length === 0) {
            logger_1.logger.warn('No verified nodes returned from Strapi API');
            return result;
        }
        logger_1.logger.info(`Processing ${strapiNodes.length} verified community nodes...`);
        for (const strapiNode of strapiNodes) {
            try {
                const { attributes } = strapiNode;
                if (skipExisting && this.repository.hasNodeByNpmPackage(attributes.packageName)) {
                    result.skipped++;
                    continue;
                }
                const parsedNode = this.strapiNodeToParsedNode(strapiNode);
                if (!parsedNode) {
                    result.errors.push(`Failed to parse: ${attributes.packageName}`);
                    continue;
                }
                this.repository.saveNode(parsedNode);
                result.saved++;
                if (progressCallback) {
                    progressCallback(`Saving verified nodes`, result.saved + result.skipped, strapiNodes.length);
                }
            }
            catch (error) {
                result.errors.push(`Error saving ${strapiNode.attributes.packageName}: ${error.message}`);
            }
        }
        logger_1.logger.info(`Verified nodes: ${result.saved} saved, ${result.skipped} skipped`);
        return result;
    }
    async syncNpmNodes(limit = 100, progressCallback, skipExisting) {
        const result = { fetched: 0, saved: 0, skipped: 0, errors: [] };
        const npmPackages = await this.fetcher.fetchNpmPackages(limit, progressCallback);
        result.fetched = npmPackages.length;
        if (npmPackages.length === 0) {
            logger_1.logger.warn('No npm packages returned from registry');
            return result;
        }
        const verifiedPackages = new Set(this.repository
            .getCommunityNodes({ verified: true })
            .map((n) => n.npmPackageName)
            .filter(Boolean));
        logger_1.logger.info(`Processing ${npmPackages.length} npm packages (skipping ${verifiedPackages.size} verified)...`);
        for (const pkg of npmPackages) {
            try {
                const packageName = pkg.package.name;
                if (verifiedPackages.has(packageName)) {
                    result.skipped++;
                    continue;
                }
                if (skipExisting && this.repository.hasNodeByNpmPackage(packageName)) {
                    result.skipped++;
                    continue;
                }
                const parsedNode = this.npmPackageToParsedNode(pkg);
                this.repository.saveNode(parsedNode);
                result.saved++;
                if (progressCallback) {
                    progressCallback(`Saving npm packages`, result.saved + result.skipped, npmPackages.length);
                }
            }
            catch (error) {
                result.errors.push(`Error saving ${pkg.package.name}: ${error.message}`);
            }
        }
        logger_1.logger.info(`npm packages: ${result.saved} saved, ${result.skipped} skipped`);
        return result;
    }
    strapiNodeToParsedNode(strapiNode) {
        const { attributes } = strapiNode;
        const nodeDesc = attributes.nodeDescription;
        if (!nodeDesc) {
            logger_1.logger.warn(`No nodeDescription for ${attributes.packageName}`);
            return null;
        }
        let nodeType = nodeDesc.name || `${attributes.packageName}.${attributes.name}`;
        if (nodeType.includes('n8n-nodes-preview-')) {
            nodeType = nodeType.replace('n8n-nodes-preview-', 'n8n-nodes-');
        }
        const isAITool = nodeDesc.usableAsTool === true ||
            nodeDesc.codex?.categories?.includes('AI') ||
            attributes.name?.toLowerCase().includes('ai');
        return {
            nodeType,
            packageName: attributes.packageName,
            displayName: nodeDesc.displayName || attributes.displayName,
            description: nodeDesc.description || attributes.description,
            category: nodeDesc.codex?.categories?.[0] || 'Community',
            style: 'declarative',
            properties: nodeDesc.properties || [],
            credentials: nodeDesc.credentials || [],
            operations: this.extractOperations(nodeDesc),
            isAITool,
            isTrigger: nodeDesc.group?.includes('trigger') || false,
            isWebhook: nodeDesc.name?.toLowerCase().includes('webhook') ||
                nodeDesc.group?.includes('webhook') ||
                false,
            isVersioned: (attributes.nodeVersions?.length || 0) > 1,
            version: nodeDesc.version?.toString() || attributes.npmVersion || '1',
            outputs: nodeDesc.outputs,
            outputNames: nodeDesc.outputNames,
            isCommunity: true,
            isVerified: true,
            authorName: attributes.authorName,
            authorGithubUrl: attributes.authorGithubUrl,
            npmPackageName: attributes.packageName,
            npmVersion: attributes.npmVersion,
            npmDownloads: attributes.numberOfDownloads || 0,
            communityFetchedAt: new Date().toISOString(),
        };
    }
    npmPackageToParsedNode(pkg) {
        const { package: pkgInfo, score } = pkg;
        const nodeName = this.extractNodeNameFromPackage(pkgInfo.name);
        const nodeType = `${pkgInfo.name}.${nodeName}`;
        return {
            nodeType,
            packageName: pkgInfo.name,
            displayName: nodeName,
            description: pkgInfo.description || `Community node from ${pkgInfo.name}`,
            category: 'Community',
            style: 'declarative',
            properties: [],
            credentials: [],
            operations: [],
            isAITool: false,
            isTrigger: pkgInfo.name.includes('trigger'),
            isWebhook: pkgInfo.name.includes('webhook'),
            isVersioned: false,
            version: pkgInfo.version,
            isCommunity: true,
            isVerified: false,
            authorName: pkgInfo.author?.name || pkgInfo.publisher?.username,
            authorGithubUrl: pkgInfo.links?.repository,
            npmPackageName: pkgInfo.name,
            npmVersion: pkgInfo.version,
            npmDownloads: Math.round(score.detail.popularity * 10000),
            communityFetchedAt: new Date().toISOString(),
        };
    }
    extractOperations(nodeDesc) {
        const operations = [];
        if (nodeDesc.properties) {
            for (const prop of nodeDesc.properties) {
                if (prop.name === 'operation' && prop.options) {
                    operations.push(...prop.options);
                }
            }
        }
        return operations;
    }
    extractNodeNameFromPackage(packageName) {
        let name = packageName.replace(/^@[^/]+\//, '');
        name = name.replace(/^n8n-nodes-/, '');
        return name.replace(/-/g, '').toLowerCase();
    }
    getCommunityStats() {
        return this.repository.getCommunityStats();
    }
    deleteCommunityNodes() {
        return this.repository.deleteCommunityNodes();
    }
}
exports.CommunityNodeService = CommunityNodeService;
//# sourceMappingURL=community-node-service.js.map