import React from 'react';
import '@shared/styles/theme.css';
import { useToolData } from '@shared/hooks/useToolData';
import { operationModel } from '@shared/operation-model';
import { ResultBoundary, ResultCard, ResultContext } from '@shared/components/ResultCard';
import { Facts } from '@shared/components/Facts';

export default function App() {
  const state = useToolData();
  const result = state.data ? operationModel(state.data, state.input, state.toolName) : null;
  return <ResultBoundary kind="Workflow operation" state={state}>
    {result && <ResultCard kind="Workflow operation" {...result} synthetic={state.data?._uiTestFixture === true}>
      {result.facts.length > 0 && <Facts facts={result.facts} />}
      {result.details.length > 0 && <details className="result-details"><summary>Operation details</summary>
        {result.details.map(detail => <div key={detail.title}><h2>{detail.title}</h2><pre className="result-json">{typeof detail.value === 'string' ? detail.value : JSON.stringify(detail.value, null, 2)}</pre></div>)}
      </details>}
      <ResultContext id={result.id} executionId={result.executionId} receivedAt={state.receivedAt} toolName={state.toolName} />
    </ResultCard>}
  </ResultBoundary>;
}
