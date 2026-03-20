import { Workflow, WorkflowListParams, WorkflowListResponse, Execution, ExecutionListParams, ExecutionListResponse, Credential, CredentialListParams, CredentialListResponse, Tag, TagListParams, TagListResponse, HealthCheckResponse, N8nVersionInfo, Variable, WebhookRequest, SourceControlStatus, SourceControlPullResult, SourceControlPushResult } from '../types/n8n-api';
export interface N8nApiClientConfig {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
    maxRetries?: number;
}
export declare class N8nApiClient {
    private client;
    private maxRetries;
    private baseUrl;
    private versionInfo;
    private versionPromise;
    constructor(config: N8nApiClientConfig);
    getVersion(): Promise<N8nVersionInfo | null>;
    private fetchVersionOnce;
    getCachedVersionInfo(): N8nVersionInfo | null;
    healthCheck(): Promise<HealthCheckResponse>;
    createWorkflow(workflow: Partial<Workflow>): Promise<Workflow>;
    getWorkflow(id: string): Promise<Workflow>;
    updateWorkflow(id: string, workflow: Partial<Workflow>): Promise<Workflow>;
    deleteWorkflow(id: string): Promise<Workflow>;
    transferWorkflow(id: string, destinationProjectId: string): Promise<void>;
    activateWorkflow(id: string): Promise<Workflow>;
    deactivateWorkflow(id: string): Promise<Workflow>;
    listWorkflows(params?: WorkflowListParams): Promise<WorkflowListResponse>;
    getExecution(id: string, includeData?: boolean): Promise<Execution>;
    listExecutions(params?: ExecutionListParams): Promise<ExecutionListResponse>;
    deleteExecution(id: string): Promise<void>;
    triggerWebhook(request: WebhookRequest): Promise<any>;
    listCredentials(params?: CredentialListParams): Promise<CredentialListResponse>;
    getCredential(id: string): Promise<Credential>;
    createCredential(credential: Partial<Credential>): Promise<Credential>;
    updateCredential(id: string, credential: Partial<Credential>): Promise<Credential>;
    deleteCredential(id: string): Promise<void>;
    listTags(params?: TagListParams): Promise<TagListResponse>;
    createTag(tag: Partial<Tag>): Promise<Tag>;
    updateTag(id: string, tag: Partial<Tag>): Promise<Tag>;
    deleteTag(id: string): Promise<void>;
    updateWorkflowTags(workflowId: string, tagIds: string[]): Promise<Tag[]>;
    getSourceControlStatus(): Promise<SourceControlStatus>;
    pullSourceControl(force?: boolean): Promise<SourceControlPullResult>;
    pushSourceControl(message: string, fileNames?: string[]): Promise<SourceControlPushResult>;
    getVariables(): Promise<Variable[]>;
    createVariable(variable: Partial<Variable>): Promise<Variable>;
    updateVariable(id: string, variable: Partial<Variable>): Promise<Variable>;
    deleteVariable(id: string): Promise<void>;
    private validateListResponse;
}
//# sourceMappingURL=n8n-api-client.d.ts.map