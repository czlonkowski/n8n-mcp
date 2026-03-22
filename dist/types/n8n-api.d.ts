export interface ResourceLocatorValue {
    __rl: true;
    value: string;
    mode: 'id' | 'url' | 'expression' | string;
}
export type ExpressionValue = string | ResourceLocatorValue;
export interface WorkflowNode {
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    position: [number, number];
    parameters: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    disabled?: boolean;
    notes?: string;
    notesInFlow?: boolean;
    continueOnFail?: boolean;
    onError?: 'continueRegularOutput' | 'continueErrorOutput' | 'stopWorkflow';
    retryOnFail?: boolean;
    maxTries?: number;
    waitBetweenTries?: number;
    alwaysOutputData?: boolean;
    executeOnce?: boolean;
    webhookId?: string;
}
export interface WorkflowConnection {
    [sourceNodeId: string]: {
        [outputType: string]: Array<Array<{
            node: string;
            type: string;
            index: number;
        }>>;
    };
}
export interface WorkflowSettings {
    executionOrder?: 'v0' | 'v1';
    timezone?: string;
    saveDataErrorExecution?: 'all' | 'none';
    saveDataSuccessExecution?: 'all' | 'none';
    saveManualExecutions?: boolean;
    saveExecutionProgress?: boolean;
    executionTimeout?: number;
    errorWorkflow?: string;
}
export interface Workflow {
    id?: string;
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    connections: WorkflowConnection;
    active?: boolean;
    isArchived?: boolean;
    settings?: WorkflowSettings;
    staticData?: Record<string, unknown>;
    tags?: string[];
    updatedAt?: string;
    createdAt?: string;
    versionId?: string;
    versionCounter?: number;
    meta?: {
        instanceId?: string;
    };
}
export declare enum ExecutionStatus {
    SUCCESS = "success",
    ERROR = "error",
    WAITING = "waiting"
}
export interface ExecutionSummary {
    id: string;
    finished: boolean;
    mode: string;
    retryOf?: string;
    retrySuccessId?: string;
    status: ExecutionStatus;
    startedAt: string;
    stoppedAt?: string;
    workflowId: string;
    workflowName?: string;
    waitTill?: string;
}
export interface ExecutionData {
    startData?: Record<string, unknown>;
    resultData: {
        runData: Record<string, unknown>;
        lastNodeExecuted?: string;
        error?: Record<string, unknown>;
    };
    executionData?: Record<string, unknown>;
}
export interface Execution extends ExecutionSummary {
    data?: ExecutionData;
}
export interface Credential {
    id?: string;
    name: string;
    type: string;
    data?: Record<string, unknown>;
    nodesAccess?: Array<{
        nodeType: string;
        date?: string;
    }>;
    createdAt?: string;
    updatedAt?: string;
}
export interface Tag {
    id?: string;
    name: string;
    workflowIds?: string[];
    createdAt?: string;
    updatedAt?: string;
}
export interface Variable {
    id?: string;
    key: string;
    value: string;
    type?: 'string';
}
export interface WorkflowExport {
    id: string;
    name: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
    nodes: WorkflowNode[];
    connections: WorkflowConnection;
    settings?: WorkflowSettings;
    staticData?: Record<string, unknown>;
    tags?: string[];
    pinData?: Record<string, unknown>;
    versionId?: string;
    versionCounter?: number;
    meta?: Record<string, unknown>;
}
export interface WorkflowImport {
    name: string;
    nodes: WorkflowNode[];
    connections: WorkflowConnection;
    settings?: WorkflowSettings;
    staticData?: Record<string, unknown>;
    tags?: string[];
    pinData?: Record<string, unknown>;
}
export interface SourceControlStatus {
    ahead: number;
    behind: number;
    conflicted: string[];
    created: string[];
    current: string;
    deleted: string[];
    detached: boolean;
    files: Array<{
        path: string;
        status: string;
    }>;
    modified: string[];
    notAdded: string[];
    renamed: Array<{
        from: string;
        to: string;
    }>;
    staged: string[];
    tracking: string;
}
export interface SourceControlPullResult {
    conflicts: string[];
    files: Array<{
        path: string;
        status: string;
    }>;
    mergeConflicts: boolean;
    pullResult: 'success' | 'conflict' | 'error';
}
export interface SourceControlPushResult {
    ahead: number;
    conflicts: string[];
    files: Array<{
        path: string;
        status: string;
    }>;
    pushResult: 'success' | 'conflict' | 'error';
}
export interface HealthCheckResponse {
    status: 'ok' | 'error';
    instanceId?: string;
    n8nVersion?: string;
    features?: {
        sourceControl?: boolean;
        externalHooks?: boolean;
        workers?: boolean;
        [key: string]: boolean | undefined;
    };
}
export interface N8nVersionInfo {
    version: string;
    major: number;
    minor: number;
    patch: number;
}
export interface N8nSettingsData {
    n8nVersion?: string;
    versionCli?: string;
    instanceId?: string;
    [key: string]: unknown;
}
export interface N8nSettingsResponse {
    data?: N8nSettingsData;
}
export interface WorkflowListParams {
    limit?: number;
    cursor?: string;
    active?: boolean;
    tags?: string | null;
    projectId?: string;
    excludePinnedData?: boolean;
    instance?: string;
}
export interface WorkflowListResponse {
    data: Workflow[];
    nextCursor?: string | null;
}
export interface ExecutionListParams {
    limit?: number;
    cursor?: string;
    workflowId?: string;
    projectId?: string;
    status?: ExecutionStatus;
    includeData?: boolean;
}
export interface ExecutionListResponse {
    data: Execution[];
    nextCursor?: string | null;
}
export interface CredentialListParams {
    limit?: number;
    cursor?: string;
    filter?: Record<string, unknown>;
}
export interface CredentialListResponse {
    data: Credential[];
    nextCursor?: string | null;
}
export interface TagListParams {
    limit?: number;
    cursor?: string;
    withUsageCount?: boolean;
}
export interface TagListResponse {
    data: Tag[];
    nextCursor?: string | null;
}
export interface WebhookRequest {
    webhookUrl: string;
    httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
    waitForResponse?: boolean;
}
export interface McpToolResponse {
    success: boolean;
    saved?: boolean;
    data?: unknown;
    error?: string;
    message?: string;
    code?: string;
    details?: Record<string, unknown>;
    executionId?: string;
    workflowId?: string;
    operationsApplied?: number;
}
export type ExecutionMode = 'preview' | 'summary' | 'filtered' | 'full' | 'error';
export interface ExecutionPreview {
    totalNodes: number;
    executedNodes: number;
    estimatedSizeKB: number;
    nodes: Record<string, NodePreview>;
}
export interface NodePreview {
    status: 'success' | 'error';
    itemCounts: {
        input: number;
        output: number;
    };
    dataStructure: Record<string, any>;
    estimatedSizeKB: number;
    error?: string;
}
export interface ExecutionRecommendation {
    canFetchFull: boolean;
    suggestedMode: ExecutionMode;
    suggestedItemsLimit?: number;
    reason: string;
}
export interface ExecutionFilterOptions {
    mode?: ExecutionMode;
    nodeNames?: string[];
    itemsLimit?: number;
    includeInputData?: boolean;
    fieldsToInclude?: string[];
    errorItemsLimit?: number;
    includeStackTrace?: boolean;
    includeExecutionPath?: boolean;
}
export interface FilteredExecutionResponse {
    id: string;
    workflowId: string;
    status: ExecutionStatus;
    mode: ExecutionMode;
    startedAt: string;
    stoppedAt?: string;
    duration?: number;
    finished: boolean;
    preview?: ExecutionPreview;
    recommendation?: ExecutionRecommendation;
    summary?: {
        totalNodes: number;
        executedNodes: number;
        totalItems: number;
        hasMoreData: boolean;
    };
    nodes?: Record<string, FilteredNodeData>;
    error?: Record<string, unknown>;
    errorInfo?: ErrorAnalysis;
}
export interface FilteredNodeData {
    executionTime?: number;
    itemsInput: number;
    itemsOutput: number;
    status: 'success' | 'error';
    error?: string;
    data?: {
        input?: any[][];
        output?: any[][];
        metadata: {
            totalItems: number;
            itemsShown: number;
            truncated: boolean;
        };
    };
}
export interface ErrorAnalysis {
    primaryError: {
        message: string;
        errorType: string;
        nodeName: string;
        nodeType: string;
        nodeId?: string;
        nodeParameters?: Record<string, unknown>;
        stackTrace?: string;
    };
    upstreamContext?: {
        nodeName: string;
        nodeType: string;
        itemCount: number;
        sampleItems: unknown[];
        dataStructure: Record<string, unknown>;
    };
    executionPath?: Array<{
        nodeName: string;
        status: 'success' | 'error' | 'skipped';
        itemCount: number;
        executionTime?: number;
    }>;
    additionalErrors?: Array<{
        nodeName: string;
        message: string;
    }>;
    suggestions?: ErrorSuggestion[];
}
export interface ErrorSuggestion {
    type: 'fix' | 'investigate' | 'workaround';
    title: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
}
export interface DataTableColumn {
    name: string;
    type?: 'string' | 'number' | 'boolean' | 'date';
}
export interface DataTableColumnResponse {
    id: string;
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date';
    index: number;
}
export interface DataTable {
    id: string;
    name: string;
    columns?: DataTableColumnResponse[];
    projectId?: string;
    createdAt?: string;
    updatedAt?: string;
}
export interface DataTableRow {
    id?: number;
    createdAt?: string;
    updatedAt?: string;
    [columnName: string]: unknown;
}
export interface DataTableFilterCondition {
    columnName: string;
    condition: 'eq' | 'neq' | 'like' | 'ilike' | 'gt' | 'gte' | 'lt' | 'lte';
    value?: any;
}
export interface DataTableFilter {
    type?: 'and' | 'or';
    filters: DataTableFilterCondition[];
}
export interface DataTableListParams {
    limit?: number;
    cursor?: string;
}
export interface DataTableRowListParams {
    limit?: number;
    cursor?: string;
    filter?: string;
    sortBy?: string;
    search?: string;
}
export interface DataTableInsertRowsParams {
    data: Record<string, unknown>[];
    returnType?: 'count' | 'id' | 'all';
}
export interface DataTableUpdateRowsParams {
    filter: DataTableFilter;
    data: Record<string, unknown>;
    returnData?: boolean;
    dryRun?: boolean;
}
export interface DataTableUpsertRowParams {
    filter: DataTableFilter;
    data: Record<string, unknown>;
    returnData?: boolean;
    dryRun?: boolean;
}
export interface DataTableDeleteRowsParams {
    filter: string;
    returnData?: boolean;
    dryRun?: boolean;
}
//# sourceMappingURL=n8n-api.d.ts.map