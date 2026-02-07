import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { n8nDocumentationToolsFinal } from './tools';
import { UIAppRegistry } from './ui';
import { n8nManagementTools } from './tools-n8n-manager';
import { makeToolsN8nFriendly } from './tools-n8n-friendly';
import { getWorkflowExampleString } from './workflow-examples';
import { logger } from '../utils/logger';
import { NodeRepository } from '../database/node-repository';
import { DatabaseAdapter, createDatabaseAdapter } from '../database/database-adapter';
import { getSharedDatabase, releaseSharedDatabase, SharedDatabaseState } from '../database/shared-database';
import { PropertyFilter } from '../services/property-filter';
import { TaskTemplates } from '../services/task-templates';
import { ConfigValidator } from '../services/config-validator';
import { EnhancedConfigValidator, ValidationMode, ValidationProfile } from '../services/enhanced-config-validator';
import { PropertyDependencies } from '../services/property-dependencies';
import { TypeStructureService } from '../services/type-structure-service';
import { SimpleCache } from '../utils/simple-cache';
import { TemplateService } from '../templates/template-service';
import { WorkflowValidator } from '../services/workflow-validator';
import { isN8nApiConfigured } from '../config/n8n-api';
import * as n8nHandlers from './handlers-n8n-manager';
import { handleUpdatePartialWorkflow } from './handlers-workflow-diff';
import { getToolDocumentation, getToolsOverview } from './tools-documentation';
import { PROJECT_VERSION } from '../utils/version';
import { getNodeTypeAlternatives, getWorkflowNodeType } from '../utils/node-utils';
import { NodeTypeNormalizer } from '../utils/node-type-normalizer';
import { ToolValidation, Validator, ValidationError } from '../utils/validation-schemas';
import {
  negotiateProtocolVersion,
  logProtocolNegotiation,
  STANDARD_PROTOCOL_VERSION
} from '../utils/protocol-version';
import { InstanceContext } from '../types/instance-context';
import { telemetry } from '../telemetry';
import { EarlyErrorLogger } from '../telemetry/early-error-logger';
import { STARTUP_CHECKPOINTS } from '../telemetry/startup-checkpoints';

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
  is_tool_variant: number;
  tool_variant_of?: string;
  has_tool_variant: number;
  version?: string;
  documentation?: string;
  properties_schema?: string;
  operations?: string;
  credentials_required?: string;
  // AI documentation fields
  ai_documentation_summary?: string;
  ai_summary_generated_at?: string;
}

interface VersionSummary {
  currentVersion: string;
  totalVersions: number;
  hasVersionHistory: boolean;
}

interface ToolVariantGuidance {
  isToolVariant: boolean;
  toolVariantOf?: string;
  hasToolVariant: boolean;
  toolVariantNodeType?: string;
  guidance?: string;
}

interface NodeMinimalInfo {
  nodeType: string;
  workflowNodeType: string;
  displayName: string;
  description: string;
  category: string;
  package: string;
  isAITool: boolean;
  isTrigger: boolean;
  isWebhook: boolean;
  toolVariantInfo?: ToolVariantGuidance;
}

interface NodeStandardInfo {
  nodeType: string;
  displayName: string;
  description: string;
  category: string;
  requiredProperties: any[];
  commonProperties: any[];
  operations?: any[];
  credentials?: any;
  examples?: any[];
  versionInfo: VersionSummary;
  toolVariantInfo?: ToolVariantGuidance;
}

interface NodeFullInfo {
  nodeType: string;
  displayName: string;
  description: string;
  category: string;
  properties: any[];
  operations?: any[];
  credentials?: any;
  documentation?: string;
  versionInfo: VersionSummary;
  toolVariantInfo?: ToolVariantGuidance;
}

interface VersionHistoryInfo {
  nodeType: string;
  versions: any[];
  latestVersion: string;
  hasBreakingChanges: boolean;
}

interface VersionComparisonInfo {
  nodeType: string;
  fromVersion: string;
  toVersion: string;
  changes: any[];
  breakingChanges?: any[];
  migrations?: any[];
}

type NodeInfoResponse = NodeMinimalInfo | NodeStandardInfo | NodeFullInfo | VersionHistoryInfo | VersionComparisonInfo;

export class N8NDocumentationMCPServer {
  private server: Server;
  private db: DatabaseAdapter | null = null;
  private repository: NodeRepository | null = null;
  private templateService: TemplateService | null = null;
  private initialized: Promise<void>;
  private cache = new SimpleCache();
  private clientInfo: any = null;
  private instanceContext?: InstanceContext;
  private previousTool: string | null = null;
  private previousToolTimestamp: number = Date.now();
  private earlyLogger: EarlyErrorLogger | null = null;
  private disabledToolsCache: Set<string> | null = null;
  private useSharedDatabase: boolean = false;  // Track if using shared DB for cleanup
  private sharedDbState: SharedDatabaseState | null = null;  // Reference to shared DB state for release
  private isShutdown: boolean = false;  // Prevent double-shutdown

