import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import path from 'path';
import { n8nDocumentationTools } from './tools-update';
import { logger } from '../utils/logger';
import { NodeRepository } from '../database/node-repository';
import { DatabaseAdapter, createDatabaseAdapter } from '../database/database-adapter';

interface NodeRow {
  node_type: string;
  package_name: string;
  display_name: string;
  description?: string;
  category?: string;
  development_style?: string;
  is_ai_tool: number;
  is_trigger: number;
  is_webhook: number;
  is_versioned: number;
  version?: string;
  documentation?: string;
  properties_schema?: string;
  operations?: string;
  credentials_required?: string;
}

export class N8NDocumentationMCPServer {
  private server: Server;
  private db: DatabaseAdapter | null = null;
  private repository: NodeRepository | null = null;
  private initialized: Promise<void>;

  constructor() {
    // Try multiple database paths
    const possiblePaths = [
      path.join(process.cwd(), 'data', 'nodes.db'),
      path.join(__dirname, '../../data', 'nodes.db'),
      './data/nodes.db'
    ];
    
    let dbPath: string | null = null;
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        dbPath = p;
        break;
      }
    }
    
    if (!dbPath) {
      logger.error('Database not found in any of the expected locations:', possiblePaths);
      throw new Error('Database nodes.db not found. Please run npm run rebuild first.');
    }
    
    // Initialize database asynchronously
    this.initialized = this.initializeDatabase(dbPath);
    
    logger.info('Initializing n8n Documentation MCP server');
    
    this.server = new Server(
      {
        name: 'n8n-documentation-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }
  
  private async initializeDatabase(dbPath: string): Promise<void> {
    try {
      this.db = await createDatabaseAdapter(dbPath);
      this.repository = new NodeRepository(this.db);
      logger.info(`Initialized database from: ${dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    await this.initialized;
    if (!this.db || !this.repository) {
      throw new Error('Database not initialized');
    }
  }

  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: n8nDocumentationTools,
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        logger.debug(`Executing tool: ${name}`, { args });
        const result = await this.executeTool(name, args);
        logger.debug(`Tool ${name} executed successfully`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`Error executing tool ${name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async executeTool(name: string, args: any): Promise<any> {
    switch (name) {
      case 'list_nodes':
        return this.listNodes(args);
      case 'get_node_info':
        return this.getNodeInfo(args.nodeType);
      case 'search_nodes':
        return this.searchNodes(args.query, args.limit);
      case 'list_ai_tools':
        return this.listAITools();
      case 'get_node_documentation':
        return this.getNodeDocumentation(args.nodeType);
      case 'get_database_statistics':
        return this.getDatabaseStatistics();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async listNodes(filters: any = {}): Promise<any> {
    await this.ensureInitialized();
    
    let query = 'SELECT * FROM nodes WHERE 1=1';
    const params: any[] = [];

    if (filters.package) {
      query += ' AND package_name = ?';
      params.push(filters.package);
    }

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.developmentStyle) {
      query += ' AND development_style = ?';
      params.push(filters.developmentStyle);
    }

    if (filters.isAITool !== undefined) {
      query += ' AND is_ai_tool = ?';
      params.push(filters.isAITool ? 1 : 0);
    }

    query += ' ORDER BY display_name';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const nodes = this.db!.prepare(query).all(...params) as NodeRow[];
    
    return {
      nodes: nodes.map(node => ({
        nodeType: node.node_type,
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        package: node.package_name,
        developmentStyle: node.development_style,
        isAITool: !!node.is_ai_tool,
        isTrigger: !!node.is_trigger,
        isVersioned: !!node.is_versioned,
      })),
      totalCount: nodes.length,
    };
  }

  private async getNodeInfo(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    let node = this.repository.getNode(nodeType);
    
    if (!node) {
      // Try alternative formats
      const alternatives = [
        nodeType,
        nodeType.replace('n8n-nodes-base.', ''),
        `n8n-nodes-base.${nodeType}`,
        nodeType.toLowerCase()
      ];
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
      
      if (!node) {
        throw new Error(`Node ${nodeType} not found`);
      }
    }
    
    return node;
  }

  private async searchNodes(query: string, limit: number = 20): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');
    // Simple search across multiple fields
    const searchQuery = `%${query}%`;
    const nodes = this.db!.prepare(`
      SELECT * FROM nodes 
      WHERE node_type LIKE ? 
         OR display_name LIKE ? 
         OR description LIKE ?
         OR documentation LIKE ?
      ORDER BY 
        CASE 
          WHEN node_type LIKE ? THEN 1
          WHEN display_name LIKE ? THEN 2
          ELSE 3
        END
      LIMIT ?
    `).all(
      searchQuery, searchQuery, searchQuery, searchQuery,
      searchQuery, searchQuery,
      limit
    ) as NodeRow[];
    
    return {
      query,
      results: nodes.map(node => ({
        nodeType: node.node_type,
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        package: node.package_name,
        relevance: this.calculateRelevance(node, query),
      })),
      totalCount: nodes.length,
    };
  }

  private calculateRelevance(node: NodeRow, query: string): string {
    const lowerQuery = query.toLowerCase();
    if (node.node_type.toLowerCase().includes(lowerQuery)) return 'high';
    if (node.display_name.toLowerCase().includes(lowerQuery)) return 'high';
    if (node.description?.toLowerCase().includes(lowerQuery)) return 'medium';
    return 'low';
  }

  private async listAITools(): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    const tools = this.repository.getAITools();
    
    return {
      tools,
      totalCount: tools.length,
      requirements: {
        environmentVariable: 'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true',
        nodeProperty: 'usableAsTool: true',
      },
    };
  }

  private async getNodeDocumentation(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');
    const node = this.db!.prepare(`
      SELECT node_type, display_name, documentation 
      FROM nodes 
      WHERE node_type = ?
    `).get(nodeType) as NodeRow | undefined;
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    return {
      nodeType: node.node_type,
      displayName: node.display_name,
      documentation: node.documentation || 'No documentation available',
      hasDocumentation: !!node.documentation,
    };
  }

  private async getDatabaseStatistics(): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');
    const stats = this.db!.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(is_ai_tool) as ai_tools,
        SUM(is_trigger) as triggers,
        SUM(is_versioned) as versioned,
        SUM(CASE WHEN documentation IS NOT NULL THEN 1 ELSE 0 END) as with_docs,
        COUNT(DISTINCT package_name) as packages,
        COUNT(DISTINCT category) as categories
      FROM nodes
    `).get() as any;
    
    const packages = this.db!.prepare(`
      SELECT package_name, COUNT(*) as count 
      FROM nodes 
      GROUP BY package_name
    `).all() as any[];
    
    return {
      totalNodes: stats.total,
      statistics: {
        aiTools: stats.ai_tools,
        triggers: stats.triggers,
        versionedNodes: stats.versioned,
        nodesWithDocumentation: stats.with_docs,
        documentationCoverage: Math.round((stats.with_docs / stats.total) * 100) + '%',
        uniquePackages: stats.packages,
        uniqueCategories: stats.categories,
      },
      packageBreakdown: packages.map(pkg => ({
        package: pkg.package_name,
        nodeCount: pkg.count,
      })),
    };
  }

  // Add connect method to accept any transport
  async connect(transport: any): Promise<void> {
    await this.ensureInitialized();
    await this.server.connect(transport);
    logger.info('MCP Server connected', { 
      transportType: transport.constructor.name 
    });
  }

  async run(): Promise<void> {
    // Ensure database is initialized before starting server
    await this.ensureInitialized();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('n8n Documentation MCP Server running on stdio transport');
  }
}