#!/usr/bin/env node

import { N8NDocumentationMCPServer } from './server';
import { logger } from '../utils/logger';
import { handleTelemetryCliIfPresent } from '../telemetry/telemetry-cli';
import { EarlyErrorLogger } from '../telemetry/early-error-logger';
import { STARTUP_CHECKPOINTS, findFailedCheckpoint, StartupCheckpoint } from '../telemetry/startup-checkpoints';

// Add error details to stderr for Claude Desktop debugging
process.on('uncaughtException', (error) => {
  if (process.env.MCP_MODE !== 'stdio') {
    console.error('Uncaught Exception:', error);
  }
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  if (process.env.MCP_MODE !== 'stdio') {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  }
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

async function main() {
  // Initialize early error logger for pre-handshake error capture (v2.18.3)
  // Now using singleton pattern with defensive initialization
  const startTime = Date.now();
  const earlyLogger = EarlyErrorLogger.getInstance();
  const checkpoints: StartupCheckpoint[] = [];

  try {
    // Checkpoint: Process started (fire-and-forget, no await)
    earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.PROCESS_STARTED);
    checkpoints.push(STARTUP_CHECKPOINTS.PROCESS_STARTED);

    // Handle telemetry CLI commands (exits on match)
    handleTelemetryCliIfPresent(process.argv.slice(2));

    const mode = process.env.MCP_MODE || 'stdio';

    // Checkpoint: Telemetry initializing (fire-and-forget, no await)
    earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.TELEMETRY_INITIALIZING);
    checkpoints.push(STARTUP_CHECKPOINTS.TELEMETRY_INITIALIZING);

    // Telemetry is loaded transitively via EarlyErrorLogger.
    // Mark as ready (fire-and-forget, no await)
    earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.TELEMETRY_READY);
    checkpoints.push(STARTUP_CHECKPOINTS.TELEMETRY_READY);

  try {
    // Only show debug messages in HTTP mode to avoid corrupting stdio communication
    if (mode === 'http') {
      console.error(`Starting n8n Documentation MCP Server in ${mode} mode...`);
      console.error('Current directory:', process.cwd());
      console.error('Node version:', process.version);
    }

    // Checkpoint: MCP handshake starting (fire-and-forget, no await)
    earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.MCP_HANDSHAKE_STARTING);
    checkpoints.push(STARTUP_CHECKPOINTS.MCP_HANDSHAKE_STARTING);
    
    if (mode === 'http') {
      // Check if we should use the fixed implementation (DEPRECATED)
      if (process.env.USE_FIXED_HTTP === 'true') {
        // DEPRECATION WARNING: Fixed HTTP implementation is deprecated
        // It does not support SSE streaming required by clients like OpenAI Codex
        logger.warn(
          'DEPRECATION WARNING: USE_FIXED_HTTP=true is deprecated as of v2.31.8. ' +
          'The fixed HTTP implementation does not support SSE streaming required by clients like OpenAI Codex. ' +
          'Please unset USE_FIXED_HTTP to use the modern SingleSessionHTTPServer which supports both JSON-RPC and SSE. ' +
          'This option will be removed in a future version. See: https://github.com/czlonkowski/n8n-mcp/issues/524'
        );
        console.warn('\n⚠️  DEPRECATION WARNING ⚠️');
        console.warn('USE_FIXED_HTTP=true is deprecated as of v2.31.8.');
        console.warn('The fixed HTTP implementation does not support SSE streaming.');
        console.warn('Please unset USE_FIXED_HTTP to use SingleSessionHTTPServer.');
        console.warn('See: https://github.com/czlonkowski/n8n-mcp/issues/524\n');

        // Use the deprecated fixed HTTP implementation
        const { startFixedHTTPServer } = await import('../http-server');
        await startFixedHTTPServer();
      } else {
        // HTTP mode - for remote deployment with single-session architecture
        const { SingleSessionHTTPServer } = await import('../http-server-single-session');
        const server = new SingleSessionHTTPServer();
        
        // Graceful shutdown handlers
        const shutdown = async () => {
          await server.shutdown();
          process.exit(0);
        };
        
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
        
        await server.start();
      }
    } else {
      // Stdio mode - for local Claude Desktop
      const server = new N8NDocumentationMCPServer(undefined, earlyLogger);

      // Graceful shutdown handler (fixes Issue #277)
      let isShuttingDown = false;
      const shutdown = async (signal: string = 'UNKNOWN') => {
        if (isShuttingDown) return; // Prevent multiple shutdown calls
        isShuttingDown = true;

        try {
          logger.info(`Shutdown initiated by: ${signal}`);

          await server.shutdown();

          // Close stdin to signal we're done reading
          if (process.stdin && !process.stdin.destroyed) {
            process.stdin.pause();
            process.stdin.destroy();
          }

          // Exit with timeout to ensure we don't hang
          // Increased to 1000ms for slower systems
          setTimeout(() => {
            logger.warn('Shutdown timeout exceeded, forcing exit');
            process.exit(0);
          }, 1000).unref();

          // Let the timeout handle the exit for graceful shutdown
          // (removed immediate exit to allow cleanup to complete)
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      };

      // Handle termination signals (fixes Issue #277)
      // Signal handlers are the fallback shutdown path; stdin close is the primary
      // path for clients that signal shutdown by closing the pipe (Claude Desktop,
      // stateless stdio clients like mcp-go / MCPJungle — see Issue #711).
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGHUP', () => shutdown('SIGHUP'));

      // Handle stdio disconnect — PRIMARY shutdown mechanism (fixes Issue #711).
      // Always register regardless of container detection: stdio MCP cannot
      // function without an open stdin, so there is no legitimate "detached"
      // scenario where we should ignore stdin close.
      if (process.stdin.readable && !process.stdin.destroyed) {
        try {
          process.stdin.on('end', () => shutdown('STDIN_END'));
          process.stdin.on('close', () => shutdown('STDIN_CLOSE'));
        } catch (error) {
          logger.error('Failed to register stdin handlers, using signal handlers only:', error);
          // Continue - signal handlers will still work
        }
      }

      await server.run();
    }

    // Checkpoint: MCP handshake complete (fire-and-forget, no await)
    earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.MCP_HANDSHAKE_COMPLETE);
    checkpoints.push(STARTUP_CHECKPOINTS.MCP_HANDSHAKE_COMPLETE);

    // Checkpoint: Server ready (fire-and-forget, no await)
    earlyLogger.logCheckpoint(STARTUP_CHECKPOINTS.SERVER_READY);
    checkpoints.push(STARTUP_CHECKPOINTS.SERVER_READY);

    // Log successful startup (fire-and-forget, no await)
    const startupDuration = Date.now() - startTime;
    earlyLogger.logStartupSuccess(checkpoints, startupDuration);

    logger.info(`Server startup completed in ${startupDuration}ms (${checkpoints.length} checkpoints passed)`);

  } catch (error) {
    // Log startup error with checkpoint context (fire-and-forget, no await)
    const failedCheckpoint = findFailedCheckpoint(checkpoints);
    earlyLogger.logStartupError(failedCheckpoint, error);

    // In stdio mode, we cannot output to console at all
    if (mode !== 'stdio') {
      console.error('Failed to start MCP server:', error);
      logger.error('Failed to start MCP server', error);

      // Provide helpful error messages
      if (error instanceof Error && error.message.includes('nodes.db not found')) {
        console.error('\nTo fix this issue:');
        console.error('1. cd to the n8n-mcp directory');
        console.error('2. Run: npm run build');
        console.error('3. Run: npm run rebuild');
      } else if (error instanceof Error && error.message.includes('NODE_MODULE_VERSION')) {
        console.error('\nTo fix this Node.js version mismatch:');
        console.error('1. cd to the n8n-mcp directory');
        console.error('2. Run: npm rebuild better-sqlite3');
        console.error('3. If that doesn\'t work, try: rm -rf node_modules && npm install');
      }
    }

    process.exit(1);
  }
  } catch (outerError) {
    // Outer error catch for early initialization failures
    logger.error('Critical startup error:', outerError);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}