#!/usr/bin/env node
/**
 * @deprecated This fixed HTTP server is deprecated as of v2.31.8.
 * Use SingleSessionHTTPServer from http-server-single-session.ts instead.
 *
 * This implementation does not support SSE streaming required by clients like OpenAI Codex.
 * See: https://github.com/czlonkowski/n8n-mcp/issues/524
 *
 * Original purpose: Fixed HTTP server for n8n-MCP that properly handles
 * StreamableHTTPServerTransport initialization by bypassing it entirely.
 * This implementation ensures the transport is properly initialized before handling requests.
 */
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { n8nDocumentationToolsFinal } from './mcp/tools';
import { n8nManagementTools } from './mcp/tools-n8n-manager';
import { N8NDocumentationMCPServer } from './mcp/server';
import { logger } from './utils/logger';
import { AuthManager, buildBearerChallenge } from './utils/auth';
import { PROJECT_VERSION } from './utils/version';
import { isN8nApiConfigured } from './config/n8n-api';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { getStartupBaseUrl, formatEndpointUrls, detectBaseUrl } from './utils/url-detector';
import { 
  negotiateProtocolVersion, 
  logProtocolNegotiation,
  N8N_PROTOCOL_VERSION 
} from './utils/protocol-version';

dotenv.config();

/**
 * MCP tool response format with optional structured content
 */
interface MCPToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  structuredContent?: unknown;
}

let expressServer: any;
let authToken: string | null = null;

/**
 * Load auth token from environment variable or file
 */
