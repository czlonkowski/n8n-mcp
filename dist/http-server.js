#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAuthToken = loadAuthToken;
exports.startFixedHTTPServer = startFixedHTTPServer;
const express_1 = __importDefault(require("express"));
const tools_1 = require("./mcp/tools");
const tools_n8n_manager_1 = require("./mcp/tools-n8n-manager");
const server_1 = require("./mcp/server");
const logger_1 = require("./utils/logger");
const auth_1 = require("./utils/auth");
const version_1 = require("./utils/version");
const n8n_api_1 = require("./config/n8n-api");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
const url_detector_1 = require("./utils/url-detector");
const protocol_version_1 = require("./utils/protocol-version");
dotenv_1.default.config();
let expressServer;
let authToken = null;
function loadAuthToken() {
    if (process.env.AUTH_TOKEN) {
        logger_1.logger.info('Using AUTH_TOKEN from environment variable');
        return process.env.AUTH_TOKEN;
    }
    if (process.env.AUTH_TOKEN_FILE) {
        try {
            const token = (0, fs_1.readFileSync)(process.env.AUTH_TOKEN_FILE, 'utf-8').trim();
            logger_1.logger.info(`Loaded AUTH_TOKEN from file: ${process.env.AUTH_TOKEN_FILE}`);
            return token;
        }
        catch (error) {
            logger_1.logger.error(`Failed to read AUTH_TOKEN_FILE: ${process.env.AUTH_TOKEN_FILE}`, error);
            console.error(`ERROR: Failed to read AUTH_TOKEN_FILE: ${process.env.AUTH_TOKEN_FILE}`);
            console.error(error instanceof Error ? error.message : 'Unknown error');
            return null;
        }
    }
    return null;
}
function validateEnvironment() {
    authToken = loadAuthToken();
    if (!authToken || authToken.trim() === '') {
        logger_1.logger.error('No authentication token found or token is empty');
        console.error('ERROR: AUTH_TOKEN is required for HTTP mode and cannot be empty');
        console.error('Set AUTH_TOKEN environment variable or AUTH_TOKEN_FILE pointing to a file containing the token');
        console.error('Generate AUTH_TOKEN with: openssl rand -base64 32');
        process.exit(1);
    }
    authToken = authToken.trim();
    if (authToken.length < 32) {
        logger_1.logger.warn('AUTH_TOKEN should be at least 32 characters for security');
        console.warn('WARNING: AUTH_TOKEN should be at least 32 characters for security');
    }
    if (authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh') {
        logger_1.logger.warn('⚠️ SECURITY WARNING: Using default AUTH_TOKEN - CHANGE IMMEDIATELY!');
        logger_1.logger.warn('Generate secure token with: openssl rand -base64 32');
        if (process.env.MCP_MODE === 'http') {
            console.warn('\n⚠️  SECURITY WARNING ⚠️');
            console.warn('Using default AUTH_TOKEN - CHANGE IMMEDIATELY!');
            console.warn('Generate secure token: openssl rand -base64 32');
            console.warn('Update via Railway dashboard environment variables\n');
        }
    }
}
async function shutdown() {
    logger_1.logger.info('Shutting down HTTP server...');
    console.log('Shutting down HTTP server...');
    if (expressServer) {
        expressServer.close(() => {
            logger_1.logger.info('HTTP server closed');
            console.log('HTTP server closed');
            process.exit(0);
        });
        setTimeout(() => {
            logger_1.logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    }
    else {
        process.exit(0);
    }
}
async function startFixedHTTPServer() {
    logger_1.logger.warn('DEPRECATION: startFixedHTTPServer() is deprecated as of v2.31.8. ' +
        'Use SingleSessionHTTPServer which supports SSE streaming. ' +
        'See: https://github.com/czlonkowski/n8n-mcp/issues/524');
    validateEnvironment();
    const app = (0, express_1.default)();
    const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0;
    if (trustProxy > 0) {
        app.set('trust proxy', trustProxy);
        logger_1.logger.info(`Trust proxy enabled with ${trustProxy} hop(s)`);
    }
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        next();
    });
    app.use((req, res, next) => {
        const allowedOrigin = process.env.CORS_ORIGIN || '*';
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
        res.setHeader('Access-Control-Max-Age', '86400');
        if (req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });
    app.use((req, res, next) => {
        logger_1.logger.info(`${req.method} ${req.path}`, {
            ip: req.ip,
            userAgent: req.get('user-agent'),
            contentLength: req.get('content-length')
        });
        next();
    });
    const mcpServer = new server_1.N8NDocumentationMCPServer();
    logger_1.logger.info('Created persistent MCP server instance');
    app.get('/', (req, res) => {
        const port = parseInt(process.env.PORT || '3000');
        const host = process.env.HOST || '0.0.0.0';
        const baseUrl = (0, url_detector_1.detectBaseUrl)(req, host, port);
        const endpoints = (0, url_detector_1.formatEndpointUrls)(baseUrl);
        res.json({
            name: 'n8n Documentation MCP Server',
            version: version_1.PROJECT_VERSION,
            description: 'Model Context Protocol server providing comprehensive n8n node documentation and workflow management',
            endpoints: {
                health: {
                    url: endpoints.health,
                    method: 'GET',
                    description: 'Health check and status information'
                },
                mcp: {
                    url: endpoints.mcp,
                    method: 'GET/POST',
                    description: 'MCP endpoint - GET for info, POST for JSON-RPC'
                }
            },
            authentication: {
                type: 'Bearer Token',
                header: 'Authorization: Bearer <token>',
                required_for: ['POST /mcp']
            },
            documentation: 'https://github.com/czlonkowski/n8n-mcp'
        });
    });
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            mode: 'http-fixed',
            version: version_1.PROJECT_VERSION,
            uptime: Math.floor(process.uptime()),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                unit: 'MB'
            },
            timestamp: new Date().toISOString()
        });
    });
    app.get('/version', (req, res) => {
        res.json({
            version: version_1.PROJECT_VERSION,
            buildTime: new Date().toISOString(),
            tools: tools_1.n8nDocumentationToolsFinal.map(t => t.name),
            commit: process.env.GIT_COMMIT || 'unknown'
        });
    });
    app.get('/test-tools', async (req, res) => {
        try {
            const result = await mcpServer.executeTool('get_node_essentials', { nodeType: 'nodes-base.httpRequest' });
            res.json({ status: 'ok', hasData: !!result, toolCount: tools_1.n8nDocumentationToolsFinal.length });
        }
        catch (error) {
            res.json({ status: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
        }
    });
    app.get('/mcp', (req, res) => {
        res.json({
            description: 'n8n Documentation MCP Server',
            version: version_1.PROJECT_VERSION,
            endpoints: {
                mcp: {
                    method: 'POST',
                    path: '/mcp',
                    description: 'Main MCP JSON-RPC endpoint',
                    authentication: 'Bearer token required'
                },
                health: {
                    method: 'GET',
                    path: '/health',
                    description: 'Health check endpoint',
                    authentication: 'None'
                },
                root: {
                    method: 'GET',
                    path: '/',
                    description: 'API information',
                    authentication: 'None'
                }
            },
            documentation: 'https://github.com/czlonkowski/n8n-mcp'
        });
    });
    app.post('/mcp', async (req, res) => {
        const startTime = Date.now();
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            logger_1.logger.warn('Authentication failed: Missing Authorization header', {
                ip: req.ip,
                userAgent: req.get('user-agent'),
                reason: 'no_auth_header'
            });
            res.setHeader('WWW-Authenticate', (0, auth_1.buildBearerChallenge)('no_auth_header'));
            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'Unauthorized'
                },
                id: null
            });
            return;
        }
        if (!authHeader.startsWith('Bearer ')) {
            logger_1.logger.warn('Authentication failed: Invalid Authorization header format (expected Bearer token)', {
                ip: req.ip,
                userAgent: req.get('user-agent'),
                reason: 'invalid_auth_format',
                headerPrefix: authHeader.substring(0, Math.min(authHeader.length, 10)) + '...'
            });
            res.setHeader('WWW-Authenticate', (0, auth_1.buildBearerChallenge)('invalid_auth_format'));
            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'Unauthorized'
                },
                id: null
            });
            return;
        }
        const token = authHeader.slice(7).trim();
        const isValidToken = authToken &&
            auth_1.AuthManager.timingSafeCompare(token, authToken);
        if (!isValidToken) {
            logger_1.logger.warn('Authentication failed: Invalid token', {
                ip: req.ip,
                userAgent: req.get('user-agent'),
                reason: 'invalid_token'
            });
            res.setHeader('WWW-Authenticate', (0, auth_1.buildBearerChallenge)('invalid_token'));
            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'Unauthorized'
                },
                id: null
            });
            return;
        }
        try {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', async () => {
                try {
                    const jsonRpcRequest = JSON.parse(body);
                    logger_1.logger.debug('Received JSON-RPC request:', { method: jsonRpcRequest.method });
                    let response;
                    switch (jsonRpcRequest.method) {
                        case 'initialize':
                            const negotiationResult = (0, protocol_version_1.negotiateProtocolVersion)(jsonRpcRequest.params?.protocolVersion, jsonRpcRequest.params?.clientInfo, req.get('user-agent'), req.headers);
                            (0, protocol_version_1.logProtocolNegotiation)(negotiationResult, logger_1.logger, 'HTTP_SERVER_INITIALIZE');
                            response = {
                                jsonrpc: '2.0',
                                result: {
                                    protocolVersion: negotiationResult.version,
                                    capabilities: {
                                        tools: {},
                                        resources: {}
                                    },
                                    serverInfo: {
                                        name: 'n8n-documentation-mcp',
                                        version: version_1.PROJECT_VERSION
                                    }
                                },
                                id: jsonRpcRequest.id
                            };
                            break;
                        case 'tools/list':
                            const tools = [...tools_1.n8nDocumentationToolsFinal];
                            if ((0, n8n_api_1.isN8nApiConfigured)()) {
                                tools.push(...tools_n8n_manager_1.n8nManagementTools);
                            }
                            response = {
                                jsonrpc: '2.0',
                                result: {
                                    tools
                                },
                                id: jsonRpcRequest.id
                            };
                            break;
                        case 'tools/call':
                            const toolName = jsonRpcRequest.params?.name;
                            const toolArgs = jsonRpcRequest.params?.arguments || {};
                            try {
                                const result = await mcpServer.executeTool(toolName, toolArgs);
                                let responseText = JSON.stringify(result, null, 2);
                                const mcpResult = {
                                    content: [
                                        {
                                            type: 'text',
                                            text: responseText
                                        }
                                    ]
                                };
                                if (toolName.startsWith('validate_')) {
                                    const resultSize = responseText.length;
                                    if (resultSize > 1000000) {
                                        logger_1.logger.warn(`Validation tool ${toolName} response is very large (${resultSize} chars). ` +
                                            `Truncating for HTTP transport safety.`);
                                        mcpResult.content[0].text = responseText.substring(0, 999000) +
                                            '\n\n[Response truncated due to size limits]';
                                    }
                                    else {
                                        mcpResult.structuredContent = result;
                                    }
                                }
                                response = {
                                    jsonrpc: '2.0',
                                    result: mcpResult,
                                    id: jsonRpcRequest.id
                                };
                            }
                            catch (error) {
                                response = {
                                    jsonrpc: '2.0',
                                    error: {
                                        code: -32603,
                                        message: `Error executing tool ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`
                                    },
                                    id: jsonRpcRequest.id
                                };
                            }
                            break;
                        default:
                            response = {
                                jsonrpc: '2.0',
                                error: {
                                    code: -32601,
                                    message: `Method not found: ${jsonRpcRequest.method}`
                                },
                                id: jsonRpcRequest.id
                            };
                    }
                    res.setHeader('Content-Type', 'application/json');
                    res.json(response);
                    const duration = Date.now() - startTime;
                    logger_1.logger.info('MCP request completed', {
                        duration,
                        method: jsonRpcRequest.method
                    });
                }
                catch (error) {
                    logger_1.logger.error('Error processing request:', error);
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32700,
                            message: 'Parse error',
                            data: error instanceof Error ? error.message : 'Unknown error'
                        },
                        id: null
                    });
                }
            });
        }
        catch (error) {
            logger_1.logger.error('MCP request error:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                        data: process.env.NODE_ENV === 'development'
                            ? error.message
                            : undefined
                    },
                    id: null
                });
            }
        }
    });
    app.use((req, res) => {
        res.status(404).json({
            error: 'Not found',
            message: `Cannot ${req.method} ${req.path}`
        });
    });
    app.use((err, req, res, next) => {
        logger_1.logger.error('Express error handler:', err);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                    data: process.env.NODE_ENV === 'development' ? err.message : undefined
                },
                id: null
            });
        }
    });
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';
    expressServer = app.listen(port, host, () => {
        logger_1.logger.info(`n8n MCP Fixed HTTP Server started`, { port, host });
        const baseUrl = (0, url_detector_1.getStartupBaseUrl)(host, port);
        const endpoints = (0, url_detector_1.formatEndpointUrls)(baseUrl);
        console.log(`n8n MCP Fixed HTTP Server running on ${host}:${port}`);
        console.log(`Health check: ${endpoints.health}`);
        console.log(`MCP endpoint: ${endpoints.mcp}`);
        console.log('\nPress Ctrl+C to stop the server');
        if (authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh') {
            setInterval(() => {
                logger_1.logger.warn('⚠️ Still using default AUTH_TOKEN - security risk!');
                if (process.env.MCP_MODE === 'http') {
                    console.warn('⚠️ REMINDER: Still using default AUTH_TOKEN - please change it!');
                }
            }, 300000);
        }
        if (process.env.BASE_URL || process.env.PUBLIC_URL) {
            console.log(`\nPublic URL configured: ${baseUrl}`);
        }
        else if (process.env.TRUST_PROXY && Number(process.env.TRUST_PROXY) > 0) {
            console.log(`\nNote: TRUST_PROXY is enabled. URLs will be auto-detected from proxy headers.`);
        }
    });
    expressServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            logger_1.logger.error(`Port ${port} is already in use`);
            console.error(`ERROR: Port ${port} is already in use`);
            process.exit(1);
        }
        else {
            logger_1.logger.error('Server error:', error);
            console.error('Server error:', error);
            process.exit(1);
        }
    });
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('uncaughtException', (error) => {
        logger_1.logger.error('Uncaught exception:', error);
        console.error('Uncaught exception:', error);
        shutdown();
    });
    process.on('unhandledRejection', (reason, promise) => {
        logger_1.logger.error('Unhandled rejection:', reason);
        console.error('Unhandled rejection at:', promise, 'reason:', reason);
        shutdown();
    });
}
if (typeof require !== 'undefined' && require.main === module) {
    startFixedHTTPServer().catch(error => {
        logger_1.logger.error('Failed to start Fixed HTTP server:', error);
        console.error('Failed to start Fixed HTTP server:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=http-server.js.map