import { DatabaseAdapter } from '../database/database-adapter';
import { TemplateWorkflow, TemplateDetail } from './template-fetcher';
import { logger } from '../utils/logger';
import { TemplateSanitizer } from '../utils/template-sanitizer';
import * as zlib from 'zlib';
import { resolveTemplateNodeTypes } from '../utils/template-node-resolver';

export interface StoredTemplate {
  id: number;
  workflow_id: number;
  name: string;
  description: string;
  author_name: string;
  author_username: string;
  author_verified: number;
  nodes_used: string; // JSON string
  workflow_json?: string; // JSON string (deprecated)
  workflow_json_compressed?: string; // Base64 encoded gzip
  categories: string; // JSON string
  views: number;
  created_at: string;
  updated_at: string;
  url: string;
  scraped_at: string;
  metadata_json?: string; // Structured metadata from OpenAI (JSON string)
  metadata_generated_at?: string; // When metadata was generated
}

export class TemplateRepository {
  private sanitizer: TemplateSanitizer;
  private hasFTS5Support: boolean = false;
  
  constructor(private db: DatabaseAdapter) {
    this.sanitizer = new TemplateSanitizer();
    this.initializeFTS5();
  }
  
  /**
   * Initialize FTS5 tables if supported
   */
  private initializeFTS5(): void {
    this.hasFTS5Support = this.db.checkFTS5Support();
    
    if (this.hasFTS5Support) {
      try {
        // Check if FTS5 table already exists
        const ftsExists = this.db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='templates_fts'
        `).get() as { name: string } | undefined;
        
        if (ftsExists) {
          logger.info('FTS5 table already exists for templates');
          
          // Verify FTS5 is working by doing a test query
          try {
            const testCount = this.db.prepare('SELECT COUNT(*) as count FROM templates_fts').get() as { count: number };
            logger.info(`FTS5 enabled with ${testCount.count} indexed entries`);
          } catch (testError) {
            logger.warn('FTS5 table exists but query failed:', testError);
            this.hasFTS5Support = false;
            return;
          }
        } else {
          // Create FTS5 virtual table
          logger.info('Creating FTS5 virtual table for templates...');
          this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS templates_fts USING fts5(
              name, description, content=templates
            );
          `);
          
          // Create triggers to keep FTS5 in sync
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
          
          logger.info('FTS5 support enabled for template search');
        }
      } catch (error: any) {
        logger.warn('Failed to initialize FTS5 for templates:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        this.hasFTS5Support = false;
      }
    } else {
      logger.info('FTS5 not available, using LIKE search for templates');
    }
  }
  
  /**
   * Save a template to the database
   */
  saveTemplate(workflow: TemplateWorkflow, detail: TemplateDetail, categories: string[] = []): void {
    // Filter out templates with 10 or fewer views
    if ((workflow.totalViews || 0) <= 10) {
      logger.debug(`Skipping template ${workflow.id}: ${workflow.name} (only ${workflow.totalViews} views)`);
      return;
    }
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO templates (
        id, workflow_id, name, description, author_name, author_username,
        author_verified, nodes_used, workflow_json_compressed, categories, views,
        created_at, updated_at, url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Extract node types from workflow detail
    const nodeTypes = detail.workflow.nodes.map(n => n.type);
    
    // Build URL
    const url = `https://n8n.io/workflows/${workflow.id}`;
    
    // Sanitize the workflow to remove API tokens
    const { sanitized: sanitizedWorkflow, wasModified } = this.sanitizer.sanitizeWorkflow(detail.workflow);
    
    // Log if we sanitized any tokens
    if (wasModified) {
      const detectedTokens = this.sanitizer.detectTokens(detail.workflow);
      logger.warn(`Sanitized API tokens in template ${workflow.id}: ${workflow.name}`, {
        templateId: workflow.id,
        templateName: workflow.name,
        tokensFound: detectedTokens.length,
        tokenPreviews: detectedTokens.map(t => t.substring(0, 20) + '...')
      });
    }
    
    // Compress the workflow JSON
    const workflowJsonStr = JSON.stringify(sanitizedWorkflow);
    const compressed = zlib.gzipSync(workflowJsonStr);
    const compressedBase64 = compressed.toString('base64');
    
    // Log compression ratio
    const originalSize = Buffer.byteLength(workflowJsonStr);
    const compressedSize = compressed.length;
    const ratio = Math.round((1 - compressedSize / originalSize) * 100);
    logger.debug(`Template ${workflow.id} compression: ${originalSize} → ${compressedSize} bytes (${ratio}% reduction)`);
    
    stmt.run(
      workflow.id,
      workflow.id,
      workflow.name,
      workflow.description || '',
      workflow.user.name,
      workflow.user.username,
      workflow.user.verified ? 1 : 0,
      JSON.stringify(nodeTypes),
      compressedBase64,
      JSON.stringify(categories),
      workflow.totalViews || 0,
      workflow.createdAt,
      workflow.createdAt, // Using createdAt as updatedAt since API doesn't provide updatedAt
      url
    );
  }
  
  /**
   * Get templates that use specific node types
   */
  getTemplatesByNodes(nodeTypes: string[], limit: number = 10, offset: number = 0): StoredTemplate[] {
    // Resolve input node types to all possible template formats
    const resolvedTypes = resolveTemplateNodeTypes(nodeTypes);
    
    if (resolvedTypes.length === 0) {
      logger.debug('No resolved types for template search', { input: nodeTypes });
      return [];
    }
    
    // Build query for multiple node types
    const conditions = resolvedTypes.map(() => "nodes_used LIKE ?").join(" OR ");
    const query = `
      SELECT * FROM templates 
      WHERE ${conditions}
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const params = [...resolvedTypes.map(n => `%"${n}"%`), limit, offset];
    const results = this.db.prepare(query).all(...params) as StoredTemplate[];
    
    logger.debug(`Template search found ${results.length} results`, {
      input: nodeTypes,
      resolved: resolvedTypes,
      found: results.length
    });
    
    return results.map(t => this.decompressWorkflow(t));
  }
  
  /**
   * Get a specific template by ID
   */
  getTemplate(templateId: number): StoredTemplate | null {
    const row = this.db.prepare(`
      SELECT * FROM templates WHERE id = ?
    `).get(templateId) as StoredTemplate | undefined;
    
    if (!row) return null;
    
    // Decompress workflow JSON if compressed
    if (row.workflow_json_compressed && !row.workflow_json) {
      try {
        const compressed = Buffer.from(row.workflow_json_compressed, 'base64');
        const decompressed = zlib.gunzipSync(compressed);
        row.workflow_json = decompressed.toString();
      } catch (error) {
        logger.error(`Failed to decompress workflow for template ${templateId}:`, error);
        return null;
      }
    }
    
    return row;
  }
  
  /**
   * Decompress workflow JSON for a template
   */
  private decompressWorkflow(template: StoredTemplate): StoredTemplate {
    if (template.workflow_json_compressed && !template.workflow_json) {
      try {
        const compressed = Buffer.from(template.workflow_json_compressed, 'base64');
        const decompressed = zlib.gunzipSync(compressed);
        template.workflow_json = decompressed.toString();
      } catch (error) {
        logger.error(`Failed to decompress workflow for template ${template.id}:`, error);
      }
    }
    return template;
  }
  
  /**
   * Search templates by name or description
   */
  searchTemplates(query: string, limit: number = 20, offset: number = 0): StoredTemplate[] {
    logger.debug(`Searching templates for: "${query}" (FTS5: ${this.hasFTS5Support})`);
    
    // If FTS5 is not supported, go straight to LIKE search
    if (!this.hasFTS5Support) {
      logger.debug('Using LIKE search (FTS5 not available)');
      return this.searchTemplatesLIKE(query, limit, offset);
    }
    
    try {
      // Use FTS for search - escape quotes in terms
      const ftsQuery = query.split(' ').map(term => {
        // Escape double quotes by replacing with two double quotes
        const escaped = term.replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(' OR ');
      logger.debug(`FTS5 query: ${ftsQuery}`);
      
      const results = this.db.prepare(`
        SELECT t.* FROM templates t
        JOIN templates_fts ON t.id = templates_fts.rowid
        WHERE templates_fts MATCH ?
        ORDER BY rank, t.views DESC
        LIMIT ? OFFSET ?
      `).all(ftsQuery, limit, offset) as StoredTemplate[];
      
      logger.debug(`FTS5 search returned ${results.length} results`);
      return results.map(t => this.decompressWorkflow(t));
    } catch (error: any) {
      // If FTS5 query fails, fallback to LIKE search
      logger.warn('FTS5 template search failed, using LIKE fallback:', {
        message: error.message,
        query: query,
        ftsQuery: query.split(' ').map(term => `"${term}"`).join(' OR ')
      });
      return this.searchTemplatesLIKE(query, limit, offset);
    }
  }
  
  /**
   * Fallback search using LIKE when FTS5 is not available
   */
  private searchTemplatesLIKE(query: string, limit: number = 20, offset: number = 0): StoredTemplate[] {
    const likeQuery = `%${query}%`;
    logger.debug(`Using LIKE search with pattern: ${likeQuery}`);
    
    const results = this.db.prepare(`
      SELECT * FROM templates 
      WHERE name LIKE ? OR description LIKE ?
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(likeQuery, likeQuery, limit, offset) as StoredTemplate[];
    
    logger.debug(`LIKE search returned ${results.length} results`);
    return results.map(t => this.decompressWorkflow(t));
  }
  
  /**
   * Get templates for a specific task/use case
   */
  getTemplatesForTask(task: string, limit: number = 10, offset: number = 0): StoredTemplate[] {
    // Map tasks to relevant node combinations
    const taskNodeMap: Record<string, string[]> = {
      'ai_automation': ['@n8n/n8n-nodes-langchain.openAi', '@n8n/n8n-nodes-langchain.agent', 'n8n-nodes-base.openAi'],
      'data_sync': ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.postgres', 'n8n-nodes-base.mysql'],
      // webhook_processing must match only workflows *triggered* by a webhook.
      // Including httpRequest here was returning scheduleTrigger/formTrigger
      // workflows that merely use outbound HTTP — not webhook-triggered (QA #2).
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
  
  /**
   * Get all templates with limit
   */
  getAllTemplates(limit: number = 10, offset: number = 0, sortBy: 'views' | 'created_at' | 'name' = 'views'): StoredTemplate[] {
    const orderClause = sortBy === 'name' ? 'name ASC' : 
                        sortBy === 'created_at' ? 'created_at DESC' : 
                        'views DESC, created_at DESC';
    const results = this.db.prepare(`
      SELECT * FROM templates 
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `).all(limit, offset) as StoredTemplate[];
    return results.map(t => this.decompressWorkflow(t));
  }
  
  /**
   * Get total template count
   */
  getTemplateCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM templates').get() as { count: number };
    return result.count;
  }
  
  /**
   * Get count for search results
   */
  getSearchCount(query: string): number {
    if (!this.hasFTS5Support) {
      const likeQuery = `%${query}%`;
      const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM templates 
        WHERE name LIKE ? OR description LIKE ?
      `).get(likeQuery, likeQuery) as { count: number };
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
      `).get(ftsQuery) as { count: number };
      return result.count;
    } catch {
      const likeQuery = `%${query}%`;
      const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM templates 
        WHERE name LIKE ? OR description LIKE ?
      `).get(likeQuery, likeQuery) as { count: number };
      return result.count;
    }
  }
  
  /**
   * Get count for node templates
   */
  getNodeTemplatesCount(nodeTypes: string[]): number {
    // Resolve input node types to all possible template formats
    const resolvedTypes = resolveTemplateNodeTypes(nodeTypes);
    
    if (resolvedTypes.length === 0) {
      return 0;
    }
    
    const conditions = resolvedTypes.map(() => "nodes_used LIKE ?").join(" OR ");
    const query = `SELECT COUNT(*) as count FROM templates WHERE ${conditions}`;
    const params = resolvedTypes.map(n => `%"${n}"%`);
    const result = this.db.prepare(query).get(...params) as { count: number };
    return result.count;
  }
  
  /**
   * Get count for task templates
   */
  getTaskTemplatesCount(task: string): number {
    const taskNodeMap: Record<string, string[]> = {
      'ai_automation': ['@n8n/n8n-nodes-langchain.openAi', '@n8n/n8n-nodes-langchain.agent', 'n8n-nodes-base.openAi'],
      'data_sync': ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.postgres', 'n8n-nodes-base.mysql'],
      // webhook_processing must match only workflows *triggered* by a webhook.
      // Including httpRequest here was returning scheduleTrigger/formTrigger
      // workflows that merely use outbound HTTP — not webhook-triggered (QA #2).
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
  
  /**
   * Get all existing template IDs for comparison
   * Used in update mode to skip already fetched templates
   */
  getExistingTemplateIds(): Set<number> {
    const rows = this.db.prepare('SELECT id FROM templates').all() as { id: number }[];
    return new Set(rows.map(r => r.id));
  }

  /**
   * Get the most recent template creation date
   * Used in update mode to fetch only newer templates
   */
  getMostRecentTemplateDate(): Date | null {
    const result = this.db.prepare('SELECT MAX(created_at) as max_date FROM templates').get() as { max_date: string | null } | undefined;
    if (!result || !result.max_date) {
      return null;
    }
    return new Date(result.max_date);
  }

  /**
   * Check if a template exists in the database
   */
  hasTemplate(templateId: number): boolean {
    const result = this.db.prepare('SELECT 1 FROM templates WHERE id = ?').get(templateId) as { 1: number } | undefined;
    return result !== undefined;
  }
  
  /**
   * Get template metadata (id, name, updated_at) for all templates
   * Used for comparison in update scenarios
   */
  getTemplateMetadata(): Map<number, { name: string; updated_at: string }> {
    const rows = this.db.prepare('SELECT id, name, updated_at FROM templates').all() as {
      id: number;
      name: string;
      updated_at: string;
    }[];
    
    const metadata = new Map<number, { name: string; updated_at: string }>();
    for (const row of rows) {
      metadata.set(row.id, { name: row.name, updated_at: row.updated_at });
    }
    return metadata;
  }
  
  /**
   * Get template statistics
   */
  getTemplateStats(): Record<string, any> {
    const count = this.getTemplateCount();
    const avgViews = this.db.prepare('SELECT AVG(views) as avg FROM templates').get() as { avg: number };
    const topNodes = this.db.prepare(`
      SELECT nodes_used FROM templates 
      ORDER BY views DESC 
      LIMIT 100
    `).all() as { nodes_used: string }[];
    
    // Count node usage
    const nodeCount: Record<string, number> = {};
    topNodes.forEach(t => {
      if (!t.nodes_used) return;
      try {
        const nodes = JSON.parse(t.nodes_used);
        if (Array.isArray(nodes)) {
          nodes.forEach((n: string) => {
            nodeCount[n] = (nodeCount[n] || 0) + 1;
          });
        }
      } catch (error) {
        logger.warn(`Failed to parse nodes_used for template stats:`, error);
      }
    });
    
    // Get top 10 most used nodes
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
  
  /**
   * Clear all templates (for testing or refresh)
   */
  clearTemplates(): void {
    this.db.exec('DELETE FROM templates');
    logger.info('Cleared all templates from database');
  }
  
  /**
   * Rebuild the FTS5 index for all templates
   * This is needed when templates are bulk imported or when FTS5 gets out of sync
   */
  rebuildTemplateFTS(): void {
    // Skip if FTS5 is not supported
    if (!this.hasFTS5Support) {
      return;
    }
    
    try {
      // Clear existing FTS data
      this.db.exec('DELETE FROM templates_fts');
      
      // Repopulate from templates table
      this.db.exec(`
        INSERT INTO templates_fts(rowid, name, description)
        SELECT id, name, description FROM templates
      `);
      
      const count = this.getTemplateCount();
      logger.info(`Rebuilt FTS5 index for ${count} templates`);
    } catch (error) {
      logger.warn('Failed to rebuild template FTS5 index:', error);
      // Non-critical error - search will fallback to LIKE
    }
  }
  
  /**
   * Update metadata for a template
   */
  updateTemplateMetadata(templateId: number, metadata: any): void {
    const stmt = this.db.prepare(`
      UPDATE templates 
      SET metadata_json = ?, metadata_generated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(JSON.stringify(metadata), templateId);
    logger.debug(`Updated metadata for template ${templateId}`);
  }
  
  /**
   * Batch update metadata for multiple templates
   */
  batchUpdateMetadata(metadataMap: Map<number, any>): void {
    const stmt = this.db.prepare(`
      UPDATE templates 
      SET metadata_json = ?, metadata_generated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    // Simple approach - just run the updates
    // Most operations are fast enough without explicit transactions
    for (const [templateId, metadata] of metadataMap.entries()) {
      stmt.run(JSON.stringify(metadata), templateId);
    }
    
    logger.info(`Updated metadata for ${metadataMap.size} templates`);
  }
  
  /**
   * Get templates without metadata
   */
  getTemplatesWithoutMetadata(limit: number = 100): StoredTemplate[] {
    const stmt = this.db.prepare(`
      SELECT * FROM templates 
      WHERE metadata_json IS NULL OR metadata_generated_at IS NULL
      ORDER BY views DESC
      LIMIT ?
    `);
    
    return stmt.all(limit) as StoredTemplate[];
  }
  
  /**
   * Get templates with outdated metadata (older than days specified)
   */
  getTemplatesWithOutdatedMetadata(daysOld: number = 30, limit: number = 100): StoredTemplate[] {
    const stmt = this.db.prepare(`
      SELECT * FROM templates 
      WHERE metadata_generated_at < datetime('now', '-' || ? || ' days')
      ORDER BY views DESC
      LIMIT ?
    `);
    
    return stmt.all(daysOld, limit) as StoredTemplate[];
  }
  
  /**
   * Get template metadata stats
   */
  getMetadataStats(): { 
    total: number; 
    withMetadata: number; 
    withoutMetadata: number;
    outdated: number;
  } {
    const total = this.getTemplateCount();
    
    const withMetadata = (this.db.prepare(`
      SELECT COUNT(*) as count FROM templates 
      WHERE metadata_json IS NOT NULL
    `).get() as { count: number }).count;
    
    const withoutMetadata = total - withMetadata;
    
    const outdated = (this.db.prepare(`
      SELECT COUNT(*) as count FROM templates 
      WHERE metadata_generated_at < datetime('now', '-30 days')
    `).get() as { count: number }).count;
    
    return { total, withMetadata, withoutMetadata, outdated };
  }

  /**
   * Build WHERE conditions for metadata filtering
   * @private
   * @returns Object containing SQL conditions array and parameter values array
   */
  private buildMetadataFilterConditions(filters: {
    category?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    maxSetupMinutes?: number;
    minSetupMinutes?: number;
    requiredService?: string;
    targetAudience?: string;
  }): { conditions: string[], params: any[] } {
    const conditions: string[] = ['metadata_json IS NOT NULL'];
    const params: any[] = [];

    if (filters.category !== undefined) {
      // Use parameterized LIKE with JSON array search - safe from injection
      conditions.push("json_extract(metadata_json, '$.categories') LIKE '%' || ? || '%'");
      // Escape special characters and quotes for JSON string matching
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
      // Use parameterized LIKE with JSON array search - safe from injection
      conditions.push("json_extract(metadata_json, '$.required_services') LIKE '%' || ? || '%'");
      // Escape special characters and quotes for JSON string matching
      const sanitizedService = JSON.stringify(filters.requiredService).slice(1, -1);
      params.push(sanitizedService);
    }

    if (filters.targetAudience !== undefined) {
      // Use parameterized LIKE with JSON array search - safe from injection
      conditions.push("json_extract(metadata_json, '$.target_audience') LIKE '%' || ? || '%'");
      // Escape special characters and quotes for JSON string matching
      const sanitizedAudience = JSON.stringify(filters.targetAudience).slice(1, -1);
      params.push(sanitizedAudience);
    }

    return { conditions, params };
  }

  /**
   * Search templates by metadata fields
   */
  searchTemplatesByMetadata(filters: {
    category?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    maxSetupMinutes?: number;
    minSetupMinutes?: number;
    requiredService?: string;
    targetAudience?: string;
  }, limit: number = 20, offset: number = 0): StoredTemplate[] {
    const startTime = Date.now();

    // Build WHERE conditions using shared helper
    const { conditions, params } = this.buildMetadataFilterConditions(filters);

    // Performance optimization: Use two-phase query to avoid loading large compressed workflows
    // during metadata filtering. This prevents timeout when no filters are provided.
    // Phase 1: Get IDs only with metadata filtering (fast - no workflow data)
    // Add id to ORDER BY to ensure stable ordering
    const idsQuery = `
      SELECT id FROM templates
      WHERE ${conditions.join(' AND ')}
      ORDER BY views DESC, created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const ids = this.db.prepare(idsQuery).all(...params) as { id: number }[];

    const phase1Time = Date.now() - startTime;

    if (ids.length === 0) {
      logger.debug('Metadata search found 0 results', { filters, phase1Ms: phase1Time });
      return [];
    }

    // Defensive validation: ensure all IDs are valid positive integers
    const idValues = ids.map(r => r.id).filter(id => typeof id === 'number' && id > 0 && Number.isInteger(id));

    if (idValues.length === 0) {
      logger.warn('No valid IDs after filtering', { filters, originalCount: ids.length });
      return [];
    }

    if (idValues.length !== ids.length) {
      logger.warn('Some IDs were filtered out as invalid', {
        original: ids.length,
        valid: idValues.length,
        filtered: ids.length - idValues.length
      });
    }

    // Phase 2: Fetch full records preserving exact order from Phase 1
    // Use CTE with VALUES to maintain ordering without depending on SQLite's IN clause behavior
    const phase2Start = Date.now();
    const orderedQuery = `
      WITH ordered_ids(id, sort_order) AS (
        VALUES ${idValues.map((id, idx) => `(${id}, ${idx})`).join(', ')}
      )
      SELECT t.* FROM templates t
      INNER JOIN ordered_ids o ON t.id = o.id
      ORDER BY o.sort_order
    `;

    const results = this.db.prepare(orderedQuery).all() as StoredTemplate[];
    const phase2Time = Date.now() - phase2Start;

    logger.debug(`Metadata search found ${results.length} results`, {
      filters,
      count: results.length,
      phase1Ms: phase1Time,
      phase2Ms: phase2Time,
      totalMs: Date.now() - startTime,
      optimization: 'two-phase-with-ordering'
    });

    return results.map(t => this.decompressWorkflow(t));
  }
  
  /**
   * Get count for metadata search results
   */
  getMetadataSearchCount(filters: {
    category?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    maxSetupMinutes?: number;
    minSetupMinutes?: number;
    requiredService?: string;
    targetAudience?: string;
  }): number {
    // Build WHERE conditions using shared helper
    const { conditions, params } = this.buildMetadataFilterConditions(filters);

    const query = `SELECT COUNT(*) as count FROM templates WHERE ${conditions.join(' AND ')}`;
    const result = this.db.prepare(query).get(...params) as { count: number };

    return result.count;
  }
  
  /**
   * Whether any templates have metadata_json populated.
   * Lets callers distinguish "metadata not yet enriched" from "no matches".
   */
  hasMetadataCoverage(): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM templates WHERE metadata_json IS NOT NULL LIMIT 1
    `).get() as { 1?: number } | undefined;
    return !!row;
  }

  /**
   * Get unique categories from metadata
   */
  getAvailableCategories(): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT json_extract(value, '$') as category
      FROM templates, json_each(json_extract(metadata_json, '$.categories'))
      WHERE metadata_json IS NOT NULL
      ORDER BY category
    `).all() as { category: string }[];
    
    return results.map(r => r.category);
  }
  
  /**
   * Get unique target audiences from metadata
   */
  getAvailableTargetAudiences(): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT json_extract(value, '$') as audience
      FROM templates, json_each(json_extract(metadata_json, '$.target_audience'))
      WHERE metadata_json IS NOT NULL
      ORDER BY audience
    `).all() as { audience: string }[];
    
    return results.map(r => r.audience);
  }
  
  /**
   * Get templates by category with metadata
   */
  getTemplatesByCategory(category: string, limit: number = 10, offset: number = 0): StoredTemplate[] {
    const query = `
      SELECT * FROM templates 
      WHERE metadata_json IS NOT NULL 
        AND json_extract(metadata_json, '$.categories') LIKE '%' || ? || '%'
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    // Use same sanitization as searchTemplatesByMetadata for consistency
    const sanitizedCategory = JSON.stringify(category).slice(1, -1);
    const results = this.db.prepare(query).all(sanitizedCategory, limit, offset) as StoredTemplate[];
    return results.map(t => this.decompressWorkflow(t));
  }
  
  /**
   * Get templates by complexity level
   */
  getTemplatesByComplexity(complexity: 'simple' | 'medium' | 'complex', limit: number = 10, offset: number = 0): StoredTemplate[] {
    const query = `
      SELECT * FROM templates 
      WHERE metadata_json IS NOT NULL 
        AND json_extract(metadata_json, '$.complexity') = ?
      ORDER BY views DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const results = this.db.prepare(query).all(complexity, limit, offset) as StoredTemplate[];
    return results.map(t => this.decompressWorkflow(t));
  }

  /**
   * Get count of templates matching metadata search
   */
  getSearchTemplatesByMetadataCount(filters: {
    category?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    maxSetupMinutes?: number;
    minSetupMinutes?: number;
    requiredService?: string;
    targetAudience?: string;
  }): number {
    let sql = `
      SELECT COUNT(*) as count FROM templates 
      WHERE metadata_json IS NOT NULL
    `;
    const params: any[] = [];

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

    const result = this.db.prepare(sql).get(...params) as { count: number };
    return result?.count || 0;
  }

  /**
   * Get unique categories from metadata
   */
  getUniqueCategories(): string[] {
    const sql = `
      SELECT DISTINCT value as category
      FROM templates, json_each(metadata_json, '$.categories')
      WHERE metadata_json IS NOT NULL
      ORDER BY category
    `;
    
    const results = this.db.prepare(sql).all() as { category: string }[];
    return results.map(r => r.category);
  }

  /**
   * Get unique target audiences from metadata
   */
  getUniqueTargetAudiences(): string[] {
    const sql = `
      SELECT DISTINCT value as audience
      FROM templates, json_each(metadata_json, '$.target_audience')
      WHERE metadata_json IS NOT NULL
      ORDER BY audience
    `;
    
    const results = this.db.prepare(sql).all() as { audience: string }[];
    return results.map(r => r.audience);
  }
}