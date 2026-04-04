import { ToolDocumentation } from '../types';

export const n8nAuditInstanceDoc: ToolDocumentation = {
  name: 'n8n_audit_instance',
  category: 'system',
  essentials: {
    description: 'Security audit combining n8n built-in audit with deep workflow scanning',
    keyParameters: ['categories', 'includeCustomScan', 'customChecks'],
    example: 'n8n_audit_instance({}) for full audit, n8n_audit_instance({customChecks: ["hardcoded_secrets", "unauthenticated_webhooks"]}) for specific checks',
    performance: 'Moderate - fetches all workflows (2-30s depending on instance size)',
    tips: [
      'Returns actionable markdown with remediation steps',
      'Use n8n_manage_credentials to fix credential findings',
      'Custom scan covers 50+ secret patterns including API keys, tokens, and passwords',
      'Built-in audit checks credentials, database, nodes, instance, and filesystem risks',
    ]
  },
  full: {
    description: `Performs a comprehensive security audit of the configured n8n instance by combining two scanning approaches:

**Built-in Audit (via n8n API):**
- credentials: Unused credentials, shared credentials with elevated access
- database: Database-level security settings and exposure
- nodes: Community nodes with known vulnerabilities, outdated nodes
- instance: Instance configuration risks (e.g., public registration, weak auth)
- filesystem: File system access and permission risks

**Custom Deep Scan (workflow analysis):**
- hardcoded_secrets: Scans all workflow node parameters for hardcoded API keys, tokens, passwords, and connection strings using 50+ regex patterns
- unauthenticated_webhooks: Detects webhook nodes without authentication configured
- error_handling: Identifies workflows without error handling or notification on failure
- data_retention: Flags workflows with excessive data retention or no cleanup

The report is returned as actionable markdown with severity ratings, affected resources, and specific remediation steps referencing other MCP tools.`,
    parameters: {
      categories: {
        type: 'array of string',
        required: false,
        description: 'Built-in audit categories to check',
        default: ['credentials', 'database', 'nodes', 'instance', 'filesystem'],
        enum: ['credentials', 'database', 'nodes', 'instance', 'filesystem'],
      },
      includeCustomScan: {
        type: 'boolean',
        required: false,
        description: 'Run deep workflow scanning for secrets, webhooks, error handling',
        default: true,
      },
      daysAbandonedWorkflow: {
        type: 'number',
        required: false,
        description: 'Days threshold for abandoned workflow detection',
        default: 90,
      },
      customChecks: {
        type: 'array of string',
        required: false,
        description: 'Specific custom checks to run (defaults to all 4 if includeCustomScan is true)',
        default: ['hardcoded_secrets', 'unauthenticated_webhooks', 'error_handling', 'data_retention'],
        enum: ['hardcoded_secrets', 'unauthenticated_webhooks', 'error_handling', 'data_retention'],
      },
    },
    returns: `Markdown-formatted security audit report containing:
- Summary table with finding counts by severity (critical, high, medium, low)
- Findings grouped by workflow with per-workflow tables (ID, severity, finding, node, fix type)
- Built-in audit section with n8n's own risk assessments (nodes, instance, credentials, database, filesystem)
- Remediation Playbook aggregated by finding type: auto-fixable (secrets, webhooks), requires review (error handling, PII), requires user action (data retention, instance updates)
- Tool chains for auto-fixing reference n8n_get_workflow, n8n_manage_credentials, n8n_update_partial_workflow`,
    examples: [
      '// Full audit with all checks\nn8n_audit_instance({})',
      '// Built-in audit only (no workflow scanning)\nn8n_audit_instance({includeCustomScan: false})',
      '// Only check for hardcoded secrets and unauthenticated webhooks\nn8n_audit_instance({customChecks: ["hardcoded_secrets", "unauthenticated_webhooks"]})',
      '// Only run built-in credential and instance checks\nn8n_audit_instance({categories: ["credentials", "instance"], includeCustomScan: false})',
      '// Adjust abandoned workflow threshold\nn8n_audit_instance({daysAbandonedWorkflow: 30})',
    ],
    useCases: [
      'Regular security audits of n8n instances',
      'Detecting hardcoded secrets before they become a breach',
      'Identifying unauthenticated webhook endpoints exposed to the internet',
      'Compliance checks for data retention and error handling policies',
      'Pre-deployment security review of new workflows',
      'Remediation workflow: audit, review findings, fix with n8n_manage_credentials or n8n_update_partial_workflow',
    ],
    performance: `Execution time depends on instance size:
- Small instances (<20 workflows): 2-5s
- Medium instances (20-100 workflows): 5-15s
- Large instances (100+ workflows): 15-30s
The built-in audit is a single API call. The custom scan fetches all workflows and analyzes each one.`,
    bestPractices: [
      'Run a full audit periodically (e.g., weekly) to catch new issues',
      'Use customChecks to focus on specific concerns when time is limited',
      'Address critical and high severity findings first',
      'After fixing findings, re-run the audit to verify remediation',
      'Combine with n8n_health_check for a complete instance health picture',
      'Use n8n_manage_credentials to rotate or replace exposed credentials',
    ],
    pitfalls: [
      'Large instances with many workflows may take 30+ seconds to scan',
      'Built-in audit API may not be available on older n8n versions (pre-1.x)',
      'Custom scan analyzes stored workflow definitions only, not runtime values from expressions',
      'Requires N8N_API_URL and N8N_API_KEY to be configured',
      'Findings from the built-in audit depend on n8n version and may vary',
    ],
    relatedTools: ['n8n_manage_credentials', 'n8n_update_partial_workflow', 'n8n_health_check'],
  }
};
