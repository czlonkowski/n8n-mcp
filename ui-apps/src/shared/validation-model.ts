import { count, object, text, type JsonObject } from './result-state';
export interface Issue { message: string; node: string; property?: string; fix?: string }
export interface ValidationModel {
  valid: boolean; subject: string; id?: string; scope: string; profile?: string;
  errors: Issue[]; warnings: Issue[]; suggestions: string[]; errorCount: number; warningCount: number;
}
function issues(value: unknown): Issue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('The validation issue list is not readable.');
  return value.map(item => {
    const issue = object(item);
    if (!issue || !text(issue.message)) throw new Error('A validation issue is missing its description.');
    return { message: text(issue.message)!, node: text(issue.node) ?? text(issue.nodeName) ?? 'Workflow', property: text(issue.property), fix: text(issue.fix) ?? text(issue.suggestion) };
  });
}
export function validationModel(raw: JsonObject, input: JsonObject | null, toolName: string | null): ValidationModel {
  if (raw.success === false) throw new Error(text(raw.error) ?? text(raw.message) ?? 'Validation could not be completed.');
  const inner = object(raw.data) ?? raw;
  if (typeof inner.valid !== 'boolean') throw new Error('No validation verdict was returned.');
  const errors = issues(inner.errors);
  if (inner.missingRequiredFields !== undefined) {
    if (!Array.isArray(inner.missingRequiredFields) || inner.missingRequiredFields.some(f => typeof f !== 'string')) throw new Error('The required-field result is not readable.');
    for (const field of inner.missingRequiredFields as string[]) errors.push({ node: text(raw.displayName) ?? 'Node', message: `Missing required field: ${field}`, property: field });
  }
  const warnings = issues(inner.warnings);
  const summary = object(inner.summary);
  const errorCount = Math.max(count(summary?.errorCount) ?? 0, errors.length);
  if (inner.valid && errorCount > 0) throw new Error('The validation verdict conflicts with the reported errors.');
  const options = object(input?.options);
  const workflow = object(input?.workflow);
  return {
    valid: inner.valid,
    subject: text(inner.workflowName) ?? text(raw.displayName) ?? text(workflow?.name) ?? text(raw.nodeType) ?? 'Workflow validation',
    id: text(inner.workflowId) ?? text(input?.id),
    scope: validationScope(toolName),
    profile: text(input?.profile) ?? text(options?.profile), errors, warnings,
    suggestions: Array.isArray(inner.suggestions) ? inner.suggestions.filter((s): s is string => typeof s === 'string') : [],
    errorCount, warningCount: Math.max(count(summary?.warningCount) ?? 0, warnings.length),
  };
}

function validationScope(toolName: string | null): string {
  switch (toolName) {
    case 'n8n_validate_workflow': return 'Saved workflow';
    case 'validate_node': return 'Node configuration';
    case 'validate_workflow': return 'Workflow definition';
    default: return 'Scope not reported';
  }
}
