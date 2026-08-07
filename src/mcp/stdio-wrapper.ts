#!/usr/bin/env node

/**
 * Stdio wrapper for MCP server
 * Ensures clean JSON-RPC communication by suppressing all non-JSON output
 */

// Telemetry CLI fast path — must run BEFORE console suppression and MCP_MODE
// setup, since these subcommands print status/help to stdout and exit.
// The wrapper is the published bin entry (see package.json, Issue #693), so
// this keeps `npx n8n-mcp telemetry ...` working — documented in PRIVACY.md
// and README.md. Lazy-required so no telemetry code loads on the stdio hot
// path when the wrapper is invoked without a subcommand.
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { handleTelemetryCliIfPresent } = require('../telemetry/telemetry-cli');
  handleTelemetryCliIfPresent(process.argv.slice(2));
}

// CRITICAL: Set environment BEFORE any imports to prevent any initialization logs
process.env.MCP_MODE = 'stdio';
process.env.DISABLE_CONSOLE_OUTPUT = 'true';
process.env.LOG_LEVEL = 'error';

// Suppress console output and shield the JSON-RPC channel before anything else.
// Lazy-required (like the telemetry fast path above) so the guard installs before
// any `import` in this file is resolved — that ordering is the whole point of this
// wrapper. See utils/stdio-guard.ts for the filter and for why silenceConsole is
// set here but not on the index.ts entrypoint.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { installStdioGuard } = require('../utils/stdio-guard');
const originalConsoleError = installStdioGuard({ silenceConsole: true }).error;

// Load the server AFTER the guard is installed.
//
// The type-only import is erased at compile time, so it cannot pull ./server in
// early; the value comes from the require below. A static value import would work
// under the current commonjs emit — tsc keeps the require at this position — but
// would be hoisted above the guard under an ESM emit, silently defeating the
// ordering this whole file exists to guarantee. The require makes that invariant
// explicit rather than dependent on the module target.
import type { N8NDocumentationMCPServer as N8NDocumentationMCPServerType } from './server';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { N8NDocumentationMCPServer } = require('./server') as {
  N8NDocumentationMCPServer: typeof import('./server').N8NDocumentationMCPServer;
};

let server: N8NDocumentationMCPServerType | null = null;

async function main() {
  try {
    server = new N8NDocumentationMCPServer();
    await server.run();
  } catch (error) {
    // In case of fatal error, output to stderr only
    originalConsoleError('Fatal error:', error);
    process.exit(1);
  }
}

// Handle uncaught errors silently
process.on('uncaughtException', (error) => {
  originalConsoleError('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  originalConsoleError('Unhandled rejection:', reason);
  process.exit(1);
});

// Handle termination signals for proper cleanup
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  // Log to stderr only (not stdout which would corrupt JSON-RPC)
  originalConsoleError(`Received ${signal}, shutting down gracefully...`);
  
  try {
    // Shutdown the server if it exists
    if (server) {
      await server.shutdown();
    }
  } catch (error) {
    originalConsoleError('Error during shutdown:', error);
  }
  
  // Platform-aware stdin teardown — see stdin-teardown.ts (Issues #383/#385).
  // Lazy-required (like the telemetry fast path above) so it stays off the
  // stdio hot path and avoids any import-ordering ambiguity with the output
  // suppression set up above.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tearDownStdin } = require('../utils/stdin-teardown');
  tearDownStdin();

  // Exit with timeout to ensure we don't hang
  setTimeout(() => {
    process.exit(0);
  }, 500).unref(); // unref() allows process to exit if this is the only thing keeping it alive
  
  // But also exit immediately if nothing else is pending
  process.exit(0);
}

// Register signal handlers
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGHUP', () => void shutdown('SIGHUP'));

// Also handle stdin close (when Claude Desktop closes the pipe)
process.stdin.on('end', () => {
  originalConsoleError('stdin closed, shutting down...');
  void shutdown('STDIN_CLOSE');
});

main();