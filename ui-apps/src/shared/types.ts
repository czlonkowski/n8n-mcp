// Matches the McpToolResponse format from handlers-n8n-manager.ts
export interface OperationResultData {
  success: boolean;
  data?: {
    id?: string;
    name?: string;
    active?: boolean;
    nodeCount?: number;
    workflowId?: string;
    workflowName?: string;
    deleted?: boolean;
    operationsApplied?: number;
    executionId?: string;
    templateId?: string | number;
    fixes?: unknown[];
    fixesApplied?: number;
    preview?: unknown;
    triggerType?: string;
    requiredCredentials?: string[];
    autoFixStatus?: string;
    url?: string;
    [key: string]: unknown;
  };
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export type OperationType = 'create' | 'update' | 'partial_update' | 'delete' | 'test' | 'autofix' | 'deploy';

export interface ValidationError {
  type?: string;
  property?: string;
  message: string;
  fix?: string;
  node?: string;
  details?: unknown;
}

export interface ValidationWarning {
  type?: string;
  property?: string;
  message: string;
  node?: string;
  details?: unknown;
}

// Workflow list response from n8n_list_workflows
export interface WorkflowListData {
  success: boolean;
  data?: {
    workflows: {
      id: string;
      name: string;
      active?: boolean;
      isArchived?: boolean;
      createdAt?: string;
      updatedAt?: string;
      tags?: string[];
      nodeCount?: number;
    }[];
    returned?: number;
    hasMore?: boolean;
    nextCursor?: string;
  };
  message?: string;
  error?: string;
}

// Execution history response from n8n_executions
export interface ExecutionHistoryData {
  success: boolean;
  data?: {
    executions: {
      id: string;
      finished?: boolean;
      mode?: string;
      status?: string;
      startedAt?: string;
      stoppedAt?: string;
      workflowId?: string;
      workflowName?: string;
    }[];
    returned?: number;
    hasMore?: boolean;
  };
  message?: string;
  error?: string;
}

// Health check response from n8n_health_check
export interface HealthDashboardData {
  success: boolean;
  data?: {
    status?: string;
    instanceId?: string;
    n8nVersion?: string;
    mcpVersion?: string;
    apiUrl?: string;
    versionCheck?: {
      current?: string;
      latest?: string;
      upToDate?: boolean | null;
      updateCommand?: string;
    };
    performance?: {
      responseTimeMs?: number;
      cacheHitRate?: number;
    };
    nextSteps?: string[];
  };
  message?: string;
  error?: string;
}

// Matches the validate_node / validate_workflow response format from server.ts
export interface ValidationSummaryData {
  valid: boolean;
  nodeType?: string;
  displayName?: string;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions?: string[];
  summary?: {
    errorCount?: number;
    warningCount?: number;
    hasErrors?: boolean;
    suggestionCount?: number;
    [key: string]: unknown;
  };
  // n8n_validate_workflow wraps result in success/data
  success?: boolean;
  data?: {
    valid?: boolean;
    workflowId?: string;
    workflowName?: string;
    errors?: ValidationError[];
    warnings?: ValidationWarning[];
    suggestions?: string[];
    summary?: {
      errorCount?: number;
      warningCount?: number;
      [key: string]: unknown;
    };
  };
}