  constructor(instanceContext?: InstanceContext, earlyLogger?: EarlyErrorLogger) {
    this.instanceContext = instanceContext;
    this.earlyLogger = earlyLogger || null;
    // Check for test environment first
    const envDbPath = process.env.NODE_DB_PATH;
    let dbPath: string | null = null;
    
    let possiblePaths: string[] = [];
    
    if (envDbPath && (envDbPath === ':memory:' || existsSync(envDbPath))) {
      dbPath = envDbPath;
    } else {
      // Try multiple database paths
      possiblePaths = [
        path.join(process.cwd(), 'data', 'nodes.db'),
        path.join(__dirname, '../../data', 'nodes.db'),
        './data/nodes.db'
      ];
      
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          dbPath = p;
          break;
        }
      }
    }
    
    if (!dbPath) {
      logger.error('Database not found in any of the expected locations:', possiblePaths);
      throw new Error('Database nodes.db not found. Please run npm run rebuild first.');
    }
    
    // Initialize database asynchronously
    this.initialized = this.initializeDatabase(dbPath).then(() => {
      // After database is ready, check n8n API configuration (v2.18.3)
      if (this.earlyLogger) {
        this.earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.N8N_API_CHECKING);
      }

      // Log n8n API configuration status at startup
      const apiConfigured = isN8nApiConfigured();
      const totalTools = apiConfigured ?
        n8nDocumentationToolsFinal.length + n8nManagementTools.length :
        n8nDocumentationToolsFinal.length;

      logger.info(`MCP server initialized with ${totalTools} tools (n8n API: ${apiConfigured ? 'configured' : 'not configured'})`);

      if (this.earlyLogger) {
        this.earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.N8N_API_READY);
      }
    });

    logger.info('Initializing n8n Documentation MCP server');
    
    this.server = new Server(
      {
        name: 'n8n-documentation-mcp',
        version: PROJECT_VERSION,
        icons: [
          {
            src: "https://www.n8n-mcp.com/logo.png",
            mimeType: "image/png",
            sizes: ["192x192"]
          },
          {
            src: "https://www.n8n-mcp.com/logo-128.png",
            mimeType: "image/png",
            sizes: ["128x128"]
          },
          {
            src: "https://www.n8n-mcp.com/logo-48.png",
            mimeType: "image/png",
            sizes: ["48x48"]
          }
        ],
        websiteUrl: "https://n8n-mcp.com"
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    UIAppRegistry.load();
    this.setupHandlers();
  }

  /**
   * Close the server and release resources.
   * Should be called when the session is being removed.
   *
   * Order of cleanup:
   * 1. Close MCP server connection
   * 2. Destroy cache (clears entries AND stops cleanup timer)
   * 3. Release shared database OR close dedicated connection
   * 4. Null out references to help GC
   *
   * IMPORTANT: For shared databases, we only release the reference (decrement refCount),
   * NOT close the database. The database stays open for other sessions.
   * For in-memory databases (tests), we close the dedicated connection.
   */
  async close(): Promise<void> {
    // Wait for initialization to complete (or fail) before cleanup
    // This prevents race conditions where close runs while init is in progress
    try {
      await this.initialized;
    } catch (error) {
      // Initialization failed - that's OK, we still need to clean up
      logger.debug('Initialization had failed, proceeding with cleanup', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await this.server.close();

      // Use destroy() not clear() - also stops the cleanup timer
      this.cache.destroy();

      // Handle database cleanup based on whether it's shared or dedicated
      if (this.useSharedDatabase && this.sharedDbState) {
        // Shared database: release reference, don't close
        // The database stays open for other sessions
        releaseSharedDatabase(this.sharedDbState);
        logger.debug('Released shared database reference');
      } else if (this.db) {
        // Dedicated database (in-memory for tests): close it
        try {
          this.db.close();
        } catch (dbError) {
          logger.warn('Error closing database', {
            error: dbError instanceof Error ? dbError.message : String(dbError)
          });
        }
      }

      // Null out references to help garbage collection
      this.db = null;
      this.repository = null;
      this.templateService = null;
      this.earlyLogger = null;
      this.sharedDbState = null;
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      logger.warn('Error closing MCP server', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async initializeDatabase(dbPath: string): Promise<void> {
    try {
      // Checkpoint: Database connecting (v2.18.3)
      if (this.earlyLogger) {
        this.earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.DATABASE_CONNECTING);
      }

      logger.debug('Database initialization starting...', { dbPath });

      // For in-memory databases (tests), create a dedicated connection
      // For regular databases, use the shared connection to prevent memory leaks
      if (dbPath === ':memory:') {
        this.db = await createDatabaseAdapter(dbPath);
        logger.debug('Database adapter created (in-memory mode)');
        await this.initializeInMemorySchema();
        logger.debug('In-memory schema initialized');
        this.repository = new NodeRepository(this.db);
        this.templateService = new TemplateService(this.db);
        // Initialize similarity services for enhanced validation
        EnhancedConfigValidator.initializeSimilarityServices(this.repository);
        this.useSharedDatabase = false;
      } else {
        // Use shared database connection to prevent ~900MB memory leak per session
        // See: Memory leak fix - database was being duplicated per session
        const sharedState = await getSharedDatabase(dbPath);
        this.db = sharedState.db;
        this.repository = sharedState.repository;
        this.templateService = sharedState.templateService;
        this.sharedDbState = sharedState;
        this.useSharedDatabase = true;
        logger.debug('Using shared database connection');
      }

      logger.debug('Node repository initialized');
      logger.debug('Template service initialized');
      logger.debug('Similarity services initialized');

      // Checkpoint: Database connected (v2.18.3)
      if (this.earlyLogger) {
        this.earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.DATABASE_CONNECTED);
      }

      logger.info(`Database initialized successfully from: ${dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async initializeInMemorySchema(): Promise<void> {
    if (!this.db) return;

    // Read and execute schema
    const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');

    // Parse SQL statements properly (handles BEGIN...END blocks in triggers)
    const statements = this.parseSQLStatements(schema);

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          this.db.exec(statement);
        } catch (error) {
          logger.error(`Failed to execute SQL statement: ${statement.substring(0, 100)}...`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Parse SQL statements from schema file, properly handling multi-line statements
   * including triggers with BEGIN...END blocks
   */
  private parseSQLStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inBlock = false;

    const lines = sql.split('\n');

    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();

      // Skip comments and empty lines
      if (trimmed.startsWith('--') || trimmed === '') {
        continue;
      }

      // Track BEGIN...END blocks (triggers, procedures)
      if (trimmed.includes('BEGIN')) {
        inBlock = true;
      }

      current += line + '\n';

      // End of block (trigger/procedure)
      if (inBlock && trimmed === 'END;') {
        statements.push(current.trim());
        current = '';
        inBlock = false;
        continue;
      }

      // Regular statement end (not in block)
      if (!inBlock && trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
    }

    // Add any remaining content
    if (current.trim()) {
      statements.push(current.trim());
    }

    return statements.filter(s => s.length > 0);
  }
  
  private async ensureInitialized(): Promise<void> {
    await this.initialized;
    if (!this.db || !this.repository) {
      throw new Error('Database not initialized');
    }

    // Validate database health on first access
    if (!this.dbHealthChecked) {
      await this.validateDatabaseHealth();
      this.dbHealthChecked = true;
    }
  }

  private dbHealthChecked: boolean = false;

  private async validateDatabaseHealth(): Promise<void> {
    if (!this.db) return;

    try {
      // Check if nodes table has data
      const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };

      if (nodeCount.count === 0) {
        logger.error('CRITICAL: Database is empty - no nodes found! Please run: npm run rebuild');
        throw new Error('Database is empty. Run "npm run rebuild" to populate node data.');
      }

      // Check if FTS5 table exists (wrap in try-catch for sql.js compatibility)
      try {
        const ftsExists = this.db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name='nodes_fts'
        `).get();

        if (!ftsExists) {
          logger.warn('FTS5 table missing - search performance will be degraded. Please run: npm run rebuild');
        } else {
          const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get() as { count: number };
          if (ftsCount.count === 0) {
            logger.warn('FTS5 index is empty - search will not work properly. Please run: npm run rebuild');
          }
        }
      } catch (ftsError) {
        // FTS5 not supported (e.g., sql.js fallback) - this is OK, just warn
        logger.warn('FTS5 not available - using fallback search. For better performance, ensure better-sqlite3 is properly installed.');
      }

      logger.info(`Database health check passed: ${nodeCount.count} nodes loaded`);
    } catch (error) {
      logger.error('Database health check failed:', error);
      throw error;
    }
  }

  /**
   * Parse and cache disabled tools from DISABLED_TOOLS environment variable.
   * Returns a Set of tool names that should be filtered from registration.
   *
   * Cached after first call since environment variables don't change at runtime.
   * Includes safety limits: max 10KB env var length, max 200 tools.
   *
   * @returns Set of disabled tool names
   */
  private getDisabledTools(): Set<string> {
    // Return cached value if available
    if (this.disabledToolsCache !== null) {
      return this.disabledToolsCache;
    }

    let disabledToolsEnv = process.env.DISABLED_TOOLS || '';
    if (!disabledToolsEnv) {
      this.disabledToolsCache = new Set();
      return this.disabledToolsCache;
    }

    // Safety limit: prevent abuse with very long environment variables
    if (disabledToolsEnv.length > 10000) {
      logger.warn(`DISABLED_TOOLS environment variable too long (${disabledToolsEnv.length} chars), truncating to 10000`);
      disabledToolsEnv = disabledToolsEnv.substring(0, 10000);
    }

    let tools = disabledToolsEnv
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    // Safety limit: prevent abuse with too many tools
    if (tools.length > 200) {
      logger.warn(`DISABLED_TOOLS contains ${tools.length} tools, limiting to first 200`);
      tools = tools.slice(0, 200);
    }

    if (tools.length > 0) {
      logger.info(`Disabled tools configured: ${tools.join(', ')}`);
    }

    this.disabledToolsCache = new Set(tools);
    return this.disabledToolsCache;
  }

  private setupHandlers(): void {
    // Handle initialization
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const clientVersion = request.params.protocolVersion;
      const clientCapabilities = request.params.capabilities;
      const clientInfo = request.params.clientInfo;
      
      logger.info('MCP Initialize request received', {
        clientVersion,
        clientCapabilities,
        clientInfo
      });

      // Track session start
      telemetry.trackSessionStart();

      // Store client info for later use
      this.clientInfo = clientInfo;
      
      // Negotiate protocol version based on client information
      const negotiationResult = negotiateProtocolVersion(
        clientVersion,
        clientInfo,
        undefined, // no user agent in MCP protocol
        undefined  // no headers in MCP protocol
      );
      
      logProtocolNegotiation(negotiationResult, logger, 'MCP_INITIALIZE');
      
      // Warn if there's a version mismatch (for debugging)
      if (clientVersion && clientVersion !== negotiationResult.version) {
        logger.warn(`Protocol version negotiated: client requested ${clientVersion}, server will use ${negotiationResult.version}`, {
          reasoning: negotiationResult.reasoning
        });
      }
      
      const response = {
        protocolVersion: negotiationResult.version,
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: 'n8n-documentation-mcp',
          version: PROJECT_VERSION,
        },
      };
      
      logger.info('MCP Initialize response', { response });
      return response;
    });

    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      // Get disabled tools from environment variable
      const disabledTools = this.getDisabledTools();

      // Filter documentation tools based on disabled list
      const enabledDocTools = n8nDocumentationToolsFinal.filter(
        tool => !disabledTools.has(tool.name)
      );

      // Combine documentation tools with management tools if API is configured
      let tools = [...enabledDocTools];

      // Check if n8n API tools should be available
      // 1. Environment variables (backward compatibility)
      // 2. Instance context (multi-tenant support)
      // 3. Multi-tenant mode enabled (always show tools, runtime checks will handle auth)
      const hasEnvConfig = isN8nApiConfigured();
      const hasInstanceConfig = !!(this.instanceContext?.n8nApiUrl && this.instanceContext?.n8nApiKey);
      const isMultiTenantEnabled = process.env.ENABLE_MULTI_TENANT === 'true';

      const shouldIncludeManagementTools = hasEnvConfig || hasInstanceConfig || isMultiTenantEnabled;

      if (shouldIncludeManagementTools) {
        // Filter management tools based on disabled list
        const enabledMgmtTools = n8nManagementTools.filter(
          tool => !disabledTools.has(tool.name)
        );
        tools.push(...enabledMgmtTools);
        logger.debug(`Tool listing: ${tools.length} tools available (${enabledDocTools.length} documentation + ${enabledMgmtTools.length} management)`, {
          hasEnvConfig,
          hasInstanceConfig,
          isMultiTenantEnabled,
          disabledToolsCount: disabledTools.size
        });
      } else {
        logger.debug(`Tool listing: ${tools.length} tools available (documentation only)`, {
          hasEnvConfig,
          hasInstanceConfig,
          isMultiTenantEnabled,
          disabledToolsCount: disabledTools.size
        });
      }

      // Log filtered tools count if any tools are disabled
      if (disabledTools.size > 0) {
        const totalAvailableTools = n8nDocumentationToolsFinal.length + (shouldIncludeManagementTools ? n8nManagementTools.length : 0);
        logger.debug(`Filtered ${disabledTools.size} disabled tools, ${tools.length}/${totalAvailableTools} tools available`);
      }
      
      // Check if client is n8n (from initialization)
      const clientInfo = this.clientInfo;
      const isN8nClient = clientInfo?.name?.includes('n8n') || 
                         clientInfo?.name?.includes('langchain');
      
      if (isN8nClient) {
        logger.info('Detected n8n client, using n8n-friendly tool descriptions');
        tools = makeToolsN8nFriendly(tools);
      }
      
      // Log validation tools' input schemas for debugging
      const validationTools = tools.filter(t => t.name.startsWith('validate_'));
      validationTools.forEach(tool => {
        logger.info('Validation tool schema', {
          toolName: tool.name,
          inputSchema: JSON.stringify(tool.inputSchema, null, 2),
          hasOutputSchema: !!tool.outputSchema,
          description: tool.description
        });
      });
      
      UIAppRegistry.injectToolMeta(tools);
      return { tools };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      // Enhanced logging for debugging tool calls
      logger.info('Tool call received - DETAILED DEBUG', {
        toolName: name,
        arguments: JSON.stringify(args, null, 2),
        argumentsType: typeof args,
        argumentsKeys: args ? Object.keys(args) : [],
        hasNodeType: args && 'nodeType' in args,
        hasConfig: args && 'config' in args,
        configType: args && args.config ? typeof args.config : 'N/A',
        rawRequest: JSON.stringify(request.params)
      });

      // Check if tool is disabled via DISABLED_TOOLS environment variable
      const disabledTools = this.getDisabledTools();
      if (disabledTools.has(name)) {
        logger.warn(`Attempted to call disabled tool: ${name}`);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'TOOL_DISABLED',
              message: `Tool '${name}' is not available in this deployment. It has been disabled via DISABLED_TOOLS environment variable.`,
              tool: name
            }, null, 2)
          }]
        };
      }

      // Workaround for n8n's nested output bug
      // Check if args contains nested 'output' structure from n8n's memory corruption
      let processedArgs = args;
      if (args && typeof args === 'object' && 'output' in args) {
        try {
          const possibleNestedData = args.output;
          // If output is a string that looks like JSON, try to parse it
          if (typeof possibleNestedData === 'string' && possibleNestedData.trim().startsWith('{')) {
            const parsed = JSON.parse(possibleNestedData);
            if (parsed && typeof parsed === 'object') {
              logger.warn('Detected n8n nested output bug, attempting to extract actual arguments', {
                originalArgs: args,
                extractedArgs: parsed
              });
              
              // Validate the extracted arguments match expected tool schema
              if (this.validateExtractedArgs(name, parsed)) {
                // Use the extracted data as args
                processedArgs = parsed;
              } else {
                logger.warn('Extracted arguments failed validation, using original args', {
                  toolName: name,
                  extractedArgs: parsed
                });
              }
            }
          }
        } catch (parseError) {
          logger.debug('Failed to parse nested output, continuing with original args', { 
            error: parseError instanceof Error ? parseError.message : String(parseError) 
          });
        }
      }
      
      try {
        logger.debug(`Executing tool: ${name}`, { args: processedArgs });
        const startTime = Date.now();
        const result = await this.executeTool(name, processedArgs);
        const duration = Date.now() - startTime;
        logger.debug(`Tool ${name} executed successfully`);

        // Track tool usage and sequence
        telemetry.trackToolUsage(name, true, duration);

        // Track tool sequence if there was a previous tool
        if (this.previousTool) {
          const timeDelta = Date.now() - this.previousToolTimestamp;
          telemetry.trackToolSequence(this.previousTool, name, timeDelta);
        }

        // Update previous tool tracking
        this.previousTool = name;
        this.previousToolTimestamp = Date.now();
        
        // Ensure the result is properly formatted for MCP
        let responseText: string;
        let structuredContent: any = null;
        
        try {
          // For validation tools, check if we should use structured content
          if (name.startsWith('validate_') && typeof result === 'object' && result !== null) {
            // Clean up the result to ensure it matches the outputSchema
            const cleanResult = this.sanitizeValidationResult(result, name);
            structuredContent = cleanResult;
            responseText = JSON.stringify(cleanResult, null, 2);
          } else {
            responseText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          }
        } catch (jsonError) {
          logger.warn(`Failed to stringify tool result for ${name}:`, jsonError);
          responseText = String(result);
        }
        
        // Validate response size (n8n might have limits)
        if (responseText.length > 1000000) { // 1MB limit
          logger.warn(`Tool ${name} response is very large (${responseText.length} chars), truncating`);
          responseText = responseText.substring(0, 999000) + '\n\n[Response truncated due to size limits]';
          structuredContent = null; // Don't use structured content for truncated responses
        }
        
        // Build MCP response with strict schema compliance
        const mcpResponse: any = {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
        };
        
        // For tools with outputSchema, structuredContent is REQUIRED by MCP spec
        if (name.startsWith('validate_') && structuredContent !== null) {
          mcpResponse.structuredContent = structuredContent;
        }

        return mcpResponse;
      } catch (error) {
        logger.error(`Error executing tool ${name}`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Track tool error
        telemetry.trackToolUsage(name, false);
        telemetry.trackError(
          error instanceof Error ? error.constructor.name : 'UnknownError',
          `tool_execution`,
          name,
          errorMessage
        );

        // Track tool sequence even for errors
        if (this.previousTool) {
          const timeDelta = Date.now() - this.previousToolTimestamp;
          telemetry.trackToolSequence(this.previousTool, name, timeDelta);
        }

        // Update previous tool tracking (even for failed tools)
        this.previousTool = name;
        this.previousToolTimestamp = Date.now();

        // Provide more helpful error messages for common n8n issues
        let helpfulMessage = `Error executing tool ${name}: ${errorMessage}`;
        
        if (errorMessage.includes('required') || errorMessage.includes('missing')) {
          helpfulMessage += '\n\nNote: This error often occurs when the AI agent sends incomplete or incorrectly formatted parameters. Please ensure all required fields are provided with the correct types.';
        } else if (errorMessage.includes('type') || errorMessage.includes('expected')) {
          helpfulMessage += '\n\nNote: This error indicates a type mismatch. The AI agent may be sending data in the wrong format (e.g., string instead of object).';
        } else if (errorMessage.includes('Unknown category') || errorMessage.includes('not found')) {
          helpfulMessage += '\n\nNote: The requested resource or category was not found. Please check the available options.';
        }
        
        // For n8n schema errors, add specific guidance
        if (name.startsWith('validate_') && (errorMessage.includes('config') || errorMessage.includes('nodeType'))) {
          helpfulMessage += '\n\nFor validation tools:\n- nodeType should be a string (e.g., "nodes-base.webhook")\n- config should be an object (e.g., {})';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: helpfulMessage,
            },
          ],
          isError: true,
        };
      }
    });

    // Handle ListResources for UI apps
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const apps = UIAppRegistry.getAllApps();
      return {
        resources: apps
          .filter(app => app.html !== null)
          .map(app => ({
            uri: app.config.uri,
            name: app.config.displayName,
            description: app.config.description,
            mimeType: app.config.mimeType,
          })),
      };
    });

    // Handle ReadResource for UI apps
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      // Parse ui://n8n-mcp/{id} pattern
      const match = uri.match(/^ui:\/\/n8n-mcp\/(.+)$/);
      if (!match) {
        throw new Error(`Unknown resource URI: ${uri}`);
      }

      const app = UIAppRegistry.getAppById(match[1]);
      if (!app || !app.html) {
        throw new Error(`UI app not found or not built: ${match[1]}`);
      }

      return {
        contents: [
          {
            uri: app.config.uri,
            mimeType: app.config.mimeType,
            text: app.html,
          },
        ],
      };
    });
  }

  /**
   * Sanitize validation result to match outputSchema
   */
  private sanitizeValidationResult(result: any, toolName: string): any {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const sanitized = { ...result };

    // Ensure required fields exist with proper types and filter to schema-defined fields only
    if (toolName === 'validate_node_minimal') {
      // Filter to only schema-defined fields
      const filtered = {
        nodeType: String(sanitized.nodeType || ''),
        displayName: String(sanitized.displayName || ''),
        valid: Boolean(sanitized.valid),
        missingRequiredFields: Array.isArray(sanitized.missingRequiredFields) 
          ? sanitized.missingRequiredFields.map(String) 
          : []
      };
      return filtered;
    } else if (toolName === 'validate_node_operation') {
      // Ensure summary exists
      let summary = sanitized.summary;
      if (!summary || typeof summary !== 'object') {
        summary = {
          hasErrors: Array.isArray(sanitized.errors) ? sanitized.errors.length > 0 : false,
          errorCount: Array.isArray(sanitized.errors) ? sanitized.errors.length : 0,
          warningCount: Array.isArray(sanitized.warnings) ? sanitized.warnings.length : 0,
          suggestionCount: Array.isArray(sanitized.suggestions) ? sanitized.suggestions.length : 0
        };
      }
      
      // Filter to only schema-defined fields
      const filtered = {
        nodeType: String(sanitized.nodeType || ''),
        workflowNodeType: String(sanitized.workflowNodeType || sanitized.nodeType || ''),
        displayName: String(sanitized.displayName || ''),
        valid: Boolean(sanitized.valid),
        errors: Array.isArray(sanitized.errors) ? sanitized.errors : [],
        warnings: Array.isArray(sanitized.warnings) ? sanitized.warnings : [],
        suggestions: Array.isArray(sanitized.suggestions) ? sanitized.suggestions : [],
        summary: summary
      };
      return filtered;
    } else if (toolName.startsWith('validate_workflow')) {
      sanitized.valid = Boolean(sanitized.valid);
      
      // Ensure arrays exist
      sanitized.errors = Array.isArray(sanitized.errors) ? sanitized.errors : [];
      sanitized.warnings = Array.isArray(sanitized.warnings) ? sanitized.warnings : [];
      
      // Ensure statistics/summary exists
      if (toolName === 'validate_workflow') {
        if (!sanitized.summary || typeof sanitized.summary !== 'object') {
          sanitized.summary = {
            totalNodes: 0,
            enabledNodes: 0,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0,
            errorCount: sanitized.errors.length,
            warningCount: sanitized.warnings.length
          };
        }
      } else {
        if (!sanitized.statistics || typeof sanitized.statistics !== 'object') {
          sanitized.statistics = {
            totalNodes: 0,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0
          };
        }
      }
    }

    // Remove undefined values to ensure clean JSON
    return JSON.parse(JSON.stringify(sanitized));
  }

  /**
   * Enhanced parameter validation using schemas
   */
  private validateToolParams(toolName: string, args: any, legacyRequiredParams?: string[]): void {
    try {
      // If legacy required params are provided, use the new validation but fall back to basic if needed
      let validationResult;
      
      switch (toolName) {
        case 'validate_node':
          // Consolidated tool handles both modes - validate as operation for now
          validationResult = ToolValidation.validateNodeOperation(args);
          break;
        case 'validate_workflow':
          validationResult = ToolValidation.validateWorkflow(args);
          break;
      case 'search_nodes':
        validationResult = ToolValidation.validateSearchNodes(args);
        break;
      case 'n8n_create_workflow':
        validationResult = ToolValidation.validateCreateWorkflow(args);
        break;
      case 'n8n_get_workflow':
      case 'n8n_update_full_workflow':
      case 'n8n_delete_workflow':
      case 'n8n_validate_workflow':
      case 'n8n_autofix_workflow':
        validationResult = ToolValidation.validateWorkflowId(args);
        break;
      case 'n8n_executions':
        // Requires action parameter, id validation done in handler based on action
        validationResult = args.action
          ? { valid: true, errors: [] }
          : { valid: false, errors: [{ field: 'action', message: 'action is required' }] };
        break;
      case 'n8n_deploy_template':
        // Requires templateId parameter
        validationResult = args.templateId !== undefined
          ? { valid: true, errors: [] }
          : { valid: false, errors: [{ field: 'templateId', message: 'templateId is required' }] };
        break;
      default:
        // For tools not yet migrated to schema validation, use basic validation
        return this.validateToolParamsBasic(toolName, args, legacyRequiredParams || []);
      }
      
      if (!validationResult.valid) {
        const errorMessage = Validator.formatErrors(validationResult, toolName);
        logger.error(`Parameter validation failed for ${toolName}:`, errorMessage);
        throw new ValidationError(errorMessage);
      }
    } catch (error) {
      // Handle validation errors properly
      if (error instanceof ValidationError) {
        throw error; // Re-throw validation errors as-is
      }
      
      // Handle unexpected errors from validation system
      logger.error(`Validation system error for ${toolName}:`, error);
      
      // Provide a user-friendly error message
      const errorMessage = error instanceof Error 
        ? `Internal validation error: ${error.message}`
        : `Internal validation error while processing ${toolName}`;
      
      throw new Error(errorMessage);
    }
  }
  
  /**
   * Legacy parameter validation (fallback)
   */
  private validateToolParamsBasic(toolName: string, args: any, requiredParams: string[]): void {
    const missing: string[] = [];
    const invalid: string[] = [];

    for (const param of requiredParams) {
      if (!(param in args) || args[param] === undefined || args[param] === null) {
        missing.push(param);
      } else if (typeof args[param] === 'string' && args[param].trim() === '') {
        invalid.push(`${param} (empty string)`);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required parameters for ${toolName}: ${missing.join(', ')}. Please provide the required parameters to use this tool.`);
    }

    if (invalid.length > 0) {
      throw new Error(`Invalid parameters for ${toolName}: ${invalid.join(', ')}. String parameters cannot be empty.`);
    }
  }

  /**
   * Validate extracted arguments match expected tool schema
   */
  private validateExtractedArgs(toolName: string, args: any): boolean {
    if (!args || typeof args !== 'object') {
      return false;
    }

    // Get all available tools
    const allTools = [...n8nDocumentationToolsFinal, ...n8nManagementTools];
    const tool = allTools.find(t => t.name === toolName);
    if (!tool || !tool.inputSchema) {
      return true; // If no schema, assume valid
    }

    const schema = tool.inputSchema;
    const required = schema.required || [];
    const properties = schema.properties || {};

    // Check all required fields are present
    for (const requiredField of required) {
      if (!(requiredField in args)) {
        logger.debug(`Extracted args missing required field: ${requiredField}`, {
          toolName,
          extractedArgs: args,
          required
        });
        return false;
      }
    }

    // Check field types match schema
    for (const [fieldName, fieldValue] of Object.entries(args)) {
      if (properties[fieldName]) {
        const expectedType = properties[fieldName].type;
        const actualType = Array.isArray(fieldValue) ? 'array' : typeof fieldValue;

        // Basic type validation
        if (expectedType && expectedType !== actualType) {
          // Special case: number can be coerced from string
          if (expectedType === 'number' && actualType === 'string' && !isNaN(Number(fieldValue))) {
            continue;
          }
          
          logger.debug(`Extracted args field type mismatch: ${fieldName}`, {
            toolName,
            expectedType,
            actualType,
            fieldValue
          });
          return false;
        }
      }
    }

    // Check for extraneous fields if additionalProperties is false
    if (schema.additionalProperties === false) {
      const allowedFields = Object.keys(properties);
      const extraFields = Object.keys(args).filter(field => !allowedFields.includes(field));
      
      if (extraFields.length > 0) {
        logger.debug(`Extracted args have extra fields`, {
          toolName,
          extraFields,
          allowedFields
        });
        // For n8n compatibility, we'll still consider this valid but log it
      }
    }

    return true;
  }

  async executeTool(name: string, args: any): Promise<any> {
    // Ensure args is an object and validate it
    args = args || {};

    // Defense in depth: This should never be reached since CallToolRequestSchema
    // handler already checks disabled tools (line 514-528), but we guard here
    // in case of future refactoring or direct executeTool() calls
    const disabledTools = this.getDisabledTools();
    if (disabledTools.has(name)) {
      throw new Error(`Tool '${name}' is disabled via DISABLED_TOOLS environment variable`);
    }

    // Log the tool call for debugging n8n issues
    logger.info(`Tool execution: ${name}`, {
      args: typeof args === 'object' ? JSON.stringify(args) : args,
      argsType: typeof args,
      argsKeys: typeof args === 'object' ? Object.keys(args) : 'not-object'
    });

    // Validate that args is actually an object
    if (typeof args !== 'object' || args === null) {
      throw new Error(`Invalid arguments for tool ${name}: expected object, got ${typeof args}`);
    }

    switch (name) {
      case 'tools_documentation':
        // No required parameters
        return this.getToolsDocumentation(args.topic, args.depth);
      case 'search_nodes':
        this.validateToolParams(name, args, ['query']);
        // Convert limit to number if provided, otherwise use default
        const limit = args.limit !== undefined ? Number(args.limit) || 20 : 20;
        return this.searchNodes(args.query, limit, {
          mode: args.mode,
          includeExamples: args.includeExamples,
          source: args.source
        });
      case 'get_node':
        this.validateToolParams(name, args, ['nodeType']);
        // Handle consolidated modes: docs, search_properties
        if (args.mode === 'docs') {
          return this.getNodeDocumentation(args.nodeType);
        }
        if (args.mode === 'search_properties') {
          if (!args.propertyQuery) {
            throw new Error('propertyQuery is required for mode=search_properties');
          }
          const maxResults = args.maxPropertyResults !== undefined ? Number(args.maxPropertyResults) || 20 : 20;
          return this.searchNodeProperties(args.nodeType, args.propertyQuery, maxResults);
        }
        return this.getNode(
          args.nodeType,
          args.detail,
          args.mode,
          args.includeTypeInfo,
          args.includeExamples,
          args.fromVersion,
          args.toVersion
        );
      case 'validate_node':
        this.validateToolParams(name, args, ['nodeType', 'config']);
        // Ensure config is an object
        if (typeof args.config !== 'object' || args.config === null) {
          logger.warn(`validate_node called with invalid config type: ${typeof args.config}`);
          const validationMode = args.mode || 'full';
          if (validationMode === 'minimal') {
            return {
              nodeType: args.nodeType || 'unknown',
              displayName: 'Unknown Node',
              valid: false,
              missingRequiredFields: [
                'Invalid config format - expected object',
                '🔧 RECOVERY: Use format { "resource": "...", "operation": "..." } or {} for empty config'
              ]
            };
          }
          return {
            nodeType: args.nodeType || 'unknown',
            workflowNodeType: args.nodeType || 'unknown',
            displayName: 'Unknown Node',
            valid: false,
            errors: [{
              type: 'config',
              property: 'config',
              message: 'Invalid config format - expected object',
              fix: 'Provide config as an object with node properties'
            }],
            warnings: [],
            suggestions: [
              '🔧 RECOVERY: Invalid config detected. Fix with:',
              '   • Ensure config is an object: { "resource": "...", "operation": "..." }',
              '   • Use get_node to see required fields for this node type',
              '   • Check if the node type is correct before configuring it'
            ],
            summary: {
              hasErrors: true,
              errorCount: 1,
              warningCount: 0,
              suggestionCount: 3
            }
          };
        }
        // Handle mode parameter
        const validationMode = args.mode || 'full';
        if (validationMode === 'minimal') {
          return this.validateNodeMinimal(args.nodeType, args.config);
        }
        return this.validateNodeConfig(args.nodeType, args.config, 'operation', args.profile);
      case 'get_template':
        this.validateToolParams(name, args, ['templateId']);
        const templateId = Number(args.templateId);
        const templateMode = args.mode || 'full';
        return this.getTemplate(templateId, templateMode);
      case 'search_templates': {
        // Consolidated tool with searchMode parameter
        const searchMode = args.searchMode || 'keyword';
        const searchLimit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
        const searchOffset = Math.max(Number(args.offset) || 0, 0);

        switch (searchMode) {
          case 'by_nodes':
            if (!args.nodeTypes || !Array.isArray(args.nodeTypes) || args.nodeTypes.length === 0) {
              throw new Error('nodeTypes array is required for searchMode=by_nodes');
            }
            return this.listNodeTemplates(args.nodeTypes, searchLimit, searchOffset);
          case 'by_task':
            if (!args.task) {
              throw new Error('task is required for searchMode=by_task');
            }
            return this.getTemplatesForTask(args.task, searchLimit, searchOffset);
          case 'by_metadata':
            return this.searchTemplatesByMetadata({
              category: args.category,
              complexity: args.complexity,
              maxSetupMinutes: args.maxSetupMinutes ? Number(args.maxSetupMinutes) : undefined,
              minSetupMinutes: args.minSetupMinutes ? Number(args.minSetupMinutes) : undefined,
              requiredService: args.requiredService,
              targetAudience: args.targetAudience
            }, searchLimit, searchOffset);
          case 'keyword':
          default:
            if (!args.query) {
              throw new Error('query is required for searchMode=keyword');
            }
            const searchFields = args.fields as string[] | undefined;
            return this.searchTemplates(args.query, searchLimit, searchOffset, searchFields);
        }
      }
      case 'validate_workflow':
        this.validateToolParams(name, args, ['workflow']);
        return this.validateWorkflow(args.workflow, args.options);

      // n8n Management Tools (if API is configured)
      case 'n8n_create_workflow':
        this.validateToolParams(name, args, ['name', 'nodes', 'connections']);
        return n8nHandlers.handleCreateWorkflow(args, this.instanceContext);
      case 'n8n_get_workflow': {
        this.validateToolParams(name, args, ['id']);
        const workflowMode = args.mode || 'full';
        switch (workflowMode) {
          case 'details':
            return n8nHandlers.handleGetWorkflowDetails(args, this.instanceContext);
          case 'structure':
            return n8nHandlers.handleGetWorkflowStructure(args, this.instanceContext);
          case 'minimal':
            return n8nHandlers.handleGetWorkflowMinimal(args, this.instanceContext);
          case 'full':
          default:
            return n8nHandlers.handleGetWorkflow(args, this.instanceContext);
        }
      }
      case 'n8n_update_full_workflow':
        this.validateToolParams(name, args, ['id']);
        return n8nHandlers.handleUpdateWorkflow(args, this.repository!, this.instanceContext);
      case 'n8n_update_partial_workflow':
        this.validateToolParams(name, args, ['id', 'operations']);
        return handleUpdatePartialWorkflow(args, this.repository!, this.instanceContext);
      case 'n8n_delete_workflow':
        this.validateToolParams(name, args, ['id']);
        return n8nHandlers.handleDeleteWorkflow(args, this.instanceContext);
      case 'n8n_list_workflows':
        // No required parameters
        return n8nHandlers.handleListWorkflows(args, this.instanceContext);
      case 'n8n_validate_workflow':
        this.validateToolParams(name, args, ['id']);
        await this.ensureInitialized();
        if (!this.repository) throw new Error('Repository not initialized');
        return n8nHandlers.handleValidateWorkflow(args, this.repository, this.instanceContext);
      case 'n8n_autofix_workflow':
        this.validateToolParams(name, args, ['id']);
        await this.ensureInitialized();
        if (!this.repository) throw new Error('Repository not initialized');
        return n8nHandlers.handleAutofixWorkflow(args, this.repository, this.instanceContext);
      case 'n8n_test_workflow':
        this.validateToolParams(name, args, ['workflowId']);
        return n8nHandlers.handleTestWorkflow(args, this.instanceContext);
      case 'n8n_executions': {
        this.validateToolParams(name, args, ['action']);
        const execAction = args.action;
        switch (execAction) {
          case 'get':
            if (!args.id) {
              throw new Error('id is required for action=get');
            }
            return n8nHandlers.handleGetExecution(args, this.instanceContext);
          case 'list':
            return n8nHandlers.handleListExecutions(args, this.instanceContext);
          case 'delete':
            if (!args.id) {
              throw new Error('id is required for action=delete');
            }
            return n8nHandlers.handleDeleteExecution(args, this.instanceContext);
          default:
            throw new Error(`Unknown action: ${execAction}. Valid actions: get, list, delete`);
        }
      }
      case 'n8n_health_check':
        // No required parameters - supports mode='status' (default) or mode='diagnostic'
        if (args.mode === 'diagnostic') {
          return n8nHandlers.handleDiagnostic({ params: { arguments: args } }, this.instanceContext);
        }
        return n8nHandlers.handleHealthCheck(this.instanceContext);
      case 'n8n_workflow_versions':
        this.validateToolParams(name, args, ['mode']);
        return n8nHandlers.handleWorkflowVersions(args, this.repository!, this.instanceContext);

      case 'n8n_deploy_template':
        this.validateToolParams(name, args, ['templateId']);
        await this.ensureInitialized();
        if (!this.templateService) throw new Error('Template service not initialized');
        if (!this.repository) throw new Error('Repository not initialized');
        return n8nHandlers.handleDeployTemplate(args, this.templateService, this.repository, this.instanceContext);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async listNodes(filters: any = {}): Promise<any> {
    await this.ensureInitialized();
    
    let query = 'SELECT * FROM nodes WHERE 1=1';
    const params: any[] = [];
    
    // console.log('DEBUG list_nodes:', { filters, query, params }); // Removed to prevent stdout interference

    if (filters.package) {
      // Handle both formats
      const packageVariants = [
        filters.package,
        `@n8n/${filters.package}`,
        filters.package.replace('@n8n/', '')
      ];
      query += ' AND package_name IN (' + packageVariants.map(() => '?').join(',') + ')';
      params.push(...packageVariants);
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
        isAITool: Number(node.is_ai_tool) === 1,
        isTrigger: Number(node.is_trigger) === 1,
        isVersioned: Number(node.is_versioned) === 1,
      })),
      totalCount: nodes.length,
    };
  }

  private async getNodeInfo(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // First try with normalized type (repository will also normalize internally)
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Add AI tool capabilities information with null safety
    const aiToolCapabilities = {
      canBeUsedAsTool: true, // Any node can be used as a tool in n8n
      hasUsableAsToolProperty: node.isAITool ?? false,
      requiresEnvironmentVariable: !(node.isAITool ?? false) && node.package !== 'n8n-nodes-base',
      toolConnectionType: 'ai_tool',
      commonToolUseCases: this.getCommonAIToolUseCases(node.nodeType),
      environmentRequirement: node.package && node.package !== 'n8n-nodes-base' ?
        'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true' :
        null
    };

    // Process outputs to provide clear mapping with null safety
    let outputs = undefined;
    if (node.outputNames && Array.isArray(node.outputNames) && node.outputNames.length > 0) {
      outputs = node.outputNames.map((name: string, index: number) => {
        // Special handling for loop nodes like SplitInBatches
        const descriptions = this.getOutputDescriptions(node.nodeType, name, index);
        return {
          index,
          name,
          description: descriptions?.description ?? '',
          connectionGuidance: descriptions?.connectionGuidance ?? ''
        };
      });
    }

    const result: any = {
      ...node,
      workflowNodeType: getWorkflowNodeType(node.package ?? 'n8n-nodes-base', node.nodeType),
      aiToolCapabilities,
      outputs
    };

    // Add tool variant guidance if applicable
    const toolVariantInfo = this.buildToolVariantGuidance(node);
    if (toolVariantInfo) {
      result.toolVariantInfo = toolVariantInfo;
    }

    return result;
  }

  /**
   * Primary search method used by ALL MCP search tools.
   *
   * This method automatically detects and uses FTS5 full-text search when available
   * (lines 1189-1203), falling back to LIKE queries only if FTS5 table doesn't exist.
   *
   * NOTE: This is separate from NodeRepository.searchNodes() which is legacy LIKE-based.
   * All MCP tool invocations route through this method to leverage FTS5 performance.
   */
  private async searchNodes(
    query: string,
    limit: number = 20,
    options?: {
      mode?: 'OR' | 'AND' | 'FUZZY';
      includeSource?: boolean;
      includeExamples?: boolean;
      source?: 'all' | 'core' | 'community' | 'verified';
    }
  ): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');

    // Normalize the query if it looks like a full node type
    let normalizedQuery = query;
    
    // Check if query contains node type patterns and normalize them
    if (query.includes('n8n-nodes-base.') || query.includes('@n8n/n8n-nodes-langchain.')) {
      normalizedQuery = query
        .replace(/n8n-nodes-base\./g, 'nodes-base.')
        .replace(/@n8n\/n8n-nodes-langchain\./g, 'nodes-langchain.');
    }
    
    const searchMode = options?.mode || 'OR';
    
    // Check if FTS5 table exists
    const ftsExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='nodes_fts'
    `).get();
    
    if (ftsExists) {
      // Use FTS5 search with normalized query
      logger.debug(`Using FTS5 search with includeExamples=${options?.includeExamples}`);
      return this.searchNodesFTS(normalizedQuery, limit, searchMode, options);
    } else {
      // Fallback to LIKE search with normalized query
      logger.debug('Using LIKE search (no FTS5)');
      return this.searchNodesLIKE(normalizedQuery, limit, options);
    }
  }

  private async searchNodesFTS(
    query: string,
    limit: number,
    mode: 'OR' | 'AND' | 'FUZZY',
    options?: {
      includeSource?: boolean;
      includeExamples?: boolean;
      source?: 'all' | 'core' | 'community' | 'verified';
    }
  ): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');

    // Clean and prepare the query
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      return { query, results: [], totalCount: 0 };
    }
    
    // For FUZZY mode, use LIKE search with typo patterns
    if (mode === 'FUZZY') {
      return this.searchNodesFuzzy(cleanedQuery, limit);
    }
    
    let ftsQuery: string;
    
    // Handle exact phrase searches with quotes
    if (cleanedQuery.startsWith('"') && cleanedQuery.endsWith('"')) {
      // Keep exact phrase as is for FTS5
      ftsQuery = cleanedQuery;
    } else {
      // Split into words and handle based on mode
      const words = cleanedQuery.split(/\s+/).filter(w => w.length > 0);
      
      switch (mode) {
        case 'AND':
          // All words must be present
          ftsQuery = words.join(' AND ');
          break;
          
        case 'OR':
        default:
          // Any word can match (default)
          ftsQuery = words.join(' OR ');
          break;
      }
    }
    
    try {
      // Build source filter SQL
      let sourceFilter = '';
      const sourceValue = options?.source || 'all';
      switch (sourceValue) {
        case 'core':
          sourceFilter = 'AND n.is_community = 0';
          break;
        case 'community':
          sourceFilter = 'AND n.is_community = 1';
          break;
        case 'verified':
          sourceFilter = 'AND n.is_community = 1 AND n.is_verified = 1';
          break;
        // 'all' - no filter
      }

      // Use FTS5 with ranking
      const nodes = this.db.prepare(`
        SELECT
          n.*,
          rank
        FROM nodes n
        JOIN nodes_fts ON n.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ?
        ${sourceFilter}
        ORDER BY
          CASE
            WHEN LOWER(n.display_name) = LOWER(?) THEN 0
            WHEN LOWER(n.display_name) LIKE LOWER(?) THEN 1
            WHEN LOWER(n.node_type) LIKE LOWER(?) THEN 2
            ELSE 3
          END,
          rank,
          n.display_name
        LIMIT ?
      `).all(ftsQuery, cleanedQuery, `%${cleanedQuery}%`, `%${cleanedQuery}%`, limit) as (NodeRow & { rank: number })[];
      
      // Apply additional relevance scoring for better results
      const scoredNodes = nodes.map(node => {
        const relevanceScore = this.calculateRelevanceScore(node, cleanedQuery);
        return { ...node, relevanceScore };
      });
      
      // Sort by combined score (FTS rank + relevance score)
      scoredNodes.sort((a, b) => {
        // Prioritize exact matches
        if (a.display_name.toLowerCase() === cleanedQuery.toLowerCase()) return -1;
        if (b.display_name.toLowerCase() === cleanedQuery.toLowerCase()) return 1;
        
        // Then by relevance score
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        
        // Then by FTS rank
        return a.rank - b.rank;
      });
      
      // If FTS didn't find key primary nodes, augment with LIKE search
      const hasHttpRequest = scoredNodes.some(n => n.node_type === 'nodes-base.httpRequest');
      if (cleanedQuery.toLowerCase().includes('http') && !hasHttpRequest) {
        // FTS missed HTTP Request, fall back to LIKE search
        logger.debug('FTS missed HTTP Request node, augmenting with LIKE search');
        return this.searchNodesLIKE(query, limit);
      }
      
      const result: any = {
        query,
        results: scoredNodes.map(node => {
          const nodeResult: any = {
            nodeType: node.node_type,
            workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
            displayName: node.display_name,
            description: node.description,
            category: node.category,
            package: node.package_name,
            relevance: this.calculateRelevance(node, cleanedQuery)
          };

          // Add community metadata if this is a community node
          if ((node as any).is_community === 1) {
            nodeResult.isCommunity = true;
            nodeResult.isVerified = (node as any).is_verified === 1;
            if ((node as any).author_name) {
              nodeResult.authorName = (node as any).author_name;
            }
            if ((node as any).npm_downloads) {
              nodeResult.npmDownloads = (node as any).npm_downloads;
            }
          }

          return nodeResult;
        }),
        totalCount: scoredNodes.length
      };

      // Only include mode if it's not the default
      if (mode !== 'OR') {
        result.mode = mode;
      }

      // Add examples if requested
      if (options && options.includeExamples) {
        try {
          for (const nodeResult of result.results) {
            const examples = this.db!.prepare(`
              SELECT
                parameters_json,
                template_name,
                template_views
              FROM template_node_configs
              WHERE node_type = ?
              ORDER BY rank
              LIMIT 2
            `).all(nodeResult.workflowNodeType) as any[];

            if (examples.length > 0) {
              nodeResult.examples = examples.map((ex: any) => ({
                configuration: JSON.parse(ex.parameters_json),
                template: ex.template_name,
                views: ex.template_views
              }));
            }
          }
        } catch (error: any) {
          logger.error(`Failed to add examples:`, error);
        }
      }

      // Track search query telemetry
      telemetry.trackSearchQuery(query, scoredNodes.length, mode ?? 'OR');

      return result;
      
    } catch (error: any) {
      // If FTS5 query fails, fallback to LIKE search
      logger.warn('FTS5 search failed, falling back to LIKE search:', error.message);
      
      // Special handling for syntax errors
      if (error.message.includes('syntax error') || error.message.includes('fts5')) {
        logger.warn(`FTS5 syntax error for query "${query}" in mode ${mode}`);
        
        // For problematic queries, use LIKE search with mode info
        const likeResult = await this.searchNodesLIKE(query, limit);

        // Track search query telemetry for fallback
        telemetry.trackSearchQuery(query, likeResult.results?.length ?? 0, `${mode}_LIKE_FALLBACK`);

        return {
          ...likeResult,
          mode
        };
      }
      
      return this.searchNodesLIKE(query, limit);
    }
  }
  
  private async searchNodesFuzzy(query: string, limit: number): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Split into words for fuzzy matching
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) {
      return { query, results: [], totalCount: 0, mode: 'FUZZY' };
    }
    
    // For fuzzy search, get ALL nodes to ensure we don't miss potential matches
    // We'll limit results after scoring
    const candidateNodes = this.db!.prepare(`
      SELECT * FROM nodes
    `).all() as NodeRow[];
    
    // Calculate fuzzy scores for candidate nodes
    const scoredNodes = candidateNodes.map(node => {
      const score = this.calculateFuzzyScore(node, query);
      return { node, score };
    });
    
    // Filter and sort by score
    const matchingNodes = scoredNodes
      .filter(item => item.score >= 200) // Lower threshold for better typo tolerance
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.node);
    
    // Debug logging
    if (matchingNodes.length === 0) {
      const topScores = scoredNodes
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      logger.debug(`FUZZY search for "${query}" - no matches above 400. Top scores:`, 
        topScores.map(s => ({ name: s.node.display_name, score: s.score })));
    }
    
    return {
      query,
      mode: 'FUZZY',
      results: matchingNodes.map(node => ({
        nodeType: node.node_type,
        workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        package: node.package_name
      })),
      totalCount: matchingNodes.length
    };
  }
  
  private calculateFuzzyScore(node: NodeRow, query: string): number {
    const queryLower = query.toLowerCase();
    const displayNameLower = node.display_name.toLowerCase();
    const nodeTypeLower = node.node_type.toLowerCase();
    const nodeTypeClean = nodeTypeLower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
    
    // Exact match gets highest score
    if (displayNameLower === queryLower || nodeTypeClean === queryLower) {
      return 1000;
    }
    
    // Calculate edit distances for different parts
    const nameDistance = this.getEditDistance(queryLower, displayNameLower);
    const typeDistance = this.getEditDistance(queryLower, nodeTypeClean);
    
    // Also check individual words in the display name
    const nameWords = displayNameLower.split(/\s+/);
    let minWordDistance = Infinity;
    for (const word of nameWords) {
      const distance = this.getEditDistance(queryLower, word);
      if (distance < minWordDistance) {
        minWordDistance = distance;
      }
    }
    
    // Calculate best match score
    const bestDistance = Math.min(nameDistance, typeDistance, minWordDistance);
    
    // Use the length of the matched word for similarity calculation
    let matchedLen = queryLower.length;
    if (minWordDistance === bestDistance) {
      // Find which word matched best
      for (const word of nameWords) {
        if (this.getEditDistance(queryLower, word) === minWordDistance) {
          matchedLen = Math.max(queryLower.length, word.length);
          break;
        }
      }
    } else if (typeDistance === bestDistance) {
      matchedLen = Math.max(queryLower.length, nodeTypeClean.length);
    } else {
      matchedLen = Math.max(queryLower.length, displayNameLower.length);
    }
    
    const similarity = 1 - (bestDistance / matchedLen);
    
    // Boost if query is a substring
    if (displayNameLower.includes(queryLower) || nodeTypeClean.includes(queryLower)) {
      return 800 + (similarity * 100);
    }
    
    // Check if it's a prefix match
    if (displayNameLower.startsWith(queryLower) || 
        nodeTypeClean.startsWith(queryLower) ||
        nameWords.some(w => w.startsWith(queryLower))) {
      return 700 + (similarity * 100);
    }
    
    // Allow up to 1-2 character differences for typos
    if (bestDistance <= 2) {
      return 500 + ((2 - bestDistance) * 100) + (similarity * 50);
    }
    
    // Allow up to 3 character differences for longer words
    if (bestDistance <= 3 && queryLower.length >= 4) {
      return 400 + ((3 - bestDistance) * 50) + (similarity * 50);
    }
    
    // Base score on similarity
    return similarity * 300;
  }
  
  private getEditDistance(s1: string, s2: string): number {
    // Simple Levenshtein distance implementation
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    
    return dp[m][n];
  }
  
  private async searchNodesLIKE(
    query: string,
    limit: number,
    options?: {
      includeSource?: boolean;
      includeExamples?: boolean;
      source?: 'all' | 'core' | 'community' | 'verified';
    }
  ): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');

    // Build source filter SQL
    let sourceFilter = '';
    const sourceValue = options?.source || 'all';
    switch (sourceValue) {
      case 'core':
        sourceFilter = 'AND is_community = 0';
        break;
      case 'community':
        sourceFilter = 'AND is_community = 1';
        break;
      case 'verified':
        sourceFilter = 'AND is_community = 1 AND is_verified = 1';
        break;
      // 'all' - no filter
    }

    // This is the existing LIKE-based implementation
    // Handle exact phrase searches with quotes
    if (query.startsWith('"') && query.endsWith('"')) {
      const exactPhrase = query.slice(1, -1);
      const nodes = this.db!.prepare(`
        SELECT * FROM nodes
        WHERE (node_type LIKE ? OR display_name LIKE ? OR description LIKE ?)
        ${sourceFilter}
        LIMIT ?
      `).all(`%${exactPhrase}%`, `%${exactPhrase}%`, `%${exactPhrase}%`, limit * 3) as NodeRow[];

      // Apply relevance ranking for exact phrase search
      const rankedNodes = this.rankSearchResults(nodes, exactPhrase, limit);

      const result: any = {
        query,
        results: rankedNodes.map(node => {
          const nodeResult: any = {
            nodeType: node.node_type,
            workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
            displayName: node.display_name,
            description: node.description,
            category: node.category,
            package: node.package_name
          };

          // Add community metadata if this is a community node
          if ((node as any).is_community === 1) {
            nodeResult.isCommunity = true;
            nodeResult.isVerified = (node as any).is_verified === 1;
            if ((node as any).author_name) {
              nodeResult.authorName = (node as any).author_name;
            }
            if ((node as any).npm_downloads) {
              nodeResult.npmDownloads = (node as any).npm_downloads;
            }
          }

          return nodeResult;
        }),
        totalCount: rankedNodes.length
      };

      // Add examples if requested
      if (options?.includeExamples) {
        for (const nodeResult of result.results) {
          try {
            const examples = this.db!.prepare(`
              SELECT
                parameters_json,
                template_name,
                template_views
              FROM template_node_configs
              WHERE node_type = ?
              ORDER BY rank
              LIMIT 2
            `).all(nodeResult.workflowNodeType) as any[];

            if (examples.length > 0) {
              nodeResult.examples = examples.map((ex: any) => ({
                configuration: JSON.parse(ex.parameters_json),
                template: ex.template_name,
                views: ex.template_views
              }));
            }
          } catch (error: any) {
            logger.warn(`Failed to fetch examples for ${nodeResult.nodeType}:`, error.message);
          }
        }
      }

      return result;
    }
    
    // Split into words for normal search
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) {
      return { query, results: [], totalCount: 0 };
    }
    
    // Build conditions for each word
    const conditions = words.map(() => 
      '(node_type LIKE ? OR display_name LIKE ? OR description LIKE ?)'
    ).join(' OR ');
    
    const params: any[] = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`]);
    // Fetch more results initially to ensure we get the best matches after ranking
    params.push(limit * 3);
    
    const nodes = this.db!.prepare(`
      SELECT DISTINCT * FROM nodes
      WHERE (${conditions})
      ${sourceFilter}
      LIMIT ?
    `).all(...params) as NodeRow[];
    
    // Apply relevance ranking
    const rankedNodes = this.rankSearchResults(nodes, query, limit);

    const result: any = {
      query,
      results: rankedNodes.map(node => {
        const nodeResult: any = {
          nodeType: node.node_type,
          workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
          displayName: node.display_name,
          description: node.description,
          category: node.category,
          package: node.package_name
        };

        // Add community metadata if this is a community node
        if ((node as any).is_community === 1) {
          nodeResult.isCommunity = true;
          nodeResult.isVerified = (node as any).is_verified === 1;
          if ((node as any).author_name) {
            nodeResult.authorName = (node as any).author_name;
          }
          if ((node as any).npm_downloads) {
            nodeResult.npmDownloads = (node as any).npm_downloads;
          }
        }

        return nodeResult;
      }),
      totalCount: rankedNodes.length
    };

    // Add examples if requested
    if (options?.includeExamples) {
      for (const nodeResult of result.results) {
        try {
          const examples = this.db!.prepare(`
            SELECT
              parameters_json,
              template_name,
              template_views
            FROM template_node_configs
            WHERE node_type = ?
            ORDER BY rank
            LIMIT 2
          `).all(nodeResult.workflowNodeType) as any[];

          if (examples.length > 0) {
            nodeResult.examples = examples.map((ex: any) => ({
              configuration: JSON.parse(ex.parameters_json),
              template: ex.template_name,
              views: ex.template_views
            }));
          }
        } catch (error: any) {
          logger.warn(`Failed to fetch examples for ${nodeResult.nodeType}:`, error.message);
        }
      }
    }

    return result;
  }

  private calculateRelevance(node: NodeRow, query: string): string {
    const lowerQuery = query.toLowerCase();
    if (node.node_type.toLowerCase().includes(lowerQuery)) return 'high';
    if (node.display_name.toLowerCase().includes(lowerQuery)) return 'high';
    if (node.description?.toLowerCase().includes(lowerQuery)) return 'medium';
    return 'low';
  }
  
  private calculateRelevanceScore(node: NodeRow, query: string): number {
    const query_lower = query.toLowerCase();
    const name_lower = node.display_name.toLowerCase();
    const type_lower = node.node_type.toLowerCase();
    const type_without_prefix = type_lower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
    
    let score = 0;
    
    // Exact match in display name (highest priority)
    if (name_lower === query_lower) {
      score = 1000;
    }
    // Exact match in node type (without prefix)
    else if (type_without_prefix === query_lower) {
      score = 950;
    }
    // Special boost for common primary nodes
    else if (query_lower === 'webhook' && node.node_type === 'nodes-base.webhook') {
      score = 900;
    }
    else if ((query_lower === 'http' || query_lower === 'http request' || query_lower === 'http call') && node.node_type === 'nodes-base.httpRequest') {
      score = 900;
    }
    // Additional boost for multi-word queries matching primary nodes
    else if (query_lower.includes('http') && query_lower.includes('call') && node.node_type === 'nodes-base.httpRequest') {
      score = 890;
    }
    else if (query_lower.includes('http') && node.node_type === 'nodes-base.httpRequest') {
      score = 850;
    }
    // Boost for webhook queries
    else if (query_lower.includes('webhook') && node.node_type === 'nodes-base.webhook') {
      score = 850;
    }
    // Display name starts with query
    else if (name_lower.startsWith(query_lower)) {
      score = 800;
    }
    // Word boundary match in display name
    else if (new RegExp(`\\b${query_lower}\\b`, 'i').test(node.display_name)) {
      score = 700;
    }
    // Contains in display name
    else if (name_lower.includes(query_lower)) {
      score = 600;
    }
    // Type contains query (without prefix)
    else if (type_without_prefix.includes(query_lower)) {
      score = 500;
    }
    // Contains in description
    else if (node.description?.toLowerCase().includes(query_lower)) {
      score = 400;
    }
    
    return score;
  }

  private rankSearchResults(nodes: NodeRow[], query: string, limit: number): NodeRow[] {
    const query_lower = query.toLowerCase();
    
    // Calculate relevance scores for each node
    const scoredNodes = nodes.map(node => {
      const name_lower = node.display_name.toLowerCase();
      const type_lower = node.node_type.toLowerCase();
      const type_without_prefix = type_lower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
      
      let score = 0;
      
      // Exact match in display name (highest priority)
      if (name_lower === query_lower) {
        score = 1000;
      }
      // Exact match in node type (without prefix)
      else if (type_without_prefix === query_lower) {
        score = 950;
      }
      // Special boost for common primary nodes
      else if (query_lower === 'webhook' && node.node_type === 'nodes-base.webhook') {
        score = 900;
      }
      else if ((query_lower === 'http' || query_lower === 'http request' || query_lower === 'http call') && node.node_type === 'nodes-base.httpRequest') {
        score = 900;
      }
      // Boost for webhook queries
      else if (query_lower.includes('webhook') && node.node_type === 'nodes-base.webhook') {
        score = 850;
      }
      // Additional boost for http queries
      else if (query_lower.includes('http') && node.node_type === 'nodes-base.httpRequest') {
        score = 850;
      }
      // Display name starts with query
      else if (name_lower.startsWith(query_lower)) {
        score = 800;
      }
      // Word boundary match in display name
      else if (new RegExp(`\\b${query_lower}\\b`, 'i').test(node.display_name)) {
        score = 700;
      }
      // Contains in display name
      else if (name_lower.includes(query_lower)) {
        score = 600;
      }
      // Type contains query (without prefix)
      else if (type_without_prefix.includes(query_lower)) {
        score = 500;
      }
      // Contains in description
      else if (node.description?.toLowerCase().includes(query_lower)) {
        score = 400;
      }
      
      // For multi-word queries, check if all words are present
      const words = query_lower.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 1) {
        const allWordsInName = words.every(word => name_lower.includes(word));
        const allWordsInDesc = words.every(word => node.description?.toLowerCase().includes(word));
        
        if (allWordsInName) score += 200;
        else if (allWordsInDesc) score += 100;
        
        // Special handling for common multi-word queries
        if (query_lower === 'http call' && name_lower === 'http request') {
          score = 920; // Boost HTTP Request for "http call" query
        }
      }
      
      return { node, score };
    });
    
    // Sort by score (descending) and then by display name (ascending)
    scoredNodes.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.node.display_name.localeCompare(b.node.display_name);
    });
    
    // Return only the requested number of results
    return scoredNodes.slice(0, limit).map(item => item.node);
  }

  private async listAITools(): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    const tools = this.repository.getAITools();
    
    // Debug: Check if is_ai_tool column is populated
    const aiCount = this.db!.prepare('SELECT COUNT(*) as ai_count FROM nodes WHERE is_ai_tool = 1').get() as any;
    // console.log('DEBUG list_ai_tools:', { 
    //   toolsLength: tools.length, 
    //   aiCountInDB: aiCount.ai_count,
    //   sampleTools: tools.slice(0, 3)
    // }); // Removed to prevent stdout interference
    
    return {
      tools,
      totalCount: tools.length,
      requirements: {
        environmentVariable: 'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true',
        nodeProperty: 'usableAsTool: true',
      },
      usage: {
        description: 'These nodes have the usableAsTool property set to true, making them optimized for AI agent usage.',
        note: 'ANY node in n8n can be used as an AI tool by connecting it to the ai_tool port of an AI Agent node.',
        examples: [
          'Regular nodes like Slack, Google Sheets, or HTTP Request can be used as tools',
          'Connect any node to an AI Agent\'s tool port to make it available for AI-driven automation',
          'Community nodes require the environment variable to be set'
        ]
      }
    };
  }

  private async getNodeDocumentation(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');

    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.db!.prepare(`
      SELECT node_type, display_name, documentation, description,
             ai_documentation_summary, ai_summary_generated_at
      FROM nodes
      WHERE node_type = ?
    `).get(normalizedType) as NodeRow | undefined;

    // If not found and normalization changed the type, try original
    if (!node && normalizedType !== nodeType) {
      node = this.db!.prepare(`
        SELECT node_type, display_name, documentation, description,
               ai_documentation_summary, ai_summary_generated_at
        FROM nodes
        WHERE node_type = ?
      `).get(nodeType) as NodeRow | undefined;
    }

    // If still not found, try alternatives
    if (!node) {
      const alternatives = getNodeTypeAlternatives(normalizedType);

      for (const alt of alternatives) {
        node = this.db!.prepare(`
          SELECT node_type, display_name, documentation, description,
                 ai_documentation_summary, ai_summary_generated_at
          FROM nodes
          WHERE node_type = ?
        `).get(alt) as NodeRow | undefined;

        if (node) break;
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Parse AI documentation summary if present
    const aiDocSummary = node.ai_documentation_summary
      ? this.safeJsonParse(node.ai_documentation_summary, null)
      : null;

    // If no documentation, generate fallback with null safety
    if (!node.documentation) {
      const essentials = await this.getNodeEssentials(nodeType);

      return {
        nodeType: node.node_type,
        displayName: node.display_name || 'Unknown Node',
        documentation: `
