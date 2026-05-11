import { z } from 'zod';
import { TelemetryEvent, WorkflowTelemetry } from './telemetry-types';
export declare const telemetryEventSchema: z.ZodObject<{
    user_id: z.ZodString;
    event: z.ZodString;
    properties: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, any>, Record<string, unknown>>;
    created_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    properties: Record<string, any>;
    event: string;
    user_id: string;
    created_at?: string | undefined;
}, {
    properties: Record<string, unknown>;
    event: string;
    user_id: string;
    created_at?: string | undefined;
}>;
export declare const workflowTelemetrySchema: z.ZodObject<{
    user_id: z.ZodString;
    workflow_hash: z.ZodString;
    node_count: z.ZodNumber;
    node_types: z.ZodArray<z.ZodString, "many">;
    has_trigger: z.ZodBoolean;
    has_webhook: z.ZodBoolean;
    complexity: z.ZodEnum<["simple", "medium", "complex"]>;
    sanitized_workflow: z.ZodObject<{
        nodes: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            type: z.ZodString;
            typeVersion: z.ZodNumber;
            position: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
            parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            disabled: z.ZodOptional<z.ZodBoolean>;
            notes: z.ZodOptional<z.ZodString>;
            notesInFlow: z.ZodOptional<z.ZodBoolean>;
            continueOnFail: z.ZodOptional<z.ZodBoolean>;
            retryOnFail: z.ZodOptional<z.ZodBoolean>;
            maxTries: z.ZodOptional<z.ZodNumber>;
            waitBetweenTries: z.ZodOptional<z.ZodNumber>;
            alwaysOutputData: z.ZodOptional<z.ZodBoolean>;
            executeOnce: z.ZodOptional<z.ZodBoolean>;
            onError: z.ZodOptional<z.ZodEnum<["continueRegularOutput", "continueErrorOutput", "stopWorkflow"]>>;
            webhookId: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            type: string;
            id: string;
            name: string;
            typeVersion: number;
            position: [number, number];
            parameters: Record<string, unknown>;
            onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow" | undefined;
            retryOnFail?: boolean | undefined;
            continueOnFail?: boolean | undefined;
            maxTries?: number | undefined;
            waitBetweenTries?: number | undefined;
            alwaysOutputData?: boolean | undefined;
            disabled?: boolean | undefined;
            notes?: string | undefined;
            notesInFlow?: boolean | undefined;
            executeOnce?: boolean | undefined;
            webhookId?: string | undefined;
        }, {
            type: string;
            id: string;
            name: string;
            typeVersion: number;
            position: [number, number];
            parameters: Record<string, unknown>;
            onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow" | undefined;
            retryOnFail?: boolean | undefined;
            continueOnFail?: boolean | undefined;
            maxTries?: number | undefined;
            waitBetweenTries?: number | undefined;
            alwaysOutputData?: boolean | undefined;
            disabled?: boolean | undefined;
            notes?: string | undefined;
            notesInFlow?: boolean | undefined;
            executeOnce?: boolean | undefined;
            webhookId?: string | undefined;
        }>, "many">;
        connections: z.ZodRecord<z.ZodString, z.ZodAny>;
    }, "strip", z.ZodTypeAny, {
        nodes: {
            type: string;
            id: string;
            name: string;
            typeVersion: number;
            position: [number, number];
            parameters: Record<string, unknown>;
            onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow" | undefined;
            retryOnFail?: boolean | undefined;
            continueOnFail?: boolean | undefined;
            maxTries?: number | undefined;
            waitBetweenTries?: number | undefined;
            alwaysOutputData?: boolean | undefined;
            disabled?: boolean | undefined;
            notes?: string | undefined;
            notesInFlow?: boolean | undefined;
            executeOnce?: boolean | undefined;
            webhookId?: string | undefined;
        }[];
        connections: Record<string, any>;
    }, {
        nodes: {
            type: string;
            id: string;
            name: string;
            typeVersion: number;
            position: [number, number];
            parameters: Record<string, unknown>;
            onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow" | undefined;
            retryOnFail?: boolean | undefined;
            continueOnFail?: boolean | undefined;
            maxTries?: number | undefined;
            waitBetweenTries?: number | undefined;
            alwaysOutputData?: boolean | undefined;
            disabled?: boolean | undefined;
            notes?: string | undefined;
            notesInFlow?: boolean | undefined;
            executeOnce?: boolean | undefined;
            webhookId?: string | undefined;
        }[];
        connections: Record<string, any>;
    }>;
    created_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    complexity: "simple" | "medium" | "complex";
    user_id: string;
    workflow_hash: string;
    node_count: number;
    node_types: string[];
    has_trigger: boolean;
    has_webhook: boolean;
    sanitized_workflow: {
        nodes: {
            type: string;
            id: string;
            name: string;
            typeVersion: number;
            position: [number, number];
            parameters: Record<string, unknown>;
            onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow" | undefined;
            retryOnFail?: boolean | undefined;
            continueOnFail?: boolean | undefined;
            maxTries?: number | undefined;
            waitBetweenTries?: number | undefined;
            alwaysOutputData?: boolean | undefined;
            disabled?: boolean | undefined;
            notes?: string | undefined;
            notesInFlow?: boolean | undefined;
            executeOnce?: boolean | undefined;
            webhookId?: string | undefined;
        }[];
        connections: Record<string, any>;
    };
    created_at?: string | undefined;
}, {
    complexity: "simple" | "medium" | "complex";
    user_id: string;
    workflow_hash: string;
    node_count: number;
    node_types: string[];
    has_trigger: boolean;
    has_webhook: boolean;
    sanitized_workflow: {
        nodes: {
            type: string;
            id: string;
            name: string;
            typeVersion: number;
            position: [number, number];
            parameters: Record<string, unknown>;
            onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow" | undefined;
            retryOnFail?: boolean | undefined;
            continueOnFail?: boolean | undefined;
            maxTries?: number | undefined;
            waitBetweenTries?: number | undefined;
            alwaysOutputData?: boolean | undefined;
            disabled?: boolean | undefined;
            notes?: string | undefined;
            notesInFlow?: boolean | undefined;
            executeOnce?: boolean | undefined;
            webhookId?: string | undefined;
        }[];
        connections: Record<string, any>;
    };
    created_at?: string | undefined;
}>;
export declare class TelemetryEventValidator {
    private validationErrors;
    private validationSuccesses;
    validateEvent(event: TelemetryEvent): TelemetryEvent | null;
    validateWorkflow(workflow: WorkflowTelemetry): WorkflowTelemetry | null;
    getStats(): {
        errors: number;
        successes: number;
        total: number;
        errorRate: number;
    };
    resetStats(): void;
}
//# sourceMappingURL=event-validator.d.ts.map