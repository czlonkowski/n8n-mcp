import { useReducer, useCallback, useEffect, useState } from 'react';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps/react';
import { initialResultState, reduceResult } from '../result-state';

export function useToolData<T = Record<string, unknown>>() {
  const [state, dispatch] = useReducer(reduceResult, initialResultState);
  const [context, setContext] = useState<McpUiHostContext | null>(null);
  const onAppCreated = useCallback((app: App) => {
    app.ontoolinput = input => dispatch({ type: 'input', input: input.arguments });
    app.ontoolresult = result => dispatch({ type: 'result', result, receivedAt: new Date().toISOString() });
    app.ontoolcancelled = params => dispatch({ type: 'cancel', reason: params.reason });
    // SDK protocol diagnostics do not necessarily end the tool invocation.
    app.onerror = error => dispatch({ type: 'host-warning', error: error.message });
    app.addEventListener('hostcontextchanged', ctx => setContext(previous => ({ ...previous, ...ctx })));
  }, []);
  const { app, isConnected, error } = useApp({
    appInfo: { name: 'n8n-mcp-ui', version: '1.1.0' }, capabilities: {}, onAppCreated,
  });
  useEffect(() => {
    if (isConnected) setContext(app?.getHostContext() ?? null);
  }, [app, isConnected]);
  useEffect(() => {
    if (error) dispatch({ type: 'error', error: error.message });
  }, [error]);
  useHostStyles(app, context);
  return {
    ...state, data: state.data as T | null,
    isConnected, app, toolName: state.toolName ?? context?.toolInfo?.tool.name ?? null,
    standalone: typeof window !== 'undefined' && window.parent === window,
  };
}
