import { describe, it, expect } from 'vitest';
import { workflowListModel, executionModel, healthModel, dateLabel, durationLabel, executionStatus } from '../src/shared/inspection-models';
import { operationModel } from '../src/shared/operation-model';
import fixtures from '../src/lab/host-fixtures.json';
import type { JsonObject } from '../src/shared/result-state';
const sample = (id: string) => fixtures.find(f => f.id === id)!;
const model = (id: string) => {
  const f = sample(id);
  return f.app === 'workflow-list' ? workflowListModel(f.data, f.input) : f.app === 'execution-history' ? executionModel(f.data, f.input) : healthModel(f.data, f.input);
};
describe('inspection response contracts', () => {
  it('preserves workflow tags, page cursor and false-valued request options', () => {
    const input = { active:false, tags:['Demo', 'Sales, Europe'], projectId:'demo-project', limit:6, cursor:'demo-next', excludePinnedData:false };
    const filters = workflowListModel(sample('workflow-page').data, { ...input, name:'not-a-public-filter' }).filters;
    expect(Object.fromEntries(filters.map(f => [f.label, f.value]))).toEqual({ ...input, active:'false', tags:JSON.stringify(input.tags), limit:'6', excludePinnedData:'false' });
    for (const tags of [[], [''], ['Demo', 4], {name:'Demo'}]) {
      expect(workflowListModel(sample('workflow-empty').data, {tags}).filters).toEqual([]);
    }
  });
  it('preserves execution pagination and detail selection in request filters', () => {
    const list = executionModel(sample('execution-page').data, {action:'list', cursor:'demo-next', includeData:false});
    expect(list.filters).toEqual([{label:'cursor',value:'demo-next'},{label:'includeData',value:'false'}]);
    const detail = executionModel(sample('execution-detail').data, {action:'get', id:'demo-ex-0', mode:'filtered', nodeNames:['Demo service'], itemsLimit:0, includeInputData:false});
    expect(detail.filters).toEqual([{label:'mode',value:'filtered'},{label:'nodeNames',value:'["Demo service"]'},{label:'itemsLimit',value:'0'},{label:'includeInputData',value:'false'}]);
  });
  it.each([
    ['workflow-page', '6 workflows returned'], ['workflow-empty', 'No matching workflows'], ['workflow-error', 'Request could not complete'],
    ['execution-page', '6 executions returned'], ['execution-empty', 'No matching executions'], ['execution-detail', 'Failed'],
    ['execution-deleted', 'Execution deleted'], ['execution-error', 'Request could not complete'],
    ['health-connected', 'Connection verified'], ['health-unconfigured', 'n8n API not configured'], ['health-diagnostic', 'Connection verified'], ['health-error', 'Request could not complete'],
  ])('%s renders an evidenced outcome', (id, title) => expect(model(id).title).toBe(title));
  it('preserves page scope, archived and unknown activation, failures and unknown execution statuses', () => {
    const w = model('workflow-page');
    expect(w.more).toBe(true); expect(w.rows[3].status).toBe('Archived'); expect(w.rows[4].status).toBe('Activation unknown');
    expect(w.rows[0].status).toBe('Active'); expect(w.rows[1].status).toBe('Inactive');
    const e = model('execution-page');
    expect(e.summary).toContain('1 failed in this returned page'); expect(e.more).toBe(true);
    expect(e.rows[5].status).toContain('Unknown status'); expect(model('execution-detail').rows[0].message).toContain('503');
  });
  it('fails closed for malformed collections instead of inventing empty results', () => {
    for (const value of [null, {}, 'truncated', [null], [{}], [{id:'x'}]]) {
      expect(workflowListModel({ success:true, data:{ workflows:value } }, null).title).toBe('Result unavailable');
    }
    for (const value of [null, {}, 'truncated', [null], [{}]]) expect(executionModel({success:true,data:{executions:value}},null).title).toBe('Result unavailable');
    expect(workflowListModel({success:true,data:{workflows:[{id:'x',name:'One',tags:[{name:'Tag'},4],updatedAt:'broken'}],returned:400}}, {active:false}).title).toBe('1 workflow returned');
    expect(workflowListModel({success:true,data:{workflows:[{id:'x',name:'One'}]}}, null).more).toBe(false);
  });
  it('rejects cross-action execution payloads and never renders a get/delete result as an empty list', () => {
    const ids = ['execution-page', 'execution-detail', 'execution-deleted'];
    for (const a of ids) for (const b of ids) if (a !== b) expect(executionModel(sample(a).data,sample(b).input).title).toBe('Result unavailable');
    expect(executionModel(sample('execution-page').data,{action:'get',id:' '}).title).toBe('6 executions returned');
    expect(executionModel({success:true,message:'done'}, {action:'delete',id:'x'}).title).toBe('Result unavailable');
    expect(executionModel(sample('execution-detail').data,{action:'get',id:'wrong'}).title).toBe('Result unavailable');
    expect(executionModel(sample('execution-page').data,{action:'other'}).title).toBe('Result unavailable');
  });
  it('does not infer execution success from finished, mode, or absent status', () => {
    const m = executionModel({success:true,data:{id:'x',finished:true,mode:'manual',workflowData:{name:'Full name'},data:{resultData:{error:{message:'Node failed'}}}}},{action:'get',id:'x'});
    expect(m.title).toBe('Status not reported'); expect(m.rows[0].title).toBe('Full name'); expect(m.rows[0].message).toBe('Node failed');
    expect(executionModel({success:true,data:{executions:[{id:'x',workflowId:'w'}]}},null).rows[0].title).toBe('Workflow w');
    expect(executionModel({success:true,data:{executions:[{id:'x'}]}},null).rows[0].title).toBe('Execution x');
    for (const s of ['failed','crashed']) expect(executionStatus(s).tone).toBe('error');
    expect(executionStatus('cancelled').status).toBe('Cancelled'); expect(executionStatus('new').status).toContain('Queued');
  });
  it('requires connection evidence, handles diagnostics independently and hides raw environment data', () => {
    for (const raw of [{}, {success:true}, {success:true,data:{}}, {success:true,data:{apiConfiguration:{configured:true}}}]) expect(healthModel(raw,null).title).toBe('Result unavailable');
    expect(healthModel(sample('health-connected').data,{mode:'diagnostic'}).title).toBe('Result unavailable');
    expect(healthModel(sample('health-diagnostic').data,{mode:'status'}).title).toBe('Result unavailable');
    expect(healthModel(sample('health-connected').data,{mode:'other'}).title).toBe('Result unavailable');
    expect(healthModel({success:true,data:{status:'offline'}},null).title).toBe('Connection not confirmed');
    const d = {success:true,data:{apiConfiguration:{configured:true,status:{connected:false,error:'Synthetic refusal'}},environment:{secret:'never-show'}}};
    expect(healthModel(d,{mode:'diagnostic'}).summary).toBe('Synthetic refusal');
    expect(JSON.stringify(healthModel(d,{mode:'diagnostic'}))).not.toContain('never-show');
  });
  it('normalizes metrics and strips URL credentials, paths and queries from endpoint evidence', () => {
    expect(model('health-connected').facts.find(f=>f.label==='Cache hit rate')?.value).toBe('80.00%');
    expect(model('health-unconfigured').facts.some(f=>f.label==='Cache hit rate')).toBe(false);
    expect(model('health-diagnostic').facts.find(f=>f.label==='MCP update available')?.value).toBe('2.84.4 → 2.85.0');
    const endpointWithCredentials = new URL('https://example.test/private?token=secret');
    endpointWithCredentials.username = 'user';
    endpointWithCredentials.password = 'pass';
    for (const rate of [0.8,80,'80.00%','N/A',Infinity,-1,200]) {
      const m = healthModel({success:true,data:{status:'connected',apiUrl:endpointWithCredentials.href,performance:{cacheHitRate:rate}}},null);
      expect(m.facts.find(f=>f.label==='Endpoint')?.value).toBe('https://example.test');
      expect(JSON.stringify(m)).not.toMatch(/secret|pass|private/);
    }
    expect(healthModel({success:true,data:{status:'ok',apiUrl:'javascript:alert(1)'}},null).facts).toEqual([]);
    expect(healthModel({success:true,data:{status:'ok',apiUrl:'bad'}},null).facts).toEqual([]);
  });
  it('handles failure envelopes without making optimistic claims', () => {
    for (const fn of [workflowListModel,executionModel,healthModel]) {
      expect(fn({success:false},null).summary).toBe('The tool reported an error.');
      expect(fn({success:false,message:'Denied'},null).summary).toBe('Denied');
      expect(fn({success:true},null).title).toBe('Result unavailable');
    }
  });
  it('keeps absent, invalid and negative dates distinct from real durations', () => {
    expect(dateLabel('bad')).toBe('Unavailable'); expect(dateLabel(null)).toBe('Unavailable');
    expect(durationLabel(null,null)).toBe('Not reported'); expect(durationLabel('bad','bad')).toBe('Unavailable');
    const a = '2026-09-13T10:00:00Z';
    expect(durationLabel(a,'2026-09-13T09:00:00Z')).toBe('Unavailable');
    expect(durationLabel(a,'2026-09-13T10:00:00.200Z')).toBe('200 ms');
    expect(durationLabel(a,'2026-09-13T10:02:10Z')).toBe('2 min 10 s');
  });
});
describe('template deployment evidence', () => {
  it.each([['template-saved','Template saved'],['template-setup','Template saved · setup needs review'],['template-error','Operation could not complete']])('%s preserves saved versus ready', (id,title) => {
    const f=sample(id); const m=operationModel(f.data as JsonObject,f.input,f.tool);
    expect(m.title).toBe(title);
    if(id !== 'template-error') expect(m.summary).toContain('Execution has not been verified');
  });
  it('requires returned workflow/template identity and keeps post-save failures explicit', () => {
    expect(operationModel({success:true,data:{}},{templateId:1},'n8n_deploy_template').title).toBe('Outcome unavailable');
    const f=sample('template-setup'); const m=operationModel(f.data,f.input,f.tool);
    expect(m.facts.find(f=>f.label==='Automatic fixes')?.value).toContain('after the workflow was saved');
    expect(m.details.map(d=>d.title)).toContain('Credential setup');
  });
});
