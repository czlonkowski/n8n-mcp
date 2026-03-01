import { createHash } from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../utils/logger';
import { NodeSourceExtractor } from '../utils/node-source-extractor';
import { 
  EnhancedDocumentationFetcher,
  EnhancedNodeDocumentation,
  OperationInfo,
  ApiMethodMapping,
  CodeExample,
  TemplateInfo,
  RelatedResource
} from '../utils/enhanced-documentation-fetcher';
import { ExampleGenerator } from '../utils/example-generator';
import { DatabaseAdapter, createDatabaseAdapter } from '../database/database-adapter';

interface NodeInfo {
  nodeType: string;
  name: string;
  displayName: string;
  description: string;
  category?: string;
  subcategory?: string;
  icon?: string;
  sourceCode: string;
  credentialCode?: string;
  documentationMarkdown?: string;
  documentationUrl?: string;
  documentationTitle?: string;
  operations?: OperationInfo[];
  apiMethods?: ApiMethodMapping[];
  documentationExamples?: CodeExample[];
  templates?: TemplateInfo[];
  relatedResources?: RelatedResource[];
  requiredScopes?: string[];
  exampleWorkflow?: any;
  exampleParameters?: any;
  propertiesSchema?: any;
  packageName: string;
  version?: string;
  codexData?: any;
  aliases?: string[];
  hasCredentials: boolean;
  isTrigger: boolean;
  isWebhook: boolean;
}

interface SearchOptions {
  query?: string;
  nodeType?: string;
  packageName?: string;
  category?: string;
  hasCredentials?: boolean;
  isTrigger?: boolean;
  limit?: number;
}

export class NodeDocumentationService {
  private db: DatabaseAdapter | null = null;
  private extractor: NodeSourceExtractor;
  private docsFetcher: EnhancedDocumentationFetcher;
  private dbPath: string;
  private initialized: Promise<void>;
  
  constructor(dbPath?: string) {
    // Determine database path with multiple fallbacks for npx support
    this.dbPath = dbPath || process.env.NODE_DB_PATH || this.findDatabasePath();
    
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!require('fs').existsSync(dbDir)) {
      require('fs').mkdirSync(dbDir, { recursive: true });
    }
    
    this.extractor = new NodeSourceExtractor();
    this.docsFetcher = new EnhancedDocumentationFetcher();
    