export function loadAuthToken(): string | null {
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
function validateEnvironment() {
  // Load auth token from env var or file
  authToken = loadAuthToken();
  
  if (!authToken || authToken.trim() === '') {
    logger.error('No authentication token found or token is empty');
    console.error('ERROR: AUTH_TOKEN is required for HTTP mode and cannot be empty');
    console.error('Set AUTH_TOKEN environment variable or AUTH_TOKEN_FILE pointing to a file containing the token');
    console.error('Generate AUTH_TOKEN with: openssl rand -base64 32');
    process.exit(1);
  }
  
  // Update authToken to trimmed version
  authToken = authToken.trim();
  
  if (authToken.length < 32) {
    logger.warn('AUTH_TOKEN should be at least 32 characters for security');
    console.warn('WARNING: AUTH_TOKEN should be at least 32 characters for security');
  }
  
  // Check for default token and show prominent warnings
  if (authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh') {
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
 * Graceful shutdown handler
 */
async function shutdown() {
  logger.info('Shutting down HTTP server...');
  console.log('Shutting down HTTP server...');
  
  if (expressServer) {
    expressServer.close(() => {
      logger.info('HTTP server closed');
      console.log('HTTP server closed');
      process.exit(0);
    });
    
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

/**
 * @deprecated Use SingleSessionHTTPServer from http-server-single-session.ts instead.
 * This function does not support SSE streaming required by clients like OpenAI Codex.
 */
export async function startFixedHTTPServer() {
  // Log deprecation warning
  logger.warn(
    'DEPRECATION: startFixedHTTPServer() is deprecated as of v2.31.8. ' +
    'Use SingleSessionHTTPServer which supports SSE streaming. ' +
    'See: https://github.com/czlonkowski/n8n-mcp/issues/524'
  );

  validateEnvironment();
  
  const app = express();
  
  // Configure trust proxy for correct IP logging behind reverse proxies
  const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0;
  if (trustProxy > 0) {
    app.set('trust proxy', trustProxy);
    logger.info(`Trust proxy enabled with ${trustProxy} hop(s)`);
  }
  
  // CRITICAL: Don't use any body parser - StreamableHTTPServerTransport needs raw stream
  
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  
  // Request logging
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      contentLength: req.get('content-length')
    });
    next();
  });
  
  // Create a single persistent MCP server instance
  const mcpServer = new N8NDocumentationMCPServer();
  logger.info('Created persistent MCP server instance');

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

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      mode: 'http-fixed',
      version: PROJECT_VERSION,
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        unit: 'MB'
      },
      timestamp: new Date().toISOString()
    });
  });

  // Version endpoint
  app.get('/version', (req, res) => {
    res.json({ 
      version: PROJECT_VERSION,
      buildTime: new Date().toISOString(),
      tools: n8nDocumentationToolsFinal.map(t => t.name),
      commit: process.env.GIT_COMMIT || 'unknown'
    });
  });

  // Test tools endpoint
  app.get('/test-tools', async (req, res) => {
    try {
      const result = await mcpServer.executeTool('get_node_essentials', { nodeType: 'nodes-base.httpRequest' });
      res.json({ status: 'ok', hasData: !!result, toolCount: n8nDocumentationToolsFinal.length });
    } catch (error) {
      res.json({ status: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // MCP information endpoint (no auth required for discovery)
  app.get('/mcp', (req, res) => {
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

  // Main MCP endpoint - handle each request with custom transport handling
  app.post('/mcp', async (req: express.Request, res: express.Response): Promise<void> => {
    const startTime = Date.now();
    
    // Enhanced authentication check with specific logging
    const authHeader = req.headers.authorization;
    
    // Check if Authorization header is missing
    if (!authHeader) {
      logger.warn('Authentication failed: Missing Authorization header', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        reason: 'no_auth_header'
      });
      res.setHeader('WWW-Authenticate', buildBearerChallenge('no_auth_header'));
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
      res.setHeader('WWW-Authenticate', buildBearerChallenge('invalid_auth_format'));
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
    const isValidToken = authToken &&
      AuthManager.timingSafeCompare(token, authToken);

    if (!isValidToken) {
      logger.warn('Authentication failed: Invalid token', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        reason: 'invalid_token'
      });
      res.setHeader('WWW-Authenticate', buildBearerChallenge('invalid_token'));
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
      // Instead of using StreamableHTTPServerTransport, we'll handle the request directly
      // This avoids the initialization issues with the transport
      
      // Collect the raw body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const jsonRpcRequest = JSON.parse(body);
          logger.debug('Received JSON-RPC request:', { method: jsonRpcRequest.method });
          
          // Handle the request based on method
          let response;
          
          switch (jsonRpcRequest.method) {
            case 'initialize':
              // Negotiate protocol version for this client/request
              const negotiationResult = negotiateProtocolVersion(
                jsonRpcRequest.params?.protocolVersion,
                jsonRpcRequest.params?.clientInfo,
                req.get('user-agent'),
                req.headers
              );
              
              logProtocolNegotiation(negotiationResult, logger, 'HTTP_SERVER_INITIALIZE');
              
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
                    version: PROJECT_VERSION
                  }
                },
                id: jsonRpcRequest.id
              };
              break;
              
            case 'tools/list':
              // Use the proper tool list that includes management tools when configured
              const tools = [...n8nDocumentationToolsFinal];
              
              // Add management tools if n8n API is configured
              if (isN8nApiConfigured()) {
                tools.push(...n8nManagementTools);
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
              // Delegate to the MCP server
              const toolName = jsonRpcRequest.params?.name;
              const toolArgs = jsonRpcRequest.params?.arguments || {};

              try {
                const result = await mcpServer.executeTool(toolName, toolArgs);

                // Convert result to JSON text for content field
                let responseText = JSON.stringify(result, null, 2);

                // Build MCP-compliant response with structuredContent for validation tools
                const mcpResult: MCPToolResponse = {
                  content: [
                    {
                      type: 'text',
                      text: responseText
                    }
                  ]
                };

                // Add structuredContent for validation tools (they have outputSchema)
                // Apply 1MB safety limit to prevent memory issues (matches STDIO server behavior)
                if (toolName.startsWith('validate_')) {
                  const resultSize = responseText.length;

                  if (resultSize > 1000000) {
                    // Response is too large - truncate and warn
                    logger.warn(
                      `Validation tool ${toolName} response is very large (${resultSize} chars). ` +
                      `Truncating for HTTP transport safety.`
                    );
                    mcpResult.content[0].text = responseText.substring(0, 999000) +
                      '\n\n[Response truncated due to size limits]';
                    // Don't include structuredContent for truncated responses
                  } else {
                    // Normal case - include structured content for MCP protocol compliance
                    mcpResult.structuredContent = result;
                  }
                }

                response = {
                  jsonrpc: '2.0',
                  result: mcpResult,
                  id: jsonRpcRequest.id
                };
              } catch (error) {
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
          
          // Send response
          res.setHeader('Content-Type', 'application/json');
          res.json(response);
          
          const duration = Date.now() - startTime;
          logger.info('MCP request completed', { 
            duration,
            method: jsonRpcRequest.method 
          });
        } catch (error) {
          logger.error('Error processing request:', error);
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
    } catch (error) {
      logger.error('MCP request error:', error);
      
      if (!res.headersSent) {
        res.status(500).json({ 
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
            data: process.env.NODE_ENV === 'development' 
              ? (error as Error).message 
              : undefined
          },
          id: null
        });
      }
    }
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
  
  expressServer = app.listen(port, host, () => {
    logger.info(`n8n MCP Fixed HTTP Server started`, { port, host });
    
    // Detect the base URL using our utility
    const baseUrl = getStartupBaseUrl(host, port);
    const endpoints = formatEndpointUrls(baseUrl);
    
    console.log(`n8n MCP Fixed HTTP Server running on ${host}:${port}`);
    console.log(`Health check: ${endpoints.health}`);
    console.log(`MCP endpoint: ${endpoints.mcp}`);
    console.log('\nPress Ctrl+C to stop the server');
    
    // Start periodic warning timer if using default token
    if (authToken === 'REPLACE_THIS_AUTH_TOKEN_32_CHARS_MIN_abcdefgh') {
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
  
  // Handle errors
  expressServer.on('error', (error: any) => {
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
  
  // Graceful shutdown handlers
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
}

// Make executeTool public on the server
declare module './mcp/server' {
  interface N8NDocumentationMCPServer {
    executeTool(name: string, args: any): Promise<any>;
  }
}

// Start if called directly
// Check if this file is being run directly (not imported)
// In ES modules, we check import.meta.url against process.argv[1]
// But since we're transpiling to CommonJS, we use the require.main check
if (typeof require !== 'undefined' && require.main === module) {
  startFixedHTTPServer().catch(error => {
    logger.error('Failed to start Fixed HTTP server:', error);
    console.error('Failed to start Fixed HTTP server:', error);
    process.exit(1);
  });
}