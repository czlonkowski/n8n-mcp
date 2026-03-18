export interface UIAppConfig {
    id: string;
    displayName: string;
    description: string;
    uri: string;
    mimeType: string;
    toolPatterns: string[];
}
export interface UIMetadata {
    ui: {
        resourceUri: string;
    };
}
export interface UIAppEntry {
    config: UIAppConfig;
    html: string | null;
}
//# sourceMappingURL=types.d.ts.map