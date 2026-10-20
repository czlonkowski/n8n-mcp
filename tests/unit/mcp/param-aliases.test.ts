import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  hasText,
  resolveGetNodeAliases,
  suggestExecutionsAction,
  withWorkflowIdAlias,
} from '../../../src/mcp/param-aliases';
import { logger } from '../../../src/utils/logger';

describe('resolveGetNodeAliases', () => {
  it('passes canonical values and undefined through unchanged', () => {
    expect(resolveGetNodeAliases(undefined, undefined)).toEqual({ mode: undefined, detail: undefined });
    expect(resolveGetNodeAliases('info', 'full')).toEqual({ mode: 'info', detail: 'full' });
    expect(resolveGetNodeAliases('search_properties', undefined)).toEqual({ mode: 'search_properties', detail: undefined });
    expect(resolveGetNodeAliases('versions', 'minimal')).toEqual({ mode: 'versions', detail: 'minimal' });
  });

  it('passes unknown values through so validation still names them', () => {
    expect(resolveGetNodeAliases('bogus', 'huge')).toEqual({ mode: 'bogus', detail: 'huge' });
  });

  it.each([
    ['essentials', 'info', 'standard'],
    ['minimal', 'info', 'minimal'],
    ['standard', 'info', 'standard'],
    ['full', 'info', 'full'],
    ['operations', 'info', 'standard'],
  ])('maps retired mode=%s to mode=%s with detail=%s', (mode, expectedMode, expectedDetail) => {
    expect(resolveGetNodeAliases(mode, undefined)).toEqual({ mode: expectedMode, detail: expectedDetail });
  });

  it.each(['properties', 'search'])('maps mode=%s to search_properties without touching detail', (mode) => {
    expect(resolveGetNodeAliases(mode, undefined)).toEqual({ mode: 'search_properties', detail: undefined });
    expect(resolveGetNodeAliases(mode, 'minimal')).toEqual({ mode: 'search_properties', detail: 'minimal' });
  });

  it.each([
    ['essentials', 'standard'],
    ['summary', 'minimal'],
    ['short', 'minimal'],
  ])('maps retired detail=%s to %s', (detail, expected) => {
    expect(resolveGetNodeAliases(undefined, detail)).toEqual({ mode: undefined, detail: expected });
    expect(resolveGetNodeAliases('info', detail)).toEqual({ mode: 'info', detail: expected });
  });

  it('lets a retired mode value decide the detail level over a supplied detail', () => {
    expect(resolveGetNodeAliases('full', 'standard')).toEqual({ mode: 'info', detail: 'full' });
    expect(resolveGetNodeAliases('essentials', 'full')).toEqual({ mode: 'info', detail: 'standard' });
  });

  it('is case-insensitive for alias lookup', () => {
    expect(resolveGetNodeAliases('Essentials', 'SUMMARY')).toEqual({ mode: 'info', detail: 'standard' });
  });

  it('passes non-string values through so validation rejects them instead of defaulting', () => {
    expect(resolveGetNodeAliases(42 as any, { a: 1 } as any)).toEqual({ mode: 42, detail: { a: 1 } });
  });

  it('logs at debug level when an alias was applied and stays silent otherwise', () => {
    vi.mocked(logger.debug).mockClear();
    resolveGetNodeAliases('info', 'standard');
    expect(logger.debug).not.toHaveBeenCalled();

    resolveGetNodeAliases('essentials', 'short');
    expect(logger.debug).toHaveBeenCalledTimes(1);
    const message = vi.mocked(logger.debug).mock.calls[0][0] as string;
    expect(message).toContain('detail=short→minimal');
    expect(message).toContain('mode=essentials→mode=info, detail=standard');
  });
});

describe('suggestExecutionsAction', () => {
  it('points list-shaped spellings at action=list', () => {
    expect(suggestExecutionsAction('get_many')).toBe("Did you mean action='list'?");
    expect(suggestExecutionsAction('getAll')).toBe("Did you mean action='list'?");
    expect(suggestExecutionsAction('list_executions')).toBe("Did you mean action='list'?");
  });

  it('names the owning tool for vocabulary that belongs elsewhere', () => {
    expect(suggestExecutionsAction('list_runs')).toContain('n8n_evaluations');
    expect(suggestExecutionsAction('getRows')).toContain('n8n_manage_datatable');
  });

  it('returns undefined for an unrecognised value', () => {
    expect(suggestExecutionsAction('frobnicate')).toBeUndefined();
  });
});

describe('withWorkflowIdAlias', () => {
  it('fills workflowId from id when the canonical key is absent', () => {
    expect(withWorkflowIdAlias({ id: 'wf-1' })).toEqual({ id: 'wf-1', workflowId: 'wf-1' });
    expect(withWorkflowIdAlias({ id: 'wf-1', workflowId: '' })).toEqual({ id: 'wf-1', workflowId: 'wf-1' });
  });

  it('keeps an explicit workflowId even when id is also present', () => {
    expect(withWorkflowIdAlias({ id: 'other', workflowId: 'wf-1' })).toEqual({ id: 'other', workflowId: 'wf-1' });
  });

  it('leaves a non-string workflowId for validation instead of overwriting it', () => {
    expect(withWorkflowIdAlias({ workflowId: 123, id: 'wf-1' })).toEqual({ workflowId: 123, id: 'wf-1' });
  });

  it('treats a blank workflowId as absent', () => {
    expect(withWorkflowIdAlias({ id: 'wf-1', workflowId: '   ' })).toEqual({ id: 'wf-1', workflowId: 'wf-1' });
  });

  it('accepts a numeric id, which the schema-driven coercion never sees', () => {
    expect(withWorkflowIdAlias({ id: 12345 })).toEqual({ id: 12345, workflowId: '12345' });
  });

  it('returns the same object when there is nothing to alias', () => {
    const args = { mode: 'list' };
    expect(withWorkflowIdAlias(args)).toBe(args);
    expect(withWorkflowIdAlias({ id: '   ' })).toEqual({ id: '   ' });
    expect(withWorkflowIdAlias({ id: true })).toEqual({ id: true });
  });

  it('drops a blank workflowId when no usable id replaces it', () => {
    expect(withWorkflowIdAlias({ workflowId: '   ' })).toEqual({ workflowId: undefined });
    expect(withWorkflowIdAlias({ workflowId: '', id: ' ' })).toEqual({ workflowId: undefined, id: ' ' });
  });

  it('does not mutate the input', () => {
    const args = { id: 'wf-1' };
    withWorkflowIdAlias(args);
    expect(args).toEqual({ id: 'wf-1' });
  });
});

describe('hasText', () => {
  it('is true only for a string with content once trimmed', () => {
    expect(hasText('wf-1')).toBe(true);
    expect(hasText(' x ')).toBe(true);
    expect(hasText('')).toBe(false);
    expect(hasText('   ')).toBe(false);
    expect(hasText(undefined)).toBe(false);
    expect(hasText(null)).toBe(false);
    expect(hasText(42)).toBe(false);
  });
});
