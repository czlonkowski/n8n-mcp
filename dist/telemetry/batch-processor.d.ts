import { SupabaseClient } from '@supabase/supabase-js';
import { TelemetryEvent, WorkflowTelemetry, WorkflowMutationRecord, TelemetryMetrics } from './telemetry-types';
export declare class TelemetryBatchProcessor {
    private supabase;
    private isEnabled;
    private flushTimer?;
    private isFlushingEvents;
    private isFlushingWorkflows;
    private isFlushingMutations;
    private circuitBreaker;
    private metrics;
    private flushTimes;
    private deadLetterQueue;
    private readonly maxDeadLetterSize;
    private eventListeners;
    private started;
    constructor(supabase: SupabaseClient | null, isEnabled: () => boolean);
    start(): void;
    stop(): void;
    flush(events?: TelemetryEvent[], workflows?: WorkflowTelemetry[], mutations?: WorkflowMutationRecord[]): Promise<void>;
    private flushEvents;
    private flushWorkflows;
    private flushMutations;
    private executeWithRetry;
    private createBatches;
    private deduplicateWorkflows;
    private addToDeadLetterQueue;
    private processDeadLetterQueue;
    private recordFlushTime;
    getMetrics(): TelemetryMetrics & {
        circuitBreakerState: any;
        deadLetterQueueSize: number;
    };
    resetMetrics(): void;
}
//# sourceMappingURL=batch-processor.d.ts.map