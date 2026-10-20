import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Validation from '../src/apps/validation-summary/App';
import Operation from '../src/apps/operation-result/App';
import InspectionApp from '../src/shared/components/InspectionApp';
import { decodeResult } from '../src/shared/result-state';
import { scenarios } from '../src/lab/fixtures';
const { mockState } = vi.hoisted(() => ({ mockState: { value: {} as Record<string, unknown> } }));
vi.mock('../src/shared/hooks/useToolData', () => ({ useToolData: () => mockState.value }));
function fixture(id: string) {
  const s = scenarios.find(s => s.id === id)!;
  mockState.value = { phase: 'ready', error: null, data: decodeResult(s.result!), input: s.input, toolName: s.tool, receivedAt: '2026-09-12T12:00:00Z', isConnected: true, standalone: false };
}
describe('agent supervision cards', () => {
  it('keeps details optional and never requires a user repair handoff', () => {
    fixture('invalid'); render(<Validation />);
    expect(screen.getByRole('status').textContent).toBe('3 validation errors found');
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByText(/copy request|review repair|needs your attention/i)).toBeNull();
    const disclosure = screen.getByText('Validation details');
    expect(disclosure.closest('details')?.open).toBe(false);
    fireEvent.click(disclosure);
    fireEvent.click(screen.getByRole('button', { name: 'Warnings · 2' }));
    expect(screen.queryByText('Request URL is missing')).toBeNull();
    expect(screen.getByText('No error handling configured')).toBeTruthy();
  });
  it('escapes tool-provided text and exposes complete workflow identity', () => {
    fixture('created'); mockState.value.data = { success: true, data: { id: 'full-workflow-id', name: '<img src=x onerror=alert(1)>' } };
    const { container } = render(<Operation />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('<img');
    expect(container.querySelector('img')).toBeNull(); expect(screen.getByText('full-workflow-id')).toBeTruthy();
  });
  it('renders API failures without a contradictory validation pass', () => {
    fixture('api-error'); render(<Validation />);
    expect(screen.getByRole('status').textContent).toBe('Validation unavailable');
    expect(screen.queryByText(/all checks passed|no validation errors found/i)).toBeNull();
    expect(screen.getByText('Result context').closest('details')?.open).toBe(false);
    expect(screen.getByText('n8n_validate_workflow')).toBeTruthy();
    expect(document.querySelector('time')?.dateTime).toBe('2026-09-12T12:00:00Z');
  });
  it('preserves result context when the validation verdict is malformed', () => {
    fixture('valid'); mockState.value.data = { success: true, data: { valid: 'unknown' } };
    render(<Validation />);
    expect(screen.getByRole('status').textContent).toBe('Validation unavailable');
    expect(screen.getByText('No validation verdict was returned.')).toBeTruthy();
    expect(screen.getByText('Result context')).toBeTruthy();
    expect(document.querySelector('time')?.dateTime).toBe('2026-09-12T12:00:00Z');
  });
  it.each([
    ['Workflows', 'n8n_list_workflows', { workflows: [null] }],
    ['Workflows', 'n8n_list_workflows', { workflows: [{ id: 'x' }] }],
    ['Executions', 'n8n_executions', { executions: 'truncated' }],
    ['Executions', 'n8n_executions', { executions: [{}] }],
    ['Connection', 'n8n_health_check', {}],
  ] as const)('renders malformed %s data as an unavailable card with context', (kind, toolName, data) => {
    fixture('valid'); Object.assign(mockState.value, { data: { success: true, data }, input: null, toolName });
    render(<InspectionApp kind={kind} />);
    expect(screen.getByRole('status').textContent).toBe('Result unavailable');
    expect(screen.getByText('The returned data does not match this request.')).toBeTruthy();
    expect(screen.getByText(toolName)).toBeTruthy();
    expect(document.querySelector('time')?.dateTime).toBe('2026-09-12T12:00:00Z');
  });
  it('preserves a completed card after the host disconnects', () => {
    fixture('created'); Object.assign(mockState.value, { isConnected: false, error: 'Late disconnect' }); render(<Operation />);
    expect(screen.getByRole('status').textContent).toBe('Workflow created');
  });
  it('keeps manual expansion across pending-to-result without host persistence', () => {
    fixture('valid'); mockState.value.phase = 'pending'; mockState.value.data = null;
    const view = render(<Validation />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fixture('valid'); view.rerender(<Validation />);
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    expect(screen.getByRole('heading')).toBeTruthy();
    expect(view.container.querySelectorAll('.result-card')).toHaveLength(1);
    expect(screen.getByRole('status').closest('button')).toBeNull();
  });
  it.each([
    [{ phase: 'cancelled', error: 'Cancelled' }, 'Tool call cancelled'],
    [{ phase: 'pending' }, 'Tool call in progress'],
    [{ phase: 'waiting' }, 'Waiting for a tool result'],
    [{ phase: 'waiting', isConnected: false }, 'Connecting to host'],
    [{ phase: 'error', error: 'Cannot connect' }, 'Result unavailable'],
    [{ standalone: true }, 'Open in an MCP Apps host'],
  ])('renders lifecycle state %o', (override, title) => {
    fixture('valid'); Object.assign(mockState.value, override); render(<Validation />);
    expect(screen.getByRole('status').textContent).toBe(title);
  });
});
