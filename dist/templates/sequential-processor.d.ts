import { MetadataRequest, MetadataResult } from './metadata-generator';
export interface SequentialProcessorOptions {
    apiKey: string;
    baseURL: string;
    model?: string;
    concurrency?: number;
}
export declare class SequentialMetadataProcessor {
    private generator;
    private concurrency;
    constructor(options: SequentialProcessorOptions);
    processTemplates(templates: MetadataRequest[], progressCallback?: (message: string, current: number, total: number) => void): Promise<Map<number, MetadataResult>>;
}
//# sourceMappingURL=sequential-processor.d.ts.map