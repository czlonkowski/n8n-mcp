/**
 * Audit Report Builder
 *
 * Builds an actionable markdown security audit report that unifies
 * findings from both the n8n built-in audit endpoint and the custom
 * workflow security scanner. Produces a structured summary alongside
 * the markdown so callers can branch on severity counts.
 */

// ---------------------------------------------------------------------------
// Types – imported from the workflow security scanner
// ---------------------------------------------------------------------------

import type {
  AuditSeverity,
  RemediationType,
  AuditFinding,
  WorkflowSecurityReport,
} from './workflow-security-scanner';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuditReportInput {
  builtinAudit: any; // Raw response from n8n POST /audit (object with report keys, or [] if empty)
  customReport: WorkflowSecurityReport | null;
  performance: {
    builtinAuditMs: number;
    workflowFetchMs: number;
    customScanMs: number;
    totalMs: number;
  };
  instanceUrl: string;
  warnings?: string[];
}

export interface UnifiedAuditReport {
  markdown: string;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    totalFindings: number;
    workflowsScanned: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Severity sort order — most severe first. */
const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Map remediation type to a short fix label for the table column. */
const FIX_LABEL: Record<RemediationType, string> = {
  auto_fixable: 'Auto-fix',
  user_input_needed: 'User input',
  user_action_needed: 'User action',
  review_recommended: 'Review',
};

/** Returns true if the built-in audit response contains report data. */
function isPopulatedAudit(builtinAudit: any): builtinAudit is Record<string, any> {
  if (Array.isArray(builtinAudit)) return false;
  return typeof builtinAudit === 'object' && builtinAudit !== null;
}

/**
 * Iterates over all (reportKey, section) pairs in the built-in audit response.
 * Handles both `{ sections: [...] }` and direct array formats.
 */
function forEachBuiltinSection(
  builtinAudit: Record<string, any>,
  callback: (reportKey: string, section: any) => void,
): void {
  for (const reportKey of Object.keys(builtinAudit)) {
    const report = builtinAudit[reportKey];
    const sections = Array.isArray(report) ? report : (report?.sections ?? []);
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      callback(reportKey, section);
    }
  }
}

/** Get the location array from a section (n8n uses both "location" and "locations"). */
function getSectionLocations(section: any): any[] | null {
  const arr = section?.location ?? section?.locations;
  return Array.isArray(arr) ? arr : null;
}

/**
 * Count location items across all sections of the built-in audit response.
 */
function countBuiltinLocations(builtinAudit: any): number {
  if (!isPopulatedAudit(builtinAudit)) return 0;

  let count = 0;
  forEachBuiltinSection(builtinAudit, (_key, section) => {
    const locations = getSectionLocations(section);
    if (locations) count += locations.length;
  });
  return count;
}

/**
 * Group findings by workflow, returning a Map keyed by workflowId.
 * Each value includes workflow metadata and sorted findings.
 */
interface WorkflowGroup {
  workflowId: string;
  workflowName: string;
  workflowActive: boolean;
  findings: AuditFinding[];
  /** Worst severity in the group (lower = more severe). */
  worstSeverity: number;
}

