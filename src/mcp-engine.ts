/**
 * N8N MCP Engine - Clean interface for service integration
 *
 * This class provides a simple API for integrating the n8n-MCP server
 * into larger services. The wrapping service handles authentication,
 * multi-tenancy, rate limiting, etc.
 */
import { Request, Response } from 'express';
import { SingleSessionHTTPServer } from './http-server-single-session';
import { logger } from './utils/logger';
import { InstanceContext } from './types/instance-context';
import { SessionState } from './types/session-state';
import { GenerateWorkflowHandler } from './types/generate-workflow';
import type { AdditionalTool } from './types/additional-tools';

export interface EngineHealth {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  sessionActive: boolean;
  memoryUsage: {
    used: number;
    total: number;
    unit: string;
  };
  version: string;
}

export interface EngineOptions {
  sessionTimeout?: number;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  generateWorkflowHandler?: GenerateWorkflowHandler;
  additionalTools?: AdditionalTool[];
}

export class N8NMCPEngine {
  private server: SingleSessionHTTPServer;
  private startTime: Date;
  
  constructor(options: EngineOptions = {}) {
    this.server = new SingleSessionHTTPServer({
      generateWorkflowHandler: options.generateWorkflowHandler,
      additionalTools: options.additionalTools,
    });
    this.startTime = new Date();

    if (options.logLevel) {
      process.env.LOG_LEVEL = options.logLevel;
    }
  }
  
  /**
   * Process a single MCP request with optional instance context
   * The wrapping service handles authentication, multi-tenancy, etc.
   *
   * @param req - Express request object
   * @param res - Express response object
   * @param instanceContext - Optional instance-specific configuration
   *
   * @example
   * // Basic usage (backward compatible)
   * await engine.processRequest(req, res);
   *
   * @example
   * // With instance context
   * const context: InstanceContext = {
   *   n8nApiUrl: 'https://instance1.n8n.cloud',
   *   n8nApiKey: 'instance1-key',
   *   instanceId: 'tenant-123'
   * };
   * await engine.processRequest(req, res, context);
   */
  async processRequest(
    req: Request,
    res: Response,
    instanceContext?: InstanceContext
  ): Promise<void> {
    try {
      await this.server.handleRequest(req, res, instanceContext);
    } catch (error) {
      logger.error('Engine processRequest error:', error);
      throw error;
    }
  }
  
  /**
   * Health check for service monitoring
   * 
   * @example
   * app.get('/health', async (req, res) => {
   *   const health = await engine.healthCheck();
   *   res.status(health.status === 'healthy' ? 200 : 503).json(health);
   * });
   */
  async healthCheck(): Promise<EngineHealth> {
    try {
      const sessionInfo = this.server.getSessionInfo();
      const memoryUsage = process.memoryUsage();
      
      return {
        status: 'healthy',
        uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
        sessionActive: sessionInfo.active,
        memoryUsage: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          unit: 'MB'
        },
        version: '2.24.1'
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        uptime: 0,
        sessionActive: false,
        memoryUsage: { used: 0, total: 0, unit: 'MB' },
        version: '2.24.1'
      };
    }
  }
  
  /**
   * Get current session information
   * Useful for monitoring and debugging
   */
  getSessionInfo(): { active: boolean; sessionId?: string; age?: number } {
    return this.server.getSessionInfo();
  }

  /**
   * Export all active session state for persistence
   *
   * Used by multi-tenant backends to dump sessions before container restart.
   * Returns an array of session state objects containing metadata and credentials.
   *
   * SECURITY WARNING: Exported data contains plaintext n8n API keys.
   * Encrypt before persisting to disk.
   *
   * @returns Array of session state objects
   *
   * @example
   * // Before shutdown
   * const sessions = engine.exportSessionState();
   * await saveToEncryptedStorage(sessions);
   */
  exportSessionState(): SessionState[] {
    if (!this.server) {
      logger.warn('Cannot export sessions: server not initialized');
      return [];
    }
    return this.server.exportSessionState();
  }

  /**
   * Restore session state from previously exported data
   *
   * Used by multi-tenant backends to restore sessions after container restart.
   * Restores session metadata and instance context. Transports/servers are
   * recreated on first request.
   *
   * @param sessions - Array of session state objects from exportSessionState()
   * @returns Number of sessions successfully restored
   *
   * @example
   * // After startup
   * const sessions = await loadFromEncryptedStorage();
   * const count = engine.restoreSessionState(sessions);
   * console.log(`Restored ${count} sessions`);
   */
  restoreSessionState(sessions: SessionState[]): number {
    if (!this.server) {
      logger.warn('Cannot restore sessions: server not initialized');
      return 0;
    }
    return this.server.restoreSessionState(sessions);
  }

  /**
   * Graceful shutdown for service lifecycle
   *
   * @example
   * process.on('SIGTERM', async () => {
   *   await engine.shutdown();
   *   process.exit(0);
   * });
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down N8N MCP Engine...');
    await this.server.shutdown();
  }
  
  /**
   * Start the engine (if using standalone mode)
   * For embedded use, this is not necessary
   */
  async start(): Promise<void> {
    await this.server.start();
  }
}

/**
 * Example usage with flexible instance configuration:
 *
 * ```typescript
 * import { N8NMCPEngine, InstanceContext } from 'n8n-mcp';
 * import express from 'express';
 *
 * const app = express();
 * const engine = new N8NMCPEngine();
 *
 * // Middleware for authentication
 * const authenticate = (req, res, next) => {
 *   // Your auth logic
 *   req.userId = 'user123';
 *   next();
 * };
 *
 * // MCP endpoint with flexible instance support
 * app.post('/api/instances/:instanceId/mcp', authenticate, async (req, res) => {
 *   // Get instance configuration from your database
 *   const instance = await getInstanceConfig(req.params.instanceId);
 *
 *   // Create instance context
 *   const context: InstanceContext = {
 *     n8nApiUrl: instance.n8nUrl,
 *     n8nApiKey: instance.apiKey,
 *     instanceId: instance.id,
 *     metadata: { userId: req.userId }
 *   };
 *
 *   // Process request with instance context
 *   await engine.processRequest(req, res, context);
 * });
 *
 * // Health endpoint
 * app.get('/health', async (req, res) => {
 *   const health = await engine.healthCheck();
 *   res.json(health);
 * });
 * ```
 */
export default N8NMCPEngine;