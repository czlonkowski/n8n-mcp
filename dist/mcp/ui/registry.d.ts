import type { UIAppEntry } from './types';
export declare class UIAppRegistry {
    private static entries;
    private static toolIndex;
    private static loaded;
    static load(): void;
    static getAppForTool(toolName: string): UIAppEntry | null;
    static getAppById(id: string): UIAppEntry | null;
    static getAllApps(): UIAppEntry[];
    static injectToolMeta(tools: Array<{
        name: string;
        [key: string]: any;
    }>): void;
    static reset(): void;
}
//# sourceMappingURL=registry.d.ts.map