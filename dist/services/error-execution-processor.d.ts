import { Execution, Workflow, ErrorAnalysis } from '../types/n8n-api';
export interface ErrorProcessorOptions {
    itemsLimit?: number;
    includeStackTrace?: boolean;
    includeExecutionPath?: boolean;
    workflow?: Workflow;
}
export declare function processErrorExecution(execution: Execution, options?: ErrorProcessorOptions): ErrorAnalysis;
//# sourceMappingURL=error-execution-processor.d.ts.map