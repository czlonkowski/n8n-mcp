// Export n8n node type definitions and utilities
export * from './node-types';
export * from './type-structures';
export * from './instance-context';
export * from './session-state';

export interface MCPServerConfig {
  port: number;
  host: string;
  authToken?: string;
}

/**
 * MCP Tool annotations to help AI assistants understand tool behavior.
 * Per MCP spec: https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/#annotations
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool */
  title?: string;
  /** If true, the tool does not modify its environment */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive updates to its environment */
  destructiveHint?: boolean;
  /** If true, calling the tool repeatedly with the same arguments has no additional effect */
  idempotentHint?: boolean;
  /** If true, the tool may interact with external entities (APIs, services) */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean | Record<string, any>;
  };
  outputSchema?: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean | Record<string, any>;
  };
  /** Tool behavior hints for AI assistants */
  annotations?: ToolAnnotations;
  _meta?: {
    ui?: {
      resourceUri?: string;
    };
  };
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}