function groupByWorkflow(findings: AuditFinding[]): WorkflowGroup[] {
  const map = new Map<string, WorkflowGroup>();

  for (const f of findings) {
    const wfId = f.location.workflowId;
    let group = map.get(wfId);
    if (!group) {
      group = {
        workflowId: wfId,
        workflowName: f.location.workflowName,
        workflowActive: f.location.workflowActive ?? false,
        findings: [],
        worstSeverity: SEVERITY_ORDER[f.severity],
      };
      map.set(wfId, group);
    }
    group.findings.push(f);
    const sev = SEVERITY_ORDER[f.severity];
    if (sev < group.worstSeverity) {
      group.worstSeverity = sev;
    }
  }

  // Sort workflows: worst severity first, then by name
  const groups = Array.from(map.values());
  groups.sort((a, b) => a.worstSeverity - b.worstSeverity || a.workflowName.localeCompare(b.workflowName));

  // Sort findings within each workflow by severity
  for (const g of groups) {
    g.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  return groups;
}

/**
 * Render the built-in audit section. Handles both empty (no issues) and
 * populated responses with report keys.
 */
function renderBuiltinAudit(builtinAudit: any): string {
  if (!isPopulatedAudit(builtinAudit)) {
    return 'No issues found by n8n built-in audit.';
  }

  const lines: string[] = [];
  let currentKey = '';

  forEachBuiltinSection(builtinAudit, (reportKey, section) => {
    if (reportKey !== currentKey) {
      if (currentKey) lines.push('');
      lines.push(`### ${reportKey}`);
      currentKey = reportKey;
    }

    const title = section.title || section.name || 'Unknown';
    const description = section.description || '';
    const recommendation = section.recommendation || '';

    lines.push(`- **${title}:** ${description}`);
    if (recommendation) {
      lines.push(`  - Recommendation: ${recommendation}`);
    }

    const locations = getSectionLocations(section);
    if (locations && locations.length > 0) {
      lines.push(`  - Affected: ${locations.length} items`);
    }

    // Special handling for Instance Risk Report fields
    if (reportKey === 'Instance Risk Report') {
      if (Array.isArray(section.nextVersions) && section.nextVersions.length > 0) {
        const versionNames = section.nextVersions
          .map((v: any) => (typeof v === 'string' ? v : v.name || String(v)))
          .join(', ');
        lines.push(`  - Available versions: ${versionNames}`);
      }

      if (section.settings && typeof section.settings === 'object') {
        const entries = Object.entries(section.settings);
        if (entries.length > 0) {
          lines.push('  - Security settings:');
          for (const [key, value] of entries) {
            lines.push(`    - ${key}: ${JSON.stringify(value)}`);
          }
        }
      }
    }
  });

  if (lines.length === 0) {
    return 'No issues found by n8n built-in audit.';
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Extract actionable items from the built-in audit for the playbook section.
 */
interface BuiltinActionables {
  outdatedInstance: boolean;
  communityNodeCount: number;
}

function extractBuiltinActionables(builtinAudit: any): BuiltinActionables {
  const result: BuiltinActionables = { outdatedInstance: false, communityNodeCount: 0 };
  if (!isPopulatedAudit(builtinAudit)) return result;

  forEachBuiltinSection(builtinAudit, (_key, section) => {
    const title = (section.title || section.name || '').toLowerCase();

    if (title.includes('outdated') || title.includes('update')) {
      result.outdatedInstance = true;
    }

    if (title.includes('community') || title.includes('custom node')) {
      const locations = getSectionLocations(section);
      result.communityNodeCount += locations ? locations.length : 1;
    }
  });

  return result;
}

/**
 * Render the Remediation Playbook — aggregated by finding type with tool
 * flow described once per type.
 */
function renderRemediationPlaybook(
  findings: AuditFinding[],
  builtinAudit: any,
): string {
  const lines: string[] = [];

  // Count findings by category
  const byCat: Record<string, AuditFinding[]> = {};
  for (const f of findings) {
    if (!byCat[f.category]) byCat[f.category] = [];
    byCat[f.category].push(f);
  }

  // Unique workflow count per category
  const uniqueWorkflows = (items: AuditFinding[]): number =>
    new Set(items.map(f => f.location.workflowId)).size;

  // --- Auto-fixable by agent ---
  const autoFixCategories = ['hardcoded_secrets', 'unauthenticated_webhooks'];
  const hasAutoFix = autoFixCategories.some(cat => byCat[cat] && byCat[cat].length > 0);

  if (hasAutoFix) {
    lines.push('### Auto-fixable by agent');
    lines.push('');

    if (byCat['hardcoded_secrets']?.length) {
      const autoFixSecrets = byCat['hardcoded_secrets'].filter(f => f.remediationType === 'auto_fixable');
      if (autoFixSecrets.length > 0) {
        const wfCount = uniqueWorkflows(autoFixSecrets);
        lines.push(`**Hardcoded secrets** (${autoFixSecrets.length} across ${wfCount} workflow${wfCount !== 1 ? 's' : ''}):`);
        lines.push('Steps: `n8n_get_workflow` -> extract value -> `n8n_manage_credentials({action: "create"})` -> `n8n_update_partial_workflow({operations: [{type: "updateNode"}]})` to reference credential.');
      }
      lines.push('');
    }

    if (byCat['unauthenticated_webhooks']?.length) {
      const items = byCat['unauthenticated_webhooks'];
      const wfCount = uniqueWorkflows(items);
      lines.push(`**Unauthenticated webhooks** (${items.length} across ${wfCount} workflow${wfCount !== 1 ? 's' : ''}):`);
      lines.push('Steps: `n8n_manage_credentials({action: "create", type: "httpHeaderAuth"})` with random secret -> `n8n_update_partial_workflow` to set `authentication: "headerAuth"` and assign credential.');
      lines.push('');
    }
  }

  // --- Requires review ---
  const reviewCategories = ['error_handling'];
  const piiFindings = findings.filter(f => f.category === 'hardcoded_secrets' && f.remediationType === 'review_recommended');
  const hasReview = reviewCategories.some(cat => byCat[cat] && byCat[cat].length > 0) || piiFindings.length > 0;

  if (hasReview) {
    lines.push('### Requires review');

    if (byCat['error_handling']?.length) {
      const wfCount = uniqueWorkflows(byCat['error_handling']);
      lines.push(`**Error handling gaps** (${wfCount} workflow${wfCount !== 1 ? 's' : ''}): Add Error Trigger nodes or set continueOnFail on critical nodes.`);
    }

    if (piiFindings.length > 0) {
      lines.push(`**PII in parameters** (${piiFindings.length} finding${piiFindings.length !== 1 ? 's' : ''}): Review whether hardcoded PII (emails, phones) is necessary or should use expressions.`);
    }

    lines.push('');
  }

  // --- Requires your action ---
  const retentionFindings = byCat['data_retention'] || [];
  const builtinActions = extractBuiltinActionables(builtinAudit);
  const hasUserAction = retentionFindings.length > 0 || builtinActions.outdatedInstance || builtinActions.communityNodeCount > 0;

  if (hasUserAction) {
    lines.push('### Requires your action');

    if (retentionFindings.length > 0) {
      const wfCount = uniqueWorkflows(retentionFindings);
      lines.push(`**Data retention** (${wfCount} workflow${wfCount !== 1 ? 's' : ''}): Configure execution data pruning in n8n Settings -> Executions.`);
    }

    if (builtinActions.outdatedInstance) {
      lines.push('**Outdated instance**: Update n8n to latest version.');
    }

    if (builtinActions.communityNodeCount > 0) {
      lines.push(`**Community nodes** (${builtinActions.communityNodeCount}): Review installed community packages.`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildAuditReport(input: AuditReportInput): UnifiedAuditReport {
  const { builtinAudit, customReport, performance, instanceUrl, warnings } = input;

  // --- Compute summary counts ---
  const customSummary = customReport?.summary ?? { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const builtinCount = countBuiltinLocations(builtinAudit);

  const summary: UnifiedAuditReport['summary'] = {
    critical: customSummary.critical,
    high: customSummary.high,
    medium: customSummary.medium,
    low: customSummary.low + builtinCount, // built-in issues counted as low by default
    totalFindings: customSummary.total + builtinCount,
    workflowsScanned: customReport?.workflowsScanned ?? 0,
  };

  // --- Build markdown ---
  const md: string[] = [];

  // Header
  md.push('# n8n Security Audit Report');
  md.push(`Generated: ${new Date().toISOString()} | Instance: ${instanceUrl}`);
  md.push('');

  // Summary table
  md.push('## Summary');
  md.push('| Severity | Count |');
  md.push('|----------|-------|');
  md.push(`| Critical | ${summary.critical} |`);
  md.push(`| High | ${summary.high} |`);
  md.push(`| Medium | ${summary.medium} |`);
  md.push(`| Low | ${summary.low} |`);
  md.push(`| **Total** | **${summary.totalFindings}** |`);
  md.push('');
  md.push(
    `Workflows scanned: ${summary.workflowsScanned} | Scan duration: ${(performance.totalMs / 1000).toFixed(1)}s`,
  );
  md.push('');

  // Warnings
  if (warnings && warnings.length > 0) {
    for (const w of warnings) {
      md.push(`- ${w}`);
    }
    md.push('');
  }

  md.push('---');
  md.push('');

  // --- Findings by Workflow ---
  if (customReport && customReport.findings.length > 0) {
    md.push('## Findings by Workflow');
    md.push('');

    const workflowGroups = groupByWorkflow(customReport.findings);

    for (const group of workflowGroups) {
      const activeTag = group.workflowActive ? ' [ACTIVE]' : '';
      md.push(`### "${group.workflowName}" (id: ${group.workflowId})${activeTag} — ${group.findings.length} finding${group.findings.length !== 1 ? 's' : ''}`);
      md.push('');
      md.push('| ID | Severity | Finding | Node | Fix |');
      md.push('|----|----------|---------|------|-----|');

      for (const f of group.findings) {
        const node = f.location.nodeName || '\u2014';
        const fix = FIX_LABEL[f.remediationType];
        const sevLabel = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
        md.push(`| ${f.id} | ${sevLabel} | ${f.title} | ${node} | ${fix} |`);
      }

      md.push('');
    }

    md.push('---');
    md.push('');
  }

  // --- Built-in audit ---
  md.push('## n8n Built-in Audit Results');
  md.push('');
  md.push(renderBuiltinAudit(builtinAudit));
  md.push('');
  md.push('---');
  md.push('');

  // --- Remediation Playbook ---
  md.push('## Remediation Playbook');
  md.push('');
  const playbook = renderRemediationPlaybook(customReport?.findings ?? [], builtinAudit);
  if (playbook.trim().length > 0) {
    md.push(playbook);
  } else {
    md.push('No remediation actions needed.');
    md.push('');
  }
  md.push('---');
  md.push('');

  // Performance footer
  md.push(
    `Scan performance: built-in ${performance.builtinAuditMs}ms | fetch ${performance.workflowFetchMs}ms | custom ${performance.customScanMs}ms`,
  );

  return {
    markdown: md.join('\n'),
    summary,
  };
}
