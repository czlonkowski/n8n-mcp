import { z } from 'zod';
import { WorkflowNode, WorkflowConnection, Workflow } from '../types/n8n-api';
export declare const workflowNodeSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodString;
    typeVersion: z.ZodNumber;
    position: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    credentials: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    disabled: z.ZodOptional<z.ZodBoolean>;
    notes: z.ZodOptional<z.ZodString>;
    notesInFlow: z.ZodOptional<z.ZodBoolean>;
    continueOnFail: z.ZodOptional<z.ZodBoolean>;
    retryOnFail: z.ZodOptional<z.ZodBoolean>;
    maxTries: z.ZodOptional<z.ZodNumber>;
    waitBetweenTries: z.ZodOptional<z.ZodNumber>;
    alwaysOutputData: z.ZodOptional<z.ZodBoolean>;
    executeOnce: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    name: string;
    typeVersion: number;
    position: [number, number];
    parameters: Record<string, unknown>;
    credentials?: Record<string, unknown> | undefined;
    retryOnFail?: boolean | undefined;
    continueOnFail?: boolean | undefined;
    maxTries?: number | undefined;
    waitBetweenTries?: number | undefined;
    alwaysOutputData?: boolean | undefined;
    executeOnce?: boolean | undefined;
    disabled?: boolean | undefined;
    notes?: string | undefined;
    notesInFlow?: boolean | undefined;
}, {
    type: string;
    id: string;
    name: string;
    typeVersion: number;
    position: [number, number];
    parameters: Record<string, unknown>;
    credentials?: Record<string, unknown> | undefined;
    retryOnFail?: boolean | undefined;
    continueOnFail?: boolean | undefined;
    maxTries?: number | undefined;
    waitBetweenTries?: number | undefined;
    alwaysOutputData?: boolean | undefined;
    executeOnce?: boolean | undefined;
    disabled?: boolean | undefined;
    notes?: string | undefined;
    notesInFlow?: boolean | undefined;
}>;
export declare const workflowConnectionSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    main: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
    error: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
    ai_tool: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
    ai_languageModel: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
    ai_memory: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
    ai_embedding: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
    ai_vectorStore: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodObject<{
        node: z.ZodString;
        type: z.ZodString;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: string;
        node: string;
        index: number;
    }, {
        type: string;
        node: string;
        index: number;
    }>, "many">, "many">>;
}, "strip", z.ZodTypeAny, {
    error?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    main?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_tool?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_languageModel?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_memory?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_embedding?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_vectorStore?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
}, {
    error?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    main?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_tool?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_languageModel?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_memory?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_embedding?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
    ai_vectorStore?: {
        type: string;
        node: string;
        index: number;
    }[][] | undefined;
}>>;
export declare const workflowSettingsSchema: z.ZodObject<{
    executionOrder: z.ZodDefault<z.ZodEnum<["v0", "v1"]>>;
    timezone: z.ZodOptional<z.ZodString>;
    saveDataErrorExecution: z.ZodDefault<z.ZodEnum<["all", "none"]>>;
    saveDataSuccessExecution: z.ZodDefault<z.ZodEnum<["all", "none"]>>;
    saveManualExecutions: z.ZodDefault<z.ZodBoolean>;
    saveExecutionProgress: z.ZodDefault<z.ZodBoolean>;
    executionTimeout: z.ZodOptional<z.ZodNumber>;
    errorWorkflow: z.ZodOptional<z.ZodString>;
    callerPolicy: z.ZodOptional<z.ZodEnum<["any", "workflowsFromSameOwner", "workflowsFromAList"]>>;
    availableInMCP: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    executionOrder: "v0" | "v1";
    saveDataErrorExecution: "all" | "none";
    saveDataSuccessExecution: "all" | "none";
    saveManualExecutions: boolean;
    saveExecutionProgress: boolean;
    timezone?: string | undefined;
    executionTimeout?: number | undefined;
    errorWorkflow?: string | undefined;
    callerPolicy?: "any" | "workflowsFromSameOwner" | "workflowsFromAList" | undefined;
    availableInMCP?: boolean | undefined;
}, {
    timezone?: string | undefined;
    executionOrder?: "v0" | "v1" | undefined;
    saveDataErrorExecution?: "all" | "none" | undefined;
    saveDataSuccessExecution?: "all" | "none" | undefined;
    saveManualExecutions?: boolean | undefined;
    saveExecutionProgress?: boolean | undefined;
    executionTimeout?: number | undefined;
    errorWorkflow?: string | undefined;
    callerPolicy?: "any" | "workflowsFromSameOwner" | "workflowsFromAList" | undefined;
    availableInMCP?: boolean | undefined;
}>;
export declare const defaultWorkflowSettings: {
    executionOrder: "v1";
    saveDataErrorExecution: "all";
    saveDataSuccessExecution: "all";
    saveManualExecutions: boolean;
    saveExecutionProgress: boolean;
};
export declare function validateWorkflowNode(node: unknown): WorkflowNode;
export declare function validateWorkflowConnections(connections: unknown): WorkflowConnection;
export declare function validateWorkflowSettings(settings: unknown): z.infer<typeof workflowSettingsSchema>;
export declare function cleanWorkflowForCreate(workflow: Partial<Workflow>): Partial<Workflow>;
export declare function cleanWorkflowForUpdate(workflow: Workflow): Partial<Workflow>;
export declare function validateWorkflowStructure(workflow: Partial<Workflow>): string[];
export declare function hasWebhookTrigger(workflow: Workflow): boolean;
export declare function validateFilterBasedNodeMetadata(node: WorkflowNode): string[];
export declare function validateOperatorStructure(operator: any, path: string): string[];
export declare function getWebhookUrl(workflow: Workflow): string | null;
export declare function getWorkflowStructureExample(): string;
export declare function getWorkflowFixSuggestions(errors: string[]): string[];
//# sourceMappingURL=n8n-validation.d.ts.map