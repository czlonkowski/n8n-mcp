export * from './node-types';
export * from './type-structures';
export * from './instance-context';
export * from './session-state';
export * from './generate-workflow';
export interface MCPServerConfig {
    port: number;
    host: string;
    authToken?: string;
}
export interface ToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
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
    annotations?: ToolAnnotations;
    _meta?: {
        ui?: {
            resourceUri?: string;
        };
        'anthropic/maxResultSizeChars'?: number;
        [key: string]: unknown;
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
//# sourceMappingURL=index.d.ts.map