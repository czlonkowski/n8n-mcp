import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import hostFixtures from './host-fixtures.json';
export interface Scenario {
  id: string; label: string; app: 'operation-result' | 'validation-summary' | 'workflow-list' | 'execution-history' | 'health-dashboard'; tool: string;
  input: Record<string, unknown>;
  result?: Parameters<AppBridge['sendToolResult']>[0];
  lifecycle?: 'pending' | 'cancelled' | 'late-result';
  agentQuestion?: string;
  omitToolInfo?: boolean;
  hostDiagnostic?: boolean;
}
const response = (data: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const workflow = { id: 'demo-onboarding', name: 'Customer onboarding', active: false, nodeCount: 4 };
export const invalid = {
  success: true, data: {
    valid: false, workflowId: workflow.id, workflowName: workflow.name,
    errors: [
      { node: 'HTTP Request', property: 'url', message: 'Request URL is missing', fix: 'Provide the endpoint URL.' },
      { node: 'HTTP Request', property: 'responseFormat', message: 'Response format is not supported', fix: 'Use a supported response format.' },
      { node: 'Send welcome message', property: 'authentication', message: 'Authentication method is missing' },
    ],
    warnings: [{ node: 'HTTP Request', message: 'No error handling configured' }, { node: 'Edit Fields', message: 'Unused legacy field' }],
    summary: { errorCount: 3, warningCount: 2 },
  },
};
const operation = (id: string, label: string, tool: string, data: Record<string, unknown>, input: Record<string, unknown> = { id: workflow.id }): Scenario => ({ id, label, tool, app: 'operation-result', input, result: response(data) });
export const scenarios: Scenario[] = [
  operation('created', 'Workflow created', 'n8n_create_workflow', { success: true, data: workflow }),
  { id: 'invalid', label: 'Validation: errors and warnings', app: 'validation-summary', tool: 'n8n_validate_workflow', input: { id: workflow.id, options: { profile: 'runtime' } }, result: response(invalid) },
  operation('preview', 'Autofix: preview only', 'n8n_autofix_workflow', { success: true, data: { workflowId: workflow.id, workflowName: workflow.name, preview: true, fixesAvailable: 2, fixes: [{ description: 'Normalize node type', confidence: 'high' }, { description: 'Correct connection format', confidence: 'high' }] } }),
  operation('updated', 'Update: saved changes', 'n8n_update_partial_workflow', { success: true, saved: true, data: { ...workflow, operationsApplied: 2 }, details: { applied: [0, 1], failed: [] } }),
  { id: 'valid', label: 'Validation: passed', app: 'validation-summary', tool: 'validate_workflow', input: { workflow: { name: workflow.name }, options: { profile: 'runtime' } }, result: { structuredContent: { valid: true, errors: [], warnings: [] }, content: [] } },
  operation('triggered', 'Test: completion unknown', 'n8n_test_workflow', { success: true, method: 'trigger', backend: 'public-api', workflowId: workflow.id, executionId: 'demo-execution', data: { status: 'success' } }, { workflowId: workflow.id }),
  operation('executed', 'Test: verified success', 'n8n_test_workflow', { success: true, method: 'pinned', backend: 'official-mcp', data: { executionId: 'demo-execution', status: 'success' } }, { workflowId: workflow.id }),
  operation('partial', 'Update: partial success', 'n8n_update_partial_workflow', { success: true, saved: true, data: { ...workflow, operationsApplied: 1 }, details: { applied: [0], failed: [1], errors: [{ operation: 1, message: 'Node not found' }] } }),
  operation('not-saved', 'Update: failed before save', 'n8n_update_partial_workflow', { success: false, saved: false, error: 'Structural validation failed', details: { applied: [0], operationsApplied: 1, note: 'Simulation only; changes were not saved' } }),
  operation('validate-only', 'Update: validation only', 'n8n_update_partial_workflow', { success: true, data: { valid: true, operationsToApply: 2 } }, { id: workflow.id, validateOnly: true }),
  operation('validate-invalid', 'Update: invalid proposed changes', 'n8n_update_partial_workflow', { success: true, data: { valid: false, operationsToApply: 2, structureErrors: ['Missing trigger'] } }, { id: workflow.id, validateOnly: true }),
  operation('autofixed', 'Autofix: applied', 'n8n_autofix_workflow', { success: true, data: { workflowId: workflow.id, fixesApplied: 2, fixes: [{ description: 'Normalized node type' }] } }),
  operation('no-fixes', 'Autofix: no candidates', 'n8n_autofix_workflow', { success: true, data: { workflowId: workflow.id, message: 'No automatic fixes available for this workflow', validationSummary: { errors: 1, warnings: 0 } } }),
  operation('full-update', 'Full update: saved', 'n8n_update_full_workflow', { success: true, data: workflow }),
  operation('deleted', 'Workflow deleted', 'n8n_delete_workflow', { success: true, data: { id: workflow.id, name: workflow.name, deleted: true } }),
  operation('prepare', 'Test: preparation only', 'n8n_test_workflow', { success: true, method: 'prepare', backend: 'official-mcp', data: { nodeSchemasToGenerate: {}, coverage: { total: 0 } } }),
  operation('execution-failed', 'Test: execution failed', 'n8n_test_workflow', { success: false, method: 'pinned', backend: 'official-mcp', code: 'EXECUTION_FAILED', executionId: 'demo-execution', error: 'HTTP Request failed' }),
  { id: 'minimal', label: 'Node: minimal required-field check', app: 'validation-summary', tool: 'validate_node', input: { nodeType: 'nodes-base.httpRequest', mode: 'minimal' }, result: response({ nodeType: 'nodes-base.httpRequest', displayName: 'HTTP Request', valid: false, missingRequiredFields: ['url'] }) },
  { id: 'api-error', label: 'Validation: API failure', app: 'validation-summary', tool: 'n8n_validate_workflow', input: { id: workflow.id }, result: response({ success: false, error: 'The workflow could not be loaded.' }) },
  { id: 'protocol-error', label: 'Tool error (plain text)', app: 'validation-summary', tool: 'validate_workflow', input: {}, result: { isError: true, content: [{ type: 'text', text: 'The tool request was rejected.' }] } },
  { id: 'malformed', label: 'Malformed or truncated result', app: 'validation-summary', tool: 'validate_workflow', input: {}, result: { content: [{ type: 'text', text: '{"valid":true [truncated]' }] } },
  { id: 'pending', label: 'Tool call pending', app: 'validation-summary', tool: 'validate_workflow', input: {}, lifecycle: 'pending' },
  { id: 'cancelled', label: 'Cancelled call', app: 'validation-summary', tool: 'validate_workflow', input: {}, lifecycle: 'cancelled' },
  { id: 'late', label: 'Late result after cancellation', app: 'validation-summary', tool: 'validate_workflow', input: {}, lifecycle: 'late-result', result: response({ valid: true, errors: [], warnings: [] }) },
  { id: 'decision', label: 'Agent asks a business question', app: 'validation-summary', tool: 'n8n_validate_workflow', input: { id: workflow.id }, result: response(invalid), agentQuestion: 'Should welcome messages go to the sales team or directly to the customer?' },
];
export const sequence = ['created', 'invalid', 'preview', 'updated', 'valid', 'triggered', 'executed'];
for (const fixture of hostFixtures) scenarios.push({ ...fixture, app: fixture.app as Scenario['app'], result: response(fixture.data) });

// Exercise response identity without optional host context for every tool shape.
for (const scenario of [...scenarios].filter(s => s.result && !s.lifecycle)) {
  scenarios.push({ ...scenario, id: `${scenario.id}-no-tool-info`, label: `${scenario.label} · no host toolInfo`, omitToolInfo: true,
    result: { ...scenario.result!, _meta: { 'n8n-mcp/toolName': scenario.tool } } });
}
scenarios.push({ ...scenarios[0], id: 'recoverable-host-error', label: 'Host diagnostic followed by a valid result', hostDiagnostic: true });
