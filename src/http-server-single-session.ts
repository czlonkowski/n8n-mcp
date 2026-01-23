#!/usr/bin/env node
/**
 * Single-Session HTTP server for n8n-MCP
 * Implements Hybrid Single-Session Architecture for protocol compliance
 * while maintaining simplicity for single-player use case
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { N8NDocumentationMCPServer } from './mcp/server';
import { ConsoleManager } from './utils/console-manager';
import { logger } from './utils/logger';
import { AuthManager } from './utils/auth';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { getStartupBaseUrl, formatEndpointUrls, detectBaseUrl } from './utils/url-detector';
import { PROJECT_VERSION } from './utils/version';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  negotiateProtocolVersion,
  logProtocolNegotiation,
  STANDARD_PROTOCOL_VERSION
} from './utils/protocol-version';
import { InstanceContext, validateInstanceContext } from './types/instance-context';
import { SessionState } from './types/session-state';
import { closeSharedDatabase } from './database/shared-database';

dotenv.config();

// Protocol version constant - will be negotiated per client
const DEFAULT_PROTOCOL_VERSION = STANDARD_PROTOCOL_VERSION;

// Type-safe headers interface for multi-tenant support
interface MultiTenantHeaders {
  'x-n8n-url'?: string;
  'x-n8n-key'?: string;
  'x-instance-id'?: string;
  'x-session-id'?: string;
}

// Session management constants
const MAX_SESSIONS = Math.max(1, parseInt(process.env.N8N_MCP_MAX_SESSIONS || '100', 10));
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface Session {
  server: N8NDocumentationMCPServer;
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  lastAccess: Date;
  sessionId: string;
  initialized: boolean;
  isSSE: boolean;
}

interface SessionMetrics {
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
  lastCleanup: Date;
}

/**
 * Extract multi-tenant headers in a type-safe manner
 */
function extractMultiTenantHeaders(req: express.Request): MultiTenantHeaders {
  return {
    'x-n8n-url': req.headers['x-n8n-url'] as string | undefined,
    'x-n8n-key': req.headers['x-n8n-key'] as string | undefined,
    'x-instance-id': req.headers['x-instance-id'] as string | undefined,
    'x-session-id': req.headers['x-session-id'] as string | undefined,
  };
}

/**
 * Security logging helper for audit trails
 * Provides structured logging for security-relevant events
 */
function logSecurityEvent(
  event: 'session_export' | 'session_restore' | 'session_restore_failed' | 'max_sessions_reached',
  details: {
    sessionId?: string;
    reason?: string;
    count?: number;
    instanceId?: string;
  }
): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    ...details
  };

  // Log to standard logger with [SECURITY] prefix for easy filtering
  logger.info(`[SECURITY] ${event}`, logEntry);
}

export class SingleSessionHTTPServer {
  // Map to store transports by session ID (following SDK pattern)
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  private servers: { [sessionId: string]: N8NDocumentationMCPServer } = {};
  private sessionMetadata: { [sessionId: string]: { lastAccess: Date; createdAt: Date } } = {};
  private sessionContexts: { [sessionId: string]: InstanceContext | undefined } = {};
  private contextSwitchLocks: Map<string, Promise<void>> = new Map();
  private session: Session | null = null;  // Keep for SSE compatibility
  private consoleManager = new ConsoleManager();
  private expressServer: any;
  // Session timeout reduced from 30 minutes to 5 minutes for faster cleanup
  // Configurable via SESSION_TIMEOUT_MINUTES environment variable
  // This prevents memory buildup from stale sessions
  private sessionTimeout = parseInt(
    process.env.SESSION_TIMEOUT_MINUTES || '5', 10
  ) * 60 * 1000;
  private authToken: string | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  constructor() {
    // Validate environment on construction
    this.validateEnvironment();
    // No longer pre-create session - will be created per initialize request following SDK pattern
    
    // Start periodic session cleanup
    this.startSessionCleanup();
  }
  
