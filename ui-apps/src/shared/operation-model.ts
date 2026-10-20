import { count, object, text, type JsonObject } from './result-state';
export type Tone = 'success' | 'error' | 'warning' | 'neutral';
export interface OperationModel {
  title: string; summary: string; tone: Tone; subject: string; id?: string; executionId?: string;
  facts: { label: string; value: string }[];
  details: { title: string; value: unknown }[];
}
export function operationModel(raw: JsonObject, input: JsonObject | null, tool: string | null): OperationModel {
  const d = object(raw.data) ?? {};
  const details = object(raw.details) ?? {};
  const failed = Array.isArray(details.failed) ? details.failed.length : 0;
  const fixes = Array.isArray(d.fixes) ? d.fixes : [];
  const applied = count(d.operationsApplied);
  const message = text(raw.message) ?? text(d.message);
  const model: OperationModel = {
    title: 'Outcome unavailable', summary: message ?? 'This result does not confirm what changed.', tone: 'neutral',
    subject: text(d.name) ?? text(d.workflowName) ?? text(input?.name) ?? 'Workflow operation',
    id: text(d.id) ?? text(d.workflowId) ?? text(raw.workflowId) ?? text(input?.workflowId) ?? text(input?.id),
    executionId: text(raw.executionId) ?? text(d.executionId), facts: [], details: [],
  };
  const set = (title: string, summary: string, tone: Tone = 'neutral') => Object.assign(model, { title, summary, tone });
  if (raw.success === false) {
    set(raw.code === 'EXECUTION_FAILED' ? 'Execution failed' : 'Operation could not complete', text(raw.error) ?? message ?? 'The tool reported an error.', 'error');
    if (raw.saved === false) model.summary += ' No workflow changes were saved.';
    if (details.folderMoveMayHavePersisted === true) model.summary += ' The folder move may have persisted.';
  } else if (raw.success === true) {
    switch (tool) {
      case 'n8n_deploy_template': {
        if (!text(d.workflowId) || count(d.templateId) === undefined) break;
        const credentials = Array.isArray(d.requiredCredentials) ? d.requiredCredentials : [];
        const warnings = Array.isArray(d.warnings) ? d.warnings : [];
        const needsReview = credentials.length > 0 || d.autoFixStatus === 'failed' || warnings.length > 0;
        set(needsReview ? 'Template saved · setup needs review' : 'Template saved',
          `A workflow was saved from this template${d.active === false ? ' and is inactive' : ''}. Execution has not been verified.`, needsReview ? 'warning' : 'success');
        model.facts.push({ label: 'Template', value: String(d.templateId) });
        if (credentials.length) model.facts.push({ label: 'Credentials to configure', value: String(credentials.length) });
        if (d.autoFixStatus === 'failed') model.facts.push({ label: 'Automatic fixes', value: 'Failed after the workflow was saved' });
        if (credentials.length) model.details.push({ title: 'Credential setup', value: credentials });
        if (warnings.length) model.details.push({ title: 'Deployment warnings', value: warnings });
        break;
      }
      case 'n8n_create_workflow':
        if (text(d.id)) set('Workflow created', d.active === true ? 'Saved and active.' : d.active === false ? 'Saved and inactive.' : 'The workflow was saved.', 'success');
        break;
      case 'n8n_delete_workflow':
        if (d.deleted === true) set('Workflow deleted', 'The workflow was removed.', 'neutral');
        break;
      case 'n8n_update_full_workflow':
        if (text(d.id)) set('Workflow updated', 'The updated workflow was saved.', 'success');
        break;
      case 'n8n_update_partial_workflow':
        if (typeof d.valid === 'boolean' && count(d.operationsToApply) !== undefined) {
          set(d.valid === false ? 'Changes did not pass validation' : 'Changes checked', 'Nothing saved in this step.', d.valid === false ? 'error' : 'neutral');
        } else if (raw.saved === true) {
          set(failed ? 'Some changes applied' : applied === 0 ? 'No changes applied' : 'Workflow updated',
            `${applied === undefined ? 'Changes' : `${applied} operation${applied === 1 ? '' : 's'}`} saved${failed ? `; ${failed} failed` : ''}.`, failed ? 'warning' : 'success');
        }
        break;
      case 'n8n_autofix_workflow':
        if (d.preview === true) {
          const n = count(d.fixesAvailable) ?? fixes.length;
          set(`${n} fix${n === 1 ? '' : 'es'} proposed`, 'Preview only. Nothing changed in this step.');
        } else if (count(d.fixesApplied) !== undefined) {
          set(`${d.fixesApplied} fix${d.fixesApplied === 1 ? '' : 'es'} applied`, 'The autofix tool reported saved changes.', 'success');
        } else if (object(d.validationSummary) || message === 'No fixes needed') {
          set('No automatic fixes available', message ?? 'No changes were made.');
        }
        break;
      case 'n8n_test_workflow': {
        // Public trigger responses can contain arbitrary workflow data. Only the
        // official pinned-result contract carries an execution verdict here.
        const method = text(raw.method);
        if (method === 'prepare' && raw.backend === 'official-mcp' && object(d.nodeSchemasToGenerate)) set('Test prepared', 'Preparation only. No execution started in this step.');
        else if (raw.backend === 'official-mcp' && method === 'pinned' && d.status === 'success' && model.executionId) {
          set('Execution succeeded', 'The test returned a successful execution result.', 'success');
        } else if (raw.backend === 'official-mcp' && method === 'pinned' && ['error', 'crashed', 'canceled'].includes(String(d.status))) {
          set('Execution failed', text(d.error) ?? 'The test returned a failed execution result.', 'error');
        } else if ((method === 'trigger' && raw.backend === 'public-api' && text(raw.workflowId)) || (method === 'direct' && raw.backend === 'official-mcp' && object(raw.data))) {
          set('Workflow triggered', 'Completion has not been confirmed by this result.');
        }
        break;
      }
    }
  }
  if (raw.saved === true && raw.success === false) set('Changes saved with reported errors', text(raw.error) ?? 'Inspect the operation details before continuing.', 'warning');
  if (count(d.nodeCount) !== undefined) model.facts.push({ label: 'Nodes', value: String(d.nodeCount) });
  if (typeof d.active === 'boolean') model.facts.push({ label: 'Workflow', value: d.active ? 'Active' : 'Inactive' });
  for (const [title, value] of Object.entries({
    'Tool message': message, 'Proposed or applied fixes': d.fixes, 'Operation results': raw.details,
    'Structural issues': d.structureErrors,
  })) if (value !== undefined && value !== null) model.details.push({ title, value });
  if (model.title === 'Outcome unavailable') model.details.push({ title: 'Tool result', value: raw });
  return model;
}
