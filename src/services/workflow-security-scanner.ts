/**
 * Workflow security scanner that orchestrates 4 security checks on n8n workflows:
 * 1. Hardcoded secrets (via credential-scanner)
 * 2. Unauthenticated webhooks
 * 3. Error handling gaps
 * 4. Data retention settings
 */

import { scanWorkflow, type ScanDetection } from './credential-scanner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RemediationType = 'auto_fixable' | 'user_input_needed' | 'user_action_needed' | 'review_recommended';
export type CustomCheckType = 'hardcoded_secrets' | 'unauthenticated_webhooks' | 'error_handling' | 'data_retention';

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  category: CustomCheckType;
  title: string;
  description: string;
  recommendation: string;
  remediationType: RemediationType;
  remediation?: {
    tool: string;
    args: Record<string, unknown>;
    description: string;
  }[];
  location: {
    workflowId: string;
    workflowName: string;
    workflowActive?: boolean;
    nodeName?: string;
    nodeType?: string;
  };
}

export interface WorkflowSecurityReport {
  findings: AuditFinding[];
  workflowsScanned: number;
  scanDurationMs: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// Workflow input type (loose, to accept various workflow shapes)
// ---------------------------------------------------------------------------

interface WorkflowInput {
  id?: string;
  name: string;
  nodes: Array<{
    id?: string;
    name: string;
    type: string;
    parameters?: Record<string, unknown>;
    notes?: string;
    continueOnFail?: boolean;
    onError?: string;
    [key: string]: unknown;
  }>;
  active?: boolean;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown>;
  connections?: unknown;
}

// ---------------------------------------------------------------------------
// Check 1: Hardcoded secrets
// ---------------------------------------------------------------------------

function checkHardcodedSecrets(workflow: WorkflowInput): AuditFinding[] {
  const detections: ScanDetection[] = scanWorkflow({
    id: workflow.id,
    name: workflow.name,
    nodes: workflow.nodes,
    settings: workflow.settings,
    staticData: workflow.staticData,
  });

  return detections.map((detection, index): AuditFinding => {
    const workflowId = workflow.id ?? '';
    const nodeName = detection.location.nodeName ?? '';
    const isPii = detection.category.toLowerCase() === 'pii';

    return {
      id: `CRED-${String(index + 1).padStart(3, '0')}`,
      severity: detection.severity as AuditSeverity,
      category: 'hardcoded_secrets',
      title: `Hardcoded ${detection.label} detected`,
      description: `Found a hardcoded ${detection.label} (${detection.category}) in ${nodeName ? `node "${nodeName}"` : 'workflow-level settings'}. Masked value: ${detection.maskedSnippet ?? 'N/A'}.`,
      recommendation: isPii
        ? 'Review whether this PII is necessary in the workflow. If it is test data or a placeholder, consider using n8n expressions or environment variables instead of hardcoded values.'
        : 'Move this secret into n8n credentials. The agent can extract the hardcoded value from the workflow, create a credential, and update the node automatically.',
      remediationType: isPii ? 'review_recommended' : 'auto_fixable',
      remediation: isPii
        ? []
        : [
            {
              tool: 'n8n_get_workflow',
              args: { id: workflowId },
              description: `Fetch workflow to extract the hardcoded ${detection.label} from node "${nodeName}"`,
            },
            {
              tool: 'n8n_manage_credentials',
              args: { action: 'create', type: 'httpHeaderAuth' },
              description: `Create credential with the extracted value (choose appropriate type for ${detection.label})`,
            },
            {
              tool: 'n8n_update_partial_workflow',
              args: { id: workflowId, operations: [{ type: 'updateNode', nodeName }] },
              description: `Update node to use credential and remove hardcoded value`,
            },
          ],
      location: {
        workflowId,
        workflowName: workflow.name,
        workflowActive: workflow.active,
        nodeName: detection.location.nodeName,
        nodeType: detection.location.nodeType,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Check 2: Unauthenticated webhooks
// ---------------------------------------------------------------------------

function checkUnauthenticatedWebhooks(workflow: WorkflowInput): AuditFinding[] {
  const findings: AuditFinding[] = [];
  let sequence = 0;

  for (const node of workflow.nodes) {
    const nodeTypeLower = (node.type ?? '').toLowerCase();
    // respondToWebhook is a response helper, not a trigger — skip it
    if (nodeTypeLower.includes('respondtowebhook')) {
      continue;
    }
    if (!nodeTypeLower.includes('webhook') && !nodeTypeLower.includes('formtrigger')) {
      continue;
    }

    const auth = node.parameters?.authentication;

    // Skip nodes that already have authentication configured
    if (typeof auth === 'string' && auth !== '' && auth !== 'none') {
      continue;
    }

    sequence++;
    const workflowId = workflow.id ?? '';
    const isActive = workflow.active === true;

    findings.push({
      id: `WEBHOOK-${String(sequence).padStart(3, '0')}`,
      severity: isActive ? 'high' : 'medium',
      category: 'unauthenticated_webhooks',
      title: `Unauthenticated webhook: "${node.name}"`,
      description: `Webhook node "${node.name}" (${node.type}) has no authentication configured.${isActive ? ' This workflow is active and publicly accessible.' : ''} Anyone with the webhook URL can trigger this workflow.`,
      recommendation: 'Add authentication to the webhook node. Header-based authentication with a random secret is the simplest approach.',
      remediationType: 'auto_fixable',
      remediation: [
        {
          tool: 'n8n_manage_credentials',
          args: { action: 'create', type: 'httpHeaderAuth' },
          description: `Create httpHeaderAuth credential with a generated random secret`,
        },
        {
          tool: 'n8n_update_partial_workflow',
          args: { id: workflowId, operations: [{ type: 'updateNode', nodeName: node.name }] },
          description: `Set authentication to "headerAuth" and assign the credential`,
        },
      ],
      location: {
        workflowId,
        workflowName: workflow.name,
        workflowActive: isActive,
        nodeName: node.name,
        nodeType: node.type,
      },
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Check 3: Error handling gaps
// ---------------------------------------------------------------------------

function checkErrorHandlingGaps(workflow: WorkflowInput): AuditFinding[] {
  // Only flag workflows with 3+ nodes
  if (workflow.nodes.length < 3) {
    return [];
  }

  const hasContinueOnFail = workflow.nodes.some(
    (node) => node.continueOnFail === true,
  );

  const hasOnErrorHandling = workflow.nodes.some(
    (node) => typeof node.onError === 'string' && node.onError !== 'stopWorkflow',
  );

  const hasErrorTrigger = workflow.nodes.some(
    (node) => (node.type ?? '').toLowerCase() === 'n8n-nodes-base.errortrigger',
  );

  if (hasContinueOnFail || hasOnErrorHandling || hasErrorTrigger) {
    return [];
  }

  return [
    {
      id: 'ERR-001',
      severity: 'medium',
      category: 'error_handling',
      title: `No error handling in workflow "${workflow.name}"`,
      description: `Workflow "${workflow.name}" has ${workflow.nodes.length} nodes but no error handling configured. There are no nodes with continueOnFail enabled, no custom onError behavior, and no Error Trigger node.`,
      recommendation: 'Add error handling to prevent silent failures. Consider adding an Error Trigger node for global error notifications, or set continueOnFail on critical nodes that should not block the workflow.',
      remediationType: 'review_recommended',
      location: {
        workflowId: workflow.id ?? '',
        workflowName: workflow.name,
        workflowActive: workflow.active,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Check 4: Data retention settings
// ---------------------------------------------------------------------------

function checkDataRetentionSettings(workflow: WorkflowInput): AuditFinding[] {
  const settings = workflow.settings;
  if (!settings) {
    return [];
  }

  const savesAllErrors = settings.saveDataErrorExecution === 'all';
  const savesAllSuccess = settings.saveDataSuccessExecution === 'all';

  if (!savesAllErrors || !savesAllSuccess) {
    return [];
  }

  return [
    {
      id: 'RETENTION-001',
      severity: 'low',
      category: 'data_retention',
      title: `Excessive data retention in workflow "${workflow.name}"`,
      description: `Workflow "${workflow.name}" is configured to save execution data for both successful and failed executions. This may store sensitive data in the n8n database longer than necessary.`,
      recommendation: 'Review data retention settings. Consider setting saveDataSuccessExecution to "none" for workflows that process sensitive data, or configure execution data pruning at the instance level.',
      remediationType: 'user_action_needed',
      location: {
        workflowId: workflow.id ?? '',
        workflowName: workflow.name,
        workflowActive: workflow.active,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Check dispatcher
// ---------------------------------------------------------------------------

const CHECK_MAP: Record<CustomCheckType, (workflow: WorkflowInput) => AuditFinding[]> = {
  hardcoded_secrets: checkHardcodedSecrets,
  unauthenticated_webhooks: checkUnauthenticatedWebhooks,
  error_handling: checkErrorHandlingGaps,
  data_retention: checkDataRetentionSettings,
};

const ALL_CHECKS = Object.keys(CHECK_MAP) as CustomCheckType[];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Scans one or more n8n workflows for security issues.
 *
 * Runs up to 4 checks: hardcoded secrets, unauthenticated webhooks,
 * error handling gaps, and data retention settings.
 *
 * @param workflows - Array of workflow objects to scan
 * @param checks - Optional subset of checks to run (defaults to all 4)
 * @returns A security report with all findings and summary counts
 */
export function scanWorkflows(
  workflows: Array<{
    id?: string;
    name: string;
    nodes: any[];
    active?: boolean;
    settings?: any;
    staticData?: any;
    connections?: any;
  }>,
  checks?: CustomCheckType[],
): WorkflowSecurityReport {
  const startTime = Date.now();
  const checksToRun = checks ?? ALL_CHECKS;
  const allFindings: AuditFinding[] = [];

  for (const workflow of workflows) {
    for (const checkType of checksToRun) {
      const findings = CHECK_MAP[checkType](workflow);
      allFindings.push(...findings);
    }
  }

  const scanDurationMs = Date.now() - startTime;

  const summary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: allFindings.length,
  };

  for (const finding of allFindings) {
    summary[finding.severity]++;
  }

  return {
    findings: allFindings,
    workflowsScanned: workflows.length,
    scanDurationMs,
    summary,
  };
}
