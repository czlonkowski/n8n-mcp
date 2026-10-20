export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
export function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export interface ToolResult { structuredContent?: unknown; content?: unknown; isError?: boolean; _meta?: Record<string, unknown> }
export type ResultPhase = 'waiting' | 'pending' | 'ready' | 'error' | 'cancelled';
export interface ResultState {
  phase: ResultPhase;
  data: JsonObject | null;
  input: JsonObject | null;
  error: string | null;
  hostWarning: string | null;
  toolName: string | null;
  receivedAt: string | null;
}
export const initialResultState: ResultState = {
  phase: 'waiting', data: null, input: null, error: null, hostWarning: null, toolName: null, receivedAt: null,
};
export function decodeResult(result: ToolResult): JsonObject {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const texts = blocks.map(object).filter(b => b?.type === 'text').map(b => text(b?.text)).filter(Boolean);
  if (result.isError) throw new Error(texts.join('\n') || 'The tool could not complete this request.');
  if (result.structuredContent !== undefined) {
    const data = object(result.structuredContent);
    if (!data) throw new Error('The tool returned an unsupported structured result.');
    return data;
  }
  for (const value of texts) {
    try {
      const data = object(JSON.parse(value!));
      if (data) return data;
    } catch { /* A later text block may contain JSON. */ }
  }
  throw new Error('The tool result could not be displayed. It may be incomplete or in an unsupported format.');
}
export type ResultEvent =
  | { type: 'input'; input: unknown }
  | { type: 'result'; result: ToolResult; receivedAt: string }
  | { type: 'cancel'; reason?: string }
  | { type: 'host-warning'; error: string }
  | { type: 'error'; error: string };
/** A new input explicitly starts an invocation; terminal results are snapshots. */
export function reduceResult(state: ResultState, event: ResultEvent): ResultState {
  if (event.type === 'input') return { ...initialResultState, phase: 'pending', input: object(event.input) ?? null };
  if (['cancelled', 'ready', 'error'].includes(state.phase)) return state;
  if (event.type === 'host-warning') return { ...state, hostWarning: event.error };
  if (event.type === 'cancel') return { ...state, phase: 'cancelled', data: null, error: event.reason ?? null };
  if (event.type === 'error') return { ...state, phase: 'error', data: null, error: event.error };
  const toolName = text(event.result._meta?.['n8n-mcp/toolName']) ?? null;
  try {
    return { ...state, phase: 'ready', data: decodeResult(event.result), error: null, hostWarning: null,
      toolName, receivedAt: event.receivedAt };
  } catch (error) {
    return { ...state, phase: 'error', data: null, toolName, error: error instanceof Error ? error.message : 'Result unavailable', receivedAt: event.receivedAt };
  }
}
