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
exports.TemplateRepository = void 0;
const logger_1 = require("../utils/logger");
const template_sanitizer_1 = require("../utils/template-sanitizer");
const zlib = __importStar(require("zlib"));
const template_node_resolver_1 = require("../utils/template-node-resolver");
class TemplateRepository {
    constructor(db) {
        this.db = db;
        this.hasFTS5Support = false;
        this.sanitizer = new template_sanitizer_1.TemplateSanitizer();
        this.initializeFTS5();
    }
    initializeFTS5() {
        this.hasFTS5Support = this.db.checkFTS5Support();
        if (this.hasFTS5Support) {
            try {
                const ftsExists = this.db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='templates_fts'
        `).get();
                if (ftsExists) {
                    logger_1.logger.info('FTS5 table already exists for templates');
                    try {
                        const testCount = this.db.prepare('SELECT COUNT(*) as count FROM templates_fts').get();
                        logger_1.logger.info(`FTS5 enabled with ${testCount.count} indexed entries`);
                    }
                    catch (testError) {
                        logger_1.logger.warn('FTS5 table exists but query failed:', testError);
                        this.hasFTS5Support = false;
                        return;
                    }
                }
                else {
                    logger_1.logger.info('Creating FTS5 virtual table for templates...');
                    this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS templates_fts USING fts5(
              name, description, content=templates
            );
          `);
                    this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS templates_ai AFTER INSERT ON templates BEGIN
              INSERT INTO templates_fts(rowid, name, description)
              VALUES (new.id, new.name, new.description);
            END;
          `);
                    this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS templates_au AFTER UPDATE ON templates BEGIN
              UPDATE templates_fts SET name = new.name, description = new.description
              WHERE rowid = new.id;
            END;
          `);
                    this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS templates_ad AFTER DELETE ON templates BEGIN
              DELETE FROM templates_fts WHERE rowid = old.id;
            END;
          `);
                    logger_1.logger.info('FTS5 support enabled for template search');
                }
            }
            catch (error) {
                logger_1.logger.warn('Failed to initialize FTS5 for templates:', {
                    message: error.message,
                    code: error.code,
                    stack: error.stack
                });
                this.hasFTS5Support = false;
            }
        }
        else {
            logger_1.logger.info('FTS5 not available, using LIKE search for templates');
        }
    }
    saveTemplate(workflow, detail, categories = []) {
        if ((workflow.totalViews || 0) <= 10) {
            logger_1.logger.debug(`Skipping template ${workflow.id}: ${workflow.name} (only ${workflow.totalViews} views)`);
            return;
        }
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO templates (
        id, workflow_id, name, description, author_name, author_username,
        author_verified, nodes_used, workflow_json_compressed, categories, views,
        created_at, updated_at, url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const nodeTypes = detail.workflow.nodes.map(n => n.type);
        const url = `https://n8n.io/workflows/${workflow.id}`;
        const { sanitized: sanitizedWorkflow, wasModified } = this.sanitizer.sanitizeWorkflow(detail.workflow);
        if (wasModified) {
            const detectedTokens = this.sanitizer.detectTokens(detail.workflow);
            logger_1.logger.warn(`Sanitized API tokens in template ${workflow.id}: ${workflow.name}`, {
                templateId: workflow.id,
                templateName: workflow.name,
                tokensFound: detectedTokens.length,
                tokenPreviews: detectedTokens.map(t => t.substring(0, 20) + '...')
            });
        }
        const workflowJsonStr = JSON.stringify(sanitizedWorkflow);
        const compressed = zlib.gzipSync(workflowJsonStr);
        const compressedBase64 = compressed.toString('base64');
        const originalSize = Buffer.byteLength(workflowJsonStr);
        const compressedSize = compressed.length;
        const ratio = Math.round((1 - compressedSize / originalSize) * 100);
        logger_1.logger.debug(`Template ${workflow.id} compression: ${originalSize} → ${compressedSize} bytes (${ratio}% reduction)`);
        stmt.run(workflow.id, workflow.id, workflow.name, workflow.description || '', workflow.user.name, workflow.user.username, workflow.user.verified ? 1 : 0, JSON.stringify(nodeTypes), compressedBase64, JSON.stringify(categories), workflow.totalViews || 0, workflow.createdAt, workflow.createdAt, url);
    }
    getTemplatesByNodes(nodeTypes, limit = 10, offset = 0) {
        const resolvedTypes = (0, template_node_resolver_1.resolveTemplateNodeTypes)(nodeTypes);
        if (resolvedTypes.length === 0) {
            logger_1.logger.debug('No resolved types for template search', { input: nodeTypes });
            return [];
        }
        const conditions = resolvedTypes.map(() => "nodes_used LIKE ?").join(" OR ");
        const query = `
      SELECT * FROM templates 
      WHERE ${conditions}
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
        const params = [...resolvedTypes.map(n => `%"${n}"%`), limit, offset];
        const results = this.db.prepare(query).all(...params);
        logger_1.logger.debug(`Template search found ${results.length} results`, {
            input: nodeTypes,
            resolved: resolvedTypes,
            found: results.length
        });
        return results.map(t => this.decompressWorkflow(t));
    }
    getTemplate(templateId) {
        const row = this.db.prepare(`
      SELECT * FROM templates WHERE id = ?
    `).get(templateId);
        if (!row)
            return null;
        if (row.workflow_json_compressed && !row.workflow_json) {
            try {
                const compressed = Buffer.from(row.workflow_json_compressed, 'base64');
                const decompressed = zlib.gunzipSync(compressed);
                row.workflow_json = decompressed.toString();
            }
            catch (error) {
                logger_1.logger.error(`Failed to decompress workflow for template ${templateId}:`, error);
                return null;
            }
        }
        return row;
    }
    decompressWorkflow(template) {
        if (template.workflow_json_compressed && !template.workflow_json) {
            try {
                const compressed = Buffer.from(template.workflow_json_compressed, 'base64');
                const decompressed = zlib.gunzipSync(compressed);
                template.workflow_json = decompressed.toString();
            }
            catch (error) {
                logger_1.logger.error(`Failed to decompress workflow for template ${template.id}:`, error);
            }
        }
        return template;
    }
    searchTemplates(query, limit = 20, offset = 0) {
        logger_1.logger.debug(`Searching templates for: "${query}" (FTS5: ${this.hasFTS5Support})`);
        if (!this.hasFTS5Support) {
            logger_1.logger.debug('Using LIKE search (FTS5 not available)');
            return this.searchTemplatesLIKE(query, limit, offset);
        }
        try {
            const ftsQuery = query.split(' ').map(term => {
                const escaped = term.replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(' OR ');
            logger_1.logger.debug(`FTS5 query: ${ftsQuery}`);
            const results = this.db.prepare(`
        SELECT t.* FROM templates t
        JOIN templates_fts ON t.id = templates_fts.rowid
        WHERE templates_fts MATCH ?
        ORDER BY rank, t.views DESC
        LIMIT ? OFFSET ?
      `).all(ftsQuery, limit, offset);
            logger_1.logger.debug(`FTS5 search returned ${results.length} results`);
            return results.map(t => this.decompressWorkflow(t));
        }
        catch (error) {
            logger_1.logger.warn('FTS5 template search failed, using LIKE fallback:', {
                message: error.message,
                query: query,
                ftsQuery: query.split(' ').map(term => `"${term}"`).join(' OR ')
            });
            return this.searchTemplatesLIKE(query, limit, offset);
        }
    }
    searchTemplatesLIKE(query, limit = 20, offset = 0) {
        const likeQuery = `%${query}%`;
        logger_1.logger.debug(`Using LIKE search with pattern: ${likeQuery}`);
        const results = this.db.prepare(`
      SELECT * FROM templates 
      WHERE name LIKE ? OR description LIKE ?
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(likeQuery, likeQuery, limit, offset);
        logger_1.logger.debug(`LIKE search returned ${results.length} results`);
        return results.map(t => this.decompressWorkflow(t));
    }
    getTemplatesForTask(task, limit = 10, offset = 0) {
        const taskNodeMap = {
            'ai_automation': ['@n8n/n8n-nodes-langchain.openAi', '@n8n/n8n-nodes-langchain.agent', 'n8n-nodes-base.openAi'],
            'data_sync': ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.postgres', 'n8n-nodes-base.mysql'],
            'webhook_processing': ['n8n-nodes-base.webhook'],
            'email_automation': ['n8n-nodes-base.gmail', 'n8n-nodes-base.emailSend', 'n8n-nodes-base.emailReadImap'],
            'slack_integration': ['n8n-nodes-base.slack', 'n8n-nodes-base.slackTrigger'],
            'data_transformation': ['n8n-nodes-base.code', 'n8n-nodes-base.set', 'n8n-nodes-base.merge'],
            'file_processing': ['n8n-nodes-base.readBinaryFile', 'n8n-nodes-base.writeBinaryFile', 'n8n-nodes-base.googleDrive'],
            'scheduling': ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.cron'],
            'api_integration': ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.graphql'],
            'database_operations': ['n8n-nodes-base.postgres', 'n8n-nodes-base.mysql', 'n8n-nodes-base.mongodb']
        };
        const nodes = taskNodeMap[task];
        if (!nodes) {
            return [];
        }
        return this.getTemplatesByNodes(nodes, limit, offset);
    }
    getAllTemplates(limit = 10, offset = 0, sortBy = 'views') {
        const orderClause = sortBy === 'name' ? 'name ASC' :
            sortBy === 'created_at' ? 'created_at DESC' :
                'views DESC, created_at DESC';
        const results = this.db.prepare(`
      SELECT * FROM templates 
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `).all(limit, offset);
        return results.map(t => this.decompressWorkflow(t));
    }
    getTemplateCount() {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM templates').get();
        return result.count;
    }
    getSearchCount(query) {
        if (!this.hasFTS5Support) {
            const likeQuery = `%${query}%`;
            const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM templates 
        WHERE name LIKE ? OR description LIKE ?
      `).get(likeQuery, likeQuery);
            return result.count;
        }
        try {
            const ftsQuery = query.split(' ').map(term => {
                const escaped = term.replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(' OR ');
            const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM templates t
        JOIN templates_fts ON t.id = templates_fts.rowid
        WHERE templates_fts MATCH ?
      `).get(ftsQuery);
            return result.count;
        }
        catch {
            const likeQuery = `%${query}%`;
            const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM templates 
        WHERE name LIKE ? OR description LIKE ?
      `).get(likeQuery, likeQuery);
            return result.count;
        }
    }
    getNodeTemplatesCount(nodeTypes) {
        const resolvedTypes = (0, template_node_resolver_1.resolveTemplateNodeTypes)(nodeTypes);
        if (resolvedTypes.length === 0) {
            return 0;
        }
        const conditions = resolvedTypes.map(() => "nodes_used LIKE ?").join(" OR ");
        const query = `SELECT COUNT(*) as count FROM templates WHERE ${conditions}`;
        const params = resolvedTypes.map(n => `%"${n}"%`);
        const result = this.db.prepare(query).get(...params);
        return result.count;
    }
    getTaskTemplatesCount(task) {
        const taskNodeMap = {
            'ai_automation': ['@n8n/n8n-nodes-langchain.openAi', '@n8n/n8n-nodes-langchain.agent', 'n8n-nodes-base.openAi'],
            'data_sync': ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.postgres', 'n8n-nodes-base.mysql'],
            'webhook_processing': ['n8n-nodes-base.webhook'],
            'email_automation': ['n8n-nodes-base.gmail', 'n8n-nodes-base.emailSend', 'n8n-nodes-base.emailReadImap'],
            'slack_integration': ['n8n-nodes-base.slack', 'n8n-nodes-base.slackTrigger'],
            'data_transformation': ['n8n-nodes-base.code', 'n8n-nodes-base.set', 'n8n-nodes-base.merge'],
            'file_processing': ['n8n-nodes-base.readBinaryFile', 'n8n-nodes-base.writeBinaryFile', 'n8n-nodes-base.googleDrive'],
            'scheduling': ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.cron'],
            'api_integration': ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.graphql'],
            'database_operations': ['n8n-nodes-base.postgres', 'n8n-nodes-base.mysql', 'n8n-nodes-base.mongodb']
        };
        const nodes = taskNodeMap[task];
        if (!nodes) {
            return 0;
        }
        return this.getNodeTemplatesCount(nodes);
    }
    getExistingTemplateIds() {
        const rows = this.db.prepare('SELECT id FROM templates').all();
        return new Set(rows.map(r => r.id));
    }
    getMostRecentTemplateDate() {
        const result = this.db.prepare('SELECT MAX(created_at) as max_date FROM templates').get();
        if (!result || !result.max_date) {
            return null;
        }
        return new Date(result.max_date);
    }
    hasTemplate(templateId) {
        const result = this.db.prepare('SELECT 1 FROM templates WHERE id = ?').get(templateId);
        return result !== undefined;
    }
    getTemplateMetadata() {
        const rows = this.db.prepare('SELECT id, name, updated_at FROM templates').all();
        const metadata = new Map();
        for (const row of rows) {
            metadata.set(row.id, { name: row.name, updated_at: row.updated_at });
        }
        return metadata;
    }
    getTemplateStats() {
        const count = this.getTemplateCount();
        const avgViews = this.db.prepare('SELECT AVG(views) as avg FROM templates').get();
        const topNodes = this.db.prepare(`
      SELECT nodes_used FROM templates 
      ORDER BY views DESC 
      LIMIT 100
    `).all();
        const nodeCount = {};
        topNodes.forEach(t => {
            if (!t.nodes_used)
                return;
            try {
                const nodes = JSON.parse(t.nodes_used);
                if (Array.isArray(nodes)) {
                    nodes.forEach((n) => {
                        nodeCount[n] = (nodeCount[n] || 0) + 1;
                    });
                }
            }
            catch (error) {
                logger_1.logger.warn(`Failed to parse nodes_used for template stats:`, error);
            }
        });
        const topUsedNodes = Object.entries(nodeCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([node, count]) => ({ node, count }));
        return {
            totalTemplates: count,
            averageViews: Math.round(avgViews.avg || 0),
            topUsedNodes
        };
    }
    clearTemplates() {
        this.db.exec('DELETE FROM templates');
        logger_1.logger.info('Cleared all templates from database');
    }
    rebuildTemplateFTS() {
        if (!this.hasFTS5Support) {
            return;
        }
        try {
            this.db.exec('DELETE FROM templates_fts');
            this.db.exec(`
        INSERT INTO templates_fts(rowid, name, description)
        SELECT id, name, description FROM templates
      `);
            const count = this.getTemplateCount();
            logger_1.logger.info(`Rebuilt FTS5 index for ${count} templates`);
        }
        catch (error) {
            logger_1.logger.warn('Failed to rebuild template FTS5 index:', error);
        }
    }
    updateTemplateMetadata(templateId, metadata) {
        const stmt = this.db.prepare(`
      UPDATE templates 
      SET metadata_json = ?, metadata_generated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
        stmt.run(JSON.stringify(metadata), templateId);
        logger_1.logger.debug(`Updated metadata for template ${templateId}`);
    }
    batchUpdateMetadata(metadataMap) {
        const stmt = this.db.prepare(`
      UPDATE templates 
      SET metadata_json = ?, metadata_generated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
        for (const [templateId, metadata] of metadataMap.entries()) {
            stmt.run(JSON.stringify(metadata), templateId);
        }
        logger_1.logger.info(`Updated metadata for ${metadataMap.size} templates`);
    }
    getTemplatesWithoutMetadata(limit = 100) {
        const stmt = this.db.prepare(`
      SELECT * FROM templates 
      WHERE metadata_json IS NULL OR metadata_generated_at IS NULL
      ORDER BY views DESC
      LIMIT ?
    `);
        return stmt.all(limit);
    }
    getTemplatesWithOutdatedMetadata(daysOld = 30, limit = 100) {
        const stmt = this.db.prepare(`
      SELECT * FROM templates 
      WHERE metadata_generated_at < datetime('now', '-' || ? || ' days')
      ORDER BY views DESC
      LIMIT ?
    `);
        return stmt.all(daysOld, limit);
    }
    getMetadataStats() {
        const total = this.getTemplateCount();
        const withMetadata = this.db.prepare(`
      SELECT COUNT(*) as count FROM templates 
      WHERE metadata_json IS NOT NULL
    `).get().count;
        const withoutMetadata = total - withMetadata;
        const outdated = this.db.prepare(`
      SELECT COUNT(*) as count FROM templates 
      WHERE metadata_generated_at < datetime('now', '-30 days')
    `).get().count;
        return { total, withMetadata, withoutMetadata, outdated };
    }
    buildMetadataFilterConditions(filters) {
        const conditions = ['metadata_json IS NOT NULL'];
        const params = [];
        if (filters.category !== undefined) {
            conditions.push("json_extract(metadata_json, '$.categories') LIKE '%' || ? || '%'");
            const sanitizedCategory = JSON.stringify(filters.category).slice(1, -1);
            params.push(sanitizedCategory);
        }
        if (filters.complexity) {
            conditions.push("json_extract(metadata_json, '$.complexity') = ?");
            params.push(filters.complexity);
        }
        if (filters.maxSetupMinutes !== undefined) {
            conditions.push("CAST(json_extract(metadata_json, '$.estimated_setup_minutes') AS INTEGER) <= ?");
            params.push(filters.maxSetupMinutes);
        }
        if (filters.minSetupMinutes !== undefined) {
            conditions.push("CAST(json_extract(metadata_json, '$.estimated_setup_minutes') AS INTEGER) >= ?");
            params.push(filters.minSetupMinutes);
        }
        if (filters.requiredService !== undefined) {
            conditions.push("json_extract(metadata_json, '$.required_services') LIKE '%' || ? || '%'");
            const sanitizedService = JSON.stringify(filters.requiredService).slice(1, -1);
            params.push(sanitizedService);
        }
        if (filters.targetAudience !== undefined) {
            conditions.push("json_extract(metadata_json, '$.target_audience') LIKE '%' || ? || '%'");
            const sanitizedAudience = JSON.stringify(filters.targetAudience).slice(1, -1);
            params.push(sanitizedAudience);
        }
        return { conditions, params };
    }
    searchTemplatesByMetadata(filters, limit = 20, offset = 0) {
        const startTime = Date.now();
        const { conditions, params } = this.buildMetadataFilterConditions(filters);
        const idsQuery = `
      SELECT id FROM templates
      WHERE ${conditions.join(' AND ')}
      ORDER BY views DESC, created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `;
        params.push(limit, offset);
        const ids = this.db.prepare(idsQuery).all(...params);
        const phase1Time = Date.now() - startTime;
        if (ids.length === 0) {
            logger_1.logger.debug('Metadata search found 0 results', { filters, phase1Ms: phase1Time });
            return [];
        }
        const idValues = ids.map(r => r.id).filter(id => typeof id === 'number' && id > 0 && Number.isInteger(id));
        if (idValues.length === 0) {
            logger_1.logger.warn('No valid IDs after filtering', { filters, originalCount: ids.length });
            return [];
        }
        if (idValues.length !== ids.length) {
            logger_1.logger.warn('Some IDs were filtered out as invalid', {
                original: ids.length,
                valid: idValues.length,
                filtered: ids.length - idValues.length
            });
        }
        const phase2Start = Date.now();
        const orderedQuery = `
      WITH ordered_ids(id, sort_order) AS (
        VALUES ${idValues.map((id, idx) => `(${id}, ${idx})`).join(', ')}
      )
      SELECT t.* FROM templates t
      INNER JOIN ordered_ids o ON t.id = o.id
      ORDER BY o.sort_order
    `;
        const results = this.db.prepare(orderedQuery).all();
        const phase2Time = Date.now() - phase2Start;
        logger_1.logger.debug(`Metadata search found ${results.length} results`, {
            filters,
            count: results.length,
            phase1Ms: phase1Time,
            phase2Ms: phase2Time,
            totalMs: Date.now() - startTime,
            optimization: 'two-phase-with-ordering'
        });
        return results.map(t => this.decompressWorkflow(t));
    }
    getMetadataSearchCount(filters) {
        const { conditions, params } = this.buildMetadataFilterConditions(filters);
        const query = `SELECT COUNT(*) as count FROM templates WHERE ${conditions.join(' AND ')}`;
        const result = this.db.prepare(query).get(...params);
        return result.count;
    }
    hasMetadataCoverage() {
        const row = this.db.prepare(`
      SELECT 1 FROM templates WHERE metadata_json IS NOT NULL LIMIT 1
    `).get();
        return !!row;
    }
    getAvailableCategories() {
        const results = this.db.prepare(`
      SELECT DISTINCT json_extract(value, '$') as category
      FROM templates, json_each(json_extract(metadata_json, '$.categories'))
      WHERE metadata_json IS NOT NULL
      ORDER BY category
    `).all();
        return results.map(r => r.category);
    }
    getAvailableTargetAudiences() {
        const results = this.db.prepare(`
      SELECT DISTINCT json_extract(value, '$') as audience
      FROM templates, json_each(json_extract(metadata_json, '$.target_audience'))
      WHERE metadata_json IS NOT NULL
      ORDER BY audience
    `).all();
        return results.map(r => r.audience);
    }
    getTemplatesByCategory(category, limit = 10, offset = 0) {
        const query = `
      SELECT * FROM templates 
      WHERE metadata_json IS NOT NULL 
        AND json_extract(metadata_json, '$.categories') LIKE '%' || ? || '%'
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
        const sanitizedCategory = JSON.stringify(category).slice(1, -1);
        const results = this.db.prepare(query).all(sanitizedCategory, limit, offset);
        return results.map(t => this.decompressWorkflow(t));
    }
    getTemplatesByComplexity(complexity, limit = 10, offset = 0) {
        const query = `
      SELECT * FROM templates 
      WHERE metadata_json IS NOT NULL 
        AND json_extract(metadata_json, '$.complexity') = ?
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
        const results = this.db.prepare(query).all(complexity, limit, offset);
        return results.map(t => this.decompressWorkflow(t));
    }
    getSearchTemplatesByMetadataCount(filters) {
        let sql = `
      SELECT COUNT(*) as count FROM templates 
      WHERE metadata_json IS NOT NULL
    `;
        const params = [];
        if (filters.category) {
            sql += ` AND json_extract(metadata_json, '$.categories') LIKE ?`;
            params.push(`%"${filters.category}"%`);
        }
        if (filters.complexity) {
            sql += ` AND json_extract(metadata_json, '$.complexity') = ?`;
            params.push(filters.complexity);
        }
        if (filters.maxSetupMinutes !== undefined) {
            sql += ` AND CAST(json_extract(metadata_json, '$.estimated_setup_minutes') AS INTEGER) <= ?`;
            params.push(filters.maxSetupMinutes);
        }
        if (filters.minSetupMinutes !== undefined) {
            sql += ` AND CAST(json_extract(metadata_json, '$.estimated_setup_minutes') AS INTEGER) >= ?`;
            params.push(filters.minSetupMinutes);
        }
        if (filters.requiredService) {
            sql += ` AND json_extract(metadata_json, '$.required_services') LIKE ?`;
            params.push(`%"${filters.requiredService}"%`);
        }
        if (filters.targetAudience) {
            sql += ` AND json_extract(metadata_json, '$.target_audience') LIKE ?`;
            params.push(`%"${filters.targetAudience}"%`);
        }
        const result = this.db.prepare(sql).get(...params);
        return result?.count || 0;
    }
    getUniqueCategories() {
        const sql = `
      SELECT DISTINCT value as category
      FROM templates, json_each(metadata_json, '$.categories')
      WHERE metadata_json IS NOT NULL
      ORDER BY category
    `;
        const results = this.db.prepare(sql).all();
        return results.map(r => r.category);
    }
    getUniqueTargetAudiences() {
        const sql = `
      SELECT DISTINCT value as audience
      FROM templates, json_each(metadata_json, '$.target_audience')
      WHERE metadata_json IS NOT NULL
      ORDER BY audience
    `;
        const results = this.db.prepare(sql).all();
        return results.map(r => r.audience);
    }
}
exports.TemplateRepository = TemplateRepository;
//# sourceMappingURL=template-repository.js.map