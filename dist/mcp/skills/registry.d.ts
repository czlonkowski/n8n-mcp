import type { SkillResource } from './types';
export declare class SkillResourceRegistry {
    private static entries;
    private static loaded;
    static load(rootDir?: string): void;
    static getAll(): SkillResource[];
    static getByUri(uri: string): SkillResource | null;
    static getTemplates(): Array<{
        uriTemplate: string;
        name: string;
        description: string;
        mimeType: string;
    }>;
    static reset(): void;
}
//# sourceMappingURL=registry.d.ts.map