import { describe, it, expect } from 'vitest';
import { operationModel } from '../src/shared/operation-model';
import { validationModel } from '../src/shared/validation-model';
import { decodeResult } from '../src/shared/result-state';
import { scenarios } from '../src/lab/fixtures';
function operation(id: string) {
  const s = scenarios.find(s => s.id === id)!;
  return operationModel(decodeResult(s.result!), s.input, s.tool);
}
describe('operation result contracts', () => {
  it.each([
    ['created', 'Workflow created'], ['updated', 'Workflow updated'], ['full-update', 'Workflow updated'],
    ['deleted', 'Workflow deleted'], ['preview', '2 fixes proposed'], ['autofixed', '2 fixes applied'],
    ['no-fixes', 'No automatic fixes available'], ['validate-only', 'Changes checked'],
    ['validate-invalid', 'Changes did not pass validation'], ['partial', 'Some changes applied'],
    ['prepare', 'Test prepared'], ['triggered', 'Workflow triggered'], ['executed', 'Execution succeeded'],
    ['execution-failed', 'Execution failed'], ['not-saved', 'Operation could not complete'],
  ])('%s has an evidence-based title', (id, title) => expect(operation(id).title).toBe(title));
  it('does not treat applied simulation indexes or webhook response data as proof of completion', () => {
    expect(operation('not-saved').summary).toContain('No workflow changes were saved');
    expect(operation('triggered').summary).toContain('Completion has not been confirmed');
    expect(operation('triggered').executionId).toBe('demo-execution');
    expect(operation('partial').summary).toBe('1 operation saved; 1 failed.');
    expect(operation('preview').summary).toContain('Nothing changed');
  });
  it('does not guess the operation from an arbitrary success object', () => {
    expect(operationModel({ success: true }, null, null).title).toBe('Outcome unavailable');
    expect(operationModel({ success: true, data: {} }, null, 'n8n_delete_workflow').title).toBe('Outcome unavailable');
    expect(operationModel({ success: true, data: {} }, null, 'n8n_update_partial_workflow').title).toBe('Outcome unavailable');
    expect(operationModel({ success: true, data: {} }, { validateOnly: true }, 'n8n_update_partial_workflow').title).toBe('Outcome unavailable');
    for (const method of ['prepare', 'direct', 'trigger', 'pinned']) {
      expect(operationModel({ success: true, data: {} }, { method }, 'n8n_test_workflow').title).toBe('Outcome unavailable');
    }
    expect(operationModel({ success: true, method: 'prepare', backend: 'official-mcp', data: {} }, null, 'n8n_test_workflow').title).toBe('Outcome unavailable');
  });
  it('distinguishes zero changes, partial persistence and the official failed result', () => {
    expect(operationModel({ success: true, saved: true, data: { operationsApplied: 0 } }, null, 'n8n_update_partial_workflow').title).toBe('No changes applied');
    expect(operationModel({ success: false, saved: true }, null, null).tone).toBe('warning');
    expect(operationModel({ success: false, details: { folderMoveMayHavePersisted: true } }, null, null).summary).toContain('may have persisted');
    expect(operationModel({ success: true, backend: 'official-mcp', method: 'pinned', data: { status: 'crashed' } }, null, 'n8n_test_workflow').title).toBe('Execution failed');
    expect(operationModel({ success: true, method: 'direct', backend: 'official-mcp', data: { status: 'success' } }, null, 'n8n_test_workflow').title).toBe('Workflow triggered');
  });
});
describe('validation contracts', () => {
  it('preserves node warning suggestions for inspection', () => {
    const model = validationModel({ valid: true, warnings: [{ message: 'No error handling', suggestion: 'Add an error output.' }] }, null, 'validate_node');
    expect(model.warnings[0].fix).toBe('Add an error output.');
  });
  it('supports live wrappers, minimal checks and structured offline results', () => {
    for (const id of ['invalid', 'minimal', 'valid']) {
      const s = scenarios.find(s => s.id === id)!;
      const m = validationModel(decodeResult(s.result!), s.input, s.tool);
      expect(m.valid).toBe(id === 'valid');
      if (id === 'minimal') expect(m.errors[0].property).toBe('url');
      if (id === 'invalid') { expect(m.id).toBe('demo-onboarding'); expect(m.profile).toBe('runtime'); }
    }
  });
  it('never displays all checks passed for missing, inconsistent or failed validation', () => {
    for (const raw of [{ success: false }, {}, { valid: true, errors: [{ message: 'Broken' }] }, { valid: false, errors: 'oops' }, { valid: false, errors: [{}] }, { valid: false, missingRequiredFields: [1] }]) expect(() => validationModel(raw, null, null)).toThrow();
  });
  it('preserves unknown counts, single-node identity and absent descriptions', () => {
    const m = validationModel({ valid: false, summary: { errorCount: 2 }, warnings: [{ nodeName: 'Only node', message: 'Warning' }], suggestions: ['Useful', 42] }, null, null);
    expect(m.scope).toBe('Scope not reported');
    expect(m.errorCount).toBe(2); expect(m.errors).toEqual([]); expect(m.warnings[0].node).toBe('Only node'); expect(m.suggestions).toEqual(['Useful']);
  });
});
