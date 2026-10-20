import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ResultCard } from '../src/shared/components/ResultCard';

const card = <ResultCard kind="Workflows" title="6 workflows returned" subject="Workflow details"><p>Optional content</p></ResultCard>;
function host(state?: unknown, setter = vi.fn()) {
  const value = { widgetState: state, setWidgetState: setter };
  Object.defineProperty(window, 'openai', { configurable: true, value });
  return value;
}
function notify(state: unknown) {
  act(() => window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: state } } })));
}
afterEach(() => { Reflect.deleteProperty(window, 'openai'); });

describe('card expansion', () => {
  it('starts collapsed without host persistence and toggles locally', () => {
    render(card);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('6 workflows returned');
    const button = screen.getByRole('button', { expanded: false });
    expect(screen.getByRole('button', { name: 'n8n-mcp Workflows 6 returned' })).toBe(button);
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByRole('heading').textContent).toBe('Workflow details');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByRole('heading')).toBeNull();
  });
  it.each([undefined, null, [], { expanded: true }, { privateContent: { n8nMcpCard: { expanded: 'true' } } }])('ignores unrelated or malformed persisted state %j', state => {
    const api = host(state);
    render(card);
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(api.setWidgetState).not.toHaveBeenCalled();
  });
  it('restores this widget and writes UI-only state without losing other host fields', () => {
    const api = host({ modelContent: 'Preserve model content', imageIds: ['image-1'], privateContent: { filter: 'active', n8nMcpCard: { expanded: true } } });
    render(card);
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(api.setWidgetState).toHaveBeenCalledExactlyOnceWith({ modelContent: 'Preserve model content', imageIds: ['image-1'], privateContent: { filter: 'active', n8nMcpCard: { expanded: false } } });
  });
  it('restores late host state, ignores unrelated globals, and removes its listener', () => {
    host();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(card);
    notify({ privateContent: { n8nMcpCard: { expanded: true } } });
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    act(() => window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { theme: 'dark' } } })));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    notify(null);
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    unmount();
    expect(remove).toHaveBeenCalledWith('openai:set_globals', expect.any(Function));
    remove.mockRestore();
  });
  it('keeps each new widget collapsed even after another widget was expanded', () => {
    const api = host(undefined, vi.fn(next => { api.widgetState = next; }));
    const first = render(card);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    first.unmount();
    const restored = render(card);
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    restored.unmount();
    host();
    render(card);
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
  });
  it('keeps local expansion working when optional persistence throws', () => {
    host(undefined, vi.fn(() => { throw new Error('Host unavailable'); }));
    render(card);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });
  it('does not let late hydration overwrite a user toggle', () => {
    host();
    render(card);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    notify({ privateContent: { n8nMcpCard: { expanded: false } } });
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });
  it('applies sequential toggles even before React flushes a render', () => {
    const api = host();
    render(card);
    const button = screen.getByRole('button');
    act(() => { button.click(); button.click(); });
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(api.setWidgetState.mock.calls.map(([state]) => state.privateContent.n8nMcpCard.expanded)).toEqual([true, false]);
  });
  it('tolerates a host that blocks access to its extension', () => {
    Object.defineProperty(window, 'openai', { configurable: true, get: () => { throw new Error('Blocked'); } });
    render(card);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
  });
  it('uses visible words as the button name and the full outcome as its description', () => {
    render(<ResultCard kind="Workflow operation" title="Template saved · setup needs review" synthetic />);
    const button = screen.getByRole('button', { name: 'n8n-mcp Test Workflow Saved · setup needed' });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Template saved · setup needs review');
    expect(screen.getByRole('status').closest('button')).toBeNull();
  });
});
