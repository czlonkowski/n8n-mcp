import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useToolData } from '../src/shared/hooks/useToolData';

const sdk = vi.hoisted(() => ({ app: null as any, error: null as Error | null }));
vi.mock('@modelcontextprotocol/ext-apps/react', () => ({
  useApp: ({ onAppCreated }: any) => {
    if (!sdk.app) {
      sdk.app = { getHostContext: () => ({}), addEventListener: vi.fn() };
      onAppCreated(sdk.app);
    }
    return { app: sdk.app, isConnected: true, error: sdk.error };
  },
  useHostStyles: vi.fn(),
}));
beforeEach(() => { sdk.app = null; sdk.error = null; });

it('keeps SDK diagnostics recoverable but initialization failures terminal', () => {
  const { result, rerender } = renderHook(() => useToolData());
  act(() => sdk.app.ontoolinput({ arguments: { name: 'Demo' } }));
  act(() => sdk.app.onerror(new Error('Unknown progress token')));
  expect(result.current.phase).toBe('pending');
  act(() => sdk.app.ontoolresult({ structuredContent: { success: true }, _meta: { 'n8n-mcp/toolName': 'n8n_create_workflow' } }));
  expect(result.current.phase).toBe('ready');
  expect(result.current.toolName).toBe('n8n_create_workflow');
  expect(result.current.hostWarning).toBeNull();

  act(() => sdk.app.ontoolinput({ arguments: {} }));
  sdk.error = new Error('Initialization failed');
  rerender();
  expect(result.current.phase).toBe('error');
  act(() => sdk.app.ontoolresult({ structuredContent: { success: true } }));
  expect(result.current.error).toBe('Initialization failed');
});

it('prefers response identity and falls back to host identity for older servers', () => {
  const { result } = renderHook(() => useToolData());
  const contextChanged = sdk.app.addEventListener.mock.calls[0][1];
  act(() => contextChanged({ toolInfo: { tool: { name: 'validate_workflow' } } }));
  act(() => sdk.app.ontoolresult({ structuredContent: { valid: true } }));
  expect(result.current.toolName).toBe('validate_workflow');
  act(() => sdk.app.ontoolinput({ arguments: {} }));
  act(() => sdk.app.ontoolresult({ structuredContent: { valid: true }, _meta: { 'n8n-mcp/toolName': 'n8n_validate_workflow' } }));
  expect(result.current.toolName).toBe('n8n_validate_workflow');
});
