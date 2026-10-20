import { count, object, text, type JsonObject } from './result-state';
import type { Tone } from './operation-model';
export type InspectionKind = 'Workflows' | 'Executions' | 'Connection';
export interface Fact { label: string; value: string }
export interface InspectionRow { id: string; title: string; status: string; tone: Tone; facts: Fact[]; message?: string }
export interface InspectionModel {
  title: string; summary: string; tone: Tone; rows: InspectionRow[]; facts: Fact[]; filters: Fact[];
  more: boolean; id?: string; executionId?: string;
}
const base = (): InspectionModel => ({ title: 'Result unavailable', summary: 'The returned data does not match this request.', tone: 'neutral', rows: [], facts: [], filters: [], more: false });
const fact = (label: string, value: unknown): Fact[] => text(value) ? [{ label, value: text(value)! }] : [];
const numberFact = (label: string, value: unknown): Fact[] => count(value) === undefined ? [] : [{ label, value: String(value) }];
function failure(raw: JsonObject, model: InspectionModel): boolean {
  if (raw.success === false) { model.title = 'Request could not complete'; model.summary = text(raw.error) ?? text(raw.message) ?? 'The tool reported an error.'; model.tone = 'error'; }
  return raw.success !== true;
}
export function dateLabel(value: unknown): string {
  const s = text(value);
  if (!s || !Number.isFinite(new Date(s).getTime())) return 'Unavailable';
  return new Date(s).toLocaleString();
}
export function durationLabel(start: unknown, end: unknown): string {
  const a = text(start), b = text(end);
  if (!a || !b) return 'Not reported';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'Unavailable';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.floor(ms % 60000 / 1000)} s`;
}
function filters(input: JsonObject | null, names: string[]): Fact[] {
  return names.flatMap(name => {
    const value = input?.[name];
    if (Array.isArray(value)) {
      return value.length && value.every(item => text(item)) ? [{ label: name, value: JSON.stringify(value) }] : [];
    }
    return typeof value === 'boolean' || typeof value === 'number' || text(value) ? [{ label: name, value: String(value) }] : [];
  });
}
function records(value: unknown): JsonObject[] | null {
  if (!Array.isArray(value) || value.some(row => !object(row) || !text(object(row)?.id))) return null;
  return value as JsonObject[];
}
export function workflowListModel(raw: JsonObject, input: JsonObject | null): InspectionModel {
  const m = base();
  m.filters = filters(input, ['active', 'tags', 'projectId', 'limit', 'cursor', 'excludePinnedData']);
  if (failure(raw, m)) return m;
  const d = object(raw.data), rows = records(d?.workflows);
  if (!rows || rows.some(row => !text(row.name))) return m;
  m.title = rows.length ? `${rows.length} workflow${rows.length === 1 ? '' : 's'} returned` : 'No matching workflows';
  m.summary = rows.length ? 'Workflows in this returned page. Activation is shown separately from execution results.' : 'This request returned no workflows. Other filters or pages may contain results.';
  m.more = d?.hasMore === true || Boolean(text(d?.nextCursor));
  m.rows = rows.map(row => ({
    id: String(row.id), title: String(row.name),
    status: row.isArchived === true ? 'Archived' : row.active === true ? 'Active' : row.active === false ? 'Inactive' : 'Activation unknown',
    tone: 'neutral', facts: [
      ...numberFact('Nodes', row.nodeCount),
      ...fact('Updated', row.updatedAt ? dateLabel(row.updatedAt) : undefined),
      ...fact('Tags', Array.isArray(row.tags) ? row.tags.map(tag => text(tag) ?? text(object(tag)?.name)).filter(Boolean).join(', ') : undefined),
    ],
  }));
  return m;
}
export function executionStatus(value: unknown): { status: string; tone: Tone } {
  const s = text(value);
  if (s === 'success') return { status: 'Succeeded', tone: 'success' };
  if (['error', 'failed', 'crashed'].includes(s ?? '')) return { status: 'Failed', tone: 'error' };
  if (s === 'canceled' || s === 'cancelled') return { status: 'Cancelled', tone: 'neutral' };
  if (s === 'running' || s === 'new') return { status: s === 'new' ? 'Queued at check time' : 'Running at check time', tone: 'neutral' };
  if (s === 'waiting') return { status: 'Waiting at check time', tone: 'warning' };
  return { status: s ? `Unknown status: ${s}` : 'Status not reported', tone: 'neutral' };
}
function executionRow(d: JsonObject): InspectionRow {
  const resultData = object(object(d.data)?.resultData);
  const errorInfo = object(d.errorInfo);
  const primary = object(errorInfo?.primaryError);
  const err = object(resultData?.error);
  return {
    id: String(d.id), title: text(d.workflowName) ?? text(object(d.workflowData)?.name) ?? (text(d.workflowId) ? `Workflow ${d.workflowId}` : `Execution ${d.id}`),
    ...executionStatus(d.status),
    facts: [ ...fact('Workflow ID', d.workflowId), { label: 'Started', value: dateLabel(d.startedAt) },
      { label: 'Duration', value: durationLabel(d.startedAt, d.stoppedAt) }, ...fact('Mode', d.mode) ],
    message: text(primary?.message) ?? text(err?.message) ?? text(d.error),
  };
}
export function executionModel(raw: JsonObject, input: JsonObject | null): InspectionModel {
  const m = base();
  m.filters = filters(input, ['workflowId', 'projectId', 'status', 'limit', 'cursor', 'includeData', 'mode', 'nodeNames', 'itemsLimit', 'includeInputData', 'errorItemsLimit', 'includeStackTrace', 'includeExecutionPath', 'fetchWorkflow']);
  if (failure(raw, m)) return m;
  // The server intentionally treats get without an ID as list.
  const action = input?.action === 'get' && !text(input.id) ? 'list' : text(input?.action) ?? 'list';
  const d = object(raw.data);
  if (action === 'delete') {
    const id = text(input?.id);
    if (!id || d || raw.message !== `Execution ${id} deleted successfully`) return m;
    return { ...m, title: 'Execution deleted', summary: 'The execution record was removed. The workflow itself was not deleted.', executionId: id };
  }
  if (action === 'get') {
    if (!d || !text(d.id) || Array.isArray(d.executions) || d.id !== input?.id) return m;
    const row = executionRow(d);
    return { ...m, title: row.status, summary: 'Execution result at the time of this call. This card does not refresh automatically.', tone: row.tone,
      rows: [row], id: text(d.workflowId), executionId: text(d.id) };
  }
  if (action !== 'list') return m;
  const rows = records(d?.executions);
  if (!rows) return m;
  const failed = rows.filter(row => executionStatus(row.status).tone === 'error').length;
  m.title = rows.length ? `${rows.length} execution${rows.length === 1 ? '' : 's'} returned` : 'No matching executions';
  m.summary = rows.length ? `${failed} failed in this returned page. This is a snapshot, not a live monitor.` : 'No executions matched this request. This does not establish that the workflow has never run.';
  m.tone = failed ? 'warning' : 'neutral';
  m.rows = rows.map(executionRow);
  m.more = d?.hasMore === true || Boolean(text(d?.nextCursor));
  return m;
}
function endpoint(value: unknown): string | undefined {
  try { const url = new URL(text(value) ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined; } catch { return undefined; }
}
export function healthModel(raw: JsonObject, input: JsonObject | null): InspectionModel {
  const m = base();
  if (failure(raw, m)) return m;
  const d = object(raw.data);
  if (!d) return m;
  const mode = text(input?.mode) ?? 'status';
  let version: JsonObject | undefined;
  if (mode === 'diagnostic') {
    const config = object(d.apiConfiguration), status = object(config?.status);
    if (typeof config?.configured !== 'boolean' || (config.configured && typeof status?.connected !== 'boolean')) return m;
    m.title = !config.configured ? 'n8n API not configured' : status?.connected ? 'Connection verified' : 'Connection failed';
    m.summary = !config.configured ? 'Offline documentation and validation remain available. Live workflow management needs an n8n connection.' : status?.connected ? 'The diagnostic API probe succeeded at check time.' : text(status?.error) ?? 'The diagnostic API probe could not connect.';
    m.tone = !config.configured ? 'neutral' : status?.connected ? 'success' : 'error';
    m.facts.push(...fact('Endpoint', endpoint(object(config.config)?.baseUrl)));
    version = object(d.versionInfo);
  } else if (mode === 'status') {
    if (!text(d.status) || object(d.apiConfiguration)) return m;
    const connected = d.status === 'ok' || d.status === 'connected';
    m.title = connected ? 'Connection verified' : 'Connection not confirmed';
    m.summary = connected ? 'The n8n API health check succeeded at check time. This is not continuous monitoring.' : `The health check reported: ${d.status}.`;
    m.tone = connected ? 'success' : 'warning';
    m.facts.push(...fact('Endpoint', endpoint(d.apiUrl)), ...fact('n8n version', d.n8nVersion));
    version = object(d.versionCheck);
  } else return m;
  m.facts.push(...fact('MCP version', d.mcpVersion ?? version?.current));
  if (version?.upToDate === false && text(version.current) && text(version.latest)) m.facts.push({ label: 'MCP update available', value: `${version.current} → ${version.latest}` });
  const perf = object(d.performance);
  const ms = count(perf?.responseTimeMs ?? perf?.diagnosticResponseTimeMs);
  if (ms !== undefined) m.facts.push({ label: 'Check duration', value: `${ms} ms` });
  const rate = perf?.cacheHitRate;
  if (typeof rate === 'string' && /^(100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/.test(rate)) m.facts.push({ label: 'Cache hit rate', value: rate });
  else if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 100) m.facts.push({ label: 'Cache hit rate', value: `${rate <= 1 ? Math.round(rate * 100) : rate}%` });
  return m;
}
