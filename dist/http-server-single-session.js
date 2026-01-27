#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleSessionHTTPServer = void 0;
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const server_1 = require("./mcp/server");
const console_manager_1 = require("./utils/console-manager");
const logger_1 = require("./utils/logger");
const auth_1 = require("./utils/auth");
const fs_1 = require("fs");
const dotenv_1 = __importDefault(require("dotenv"));
const url_detector_1 = require("./utils/url-detector");
const version_1 = require("./utils/version");
const uuid_1 = require("uuid");
const crypto_1 = require("crypto");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const protocol_version_1 = require("./utils/protocol-version");
const instance_context_1 = require("./types/instance-context");
const shared_database_1 = require("./database/shared-database");
dotenv_1.default.config();
const DEFAULT_PROTOCOL_VERSION = protocol_version_1.STANDARD_PROTOCOL_VERSION;
const MAX_SESSIONS = Math.max(1, parseInt(process.env.N8N_MCP_MAX_SESSIONS || '100', 10));
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000;
function extractMultiTenantHeaders(req) {
    return {
        'x-n8n-url': req.headers['x-n8n-url'],
        'x-n8n-key': req.headers['x-n8n-key'],
        'x-instance-id': req.headers['x-instance-id'],
        'x-session-id': req.headers['x-session-id'],
    };
}
function logSecurityEvent(event, details) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        event,
        ...details
    };
    logger_1.logger.info(`[SECURITY] ${event}`, logEntry);
}
class SingleSessionHTTPServer {
    constructor() {
        this.transports = {};
        this.servers = {};
        this.sessionMetadata = {};
        this.sessionContexts = {};
        this.contextSwitchLocks = new Map();
        this.session = null;
        this.consoleManager = new console_manager_1.ConsoleManager();
        this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '5', 10) * 60 * 1000;
        this.authToken = null;
        this.cleanupTimer = null;
        this.validateEnvironment();
        this.startSessionCleanup();
    }
    startSessionCleanup() {
        this.cleanupTimer = setInterval(async () => {
            try {
                await this.cleanupExpiredSessions();
            }
            catch (error) {
                logger_1.logger.error('Error during session cleanup', error);
            }
        }, SESSION_CLEANUP_INTERVAL);
        logger_1.logger.info('Session cleanup started', {
            interval: SESSION_CLEANUP_INTERVAL / 1000 / 60,
            maxSessions: MAX_SESSIONS,
            sessionTimeout: this.sessionTimeout / 1000 / 60
        });
    }
    cleanupExpiredSessions() {
        const now = Date.now();
        const expiredSessions = [];
        for (const sessionId in this.sessionMetadata) {
            const metadata = this.sessionMetadata[sessionId];
            if (now - metadata.lastAccess.getTime() > this.sessionTimeout) {
                expiredSessions.push(sessionId);
            }
        }
        for (const sessionId in this.sessionContexts) {
            if (!this.sessionMetadata[sessionId]) {
                delete this.sessionContexts[sessionId];
                logger_1.logger.debug('Cleaned orphaned session context', { sessionId });
            }
        }
        for (const sessionId of expiredSessions) {
            this.removeSession(sessionId, 'expired');
        }
        if (expiredSessions.length > 0) {
            logger_1.logger.info('Cleaned up expired sessions', {
                removed: expiredSessions.length,
                remaining: this.getActiveSessionCount()
            });
        }
    }
    async removeSession(sessionId, reason) {
        try {
            const transport = this.transports[sessionId];
            const server = this.servers[sessionId];
            delete this.transports[sessionId];
            delete this.servers[sessionId];
            delete this.sessionMetadata[sessionId];
            delete this.sessionContexts[sessionId];
            if (server && typeof server.close === 'function') {
                try {
                    await server.close();
                }
                catch (serverError) {
                    logger_1.logger.warn('Error closing server', { sessionId, error: serverError });
                }
            }
            if (transport) {
                await transport.close();
            }
            logger_1.logger.info('Session removed', { sessionId, reason });
        }
        catch (error) {
            logger_1.logger.warn('Error removing session', { sessionId, reason, error });
        }
    }
    getActiveSessionCount() {
        return Object.keys(this.transports).length;
    }
    canCreateSession() {
        return this.getActiveSessionCount() < MAX_SESSIONS;
    }
    isValidSessionId(sessionId) {
        return Boolean(sessionId && sessionId.length > 0);
    }
    sanitizeErrorForClient(error) {
        const isProduction = process.env.NODE_ENV === 'production';
        if (error instanceof Error) {
            if (isProduction) {
                if (error.message.includes('Unauthorized') || error.message.includes('authentication')) {
                    return { message: 'Authentication failed', code: 'AUTH_ERROR' };
                }
                if (error.message.includes('Session') || error.message.includes('session')) {
                    return { message: 'Session error', code: 'SESSION_ERROR' };
                }
                if (error.message.includes('Invalid') || error.message.includes('validation')) {
                    return { message: 'Validation error', code: 'VALIDATION_ERROR' };
                }
                return { message: 'Internal server error', code: 'INTERNAL_ERROR' };
            }
            return {
                message: error.message.substring(0, 200),
                code: error.name || 'ERROR'
            };
        }
        return { message: 'An error occurred', code: 'UNKNOWN_ERROR' };
    }
    updateSessionAccess(sessionId) {
        if (this.sessionMetadata[sessionId]) {
            this.sessionMetadata[sessionId].lastAccess = new Date();
        }
    }
    async switchSessionContext(sessionId, newContext) {
        const existingLock = this.contextSwitchLocks.get(sessionId);
        if (existingLock) {
            await existingLock;
            return;
        }
        const switchPromise = this.performContextSwitch(sessionId, newContext);
        this.contextSwitchLocks.set(sessionId, switchPromise);
        try {
            await switchPromise;
        }
        finally {
            this.contextSwitchLocks.delete(sessionId);
        }
    }
    async performContextSwitch(sessionId, newContext) {
        const existingContext = this.sessionContexts[sessionId];
        if (JSON.stringify(existingContext) !== JSON.stringify(newContext)) {
            logger_1.logger.info('Multi-tenant shared mode: Updating instance context for session', {
                sessionId,
                oldInstanceId: existingContext?.instanceId,
                newInstanceId: newContext.instanceId
            });
            this.sessionContexts[sessionId] = newContext;
            if (this.servers[sessionId]) {
                this.servers[sessionId].instanceContext = newContext;
            }
        }
    }
    getSessionMetrics() {
        const now = Date.now();
        let expiredCount = 0;
        for (const sessionId in this.sessionMetadata) {
            const metadata = this.sessionMetadata[sessionId];
            if (now - metadata.lastAccess.getTime() > this.sessionTimeout) {
                expiredCount++;
            }
        }
        return {
            totalSessions: Object.keys(this.sessionMetadata).length,
            activeSessions: this.getActiveSessionCount(),
            expiredSessions: expiredCount,
            lastCleanup: new Date()
        };
    }
    loadAuthToken() {
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
    validateEnvironment() {
        this.authToken = this.loadAuthToken();
        if (!this.authToken || this.authToken.trim() === '') {
            const message = 'No authentication token found or token is empty. Set AUTH_TOKEN environment variable or AUTH_TOKEN_FILE pointing to a file containing the token.';
            logger_1.logger.error(message);
            throw new Error(message);
        }
        this.authToken = this.authToken.trim();
        if (this.authToken.length < 32) {
            logger_1.logger.warn('AUTH_TOKEN should be at least 32 characters for security');
        }
        const isDefaultToken = this.authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh';
        const isProduction = process.env.NODE_ENV === 'production';
        if (isDefaultToken) {
            if (isProduction) {
                const message = 'CRITICAL SECURITY ERROR: Cannot start in production with default AUTH_TOKEN. Generate secure token: openssl rand -base64 32';
                logger_1.logger.error(message);
                console.error('\n🚨 CRITICAL SECURITY ERROR 🚨');
                console.error(message);
                console.error('Set NODE_ENV to development for testing, or update AUTH_TOKEN for production\n');
                throw new Error(message);
            }
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
    async handleRequest(req, res, instanceContext) {
        const startTime = Date.now();
        return this.consoleManager.wrapOperation(async () => {
            try {
                const sessionId = req.headers['mcp-session-id'];
                const isInitialize = req.body ? (0, types_js_1.isInitializeRequest)(req.body) : false;
                logger_1.logger.info('handleRequest: Processing MCP request - SDK PATTERN', {
                    requestId: req.get('x-request-id') || 'unknown',
                    sessionId: sessionId,
                    method: req.method,
                    url: req.url,
                    bodyType: typeof req.body,
                    bodyContent: req.body ? JSON.stringify(req.body, null, 2) : 'undefined',
                    existingTransports: Object.keys(this.transports),
                    isInitializeRequest: isInitialize
                });
                let transport;
                if (isInitialize) {
                    if (!this.canCreateSession()) {
                        logger_1.logger.warn('handleRequest: Session limit reached', {
                            currentSessions: this.getActiveSessionCount(),
                            maxSessions: MAX_SESSIONS
                        });
                        res.status(429).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32000,
                                message: `Session limit reached (${MAX_SESSIONS}). Please wait for existing sessions to expire.`
                            },
                            id: req.body?.id || null
                        });
                        return;
                    }
                    logger_1.logger.info('handleRequest: Creating new transport for initialize request');
                    if (instanceContext?.instanceId) {
                        const sessionsToRemove = [];
                        for (const [existingSessionId, context] of Object.entries(this.sessionContexts)) {
                            if (context?.instanceId === instanceContext.instanceId) {
                                sessionsToRemove.push(existingSessionId);
                            }
                        }
                        for (const oldSessionId of sessionsToRemove) {
                            if (!this.transports[oldSessionId]) {
                                continue;
                            }
                            logger_1.logger.info('Cleaning up previous session for instance', {
                                instanceId: instanceContext.instanceId,
                                oldSession: oldSessionId,
                                reason: 'instance_reconnect'
                            });
                            await this.removeSession(oldSessionId, 'instance_reconnect');
                        }
                    }
                    let sessionIdToUse;
                    const isMultiTenantEnabled = process.env.ENABLE_MULTI_TENANT === 'true';
                    const sessionStrategy = process.env.MULTI_TENANT_SESSION_STRATEGY || 'instance';
                    if (isMultiTenantEnabled && sessionStrategy === 'instance' && instanceContext?.instanceId) {
                        const configHash = (0, crypto_1.createHash)('sha256')
                            .update(JSON.stringify({
                            url: instanceContext.n8nApiUrl,
                            instanceId: instanceContext.instanceId
                        }))
                            .digest('hex')
                            .substring(0, 8);
                        sessionIdToUse = `instance-${instanceContext.instanceId}-${configHash}-${(0, uuid_1.v4)()}`;
                        logger_1.logger.info('Multi-tenant mode: Creating instance-specific session', {
                            instanceId: instanceContext.instanceId,
                            configHash,
                            sessionId: sessionIdToUse
                        });
                    }
                    else {
                        sessionIdToUse = sessionId || (0, uuid_1.v4)();
                    }
                    const server = new server_1.N8NDocumentationMCPServer(instanceContext);
                    transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                        sessionIdGenerator: () => sessionIdToUse,
                        onsessioninitialized: (initializedSessionId) => {
                            logger_1.logger.info('handleRequest: Session initialized, storing transport and server', {
                                sessionId: initializedSessionId
                            });
                            this.transports[initializedSessionId] = transport;
                            this.servers[initializedSessionId] = server;
                            this.sessionMetadata[initializedSessionId] = {
                                lastAccess: new Date(),
                                createdAt: new Date()
                            };
                            this.sessionContexts[initializedSessionId] = instanceContext;
                        }
                    });
                    transport.onclose = () => {
                        const sid = transport.sessionId;
                        if (sid) {
                            logger_1.logger.info('handleRequest: Transport closed, cleaning up', { sessionId: sid });
                            this.removeSession(sid, 'transport_closed');
                        }
                    };
                    transport.onerror = (error) => {
                        const sid = transport.sessionId;
                        logger_1.logger.error('Transport error', { sessionId: sid, error: error.message });
                        if (sid) {
                            this.removeSession(sid, 'transport_error').catch(err => {
                                logger_1.logger.error('Error during transport error cleanup', { error: err });
                            });
                        }
                    };
                    logger_1.logger.info('handleRequest: Connecting server to new transport');
                    await server.connect(transport);
                }
                else if (sessionId && this.transports[sessionId]) {
                    if (!this.isValidSessionId(sessionId)) {
                        logger_1.logger.warn('handleRequest: Invalid session ID format', { sessionId });
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32602,
                                message: 'Invalid session ID format'
                            },
                            id: req.body?.id || null
                        });
                        return;
                    }
                    logger_1.logger.info('handleRequest: Reusing existing transport for session', { sessionId });
                    transport = this.transports[sessionId];
                    const isMultiTenantEnabled = process.env.ENABLE_MULTI_TENANT === 'true';
                    const sessionStrategy = process.env.MULTI_TENANT_SESSION_STRATEGY || 'instance';
                    if (isMultiTenantEnabled && sessionStrategy === 'shared' && instanceContext) {
                        await this.switchSessionContext(sessionId, instanceContext);
                    }
                    this.updateSessionAccess(sessionId);
                }
                else {
                    const errorDetails = {
                        hasSessionId: !!sessionId,
                        isInitialize: isInitialize,
                        sessionIdValid: sessionId ? this.isValidSessionId(sessionId) : false,
                        sessionExists: sessionId ? !!this.transports[sessionId] : false
                    };
                    logger_1.logger.warn('handleRequest: Invalid request - no session ID and not initialize', errorDetails);
                    let errorMessage = 'Bad Request: No valid session ID provided and not an initialize request';
                    if (sessionId && !this.isValidSessionId(sessionId)) {
                        errorMessage = 'Bad Request: Invalid session ID format';
                    }
                    else if (sessionId && !this.transports[sessionId]) {
                        errorMessage = 'Bad Request: Session not found or expired';
                    }
                    res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: errorMessage
                        },
                        id: req.body?.id || null
                    });
                    return;
                }
                logger_1.logger.info('handleRequest: Handling request with transport', {
                    sessionId: isInitialize ? 'new' : sessionId,
                    isInitialize
                });
                await transport.handleRequest(req, res, req.body);
                const duration = Date.now() - startTime;
                logger_1.logger.info('MCP request completed', { duration, sessionId: transport.sessionId });
            }
            catch (error) {
                logger_1.logger.error('handleRequest: MCP request error:', {
                    error: error instanceof Error ? error.message : error,
                    errorName: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    activeTransports: Object.keys(this.transports),
                    requestDetails: {
                        method: req.method,
                        url: req.url,
                        hasBody: !!req.body,
                        sessionId: req.headers['mcp-session-id']
                    },
                    duration: Date.now() - startTime
                });
                if (!res.headersSent) {
                    const sanitizedError = this.sanitizeErrorForClient(error);
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: sanitizedError.message,
                            data: {
                                code: sanitizedError.code
                            }
                        },
                        id: req.body?.id || null
                    });
                }
            }
        });
    }
    async resetSessionSSE(res) {
        if (this.session) {
            const sessionId = this.session.sessionId;
            logger_1.logger.info('Closing previous session for SSE', { sessionId });
            if (this.session.server && typeof this.session.server.close === 'function') {
                try {
                    await this.session.server.close();
                }
                catch (serverError) {
                    logger_1.logger.warn('Error closing server for SSE session', { sessionId, error: serverError });
                }
            }
            try {
                await this.session.transport.close();
            }
            catch (transportError) {
                logger_1.logger.warn('Error closing transport for SSE session', { sessionId, error: transportError });
            }
        }
        try {
            logger_1.logger.info('Creating new N8NDocumentationMCPServer for SSE...');
            const server = new server_1.N8NDocumentationMCPServer();
            const sessionId = (0, uuid_1.v4)();
            logger_1.logger.info('Creating SSEServerTransport...');
            const transport = new sse_js_1.SSEServerTransport('/mcp', res);
            logger_1.logger.info('Connecting server to SSE transport...');
            await server.connect(transport);
            this.session = {
                server,
                transport,
                lastAccess: new Date(),
                sessionId,
                initialized: false,
                isSSE: true
            };
            logger_1.logger.info('Created new SSE session successfully', { sessionId: this.session.sessionId });
        }
        catch (error) {
            logger_1.logger.error('Failed to create SSE session:', error);
            throw error;
        }
    }
    isExpired() {
        if (!this.session)
            return true;
        return Date.now() - this.session.lastAccess.getTime() > this.sessionTimeout;
    }
    isSessionExpired(sessionId) {
        const metadata = this.sessionMetadata[sessionId];
        if (!metadata)
            return true;
        return Date.now() - metadata.lastAccess.getTime() > this.sessionTimeout;
    }
    async start() {
        const app = (0, express_1.default)();
        const jsonParser = express_1.default.json({ limit: '10mb' });
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
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id');
            res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
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
            const activeTransports = Object.keys(this.transports);
            const activeServers = Object.keys(this.servers);
            const sessionMetrics = this.getSessionMetrics();
            const isProduction = process.env.NODE_ENV === 'production';
            const isDefaultToken = this.authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh';
            res.json({
                status: 'ok',
                mode: 'sdk-pattern-transports',
                version: version_1.PROJECT_VERSION,
                environment: process.env.NODE_ENV || 'development',
                uptime: Math.floor(process.uptime()),
                sessions: {
                    active: sessionMetrics.activeSessions,
                    total: sessionMetrics.totalSessions,
                    expired: sessionMetrics.expiredSessions,
                    max: MAX_SESSIONS,
                    usage: `${sessionMetrics.activeSessions}/${MAX_SESSIONS}`,
                    sessionIds: activeTransports
                },
                security: {
                    production: isProduction,
                    defaultToken: isDefaultToken,
                    tokenLength: this.authToken?.length || 0
                },
                activeTransports: activeTransports.length,
                activeServers: activeServers.length,
                legacySessionActive: !!this.session,
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    unit: 'MB'
                },
                timestamp: new Date().toISOString()
            });
        });
        app.post('/mcp/test', jsonParser, async (req, res) => {
            logger_1.logger.info('TEST ENDPOINT: Manual test request received', {
                method: req.method,
                headers: req.headers,
                body: req.body,
                bodyType: typeof req.body,
                bodyContent: req.body ? JSON.stringify(req.body, null, 2) : 'undefined'
            });
            const negotiationResult = (0, protocol_version_1.negotiateProtocolVersion)(undefined, undefined, req.get('user-agent'), req.headers);
            (0, protocol_version_1.logProtocolNegotiation)(negotiationResult, logger_1.logger, 'TEST_ENDPOINT');
            const testResponse = {
                jsonrpc: '2.0',
                id: req.body?.id || 1,
                result: {
                    protocolVersion: negotiationResult.version,
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'n8n-mcp',
                        version: version_1.PROJECT_VERSION
                    }
                }
            };
            logger_1.logger.info('TEST ENDPOINT: Sending test response', {
                response: testResponse
            });
            res.json(testResponse);
        });
        app.get('/mcp', async (req, res) => {
            const sessionId = req.headers['mcp-session-id'];
            if (sessionId && this.transports[sessionId]) {
                try {
                    await this.transports[sessionId].handleRequest(req, res, undefined);
                    return;
                }
                catch (error) {
                    logger_1.logger.error('StreamableHTTP GET request failed:', error);
                }
            }
            const accept = req.headers.accept;
            if (accept && accept.includes('text/event-stream')) {
                logger_1.logger.info('SSE stream request received - establishing SSE connection');
                try {
                    await this.resetSessionSSE(res);
                    logger_1.logger.info('SSE connection established successfully');
                }
                catch (error) {
                    logger_1.logger.error('Failed to establish SSE connection:', error);
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Failed to establish SSE connection'
                        },
                        id: null
                    });
                }
                return;
            }
            if (process.env.N8N_MODE === 'true') {
                const negotiationResult = (0, protocol_version_1.negotiateProtocolVersion)(undefined, undefined, req.get('user-agent'), req.headers);
                (0, protocol_version_1.logProtocolNegotiation)(negotiationResult, logger_1.logger, 'N8N_MODE_GET');
                res.json({
                    protocolVersion: negotiationResult.version,
                    serverInfo: {
                        name: 'n8n-mcp',
                        version: version_1.PROJECT_VERSION,
                        capabilities: {
                            tools: {}
                        }
                    }
                });
                return;
            }
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
        app.delete('/mcp', async (req, res) => {
            const mcpSessionId = req.headers['mcp-session-id'];
            if (!mcpSessionId) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: 'Mcp-Session-Id header is required'
                    },
                    id: null
                });
                return;
            }
            if (!this.isValidSessionId(mcpSessionId)) {
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32602,
                        message: 'Invalid session ID format'
                    },
                    id: null
                });
                return;
            }
            if (this.transports[mcpSessionId]) {
                logger_1.logger.info('Terminating session via DELETE request', { sessionId: mcpSessionId });
                try {
                    await this.removeSession(mcpSessionId, 'manual_termination');
                    res.status(204).send();
                }
                catch (error) {
                    logger_1.logger.error('Error terminating session:', error);
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Error terminating session'
                        },
                        id: null
                    });
                }
            }
            else {
                res.status(404).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32001,
                        message: 'Session not found'
                    },
                    id: null
                });
            }
        });
        const authLimiter = (0, express_rate_limit_1.default)({
            windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || '900000'),
            max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20'),
            message: {
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Too many authentication attempts. Please try again later.'
                },
                id: null
            },
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                logger_1.logger.warn('Rate limit exceeded', {
                    ip: req.ip,
                    userAgent: req.get('user-agent'),
                    event: 'rate_limit'
                });
                res.status(429).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Too many authentication attempts'
                    },
                    id: null
                });
            }
        });
        app.post('/mcp', authLimiter, jsonParser, async (req, res) => {
            logger_1.logger.info('POST /mcp request received - DETAILED DEBUG', {
                headers: req.headers,
                readable: req.readable,
                readableEnded: req.readableEnded,
                complete: req.complete,
                bodyType: typeof req.body,
                bodyContent: req.body ? JSON.stringify(req.body, null, 2) : 'undefined',
                contentLength: req.get('content-length'),
                contentType: req.get('content-type'),
                userAgent: req.get('user-agent'),
                ip: req.ip,
                method: req.method,
                url: req.url,
                originalUrl: req.originalUrl
            });
            const sessionId = req.headers['mcp-session-id'];
            if (typeof req.on === 'function') {
                const closeHandler = () => {
                    if (!res.headersSent && sessionId) {
                        logger_1.logger.info('Connection closed before response sent', { sessionId });
                        setImmediate(() => {
                            if (this.sessionMetadata[sessionId]) {
                                const metadata = this.sessionMetadata[sessionId];
                                const timeSinceAccess = Date.now() - metadata.lastAccess.getTime();
                                if (timeSinceAccess > 60000) {
                                    this.removeSession(sessionId, 'connection_closed').catch(err => {
                                        logger_1.logger.error('Error during connection close cleanup', { error: err });
                                    });
                                }
                            }
                        });
                    }
                };
                req.on('close', closeHandler);
                res.on('finish', () => {
                    req.removeListener('close', closeHandler);
                });
            }
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                logger_1.logger.warn('Authentication failed: Missing Authorization header', {
                    ip: req.ip,
                    userAgent: req.get('user-agent'),
                    reason: 'no_auth_header'
                });
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
            const isValidToken = this.authToken &&
                auth_1.AuthManager.timingSafeCompare(token, this.authToken);
            if (!isValidToken) {
                logger_1.logger.warn('Authentication failed: Invalid token', {
                    ip: req.ip,
                    userAgent: req.get('user-agent'),
                    reason: 'invalid_token'
                });
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
            logger_1.logger.info('Authentication successful - proceeding to handleRequest', {
                hasSession: !!this.session,
                sessionType: this.session?.isSSE ? 'SSE' : 'StreamableHTTP',
                sessionInitialized: this.session?.initialized
            });
            const instanceContext = (() => {
                const headers = extractMultiTenantHeaders(req);
                const hasUrl = headers['x-n8n-url'];
                const hasKey = headers['x-n8n-key'];
                if (!hasUrl && !hasKey)
                    return undefined;
                const context = {
                    n8nApiUrl: hasUrl || undefined,
                    n8nApiKey: hasKey || undefined,
                    instanceId: headers['x-instance-id'] || undefined,
                    sessionId: headers['x-session-id'] || undefined
                };
                if (req.headers['user-agent'] || req.ip) {
                    context.metadata = {
                        userAgent: req.headers['user-agent'],
                        ip: req.ip
                    };
                }
                const validation = (0, instance_context_1.validateInstanceContext)(context);
                if (!validation.valid) {
                    logger_1.logger.warn('Invalid instance context from headers', {
                        errors: validation.errors,
                        hasUrl: !!hasUrl,
                        hasKey: !!hasKey
                    });
                    return undefined;
                }
                return context;
            })();
            if (instanceContext) {
                logger_1.logger.debug('Instance context extracted from headers', {
                    hasUrl: !!instanceContext.n8nApiUrl,
                    hasKey: !!instanceContext.n8nApiKey,
                    instanceId: instanceContext.instanceId ? instanceContext.instanceId.substring(0, 8) + '...' : undefined,
                    sessionId: instanceContext.sessionId ? instanceContext.sessionId.substring(0, 8) + '...' : undefined,
                    urlDomain: instanceContext.n8nApiUrl ? new URL(instanceContext.n8nApiUrl).hostname : undefined
                });
            }
            await this.handleRequest(req, res, instanceContext);
            logger_1.logger.info('POST /mcp request completed - checking response status', {
                responseHeadersSent: res.headersSent,
                responseStatusCode: res.statusCode,
                responseFinished: res.finished
            });
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
        this.expressServer = app.listen(port, host, () => {
            const isProduction = process.env.NODE_ENV === 'production';
            const isDefaultToken = this.authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh';
            logger_1.logger.info(`n8n MCP Single-Session HTTP Server started`, {
                port,
                host,
                environment: process.env.NODE_ENV || 'development',
                maxSessions: MAX_SESSIONS,
                sessionTimeout: this.sessionTimeout / 1000 / 60,
                production: isProduction,
                defaultToken: isDefaultToken
            });
            const baseUrl = (0, url_detector_1.getStartupBaseUrl)(host, port);
            const endpoints = (0, url_detector_1.formatEndpointUrls)(baseUrl);
            console.log(`n8n MCP Single-Session HTTP Server running on ${host}:${port}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Session Limits: ${MAX_SESSIONS} max sessions, ${this.sessionTimeout / 1000 / 60}min timeout`);
            console.log(`Health check: ${endpoints.health}`);
            console.log(`MCP endpoint: ${endpoints.mcp}`);
            if (isProduction) {
                console.log('🔒 Running in PRODUCTION mode - enhanced security enabled');
            }
            else {
                console.log('🛠️ Running in DEVELOPMENT mode');
            }
            console.log('\nPress Ctrl+C to stop the server');
            if (isDefaultToken && !isProduction) {
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
        this.expressServer.on('error', (error) => {
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
    }
    async shutdown() {
        logger_1.logger.info('Shutting down Single-Session HTTP server...');
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            logger_1.logger.info('Session cleanup timer stopped');
        }
        const sessionIds = Object.keys(this.transports);
        logger_1.logger.info(`Closing ${sessionIds.length} active sessions`);
        for (const sessionId of sessionIds) {
            try {
                logger_1.logger.info(`Closing transport for session ${sessionId}`);
                await this.removeSession(sessionId, 'server_shutdown');
            }
            catch (error) {
                logger_1.logger.warn(`Error closing transport for session ${sessionId}:`, error);
            }
        }
        if (this.session) {
            try {
                await this.session.transport.close();
                logger_1.logger.info('Legacy session closed');
            }
            catch (error) {
                logger_1.logger.warn('Error closing legacy session:', error);
            }
            this.session = null;
        }
        if (this.expressServer) {
            await new Promise((resolve) => {
                this.expressServer.close(() => {
                    logger_1.logger.info('HTTP server closed');
                    resolve();
                });
            });
        }
        try {
            await (0, shared_database_1.closeSharedDatabase)();
            logger_1.logger.info('Shared database closed');
        }
        catch (error) {
            logger_1.logger.warn('Error closing shared database:', error);
        }
        logger_1.logger.info('Single-Session HTTP server shutdown completed');
    }
    getSessionInfo() {
        const metrics = this.getSessionMetrics();
        if (!this.session) {
            return {
                active: false,
                sessions: {
                    total: metrics.totalSessions,
                    active: metrics.activeSessions,
                    expired: metrics.expiredSessions,
                    max: MAX_SESSIONS,
                    sessionIds: Object.keys(this.transports)
                }
            };
        }
        return {
            active: true,
            sessionId: this.session.sessionId,
            age: Date.now() - this.session.lastAccess.getTime(),
            sessions: {
                total: metrics.totalSessions,
                active: metrics.activeSessions,
                expired: metrics.expiredSessions,
                max: MAX_SESSIONS,
                sessionIds: Object.keys(this.transports)
            }
        };
    }
    exportSessionState() {
        const sessions = [];
        const seenSessionIds = new Set();
        for (const sessionId of Object.keys(this.sessionMetadata)) {
            if (seenSessionIds.has(sessionId)) {
                logger_1.logger.warn(`Duplicate sessionId detected during export: ${sessionId}`);
                continue;
            }
            if (this.isSessionExpired(sessionId)) {
                continue;
            }
            const metadata = this.sessionMetadata[sessionId];
            const context = this.sessionContexts[sessionId];
            if (!context || !context.n8nApiUrl || !context.n8nApiKey) {
                logger_1.logger.debug(`Skipping session ${sessionId} - missing required context`);
                continue;
            }
            seenSessionIds.add(sessionId);
            sessions.push({
                sessionId,
                metadata: {
                    createdAt: metadata.createdAt.toISOString(),
                    lastAccess: metadata.lastAccess.toISOString()
                },
                context: {
                    n8nApiUrl: context.n8nApiUrl,
                    n8nApiKey: context.n8nApiKey,
                    instanceId: context.instanceId || sessionId,
                    sessionId: context.sessionId,
                    metadata: context.metadata
                }
            });
        }
        logger_1.logger.info(`Exported ${sessions.length} session(s) for persistence`);
        logSecurityEvent('session_export', { count: sessions.length });
        return sessions;
    }
    restoreSessionState(sessions) {
        let restoredCount = 0;
        for (const sessionState of sessions) {
            try {
                if (!sessionState || typeof sessionState !== 'object' || !sessionState.sessionId) {
                    logger_1.logger.warn('Skipping invalid session state object');
                    continue;
                }
                if (Object.keys(this.sessionMetadata).length >= MAX_SESSIONS) {
                    logger_1.logger.warn(`Reached MAX_SESSIONS limit (${MAX_SESSIONS}), skipping remaining sessions`);
                    logSecurityEvent('max_sessions_reached', { count: MAX_SESSIONS });
                    break;
                }
                if (this.sessionMetadata[sessionState.sessionId]) {
                    logger_1.logger.debug(`Skipping session ${sessionState.sessionId} - already exists`);
                    continue;
                }
                const createdAt = new Date(sessionState.metadata.createdAt);
                const lastAccess = new Date(sessionState.metadata.lastAccess);
                if (isNaN(createdAt.getTime()) || isNaN(lastAccess.getTime())) {
                    logger_1.logger.warn(`Skipping session ${sessionState.sessionId} - invalid date format`);
                    continue;
                }
                const age = Date.now() - lastAccess.getTime();
                if (age > this.sessionTimeout) {
                    logger_1.logger.debug(`Skipping session ${sessionState.sessionId} - expired (age: ${Math.round(age / 1000)}s)`);
                    continue;
                }
                if (!sessionState.context) {
                    logger_1.logger.warn(`Skipping session ${sessionState.sessionId} - missing context`);
                    continue;
                }
                const validation = (0, instance_context_1.validateInstanceContext)(sessionState.context);
                if (!validation.valid) {
                    const reason = validation.errors?.join(', ') || 'invalid context';
                    logger_1.logger.warn(`Skipping session ${sessionState.sessionId} - invalid context: ${reason}`);
                    logSecurityEvent('session_restore_failed', {
                        sessionId: sessionState.sessionId,
                        reason
                    });
                    continue;
                }
                this.sessionMetadata[sessionState.sessionId] = {
                    createdAt,
                    lastAccess
                };
                this.sessionContexts[sessionState.sessionId] = {
                    n8nApiUrl: sessionState.context.n8nApiUrl,
                    n8nApiKey: sessionState.context.n8nApiKey,
                    instanceId: sessionState.context.instanceId,
                    sessionId: sessionState.context.sessionId,
                    metadata: sessionState.context.metadata
                };
                logger_1.logger.debug(`Restored session ${sessionState.sessionId}`);
                logSecurityEvent('session_restore', {
                    sessionId: sessionState.sessionId,
                    instanceId: sessionState.context.instanceId
                });
                restoredCount++;
            }
            catch (error) {
                logger_1.logger.error(`Failed to restore session ${sessionState.sessionId}:`, error);
                logSecurityEvent('session_restore_failed', {
                    sessionId: sessionState.sessionId,
                    reason: error instanceof Error ? error.message : 'unknown error'
                });
            }
        }
        logger_1.logger.info(`Restored ${restoredCount}/${sessions.length} session(s) from persistence`);
        return restoredCount;
    }
}
exports.SingleSessionHTTPServer = SingleSessionHTTPServer;
if (require.main === module) {
    const server = new SingleSessionHTTPServer();
    const shutdown = async () => {
        await server.shutdown();
        process.exit(0);
    };
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
    server.start().catch(error => {
        logger_1.logger.error('Failed to start Single-Session HTTP server:', error);
        console.error('Failed to start Single-Session HTTP server:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=http-server-single-session.js.map