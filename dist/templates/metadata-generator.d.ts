import { z } from 'zod';
export declare const TemplateMetadataSchema: z.ZodObject<{
    categories: z.ZodArray<z.ZodString, "many">;
    complexity: z.ZodEnum<["simple", "medium", "complex"]>;
    use_cases: z.ZodArray<z.ZodString, "many">;
    estimated_setup_minutes: z.ZodNumber;
    required_services: z.ZodArray<z.ZodString, "many">;
    key_features: z.ZodArray<z.ZodString, "many">;
    target_audience: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    complexity: "simple" | "medium" | "complex";
    categories: string[];
    use_cases: string[];
    estimated_setup_minutes: number;
    required_services: string[];
    key_features: string[];
    target_audience: string[];
}, {
    complexity: "simple" | "medium" | "complex";
    categories: string[];
    use_cases: string[];
    estimated_setup_minutes: number;
    required_services: string[];
    key_features: string[];
    target_audience: string[];
}>;
export type TemplateMetadata = z.infer<typeof TemplateMetadataSchema>;
export interface MetadataRequest {
    templateId: number;
    name: string;
    description?: string;
    nodes: string[];
    workflow?: any;
}
export interface MetadataResult {
    templateId: number;
    metadata: TemplateMetadata;
    error?: string;
}
export declare class MetadataGenerator {
    private client;
    private model;
    constructor(apiKey: string, model?: string, baseURL?: string);
    private getJsonSchema;
    createBatchRequest(template: MetadataRequest): any;
    private sanitizeInput;
    private summarizeNodes;
    parseResult(result: any): MetadataResult;
    private getDefaultMetadata;
    buildChatRequest(template: MetadataRequest): {
        model: string;
        max_completion_tokens: number;
        response_format: any;
        messages: ({
            role: "system";
            content: string;
        } | {
            role: "user";
            content: string;
        })[];
    };
    generateDirect(template: MetadataRequest): Promise<MetadataResult>;
    generateSingle(template: MetadataRequest): Promise<TemplateMetadata>;
}
//# sourceMappingURL=metadata-generator.d.ts.map