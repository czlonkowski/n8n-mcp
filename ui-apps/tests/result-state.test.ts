import { describe, it, expect } from 'vitest';
import { decodeResult, initialResultState, reduceResult, count, object, text, type ResultEvent } from '../src/shared/result-state';
const result = { content: [{ type: 'text', text: '{"valid":true}' }] };
describe('MCP result boundary', () => {
  it('retains response identity when the tool returns an error', () => {
    const state = reduceResult(initialResultState, { type: 'result', result: {
      isError: true, _meta: { 'n8n-mcp/toolName': 'n8n_executions' },
      content: [{ type: 'text', text: 'Invalid execution input' }],
    }, receivedAt: '2026-09-13T12:00:00Z' });
    expect(state.phase).toBe('error');
    expect(state.toolName).toBe('n8n_executions');
    expect(state.data).toBeNull();
  });
  it('accepts the actual outcome after a recoverable host diagnostic', () => {
    const pending = reduceResult(initialResultState, { type: 'input', input: {} });
    const warned = reduceResult(pending, { type: 'host-warning', error: 'Unknown progress token' });
    expect(warned.phase).toBe('pending');
    expect(warned.error).toBeNull();
    expect(warned.hostWarning).toBe('Unknown progress token');
    const ready = reduceResult(warned, { type: 'result', result: { ...result, _meta: { 'n8n-mcp/toolName': 'validate_workflow' } }, receivedAt: '2026-09-13T12:00:00Z' });
    expect(ready.phase).toBe('ready');
    expect(ready.hostWarning).toBeNull();
    expect(ready.toolName).toBe('validate_workflow');
    expect(reduceResult(ready, { type: 'host-warning', error: 'Late diagnostic' })).toBe(ready);
    const next = reduceResult(ready, { type: 'input', input: {} });
    expect(next.toolName).toBeNull();
    expect(next.hostWarning).toBeNull();
  });
  it('keeps every terminal snapshot immutable until new input', () => {
    const events: ResultEvent[] = [{ type: 'cancel' }, { type: 'error', error: 'Disconnected' }, { type: 'result', result, receivedAt: '2026-09-12T12:00:00Z' }];
    for (const first of events) {
      const terminal = reduceResult(initialResultState, first);
      for (const late of events) expect(reduceResult(terminal, late)).toBe(terminal);
      expect(reduceResult(terminal, { type: 'input', input: {} }).phase).toBe('pending');
    }
  });
  it('prefers structured data and can find JSON after explanatory text', () => {
    expect(decodeResult({ ...result, structuredContent: { valid: false } })).toEqual({ valid: false });
    expect(decodeResult({ content: [{ type: 'text', text: 'Report follows' }, ...result.content] })).toEqual({ valid: true });
  });
  it('does not turn tool errors or malformed payloads into successful checks', () => {
    expect(() => decodeResult({ ...result, isError: true })).toThrow();
    for (const value of [null, [], 'text', 1]) expect(() => decodeResult({ structuredContent: value })).toThrow();
    for (const value of ['{truncated', 'null', '[]', 'true']) expect(() => decodeResult({ content: [{ type: 'text', text: value }] })).toThrow();
    expect(() => decodeResult({})).toThrow();
    expect(() => decodeResult({ isError: true })).toThrow('could not complete');
  });
  it('ignores late results after cancellation and duplicate terminal results', () => {
    const cancelled = reduceResult(initialResultState, { type: 'cancel' });
    const delivered = { type: 'result' as const, result, receivedAt: '2026-09-12T12:00:00Z' };
    expect(reduceResult(cancelled, delivered)).toEqual(cancelled);
    const complete = reduceResult(initialResultState, delivered);
    expect(complete.phase).toBe('ready');
    expect(reduceResult(complete, { ...delivered, result: {} })).toEqual(complete);
    const next = reduceResult(complete, { type: 'input', input: { id: 'different-workflow' } });
    expect(next.data).toBeNull(); expect(next.receivedAt).toBeNull();
    expect(next.input?.id).toBe('different-workflow');
    expect(reduceResult(next, { ...delivered, result: {} }).phase).toBe('error');
  });
  it('records connection failures and rejects invalid primitive values', () => {
    expect(reduceResult(initialResultState, { type: 'error', error: 'Disconnected' }).error).toBe('Disconnected');
    expect(reduceResult(initialResultState, { type: 'input', input: [] }).input).toBeNull();
    expect(count(-1)).toBeUndefined(); expect(count(NaN)).toBeUndefined();
    expect(object([])).toBeUndefined(); expect(text(' ')).toBeUndefined();
  });
});
