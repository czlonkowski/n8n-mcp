import { describe, it, expect } from 'vitest';
import {
  scanWorkflows,
  type WorkflowSecurityReport,
  type AuditFinding,
  type CustomCheckType,
} from '@/services/workflow-security-scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    active: false,
    nodes: [] as any[],
    settings: {},
    ...overrides,
  };
}

/** Shortcut to scan a single workflow and return its report. */
function scanOne(
  workflow: Record<string, unknown>,
  checks?: CustomCheckType[],
): WorkflowSecurityReport {
  return scanWorkflows([workflow as any], checks);
}

/** Return findings for a given category. */
function findingsOf(report: WorkflowSecurityReport, category: CustomCheckType): AuditFinding[] {
  return report.findings.filter((f) => f.category === category);
}

// ===========================================================================
// Check 1: Hardcoded secrets
// ===========================================================================

describe('workflow-security-scanner', () => {
  describe('hardcoded secrets check', () => {
    it('should detect a hardcoded secret in node parameters', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            parameters: {
              url: 'https://api.example.com',
              headers: {
                values: [{ name: 'Authorization', value: 'sk-proj-RealKey1234567890abcdef' }],
              },
            },
          },
        ],
      });
      const report = scanOne(wf, ['hardcoded_secrets']);
      const secrets = findingsOf(report, 'hardcoded_secrets');
      expect(secrets.length).toBeGreaterThanOrEqual(1);
      expect(secrets[0].title).toContain('openai_key');
      expect(secrets[0].id).toMatch(/^CRED-\d{3}$/);
    });

    it('should mark PII detections as review_recommended, not auto_fixable', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Send Email',
            type: 'n8n-nodes-base.httpRequest',
            parameters: { body: { json: { to: 'john.doe@example.com' } } },
          },
        ],
      });
      const report = scanOne(wf, ['hardcoded_secrets']);
      const piiFindings = findingsOf(report, 'hardcoded_secrets').filter(
        (f) => f.title.toLowerCase().includes('email'),
      );
      expect(piiFindings.length).toBeGreaterThanOrEqual(1);
      expect(piiFindings[0].remediationType).toBe('review_recommended');
      expect(piiFindings[0].remediation).toHaveLength(0);
    });

    it('should return no findings for a clean workflow', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Set',
            type: 'n8n-nodes-base.set',
            parameters: { values: { string: [{ name: 'greeting', value: 'hello world is safe' }] } },
          },
        ],
      });
      const report = scanOne(wf, ['hardcoded_secrets']);
      expect(findingsOf(report, 'hardcoded_secrets')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Check 2: Unauthenticated webhooks
  // ===========================================================================

  describe('unauthenticated webhooks check', () => {
    it('should flag a webhook with authentication set to "none"', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'none' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      const webhooks = findingsOf(report, 'unauthenticated_webhooks');
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].title).toContain('Webhook');
    });

    it('should flag a webhook with no authentication parameter at all', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      expect(findingsOf(report, 'unauthenticated_webhooks')).toHaveLength(1);
    });

    it('should NOT flag a webhook with headerAuth configured', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'headerAuth' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      expect(findingsOf(report, 'unauthenticated_webhooks')).toHaveLength(0);
    });

    it('should NOT flag a webhook with basicAuth configured', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'basicAuth' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      expect(findingsOf(report, 'unauthenticated_webhooks')).toHaveLength(0);
    });

    it('should assign severity high when the workflow is active', () => {
      const wf = makeWorkflow({
        active: true,
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'none' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      const findings = findingsOf(report, 'unauthenticated_webhooks');
      expect(findings[0].severity).toBe('high');
      expect(findings[0].description).toContain('active');
    });

    it('should assign severity medium when the workflow is inactive', () => {
      const wf = makeWorkflow({
        active: false,
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'none' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      expect(findingsOf(report, 'unauthenticated_webhooks')[0].severity).toBe('medium');
    });

    it('should NOT flag respondToWebhook nodes (they are response helpers, not triggers)', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Respond to Webhook',
            type: 'n8n-nodes-base.respondToWebhook',
            parameters: { respondWith: 'text', responseBody: 'OK' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      expect(findingsOf(report, 'unauthenticated_webhooks')).toHaveLength(0);
    });

    it('should also detect formTrigger nodes', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Form Trigger',
            type: 'n8n-nodes-base.formTrigger',
            parameters: { path: '/form' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      expect(findingsOf(report, 'unauthenticated_webhooks')).toHaveLength(1);
    });

    it('should include remediation steps with auto_fixable type', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook' },
          },
        ],
      });
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      const finding = findingsOf(report, 'unauthenticated_webhooks')[0];
      expect(finding.remediationType).toBe('auto_fixable');
      expect(finding.remediation).toBeDefined();
      expect(finding.remediation!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // Check 3: Error handling gaps
  // ===========================================================================

  describe('error handling gaps check', () => {
    it('should flag a workflow with 3+ nodes and no error handling', () => {
      const wf = makeWorkflow({
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {} },
          { name: 'Step 2', type: 'n8n-nodes-base.httpRequest', parameters: {} },
        ],
      });
      const report = scanOne(wf, ['error_handling']);
      const findings = findingsOf(report, 'error_handling');
      expect(findings).toHaveLength(1);
      expect(findings[0].id).toBe('ERR-001');
      expect(findings[0].severity).toBe('medium');
    });

    it('should NOT flag a workflow with continueOnFail enabled', () => {
      const wf = makeWorkflow({
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {}, continueOnFail: true },
          { name: 'Step 2', type: 'n8n-nodes-base.httpRequest', parameters: {} },
        ],
      });
      const report = scanOne(wf, ['error_handling']);
      expect(findingsOf(report, 'error_handling')).toHaveLength(0);
    });

    it('should NOT flag a workflow with onError set to continueErrorOutput', () => {
      const wf = makeWorkflow({
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {}, onError: 'continueErrorOutput' },
          { name: 'Step 2', type: 'n8n-nodes-base.httpRequest', parameters: {} },
        ],
      });
      const report = scanOne(wf, ['error_handling']);
      expect(findingsOf(report, 'error_handling')).toHaveLength(0);
    });

    it('should NOT flag a workflow with an errorTrigger node', () => {
      const wf = makeWorkflow({
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {} },
          { name: 'Error Handler', type: 'n8n-nodes-base.errorTrigger', parameters: {} },
        ],
      });
      const report = scanOne(wf, ['error_handling']);
      expect(findingsOf(report, 'error_handling')).toHaveLength(0);
    });

    it('should NOT flag a workflow with fewer than 3 nodes', () => {
      const wf = makeWorkflow({
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {} },
        ],
      });
      const report = scanOne(wf, ['error_handling']);
      expect(findingsOf(report, 'error_handling')).toHaveLength(0);
    });

    it('should NOT flag onError=stopWorkflow as valid error handling', () => {
      // stopWorkflow is the default and does NOT count as custom error handling
      const wf = makeWorkflow({
        nodes: [
          { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {}, onError: 'stopWorkflow' },
          { name: 'Step 2', type: 'n8n-nodes-base.httpRequest', parameters: {} },
        ],
      });
      const report = scanOne(wf, ['error_handling']);
      expect(findingsOf(report, 'error_handling')).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Check 4: Data retention settings
  // ===========================================================================

  describe('data retention settings check', () => {
    it('should flag when both save settings are set to all', () => {
      const wf = makeWorkflow({
        nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
        settings: {
          saveDataErrorExecution: 'all',
          saveDataSuccessExecution: 'all',
        },
      });
      const report = scanOne(wf, ['data_retention']);
      const findings = findingsOf(report, 'data_retention');
      expect(findings).toHaveLength(1);
      expect(findings[0].id).toBe('RETENTION-001');
      expect(findings[0].severity).toBe('low');
    });

    it('should NOT flag when only error execution is set to all', () => {
      const wf = makeWorkflow({
        nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
        settings: {
          saveDataErrorExecution: 'all',
          saveDataSuccessExecution: 'none',
        },
      });
      const report = scanOne(wf, ['data_retention']);
      expect(findingsOf(report, 'data_retention')).toHaveLength(0);
    });

    it('should NOT flag when only success execution is set to all', () => {
      const wf = makeWorkflow({
        nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
        settings: {
          saveDataErrorExecution: 'none',
          saveDataSuccessExecution: 'all',
        },
      });
      const report = scanOne(wf, ['data_retention']);
      expect(findingsOf(report, 'data_retention')).toHaveLength(0);
    });

    it('should NOT flag when no settings are present', () => {
      const wf = makeWorkflow({
        nodes: [{ name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} }],
      });
      const report = scanOne(wf, ['data_retention']);
      expect(findingsOf(report, 'data_retention')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Selective checks (customChecks filter)
  // ===========================================================================

  describe('selective checks', () => {
    it('should only run the requested checks', () => {
      const wf = makeWorkflow({
        active: true,
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'none' },
          },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {} },
          {
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            parameters: {
              headers: { values: [{ name: 'Auth', value: 'sk-proj-RealKey1234567890abcdef' }] },
            },
          },
        ],
        settings: { saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
      });

      // Only run webhook check
      const report = scanOne(wf, ['unauthenticated_webhooks']);
      const categories = new Set(report.findings.map((f) => f.category));
      expect(categories.has('unauthenticated_webhooks')).toBe(true);
      expect(categories.has('hardcoded_secrets')).toBe(false);
      expect(categories.has('error_handling')).toBe(false);
      expect(categories.has('data_retention')).toBe(false);
    });

    it('should run all checks when no filter is provided', () => {
      const wf = makeWorkflow({
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook' },
          },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {} },
          {
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            parameters: {
              headers: { values: [{ name: 'Auth', value: 'sk-proj-RealKey1234567890abcdef' }] },
            },
          },
        ],
        settings: { saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
      });

      const report = scanWorkflows([wf as any]);
      const categories = new Set(report.findings.map((f) => f.category));
      // Should have findings from at least webhook and secrets checks
      expect(categories.has('unauthenticated_webhooks')).toBe(true);
      expect(categories.has('hardcoded_secrets')).toBe(true);
    });
  });

  // ===========================================================================
  // Summary counts
  // ===========================================================================

  describe('summary counts', () => {
    it('should correctly aggregate severity counts', () => {
      const wf = makeWorkflow({
        active: true,
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { path: '/hook', authentication: 'none' },
          },
          { name: 'Step 1', type: 'n8n-nodes-base.set', parameters: {} },
          {
            name: 'HTTP Request',
            type: 'n8n-nodes-base.httpRequest',
            parameters: {
              headers: { values: [{ name: 'Auth', value: 'sk-proj-RealKey1234567890abcdef' }] },
            },
          },
        ],
        settings: { saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
      });

      const report = scanOne(wf);

      expect(report.summary.total).toBe(report.findings.length);
      expect(
        report.summary.critical +
        report.summary.high +
        report.summary.medium +
        report.summary.low,
      ).toBe(report.summary.total);
    });

    it('should report correct workflowsScanned count', () => {
      const wf1 = makeWorkflow({ id: 'wf-1', name: 'WF1', nodes: [] });
      const wf2 = makeWorkflow({ id: 'wf-2', name: 'WF2', nodes: [] });
      const report = scanWorkflows([wf1, wf2] as any[]);
      expect(report.workflowsScanned).toBe(2);
    });

    it('should track scan duration in milliseconds', () => {
      const wf = makeWorkflow({ nodes: [] });
      const report = scanOne(wf);
      expect(report.scanDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
