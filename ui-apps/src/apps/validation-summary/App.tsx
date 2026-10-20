import React, { useState } from 'react';
import '@shared/styles/theme.css';
import { useToolData } from '@shared/hooks/useToolData';
import { validationModel, type ValidationModel, type Issue } from '@shared/validation-model';
import { ResultBoundary, ResultCard, ResultContext } from '@shared/components/ResultCard';

function Issues({ model }: { model: ValidationModel }) {
  const [filter, setFilter] = useState<'errors' | 'warnings' | 'all'>(model.errorCount ? 'errors' : 'warnings');
  const all = [...model.errors.map(issue => ({ ...issue, severity: 'error' })), ...model.warnings.map(issue => ({ ...issue, severity: 'warning' }))];
  const groups = [...new Set(all.map(issue => issue.node))].sort((a, b) =>
    model.errors.filter(i => i.node === b).length - model.errors.filter(i => i.node === a).length);
  const visible = all.filter(issue => filter === 'all' || issue.severity === (filter === 'errors' ? 'error' : 'warning'));
  return <>
    <div className="result-filters" role="group" aria-label="Issue severity">
      {(['errors', 'warnings', 'all'] as const).map(f => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
        {f === 'errors' ? `Errors · ${model.errorCount}` : f === 'warnings' ? `Warnings · ${model.warningCount}` : 'All issues'}
      </button>)}
    </div>
    {groups.filter(node => visible.some(i => i.node === node)).map(node => <section key={node} className="issue-group" aria-label={node}>
      <h2>{node}</h2>{visible.filter(i => i.node === node).map((issue, i) => <IssueRow key={i} issue={issue} severity={issue.severity} />)}
    </section>)}
    {visible.length === 0 && <p className="result-note">No issue descriptions were returned for this category.</p>}
    {(model.errorCount > model.errors.length || model.warningCount > model.warnings.length) && <p className="result-note">The tool returned counts for some issues without their descriptions.</p>}
  </>;
}
function IssueRow({ issue, severity }: { issue: Issue; severity: string }) {
  return <div className={`result-issue issue-${severity}`}><p>{issue.message}</p>
    {issue.property && <code>{issue.property}</code>}{issue.fix && <p className="result-note">Suggested fix: {issue.fix}</p>}
  </div>;
}
export default function App() {
  const state = useToolData();
  let model: ValidationModel | null = null;
  let issue: string | null = null;
  if (state.data) {
    try { model = validationModel(state.data, state.input, state.toolName); }
    catch (error) { issue = error instanceof Error ? error.message : 'Validation result unavailable'; }
  }
  return <ResultBoundary kind="Validation" state={state}>
    {issue ? <ResultCard kind="Validation" title="Validation unavailable" summary={issue} tone="error">
      <ResultContext receivedAt={state.receivedAt} toolName={state.toolName} />
    </ResultCard> : model && <ResultCard kind="Validation"
      title={model.valid ? 'No validation errors found' : model.errorCount ? `${model.errorCount} validation error${model.errorCount === 1 ? '' : 's'} found` : 'Validation did not pass'}
      subject={model.subject} tone={model.valid ? model.warningCount ? 'warning' : 'success' : 'error'}
      summary={model.valid ? model.warningCount ? `${model.warningCount} warning${model.warningCount === 1 ? '' : 's'} reported.` : 'This check passed. Execution has not been verified by this check.' : 'This check found issues in the workflow configuration.'}>
      {(model.errorCount > 0 || model.warningCount > 0 || !model.valid) && <details className="result-details"><summary>Validation details <span>{model.errorCount} error{model.errorCount === 1 ? '' : 's'} · {model.warningCount} warning{model.warningCount === 1 ? '' : 's'}</span></summary><Issues key={state.receivedAt} model={model} /></details>}
      {model.suggestions.length > 0 && <details className="result-details"><summary>Suggestions <span>{model.suggestions.length}</span></summary><ul>{model.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></details>}
      <ResultContext id={model.id} receivedAt={state.receivedAt} toolName={state.toolName} scope={model.scope} profile={model.profile} />
    </ResultCard>}
  </ResultBoundary>;
}
