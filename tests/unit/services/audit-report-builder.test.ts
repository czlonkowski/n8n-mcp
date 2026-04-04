import { describe, it, expect } from 'vitest';
import {
  buildAuditReport,
  type AuditReportInput,
  type UnifiedAuditReport,
} from '@/services/audit-report-builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PERFORMANCE = {
  builtinAuditMs: 100,
  workflowFetchMs: 50,
  customScanMs: 200,
  totalMs: 350,
};

function makeInput(overrides: Partial<AuditReportInput> = {}): AuditReportInput {
  return {
    builtinAudit: [],
    customReport: null,
    performance: DEFAULT_PERFORMANCE,
    instanceUrl: 'https://n8n.example.com',
    ...overrides,
  };
}

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'CRED-001',
    severity: 'critical' as const,
    category: 'hardcoded_secrets',
    title: 'Hardcoded openai_key detected',
    description: 'Found a hardcoded openai_key in node "HTTP Request".',
    recommendation: 'Move this secret into n8n credentials.',
    remediationType: 'auto_fixable' as const,
    remediation: [
      {
        tool: 'n8n_manage_credentials',
        args: { action: 'create' },
        description: 'Create credential',
      },
    ],
    location: {
      workflowId: 'wf-1',
      workflowName: 'Test Workflow',
      workflowActive: true,
      nodeName: 'HTTP Request',
      nodeType: 'n8n-nodes-base.httpRequest',
    },
    ...overrides,
  };
}

