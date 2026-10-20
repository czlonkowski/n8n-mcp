/**
 * TypeScript interfaces for n8n API and MCP handler responses
 * Used in integration tests to provide type safety
 */

// ======================================================================
// System Tool Response Types
// ======================================================================

export interface HealthCheckResponse {
  status: string;
  instanceId?: string;
  n8nVersion?: string;
  features?: Record<string, any>;
  apiUrl: string;
  mcpVersion: string;
  supportedN8nVersion?: string;
  n8nVersionNote?: string;
  [key: string]: any; // Allow dynamic property access for optional field checks
}

export interface ApiStatus {
  configured: boolean;
  connected: boolean;
  error?: string | null;
  version?: string | null;
}

export interface ToolsAvailability {
  documentationTools: {
    count: number;
    enabled: boolean;
    description: string;
  };
  managementTools: {
    count: number;
    enabled: boolean;
    description: string;
  };
  totalAvailable: number;
}

export interface DebugInfo {
  processEnv: string[];
  nodeVersion: string;
  platform: string;
  workingDirectory: string;
}

export interface DiagnosticResponse {
  timestamp: string;
  environment: {
    N8N_API_URL: string | null;
    N8N_API_KEY: string | null;
    NODE_ENV: string;
    MCP_MODE: string;
    isDocker: boolean;
    cloudPlatform: string | null;
    nodeVersion: string;
    platform: string;
  };
  apiConfiguration: {
    configured: boolean;
    status: ApiStatus;
    config?: {
      baseUrl: string;
      timeout: number;
      maxRetries: number;
    } | null;
  };
  toolsAvailability: ToolsAvailability;
  versionInfo?: {
    current: string;
    latest: string | null;
    upToDate: boolean;
    message: string;
    updateCommand?: string;
  };
  performance?: {
    diagnosticResponseTimeMs: number;
    cacheHitRate: string;
    cachedInstances: number;
  };
  modeSpecificDebug: {
    mode: string;
    troubleshooting: string[];
    commonIssues: string[];
    [key: string]: any; // For mode-specific fields like port, configLocation, etc.
  };
  dockerDebug?: {
    containerDetected: boolean;
    troubleshooting: string[];
    commonIssues: string[];
  };
  cloudPlatformDebug?: {
    name: string;
    troubleshooting: string[];
  };
  troubleshooting?: {
    issue?: string;
    error?: string;
    steps: string[];
    commonIssues?: string[];
    documentation: string;
  };
  nextSteps?: any;
  setupGuide?: any;
  updateWarning?: any;
  debug?: DebugInfo;
  [key: string]: any; // Allow dynamic property access for optional field checks
}

// ======================================================================
// Execution Response Types
// ======================================================================

export interface ExecutionData {
  id: string;
  status?: 'success' | 'error' | 'running' | 'waiting';
  mode?: string;
  startedAt?: string;
  stoppedAt?: string;
  workflowId?: string;
  data?: any;
}

export interface ListExecutionsResponse {
  executions: ExecutionData[];
  returned: number;
  nextCursor?: string;
  hasMore: boolean;
  _note?: string;
}

// ======================================================================
// Workflow Response Types
// ======================================================================

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
  credentials?: Record<string, any>;
  disabled?: boolean;
}

export interface WorkflowConnections {
  [key: string]: any;
}

export interface WorkflowData {
  id: string;
  name: string;
  active: boolean;
  nodes: WorkflowNode[];
  connections: WorkflowConnections;
  settings?: Record<string, any>;
  staticData?: Record<string, any>;
  tags?: string[];
  versionId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ValidationError {
  nodeId?: string;
  nodeName?: string;
  field?: string;
  message: string;
  type?: string;
}

export interface ValidationWarning {
  nodeId?: string;
  nodeName?: string;
  message: string;
  type?: string;
}

export interface ValidateWorkflowResponse {
  valid: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  errorCount?: number;
  warningCount?: number;
  summary?: string;
}

export interface AutofixChange {
  nodeId: string;
  nodeName: string;
  field: string;
  oldValue: any;
  newValue: any;
  reason: string;
}

export interface AutofixSuggestion {
  fixType: string;
  nodeId: string;
  nodeName: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
  changes: AutofixChange[];
}

export interface AutofixResponse {
  appliedFixes?: number;
  suggestions?: AutofixSuggestion[];
  workflow?: WorkflowData;
  summary?: string;
  preview?: boolean;
}
