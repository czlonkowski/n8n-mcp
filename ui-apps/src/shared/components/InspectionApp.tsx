import React from 'react';
import '../styles/theme.css';
import { useToolData } from '../hooks/useToolData';
import { executionModel, healthModel, workflowListModel, type InspectionKind, type InspectionRow } from '../inspection-models';
import { ResultBoundary, ResultCard, ResultContext } from './ResultCard';
import { Facts } from './Facts';
const models: Record<InspectionKind, typeof workflowListModel> = {
  Workflows: workflowListModel, Executions: executionModel, Connection: healthModel,
};
function Rows({ rows }: { rows: InspectionRow[] }) {
  return <ul className="inspection-list">{rows.map((row, index) => <li key={`${row.id}-${index}`}>
    <div className="inspection-row-title"><h2>{row.title}</h2><span className={`result-status tone-${row.tone}`}>{row.status}</span></div>
    {row.message && <p className="inspection-error">{row.message}</p>}
    <details className="inspection-row-details"><summary aria-label={`Details for ${row.title}`}>Details</summary>
      <p className="result-note">ID <code>{row.id}</code></p><Facts facts={row.facts} />
    </details>
  </li>)}</ul>;
}
export default function InspectionApp({ kind }: { kind: InspectionKind }) {
  const state = useToolData();
  const model = models[kind];
  const result = state.data ? model(state.data, state.input) : null;
  return <ResultBoundary kind={kind} state={state}>
    {result && <ResultCard kind={kind} {...result} synthetic={state.data?._uiTestFixture === true}>
      <p className="result-note">Snapshot{state.receivedAt && <> received <time dateTime={state.receivedAt}>{new Date(state.receivedAt).toLocaleString()}</time></>}. Not live.</p>
      {result.rows.length > 0 && <Rows rows={result.rows.slice(0, 5)} />}
      {result.rows.length > 5 && <details className="result-details"><summary>Show {result.rows.length - 5} more in this page</summary><Rows rows={result.rows.slice(5)} /></details>}
      {result.more && <p className="result-note">More results are available beyond this page.</p>}
      {result.filters.length > 0 && <details className="result-details"><summary>Request filters</summary><Facts facts={result.filters} /></details>}
      {result.facts.length > 0 && <details className="result-details"><summary>Connection details</summary><Facts facts={result.facts} /></details>}
      <ResultContext id={result.id} executionId={result.executionId} toolName={state.toolName} receivedAt={state.receivedAt} />
    </ResultCard>}
  </ResultBoundary>;
}