  /**
   * Start periodic session cleanup
   */
  private startSessionCleanup(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        logger.error('Error during session cleanup', error);
      }
    }, SESSION_CLEANUP_INTERVAL);
    
    logger.info('Session cleanup started', { 
      interval: SESSION_CLEANUP_INTERVAL / 1000 / 60,
      maxSessions: MAX_SESSIONS,
      sessionTimeout: this.sessionTimeout / 1000 / 60
    });
  }
  
  /**
   * Clean up expired sessions based on last access time
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    // Check for expired sessions
    for (const sessionId in this.sessionMetadata) {
      const metadata = this.sessionMetadata[sessionId];
      if (now - metadata.lastAccess.getTime() > this.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }

    // Also check for orphaned contexts (sessions that were removed but context remained)
    for (const sessionId in this.sessionContexts) {
      if (!this.sessionMetadata[sessionId]) {
        // Context exists but session doesn't - clean it up
        delete this.sessionContexts[sessionId];
        logger.debug('Cleaned orphaned session context', { sessionId });
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      this.removeSession(sessionId, 'expired');
    }

    if (expiredSessions.length > 0) {
      logger.info('Cleaned up expired sessions', {
        removed: expiredSessions.length,
        remaining: this.getActiveSessionCount()
      });
    }
  }
  
  /**
   * Remove a session and clean up resources
   */
  private async removeSession(sessionId: string, reason: string): Promise<void> {
    try {
      // Store references before deletion
      const transport = this.transports[sessionId];
      const server = this.servers[sessionId];

      // Delete references FIRST to prevent onclose handler from triggering recursion
      // This breaks the circular reference: removeSession -> close -> onclose -> removeSession
      delete this.transports[sessionId];
      delete this.servers[sessionId];
      delete this.sessionMetadata[sessionId];
      delete this.sessionContexts[sessionId];

      // Close server first (may have references to transport)
      // This fixes memory leak where server resources weren't freed (issue #471)
      // Handle server close errors separately so transport close still runs
      if (server && typeof server.close === 'function') {
        try {
          await server.close();
        } catch (serverError) {
          logger.warn('Error closing server', { sessionId, error: serverError });
        }
      }

      // Close transport last
      // When onclose handler fires, it won't find the transport anymore
      if (transport) {
        await transport.close();
      }

      logger.info('Session removed', { sessionId, reason });
    } catch (error) {
      logger.warn('Error removing session', { sessionId, reason, error });
    }
  }
  
  /**
   * Get current active session count
   */
  private getActiveSessionCount(): number {
    return Object.keys(this.transports).length;
  }
  
  /**
   * Check if we can create a new session
   */
  private canCreateSession(): boolean {
    return this.getActiveSessionCount() < MAX_SESSIONS;
  }
  
  /**
   * Validate session ID format
   *
   * Accepts any non-empty string to support various MCP clients:
   * - UUIDv4 (internal n8n-mcp format)
   * - instance-{userId}-{hash}-{uuid} (multi-tenant format)
   * - Custom formats from mcp-remote and other proxies
   *
   * Security: Session validation happens via lookup in this.transports,
   * not format validation. This ensures compatibility with all MCP clients.
   *
   * @param sessionId - Session identifier from MCP client
   * @returns true if valid, false otherwise
   */
  private isValidSessionId(sessionId: string): boolean {
    // Accept any non-empty string as session ID
    // This ensures compatibility with all MCP clients and proxies
    return Boolean(sessionId && sessionId.length > 0);
  }
  
  /**
   * Sanitize error information for client responses
   */
  private sanitizeErrorForClient(error: unknown): { message: string; code: string } {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error instanceof Error) {
      // In production, only return generic messages
      if (isProduction) {
        // Map known error types to safe messages
        if (error.message.includes('Unauthorized') || error.message.includes('authentication')) {
          return { message: 'Authentication failed', code: 'AUTH_ERROR' };
        }
        if (error.message.includes('Session') || error.message.includes('session')) {
          return { message: 'Session error', code: 'SESSION_ERROR' };
        }
        if (error.message.includes('Invalid') || error.message.includes('validation')) {
          return { message: 'Validation error', code: 'VALIDATION_ERROR' };
        }
        // Default generic error
        return { message: 'Internal server error', code: 'INTERNAL_ERROR' };
      }
      
      // In development, return more details but no stack traces
      return {
        message: error.message.substring(0, 200), // Limit message length
        code: error.name || 'ERROR'
      };
    }
    
    // For non-Error objects
    return { message: 'An error occurred', code: 'UNKNOWN_ERROR' };
  }
  
  /**
   * Update session last access time
   */
  private updateSessionAccess(sessionId: string): void {
    if (this.sessionMetadata[sessionId]) {
      this.sessionMetadata[sessionId].lastAccess = new Date();
    }
  }

  /**
   * Switch session context with locking to prevent race conditions
   */
  private async switchSessionContext(sessionId: string, newContext: InstanceContext): Promise<void> {
    // Check if there's already a switch in progress for this session
    const existingLock = this.contextSwitchLocks.get(sessionId);
    if (existingLock) {
      // Wait for the existing switch to complete
      await existingLock;
      return;
    }

    // Create a promise for this switch operation
    const switchPromise = this.performContextSwitch(sessionId, newContext);
    this.contextSwitchLocks.set(sessionId, switchPromise);

    try {
      await switchPromise;
    } finally {
      // Clean up the lock after completion
      this.contextSwitchLocks.delete(sessionId);
    }
  }

  /**
   * Perform the actual context switch
   */
  private async performContextSwitch(sessionId: string, newContext: InstanceContext): Promise<void> {
    const existingContext = this.sessionContexts[sessionId];

    // Only switch if the context has actually changed
    if (JSON.stringify(existingContext) !== JSON.stringify(newContext)) {
      logger.info('Multi-tenant shared mode: Updating instance context for session', {
        sessionId,
        oldInstanceId: existingContext?.instanceId,
        newInstanceId: newContext.instanceId
      });

      // Update the session context
      this.sessionContexts[sessionId] = newContext;

      // Update the MCP server's instance context if it exists
      if (this.servers[sessionId]) {
        (this.servers[sessionId] as any).instanceContext = newContext;
      }
    }
  }

  /**
   * Get session metrics for monitoring
   */
  private getSessionMetrics(): SessionMetrics {
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
  
  /**
   * Load auth token from environment variable or file
   */
  private loadAuthToken(): string | null {
    // First, try AUTH_TOKEN environment variable
    if (process.env.AUTH_TOKEN) {
      logger.info('Using AUTH_TOKEN from environment variable');
      return process.env.AUTH_TOKEN;
    }
    
    // Then, try AUTH_TOKEN_FILE
    if (process.env.AUTH_TOKEN_FILE) {
      try {
        const token = readFileSync(process.env.AUTH_TOKEN_FILE, 'utf-8').trim();
        logger.info(`Loaded AUTH_TOKEN from file: ${process.env.AUTH_TOKEN_FILE}`);
        return token;
      } catch (error) {
        logger.error(`Failed to read AUTH_TOKEN_FILE: ${process.env.AUTH_TOKEN_FILE}`, error);
        console.error(`ERROR: Failed to read AUTH_TOKEN_FILE: ${process.env.AUTH_TOKEN_FILE}`);
        console.error(error instanceof Error ? error.message : 'Unknown error');
        return null;
      }
    }
    
    return null;
  }
  
  /**
   * Validate required environment variables
   */
  private validateEnvironment(): void {
    // Load auth token from env var or file
    this.authToken = this.loadAuthToken();
    
    if (!this.authToken || this.authToken.trim() === '') {
      const message = 'No authentication token found or token is empty. Set AUTH_TOKEN environment variable or AUTH_TOKEN_FILE pointing to a file containing the token.';
      logger.error(message);
      throw new Error(message);
    }
    
    // Update authToken to trimmed version
    this.authToken = this.authToken.trim();
    
    if (this.authToken.length < 32) {
      logger.warn('AUTH_TOKEN should be at least 32 characters for security');
    }
    
    // Check for default token and show prominent warnings
    const isDefaultToken = this.authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh';
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isDefaultToken) {
      if (isProduction) {
        const message = 'CRITICAL SECURITY ERROR: Cannot start in production with default AUTH_TOKEN. Generate secure token: openssl rand -base64 32';
        logger.error(message);
        console.error('\n🚨 CRITICAL SECURITY ERROR 🚨');
        console.error(message);
        console.error('Set NODE_ENV to development for testing, or update AUTH_TOKEN for production\n');
        throw new Error(message);
      }
      
      logger.warn('⚠️ SECURITY WARNING: Using default AUTH_TOKEN - CHANGE IMMEDIATELY!');
      logger.warn('Generate secure token with: openssl rand -base64 32');
      
      // Only show console warnings in HTTP mode
      if (process.env.MCP_MODE === 'http') {
        console.warn('\n⚠️  SECURITY WARNING ⚠️');
        console.warn('Using default AUTH_TOKEN - CHANGE IMMEDIATELY!');
        console.warn('Generate secure token: openssl rand -base64 32');
        console.warn('Update via Railway dashboard environment variables\n');
      }
    }
  }
  

  /**
   * Handle incoming MCP request using proper SDK pattern
   *
   * @param req - Express request object
   * @param res - Express response object
   * @param instanceContext - Optional instance-specific configuration
   */
  async handleRequest(
    req: express.Request,
    res: express.Response,
    instanceContext?: InstanceContext
  ): Promise<void> {
    const startTime = Date.now();
    
    // Wrap all operations to prevent console interference
    return this.consoleManager.wrapOperation(async () => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        const isInitialize = req.body ? isInitializeRequest(req.body) : false;
        
        // Log comprehensive incoming request details for debugging
        logger.info('handleRequest: Processing MCP request - SDK PATTERN', {
          requestId: req.get('x-request-id') || 'unknown',
          sessionId: sessionId,
          method: req.method,
          url: req.url,
          bodyType: typeof req.body,
          bodyContent: req.body ? JSON.stringify(req.body, null, 2) : 'undefined',
          existingTransports: Object.keys(this.transports),
          isInitializeRequest: isInitialize
        });
        
        let transport: StreamableHTTPServerTransport;
        
        if (isInitialize) {
          // Check session limits before creating new session
          if (!this.canCreateSession()) {
            logger.warn('handleRequest: Session limit reached', {
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
          
          // For initialize requests: always create new transport and server
          logger.info('handleRequest: Creating new transport for initialize request');

          // EAGER CLEANUP: Remove existing sessions for the same instance
          // This prevents memory buildup when clients reconnect without proper cleanup
          if (instanceContext?.instanceId) {
            const sessionsToRemove: string[] = [];
            for (const [existingSessionId, context] of Object.entries(this.sessionContexts)) {
              if (context?.instanceId === instanceContext.instanceId) {
                sessionsToRemove.push(existingSessionId);
              }
            }
            for (const oldSessionId of sessionsToRemove) {
              // Double-check session still exists (may have been cleaned by concurrent request)
              if (!this.transports[oldSessionId]) {
                continue;
              }
              logger.info('Cleaning up previous session for instance', {
                instanceId: instanceContext.instanceId,
                oldSession: oldSessionId,
                reason: 'instance_reconnect'
              });
              await this.removeSession(oldSessionId, 'instance_reconnect');
            }
          }

          // Generate session ID based on multi-tenant configuration
          let sessionIdToUse: string;

          const isMultiTenantEnabled = process.env.ENABLE_MULTI_TENANT === 'true';
          const sessionStrategy = process.env.MULTI_TENANT_SESSION_STRATEGY || 'instance';

          if (isMultiTenantEnabled && sessionStrategy === 'instance' && instanceContext?.instanceId) {
            // In multi-tenant mode with instance strategy, create session per instance
            // This ensures each tenant gets isolated sessions
            // Include configuration hash to prevent collisions with different configs
            const configHash = createHash('sha256')
              .update(JSON.stringify({
                url: instanceContext.n8nApiUrl,
                instanceId: instanceContext.instanceId
              }))
              .digest('hex')
              .substring(0, 8);

            sessionIdToUse = `instance-${instanceContext.instanceId}-${configHash}-${uuidv4()}`;
            logger.info('Multi-tenant mode: Creating instance-specific session', {
              instanceId: instanceContext.instanceId,
              configHash,
              sessionId: sessionIdToUse
            });
          } else {
            // Use client-provided session ID or generate a standard one
            sessionIdToUse = sessionId || uuidv4();
          }

          const server = new N8NDocumentationMCPServer(instanceContext);
          
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionIdToUse,
            onsessioninitialized: (initializedSessionId: string) => {
              // Store both transport and server by session ID when session is initialized
              logger.info('handleRequest: Session initialized, storing transport and server', { 
                sessionId: initializedSessionId 
              });
              this.transports[initializedSessionId] = transport;
              this.servers[initializedSessionId] = server;
              
              // Store session metadata and context
              this.sessionMetadata[initializedSessionId] = {
                lastAccess: new Date(),
                createdAt: new Date()
              };
              this.sessionContexts[initializedSessionId] = instanceContext;
            }
          });
          
          // Set up cleanup handlers
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              logger.info('handleRequest: Transport closed, cleaning up', { sessionId: sid });
              this.removeSession(sid, 'transport_closed');
            }
          };
          
          // Handle transport errors to prevent connection drops
          transport.onerror = (error: Error) => {
            const sid = transport.sessionId;
            logger.error('Transport error', { sessionId: sid, error: error.message });
            if (sid) {
              this.removeSession(sid, 'transport_error').catch(err => {
                logger.error('Error during transport error cleanup', { error: err });
              });
            }
          };
          
          // Connect the server to the transport BEFORE handling the request
          logger.info('handleRequest: Connecting server to new transport');
          await server.connect(transport);
          
        } else if (sessionId && this.transports[sessionId]) {
          // Validate session ID format
          if (!this.isValidSessionId(sessionId)) {
            logger.warn('handleRequest: Invalid session ID format', { sessionId });
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
          
          // For non-initialize requests: reuse existing transport for this session
          logger.info('handleRequest: Reusing existing transport for session', { sessionId });
          transport = this.transports[sessionId];

          // In multi-tenant shared mode, update instance context if provided
          const isMultiTenantEnabled = process.env.ENABLE_MULTI_TENANT === 'true';
          const sessionStrategy = process.env.MULTI_TENANT_SESSION_STRATEGY || 'instance';

          if (isMultiTenantEnabled && sessionStrategy === 'shared' && instanceContext) {
            // Update the context for this session with locking to prevent race conditions
            await this.switchSessionContext(sessionId, instanceContext);
          }

          // Update session access time
          this.updateSessionAccess(sessionId);
          
        } else {
          // Invalid request - no session ID and not an initialize request
          const errorDetails = {
            hasSessionId: !!sessionId,
            isInitialize: isInitialize,
            sessionIdValid: sessionId ? this.isValidSessionId(sessionId) : false,
            sessionExists: sessionId ? !!this.transports[sessionId] : false
          };
          
          logger.warn('handleRequest: Invalid request - no session ID and not initialize', errorDetails);
          
          let errorMessage = 'Bad Request: No valid session ID provided and not an initialize request';
          if (sessionId && !this.isValidSessionId(sessionId)) {
            errorMessage = 'Bad Request: Invalid session ID format';
          } else if (sessionId && !this.transports[sessionId]) {
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
        
        // Handle request with the transport
        logger.info('handleRequest: Handling request with transport', { 
          sessionId: isInitialize ? 'new' : sessionId,
          isInitialize 
        });
        await transport.handleRequest(req, res, req.body);
        
        const duration = Date.now() - startTime;
        logger.info('MCP request completed', { duration, sessionId: transport.sessionId });
        
      } catch (error) {
        logger.error('handleRequest: MCP request error:', {
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
          // Send sanitized error to client
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
  

  /**
   * Reset the session for SSE - clean up old and create new SSE transport
   */
  private async resetSessionSSE(res: express.Response): Promise<void> {
    // Clean up old session if exists
    if (this.session) {
      const sessionId = this.session.sessionId;
      logger.info('Closing previous session for SSE', { sessionId });

      // Close server first to free resources (database, cache timer, etc.)
      // This mirrors the cleanup pattern in removeSession() (issue #542)
      // Handle server close errors separately so transport close still runs
      if (this.session.server && typeof this.session.server.close === 'function') {
        try {
          await this.session.server.close();
        } catch (serverError) {
          logger.warn('Error closing server for SSE session', { sessionId, error: serverError });
        }
      }

      // Close transport last - always attempt even if server.close() failed
      try {
        await this.session.transport.close();
      } catch (transportError) {
        logger.warn('Error closing transport for SSE session', { sessionId, error: transportError });
      }
    }
    
    try {
      // Create new session
      logger.info('Creating new N8NDocumentationMCPServer for SSE...');
      const server = new N8NDocumentationMCPServer();
      
      // Generate cryptographically secure session ID
      const sessionId = uuidv4();
      
      logger.info('Creating SSEServerTransport...');
      const transport = new SSEServerTransport('/mcp', res);
      
      logger.info('Connecting server to SSE transport...');
      await server.connect(transport);
      
      // Note: server.connect() automatically calls transport.start(), so we don't need to call it again
      
      this.session = {
        server,
        transport,
        lastAccess: new Date(),
        sessionId,
        initialized: false,
        isSSE: true
      };
      
      logger.info('Created new SSE session successfully', { sessionId: this.session.sessionId });
    } catch (error) {
      logger.error('Failed to create SSE session:', error);
      throw error;
    }
  }
  
  /**
   * Check if current session is expired
   */
  private isExpired(): boolean {
    if (!this.session) return true;
    return Date.now() - this.session.lastAccess.getTime() > this.sessionTimeout;
  }

  /**
   * Check if a specific session is expired based on sessionId
   * Used for multi-session expiration checks during export/restore
   *
   * @param sessionId - The session ID to check
   * @returns true if session is expired or doesn't exist
   */
  private isSessionExpired(sessionId: string): boolean {
    const metadata = this.sessionMetadata[sessionId];
    if (!metadata) return true;
    return Date.now() - metadata.lastAccess.getTime() > this.sessionTimeout;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    const app = express();
    
    // Create JSON parser middleware for endpoints that need it
    const jsonParser = express.json({ limit: '10mb' });
    
    // Configure trust proxy for correct IP logging behind reverse proxies
    const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0;
    if (trustProxy > 0) {
      app.set('trust proxy', trustProxy);
      logger.info(`Trust proxy enabled with ${trustProxy} hop(s)`);
    }
    
    // DON'T use any body parser globally - StreamableHTTPServerTransport needs raw stream
    // Only use JSON parser for specific endpoints that need it
    
    // Security headers
    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      next();
    });
    
    // CORS configuration
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
    
    // Request logging middleware
    app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        contentLength: req.get('content-length')
      });
      next();
    });
    
    // Root endpoint with API information
    app.get('/', (req, res) => {
      const port = parseInt(process.env.PORT || '3000');
      const host = process.env.HOST || '0.0.0.0';
      const baseUrl = detectBaseUrl(req, host, port);
      const endpoints = formatEndpointUrls(baseUrl);
      
      res.json({
        name: 'n8n Documentation MCP Server',
        version: PROJECT_VERSION,
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

    // Health check endpoint (no body parsing needed for GET)
    app.get('/health', (req, res) => {
      const activeTransports = Object.keys(this.transports);
      const activeServers = Object.keys(this.servers);
      const sessionMetrics = this.getSessionMetrics();
      const isProduction = process.env.NODE_ENV === 'production';
      const isDefaultToken = this.authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh';
      
      res.json({ 
        status: 'ok', 
        mode: 'sdk-pattern-transports',
        version: PROJECT_VERSION,
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
        activeTransports: activeTransports.length, // Legacy field
        activeServers: activeServers.length, // Legacy field
        legacySessionActive: !!this.session, // For SSE compatibility
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB'
        },
        timestamp: new Date().toISOString()
      });
    });
    
    // Test endpoint for manual testing without auth
    app.post('/mcp/test', jsonParser, async (req: express.Request, res: express.Response): Promise<void> => {
      logger.info('TEST ENDPOINT: Manual test request received', {
        method: req.method,
        headers: req.headers,
        body: req.body,
        bodyType: typeof req.body,
        bodyContent: req.body ? JSON.stringify(req.body, null, 2) : 'undefined'
      });
      
      // Negotiate protocol version for test endpoint
      const negotiationResult = negotiateProtocolVersion(
        undefined, // no client version in test
        undefined, // no client info
        req.get('user-agent'),
        req.headers
      );
      
      logProtocolNegotiation(negotiationResult, logger, 'TEST_ENDPOINT');
      
      // Test what a basic MCP initialize request should look like
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
            version: PROJECT_VERSION
          }
        }
      };
      
      logger.info('TEST ENDPOINT: Sending test response', {
        response: testResponse
      });
      
      res.json(testResponse);
    });

    // MCP information endpoint (no auth required for discovery) and SSE support
    app.get('/mcp', async (req, res) => {
      // Handle StreamableHTTP transport requests with new pattern
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && this.transports[sessionId]) {
        // Let the StreamableHTTPServerTransport handle the GET request
        try {
          await this.transports[sessionId].handleRequest(req, res, undefined);
          return;
        } catch (error) {
          logger.error('StreamableHTTP GET request failed:', error);
          // Fall through to standard response
        }
      }
      
      // Check Accept header for text/event-stream (SSE support)
      const accept = req.headers.accept;
      if (accept && accept.includes('text/event-stream')) {
        logger.info('SSE stream request received - establishing SSE connection');
        
        try {
          // Create or reset session for SSE
          await this.resetSessionSSE(res);
          logger.info('SSE connection established successfully');
        } catch (error) {
          logger.error('Failed to establish SSE connection:', error);
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

      // In n8n mode, return protocol version and server info
      if (process.env.N8N_MODE === 'true') {
        // Negotiate protocol version for n8n mode
        const negotiationResult = negotiateProtocolVersion(
          undefined, // no client version in GET request
          undefined, // no client info
          req.get('user-agent'),
          req.headers
        );
        
        logProtocolNegotiation(negotiationResult, logger, 'N8N_MODE_GET');
        
        res.json({
          protocolVersion: negotiationResult.version,
          serverInfo: {
            name: 'n8n-mcp',
            version: PROJECT_VERSION,
            capabilities: {
              tools: {}
            }
          }
        });
        return;
      }
      
      // Standard response for non-n8n mode
      res.json({
        description: 'n8n Documentation MCP Server',
        version: PROJECT_VERSION,
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

    // Session termination endpoint
    app.delete('/mcp', async (req: express.Request, res: express.Response): Promise<void> => {
      const mcpSessionId = req.headers['mcp-session-id'] as string;
      
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
      
      // Validate session ID format
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
      
      // Check if session exists in new transport map
      if (this.transports[mcpSessionId]) {
        logger.info('Terminating session via DELETE request', { sessionId: mcpSessionId });
        try {
          await this.removeSession(mcpSessionId, 'manual_termination');
          res.status(204).send(); // No content
        } catch (error) {
          logger.error('Error terminating session:', error);
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Error terminating session'
            },
            id: null
          });
        }
      } else {
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


    // SECURITY: Rate limiting for authentication endpoint
    // Prevents brute force attacks and DoS
    // See: https://github.com/czlonkowski/n8n-mcp/issues/265 (HIGH-02)
    const authLimiter = rateLimit({
      windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || '900000'), // 15 minutes
      max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20'), // 20 authentication attempts per IP
      message: {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Too many authentication attempts. Please try again later.'
        },
        id: null
      },
      standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
      legacyHeaders: false, // Disable `X-RateLimit-*` headers
      handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
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

    // Main MCP endpoint with authentication and rate limiting
    app.post('/mcp', authLimiter, jsonParser, async (req: express.Request, res: express.Response): Promise<void> => {
      // Log comprehensive debug info about the request
      logger.info('POST /mcp request received - DETAILED DEBUG', {
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
      
      // Handle connection close to immediately clean up sessions
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      // Only add event listener if the request object supports it (not in test mocks)
      if (typeof req.on === 'function') {
        const closeHandler = () => {
          if (!res.headersSent && sessionId) {
            logger.info('Connection closed before response sent', { sessionId });
            // Schedule immediate cleanup if connection closes unexpectedly
            setImmediate(() => {
              if (this.sessionMetadata[sessionId]) {
                const metadata = this.sessionMetadata[sessionId];
                const timeSinceAccess = Date.now() - metadata.lastAccess.getTime();
                // Only remove if it's been inactive for a bit to avoid race conditions
                if (timeSinceAccess > 60000) { // 1 minute
                  this.removeSession(sessionId, 'connection_closed').catch(err => {
                    logger.error('Error during connection close cleanup', { error: err });
                  });
                }
              }
            });
          }
        };
        
        req.on('close', closeHandler);
        
        // Clean up event listener when response ends to prevent memory leaks
        res.on('finish', () => {
          req.removeListener('close', closeHandler);
        });
      }
      
      // Enhanced authentication check with specific logging
      const authHeader = req.headers.authorization;
      
      // Check if Authorization header is missing
      if (!authHeader) {
        logger.warn('Authentication failed: Missing Authorization header', { 
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
      
      // Check if Authorization header has Bearer prefix
      if (!authHeader.startsWith('Bearer ')) {
        logger.warn('Authentication failed: Invalid Authorization header format (expected Bearer token)', { 
          ip: req.ip,
          userAgent: req.get('user-agent'),
          reason: 'invalid_auth_format',
          headerPrefix: authHeader.substring(0, Math.min(authHeader.length, 10)) + '...'  // Log first 10 chars for debugging
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
      
      // Extract token and trim whitespace
      const token = authHeader.slice(7).trim();

      // SECURITY: Use timing-safe comparison to prevent timing attacks
      // See: https://github.com/czlonkowski/n8n-mcp/issues/265 (CRITICAL-02)
      const isValidToken = this.authToken &&
        AuthManager.timingSafeCompare(token, this.authToken);

      if (!isValidToken) {
        logger.warn('Authentication failed: Invalid token', {
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
      
      // Handle request with single session
      logger.info('Authentication successful - proceeding to handleRequest', {
        hasSession: !!this.session,
        sessionType: this.session?.isSSE ? 'SSE' : 'StreamableHTTP',
        sessionInitialized: this.session?.initialized
      });

      // Extract instance context from headers if present (for multi-tenant support)
      const instanceContext: InstanceContext | undefined = (() => {
        // Use type-safe header extraction
        const headers = extractMultiTenantHeaders(req);
        const hasUrl = headers['x-n8n-url'];
        const hasKey = headers['x-n8n-key'];

        if (!hasUrl && !hasKey) return undefined;

        // Create context with proper type handling
        const context: InstanceContext = {
          n8nApiUrl: hasUrl || undefined,
          n8nApiKey: hasKey || undefined,
          instanceId: headers['x-instance-id'] || undefined,
          sessionId: headers['x-session-id'] || undefined
        };

        // Add metadata if available
        if (req.headers['user-agent'] || req.ip) {
          context.metadata = {
            userAgent: req.headers['user-agent'] as string | undefined,
            ip: req.ip
          };
        }

        // Validate the context
        const validation = validateInstanceContext(context);
        if (!validation.valid) {
          logger.warn('Invalid instance context from headers', {
            errors: validation.errors,
            hasUrl: !!hasUrl,
            hasKey: !!hasKey
          });
          return undefined;
        }

        return context;
      })();

      // Log context extraction for debugging (only if context exists)
      if (instanceContext) {
        // Use sanitized logging for security
        logger.debug('Instance context extracted from headers', {
          hasUrl: !!instanceContext.n8nApiUrl,
          hasKey: !!instanceContext.n8nApiKey,
          instanceId: instanceContext.instanceId ? instanceContext.instanceId.substring(0, 8) + '...' : undefined,
          sessionId: instanceContext.sessionId ? instanceContext.sessionId.substring(0, 8) + '...' : undefined,
          urlDomain: instanceContext.n8nApiUrl ? new URL(instanceContext.n8nApiUrl).hostname : undefined
        });
      }

      await this.handleRequest(req, res, instanceContext);
      
      logger.info('POST /mcp request completed - checking response status', {
        responseHeadersSent: res.headersSent,
        responseStatusCode: res.statusCode,
        responseFinished: res.finished
      });
    });
    
    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ 
        error: 'Not found',
        message: `Cannot ${req.method} ${req.path}`
      });
    });
    
    // Error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Express error handler:', err);
      
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
      
      logger.info(`n8n MCP Single-Session HTTP Server started`, { 
        port, 
        host, 
        environment: process.env.NODE_ENV || 'development',
        maxSessions: MAX_SESSIONS,
        sessionTimeout: this.sessionTimeout / 1000 / 60,
        production: isProduction,
        defaultToken: isDefaultToken
      });
      
      // Detect the base URL using our utility
      const baseUrl = getStartupBaseUrl(host, port);
      const endpoints = formatEndpointUrls(baseUrl);
      
      console.log(`n8n MCP Single-Session HTTP Server running on ${host}:${port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Session Limits: ${MAX_SESSIONS} max sessions, ${this.sessionTimeout / 1000 / 60}min timeout`);
      console.log(`Health check: ${endpoints.health}`);
      console.log(`MCP endpoint: ${endpoints.mcp}`);
      
      if (isProduction) {
        console.log('🔒 Running in PRODUCTION mode - enhanced security enabled');
      } else {
        console.log('🛠️ Running in DEVELOPMENT mode');
      }
      
      console.log('\nPress Ctrl+C to stop the server');
      
      // Start periodic warning timer if using default token
      if (isDefaultToken && !isProduction) {
        setInterval(() => {
          logger.warn('⚠️ Still using default AUTH_TOKEN - security risk!');
          if (process.env.MCP_MODE === 'http') {
            console.warn('⚠️ REMINDER: Still using default AUTH_TOKEN - please change it!');
          }
        }, 300000); // Every 5 minutes
      }
      
      if (process.env.BASE_URL || process.env.PUBLIC_URL) {
        console.log(`\nPublic URL configured: ${baseUrl}`);
      } else if (process.env.TRUST_PROXY && Number(process.env.TRUST_PROXY) > 0) {
        console.log(`\nNote: TRUST_PROXY is enabled. URLs will be auto-detected from proxy headers.`);
      }
    });
    
    // Handle server errors
    this.expressServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`);
        console.error(`ERROR: Port ${port} is already in use`);
        process.exit(1);
      } else {
        logger.error('Server error:', error);
        console.error('Server error:', error);
        process.exit(1);
      }
    });
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Single-Session HTTP server...');
    
    // Stop session cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('Session cleanup timer stopped');
    }
    
    // Close all active transports (SDK pattern)
    const sessionIds = Object.keys(this.transports);
    logger.info(`Closing ${sessionIds.length} active sessions`);
    
    for (const sessionId of sessionIds) {
      try {
        logger.info(`Closing transport for session ${sessionId}`);
        await this.removeSession(sessionId, 'server_shutdown');
      } catch (error) {
        logger.warn(`Error closing transport for session ${sessionId}:`, error);
      }
    }
    
    // Clean up legacy session (for SSE compatibility)
    if (this.session) {
      try {
        await this.session.transport.close();
        logger.info('Legacy session closed');
      } catch (error) {
        logger.warn('Error closing legacy session:', error);
      }
      this.session = null;
    }
    
    // Close Express server
    if (this.expressServer) {
      await new Promise<void>((resolve) => {
        this.expressServer.close(() => {
          logger.info('HTTP server closed');
          resolve();
        });
      });
    }

    // Close the shared database connection (only during process shutdown)
    // This must happen after all sessions are closed
    try {
      await closeSharedDatabase();
      logger.info('Shared database closed');
    } catch (error) {
      logger.warn('Error closing shared database:', error);
    }

    logger.info('Single-Session HTTP server shutdown completed');
  }
  
  /**
   * Get current session info (for testing/debugging)
   */
  getSessionInfo(): { 
    active: boolean; 
    sessionId?: string; 
    age?: number;
    sessions?: {
      total: number;
      active: number;
      expired: number;
      max: number;
      sessionIds: string[];
    };
  } {
    const metrics = this.getSessionMetrics();
    
    // Legacy SSE session info
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

  /**
   * Export all active session state for persistence
   *
   * Used by multi-tenant backends to dump sessions before container restart.
   * This method exports the minimal state needed to restore sessions after
   * a restart: session metadata (timing) and instance context (credentials).
   *
   * Transport and server objects are NOT persisted - they will be recreated
   * on the first request after restore.
   *
   * SECURITY WARNING: The exported data contains plaintext n8n API keys.
   * The downstream application MUST encrypt this data before persisting to disk.
   *
   * @returns Array of session state objects, excluding expired sessions
   *
   * @example
   * // Before shutdown
   * const sessions = server.exportSessionState();
   * await saveToEncryptedStorage(sessions);
   */
  public exportSessionState(): SessionState[] {
    const sessions: SessionState[] = [];
    const seenSessionIds = new Set<string>();

    // Iterate over all sessions with metadata (source of truth for active sessions)
    for (const sessionId of Object.keys(this.sessionMetadata)) {
      // Check for duplicates (defensive programming)
      if (seenSessionIds.has(sessionId)) {
        logger.warn(`Duplicate sessionId detected during export: ${sessionId}`);
        continue;
      }

      // Skip expired sessions - they're not worth persisting
      if (this.isSessionExpired(sessionId)) {
        continue;
      }

      const metadata = this.sessionMetadata[sessionId];
      const context = this.sessionContexts[sessionId];

      // Skip sessions without context - these can't be restored meaningfully
      // (Context is required to reconnect to the correct n8n instance)
      if (!context || !context.n8nApiUrl || !context.n8nApiKey) {
        logger.debug(`Skipping session ${sessionId} - missing required context`);
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
          instanceId: context.instanceId || sessionId, // Use sessionId as fallback
          sessionId: context.sessionId,
          metadata: context.metadata
        }
      });
    }

    logger.info(`Exported ${sessions.length} session(s) for persistence`);
    logSecurityEvent('session_export', { count: sessions.length });
    return sessions;
  }

  /**
   * Restore session state from previously exported data
   *
   * Used by multi-tenant backends to restore sessions after container restart.
   * This method restores only the session metadata and instance context.
   * Transport and server objects will be recreated on the first request.
   *
   * Restored sessions are "dormant" until a client makes a request, at which
   * point the transport and server will be initialized normally.
   *
   * @param sessions - Array of session state objects from exportSessionState()
   * @returns Number of sessions successfully restored
   *
   * @example
   * // After startup
   * const sessions = await loadFromEncryptedStorage();
   * const count = server.restoreSessionState(sessions);
   * console.log(`Restored ${count} sessions`);
   */
  public restoreSessionState(sessions: SessionState[]): number {
    let restoredCount = 0;

    for (const sessionState of sessions) {
      try {
        // Skip null or invalid session objects
        if (!sessionState || typeof sessionState !== 'object' || !sessionState.sessionId) {
          logger.warn('Skipping invalid session state object');
          continue;
        }

        // Check if we've hit the MAX_SESSIONS limit (check real-time count)
        if (Object.keys(this.sessionMetadata).length >= MAX_SESSIONS) {
          logger.warn(
            `Reached MAX_SESSIONS limit (${MAX_SESSIONS}), skipping remaining sessions`
          );
          logSecurityEvent('max_sessions_reached', { count: MAX_SESSIONS });
          break;
        }

        // Skip if session already exists (duplicate sessionId)
        if (this.sessionMetadata[sessionState.sessionId]) {
          logger.debug(`Skipping session ${sessionState.sessionId} - already exists`);
          continue;
        }

        // Parse and validate dates first
        const createdAt = new Date(sessionState.metadata.createdAt);
        const lastAccess = new Date(sessionState.metadata.lastAccess);

        if (isNaN(createdAt.getTime()) || isNaN(lastAccess.getTime())) {
          logger.warn(
            `Skipping session ${sessionState.sessionId} - invalid date format`
          );
          continue;
        }

        // Validate session isn't expired
        const age = Date.now() - lastAccess.getTime();
        if (age > this.sessionTimeout) {
          logger.debug(
            `Skipping session ${sessionState.sessionId} - expired (age: ${Math.round(age / 1000)}s)`
          );
          continue;
        }

        // Validate context exists (TypeScript null narrowing)
        if (!sessionState.context) {
          logger.warn(`Skipping session ${sessionState.sessionId} - missing context`);
          continue;
        }

        // Validate context structure using existing validation
        const validation = validateInstanceContext(sessionState.context);
        if (!validation.valid) {
          const reason = validation.errors?.join(', ') || 'invalid context';
          logger.warn(
            `Skipping session ${sessionState.sessionId} - invalid context: ${reason}`
          );
          logSecurityEvent('session_restore_failed', {
            sessionId: sessionState.sessionId,
            reason
          });
          continue;
        }

        // Restore session metadata
        this.sessionMetadata[sessionState.sessionId] = {
          createdAt,
          lastAccess
        };

        // Restore session context
        this.sessionContexts[sessionState.sessionId] = {
          n8nApiUrl: sessionState.context.n8nApiUrl,
          n8nApiKey: sessionState.context.n8nApiKey,
          instanceId: sessionState.context.instanceId,
          sessionId: sessionState.context.sessionId,
          metadata: sessionState.context.metadata
        };

        logger.debug(`Restored session ${sessionState.sessionId}`);
        logSecurityEvent('session_restore', {
          sessionId: sessionState.sessionId,
          instanceId: sessionState.context.instanceId
        });
        restoredCount++;
      } catch (error) {
        logger.error(`Failed to restore session ${sessionState.sessionId}:`, error);
        logSecurityEvent('session_restore_failed', {
          sessionId: sessionState.sessionId,
          reason: error instanceof Error ? error.message : 'unknown error'
        });
        // Continue with next session - don't let one failure break the entire restore
      }
    }

    logger.info(
      `Restored ${restoredCount}/${sessions.length} session(s) from persistence`
    );
    return restoredCount;
  }
}

// Start if called directly
if (require.main === module) {
  const server = new SingleSessionHTTPServer();
  
  // Graceful shutdown handlers
  const shutdown = async () => {
    await server.shutdown();
    process.exit(0);
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    console.error('Uncaught exception:', error);
    shutdown();
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection:', reason);
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    shutdown();
  });
  
  // Start server
  server.start().catch(error => {
    logger.error('Failed to start Single-Session HTTP server:', error);
    console.error('Failed to start Single-Session HTTP server:', error);
    process.exit(1);
  });
}