    // Initialize database asynchronously
    this.initialized = this.initializeAsync();
  }
  
  private findDatabasePath(): string {
    const fs = require('fs');
    
    // Priority order for database locations:
    // 1. Local working directory (current behavior)
    const localPath = path.join(process.cwd(), 'data', 'nodes.db');
    if (fs.existsSync(localPath)) {
      return localPath;
    }
    
    // 2. Package installation directory (for npx)
    const packagePath = path.join(__dirname, '..', '..', 'data', 'nodes.db');
    if (fs.existsSync(packagePath)) {
      return packagePath;
    }
    
    // 3. Global npm modules directory (for global install)
    const globalPath = path.join(__dirname, '..', '..', '..', 'data', 'nodes.db');
    if (fs.existsSync(globalPath)) {
      return globalPath;
    }
    
    // 4. Default to local path (will be created if needed)
    return localPath;
  }
  
  private async initializeAsync(): Promise<void> {
    try {
      this.db = await createDatabaseAdapter(this.dbPath);
      
      // Initialize database with new schema
      this.initializeDatabase();
      
      logger.info('Node Documentation Service initialized');
    } catch (error) {
      logger.error('Failed to initialize database adapter', error);
      throw error;
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    await this.initialized;
    if (!this.db) {
      throw new Error('Database not initialized');
    }
  }

  private initializeDatabase(): void {
    if (!this.db) throw new Error('Database not initialized');
    // Execute the schema directly
    const schema = `
-- Main nodes table with documentation and examples
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_type TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  category TEXT,
  subcategory TEXT,
  icon TEXT,
  
  -- Source code
  source_code TEXT NOT NULL,
  credential_code TEXT,
  code_hash TEXT NOT NULL,
  code_length INTEGER NOT NULL,
  
  -- Documentation
  documentation_markdown TEXT,
  documentation_url TEXT,
  documentation_title TEXT,
  
  -- Enhanced documentation fields (stored as JSON)
  operations TEXT,
  api_methods TEXT,
  documentation_examples TEXT,
  templates TEXT,
  related_resources TEXT,
  required_scopes TEXT,
  
  -- Example usage
  example_workflow TEXT,
  example_parameters TEXT,
  properties_schema TEXT,
  
  -- Metadata
  package_name TEXT NOT NULL,
  version TEXT,
  codex_data TEXT,
  aliases TEXT,
  
  -- Flags
  has_credentials INTEGER DEFAULT 0,
  is_trigger INTEGER DEFAULT 0,
  is_webhook INTEGER DEFAULT 0,
  
  -- Timestamps
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nodes_package_name ON nodes(package_name);
CREATE INDEX IF NOT EXISTS idx_nodes_category ON nodes(category);
CREATE INDEX IF NOT EXISTS idx_nodes_code_hash ON nodes(code_hash);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_is_trigger ON nodes(is_trigger);

-- Full Text Search
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  node_type,
  name,
  display_name,
  description,
  category,
  documentation_markdown,
  aliases,
  content=nodes,
  content_rowid=id
);

-- Triggers for FTS
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes
BEGIN
  INSERT INTO nodes_fts(rowid, node_type, name, display_name, description, category, documentation_markdown, aliases)
  VALUES (new.id, new.node_type, new.name, new.display_name, new.description, new.category, new.documentation_markdown, new.aliases);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes
BEGIN
  DELETE FROM nodes_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes
BEGIN
  DELETE FROM nodes_fts WHERE rowid = old.id;
  INSERT INTO nodes_fts(rowid, node_type, name, display_name, description, category, documentation_markdown, aliases)
  VALUES (new.id, new.node_type, new.name, new.display_name, new.description, new.category, new.documentation_markdown, new.aliases);
END;

-- Documentation sources table
CREATE TABLE IF NOT EXISTS documentation_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  commit_hash TEXT,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Statistics table
CREATE TABLE IF NOT EXISTS extraction_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_nodes INTEGER NOT NULL,
  nodes_with_docs INTEGER NOT NULL,
  nodes_with_examples INTEGER NOT NULL,
  total_code_size INTEGER NOT NULL,
  total_docs_size INTEGER NOT NULL,
  extraction_date DATETIME DEFAULT CURRENT_TIMESTAMP
);
    `;
    
    this.db!.exec(schema);
  }

  /**
   * Store complete node information including docs and examples
   */
  async storeNode(nodeInfo: NodeInfo): Promise<void> {
    await this.ensureInitialized();
    const hash = this.generateHash(nodeInfo.sourceCode);
    
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO nodes (
        node_type, name, display_name, description, category, subcategory, icon,
        source_code, credential_code, code_hash, code_length,
        documentation_markdown, documentation_url, documentation_title,
        operations, api_methods, documentation_examples, templates, related_resources, required_scopes,
        example_workflow, example_parameters, properties_schema,
        package_name, version, codex_data, aliases,
        has_credentials, is_trigger, is_webhook
      ) VALUES (
        @nodeType, @name, @displayName, @description, @category, @subcategory, @icon,
        @sourceCode, @credentialCode, @hash, @codeLength,
        @documentation, @documentationUrl, @documentationTitle,
        @operations, @apiMethods, @documentationExamples, @templates, @relatedResources, @requiredScopes,
        @exampleWorkflow, @exampleParameters, @propertiesSchema,
        @packageName, @version, @codexData, @aliases,
        @hasCredentials, @isTrigger, @isWebhook
      )
    `);

    stmt.run({
      nodeType: nodeInfo.nodeType,
      name: nodeInfo.name,
      displayName: nodeInfo.displayName || nodeInfo.name,
      description: nodeInfo.description || '',
      category: nodeInfo.category || 'Other',
      subcategory: nodeInfo.subcategory || null,
      icon: nodeInfo.icon || null,
      sourceCode: nodeInfo.sourceCode,
      credentialCode: nodeInfo.credentialCode || null,
      hash,
      codeLength: nodeInfo.sourceCode.length,
      documentation: nodeInfo.documentationMarkdown || null,
      documentationUrl: nodeInfo.documentationUrl || null,
      documentationTitle: nodeInfo.documentationTitle || null,
      operations: nodeInfo.operations ? JSON.stringify(nodeInfo.operations) : null,
      apiMethods: nodeInfo.apiMethods ? JSON.stringify(nodeInfo.apiMethods) : null,
      documentationExamples: nodeInfo.documentationExamples ? JSON.stringify(nodeInfo.documentationExamples) : null,
      templates: nodeInfo.templates ? JSON.stringify(nodeInfo.templates) : null,
      relatedResources: nodeInfo.relatedResources ? JSON.stringify(nodeInfo.relatedResources) : null,
      requiredScopes: nodeInfo.requiredScopes ? JSON.stringify(nodeInfo.requiredScopes) : null,
      exampleWorkflow: nodeInfo.exampleWorkflow ? JSON.stringify(nodeInfo.exampleWorkflow) : null,
      exampleParameters: nodeInfo.exampleParameters ? JSON.stringify(nodeInfo.exampleParameters) : null,
      propertiesSchema: nodeInfo.propertiesSchema ? JSON.stringify(nodeInfo.propertiesSchema) : null,
      packageName: nodeInfo.packageName,
      version: nodeInfo.version || null,
      codexData: nodeInfo.codexData ? JSON.stringify(nodeInfo.codexData) : null,
      aliases: nodeInfo.aliases ? JSON.stringify(nodeInfo.aliases) : null,
      hasCredentials: nodeInfo.hasCredentials ? 1 : 0,
      isTrigger: nodeInfo.isTrigger ? 1 : 0,
      isWebhook: nodeInfo.isWebhook ? 1 : 0
    });
  }

  /**
   * Get complete node information
   */
  async getNodeInfo(nodeType: string): Promise<NodeInfo | null> {
    await this.ensureInitialized();
    const stmt = this.db!.prepare(`
      SELECT * FROM nodes WHERE node_type = ? OR name = ? COLLATE NOCASE
    `);
    
    const row = stmt.get(nodeType, nodeType);
    if (!row) return null;
    
    return this.rowToNodeInfo(row);
  }

  /**
   * Search nodes with various filters
   */
  async searchNodes(options: SearchOptions): Promise<NodeInfo[]> {
    await this.ensureInitialized();
    let query = 'SELECT * FROM nodes WHERE 1=1';
    const params: any = {};
    
    if (options.query) {
      query += ` AND id IN (
        SELECT rowid FROM nodes_fts 
        WHERE nodes_fts MATCH @query
      )`;
      params.query = options.query;
    }
    
    if (options.nodeType) {
      query += ' AND node_type LIKE @nodeType';
      params.nodeType = `%${options.nodeType}%`;
    }
    
    if (options.packageName) {
      query += ' AND package_name = @packageName';
      params.packageName = options.packageName;
    }
    
    if (options.category) {
      query += ' AND category = @category';
      params.category = options.category;
    }
    
    if (options.hasCredentials !== undefined) {
      query += ' AND has_credentials = @hasCredentials';
      params.hasCredentials = options.hasCredentials ? 1 : 0;
    }
    
    if (options.isTrigger !== undefined) {
      query += ' AND is_trigger = @isTrigger';
      params.isTrigger = options.isTrigger ? 1 : 0;
    }
    
    query += ' ORDER BY name LIMIT @limit';
    params.limit = options.limit || 20;
    
    const stmt = this.db!.prepare(query);
    const rows = stmt.all(params);
    
    return rows.map(row => this.rowToNodeInfo(row));
  }

  /**
   * List all nodes
   */
  async listNodes(): Promise<NodeInfo[]> {
    await this.ensureInitialized();
    const stmt = this.db!.prepare('SELECT * FROM nodes ORDER BY name');
    const rows = stmt.all();
    return rows.map(row => this.rowToNodeInfo(row));
  }

  /**
   * Extract and store all nodes with documentation
   */
  async rebuildDatabase(): Promise<{
    total: number;
    successful: number;
    failed: number;
    errors: string[];
  }> {
    await this.ensureInitialized();
    logger.info('Starting complete database rebuild...');
    
    // Clear existing data
    this.db!.exec('DELETE FROM nodes');
    this.db!.exec('DELETE FROM extraction_stats');
    
    // Ensure documentation repository is available
    await this.docsFetcher.ensureDocsRepository();
    
    const stats = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };
    
    try {
      // Get all available nodes
      const availableNodes = await this.extractor.listAvailableNodes();
      stats.total = availableNodes.length;
      
      logger.info(`Found ${stats.total} nodes to process`);
      
      // Process nodes in batches
      const batchSize = 10;
      for (let i = 0; i < availableNodes.length; i += batchSize) {
        const batch = availableNodes.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (node) => {
          try {
            // Build node type from package name and node name
            const nodeType = `n8n-nodes-base.${node.name}`;
            
            // Extract source code
            const nodeData = await this.extractor.extractNodeSource(nodeType);
            if (!nodeData || !nodeData.sourceCode) {
              throw new Error('Failed to extract node source');
            }
            
            // Parse node definition to get metadata
            const nodeDefinition = this.parseNodeDefinition(nodeData.sourceCode);
            
            // Get enhanced documentation
            const enhancedDocs = await this.docsFetcher.getEnhancedNodeDocumentation(nodeType);
            
            // Generate example
            const example = ExampleGenerator.generateFromNodeDefinition(nodeDefinition);
            
            // Prepare node info with enhanced documentation
            const nodeInfo: NodeInfo = {
              nodeType: nodeType,
              name: node.name,
              displayName: nodeDefinition.displayName || node.displayName || node.name,
              description: nodeDefinition.description || node.description || '',
              category: nodeDefinition.category || 'Other',
              subcategory: nodeDefinition.subcategory,
              icon: nodeDefinition.icon,
              sourceCode: nodeData.sourceCode,
              credentialCode: nodeData.credentialCode,
              documentationMarkdown: enhancedDocs?.markdown,
              documentationUrl: enhancedDocs?.url,
              documentationTitle: enhancedDocs?.title,
              operations: enhancedDocs?.operations,
              apiMethods: enhancedDocs?.apiMethods,
              documentationExamples: enhancedDocs?.examples,
              templates: enhancedDocs?.templates,
              relatedResources: enhancedDocs?.relatedResources,
              requiredScopes: enhancedDocs?.requiredScopes,
              exampleWorkflow: example,
              exampleParameters: example.nodes[0]?.parameters,
              propertiesSchema: nodeDefinition.properties,
              packageName: nodeData.packageInfo?.name || 'n8n-nodes-base',
              version: nodeDefinition.version,
              codexData: nodeDefinition.codex,
              aliases: nodeDefinition.alias,
              hasCredentials: !!nodeData.credentialCode,
              isTrigger: node.name.toLowerCase().includes('trigger'),
              isWebhook: node.name.toLowerCase().includes('webhook')
            };
            
            // Store in database
            await this.storeNode(nodeInfo);
            
            stats.successful++;
            logger.debug(`Processed node: ${nodeType}`);
          } catch (error) {
            stats.failed++;
            const errorMsg = `Failed to process ${node.name}: ${error instanceof Error ? error.message : String(error)}`;
            stats.errors.push(errorMsg);
            logger.error(errorMsg);
          }
        }));
        
        logger.info(`Progress: ${Math.min(i + batchSize, availableNodes.length)}/${stats.total} nodes processed`);
      }
      
      // Store statistics
      this.storeStatistics(stats);
      
      logger.info(`Database rebuild complete: ${stats.successful} successful, ${stats.failed} failed`);
      
    } catch (error) {
      logger.error('Database rebuild failed:', error);
      throw error;
    }
    
    return stats;
  }

  /**
   * Parse node definition from source code
   */
  private parseNodeDefinition(sourceCode: string): any {
    const result: any = {
      displayName: '',
      description: '',
      properties: [],
      category: null,
      subcategory: null,
      icon: null,
      version: null,
      codex: null,
      alias: null
    };
    
    try {
      // Extract individual properties using specific patterns
      
      // Display name
      const displayNameMatch = sourceCode.match(/displayName\s*[:=]\s*['"`]([^'"`]+)['"`]/);
      if (displayNameMatch) {
        result.displayName = displayNameMatch[1];
      }
      
      // Description
      const descriptionMatch = sourceCode.match(/description\s*[:=]\s*['"`]([^'"`]+)['"`]/);
      if (descriptionMatch) {
        result.description = descriptionMatch[1];
      }
      
      // Icon
      const iconMatch = sourceCode.match(/icon\s*[:=]\s*['"`]([^'"`]+)['"`]/);
      if (iconMatch) {
        result.icon = iconMatch[1];
      }
      
      // Category/group
      const groupMatch = sourceCode.match(/group\s*[:=]\s*\[['"`]([^'"`]+)['"`]\]/);
      if (groupMatch) {
        result.category = groupMatch[1];
      }
      
      // Version
      const versionMatch = sourceCode.match(/version\s*[:=]\s*(\d+)/);
      if (versionMatch) {
        result.version = parseInt(versionMatch[1], 10);
      }
      
      // Subtitle
      const subtitleMatch = sourceCode.match(/subtitle\s*[:=]\s*['"`]([^'"`]+)['"`]/);
      if (subtitleMatch) {
        result.subtitle = subtitleMatch[1];
      }
      
      // Try to extract properties array
      const propsMatch = sourceCode.match(/properties\s*[:=]\s*(\[[\s\S]*?\])\s*[,}]/);
      if (propsMatch) {
        try {
          // This is complex to parse from minified code, so we'll skip for now
          result.properties = [];
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      // Check if it's a trigger node
      if (sourceCode.includes('implements.*ITrigger') || 
          sourceCode.includes('polling:.*true') ||
          sourceCode.includes('webhook:.*true') ||
          result.displayName.toLowerCase().includes('trigger')) {
        result.isTrigger = true;
      }
      
      // Check if it's a webhook node
      if (sourceCode.includes('webhooks:') || 
          sourceCode.includes('webhook:.*true') ||
          result.displayName.toLowerCase().includes('webhook')) {
        result.isWebhook = true;
      }
      
    } catch (error) {
      logger.debug('Error parsing node definition:', error);
    }
    
    return result;
  }

  /**
   * Convert database row to NodeInfo
   */
  private rowToNodeInfo(row: any): NodeInfo {
    return {
      nodeType: row.node_type,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      category: row.category,
      subcategory: row.subcategory,
      icon: row.icon,
      sourceCode: row.source_code,
      credentialCode: row.credential_code,
      documentationMarkdown: row.documentation_markdown,
      documentationUrl: row.documentation_url,
      documentationTitle: row.documentation_title,
      operations: row.operations ? JSON.parse(row.operations) : null,
      apiMethods: row.api_methods ? JSON.parse(row.api_methods) : null,
      documentationExamples: row.documentation_examples ? JSON.parse(row.documentation_examples) : null,
      templates: row.templates ? JSON.parse(row.templates) : null,
      relatedResources: row.related_resources ? JSON.parse(row.related_resources) : null,
      requiredScopes: row.required_scopes ? JSON.parse(row.required_scopes) : null,
      exampleWorkflow: row.example_workflow ? JSON.parse(row.example_workflow) : null,
      exampleParameters: row.example_parameters ? JSON.parse(row.example_parameters) : null,
      propertiesSchema: row.properties_schema ? JSON.parse(row.properties_schema) : null,
      packageName: row.package_name,
      version: row.version,
      codexData: row.codex_data ? JSON.parse(row.codex_data) : null,
      aliases: row.aliases ? JSON.parse(row.aliases) : null,
      hasCredentials: row.has_credentials === 1,
      isTrigger: row.is_trigger === 1,
      isWebhook: row.is_webhook === 1
    };
  }

  /**
   * Generate hash for content
   */
  private generateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Store extraction statistics
   */
  private storeStatistics(stats: any): void {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(`
      INSERT INTO extraction_stats (
        total_nodes, nodes_with_docs, nodes_with_examples,
        total_code_size, total_docs_size
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    // Calculate sizes
    const sizeStats = this.db!.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN documentation_markdown IS NOT NULL THEN 1 ELSE 0 END) as with_docs,
        SUM(CASE WHEN example_workflow IS NOT NULL THEN 1 ELSE 0 END) as with_examples,
        SUM(code_length) as code_size,
        SUM(LENGTH(documentation_markdown)) as docs_size
      FROM nodes
    `).get() as any;
    
    stmt.run(
      stats.successful,
      sizeStats?.with_docs || 0,
      sizeStats?.with_examples || 0,
      sizeStats?.code_size || 0,
      sizeStats?.docs_size || 0
    );
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<any> {
    await this.ensureInitialized();
    const stats = this.db!.prepare(`
      SELECT 
        COUNT(*) as totalNodes,
        COUNT(DISTINCT package_name) as totalPackages,
        SUM(code_length) as totalCodeSize,
        SUM(CASE WHEN documentation_markdown IS NOT NULL THEN 1 ELSE 0 END) as nodesWithDocs,
        SUM(CASE WHEN example_workflow IS NOT NULL THEN 1 ELSE 0 END) as nodesWithExamples,
        SUM(has_credentials) as nodesWithCredentials,
        SUM(is_trigger) as triggerNodes,
        SUM(is_webhook) as webhookNodes
      FROM nodes
    `).get() as any;
    
    const packages = this.db!.prepare(`
      SELECT package_name as package, COUNT(*) as count
      FROM nodes
      GROUP BY package_name
      ORDER BY count DESC
    `).all();
    
    return {
      totalNodes: stats?.totalNodes || 0,
      totalPackages: stats?.totalPackages || 0,
      totalCodeSize: stats?.totalCodeSize || 0,
      nodesWithDocs: stats?.nodesWithDocs || 0,
      nodesWithExamples: stats?.nodesWithExamples || 0,
      nodesWithCredentials: stats?.nodesWithCredentials || 0,
      triggerNodes: stats?.triggerNodes || 0,
      webhookNodes: stats?.webhookNodes || 0,
      packageDistribution: packages
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.ensureInitialized();
    this.db!.close();
  }
}