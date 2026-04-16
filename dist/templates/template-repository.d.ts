import { DatabaseAdapter } from '../database/database-adapter';
import { TemplateWorkflow, TemplateDetail } from './template-fetcher';
export interface StoredTemplate {
    id: number;
    workflow_id: number;
    name: string;
    description: string;
    author_name: string;
    author_username: string;
    author_verified: number;
    nodes_used: string;
    workflow_json?: string;
    workflow_json_compressed?: string;
    categories: string;
    views: number;
    created_at: string;
    updated_at: string;
    url: string;
    scraped_at: string;
    metadata_json?: string;
    metadata_generated_at?: string;
}
export declare class TemplateRepository {
    private db;
    private sanitizer;
    private hasFTS5Support;
    constructor(db: DatabaseAdapter);
    private initializeFTS5;
    saveTemplate(workflow: TemplateWorkflow, detail: TemplateDetail, categories?: string[]): void;
    getTemplatesByNodes(nodeTypes: string[], limit?: number, offset?: number): StoredTemplate[];
    getTemplate(templateId: number): StoredTemplate | null;
    private decompressWorkflow;
    searchTemplates(query: string, limit?: number, offset?: number): StoredTemplate[];
    private searchTemplatesLIKE;
    getTemplatesForTask(task: string, limit?: number, offset?: number): StoredTemplate[];
    getAllTemplates(limit?: number, offset?: number, sortBy?: 'views' | 'created_at' | 'name'): StoredTemplate[];
    getTemplateCount(): number;
    getSearchCount(query: string): number;
    getNodeTemplatesCount(nodeTypes: string[]): number;
    getTaskTemplatesCount(task: string): number;
    getExistingTemplateIds(): Set<number>;
    getMostRecentTemplateDate(): Date | null;
    hasTemplate(templateId: number): boolean;
    getTemplateMetadata(): Map<number, {
        name: string;
        updated_at: string;
    }>;
    getTemplateStats(): Record<string, any>;
    clearTemplates(): void;
    rebuildTemplateFTS(): void;
    updateTemplateMetadata(templateId: number, metadata: any): void;
    batchUpdateMetadata(metadataMap: Map<number, any>): void;
    getTemplatesWithoutMetadata(limit?: number): StoredTemplate[];
    getTemplatesWithOutdatedMetadata(daysOld?: number, limit?: number): StoredTemplate[];
    getMetadataStats(): {
        total: number;
        withMetadata: number;
        withoutMetadata: number;
        outdated: number;
    };
    private buildMetadataFilterConditions;
    searchTemplatesByMetadata(filters: {
        category?: string;
        complexity?: 'simple' | 'medium' | 'complex';
        maxSetupMinutes?: number;
        minSetupMinutes?: number;
        requiredService?: string;
        targetAudience?: string;
    }, limit?: number, offset?: number): StoredTemplate[];
    getMetadataSearchCount(filters: {
        category?: string;
        complexity?: 'simple' | 'medium' | 'complex';
        maxSetupMinutes?: number;
        minSetupMinutes?: number;
        requiredService?: string;
        targetAudience?: string;
    }): number;
    hasMetadataCoverage(): boolean;
    getAvailableCategories(): string[];
    getAvailableTargetAudiences(): string[];
    getTemplatesByCategory(category: string, limit?: number, offset?: number): StoredTemplate[];
    getTemplatesByComplexity(complexity: 'simple' | 'medium' | 'complex', limit?: number, offset?: number): StoredTemplate[];
    getSearchTemplatesByMetadataCount(filters: {
        category?: string;
        complexity?: 'simple' | 'medium' | 'complex';
        maxSetupMinutes?: number;
        minSetupMinutes?: number;
        requiredService?: string;
        targetAudience?: string;
    }): number;
    getUniqueCategories(): string[];
    getUniqueTargetAudiences(): string[];
}
//# sourceMappingURL=template-repository.d.ts.map