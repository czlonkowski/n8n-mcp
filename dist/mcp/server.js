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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.N8NDocumentationMCPServer = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const tools_1 = require("./tools");
const tools_n8n_manager_1 = require("./tools-n8n-manager");
const tools_n8n_friendly_1 = require("./tools-n8n-friendly");
const workflow_examples_1 = require("./workflow-examples");
const logger_1 = require("../utils/logger");
const node_repository_1 = require("../database/node-repository");
const database_adapter_1 = require("../database/database-adapter");
const shared_database_1 = require("../database/shared-database");
const property_filter_1 = require("../services/property-filter");
const task_templates_1 = require("../services/task-templates");
const config_validator_1 = require("../services/config-validator");
const enhanced_config_validator_1 = require("../services/enhanced-config-validator");
const property_dependencies_1 = require("../services/property-dependencies");
const type_structure_service_1 = require("../services/type-structure-service");
const simple_cache_1 = require("../utils/simple-cache");
const template_service_1 = require("../templates/template-service");
const workflow_validator_1 = require("../services/workflow-validator");
const n8n_api_1 = require("../config/n8n-api");
const n8nHandlers = __importStar(require("./handlers-n8n-manager"));
const handlers_workflow_diff_1 = require("./handlers-workflow-diff");
const tools_documentation_1 = require("./tools-documentation");
const version_1 = require("../utils/version");
const node_utils_1 = require("../utils/node-utils");
const node_type_normalizer_1 = require("../utils/node-type-normalizer");
const validation_schemas_1 = require("../utils/validation-schemas");
const protocol_version_1 = require("../utils/protocol-version");
const telemetry_1 = require("../telemetry");
const startup_checkpoints_1 = require("../telemetry/startup-checkpoints");
class N8NDocumentationMCPServer {
    constructor(instanceContext, earlyLogger) {
        this.db = null;
        this.repository = null;
        this.templateService = null;
        this.cache = new simple_cache_1.SimpleCache();
        this.clientInfo = null;
        this.previousTool = null;
        this.previousToolTimestamp = Date.now();
        this.earlyLogger = null;
        this.disabledToolsCache = null;
        this.useSharedDatabase = false;
        this.sharedDbState = null;
        this.isShutdown = false;
        this.dbHealthChecked = false;
        this.instanceContext = instanceContext;
        this.earlyLogger = earlyLogger || null;
        const envDbPath = process.env.NODE_DB_PATH;
        let dbPath = null;
        let possiblePaths = [];
        if (envDbPath && (envDbPath === ':memory:' || (0, fs_1.existsSync)(envDbPath))) {
            dbPath = envDbPath;
        }
        else {
            possiblePaths = [
                path_1.default.join(process.cwd(), 'data', 'nodes.db'),
                path_1.default.join(__dirname, '../../data', 'nodes.db'),
                './data/nodes.db'
            ];
            for (const p of possiblePaths) {
                if ((0, fs_1.existsSync)(p)) {
                    dbPath = p;
                    break;
                }
            }
        }
        if (!dbPath) {
            logger_1.logger.error('Database not found in any of the expected locations:', possiblePaths);
            throw new Error('Database nodes.db not found. Please run npm run rebuild first.');
        }
        this.initialized = this.initializeDatabase(dbPath).then(() => {
            if (this.earlyLogger) {
                this.earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.N8N_API_CHECKING);
            }
            const apiConfigured = (0, n8n_api_1.isN8nApiConfigured)();
            const totalTools = apiConfigured ?
                tools_1.n8nDocumentationToolsFinal.length + tools_n8n_manager_1.n8nManagementTools.length :
                tools_1.n8nDocumentationToolsFinal.length;
            logger_1.logger.info(`MCP server initialized with ${totalTools} tools (n8n API: ${apiConfigured ? 'configured' : 'not configured'})`);
            if (this.earlyLogger) {
                this.earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.N8N_API_READY);
            }
        });
        logger_1.logger.info('Initializing n8n Documentation MCP server');
        this.server = new index_js_1.Server({
            name: 'n8n-documentation-mcp',
            version: version_1.PROJECT_VERSION,
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
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
    }
    async close() {
        try {
            await this.initialized;
        }
        catch (error) {
            logger_1.logger.debug('Initialization had failed, proceeding with cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        try {
            await this.server.close();
            this.cache.destroy();
            if (this.useSharedDatabase && this.sharedDbState) {
                (0, shared_database_1.releaseSharedDatabase)(this.sharedDbState);
                logger_1.logger.debug('Released shared database reference');
            }
            else if (this.db) {
                try {
                    this.db.close();
                }
                catch (dbError) {
                    logger_1.logger.warn('Error closing database', {
                        error: dbError instanceof Error ? dbError.message : String(dbError)
                    });
                }
            }
            this.db = null;
            this.repository = null;
            this.templateService = null;
            this.earlyLogger = null;
            this.sharedDbState = null;
        }
        catch (error) {
            logger_1.logger.warn('Error closing MCP server', { error: error instanceof Error ? error.message : String(error) });
        }
    }
    async initializeDatabase(dbPath) {
        try {
            if (this.earlyLogger) {
                this.earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.DATABASE_CONNECTING);
            }
            logger_1.logger.debug('Database initialization starting...', { dbPath });
            if (dbPath === ':memory:') {
                this.db = await (0, database_adapter_1.createDatabaseAdapter)(dbPath);
                logger_1.logger.debug('Database adapter created (in-memory mode)');
                await this.initializeInMemorySchema();
                logger_1.logger.debug('In-memory schema initialized');
                this.repository = new node_repository_1.NodeRepository(this.db);
                this.templateService = new template_service_1.TemplateService(this.db);
                enhanced_config_validator_1.EnhancedConfigValidator.initializeSimilarityServices(this.repository);
                this.useSharedDatabase = false;
            }
            else {
                const sharedState = await (0, shared_database_1.getSharedDatabase)(dbPath);
                this.db = sharedState.db;
                this.repository = sharedState.repository;
                this.templateService = sharedState.templateService;
                this.sharedDbState = sharedState;
                this.useSharedDatabase = true;
                logger_1.logger.debug('Using shared database connection');
            }
            logger_1.logger.debug('Node repository initialized');
            logger_1.logger.debug('Template service initialized');
            logger_1.logger.debug('Similarity services initialized');
            if (this.earlyLogger) {
                this.earlyLogger.logCheckpoint(startup_checkpoints_1.STARTUP_CHECKPOINTS.DATABASE_CONNECTED);
            }
            logger_1.logger.info(`Database initialized successfully from: ${dbPath}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize database:', error);
            throw new Error(`Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async initializeInMemorySchema() {
        if (!this.db)
            return;
        const schemaPath = path_1.default.join(__dirname, '../../src/database/schema.sql');
        const schema = await fs_1.promises.readFile(schemaPath, 'utf-8');
        const statements = this.parseSQLStatements(schema);
        for (const statement of statements) {
            if (statement.trim()) {
                try {
                    this.db.exec(statement);
                }
                catch (error) {
                    logger_1.logger.error(`Failed to execute SQL statement: ${statement.substring(0, 100)}...`, error);
                    throw error;
                }
            }
        }
    }
    parseSQLStatements(sql) {
        const statements = [];
        let current = '';
        let inBlock = false;
        const lines = sql.split('\n');
        for (const line of lines) {
            const trimmed = line.trim().toUpperCase();
            if (trimmed.startsWith('--') || trimmed === '') {
                continue;
            }
            if (trimmed.includes('BEGIN')) {
                inBlock = true;
            }
            current += line + '\n';
            if (inBlock && trimmed === 'END;') {
                statements.push(current.trim());
                current = '';
                inBlock = false;
                continue;
            }
            if (!inBlock && trimmed.endsWith(';')) {
                statements.push(current.trim());
                current = '';
            }
        }
        if (current.trim()) {
            statements.push(current.trim());
        }
        return statements.filter(s => s.length > 0);
    }
    async ensureInitialized() {
        await this.initialized;
        if (!this.db || !this.repository) {
            throw new Error('Database not initialized');
        }
        if (!this.dbHealthChecked) {
            await this.validateDatabaseHealth();
            this.dbHealthChecked = true;
        }
    }
    async validateDatabaseHealth() {
        if (!this.db)
            return;
        try {
            const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get();
            if (nodeCount.count === 0) {
                logger_1.logger.error('CRITICAL: Database is empty - no nodes found! Please run: npm run rebuild');
                throw new Error('Database is empty. Run "npm run rebuild" to populate node data.');
            }
            try {
                const ftsExists = this.db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name='nodes_fts'
        `).get();
                if (!ftsExists) {
                    logger_1.logger.warn('FTS5 table missing - search performance will be degraded. Please run: npm run rebuild');
                }
                else {
                    const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();
                    if (ftsCount.count === 0) {
                        logger_1.logger.warn('FTS5 index is empty - search will not work properly. Please run: npm run rebuild');
                    }
                }
            }
            catch (ftsError) {
                logger_1.logger.warn('FTS5 not available - using fallback search. For better performance, ensure better-sqlite3 is properly installed.');
            }
            logger_1.logger.info(`Database health check passed: ${nodeCount.count} nodes loaded`);
        }
        catch (error) {
            logger_1.logger.error('Database health check failed:', error);
            throw error;
        }
    }
    getDisabledTools() {
        if (this.disabledToolsCache !== null) {
            return this.disabledToolsCache;
        }
        let disabledToolsEnv = process.env.DISABLED_TOOLS || '';
        if (!disabledToolsEnv) {
            this.disabledToolsCache = new Set();
            return this.disabledToolsCache;
        }
        if (disabledToolsEnv.length > 10000) {
            logger_1.logger.warn(`DISABLED_TOOLS environment variable too long (${disabledToolsEnv.length} chars), truncating to 10000`);
            disabledToolsEnv = disabledToolsEnv.substring(0, 10000);
        }
        let tools = disabledToolsEnv
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);
        if (tools.length > 200) {
            logger_1.logger.warn(`DISABLED_TOOLS contains ${tools.length} tools, limiting to first 200`);
            tools = tools.slice(0, 200);
        }
        if (tools.length > 0) {
            logger_1.logger.info(`Disabled tools configured: ${tools.join(', ')}`);
        }
        this.disabledToolsCache = new Set(tools);
        return this.disabledToolsCache;
    }
    setupHandlers() {
        this.server.setRequestHandler(types_js_1.InitializeRequestSchema, async (request) => {
            const clientVersion = request.params.protocolVersion;
            const clientCapabilities = request.params.capabilities;
            const clientInfo = request.params.clientInfo;
            logger_1.logger.info('MCP Initialize request received', {
                clientVersion,
                clientCapabilities,
                clientInfo
            });
            telemetry_1.telemetry.trackSessionStart();
            this.clientInfo = clientInfo;
            const negotiationResult = (0, protocol_version_1.negotiateProtocolVersion)(clientVersion, clientInfo, undefined, undefined);
            (0, protocol_version_1.logProtocolNegotiation)(negotiationResult, logger_1.logger, 'MCP_INITIALIZE');
            if (clientVersion && clientVersion !== negotiationResult.version) {
                logger_1.logger.warn(`Protocol version negotiated: client requested ${clientVersion}, server will use ${negotiationResult.version}`, {
                    reasoning: negotiationResult.reasoning
                });
            }
            const response = {
                protocolVersion: negotiationResult.version,
                capabilities: {
                    tools: {},
                },
                serverInfo: {
                    name: 'n8n-documentation-mcp',
                    version: version_1.PROJECT_VERSION,
                },
            };
            logger_1.logger.info('MCP Initialize response', { response });
            return response;
        });
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async (request) => {
            const disabledTools = this.getDisabledTools();
            const enabledDocTools = tools_1.n8nDocumentationToolsFinal.filter(tool => !disabledTools.has(tool.name));
            let tools = [...enabledDocTools];
            const hasEnvConfig = (0, n8n_api_1.isN8nApiConfigured)();
            const hasInstanceConfig = !!(this.instanceContext?.n8nApiUrl && this.instanceContext?.n8nApiKey);
            const isMultiTenantEnabled = process.env.ENABLE_MULTI_TENANT === 'true';
            const shouldIncludeManagementTools = hasEnvConfig || hasInstanceConfig || isMultiTenantEnabled;
            if (shouldIncludeManagementTools) {
                const enabledMgmtTools = tools_n8n_manager_1.n8nManagementTools.filter(tool => !disabledTools.has(tool.name));
                tools.push(...enabledMgmtTools);
                logger_1.logger.debug(`Tool listing: ${tools.length} tools available (${enabledDocTools.length} documentation + ${enabledMgmtTools.length} management)`, {
                    hasEnvConfig,
                    hasInstanceConfig,
                    isMultiTenantEnabled,
                    disabledToolsCount: disabledTools.size
                });
            }
            else {
                logger_1.logger.debug(`Tool listing: ${tools.length} tools available (documentation only)`, {
                    hasEnvConfig,
                    hasInstanceConfig,
                    isMultiTenantEnabled,
                    disabledToolsCount: disabledTools.size
                });
            }
            if (disabledTools.size > 0) {
                const totalAvailableTools = tools_1.n8nDocumentationToolsFinal.length + (shouldIncludeManagementTools ? tools_n8n_manager_1.n8nManagementTools.length : 0);
                logger_1.logger.debug(`Filtered ${disabledTools.size} disabled tools, ${tools.length}/${totalAvailableTools} tools available`);
            }
            const clientInfo = this.clientInfo;
            const isN8nClient = clientInfo?.name?.includes('n8n') ||
                clientInfo?.name?.includes('langchain');
            if (isN8nClient) {
                logger_1.logger.info('Detected n8n client, using n8n-friendly tool descriptions');
                tools = (0, tools_n8n_friendly_1.makeToolsN8nFriendly)(tools);
            }
            const validationTools = tools.filter(t => t.name.startsWith('validate_'));
            validationTools.forEach(tool => {
                logger_1.logger.info('Validation tool schema', {
                    toolName: tool.name,
                    inputSchema: JSON.stringify(tool.inputSchema, null, 2),
                    hasOutputSchema: !!tool.outputSchema,
                    description: tool.description
                });
            });
            return { tools };
        });
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            logger_1.logger.info('Tool call received - DETAILED DEBUG', {
                toolName: name,
                arguments: JSON.stringify(args, null, 2),
                argumentsType: typeof args,
                argumentsKeys: args ? Object.keys(args) : [],
                hasNodeType: args && 'nodeType' in args,
                hasConfig: args && 'config' in args,
                configType: args && args.config ? typeof args.config : 'N/A',
                rawRequest: JSON.stringify(request.params)
            });
            const disabledTools = this.getDisabledTools();
            if (disabledTools.has(name)) {
                logger_1.logger.warn(`Attempted to call disabled tool: ${name}`);
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
            let processedArgs = args;
            if (args && typeof args === 'object' && 'output' in args) {
                try {
                    const possibleNestedData = args.output;
                    if (typeof possibleNestedData === 'string' && possibleNestedData.trim().startsWith('{')) {
                        const parsed = JSON.parse(possibleNestedData);
                        if (parsed && typeof parsed === 'object') {
                            logger_1.logger.warn('Detected n8n nested output bug, attempting to extract actual arguments', {
                                originalArgs: args,
                                extractedArgs: parsed
                            });
                            if (this.validateExtractedArgs(name, parsed)) {
                                processedArgs = parsed;
                            }
                            else {
                                logger_1.logger.warn('Extracted arguments failed validation, using original args', {
                                    toolName: name,
                                    extractedArgs: parsed
                                });
                            }
                        }
                    }
                }
                catch (parseError) {
                    logger_1.logger.debug('Failed to parse nested output, continuing with original args', {
                        error: parseError instanceof Error ? parseError.message : String(parseError)
                    });
                }
            }
            try {
                logger_1.logger.debug(`Executing tool: ${name}`, { args: processedArgs });
                const startTime = Date.now();
                const result = await this.executeTool(name, processedArgs);
                const duration = Date.now() - startTime;
                logger_1.logger.debug(`Tool ${name} executed successfully`);
                telemetry_1.telemetry.trackToolUsage(name, true, duration);
                if (this.previousTool) {
                    const timeDelta = Date.now() - this.previousToolTimestamp;
                    telemetry_1.telemetry.trackToolSequence(this.previousTool, name, timeDelta);
                }
                this.previousTool = name;
                this.previousToolTimestamp = Date.now();
                let responseText;
                let structuredContent = null;
                try {
                    if (name.startsWith('validate_') && typeof result === 'object' && result !== null) {
                        const cleanResult = this.sanitizeValidationResult(result, name);
                        structuredContent = cleanResult;
                        responseText = JSON.stringify(cleanResult, null, 2);
                    }
                    else {
                        responseText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                    }
                }
                catch (jsonError) {
                    logger_1.logger.warn(`Failed to stringify tool result for ${name}:`, jsonError);
                    responseText = String(result);
                }
                if (responseText.length > 1000000) {
                    logger_1.logger.warn(`Tool ${name} response is very large (${responseText.length} chars), truncating`);
                    responseText = responseText.substring(0, 999000) + '\n\n[Response truncated due to size limits]';
                    structuredContent = null;
                }
                const mcpResponse = {
                    content: [
                        {
                            type: 'text',
                            text: responseText,
                        },
                    ],
                };
                if (name.startsWith('validate_') && structuredContent !== null) {
                    mcpResponse.structuredContent = structuredContent;
                }
                return mcpResponse;
            }
            catch (error) {
                logger_1.logger.error(`Error executing tool ${name}`, error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                telemetry_1.telemetry.trackToolUsage(name, false);
                telemetry_1.telemetry.trackError(error instanceof Error ? error.constructor.name : 'UnknownError', `tool_execution`, name, errorMessage);
                if (this.previousTool) {
                    const timeDelta = Date.now() - this.previousToolTimestamp;
                    telemetry_1.telemetry.trackToolSequence(this.previousTool, name, timeDelta);
                }
                this.previousTool = name;
                this.previousToolTimestamp = Date.now();
                let helpfulMessage = `Error executing tool ${name}: ${errorMessage}`;
                if (errorMessage.includes('required') || errorMessage.includes('missing')) {
                    helpfulMessage += '\n\nNote: This error often occurs when the AI agent sends incomplete or incorrectly formatted parameters. Please ensure all required fields are provided with the correct types.';
                }
                else if (errorMessage.includes('type') || errorMessage.includes('expected')) {
                    helpfulMessage += '\n\nNote: This error indicates a type mismatch. The AI agent may be sending data in the wrong format (e.g., string instead of object).';
                }
                else if (errorMessage.includes('Unknown category') || errorMessage.includes('not found')) {
                    helpfulMessage += '\n\nNote: The requested resource or category was not found. Please check the available options.';
                }
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
    }
    sanitizeValidationResult(result, toolName) {
        if (!result || typeof result !== 'object') {
            return result;
        }
        const sanitized = { ...result };
        if (toolName === 'validate_node_minimal') {
            const filtered = {
                nodeType: String(sanitized.nodeType || ''),
                displayName: String(sanitized.displayName || ''),
                valid: Boolean(sanitized.valid),
                missingRequiredFields: Array.isArray(sanitized.missingRequiredFields)
                    ? sanitized.missingRequiredFields.map(String)
                    : []
            };
            return filtered;
        }
        else if (toolName === 'validate_node_operation') {
            let summary = sanitized.summary;
            if (!summary || typeof summary !== 'object') {
                summary = {
                    hasErrors: Array.isArray(sanitized.errors) ? sanitized.errors.length > 0 : false,
                    errorCount: Array.isArray(sanitized.errors) ? sanitized.errors.length : 0,
                    warningCount: Array.isArray(sanitized.warnings) ? sanitized.warnings.length : 0,
                    suggestionCount: Array.isArray(sanitized.suggestions) ? sanitized.suggestions.length : 0
                };
            }
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
        }
        else if (toolName.startsWith('validate_workflow')) {
            sanitized.valid = Boolean(sanitized.valid);
            sanitized.errors = Array.isArray(sanitized.errors) ? sanitized.errors : [];
            sanitized.warnings = Array.isArray(sanitized.warnings) ? sanitized.warnings : [];
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
            }
            else {
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
        return JSON.parse(JSON.stringify(sanitized));
    }
    validateToolParams(toolName, args, legacyRequiredParams) {
        try {
            let validationResult;
            switch (toolName) {
                case 'validate_node':
                    validationResult = validation_schemas_1.ToolValidation.validateNodeOperation(args);
                    break;
                case 'validate_workflow':
                    validationResult = validation_schemas_1.ToolValidation.validateWorkflow(args);
                    break;
                case 'search_nodes':
                    validationResult = validation_schemas_1.ToolValidation.validateSearchNodes(args);
                    break;
                case 'n8n_create_workflow':
                    validationResult = validation_schemas_1.ToolValidation.validateCreateWorkflow(args);
                    break;
                case 'n8n_get_workflow':
                case 'n8n_update_full_workflow':
                case 'n8n_delete_workflow':
                case 'n8n_validate_workflow':
                case 'n8n_autofix_workflow':
                    validationResult = validation_schemas_1.ToolValidation.validateWorkflowId(args);
                    break;
                case 'n8n_executions':
                    validationResult = args.action
                        ? { valid: true, errors: [] }
                        : { valid: false, errors: [{ field: 'action', message: 'action is required' }] };
                    break;
                case 'n8n_deploy_template':
                    validationResult = args.templateId !== undefined
                        ? { valid: true, errors: [] }
                        : { valid: false, errors: [{ field: 'templateId', message: 'templateId is required' }] };
                    break;
                default:
                    return this.validateToolParamsBasic(toolName, args, legacyRequiredParams || []);
            }
            if (!validationResult.valid) {
                const errorMessage = validation_schemas_1.Validator.formatErrors(validationResult, toolName);
                logger_1.logger.error(`Parameter validation failed for ${toolName}:`, errorMessage);
                throw new validation_schemas_1.ValidationError(errorMessage);
            }
        }
        catch (error) {
            if (error instanceof validation_schemas_1.ValidationError) {
                throw error;
            }
            logger_1.logger.error(`Validation system error for ${toolName}:`, error);
            const errorMessage = error instanceof Error
                ? `Internal validation error: ${error.message}`
                : `Internal validation error while processing ${toolName}`;
            throw new Error(errorMessage);
        }
    }
    validateToolParamsBasic(toolName, args, requiredParams) {
        const missing = [];
        const invalid = [];
        for (const param of requiredParams) {
            if (!(param in args) || args[param] === undefined || args[param] === null) {
                missing.push(param);
            }
            else if (typeof args[param] === 'string' && args[param].trim() === '') {
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
    validateExtractedArgs(toolName, args) {
        if (!args || typeof args !== 'object') {
            return false;
        }
        const allTools = [...tools_1.n8nDocumentationToolsFinal, ...tools_n8n_manager_1.n8nManagementTools];
        const tool = allTools.find(t => t.name === toolName);
        if (!tool || !tool.inputSchema) {
            return true;
        }
        const schema = tool.inputSchema;
        const required = schema.required || [];
        const properties = schema.properties || {};
        for (const requiredField of required) {
            if (!(requiredField in args)) {
                logger_1.logger.debug(`Extracted args missing required field: ${requiredField}`, {
                    toolName,
                    extractedArgs: args,
                    required
                });
                return false;
            }
        }
        for (const [fieldName, fieldValue] of Object.entries(args)) {
            if (properties[fieldName]) {
                const expectedType = properties[fieldName].type;
                const actualType = Array.isArray(fieldValue) ? 'array' : typeof fieldValue;
                if (expectedType && expectedType !== actualType) {
                    if (expectedType === 'number' && actualType === 'string' && !isNaN(Number(fieldValue))) {
                        continue;
                    }
                    logger_1.logger.debug(`Extracted args field type mismatch: ${fieldName}`, {
                        toolName,
                        expectedType,
                        actualType,
                        fieldValue
                    });
                    return false;
                }
            }
        }
        if (schema.additionalProperties === false) {
            const allowedFields = Object.keys(properties);
            const extraFields = Object.keys(args).filter(field => !allowedFields.includes(field));
            if (extraFields.length > 0) {
                logger_1.logger.debug(`Extracted args have extra fields`, {
                    toolName,
                    extraFields,
                    allowedFields
                });
            }
        }
        return true;
    }
    async executeTool(name, args) {
        args = args || {};
        const disabledTools = this.getDisabledTools();
        if (disabledTools.has(name)) {
            throw new Error(`Tool '${name}' is disabled via DISABLED_TOOLS environment variable`);
        }
        logger_1.logger.info(`Tool execution: ${name}`, {
            args: typeof args === 'object' ? JSON.stringify(args) : args,
            argsType: typeof args,
            argsKeys: typeof args === 'object' ? Object.keys(args) : 'not-object'
        });
        if (typeof args !== 'object' || args === null) {
            throw new Error(`Invalid arguments for tool ${name}: expected object, got ${typeof args}`);
        }
        switch (name) {
            case 'tools_documentation':
                return this.getToolsDocumentation(args.topic, args.depth);
            case 'search_nodes':
                this.validateToolParams(name, args, ['query']);
                const limit = args.limit !== undefined ? Number(args.limit) || 20 : 20;
                return this.searchNodes(args.query, limit, {
                    mode: args.mode,
                    includeExamples: args.includeExamples,
                    source: args.source
                });
            case 'get_node':
                this.validateToolParams(name, args, ['nodeType']);
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
                return this.getNode(args.nodeType, args.detail, args.mode, args.includeTypeInfo, args.includeExamples, args.fromVersion, args.toVersion);
            case 'validate_node':
                this.validateToolParams(name, args, ['nodeType', 'config']);
                if (typeof args.config !== 'object' || args.config === null) {
                    logger_1.logger.warn(`validate_node called with invalid config type: ${typeof args.config}`);
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
                        const searchFields = args.fields;
                        return this.searchTemplates(args.query, searchLimit, searchOffset, searchFields);
                }
            }
            case 'validate_workflow':
                this.validateToolParams(name, args, ['workflow']);
                return this.validateWorkflow(args.workflow, args.options);
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
                return n8nHandlers.handleUpdateWorkflow(args, this.repository, this.instanceContext);
            case 'n8n_update_partial_workflow':
                this.validateToolParams(name, args, ['id', 'operations']);
                return (0, handlers_workflow_diff_1.handleUpdatePartialWorkflow)(args, this.repository, this.instanceContext);
            case 'n8n_delete_workflow':
                this.validateToolParams(name, args, ['id']);
                return n8nHandlers.handleDeleteWorkflow(args, this.instanceContext);
            case 'n8n_list_workflows':
                return n8nHandlers.handleListWorkflows(args, this.instanceContext);
            case 'n8n_validate_workflow':
                this.validateToolParams(name, args, ['id']);
                await this.ensureInitialized();
                if (!this.repository)
                    throw new Error('Repository not initialized');
                return n8nHandlers.handleValidateWorkflow(args, this.repository, this.instanceContext);
            case 'n8n_autofix_workflow':
                this.validateToolParams(name, args, ['id']);
                await this.ensureInitialized();
                if (!this.repository)
                    throw new Error('Repository not initialized');
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
                if (args.mode === 'diagnostic') {
                    return n8nHandlers.handleDiagnostic({ params: { arguments: args } }, this.instanceContext);
                }
                return n8nHandlers.handleHealthCheck(this.instanceContext);
            case 'n8n_workflow_versions':
                this.validateToolParams(name, args, ['mode']);
                return n8nHandlers.handleWorkflowVersions(args, this.repository, this.instanceContext);
            case 'n8n_deploy_template':
                this.validateToolParams(name, args, ['templateId']);
                await this.ensureInitialized();
                if (!this.templateService)
                    throw new Error('Template service not initialized');
                if (!this.repository)
                    throw new Error('Repository not initialized');
                return n8nHandlers.handleDeployTemplate(args, this.templateService, this.repository, this.instanceContext);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    async listNodes(filters = {}) {
        await this.ensureInitialized();
        let query = 'SELECT * FROM nodes WHERE 1=1';
        const params = [];
        if (filters.package) {
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
        const nodes = this.db.prepare(query).all(...params);
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
    async getNodeInfo(nodeType) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const aiToolCapabilities = {
            canBeUsedAsTool: true,
            hasUsableAsToolProperty: node.isAITool ?? false,
            requiresEnvironmentVariable: !(node.isAITool ?? false) && node.package !== 'n8n-nodes-base',
            toolConnectionType: 'ai_tool',
            commonToolUseCases: this.getCommonAIToolUseCases(node.nodeType),
            environmentRequirement: node.package && node.package !== 'n8n-nodes-base' ?
                'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true' :
                null
        };
        let outputs = undefined;
        if (node.outputNames && Array.isArray(node.outputNames) && node.outputNames.length > 0) {
            outputs = node.outputNames.map((name, index) => {
                const descriptions = this.getOutputDescriptions(node.nodeType, name, index);
                return {
                    index,
                    name,
                    description: descriptions?.description ?? '',
                    connectionGuidance: descriptions?.connectionGuidance ?? ''
                };
            });
        }
        const result = {
            ...node,
            workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package ?? 'n8n-nodes-base', node.nodeType),
            aiToolCapabilities,
            outputs
        };
        const toolVariantInfo = this.buildToolVariantGuidance(node);
        if (toolVariantInfo) {
            result.toolVariantInfo = toolVariantInfo;
        }
        return result;
    }
    async searchNodes(query, limit = 20, options) {
        await this.ensureInitialized();
        if (!this.db)
            throw new Error('Database not initialized');
        let normalizedQuery = query;
        if (query.includes('n8n-nodes-base.') || query.includes('@n8n/n8n-nodes-langchain.')) {
            normalizedQuery = query
                .replace(/n8n-nodes-base\./g, 'nodes-base.')
                .replace(/@n8n\/n8n-nodes-langchain\./g, 'nodes-langchain.');
        }
        const searchMode = options?.mode || 'OR';
        const ftsExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='nodes_fts'
    `).get();
        if (ftsExists) {
            logger_1.logger.debug(`Using FTS5 search with includeExamples=${options?.includeExamples}`);
            return this.searchNodesFTS(normalizedQuery, limit, searchMode, options);
        }
        else {
            logger_1.logger.debug('Using LIKE search (no FTS5)');
            return this.searchNodesLIKE(normalizedQuery, limit, options);
        }
    }
    async searchNodesFTS(query, limit, mode, options) {
        if (!this.db)
            throw new Error('Database not initialized');
        const cleanedQuery = query.trim();
        if (!cleanedQuery) {
            return { query, results: [], totalCount: 0 };
        }
        if (mode === 'FUZZY') {
            return this.searchNodesFuzzy(cleanedQuery, limit);
        }
        let ftsQuery;
        if (cleanedQuery.startsWith('"') && cleanedQuery.endsWith('"')) {
            ftsQuery = cleanedQuery;
        }
        else {
            const words = cleanedQuery.split(/\s+/).filter(w => w.length > 0);
            switch (mode) {
                case 'AND':
                    ftsQuery = words.join(' AND ');
                    break;
                case 'OR':
                default:
                    ftsQuery = words.join(' OR ');
                    break;
            }
        }
        try {
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
            }
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
      `).all(ftsQuery, cleanedQuery, `%${cleanedQuery}%`, `%${cleanedQuery}%`, limit);
            const scoredNodes = nodes.map(node => {
                const relevanceScore = this.calculateRelevanceScore(node, cleanedQuery);
                return { ...node, relevanceScore };
            });
            scoredNodes.sort((a, b) => {
                if (a.display_name.toLowerCase() === cleanedQuery.toLowerCase())
                    return -1;
                if (b.display_name.toLowerCase() === cleanedQuery.toLowerCase())
                    return 1;
                if (a.relevanceScore !== b.relevanceScore) {
                    return b.relevanceScore - a.relevanceScore;
                }
                return a.rank - b.rank;
            });
            const hasHttpRequest = scoredNodes.some(n => n.node_type === 'nodes-base.httpRequest');
            if (cleanedQuery.toLowerCase().includes('http') && !hasHttpRequest) {
                logger_1.logger.debug('FTS missed HTTP Request node, augmenting with LIKE search');
                return this.searchNodesLIKE(query, limit);
            }
            const result = {
                query,
                results: scoredNodes.map(node => {
                    const nodeResult = {
                        nodeType: node.node_type,
                        workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package_name, node.node_type),
                        displayName: node.display_name,
                        description: node.description,
                        category: node.category,
                        package: node.package_name,
                        relevance: this.calculateRelevance(node, cleanedQuery)
                    };
                    if (node.is_community === 1) {
                        nodeResult.isCommunity = true;
                        nodeResult.isVerified = node.is_verified === 1;
                        if (node.author_name) {
                            nodeResult.authorName = node.author_name;
                        }
                        if (node.npm_downloads) {
                            nodeResult.npmDownloads = node.npm_downloads;
                        }
                    }
                    return nodeResult;
                }),
                totalCount: scoredNodes.length
            };
            if (mode !== 'OR') {
                result.mode = mode;
            }
            if (options && options.includeExamples) {
                try {
                    for (const nodeResult of result.results) {
                        const examples = this.db.prepare(`
              SELECT
                parameters_json,
                template_name,
                template_views
              FROM template_node_configs
              WHERE node_type = ?
              ORDER BY rank
              LIMIT 2
            `).all(nodeResult.workflowNodeType);
                        if (examples.length > 0) {
                            nodeResult.examples = examples.map((ex) => ({
                                configuration: JSON.parse(ex.parameters_json),
                                template: ex.template_name,
                                views: ex.template_views
                            }));
                        }
                    }
                }
                catch (error) {
                    logger_1.logger.error(`Failed to add examples:`, error);
                }
            }
            telemetry_1.telemetry.trackSearchQuery(query, scoredNodes.length, mode ?? 'OR');
            return result;
        }
        catch (error) {
            logger_1.logger.warn('FTS5 search failed, falling back to LIKE search:', error.message);
            if (error.message.includes('syntax error') || error.message.includes('fts5')) {
                logger_1.logger.warn(`FTS5 syntax error for query "${query}" in mode ${mode}`);
                const likeResult = await this.searchNodesLIKE(query, limit);
                telemetry_1.telemetry.trackSearchQuery(query, likeResult.results?.length ?? 0, `${mode}_LIKE_FALLBACK`);
                return {
                    ...likeResult,
                    mode
                };
            }
            return this.searchNodesLIKE(query, limit);
        }
    }
    async searchNodesFuzzy(query, limit) {
        if (!this.db)
            throw new Error('Database not initialized');
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) {
            return { query, results: [], totalCount: 0, mode: 'FUZZY' };
        }
        const candidateNodes = this.db.prepare(`
      SELECT * FROM nodes
    `).all();
        const scoredNodes = candidateNodes.map(node => {
            const score = this.calculateFuzzyScore(node, query);
            return { node, score };
        });
        const matchingNodes = scoredNodes
            .filter(item => item.score >= 200)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(item => item.node);
        if (matchingNodes.length === 0) {
            const topScores = scoredNodes
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);
            logger_1.logger.debug(`FUZZY search for "${query}" - no matches above 400. Top scores:`, topScores.map(s => ({ name: s.node.display_name, score: s.score })));
        }
        return {
            query,
            mode: 'FUZZY',
            results: matchingNodes.map(node => ({
                nodeType: node.node_type,
                workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package_name, node.node_type),
                displayName: node.display_name,
                description: node.description,
                category: node.category,
                package: node.package_name
            })),
            totalCount: matchingNodes.length
        };
    }
    calculateFuzzyScore(node, query) {
        const queryLower = query.toLowerCase();
        const displayNameLower = node.display_name.toLowerCase();
        const nodeTypeLower = node.node_type.toLowerCase();
        const nodeTypeClean = nodeTypeLower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
        if (displayNameLower === queryLower || nodeTypeClean === queryLower) {
            return 1000;
        }
        const nameDistance = this.getEditDistance(queryLower, displayNameLower);
        const typeDistance = this.getEditDistance(queryLower, nodeTypeClean);
        const nameWords = displayNameLower.split(/\s+/);
        let minWordDistance = Infinity;
        for (const word of nameWords) {
            const distance = this.getEditDistance(queryLower, word);
            if (distance < minWordDistance) {
                minWordDistance = distance;
            }
        }
        const bestDistance = Math.min(nameDistance, typeDistance, minWordDistance);
        let matchedLen = queryLower.length;
        if (minWordDistance === bestDistance) {
            for (const word of nameWords) {
                if (this.getEditDistance(queryLower, word) === minWordDistance) {
                    matchedLen = Math.max(queryLower.length, word.length);
                    break;
                }
            }
        }
        else if (typeDistance === bestDistance) {
            matchedLen = Math.max(queryLower.length, nodeTypeClean.length);
        }
        else {
            matchedLen = Math.max(queryLower.length, displayNameLower.length);
        }
        const similarity = 1 - (bestDistance / matchedLen);
        if (displayNameLower.includes(queryLower) || nodeTypeClean.includes(queryLower)) {
            return 800 + (similarity * 100);
        }
        if (displayNameLower.startsWith(queryLower) ||
            nodeTypeClean.startsWith(queryLower) ||
            nameWords.some(w => w.startsWith(queryLower))) {
            return 700 + (similarity * 100);
        }
        if (bestDistance <= 2) {
            return 500 + ((2 - bestDistance) * 100) + (similarity * 50);
        }
        if (bestDistance <= 3 && queryLower.length >= 4) {
            return 400 + ((3 - bestDistance) * 50) + (similarity * 50);
        }
        return similarity * 300;
    }
    getEditDistance(s1, s2) {
        const m = s1.length;
        const n = s2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++)
            dp[i][0] = i;
        for (let j = 0; j <= n; j++)
            dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                }
                else {
                    dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
            }
        }
        return dp[m][n];
    }
    async searchNodesLIKE(query, limit, options) {
        if (!this.db)
            throw new Error('Database not initialized');
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
        }
        if (query.startsWith('"') && query.endsWith('"')) {
            const exactPhrase = query.slice(1, -1);
            const nodes = this.db.prepare(`
        SELECT * FROM nodes
        WHERE (node_type LIKE ? OR display_name LIKE ? OR description LIKE ?)
        ${sourceFilter}
        LIMIT ?
      `).all(`%${exactPhrase}%`, `%${exactPhrase}%`, `%${exactPhrase}%`, limit * 3);
            const rankedNodes = this.rankSearchResults(nodes, exactPhrase, limit);
            const result = {
                query,
                results: rankedNodes.map(node => {
                    const nodeResult = {
                        nodeType: node.node_type,
                        workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package_name, node.node_type),
                        displayName: node.display_name,
                        description: node.description,
                        category: node.category,
                        package: node.package_name
                    };
                    if (node.is_community === 1) {
                        nodeResult.isCommunity = true;
                        nodeResult.isVerified = node.is_verified === 1;
                        if (node.author_name) {
                            nodeResult.authorName = node.author_name;
                        }
                        if (node.npm_downloads) {
                            nodeResult.npmDownloads = node.npm_downloads;
                        }
                    }
                    return nodeResult;
                }),
                totalCount: rankedNodes.length
            };
            if (options?.includeExamples) {
                for (const nodeResult of result.results) {
                    try {
                        const examples = this.db.prepare(`
              SELECT
                parameters_json,
                template_name,
                template_views
              FROM template_node_configs
              WHERE node_type = ?
              ORDER BY rank
              LIMIT 2
            `).all(nodeResult.workflowNodeType);
                        if (examples.length > 0) {
                            nodeResult.examples = examples.map((ex) => ({
                                configuration: JSON.parse(ex.parameters_json),
                                template: ex.template_name,
                                views: ex.template_views
                            }));
                        }
                    }
                    catch (error) {
                        logger_1.logger.warn(`Failed to fetch examples for ${nodeResult.nodeType}:`, error.message);
                    }
                }
            }
            return result;
        }
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) {
            return { query, results: [], totalCount: 0 };
        }
        const conditions = words.map(() => '(node_type LIKE ? OR display_name LIKE ? OR description LIKE ?)').join(' OR ');
        const params = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`]);
        params.push(limit * 3);
        const nodes = this.db.prepare(`
      SELECT DISTINCT * FROM nodes
      WHERE (${conditions})
      ${sourceFilter}
      LIMIT ?
    `).all(...params);
        const rankedNodes = this.rankSearchResults(nodes, query, limit);
        const result = {
            query,
            results: rankedNodes.map(node => {
                const nodeResult = {
                    nodeType: node.node_type,
                    workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package_name, node.node_type),
                    displayName: node.display_name,
                    description: node.description,
                    category: node.category,
                    package: node.package_name
                };
                if (node.is_community === 1) {
                    nodeResult.isCommunity = true;
                    nodeResult.isVerified = node.is_verified === 1;
                    if (node.author_name) {
                        nodeResult.authorName = node.author_name;
                    }
                    if (node.npm_downloads) {
                        nodeResult.npmDownloads = node.npm_downloads;
                    }
                }
                return nodeResult;
            }),
            totalCount: rankedNodes.length
        };
        if (options?.includeExamples) {
            for (const nodeResult of result.results) {
                try {
                    const examples = this.db.prepare(`
            SELECT
              parameters_json,
              template_name,
              template_views
            FROM template_node_configs
            WHERE node_type = ?
            ORDER BY rank
            LIMIT 2
          `).all(nodeResult.workflowNodeType);
                    if (examples.length > 0) {
                        nodeResult.examples = examples.map((ex) => ({
                            configuration: JSON.parse(ex.parameters_json),
                            template: ex.template_name,
                            views: ex.template_views
                        }));
                    }
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to fetch examples for ${nodeResult.nodeType}:`, error.message);
                }
            }
        }
        return result;
    }
    calculateRelevance(node, query) {
        const lowerQuery = query.toLowerCase();
        if (node.node_type.toLowerCase().includes(lowerQuery))
            return 'high';
        if (node.display_name.toLowerCase().includes(lowerQuery))
            return 'high';
        if (node.description?.toLowerCase().includes(lowerQuery))
            return 'medium';
        return 'low';
    }
    calculateRelevanceScore(node, query) {
        const query_lower = query.toLowerCase();
        const name_lower = node.display_name.toLowerCase();
        const type_lower = node.node_type.toLowerCase();
        const type_without_prefix = type_lower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
        let score = 0;
        if (name_lower === query_lower) {
            score = 1000;
        }
        else if (type_without_prefix === query_lower) {
            score = 950;
        }
        else if (query_lower === 'webhook' && node.node_type === 'nodes-base.webhook') {
            score = 900;
        }
        else if ((query_lower === 'http' || query_lower === 'http request' || query_lower === 'http call') && node.node_type === 'nodes-base.httpRequest') {
            score = 900;
        }
        else if (query_lower.includes('http') && query_lower.includes('call') && node.node_type === 'nodes-base.httpRequest') {
            score = 890;
        }
        else if (query_lower.includes('http') && node.node_type === 'nodes-base.httpRequest') {
            score = 850;
        }
        else if (query_lower.includes('webhook') && node.node_type === 'nodes-base.webhook') {
            score = 850;
        }
        else if (name_lower.startsWith(query_lower)) {
            score = 800;
        }
        else if (new RegExp(`\\b${query_lower}\\b`, 'i').test(node.display_name)) {
            score = 700;
        }
        else if (name_lower.includes(query_lower)) {
            score = 600;
        }
        else if (type_without_prefix.includes(query_lower)) {
            score = 500;
        }
        else if (node.description?.toLowerCase().includes(query_lower)) {
            score = 400;
        }
        return score;
    }
    rankSearchResults(nodes, query, limit) {
        const query_lower = query.toLowerCase();
        const scoredNodes = nodes.map(node => {
            const name_lower = node.display_name.toLowerCase();
            const type_lower = node.node_type.toLowerCase();
            const type_without_prefix = type_lower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
            let score = 0;
            if (name_lower === query_lower) {
                score = 1000;
            }
            else if (type_without_prefix === query_lower) {
                score = 950;
            }
            else if (query_lower === 'webhook' && node.node_type === 'nodes-base.webhook') {
                score = 900;
            }
            else if ((query_lower === 'http' || query_lower === 'http request' || query_lower === 'http call') && node.node_type === 'nodes-base.httpRequest') {
                score = 900;
            }
            else if (query_lower.includes('webhook') && node.node_type === 'nodes-base.webhook') {
                score = 850;
            }
            else if (query_lower.includes('http') && node.node_type === 'nodes-base.httpRequest') {
                score = 850;
            }
            else if (name_lower.startsWith(query_lower)) {
                score = 800;
            }
            else if (new RegExp(`\\b${query_lower}\\b`, 'i').test(node.display_name)) {
                score = 700;
            }
            else if (name_lower.includes(query_lower)) {
                score = 600;
            }
            else if (type_without_prefix.includes(query_lower)) {
                score = 500;
            }
            else if (node.description?.toLowerCase().includes(query_lower)) {
                score = 400;
            }
            const words = query_lower.split(/\s+/).filter(w => w.length > 0);
            if (words.length > 1) {
                const allWordsInName = words.every(word => name_lower.includes(word));
                const allWordsInDesc = words.every(word => node.description?.toLowerCase().includes(word));
                if (allWordsInName)
                    score += 200;
                else if (allWordsInDesc)
                    score += 100;
                if (query_lower === 'http call' && name_lower === 'http request') {
                    score = 920;
                }
            }
            return { node, score };
        });
        scoredNodes.sort((a, b) => {
            if (a.score !== b.score) {
                return b.score - a.score;
            }
            return a.node.display_name.localeCompare(b.node.display_name);
        });
        return scoredNodes.slice(0, limit).map(item => item.node);
    }
    async listAITools() {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const tools = this.repository.getAITools();
        const aiCount = this.db.prepare('SELECT COUNT(*) as ai_count FROM nodes WHERE is_ai_tool = 1').get();
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
    async getNodeDocumentation(nodeType) {
        await this.ensureInitialized();
        if (!this.db)
            throw new Error('Database not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.db.prepare(`
      SELECT node_type, display_name, documentation, description,
             ai_documentation_summary, ai_summary_generated_at
      FROM nodes
      WHERE node_type = ?
    `).get(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.db.prepare(`
        SELECT node_type, display_name, documentation, description,
               ai_documentation_summary, ai_summary_generated_at
        FROM nodes
        WHERE node_type = ?
      `).get(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                node = this.db.prepare(`
          SELECT node_type, display_name, documentation, description,
                 ai_documentation_summary, ai_summary_generated_at
          FROM nodes
          WHERE node_type = ?
        `).get(alt);
                if (node)
                    break;
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const aiDocSummary = node.ai_documentation_summary
            ? this.safeJsonParse(node.ai_documentation_summary, null)
            : null;
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
                    essentials.commonProperties.map((p) => `### ${p.displayName || 'Property'}\n${p.description || `Type: ${p.type || 'unknown'}`}`).join('\n\n') :
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
    safeJsonParse(json, defaultValue = null) {
        try {
            return JSON.parse(json);
        }
        catch {
            return defaultValue;
        }
    }
    async getDatabaseStatistics() {
        await this.ensureInitialized();
        if (!this.db)
            throw new Error('Database not initialized');
        const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(is_ai_tool) as ai_tools,
        SUM(is_trigger) as triggers,
        SUM(is_versioned) as versioned,
        SUM(CASE WHEN documentation IS NOT NULL THEN 1 ELSE 0 END) as with_docs,
        COUNT(DISTINCT package_name) as packages,
        COUNT(DISTINCT category) as categories
      FROM nodes
    `).get();
        const packages = this.db.prepare(`
      SELECT package_name, COUNT(*) as count 
      FROM nodes 
      GROUP BY package_name
    `).all();
        const templateStats = this.db.prepare(`
      SELECT 
        COUNT(*) as total_templates,
        AVG(views) as avg_views,
        MIN(views) as min_views,
        MAX(views) as max_views
      FROM templates
    `).get();
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
    async getNodeEssentials(nodeType, includeExamples) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const cacheKey = `essentials:${nodeType}:${includeExamples ? 'withExamples' : 'basic'}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const allProperties = node.properties || [];
        const essentials = property_filter_1.PropertyFilter.getEssentials(allProperties, node.nodeType);
        const operations = node.operations || [];
        const latestVersion = node.version ?? '1';
        const result = {
            nodeType: node.nodeType,
            workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package ?? 'n8n-nodes-base', node.nodeType),
            displayName: node.displayName,
            description: node.description,
            category: node.category,
            version: latestVersion,
            isVersioned: node.isVersioned ?? false,
            versionNotice: `⚠️ Use typeVersion: ${latestVersion} when creating this node`,
            requiredProperties: essentials.required,
            commonProperties: essentials.common,
            operations: operations.map((op) => ({
                name: op.name || op.operation,
                description: op.description,
                action: op.action,
                resource: op.resource
            })),
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
        const toolVariantInfo = this.buildToolVariantGuidance(node);
        if (toolVariantInfo) {
            result.toolVariantInfo = toolVariantInfo;
        }
        if (includeExamples) {
            try {
                const examples = this.db.prepare(`
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
        `).all(result.workflowNodeType);
                if (examples.length > 0) {
                    result.examples = examples.map((ex) => ({
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
                    result.examplesCount = examples.length;
                }
                else {
                    result.examples = [];
                    result.examplesCount = 0;
                }
            }
            catch (error) {
                logger_1.logger.warn(`Failed to fetch examples for ${nodeType}:`, error.message);
                result.examples = [];
                result.examplesCount = 0;
            }
        }
        this.cache.set(cacheKey, result, 3600);
        return result;
    }
    async getNode(nodeType, detail = 'standard', mode = 'info', includeTypeInfo, includeExamples, fromVersion, toVersion) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const validDetailLevels = ['minimal', 'standard', 'full'];
        const validModes = ['info', 'versions', 'compare', 'breaking', 'migrations'];
        if (!validDetailLevels.includes(detail)) {
            throw new Error(`get_node: Invalid detail level "${detail}". Valid options: ${validDetailLevels.join(', ')}`);
        }
        if (!validModes.includes(mode)) {
            throw new Error(`get_node: Invalid mode "${mode}". Valid options: ${validModes.join(', ')}`);
        }
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        if (mode !== 'info') {
            return this.handleVersionMode(normalizedType, mode, fromVersion, toVersion);
        }
        return this.handleInfoMode(normalizedType, detail, includeTypeInfo, includeExamples);
    }
    async handleInfoMode(nodeType, detail, includeTypeInfo, includeExamples) {
        switch (detail) {
            case 'minimal': {
                let node = this.repository.getNode(nodeType);
                if (!node) {
                    const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(nodeType);
                    for (const alt of alternatives) {
                        const found = this.repository.getNode(alt);
                        if (found) {
                            node = found;
                            break;
                        }
                    }
                }
                if (!node) {
                    throw new Error(`Node ${nodeType} not found`);
                }
                const result = {
                    nodeType: node.nodeType,
                    workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package ?? 'n8n-nodes-base', node.nodeType),
                    displayName: node.displayName,
                    description: node.description,
                    category: node.category,
                    package: node.package,
                    isAITool: node.isAITool,
                    isTrigger: node.isTrigger,
                    isWebhook: node.isWebhook
                };
                const toolVariantInfo = this.buildToolVariantGuidance(node);
                if (toolVariantInfo) {
                    result.toolVariantInfo = toolVariantInfo;
                }
                return result;
            }
            case 'standard': {
                const essentials = await this.getNodeEssentials(nodeType, includeExamples);
                const versionSummary = this.getVersionSummary(nodeType);
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
                const fullInfo = await this.getNodeInfo(nodeType);
                const versionSummary = this.getVersionSummary(nodeType);
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
    async handleVersionMode(nodeType, mode, fromVersion, toVersion) {
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
    getVersionSummary(nodeType) {
        const cacheKey = `version-summary:${nodeType}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }
        const versions = this.repository.getNodeVersions(nodeType);
        const latest = this.repository.getLatestNodeVersion(nodeType);
        const summary = {
            currentVersion: latest?.version || 'unknown',
            totalVersions: versions.length,
            hasVersionHistory: versions.length > 0
        };
        this.cache.set(cacheKey, summary, 86400000);
        return summary;
    }
    getVersionHistory(nodeType) {
        const versions = this.repository.getNodeVersions(nodeType);
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
    compareVersions(nodeType, fromVersion, toVersion) {
        const latest = this.repository.getLatestNodeVersion(nodeType);
        const targetVersion = toVersion || latest?.version;
        if (!targetVersion) {
            throw new Error('No target version available');
        }
        const changes = this.repository.getPropertyChanges(nodeType, fromVersion, targetVersion);
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
    getBreakingChanges(nodeType, fromVersion, toVersion) {
        const breakingChanges = this.repository.getBreakingChanges(nodeType, fromVersion, toVersion);
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
    getMigrations(nodeType, fromVersion, toVersion) {
        const migrations = this.repository.getAutoMigratableChanges(nodeType, fromVersion, toVersion);
        const allChanges = this.repository.getPropertyChanges(nodeType, fromVersion, toVersion);
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
    enrichPropertyWithTypeInfo(property) {
        if (!property || !property.type)
            return property;
        const structure = type_structure_service_1.TypeStructureService.getStructure(property.type);
        if (!structure)
            return property;
        return {
            ...property,
            typeInfo: {
                category: structure.type,
                jsType: structure.jsType,
                description: structure.description,
                isComplex: type_structure_service_1.TypeStructureService.isComplexType(property.type),
                isPrimitive: type_structure_service_1.TypeStructureService.isPrimitiveType(property.type),
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
    enrichPropertiesWithTypeInfo(properties) {
        if (!properties || !Array.isArray(properties))
            return properties;
        return properties.map((prop) => this.enrichPropertyWithTypeInfo(prop));
    }
    async searchNodeProperties(nodeType, query, maxResults = 20) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const allProperties = node.properties || [];
        const matches = property_filter_1.PropertyFilter.searchProperties(allProperties, query, maxResults);
        return {
            nodeType: node.nodeType,
            query,
            matches: matches.map((match) => ({
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
    getPropertyValue(config, path) {
        const parts = path.split('.');
        let value = config;
        for (const part of parts) {
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
            if (arrayMatch) {
                value = value?.[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
            }
            else {
                value = value?.[part];
            }
        }
        return value;
    }
    async listTasks(category) {
        if (category) {
            const categories = task_templates_1.TaskTemplates.getTaskCategories();
            const tasks = categories[category];
            if (!tasks) {
                throw new Error(`Unknown category: ${category}. Available categories: ${Object.keys(categories).join(', ')}`);
            }
            return {
                category,
                tasks: tasks.map(task => {
                    const template = task_templates_1.TaskTemplates.getTaskTemplate(task);
                    return {
                        task,
                        description: template?.description || '',
                        nodeType: template?.nodeType || ''
                    };
                })
            };
        }
        const categories = task_templates_1.TaskTemplates.getTaskCategories();
        const result = {
            totalTasks: task_templates_1.TaskTemplates.getAllTasks().length,
            categories: {}
        };
        for (const [cat, tasks] of Object.entries(categories)) {
            result.categories[cat] = tasks.map(task => {
                const template = task_templates_1.TaskTemplates.getTaskTemplate(task);
                return {
                    task,
                    description: template?.description || '',
                    nodeType: template?.nodeType || ''
                };
            });
        }
        return result;
    }
    async validateNodeConfig(nodeType, config, mode = 'operation', profile = 'ai-friendly') {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const properties = node.properties || [];
        const configWithVersion = {
            '@version': node.version || 1,
            ...config
        };
        const validationResult = enhanced_config_validator_1.EnhancedConfigValidator.validateWithMode(node.nodeType, configWithVersion, properties, mode, profile);
        return {
            nodeType: node.nodeType,
            workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package, node.nodeType),
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
    async getPropertyDependencies(nodeType, config) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const properties = node.properties || [];
        const analysis = property_dependencies_1.PropertyDependencies.analyze(properties);
        let visibilityImpact = null;
        if (config) {
            visibilityImpact = property_dependencies_1.PropertyDependencies.getVisibilityImpact(properties, config);
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
    async getNodeAsToolInfo(nodeType) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const commonUseCases = this.getCommonAIToolUseCases(node.nodeType);
        const aiToolCapabilities = {
            canBeUsedAsTool: true,
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
            workflowNodeType: (0, node_utils_1.getWorkflowNodeType)(node.package, node.nodeType),
            displayName: node.displayName,
            description: node.description,
            package: node.package,
            isMarkedAsAITool: node.isAITool,
            aiToolCapabilities
        };
    }
    getOutputDescriptions(nodeType, outputName, index) {
        if (nodeType === 'nodes-base.splitInBatches') {
            if (outputName === 'done' && index === 0) {
                return {
                    description: 'Final processed data after all iterations complete',
                    connectionGuidance: 'Connect to nodes that should run AFTER the loop completes'
                };
            }
            else if (outputName === 'loop' && index === 1) {
                return {
                    description: 'Current batch data for this iteration',
                    connectionGuidance: 'Connect to nodes that process items INSIDE the loop (and connect their output back to this node)'
                };
            }
        }
        if (nodeType === 'nodes-base.if') {
            if (outputName === 'true' && index === 0) {
                return {
                    description: 'Items that match the condition',
                    connectionGuidance: 'Connect to nodes that handle the TRUE case'
                };
            }
            else if (outputName === 'false' && index === 1) {
                return {
                    description: 'Items that do not match the condition',
                    connectionGuidance: 'Connect to nodes that handle the FALSE case'
                };
            }
        }
        if (nodeType === 'nodes-base.switch') {
            return {
                description: `Output ${index}: ${outputName || 'Route ' + index}`,
                connectionGuidance: `Connect to nodes for the "${outputName || 'route ' + index}" case`
            };
        }
        return {
            description: outputName || `Output ${index}`,
            connectionGuidance: `Connect to downstream nodes`
        };
    }
    getCommonAIToolUseCases(nodeType) {
        const useCaseMap = {
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
        for (const [key, useCases] of Object.entries(useCaseMap)) {
            if (nodeType.includes(key)) {
                return useCases;
            }
        }
        return [
            'Perform automated actions',
            'Integrate with external services',
            'Process and transform data',
            'Extend AI agent capabilities'
        ];
    }
    buildToolVariantGuidance(node) {
        const isToolVariant = !!node.isToolVariant;
        const hasToolVariant = !!node.hasToolVariant;
        const toolVariantOf = node.toolVariantOf;
        if (!isToolVariant && !hasToolVariant) {
            return undefined;
        }
        if (isToolVariant) {
            return {
                isToolVariant: true,
                toolVariantOf,
                hasToolVariant: false,
                guidance: `This is the Tool variant for AI Agent integration. Use this node type when connecting to AI Agents. The base node is: ${toolVariantOf}`
            };
        }
        if (hasToolVariant && node.nodeType) {
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
    getAIToolExamples(nodeType) {
        const exampleMap = {
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
        for (const [key, example] of Object.entries(exampleMap)) {
            if (nodeType.includes(key)) {
                return example;
            }
        }
        return {
            toolName: 'Custom Tool',
            toolDescription: 'Performs specific operations. Describe what this tool does and when to use it.',
            nodeConfig: {
                note: 'Configure the node based on its specific requirements'
            }
        };
    }
    async validateNodeMinimal(nodeType, config) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const normalizedType = node_type_normalizer_1.NodeTypeNormalizer.normalizeToFullForm(nodeType);
        let node = this.repository.getNode(normalizedType);
        if (!node && normalizedType !== nodeType) {
            node = this.repository.getNode(nodeType);
        }
        if (!node) {
            const alternatives = (0, node_utils_1.getNodeTypeAlternatives)(normalizedType);
            for (const alt of alternatives) {
                const found = this.repository.getNode(alt);
                if (found) {
                    node = found;
                    break;
                }
            }
        }
        if (!node) {
            throw new Error(`Node ${nodeType} not found`);
        }
        const properties = node.properties || [];
        const configWithVersion = {
            '@version': node.version || 1,
            ...(config || {})
        };
        const missingFields = [];
        for (const prop of properties) {
            if (!prop.required)
                continue;
            if (prop.displayOptions && !config_validator_1.ConfigValidator.isPropertyVisible(prop, configWithVersion)) {
                continue;
            }
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
    async getToolsDocumentation(topic, depth = 'essentials') {
        if (!topic || topic === 'overview') {
            return (0, tools_documentation_1.getToolsOverview)(depth);
        }
        return (0, tools_documentation_1.getToolDocumentation)(topic, depth);
    }
    async connect(transport) {
        await this.ensureInitialized();
        await this.server.connect(transport);
        logger_1.logger.info('MCP Server connected', {
            transportType: transport.constructor.name
        });
    }
    async listTemplates(limit = 10, offset = 0, sortBy = 'views', includeMetadata = false) {
        await this.ensureInitialized();
        if (!this.templateService)
            throw new Error('Template service not initialized');
        const result = await this.templateService.listTemplates(limit, offset, sortBy, includeMetadata);
        return {
            ...result,
            tip: result.items.length > 0 ?
                `Use get_template(templateId) to get full workflow details. Total: ${result.total} templates available.` :
                "No templates found. Run 'npm run fetch:templates' to update template database"
        };
    }
    async listNodeTemplates(nodeTypes, limit = 10, offset = 0) {
        await this.ensureInitialized();
        if (!this.templateService)
            throw new Error('Template service not initialized');
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
    async getTemplate(templateId, mode = 'full') {
        await this.ensureInitialized();
        if (!this.templateService)
            throw new Error('Template service not initialized');
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
    async searchTemplates(query, limit = 20, offset = 0, fields) {
        await this.ensureInitialized();
        if (!this.templateService)
            throw new Error('Template service not initialized');
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
    async getTemplatesForTask(task, limit = 10, offset = 0) {
        await this.ensureInitialized();
        if (!this.templateService)
            throw new Error('Template service not initialized');
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
    async searchTemplatesByMetadata(filters, limit = 20, offset = 0) {
        await this.ensureInitialized();
        if (!this.templateService)
            throw new Error('Template service not initialized');
        const result = await this.templateService.searchTemplatesByMetadata(filters, limit, offset);
        const filterSummary = [];
        if (filters.category)
            filterSummary.push(`category: ${filters.category}`);
        if (filters.complexity)
            filterSummary.push(`complexity: ${filters.complexity}`);
        if (filters.maxSetupMinutes)
            filterSummary.push(`max setup: ${filters.maxSetupMinutes} min`);
        if (filters.minSetupMinutes)
            filterSummary.push(`min setup: ${filters.minSetupMinutes} min`);
        if (filters.requiredService)
            filterSummary.push(`service: ${filters.requiredService}`);
        if (filters.targetAudience)
            filterSummary.push(`audience: ${filters.targetAudience}`);
        if (result.items.length === 0 && offset === 0) {
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
    getTaskDescription(task) {
        const descriptions = {
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
    async validateWorkflow(workflow, options) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        logger_1.logger.info('Workflow validation requested', {
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
        if (!workflow || typeof workflow !== 'object') {
            return {
                valid: false,
                errors: [{
                        node: 'workflow',
                        message: 'Workflow must be an object with nodes and connections',
                        details: 'Expected format: ' + (0, workflow_examples_1.getWorkflowExampleString)()
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
                        details: 'Expected: workflow.nodes = [array of node objects]. ' + (0, workflow_examples_1.getWorkflowExampleString)()
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
                        details: 'Expected: workflow.connections = {} (can be empty object). ' + (0, workflow_examples_1.getWorkflowExampleString)()
                    }],
                summary: { errorCount: 1 }
            };
        }
        const validator = new workflow_validator_1.WorkflowValidator(this.repository, enhanced_config_validator_1.EnhancedConfigValidator);
        try {
            const result = await validator.validateWorkflow(workflow, options);
            const response = {
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
            if (!result.valid && result.errors.length > 0) {
                result.errors.forEach(error => {
                    telemetry_1.telemetry.trackValidationDetails(error.nodeName || 'workflow', error.type || 'validation_error', {
                        message: error.message,
                        nodeCount: workflow.nodes?.length ?? 0,
                        hasConnections: Object.keys(workflow.connections || {}).length > 0
                    });
                });
            }
            if (result.valid) {
                telemetry_1.telemetry.trackWorkflowCreation(workflow, true);
            }
            return response;
        }
        catch (error) {
            logger_1.logger.error('Error validating workflow:', error);
            return {
                valid: false,
                error: error instanceof Error ? error.message : 'Unknown error validating workflow',
                tip: 'Ensure the workflow JSON includes nodes array and connections object'
            };
        }
    }
    async validateWorkflowConnections(workflow) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const validator = new workflow_validator_1.WorkflowValidator(this.repository, enhanced_config_validator_1.EnhancedConfigValidator);
        try {
            const result = await validator.validateWorkflow(workflow, {
                validateNodes: false,
                validateConnections: true,
                validateExpressions: false
            });
            const response = {
                valid: result.errors.length === 0,
                statistics: {
                    totalNodes: result.statistics.totalNodes,
                    triggerNodes: result.statistics.triggerNodes,
                    validConnections: result.statistics.validConnections,
                    invalidConnections: result.statistics.invalidConnections
                }
            };
            const connectionErrors = result.errors.filter(e => e.message.includes('connection') ||
                e.message.includes('cycle') ||
                e.message.includes('orphaned'));
            const connectionWarnings = result.warnings.filter(w => w.message.includes('connection') ||
                w.message.includes('orphaned') ||
                w.message.includes('trigger'));
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
        }
        catch (error) {
            logger_1.logger.error('Error validating workflow connections:', error);
            return {
                valid: false,
                error: error instanceof Error ? error.message : 'Unknown error validating connections'
            };
        }
    }
    async validateWorkflowExpressions(workflow) {
        await this.ensureInitialized();
        if (!this.repository)
            throw new Error('Repository not initialized');
        const validator = new workflow_validator_1.WorkflowValidator(this.repository, enhanced_config_validator_1.EnhancedConfigValidator);
        try {
            const result = await validator.validateWorkflow(workflow, {
                validateNodes: false,
                validateConnections: false,
                validateExpressions: true
            });
            const response = {
                valid: result.errors.length === 0,
                statistics: {
                    totalNodes: result.statistics.totalNodes,
                    expressionsValidated: result.statistics.expressionsValidated
                }
            };
            const expressionErrors = result.errors.filter(e => e.message.includes('Expression') ||
                e.message.includes('$') ||
                e.message.includes('{{'));
            const expressionWarnings = result.warnings.filter(w => w.message.includes('Expression') ||
                w.message.includes('$') ||
                w.message.includes('{{'));
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
            if (expressionErrors.length > 0 || expressionWarnings.length > 0) {
                response.tips = [
                    'Use {{ }} to wrap expressions',
                    'Reference data with $json.propertyName',
                    'Reference other nodes with $node["Node Name"].json',
                    'Use $input.item for input data in loops'
                ];
            }
            return response;
        }
        catch (error) {
            logger_1.logger.error('Error validating workflow expressions:', error);
            return {
                valid: false,
                error: error instanceof Error ? error.message : 'Unknown error validating expressions'
            };
        }
    }
    async run() {
        await this.ensureInitialized();
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        if (!process.stdout.isTTY || process.env.IS_DOCKER) {
            const originalWrite = process.stdout.write.bind(process.stdout);
            process.stdout.write = function (chunk, encoding, callback) {
                const result = originalWrite(chunk, encoding, callback);
                process.stdout.emit('drain');
                return result;
            };
        }
        logger_1.logger.info('n8n Documentation MCP Server running on stdio transport');
        process.stdin.resume();
    }
    async shutdown() {
        if (this.isShutdown) {
            logger_1.logger.debug('Shutdown already called, skipping');
            return;
        }
        this.isShutdown = true;
        logger_1.logger.info('Shutting down MCP server...');
        try {
            await this.initialized;
        }
        catch (error) {
            logger_1.logger.debug('Initialization had failed, proceeding with cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        try {
            await this.server.close();
        }
        catch (error) {
            logger_1.logger.error('Error closing MCP server:', error);
        }
        if (this.cache) {
            try {
                this.cache.destroy();
                logger_1.logger.info('Cache timers cleaned up');
            }
            catch (error) {
                logger_1.logger.error('Error cleaning up cache:', error);
            }
        }
        if (this.useSharedDatabase && this.sharedDbState) {
            try {
                (0, shared_database_1.releaseSharedDatabase)(this.sharedDbState);
                logger_1.logger.info('Released shared database reference');
            }
            catch (error) {
                logger_1.logger.error('Error releasing shared database:', error);
            }
        }
        else if (this.db) {
            try {
                this.db.close();
                logger_1.logger.info('Database connection closed');
            }
            catch (error) {
                logger_1.logger.error('Error closing database:', error);
            }
        }
        this.db = null;
        this.repository = null;
        this.templateService = null;
        this.earlyLogger = null;
        this.sharedDbState = null;
    }
}
exports.N8NDocumentationMCPServer = N8NDocumentationMCPServer;
//# sourceMappingURL=server.js.map