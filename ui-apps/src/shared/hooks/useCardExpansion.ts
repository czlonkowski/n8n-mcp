import { useEffect, useRef, useState } from 'react';
import { object } from '../result-state';

type WidgetBridge = { widgetState?: unknown; setWidgetState?: (state: Record<string, unknown>) => void };
type WidgetWindow = Window & { openai?: WidgetBridge };
const key = 'n8nMcpCard';

function bridge(): WidgetBridge | undefined {
  try { return (window as WidgetWindow).openai; } catch { return undefined; }
}
function savedExpansion(state: unknown): boolean | undefined {
  const value = object(object(object(state)?.privateContent)?.[key])?.expanded;
  return typeof value === 'boolean' ? value : undefined;
}
function readExpansion(): boolean {
  try { return savedExpansion(bridge()?.widgetState) ?? false; } catch { return false; }
}

/** Optional host persistence belongs to this widget, never to future result cards. */
export function useCardExpansion() {
  const [expanded, setExpanded] = useState(readExpansion);
  const current = useRef({ expanded, interacted: false });
  useEffect(() => {
    const restore = (event: Event) => {
      const globals = object((event as CustomEvent).detail?.globals);
      if (current.current.interacted || !globals || !Object.prototype.hasOwnProperty.call(globals, 'widgetState')) return;
      const next = savedExpansion(globals.widgetState) ?? false;
      current.current.expanded = next;
      setExpanded(next);
    };
    window.addEventListener('openai:set_globals', restore);
    return () => window.removeEventListener('openai:set_globals', restore);
  }, []);

  function toggle() {
    const next = !current.current.expanded;
    current.current = { expanded: next, interacted: true };
    setExpanded(next);
    try {
      const host = bridge();
      if (!host?.setWidgetState) return;
      const state = object(host.widgetState) ?? {};
      const privateContent = object(state.privateContent) ?? {};
      host.setWidgetState({ ...state, privateContent: { ...privateContent, [key]: { expanded: next } } });
    } catch { /* Presentation remains usable when optional host persistence is unavailable. */ }
  }
  return { expanded, toggle };
}
