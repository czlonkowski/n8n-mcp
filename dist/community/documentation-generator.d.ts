import { z } from 'zod';
export declare const DocumentationSummarySchema: z.ZodObject<{
    purpose: z.ZodString;
    capabilities: z.ZodArray<z.ZodString, "many">;
    authentication: z.ZodString;
    commonUseCases: z.ZodArray<z.ZodString, "many">;
    limitations: z.ZodArray<z.ZodString, "many">;
    relatedNodes: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    authentication: string;
    capabilities: string[];
    purpose: string;
    commonUseCases: string[];
    limitations: string[];
    relatedNodes: string[];
}, {
    authentication: string;
    capabilities: string[];
    purpose: string;
    commonUseCases: string[];
    limitations: string[];
    relatedNodes: string[];
}>;
export type DocumentationSummary = z.infer<typeof DocumentationSummarySchema>;
export interface DocumentationInput {
    nodeType: string;
    displayName: string;
    description?: string;
    readme: string;
    npmPackageName?: string;
}
export interface DocumentationResult {
    nodeType: string;
    summary: DocumentationSummary;
    error?: string;
}
export interface DocumentationGeneratorConfig {
    baseUrl: string;
    model?: string;
    apiKey?: string;
    timeout?: number;
    maxTokens?: number;
    temperature?: number;
}
export declare class DocumentationGenerator {
    private client;
    private model;
    private maxTokens;
    private timeout;
    private temperature?;
    constructor(config: DocumentationGeneratorConfig);
    generateSummary(input: DocumentationInput): Promise<DocumentationResult>;
    generateBatch(inputs: DocumentationInput[], concurrency?: number, progressCallback?: (message: string, current: number, total: number) => void): Promise<DocumentationResult[]>;
    private buildPrompt;
    private getSystemPrompt;
    private extractJson;
    private truncateArrayFields;
    private truncateReadme;
    private getDefaultSummary;
    testConnection(): Promise<{
        success: boolean;
        message: string;
    }>;
    private sleep;
}
export declare function createDocumentationGenerator(): DocumentationGenerator;
//# sourceMappingURL=documentation-generator.d.ts.map