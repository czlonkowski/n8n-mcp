import { NodeRepository } from '../database/node-repository';
import { CommunityNodeFetcher } from './community-node-fetcher';
import { DocumentationGenerator } from './documentation-generator';
export interface BatchProcessorOptions {
    skipExistingReadme?: boolean;
    skipExistingSummary?: boolean;
    readmeOnly?: boolean;
    summaryOnly?: boolean;
    limit?: number;
    readmeConcurrency?: number;
    llmConcurrency?: number;
    progressCallback?: (message: string, current: number, total: number) => void;
}
export interface BatchProcessorResult {
    readmesFetched: number;
    readmesFailed: number;
    summariesGenerated: number;
    summariesFailed: number;
    skipped: number;
    durationSeconds: number;
    errors: string[];
}
export declare class DocumentationBatchProcessor {
    private repository;
    private fetcher;
    private generator;
    constructor(repository: NodeRepository, fetcher?: CommunityNodeFetcher, generator?: DocumentationGenerator);
    processAll(options?: BatchProcessorOptions): Promise<BatchProcessorResult>;
    private fetchReadmes;
    private generateSummaries;
    getStats(): ReturnType<NodeRepository['getDocumentationStats']>;
}
//# sourceMappingURL=documentation-batch-processor.d.ts.map