function makeCustomReport(findings: any[], workflowsScanned = 1) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length };
  for (const f of findings) {
    summary[f.severity as keyof typeof summary]++;
  }
  return {
    findings,
    workflowsScanned,
    scanDurationMs: 150,
    summary,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('audit-report-builder', () => {
  describe('empty reports', () => {
    it('should produce "No issues found" when built-in audit is empty and no custom findings', () => {
      const input = makeInput({ builtinAudit: [], customReport: null });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('No issues found');
      expect(result.summary.totalFindings).toBe(0);
      expect(result.summary.critical).toBe(0);
      expect(result.summary.high).toBe(0);
      expect(result.summary.medium).toBe(0);
      expect(result.summary.low).toBe(0);
    });

    it('should produce "No issues found" when built-in audit is null-like', () => {
      const input = makeInput({ builtinAudit: null });
      const result = buildAuditReport(input);
      expect(result.markdown).toContain('No issues found');
    });
  });

  describe('built-in audit rendering', () => {
    it('should render built-in audit with Nodes Risk Report', () => {
      // Real n8n API uses { risk: "nodes", sections: [...] } format
      const builtinAudit = {
        'Nodes Risk Report': {
          risk: 'nodes',
          sections: [
            {
              title: 'Insecure node detected',
              description: 'Node X uses deprecated API',
              recommendation: 'Update to latest version',
              location: [{ id: 'node-1' }, { id: 'node-2' }],
            },
          ],
        },
      };

      const input = makeInput({ builtinAudit });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Nodes Risk Report');
      expect(result.markdown).toContain('Insecure node detected');
      expect(result.markdown).toContain('deprecated API');
      expect(result.markdown).toContain('Affected: 2 items');
      // Built-in locations are counted as low severity
      expect(result.summary.low).toBe(2);
      expect(result.summary.totalFindings).toBe(2);
    });

    it('should render Instance Risk Report with version and settings info', () => {
      const builtinAudit = {
        'Instance Risk Report': {
          risk: 'instance',
          sections: [
            {
              title: 'Outdated instance',
              description: 'Running an old version',
              recommendation: 'Update n8n',
              nextVersions: [{ name: '1.20.0' }, { name: '1.21.0' }],
              settings: {
                authenticationMethod: 'none',
                publicApiDisabled: false,
              },
            },
          ],
        },
      };

      const input = makeInput({ builtinAudit });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Instance Risk Report');
      expect(result.markdown).toContain('Available versions: 1.20.0, 1.21.0');
      expect(result.markdown).toContain('authenticationMethod');
    });
  });

  describe('grouped by workflow', () => {
    it('should group findings by workflow with table format', () => {
      const findings = [
        makeFinding({ id: 'CRED-001', severity: 'critical', title: 'Critical issue' }),
        makeFinding({ id: 'ERR-001', severity: 'medium', title: 'Medium issue', category: 'error_handling' }),
      ];

      const input = makeInput({ customReport: makeCustomReport(findings) });
      const result = buildAuditReport(input);

      // Should have a workflow heading
      expect(result.markdown).toContain('Test Workflow');
      // Should have a table with findings
      expect(result.markdown).toContain('| ID | Severity | Finding | Node | Fix |');
      expect(result.markdown).toContain('CRED-001');
      expect(result.markdown).toContain('ERR-001');
    });

    it('should sort findings within workflow by severity', () => {
      const findings = [
        makeFinding({ id: 'LOW-001', severity: 'low', title: 'Low issue' }),
        makeFinding({ id: 'CRIT-001', severity: 'critical', title: 'Critical issue' }),
      ];

      const input = makeInput({ customReport: makeCustomReport(findings) });
      const result = buildAuditReport(input);

      const critIdx = result.markdown.indexOf('CRIT-001');
      const lowIdx = result.markdown.indexOf('LOW-001');
      expect(critIdx).toBeLessThan(lowIdx);
    });

    it('should sort workflows by worst severity first', () => {
      const findings = [
        makeFinding({ id: 'LOW-001', severity: 'low', title: 'Low issue', location: { workflowId: 'wf-2', workflowName: 'Safe Workflow', nodeName: 'Set', nodeType: 'n8n-nodes-base.set' } }),
        makeFinding({ id: 'CRIT-001', severity: 'critical', title: 'Critical issue', location: { workflowId: 'wf-1', workflowName: 'Danger Workflow', nodeName: 'HTTP', nodeType: 'n8n-nodes-base.httpRequest' } }),
      ];

      const input = makeInput({ customReport: makeCustomReport(findings, 2) });
      const result = buildAuditReport(input);

      const dangerIdx = result.markdown.indexOf('Danger Workflow');
      const safeIdx = result.markdown.indexOf('Safe Workflow');
      expect(dangerIdx).toBeLessThan(safeIdx);
    });
  });

  describe('remediation playbook', () => {
    it('should show auto-fixable section for secrets and webhooks', () => {
      const findings = [
        makeFinding({ remediationType: 'auto_fixable', category: 'hardcoded_secrets' }),
        makeFinding({ id: 'WEBHOOK-001', severity: 'medium', remediationType: 'auto_fixable', category: 'unauthenticated_webhooks', title: 'Unauthenticated webhook' }),
      ];

      const input = makeInput({ customReport: makeCustomReport(findings) });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Auto-fixable by agent');
      expect(result.markdown).toContain('Hardcoded secrets');
      expect(result.markdown).toContain('Unauthenticated webhooks');
      expect(result.markdown).toContain('n8n_manage_credentials');
    });

    it('should show review section for error handling and PII', () => {
      const findings = [
        makeFinding({ id: 'ERR-001', severity: 'medium', remediationType: 'review_recommended', category: 'error_handling', title: 'No error handling' }),
        makeFinding({ id: 'PII-001', severity: 'medium', remediationType: 'review_recommended', category: 'hardcoded_secrets', title: 'PII found' }),
      ];

      const input = makeInput({ customReport: makeCustomReport(findings) });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Requires review');
      expect(result.markdown).toContain('Error handling gaps');
      expect(result.markdown).toContain('PII in parameters');
    });

    it('should show user action section for data retention', () => {
      const findings = [
        makeFinding({ id: 'RET-001', severity: 'low', remediationType: 'user_action_needed', category: 'data_retention', title: 'Excessive retention' }),
      ];

      const input = makeInput({ customReport: makeCustomReport(findings) });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Requires your action');
      expect(result.markdown).toContain('Data retention');
    });

    it('should surface built-in audit actionables in playbook', () => {
      const builtinAudit = {
        'Instance Risk Report': {
          risk: 'instance',
          sections: [
            { title: 'Outdated instance', description: 'Old version', recommendation: 'Update' },
          ],
        },
        'Nodes Risk Report': {
          risk: 'nodes',
          sections: [
            { title: 'Community nodes', description: 'Unvetted', recommendation: 'Review', location: [{ id: '1' }, { id: '2' }] },
          ],
        },
      };

      const input = makeInput({ builtinAudit });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Outdated instance');
      expect(result.markdown).toContain('Community nodes');
    });
  });

  describe('warnings', () => {
    it('should include warnings in the report when provided', () => {
      const input = makeInput({
        warnings: [
          'Could not fetch 2 workflows due to permissions',
          'Built-in audit endpoint returned partial results',
        ],
      });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('Could not fetch 2 workflows');
      expect(result.markdown).toContain('partial results');
    });

    it('should not include warnings when none are provided', () => {
      const input = makeInput({ warnings: undefined });
      const result = buildAuditReport(input);
      expect(result.markdown).not.toContain('Warning');
    });
  });

  describe('performance timing', () => {
    it('should include scan performance metrics in the report', () => {
      const input = makeInput({
        performance: {
          builtinAuditMs: 120,
          workflowFetchMs: 80,
          customScanMs: 250,
          totalMs: 450,
        },
      });
      const result = buildAuditReport(input);

      expect(result.markdown).toContain('120ms');
      expect(result.markdown).toContain('80ms');
      expect(result.markdown).toContain('250ms');
    });
  });

  describe('summary counts', () => {
    it('should aggregate counts across both built-in and custom sources', () => {
      const builtinAudit = {
        'Nodes Risk Report': {
          risk: 'nodes',
          sections: [
            {
              title: 'Issue',
              description: 'Desc',
              location: [{ id: '1' }, { id: '2' }, { id: '3' }],
            },
          ],
        },
      };

      const findings = [
        makeFinding({ severity: 'critical' }),
        makeFinding({ id: 'CRED-002', severity: 'high' }),
        makeFinding({ id: 'CRED-003', severity: 'medium' }),
      ];

      const input = makeInput({
        builtinAudit,
        customReport: makeCustomReport(findings, 5),
      });

      const result = buildAuditReport(input);

      expect(result.summary.critical).toBe(1);
      expect(result.summary.high).toBe(1);
      expect(result.summary.medium).toBe(1);
      // 3 built-in locations counted as low
      expect(result.summary.low).toBe(3);
      expect(result.summary.totalFindings).toBe(6);
      expect(result.summary.workflowsScanned).toBe(5);
    });
  });
});
