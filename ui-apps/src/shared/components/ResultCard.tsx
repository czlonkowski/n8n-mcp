import React, { createContext, useContext, useId } from 'react';
import { useCardExpansion } from '../hooks/useCardExpansion';
import type { ResultPhase } from '../result-state';
import type { Tone } from '../operation-model';

const ExpansionContext = createContext<ReturnType<typeof useCardExpansion> | null>(null);
type CardProps = {
  kind: string; title: string; subject?: string; summary?: string; tone?: Tone; synthetic?: boolean; children?: React.ReactNode;
};
const compactTitles: Record<string, string> = {
  'Workflow created': 'Created', 'Workflow updated': 'Updated', 'Workflow deleted': 'Deleted',
  'Workflow triggered': 'Triggered', 'Execution succeeded': 'Succeeded', 'Execution failed': 'Failed',
  'Template saved': 'Saved', 'Template saved · setup needs review': 'Saved · setup needed',
  'Changes saved with reported errors': 'Saved with errors', 'Some changes applied': 'Partially applied',
  'No changes applied': 'No changes', 'Changes checked': 'Checked · not saved',
  'Changes did not pass validation': 'Invalid changes', 'No automatic fixes available': 'No fixes available',
  'Operation could not complete': 'Failed', 'No validation errors found': 'No errors',
  'Validation did not pass': 'Invalid', 'Validation unavailable': 'Unavailable',
  'Outcome unavailable': 'Unavailable', 'Result unavailable': 'Unavailable',
  'No matching workflows': 'No matches', 'No matching executions': 'No matches',
  'Request could not complete': 'Failed', 'Execution deleted': 'Deleted',
  'Connection verified': 'Connected', 'Connection not confirmed': 'Not confirmed',
  'Connection failed': 'Failed', 'n8n API not configured': 'Not configured',
  'Tool call in progress': 'In progress', 'Tool call cancelled': 'Cancelled',
  'Connecting to host': 'Connecting', 'Waiting for a tool result': 'Waiting',
  'Open in an MCP Apps host': 'Host required',
};
function compactTitle(title: string): string {
  return compactTitles[title] ?? title.replace(/^(\d+) validation errors? found$/, (_, n: string) => `${n} ${n === '1' ? 'error' : 'errors'}`)
    .replace(/^(\d+) (?:workflows?|executions?) returned$/, '$1 returned')
    .replace(/^Unknown status: .+$/, 'Unknown status');
}
export function ResultCard(props: CardProps) {
  const expansion = useContext(ExpansionContext);
  return expansion ? <Card {...props} expansion={expansion} /> : <StandaloneCard {...props} />;
}
function StandaloneCard(props: CardProps) {
  return <Card {...props} expansion={useCardExpansion()} />;
}
function Card({ kind, title, subject, summary, tone = 'neutral', synthetic = false, children, expansion: { expanded, toggle } }: CardProps & { expansion: ReturnType<typeof useCardExpansion> }) {
  const bodyId = useId();
  return <section className="result-card" aria-label={kind}>
    <button type="button" className="result-toggle" aria-describedby={`${bodyId}-status`} aria-expanded={expanded} aria-controls={bodyId} onClick={toggle}>
      <span className="result-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      <strong>n8n-mcp</strong>
      {synthetic && <span className="result-fixture">Test</span>}
      <span className="result-kind">{kind === 'Workflow operation' ? 'Workflow' : kind}</span>
      <span className={`result-status tone-${tone}`} title={title}>{compactTitle(title)}</span>
    </button>
    <span id={`${bodyId}-status`} className="sr-only" role="status">{title}</span>
    <div id={bodyId} className="result-body" hidden={!expanded}>
      {synthetic && <p className="result-note" role="note">Synthetic UI test · No live n8n operation</p>}
      <p className="result-outcome">{title}</p>
      {subject && <h1>{subject}</h1>}
      {summary && <p className="result-summary">{summary}</p>}
      {children}
    </div>
  </section>;
}

export function ResultContext({ id, receivedAt, scope, profile, toolName, executionId }: {
  id?: string; receivedAt?: string | null; scope?: string; profile?: string; toolName?: string | null; executionId?: string;
}) {
  return <details className="result-details"><summary>Result context</summary><dl className="result-facts">
    {scope && <><dt>Scope</dt><dd>{scope}</dd></>}
    {profile && <><dt>Profile</dt><dd>{profile}</dd></>}
    {id && <><dt>Workflow ID</dt><dd><code>{id}</code></dd></>}
    {executionId && <><dt>Execution ID</dt><dd><code>{executionId}</code></dd></>}
    {toolName && <><dt>Tool</dt><dd><code>{toolName}</code></dd></>}
    {receivedAt && <><dt>Received</dt><dd><time dateTime={receivedAt}>{new Date(receivedAt).toLocaleString()}</time></dd></>}
  </dl><p className="result-note">Snapshot of this tool call.</p></details>;
}

type BoundaryProps = {
  kind: string;
  state: { phase: ResultPhase; error: string | null; hostWarning?: string | null; toolName?: string | null; receivedAt?: string | null; isConnected: boolean; standalone: boolean; data?: Record<string, unknown> | null };
  children: React.ReactNode;
};
export function ResultBoundary(props: BoundaryProps) {
  const expansion = useCardExpansion();
  return <ExpansionContext.Provider value={expansion}><BoundaryContent {...props} /></ExpansionContext.Provider>;
}
function BoundaryContent({ kind, state, children }: BoundaryProps) {
  if (state.standalone) return <ResultCard kind={kind} title="Open in an MCP Apps host" summary="This view receives results from the agent’s tool calls. For local testing, start the UI lab with npm run ui:dev." />;
  if (state.phase === 'ready') return <>{children}</>;
  if (state.phase === 'cancelled') return <ResultCard kind={kind} title="Tool call cancelled" summary={state.error ?? 'No outcome was confirmed for this call.'} />;
  if (state.error) return <ResultCard kind={kind} title="Result unavailable" summary={state.error} tone="error">
    {(state.toolName || state.receivedAt) && <ResultContext toolName={state.toolName} receivedAt={state.receivedAt} />}
  </ResultCard>;
  if (!state.isConnected) return <ResultCard kind={kind} title="Connecting to host" summary="Establishing the result view." />;
  return <ResultCard kind={kind} title={state.phase === 'pending' ? 'Tool call in progress' : 'Waiting for a tool result'} summary="No outcome has been returned yet.">
    {state.hostWarning && <p className="result-note" role="status">A host communication problem occurred. Still waiting for the tool result.</p>}
  </ResultCard>;
}
