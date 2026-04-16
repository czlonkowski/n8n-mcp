"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateService = void 0;
const template_repository_1 = require("./template-repository");
const logger_1 = require("../utils/logger");
class TemplateService {
    constructor(db) {
        this.repository = new template_repository_1.TemplateRepository(db);
    }
    async listNodeTemplates(nodeTypes, limit = 10, offset = 0) {
        const templates = this.repository.getTemplatesByNodes(nodeTypes, limit, offset);
        const total = this.repository.getNodeTemplatesCount(nodeTypes);
        return {
            items: templates.map(this.formatTemplateInfo),
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    async getTemplate(templateId, mode = 'full') {
        const template = this.repository.getTemplate(templateId);
        if (!template) {
            return null;
        }
        const workflow = JSON.parse(template.workflow_json || '{}');
        if (mode === 'nodes_only') {
            return {
                id: template.id,
                name: template.name,
                nodes: workflow.nodes?.map((n) => ({
                    type: n.type,
                    name: n.name
                })) || []
            };
        }
        if (mode === 'structure') {
            return {
                id: template.id,
                name: template.name,
                nodes: workflow.nodes?.map((n) => ({
                    id: n.id,
                    type: n.type,
                    name: n.name,
                    position: n.position
                })) || [],
                connections: workflow.connections || {}
            };
        }
        return {
            ...this.formatTemplateInfo(template),
            workflow
        };
    }
    async searchTemplates(query, limit = 20, offset = 0, fields) {
        const templates = this.repository.searchTemplates(query, limit, offset);
        const total = this.repository.getSearchCount(query);
        const items = fields
            ? templates.map(t => this.formatTemplateWithFields(t, fields))
            : templates.map(t => this.formatTemplateInfo(t));
        return {
            items,
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    async getTemplatesForTask(task, limit = 10, offset = 0) {
        const templates = this.repository.getTemplatesForTask(task, limit, offset);
        const total = this.repository.getTaskTemplatesCount(task);
        return {
            items: templates.map(this.formatTemplateInfo),
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    async listTemplates(limit = 10, offset = 0, sortBy = 'views', includeMetadata = false) {
        const templates = this.repository.getAllTemplates(limit, offset, sortBy);
        const total = this.repository.getTemplateCount();
        const items = templates.map(t => {
            const item = {
                id: t.id,
                name: t.name,
                description: t.description,
                views: t.views,
                nodeCount: JSON.parse(t.nodes_used).length
            };
            if (includeMetadata && t.metadata_json) {
                try {
                    item.metadata = JSON.parse(t.metadata_json);
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to parse metadata for template ${t.id}:`, error);
                }
            }
            return item;
        });
        return {
            items,
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    listAvailableTasks() {
        return [
            'ai_automation',
            'data_sync',
            'webhook_processing',
            'email_automation',
            'slack_integration',
            'data_transformation',
            'file_processing',
            'scheduling',
            'api_integration',
            'database_operations'
        ];
    }
    async searchTemplatesByMetadata(filters, limit = 20, offset = 0) {
        const templates = this.repository.searchTemplatesByMetadata(filters, limit, offset);
        const total = this.repository.getMetadataSearchCount(filters);
        return {
            items: templates.map(this.formatTemplateInfo.bind(this)),
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    async hasMetadataCoverage() {
        return this.repository.hasMetadataCoverage();
    }
    async getAvailableCategories() {
        return this.repository.getAvailableCategories();
    }
    async getAvailableTargetAudiences() {
        return this.repository.getAvailableTargetAudiences();
    }
    async getTemplatesByCategory(category, limit = 10, offset = 0) {
        const templates = this.repository.getTemplatesByCategory(category, limit, offset);
        const total = this.repository.getMetadataSearchCount({ category });
        return {
            items: templates.map(this.formatTemplateInfo.bind(this)),
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    async getTemplatesByComplexity(complexity, limit = 10, offset = 0) {
        const templates = this.repository.getTemplatesByComplexity(complexity, limit, offset);
        const total = this.repository.getMetadataSearchCount({ complexity });
        return {
            items: templates.map(this.formatTemplateInfo.bind(this)),
            total,
            limit,
            offset,
            hasMore: offset + limit < total
        };
    }
    async getTemplateStats() {
        return this.repository.getTemplateStats();
    }
    async fetchAndUpdateTemplates(progressCallback, mode = 'rebuild') {
        try {
            const { TemplateFetcher } = await Promise.resolve().then(() => __importStar(require('./template-fetcher')));
            const fetcher = new TemplateFetcher();
            let existingIds = new Set();
            let sinceDate;
            if (mode === 'update') {
                existingIds = this.repository.getExistingTemplateIds();
                logger_1.logger.info(`Update mode: Found ${existingIds.size} existing templates in database`);
                const mostRecentDate = this.repository.getMostRecentTemplateDate();
                if (mostRecentDate) {
                    sinceDate = new Date(mostRecentDate);
                    sinceDate.setDate(sinceDate.getDate() - 14);
                    logger_1.logger.info(`Update mode: Fetching templates since ${sinceDate.toISOString().split('T')[0]} (2 weeks before most recent)`);
                }
                else {
                    sinceDate = new Date();
                    sinceDate.setDate(sinceDate.getDate() - 14);
                    logger_1.logger.info(`Update mode: No existing templates, fetching from last 2 weeks`);
                }
            }
            else {
                this.repository.clearTemplates();
                logger_1.logger.info('Rebuild mode: Cleared existing templates');
            }
            logger_1.logger.info(`Fetching template list from n8n.io (mode: ${mode})`);
            const templates = await fetcher.fetchTemplates((current, total) => {
                progressCallback?.('Fetching template list', current, total);
            }, sinceDate);
            logger_1.logger.info(`Found ${templates.length} templates matching date criteria`);
            let templatesToFetch = templates;
            if (mode === 'update') {
                templatesToFetch = templates.filter(t => !existingIds.has(t.id));
                logger_1.logger.info(`Update mode: ${templatesToFetch.length} new templates to fetch (skipping ${templates.length - templatesToFetch.length} existing)`);
                if (templatesToFetch.length === 0) {
                    logger_1.logger.info('No new templates to fetch');
                    progressCallback?.('No new templates', 0, 0);
                    return;
                }
            }
            logger_1.logger.info(`Fetching details for ${templatesToFetch.length} templates`);
            const details = await fetcher.fetchAllTemplateDetails(templatesToFetch, (current, total) => {
                progressCallback?.('Fetching template details', current, total);
            });
            logger_1.logger.info('Saving templates to database');
            let saved = 0;
            for (const template of templatesToFetch) {
                const detail = details.get(template.id);
                if (detail) {
                    this.repository.saveTemplate(template, detail);
                    saved++;
                }
            }
            logger_1.logger.info(`Successfully saved ${saved} templates to database`);
            if (saved > 0) {
                logger_1.logger.info('Rebuilding FTS5 index for templates');
                this.repository.rebuildTemplateFTS();
            }
            progressCallback?.('Complete', saved, saved);
        }
        catch (error) {
            logger_1.logger.error('Error fetching templates:', error);
            throw error;
        }
    }
    formatTemplateInfo(template) {
        const info = {
            id: template.id,
            name: template.name,
            description: template.description,
            author: {
                name: template.author_name,
                username: template.author_username,
                verified: template.author_verified === 1
            },
            nodes: JSON.parse(template.nodes_used),
            views: template.views,
            created: template.created_at,
            url: template.url
        };
        if (template.metadata_json) {
            try {
                info.metadata = JSON.parse(template.metadata_json);
            }
            catch (error) {
                logger_1.logger.warn(`Failed to parse metadata for template ${template.id}:`, error);
            }
        }
        return info;
    }
    formatTemplateWithFields(template, fields) {
        const fullInfo = this.formatTemplateInfo(template);
        const result = {};
        for (const field of fields) {
            if (field in fullInfo) {
                result[field] = fullInfo[field];
            }
        }
        return result;
    }
}
exports.TemplateService = TemplateService;
//# sourceMappingURL=template-service.js.map