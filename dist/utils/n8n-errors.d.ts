export declare class N8nApiError extends Error {
    statusCode?: number | undefined;
    code?: string | undefined;
    details?: unknown | undefined;
    constructor(message: string, statusCode?: number | undefined, code?: string | undefined, details?: unknown | undefined);
}
export declare class N8nAuthenticationError extends N8nApiError {
    constructor(message?: string);
}
export declare class N8nNotFoundError extends N8nApiError {
    constructor(messageOrResource: string, id?: string);
}
export declare class N8nValidationError extends N8nApiError {
    constructor(message: string, details?: unknown);
}
export declare class N8nRateLimitError extends N8nApiError {
    constructor(retryAfter?: number);
}
export declare class N8nServerError extends N8nApiError {
    constructor(message?: string, statusCode?: number);
}
export declare function handleN8nApiError(error: unknown): N8nApiError;
export declare function formatExecutionError(executionId: string, workflowId?: string): string;
export declare function formatNoExecutionError(): string;
export declare function getUserFriendlyErrorMessage(error: N8nApiError): string;
export declare function logN8nError(error: N8nApiError, context?: string): void;
//# sourceMappingURL=n8n-errors.d.ts.map