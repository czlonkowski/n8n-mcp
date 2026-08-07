/**
 * n8n-MCP - Model Context Protocol Server for n8n
 * Copyright (c) 2024 AiAdvisors Romuald Czlonkowski
 * Licensed under the Sustainable Use License v1.0
 */

// Engine exports for service integration
export { N8NMCPEngine, EngineHealth, EngineOptions } from './mcp-engine';
export { SingleSessionHTTPServer } from './http-server-single-session';
export { ConsoleManager } from './utils/console-manager';
export { N8NDocumentationMCPServer } from './mcp/server';
// Embedders driving the stdio transport should call this before constructing the
// server, so database-initialization logging cannot reach the JSON-RPC channel.
export { installStdioGuard, StdioGuardOptions, OriginalConsole } from './utils/stdio-guard';

// Type exports for multi-tenant and library usage
export type {
  InstanceContext
} from './types/instance-context';
export {
  validateInstanceContext,
  isInstanceContext
} from './types/instance-context';
export type {
  SessionState
} from './types/session-state';
export type {
  AdditionalTool,
  AdditionalToolContext
} from './types/additional-tools';

// UI module exports
export type { UIAppConfig, UIMetadata } from './mcp/ui/types';
export { UI_APP_CONFIGS } from './mcp/ui/app-configs';

// Re-export MCP SDK types for convenience
export type {
  Tool,
  CallToolResult,
  ListToolsResult
} from '@modelcontextprotocol/sdk/types.js';

// Default export for convenience
import N8NMCPEngine from './mcp-engine';
export default N8NMCPEngine;

// Legacy CLI functionality - moved to ./mcp/index.ts
// This file now serves as the main entry point for library usage