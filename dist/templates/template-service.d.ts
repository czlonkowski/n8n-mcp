import { DatabaseAdapter } from '../database/database-adapter';
export interface TemplateInfo {
    id: number;
    name: string;
    description: string;
    author: {
        name: string;
        username: string;
        verified: boolean;
    };
    nodes: string[];
    views: number;
    created: string;
    url: string;
    metadata?: {
        categories: string[];
        complexity: 'simple' | 'medium' | 'complex';
        use_cases: string[];
        estimated_setup_minutes: number;
        required_services: string[];
        key_features: string[];
        target_audience: string[];
    };
}
export interface TemplateWithWorkflow extends TemplateInfo {
    workflow: any;
}
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}
export interface TemplateMinimal {
    id: number;
    name: string;
    description: string;
    views: number;
    nodeCount: number;
    metadata?: {
        categories: string[];
        complexity: 'simple' | 'medium' | 'complex';
        use_cases: string[];
        estimated_setup_minutes: number;
        required_services: string[];
        key_features: string[];
        target_audience: string[];
    };
}
export type TemplateField = 'id' | 'name' | 'description' | 'author' | 'nodes' | 'views' | 'created' | 'url' | 'metadata';
export type PartialTemplateInfo = Partial<TemplateInfo>;
export declare class TemplateService {
    private repository;
    constructor(db: DatabaseAdapter);
    listNodeTemplates(nodeTypes: string[], limit?: number, offset?: number): Promise<PaginatedResponse<TemplateInfo>>;
    getTemplate(templateId: number, mode?: 'nodes_only' | 'structure' | 'full'): Promise<any>;
    searchTemplates(query: string, limit?: number, offset?: number, fields?: string[]): Promise<PaginatedResponse<PartialTemplateInfo>>;
    getTemplatesForTask(task: string, limit?: number, offset?: number): Promise<PaginatedResponse<TemplateInfo>>;
    listTemplates(limit?: number, offset?: number, sortBy?: 'views' | 'created_at' | 'name', includeMetadata?: boolean): Promise<PaginatedResponse<TemplateMinimal>>;
    listAvailableTasks(): string[];
    searchTemplatesByMetadata(filters: {
        category?: string;
        complexity?: 'simple' | 'medium' | 'complex';
        maxSetupMinutes?: number;
        minSetupMinutes?: number;
        requiredService?: string;
        targetAudience?: string;
    }, limit?: number, offset?: number): Promise<PaginatedResponse<TemplateInfo>>;
    hasMetadataCoverage(): Promise<boolean>;
    getAvailableCategories(): Promise<string[]>;
    getAvailableTargetAudiences(): Promise<string[]>;
    getTemplatesByCategory(category: string, limit?: number, offset?: number): Promise<PaginatedResponse<TemplateInfo>>;
    getTemplatesByComplexity(complexity: 'simple' | 'medium' | 'complex', limit?: number, offset?: number): Promise<PaginatedResponse<TemplateInfo>>;
    getTemplateStats(): Promise<Record<string, any>>;
    fetchAndUpdateTemplates(progressCallback?: (message: string, current: number, total: number) => void, mode?: 'rebuild' | 'update'): Promise<void>;
    private formatTemplateInfo;
    private formatTemplateWithFields;
}
//# sourceMappingURL=template-service.d.ts.map