# ${node.display_name || 'Unknown Node'}

${node.description || 'No description available.'}

## Common Properties

${essentials?.commonProperties?.length > 0 ?
  essentials.commonProperties.map((p: any) =>
    `### ${p.displayName || 'Property'}\n${p.description || `Type: ${p.type || 'unknown'}`}`
  ).join('\n\n') :
  'No common properties available.'}

## Note
Full documentation is being prepared. For now, use get_node_essentials for configuration help.
`,
        hasDocumentation: false,
        aiDocumentationSummary: aiDocSummary,
        aiSummaryGeneratedAt: node.ai_summary_generated_at || null,
      };
    }

    return {
      nodeType: node.node_type,
      displayName: node.display_name || 'Unknown Node',
      documentation: node.documentation,
      hasDocumentation: true,
      aiDocumentationSummary: aiDocSummary,
      aiSummaryGeneratedAt: node.ai_summary_generated_at || null,
    };
  }

  private safeJsonParse(json: string, defaultValue: any = null): any {
    try {
      return JSON.parse(json);
    } catch {
      return defaultValue;
    }
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
    
    // Get template statistics
    const templateStats = this.db!.prepare(`
      SELECT 
        COUNT(*) as total_templates,
        AVG(views) as avg_views,
        MIN(views) as min_views,
        MAX(views) as max_views
      FROM templates
    `).get() as any;
    
    return {
      totalNodes: stats.total,
      totalTemplates: templateStats.total_templates || 0,
      statistics: {
        aiTools: stats.ai_tools,
        triggers: stats.triggers,
        versionedNodes: stats.versioned,
        nodesWithDocumentation: stats.with_docs,
        documentationCoverage: Math.round((stats.with_docs / stats.total) * 100) + '%',
        uniquePackages: stats.packages,
        uniqueCategories: stats.categories,
        templates: {
          total: templateStats.total_templates || 0,
          avgViews: Math.round(templateStats.avg_views || 0),
          minViews: templateStats.min_views || 0,
          maxViews: templateStats.max_views || 0
        }
      },
      packageBreakdown: packages.map(pkg => ({
        package: pkg.package_name,
        nodeCount: pkg.count,
      })),
    };
  }

  private async getNodeEssentials(nodeType: string, includeExamples?: boolean): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Check cache first (cache key includes includeExamples)
    const cacheKey = `essentials:${nodeType}:${includeExamples ? 'withExamples' : 'basic'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    // Get the full node information
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties (already parsed by repository)
    const allProperties = node.properties || [];
    
    // Get essential properties
    const essentials = PropertyFilter.getEssentials(allProperties, node.nodeType);
    
    // Get operations (already parsed by repository)
    const operations = node.operations || [];
    
    // Get the latest version - this is important for AI to use correct typeVersion
    const latestVersion = node.version ?? '1';

    const result: any = {
      nodeType: node.nodeType,
      workflowNodeType: getWorkflowNodeType(node.package ?? 'n8n-nodes-base', node.nodeType),
      displayName: node.displayName,
      description: node.description,
      category: node.category,
      version: latestVersion,
      isVersioned: node.isVersioned ?? false,
      // Prominent warning to use the correct typeVersion
      versionNotice: `⚠️ Use typeVersion: ${latestVersion} when creating this node`,
      requiredProperties: essentials.required,
      commonProperties: essentials.common,
      operations: operations.map((op: any) => ({
        name: op.name || op.operation,
        description: op.description,
        action: op.action,
        resource: op.resource
      })),
      // Examples removed - use validate_node_operation for working configurations
      metadata: {
        totalProperties: allProperties.length,
        isAITool: node.isAITool ?? false,
        isTrigger: node.isTrigger ?? false,
        isWebhook: node.isWebhook ?? false,
        hasCredentials: node.credentials ? true : false,
        package: node.package ?? 'n8n-nodes-base',
        developmentStyle: node.developmentStyle ?? 'programmatic'
      }
    };

    // Add tool variant guidance if applicable
    const toolVariantInfo = this.buildToolVariantGuidance(node);
    if (toolVariantInfo) {
      result.toolVariantInfo = toolVariantInfo;
    }

    // Add examples from templates if requested
    if (includeExamples) {
      try {
        // Use the already-computed workflowNodeType from result (line 1888)
        // This ensures consistency with search_nodes behavior (line 1203)
        const examples = this.db!.prepare(`
          SELECT
            parameters_json,
            template_name,
            template_views,
            complexity,
            use_cases,
            has_credentials,
            has_expressions
          FROM template_node_configs
          WHERE node_type = ?
          ORDER BY rank
          LIMIT 3
        `).all(result.workflowNodeType) as any[];

        if (examples.length > 0) {
          (result as any).examples = examples.map((ex: any) => ({
            configuration: JSON.parse(ex.parameters_json),
            source: {
              template: ex.template_name,
              views: ex.template_views,
              complexity: ex.complexity
            },
            useCases: ex.use_cases ? JSON.parse(ex.use_cases).slice(0, 2) : [],
            metadata: {
              hasCredentials: ex.has_credentials === 1,
              hasExpressions: ex.has_expressions === 1
            }
          }));

          (result as any).examplesCount = examples.length;
        } else {
          (result as any).examples = [];
          (result as any).examplesCount = 0;
        }
      } catch (error: any) {
        logger.warn(`Failed to fetch examples for ${nodeType}:`, error.message);
        (result as any).examples = [];
        (result as any).examplesCount = 0;
      }
    }

    // Cache for 1 hour
    this.cache.set(cacheKey, result, 3600);

    return result;
  }

  /**
   * Unified node information retrieval with multiple detail levels and modes.
   *
   * @param nodeType - Full node type identifier (e.g., "nodes-base.httpRequest" or "nodes-langchain.agent")
   * @param detail - Information detail level (minimal, standard, full). Only applies when mode='info'.
   *   - minimal: ~200 tokens, basic metadata only (no version info)
   *   - standard: ~1-2K tokens, essential properties and operations (includes version info, AI-friendly default)
   *   - full: ~3-8K tokens, complete node information with all properties (includes version info)
   * @param mode - Operation mode determining the type of information returned:
   *   - info: Node configuration details (respects detail level)
   *   - versions: Complete version history with breaking changes summary
   *   - compare: Property-level comparison between two versions (requires fromVersion)
   *   - breaking: Breaking changes only between versions (requires fromVersion)
   *   - migrations: Auto-migratable changes between versions (requires both fromVersion and toVersion)
   * @param includeTypeInfo - Include type structure metadata for properties (only applies to mode='info').
   *   Adds ~80-120 tokens per property with type category, JS type, and validation rules.
   * @param includeExamples - Include real-world configuration examples from templates (only applies to mode='info' with detail='standard').
   *   Adds ~200-400 tokens per example.
   * @param fromVersion - Source version for comparison modes (required for compare, breaking, migrations).
   *   Format: "1.0" or "2.1"
   * @param toVersion - Target version for comparison modes (optional for compare/breaking, required for migrations).
   *   Defaults to latest version if omitted.
   * @returns NodeInfoResponse - Union type containing different response structures based on mode and detail parameters
   */
  private async getNode(
    nodeType: string,
    detail: string = 'standard',
    mode: string = 'info',
    includeTypeInfo?: boolean,
    includeExamples?: boolean,
    fromVersion?: string,
    toVersion?: string
  ): Promise<NodeInfoResponse> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Validate parameters
    const validDetailLevels = ['minimal', 'standard', 'full'];
    const validModes = ['info', 'versions', 'compare', 'breaking', 'migrations'];

    if (!validDetailLevels.includes(detail)) {
      throw new Error(`get_node: Invalid detail level "${detail}". Valid options: ${validDetailLevels.join(', ')}`);
    }

    if (!validModes.includes(mode)) {
      throw new Error(`get_node: Invalid mode "${mode}". Valid options: ${validModes.join(', ')}`);
    }

    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);

    // Version modes - detail level ignored
    if (mode !== 'info') {
      return this.handleVersionMode(
        normalizedType,
        mode,
        fromVersion,
        toVersion
      );
    }

    // Info mode - respect detail level
    return this.handleInfoMode(
      normalizedType,
      detail,
      includeTypeInfo,
      includeExamples
    );
  }

  /**
   * Handle info mode - returns node information at specified detail level
   */
  private async handleInfoMode(
    nodeType: string,
    detail: string,
    includeTypeInfo?: boolean,
    includeExamples?: boolean
  ): Promise<NodeMinimalInfo | NodeStandardInfo | NodeFullInfo> {
    switch (detail) {
      case 'minimal': {
        // Get basic node metadata only (no version info for minimal mode)
        let node = this.repository!.getNode(nodeType);

        if (!node) {
          const alternatives = getNodeTypeAlternatives(nodeType);
          for (const alt of alternatives) {
            const found = this.repository!.getNode(alt);
            if (found) {
              node = found;
              break;
            }
          }
        }

        if (!node) {
          throw new Error(`Node ${nodeType} not found`);
        }

        const result: NodeMinimalInfo = {
          nodeType: node.nodeType,
          workflowNodeType: getWorkflowNodeType(node.package ?? 'n8n-nodes-base', node.nodeType),
          displayName: node.displayName,
          description: node.description,
          category: node.category,
          package: node.package,
          isAITool: node.isAITool,
          isTrigger: node.isTrigger,
          isWebhook: node.isWebhook
        };

        // Add tool variant guidance if applicable
        const toolVariantInfo = this.buildToolVariantGuidance(node);
        if (toolVariantInfo) {
          result.toolVariantInfo = toolVariantInfo;
        }

        return result;
      }

      case 'standard': {
        // Use existing getNodeEssentials logic
        const essentials = await this.getNodeEssentials(nodeType, includeExamples);
        const versionSummary = this.getVersionSummary(nodeType);

        // Apply type info enrichment if requested
        if (includeTypeInfo) {
          essentials.requiredProperties = this.enrichPropertiesWithTypeInfo(essentials.requiredProperties);
          essentials.commonProperties = this.enrichPropertiesWithTypeInfo(essentials.commonProperties);
        }

        return {
          ...essentials,
          versionInfo: versionSummary
        };
      }

      case 'full': {
        // Use existing getNodeInfo logic
        const fullInfo = await this.getNodeInfo(nodeType);
        const versionSummary = this.getVersionSummary(nodeType);

        // Apply type info enrichment if requested
        if (includeTypeInfo && fullInfo.properties) {
          fullInfo.properties = this.enrichPropertiesWithTypeInfo(fullInfo.properties);
        }

        return {
          ...fullInfo,
          versionInfo: versionSummary
        };
      }

      default:
        throw new Error(`Unknown detail level: ${detail}`);
    }
  }

  /**
   * Handle version modes - returns version history and comparison data
   */
  private async handleVersionMode(
    nodeType: string,
    mode: string,
    fromVersion?: string,
    toVersion?: string
  ): Promise<VersionHistoryInfo | VersionComparisonInfo> {
    switch (mode) {
      case 'versions':
        return this.getVersionHistory(nodeType);

      case 'compare':
        if (!fromVersion) {
          throw new Error(`get_node: fromVersion is required for compare mode (nodeType: ${nodeType})`);
        }
        return this.compareVersions(nodeType, fromVersion, toVersion);

      case 'breaking':
        if (!fromVersion) {
          throw new Error(`get_node: fromVersion is required for breaking mode (nodeType: ${nodeType})`);
        }
        return this.getBreakingChanges(nodeType, fromVersion, toVersion);

      case 'migrations':
        if (!fromVersion || !toVersion) {
          throw new Error(`get_node: Both fromVersion and toVersion are required for migrations mode (nodeType: ${nodeType})`);
        }
        return this.getMigrations(nodeType, fromVersion, toVersion);

      default:
        throw new Error(`get_node: Unknown mode: ${mode} (nodeType: ${nodeType})`);
    }
  }

  /**
   * Get version summary (always included in info mode responses)
   * Cached for 24 hours to improve performance
   */
  private getVersionSummary(nodeType: string): VersionSummary {
    const cacheKey = `version-summary:${nodeType}`;
    const cached = this.cache.get(cacheKey) as VersionSummary | null;

    if (cached) {
      return cached;
    }

    const versions = this.repository!.getNodeVersions(nodeType);
    const latest = this.repository!.getLatestNodeVersion(nodeType);

    const summary: VersionSummary = {
      currentVersion: latest?.version || 'unknown',
      totalVersions: versions.length,
      hasVersionHistory: versions.length > 0
    };

    // Cache for 24 hours (86400000 ms)
    this.cache.set(cacheKey, summary, 86400000);

    return summary;
  }

  /**
   * Get complete version history for a node
   */
  private getVersionHistory(nodeType: string): any {
    const versions = this.repository!.getNodeVersions(nodeType);

    return {
      nodeType,
      totalVersions: versions.length,
      versions: versions.map(v => ({
        version: v.version,
        isCurrent: v.isCurrentMax,
        minimumN8nVersion: v.minimumN8nVersion,
        releasedAt: v.releasedAt,
        hasBreakingChanges: (v.breakingChanges || []).length > 0,
        breakingChangesCount: (v.breakingChanges || []).length,
        deprecatedProperties: v.deprecatedProperties || [],
        addedProperties: v.addedProperties || []
      })),
      available: versions.length > 0,
      message: versions.length === 0 ?
        'No version history available. Version tracking may not be enabled for this node.' :
        undefined
    };
  }

  /**
   * Compare two versions of a node
   */
  private compareVersions(
    nodeType: string,
    fromVersion: string,
    toVersion?: string
  ): any {
    const latest = this.repository!.getLatestNodeVersion(nodeType);
    const targetVersion = toVersion || latest?.version;

    if (!targetVersion) {
      throw new Error('No target version available');
    }

    const changes = this.repository!.getPropertyChanges(
      nodeType,
      fromVersion,
      targetVersion
    );

    return {
      nodeType,
      fromVersion,
      toVersion: targetVersion,
      totalChanges: changes.length,
      breakingChanges: changes.filter(c => c.isBreaking).length,
      changes: changes.map(c => ({
        property: c.propertyName,
        changeType: c.changeType,
        isBreaking: c.isBreaking,
        severity: c.severity,
        oldValue: c.oldValue,
        newValue: c.newValue,
        migrationHint: c.migrationHint,
        autoMigratable: c.autoMigratable
      }))
    };
  }

  /**
   * Get breaking changes between versions
   */
  private getBreakingChanges(
    nodeType: string,
    fromVersion: string,
    toVersion?: string
  ): any {
    const breakingChanges = this.repository!.getBreakingChanges(
      nodeType,
      fromVersion,
      toVersion
    );

    return {
      nodeType,
      fromVersion,
      toVersion: toVersion || 'latest',
      totalBreakingChanges: breakingChanges.length,
      changes: breakingChanges.map(c => ({
        fromVersion: c.fromVersion,
        toVersion: c.toVersion,
        property: c.propertyName,
        changeType: c.changeType,
        severity: c.severity,
        migrationHint: c.migrationHint,
        oldValue: c.oldValue,
        newValue: c.newValue
      })),
      upgradeSafe: breakingChanges.length === 0
    };
  }

  /**
   * Get auto-migratable changes between versions
   */
  private getMigrations(
    nodeType: string,
    fromVersion: string,
    toVersion: string
  ): any {
    const migrations = this.repository!.getAutoMigratableChanges(
      nodeType,
      fromVersion,
      toVersion
    );

    const allChanges = this.repository!.getPropertyChanges(
      nodeType,
      fromVersion,
      toVersion
    );

    return {
      nodeType,
      fromVersion,
      toVersion,
      autoMigratableChanges: migrations.length,
      totalChanges: allChanges.length,
      migrations: migrations.map(m => ({
        property: m.propertyName,
        changeType: m.changeType,
        migrationStrategy: m.migrationStrategy,
        severity: m.severity
      })),
      requiresManualMigration: migrations.length < allChanges.length
    };
  }

  /**
   * Enrich property with type structure metadata
   */
  private enrichPropertyWithTypeInfo(property: any): any {
    if (!property || !property.type) return property;

    const structure = TypeStructureService.getStructure(property.type);
    if (!structure) return property;

    return {
      ...property,
      typeInfo: {
        category: structure.type,
        jsType: structure.jsType,
        description: structure.description,
        isComplex: TypeStructureService.isComplexType(property.type),
        isPrimitive: TypeStructureService.isPrimitiveType(property.type),
        allowsExpressions: structure.validation?.allowExpressions ?? true,
        allowsEmpty: structure.validation?.allowEmpty ?? false,
        ...(structure.structure && {
          structureHints: {
            hasProperties: !!structure.structure.properties,
            hasItems: !!structure.structure.items,
            isFlexible: structure.structure.flexible ?? false,
            requiredFields: structure.structure.required ?? []
          }
        }),
        ...(structure.notes && { notes: structure.notes })
      }
    };
  }

  /**
   * Enrich an array of properties with type structure metadata
   */
  private enrichPropertiesWithTypeInfo(properties: any[]): any[] {
    if (!properties || !Array.isArray(properties)) return properties;
    return properties.map((prop: any) => this.enrichPropertyWithTypeInfo(prop));
  }

  private async searchNodeProperties(nodeType: string, query: string, maxResults: number = 20): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get the node
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties and search (already parsed by repository)
    const allProperties = node.properties || [];
    const matches = PropertyFilter.searchProperties(allProperties, query, maxResults);
    
    return {
      nodeType: node.nodeType,
      query,
      matches: matches.map((match: any) => ({
        name: match.name,
        displayName: match.displayName,
        type: match.type,
        description: match.description,
        path: match.path || match.name,
        required: match.required,
        default: match.default,
        options: match.options,
        showWhen: match.showWhen
      })),
      totalMatches: matches.length,
      searchedIn: allProperties.length + ' properties'
    };
  }

  private getPropertyValue(config: any, path: string): any {
    const parts = path.split('.');
    let value = config;
    
    for (const part of parts) {
      // Handle array notation like parameters[0]
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        value = value?.[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
      } else {
        value = value?.[part];
      }
    }
    
    return value;
  }
  
  private async listTasks(category?: string): Promise<any> {
    if (category) {
      const categories = TaskTemplates.getTaskCategories();
      const tasks = categories[category];
      
      if (!tasks) {
        throw new Error(
          `Unknown category: ${category}. Available categories: ${Object.keys(categories).join(', ')}`
        );
      }
      
      return {
        category,
        tasks: tasks.map(task => {
          const template = TaskTemplates.getTaskTemplate(task);
          return {
            task,
            description: template?.description || '',
            nodeType: template?.nodeType || ''
          };
        })
      };
    }
    
    // Return all tasks grouped by category
    const categories = TaskTemplates.getTaskCategories();
    const result: any = {
      totalTasks: TaskTemplates.getAllTasks().length,
      categories: {}
    };
    
    for (const [cat, tasks] of Object.entries(categories)) {
      result.categories[cat] = tasks.map(task => {
        const template = TaskTemplates.getTaskTemplate(task);
        return {
          task,
          description: template?.description || '',
          nodeType: template?.nodeType || ''
        };
      });
    }
    
    return result;
  }
  
  private async validateNodeConfig(
    nodeType: string, 
    config: Record<string, any>, 
    mode: ValidationMode = 'operation',
    profile: ValidationProfile = 'ai-friendly'
  ): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info to access properties
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);

    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }

    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties
    const properties = node.properties || [];

    // Add @version to config for displayOptions evaluation (supports _cnd operators)
    const configWithVersion = {
      '@version': node.version || 1,
      ...config
    };

    // Use enhanced validator with operation mode by default
    const validationResult = EnhancedConfigValidator.validateWithMode(
      node.nodeType,
      configWithVersion,
      properties,
      mode,
      profile
    );
    
    // Add node context to result
    return {
      nodeType: node.nodeType,
      workflowNodeType: getWorkflowNodeType(node.package, node.nodeType),
      displayName: node.displayName,
      ...validationResult,
      summary: {
        hasErrors: !validationResult.valid,
        errorCount: validationResult.errors.length,
        warningCount: validationResult.warnings.length,
        suggestionCount: validationResult.suggestions.length
      }
    };
  }
  
  private async getPropertyDependencies(nodeType: string, config?: Record<string, any>): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info to access properties
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties
    const properties = node.properties || [];
    
    // Analyze dependencies
    const analysis = PropertyDependencies.analyze(properties);
    
    // If config provided, check visibility impact
    let visibilityImpact = null;
    if (config) {
      visibilityImpact = PropertyDependencies.getVisibilityImpact(properties, config);
    }
    
    return {
      nodeType: node.nodeType,
      displayName: node.displayName,
      ...analysis,
      currentConfig: config ? {
        providedValues: config,
        visibilityImpact
      } : undefined
    };
  }
  
  private async getNodeAsToolInfo(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Determine common AI tool use cases based on node type
    const commonUseCases = this.getCommonAIToolUseCases(node.nodeType);
    
    // Build AI tool capabilities info
    const aiToolCapabilities = {
      canBeUsedAsTool: true, // In n8n, ANY node can be used as a tool when connected to AI Agent
      hasUsableAsToolProperty: node.isAITool,
      requiresEnvironmentVariable: !node.isAITool && node.package !== 'n8n-nodes-base',
      connectionType: 'ai_tool',
      commonUseCases,
      requirements: {
        connection: 'Connect to the "ai_tool" port of an AI Agent node',
        environment: node.package !== 'n8n-nodes-base' ? 
          'Set N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true for community nodes' : 
          'No special environment variables needed for built-in nodes'
      },
      examples: this.getAIToolExamples(node.nodeType),
      tips: [
        'Give the tool a clear, descriptive name in the AI Agent settings',
        'Write a detailed tool description to help the AI understand when to use it',
        'Test the node independently before connecting it as a tool',
        node.isAITool ? 
          'This node is optimized for AI tool usage' : 
          'This is a regular node that can be used as an AI tool'
      ]
    };
    
    return {
      nodeType: node.nodeType,
      workflowNodeType: getWorkflowNodeType(node.package, node.nodeType),
      displayName: node.displayName,
      description: node.description,
      package: node.package,
      isMarkedAsAITool: node.isAITool,
      aiToolCapabilities
    };
  }
  
  private getOutputDescriptions(nodeType: string, outputName: string, index: number): { description: string, connectionGuidance: string } {
    // Special handling for loop nodes
    if (nodeType === 'nodes-base.splitInBatches') {
      if (outputName === 'done' && index === 0) {
        return {
          description: 'Final processed data after all iterations complete',
          connectionGuidance: 'Connect to nodes that should run AFTER the loop completes'
        };
      } else if (outputName === 'loop' && index === 1) {
        return {
          description: 'Current batch data for this iteration',
          connectionGuidance: 'Connect to nodes that process items INSIDE the loop (and connect their output back to this node)'
        };
      }
    }
    
    // Special handling for IF node
    if (nodeType === 'nodes-base.if') {
      if (outputName === 'true' && index === 0) {
        return {
          description: 'Items that match the condition',
          connectionGuidance: 'Connect to nodes that handle the TRUE case'
        };
      } else if (outputName === 'false' && index === 1) {
        return {
          description: 'Items that do not match the condition',
          connectionGuidance: 'Connect to nodes that handle the FALSE case'
        };
      }
    }
    
    // Special handling for Switch node
    if (nodeType === 'nodes-base.switch') {
      return {
        description: `Output ${index}: ${outputName || 'Route ' + index}`,
        connectionGuidance: `Connect to nodes for the "${outputName || 'route ' + index}" case`
      };
    }
    
    // Default handling
    return {
      description: outputName || `Output ${index}`,
      connectionGuidance: `Connect to downstream nodes`
    };
  }

  private getCommonAIToolUseCases(nodeType: string): string[] {
    const useCaseMap: Record<string, string[]> = {
      'nodes-base.slack': [
        'Send notifications about task completion',
        'Post updates to channels',
        'Send direct messages',
        'Create alerts and reminders'
      ],
      'nodes-base.googleSheets': [
        'Read data for analysis',
        'Log results and outputs',
        'Update spreadsheet records',
        'Create reports'
      ],
      'nodes-base.gmail': [
        'Send email notifications',
        'Read and process emails',
        'Send reports and summaries',
        'Handle email-based workflows'
      ],
      'nodes-base.httpRequest': [
        'Call external APIs',
        'Fetch data from web services',
        'Send webhooks',
        'Integrate with any REST API'
      ],
      'nodes-base.postgres': [
        'Query database for information',
        'Store analysis results',
        'Update records based on AI decisions',
        'Generate reports from data'
      ],
      'nodes-base.webhook': [
        'Receive external triggers',
        'Create callback endpoints',
        'Handle incoming data',
        'Integrate with external systems'
      ]
    };
    
    // Check for partial matches
    for (const [key, useCases] of Object.entries(useCaseMap)) {
      if (nodeType.includes(key)) {
        return useCases;
      }
    }
    
    // Generic use cases for unknown nodes
    return [
      'Perform automated actions',
      'Integrate with external services',
      'Process and transform data',
      'Extend AI agent capabilities'
    ];
  }

  /**
   * Build tool variant guidance for node responses.
   * Provides cross-reference information between base nodes and their Tool variants.
   */
  private buildToolVariantGuidance(node: any): ToolVariantGuidance | undefined {
    const isToolVariant = !!node.isToolVariant;
    const hasToolVariant = !!node.hasToolVariant;
    const toolVariantOf = node.toolVariantOf;

    // If this is neither a Tool variant nor has one, no guidance needed
    if (!isToolVariant && !hasToolVariant) {
      return undefined;
    }

    if (isToolVariant) {
      // This IS a Tool variant (e.g., nodes-base.supabaseTool)
      return {
        isToolVariant: true,
        toolVariantOf,
        hasToolVariant: false,
        guidance: `This is the Tool variant for AI Agent integration. Use this node type when connecting to AI Agents. The base node is: ${toolVariantOf}`
      };
    }

    if (hasToolVariant && node.nodeType) {
      // This base node HAS a Tool variant (e.g., nodes-base.supabase)
      const toolVariantNodeType = `${node.nodeType}Tool`;
      return {
        isToolVariant: false,
        hasToolVariant: true,
        toolVariantNodeType,
        guidance: `To use this node with AI Agents, use the Tool variant: ${toolVariantNodeType}. The Tool variant has an additional 'toolDescription' property and outputs 'ai_tool' instead of 'main'.`
      };
    }

    return undefined;
  }

  private getAIToolExamples(nodeType: string): any {
    const exampleMap: Record<string, any> = {
      'nodes-base.slack': {
        toolName: 'Send Slack Message',
        toolDescription: 'Sends a message to a specified Slack channel or user. Use this to notify team members about important events or results.',
        nodeConfig: {
          resource: 'message',
          operation: 'post',
          channel: '={{ $fromAI("channel", "The Slack channel to send to, e.g. #general") }}',
          text: '={{ $fromAI("message", "The message content to send") }}'
        }
      },
      'nodes-base.googleSheets': {
        toolName: 'Update Google Sheet',
        toolDescription: 'Reads or updates data in a Google Sheets spreadsheet. Use this to log information, retrieve data, or update records.',
        nodeConfig: {
          operation: 'append',
          sheetId: 'your-sheet-id',
          range: 'A:Z',
          dataMode: 'autoMap'
        }
      },
      'nodes-base.httpRequest': {
        toolName: 'Call API',
        toolDescription: 'Makes HTTP requests to external APIs. Use this to fetch data, trigger webhooks, or integrate with any web service.',
        nodeConfig: {
          method: '={{ $fromAI("method", "HTTP method: GET, POST, PUT, DELETE") }}',
          url: '={{ $fromAI("url", "The complete API endpoint URL") }}',
          sendBody: true,
          bodyContentType: 'json',
          jsonBody: '={{ $fromAI("body", "Request body as JSON object") }}'
        }
      }
    };
    
    // Check for exact match or partial match
    for (const [key, example] of Object.entries(exampleMap)) {
      if (nodeType.includes(key)) {
        return example;
      }
    }
    
    // Generic example
    return {
      toolName: 'Custom Tool',
      toolDescription: 'Performs specific operations. Describe what this tool does and when to use it.',
      nodeConfig: {
        note: 'Configure the node based on its specific requirements'
      }
    };
  }
  
  private async validateNodeMinimal(nodeType: string, config: Record<string, any>): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties
    const properties = node.properties || [];

    // Add @version to config for displayOptions evaluation (supports _cnd operators)
    const configWithVersion = {
      '@version': node.version || 1,
      ...(config || {})
    };

    // Find missing required fields
    const missingFields: string[] = [];

    for (const prop of properties) {
      // Skip if not required
      if (!prop.required) continue;

      // Skip if not visible based on current config (uses ConfigValidator for _cnd support)
      if (prop.displayOptions && !ConfigValidator.isPropertyVisible(prop, configWithVersion)) {
        continue;
      }

      // Check if field is missing (safely handle null/undefined config)
      if (!config || !(prop.name in config)) {
        missingFields.push(prop.displayName || prop.name);
      }
    }
    
    return {
      nodeType: node.nodeType,
      displayName: node.displayName,
      valid: missingFields.length === 0,
      missingRequiredFields: missingFields
    };
  }

  // Method removed - replaced by getToolsDocumentation

  private async getToolsDocumentation(topic?: string, depth: 'essentials' | 'full' = 'essentials'): Promise<string> {
    if (!topic || topic === 'overview') {
      return getToolsOverview(depth);
    }
    
    return getToolDocumentation(topic, depth);
  }

  // Add connect method to accept any transport
  async connect(transport: any): Promise<void> {
    await this.ensureInitialized();
    await this.server.connect(transport);
    logger.info('MCP Server connected', { 
      transportType: transport.constructor.name 
    });
  }
  
  // Template-related methods
  private async listTemplates(limit: number = 10, offset: number = 0, sortBy: 'views' | 'created_at' | 'name' = 'views', includeMetadata: boolean = false): Promise<any> {
    await this.ensureInitialized();
    if (!this.templateService) throw new Error('Template service not initialized');
    
    const result = await this.templateService.listTemplates(limit, offset, sortBy, includeMetadata);
    
    return {
      ...result,
      tip: result.items.length > 0 ? 
        `Use get_template(templateId) to get full workflow details. Total: ${result.total} templates available.` :
        "No templates found. Run 'npm run fetch:templates' to update template database"
    };
  }
  
  private async listNodeTemplates(nodeTypes: string[], limit: number = 10, offset: number = 0): Promise<any> {
    await this.ensureInitialized();
    if (!this.templateService) throw new Error('Template service not initialized');
    
    const result = await this.templateService.listNodeTemplates(nodeTypes, limit, offset);
    
    if (result.items.length === 0 && offset === 0) {
      return {
        ...result,
        message: `No templates found using nodes: ${nodeTypes.join(', ')}`,
        tip: "Try searching with more common nodes or run 'npm run fetch:templates' to update template database"
      };
    }
    
    return {
      ...result,
      tip: `Showing ${result.items.length} of ${result.total} templates. Use offset for pagination.`
    };
  }
  
  private async getTemplate(templateId: number, mode: 'nodes_only' | 'structure' | 'full' = 'full'): Promise<any> {
    await this.ensureInitialized();
    if (!this.templateService) throw new Error('Template service not initialized');
    
    const template = await this.templateService.getTemplate(templateId, mode);
    
    if (!template) {
      return {
        error: `Template ${templateId} not found`,
        tip: "Use list_templates, list_node_templates or search_templates to find available templates"
      };
    }
    
    const usage = mode === 'nodes_only' ? "Node list for quick overview" :
                  mode === 'structure' ? "Workflow structure without full details" :
                  "Complete workflow JSON ready to import into n8n";
    
    return {
      mode,
      template,
      usage
    };
  }
  
  private async searchTemplates(query: string, limit: number = 20, offset: number = 0, fields?: string[]): Promise<any> {
    await this.ensureInitialized();
    if (!this.templateService) throw new Error('Template service not initialized');
    
    const result = await this.templateService.searchTemplates(query, limit, offset, fields);
    
    if (result.items.length === 0 && offset === 0) {
      return {
        ...result,
        message: `No templates found matching: "${query}"`,
        tip: "Try different keywords or run 'npm run fetch:templates' to update template database"
      };
    }
    
    return {
      ...result,
      query,
      tip: `Found ${result.total} templates matching "${query}". Showing ${result.items.length}.`
    };
  }
  
  private async getTemplatesForTask(task: string, limit: number = 10, offset: number = 0): Promise<any> {
    await this.ensureInitialized();
    if (!this.templateService) throw new Error('Template service not initialized');
    
    const result = await this.templateService.getTemplatesForTask(task, limit, offset);
    const availableTasks = this.templateService.listAvailableTasks();
    
    if (result.items.length === 0 && offset === 0) {
      return {
        ...result,
        message: `No templates found for task: ${task}`,
        availableTasks,
        tip: "Try a different task or use search_templates for custom searches"
      };
    }
    
    return {
      ...result,
      task,
      description: this.getTaskDescription(task),
      tip: `${result.total} templates available for ${task}. Showing ${result.items.length}.`
    };
  }
  
  private async searchTemplatesByMetadata(filters: {
    category?: string;
    complexity?: 'simple' | 'medium' | 'complex';
    maxSetupMinutes?: number;
    minSetupMinutes?: number;
    requiredService?: string;
    targetAudience?: string;
  }, limit: number = 20, offset: number = 0): Promise<any> {
    await this.ensureInitialized();
    if (!this.templateService) throw new Error('Template service not initialized');
    
    const result = await this.templateService.searchTemplatesByMetadata(filters, limit, offset);
    
    // Build filter summary for feedback
    const filterSummary: string[] = [];
    if (filters.category) filterSummary.push(`category: ${filters.category}`);
    if (filters.complexity) filterSummary.push(`complexity: ${filters.complexity}`);
    if (filters.maxSetupMinutes) filterSummary.push(`max setup: ${filters.maxSetupMinutes} min`);
    if (filters.minSetupMinutes) filterSummary.push(`min setup: ${filters.minSetupMinutes} min`);
    if (filters.requiredService) filterSummary.push(`service: ${filters.requiredService}`);
    if (filters.targetAudience) filterSummary.push(`audience: ${filters.targetAudience}`);
    
    if (result.items.length === 0 && offset === 0) {
      // Get available categories and audiences for suggestions
      const availableCategories = await this.templateService.getAvailableCategories();
      const availableAudiences = await this.templateService.getAvailableTargetAudiences();
      
      return {
        ...result,
        message: `No templates found with filters: ${filterSummary.join(', ')}`,
        availableCategories: availableCategories.slice(0, 10),
        availableAudiences: availableAudiences.slice(0, 5),
        tip: "Try broader filters or different categories. Use list_templates to see all templates."
      };
    }
    
    return {
      ...result,
      filters,
      filterSummary: filterSummary.join(', '),
      tip: `Found ${result.total} templates matching filters. Showing ${result.items.length}. Each includes AI-generated metadata.`
    };
  }
  
  private getTaskDescription(task: string): string {
    const descriptions: Record<string, string> = {
      'ai_automation': 'AI-powered workflows using OpenAI, LangChain, and other AI tools',
      'data_sync': 'Synchronize data between databases, spreadsheets, and APIs',
      'webhook_processing': 'Process incoming webhooks and trigger automated actions',
      'email_automation': 'Send, receive, and process emails automatically',
      'slack_integration': 'Integrate with Slack for notifications and bot interactions',
      'data_transformation': 'Transform, clean, and manipulate data',
      'file_processing': 'Handle file uploads, downloads, and transformations',
      'scheduling': 'Schedule recurring tasks and time-based automations',
      'api_integration': 'Connect to external APIs and web services',
      'database_operations': 'Query, insert, update, and manage database records'
    };
    
    return descriptions[task] || 'Workflow templates for this task';
  }

  private async validateWorkflow(workflow: any, options?: any): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    
    // Enhanced logging for workflow validation
    logger.info('Workflow validation requested', {
      hasWorkflow: !!workflow,
      workflowType: typeof workflow,
      hasNodes: workflow?.nodes !== undefined,
      nodesType: workflow?.nodes ? typeof workflow.nodes : 'undefined',
      nodesIsArray: Array.isArray(workflow?.nodes),
      nodesCount: Array.isArray(workflow?.nodes) ? workflow.nodes.length : 0,
      hasConnections: workflow?.connections !== undefined,
      connectionsType: workflow?.connections ? typeof workflow.connections : 'undefined',
      options: options
    });
    
    // Help n8n AI agents with common mistakes
    if (!workflow || typeof workflow !== 'object') {
      return {
        valid: false,
        errors: [{
          node: 'workflow',
          message: 'Workflow must be an object with nodes and connections',
          details: 'Expected format: ' + getWorkflowExampleString()
        }],
        summary: { errorCount: 1 }
      };
    }
    
    if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
      return {
        valid: false,
        errors: [{
          node: 'workflow',
          message: 'Workflow must have a nodes array',
          details: 'Expected: workflow.nodes = [array of node objects]. ' + getWorkflowExampleString()
        }],
        summary: { errorCount: 1 }
      };
    }
    
    if (!workflow.connections || typeof workflow.connections !== 'object') {
      return {
        valid: false,
        errors: [{
          node: 'workflow',
          message: 'Workflow must have a connections object',
          details: 'Expected: workflow.connections = {} (can be empty object). ' + getWorkflowExampleString()
        }],
        summary: { errorCount: 1 }
      };
    }
    
    // Create workflow validator instance
    const validator = new WorkflowValidator(
      this.repository,
      EnhancedConfigValidator
    );
    
    try {
      const result = await validator.validateWorkflow(workflow, options);
      
      // Format the response for better readability
      const response: any = {
        valid: result.valid,
        summary: {
          totalNodes: result.statistics.totalNodes,
          enabledNodes: result.statistics.enabledNodes,
          triggerNodes: result.statistics.triggerNodes,
          validConnections: result.statistics.validConnections,
          invalidConnections: result.statistics.invalidConnections,
          expressionsValidated: result.statistics.expressionsValidated,
          errorCount: result.errors.length,
          warningCount: result.warnings.length
        },
        // Always include errors and warnings arrays for consistent API response
        errors: result.errors.map(e => ({
          node: e.nodeName || 'workflow',
          message: e.message,
          details: e.details
        })),
        warnings: result.warnings.map(w => ({
          node: w.nodeName || 'workflow',
          message: w.message,
          details: w.details
        }))
      };
      
      if (result.suggestions.length > 0) {
        response.suggestions = result.suggestions;
      }

      // Track validation details in telemetry
      if (!result.valid && result.errors.length > 0) {
        // Track each validation error for analysis
        result.errors.forEach(error => {
          telemetry.trackValidationDetails(
            error.nodeName || 'workflow',
            error.type || 'validation_error',
            {
              message: error.message,
              nodeCount: workflow.nodes?.length ?? 0,
              hasConnections: Object.keys(workflow.connections || {}).length > 0
            }
          );
        });
      }

      // Track successfully validated workflows in telemetry
      if (result.valid) {
        telemetry.trackWorkflowCreation(workflow, true);
      }

      return response;
    } catch (error) {
      logger.error('Error validating workflow:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error validating workflow',
        tip: 'Ensure the workflow JSON includes nodes array and connections object'
      };
    }
  }

  private async validateWorkflowConnections(workflow: any): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    
    // Create workflow validator instance
    const validator = new WorkflowValidator(
      this.repository,
      EnhancedConfigValidator
    );
    
    try {
      // Validate only connections
      const result = await validator.validateWorkflow(workflow, {
        validateNodes: false,
        validateConnections: true,
        validateExpressions: false
      });
      
      const response: any = {
        valid: result.errors.length === 0,
        statistics: {
          totalNodes: result.statistics.totalNodes,
          triggerNodes: result.statistics.triggerNodes,
          validConnections: result.statistics.validConnections,
          invalidConnections: result.statistics.invalidConnections
        }
      };
      
      // Filter to only connection-related issues
      const connectionErrors = result.errors.filter(e => 
        e.message.includes('connection') || 
        e.message.includes('cycle') ||
        e.message.includes('orphaned')
      );
      
      const connectionWarnings = result.warnings.filter(w => 
        w.message.includes('connection') || 
        w.message.includes('orphaned') ||
        w.message.includes('trigger')
      );
      
      if (connectionErrors.length > 0) {
        response.errors = connectionErrors.map(e => ({
          node: e.nodeName || 'workflow',
          message: e.message
        }));
      }
      
      if (connectionWarnings.length > 0) {
        response.warnings = connectionWarnings.map(w => ({
          node: w.nodeName || 'workflow',
          message: w.message
        }));
      }
      
      return response;
    } catch (error) {
      logger.error('Error validating workflow connections:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error validating connections'
      };
    }
  }

  private async validateWorkflowExpressions(workflow: any): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    
    // Create workflow validator instance
    const validator = new WorkflowValidator(
      this.repository,
      EnhancedConfigValidator
    );
    
    try {
      // Validate only expressions
      const result = await validator.validateWorkflow(workflow, {
        validateNodes: false,
        validateConnections: false,
        validateExpressions: true
      });
      
      const response: any = {
        valid: result.errors.length === 0,
        statistics: {
          totalNodes: result.statistics.totalNodes,
          expressionsValidated: result.statistics.expressionsValidated
        }
      };
      
      // Filter to only expression-related issues
      const expressionErrors = result.errors.filter(e => 
        e.message.includes('Expression') || 
        e.message.includes('$') ||
        e.message.includes('{{')
      );
      
      const expressionWarnings = result.warnings.filter(w => 
        w.message.includes('Expression') || 
        w.message.includes('$') ||
        w.message.includes('{{')
      );
      
      if (expressionErrors.length > 0) {
        response.errors = expressionErrors.map(e => ({
          node: e.nodeName || 'workflow',
          message: e.message
        }));
      }
      
      if (expressionWarnings.length > 0) {
        response.warnings = expressionWarnings.map(w => ({
          node: w.nodeName || 'workflow',
          message: w.message
        }));
      }
      
      // Add tips for common expression issues
      if (expressionErrors.length > 0 || expressionWarnings.length > 0) {
        response.tips = [
          'Use {{ }} to wrap expressions',
          'Reference data with $json.propertyName',
          'Reference other nodes with $node["Node Name"].json',
          'Use $input.item for input data in loops'
        ];
      }
      
      return response;
    } catch (error) {
      logger.error('Error validating workflow expressions:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error validating expressions'
      };
    }
  }

  async run(): Promise<void> {
    // Ensure database is initialized before starting server
    await this.ensureInitialized();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Force flush stdout for Docker environments
    // Docker uses block buffering which can delay MCP responses
    if (!process.stdout.isTTY || process.env.IS_DOCKER) {
      // Override write to auto-flush
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = function(chunk: any, encoding?: any, callback?: any) {
        const result = originalWrite(chunk, encoding, callback);
        // Force immediate flush
        process.stdout.emit('drain');
        return result;
      };
    }
    
    logger.info('n8n Documentation MCP Server running on stdio transport');
    
    // Keep the process alive and listening
    process.stdin.resume();
  }
  
  async shutdown(): Promise<void> {
    // Prevent double-shutdown
    if (this.isShutdown) {
      logger.debug('Shutdown already called, skipping');
      return;
    }
    this.isShutdown = true;

    logger.info('Shutting down MCP server...');

    // Wait for initialization to complete (or fail) before cleanup
    // This prevents race conditions where shutdown runs while init is in progress
    try {
      await this.initialized;
    } catch (error) {
      // Initialization failed - that's OK, we still need to clean up
      logger.debug('Initialization had failed, proceeding with cleanup', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Close MCP server connection (for consistency with close() method)
    try {
      await this.server.close();
    } catch (error) {
      logger.error('Error closing MCP server:', error);
    }

    // Clean up cache timers to prevent memory leaks
    if (this.cache) {
      try {
        this.cache.destroy();
        logger.info('Cache timers cleaned up');
      } catch (error) {
        logger.error('Error cleaning up cache:', error);
      }
    }

    // Handle database cleanup based on whether it's shared or dedicated
    // For shared databases, we only release the reference (decrement refCount)
    // For dedicated databases (in-memory for tests), we close the connection
    if (this.useSharedDatabase && this.sharedDbState) {
      try {
        releaseSharedDatabase(this.sharedDbState);
        logger.info('Released shared database reference');
      } catch (error) {
        logger.error('Error releasing shared database:', error);
      }
    } else if (this.db) {
      try {
        this.db.close();
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database:', error);
      }
    }

    // Null out references to help garbage collection
    this.db = null;
    this.repository = null;
    this.templateService = null;
    this.earlyLogger = null;
    this.sharedDbState = null;
  }
}