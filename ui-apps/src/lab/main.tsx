import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { scenarios, sequence, type Scenario } from './fixtures';
import './style.css';

function Frame({ scenario, html, onLog }: { scenario: Scenario; html?: string; onLog: (line: string) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(70);
  useEffect(() => {
    const iframe = ref.current!;
    let disposed = false;
    const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const bridge = new AppBridge(null, { name: 'n8n-mcp local lab', version: '1.0.0' }, {}, {
      hostContext: { theme: scheme.matches ? 'dark' : 'light', ...(scenario.omitToolInfo ? {} : { toolInfo: { tool: { name: scenario.tool, inputSchema: { type: 'object' as const } } } }) },
    });
    const log = (line: string) => { if (!disposed) onLog(line); };
    bridge.onsizechange = size => { if (!disposed && typeof size.height === 'number') setHeight(Math.min(1600, Math.max(1, size.height))); };
    bridge.onerror = error => log(`Bridge error: ${error.message}`);
    bridge.oninitialized = async () => {
      if (disposed) return;
      try {
        log('Host initialized');
        await bridge.sendToolInput({ arguments: scenario.input });
        if (disposed) return;
        log('Tool input delivered');
        if (scenario.hostDiagnostic) {
          // An unknown progress token reaches App.onerror without closing the SDK transport.
          await transport.send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'unknown-lab-token', progress: 1 } });
          log('Recoverable host diagnostic delivered');
          await new Promise(resolve => window.setTimeout(resolve, 1200));
        }
        if (scenario.lifecycle === 'pending') return;
        if (scenario.lifecycle === 'cancelled' || scenario.lifecycle === 'late-result') {
          await bridge.sendToolCancelled({ reason: 'This call was cancelled in the lab.' });
          log('Cancellation delivered');
          if (scenario.lifecycle === 'cancelled') return;
        }
        if (scenario.result && !disposed) { await bridge.sendToolResult(scenario.result); log('Tool result delivered'); }
      } catch (error) { log(`Delivery error: ${String(error)}`); }
    };
    const themeChange = () => Promise.resolve(bridge.sendHostContextChange({ theme: scheme.matches ? 'dark' : 'light' })).catch(error => log(String(error)));
    scheme.addEventListener('change', themeChange);
    // Connect before navigating: the view can initialize as soon as scripts run.
    void bridge.connect(transport).then(() => {
      if (disposed) return;
      if (html) iframe.srcdoc = html;
      else iframe.src = `/src/apps/${scenario.app}/index.html`;
    }).catch(error => log(String(error)));
    return () => {
      disposed = true;
      scheme.removeEventListener('change', themeChange);
      void bridge.close();
    };
  }, [scenario, html, onLog]);
  return <iframe ref={ref} title="MCP result card" sandbox="allow-scripts" style={{ height }} />;
}
function Lab() {
  const [selected, setSelected] = useState(scenarios[1].id);
  const [width, setWidth] = useState('680');
  const [running, setRunning] = useState(false);
  const [revision, setRevision] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [smoke, setSmoke] = useState<{ scenario: Scenario; html: string } | null>(null);
  const [smokeError, setSmokeError] = useState('');
  const onLog = React.useCallback((line: string) => setLogs(previous => [...previous.slice(-19), line]), []);
  useEffect(() => {
    if (!running) return;
    let index = 0;
    setSmoke(null); setSelected(sequence[0]); setRevision(n => n + 1);
    const timer = window.setInterval(() => {
      index++;
      if (index >= sequence.length) { setRunning(false); return; }
      setSelected(sequence[index]); setRevision(n => n + 1);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [running]);
  const scenario = smoke?.scenario ?? scenarios.find(s => s.id === selected)!;
  async function loadSmoke(kind: 'validation' | 'operation') {
    setRunning(false); setSmokeError('');
    try {
      const res = await fetch('/.lab-smoke.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Run npm run ui:smoke from the repository root first.');
      const payload = (await res.json())[kind];
      const tool = kind === 'validation' ? 'validate_workflow' : 'n8n_create_workflow';
      if (!payload || payload.tool !== tool || typeof payload.html !== 'string' || !payload.result || !payload.input) throw new Error('Invalid protocol snapshot. Run npm run ui:smoke again.');
      setSmoke({ html: payload.html, scenario: { id: `protocol-${kind}`, label: kind === 'validation' ? 'Real offline MCP result and built resource' : 'Built operation resource with synthetic result', app: kind === 'validation' ? 'validation-summary' : 'operation-result', tool: payload.tool, input: payload.input, result: payload.result } });
      setRevision(n => n + 1);
    } catch (error) { setSmokeError(error instanceof Error ? error.message : String(error)); }
  }
  async function loadSelectedBundle() {
    setRunning(false); setSmokeError('');
    try {
      const res = await fetch('/.lab-smoke.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Run npm run ui:smoke first.');
      const html = (await res.json()).resources?.[scenario.app];
      if (typeof html !== 'string') throw new Error('Rebuild and run npm run ui:smoke to capture all resources.');
      setSmoke({ html, scenario: { ...scenario, label: `${scenario.label} · built resource with fixture` } });
      setRevision(n => n + 1);
    } catch (error) { setSmokeError(String(error)); }
  }
  return <main className="lab">
    <header><p className="lab-eyebrow">Development only · Synthetic workflows</p><h1>n8n-mcp UI lab</h1><p>Inspect the cards users see while an agent builds and fixes a workflow.</p></header>
    <div className="lab-controls">
      <label>Scenario<select value={selected} disabled={running} onChange={event => { setSelected(event.target.value); setSmoke(null); setRevision(n => n + 1); }}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label>Embed width<select value={width} onChange={event => setWidth(event.target.value)}>{['320', '480', '680'].map(w => <option key={w} value={w}>{w}px</option>)}</select></label>
      <button onClick={() => setRunning(value => !value)}>{running ? 'Stop replay' : 'Replay agent sequence'}</button>
      <button onClick={() => loadSmoke('validation')}>Load protocol snapshot</button>
      <button onClick={() => loadSmoke('operation')}>Load operation bundle</button>
      <button onClick={loadSelectedBundle}>Load selected built resource</button>
    </div>
    <p className="lab-state" role="status">{running ? 'Simulated agent sequence' : smoke ? 'Built HTML read from local MCP' : 'Production component with fixture data'} · {scenario.label}</p>
    {smokeError && <p role="alert">{smokeError}</p>}
    {scenario.agentQuestion && <aside className="lab-question"><strong>Simulated agent message</strong><p>{scenario.agentQuestion}</p><p>The card below still reports the validation result. A validation error alone does not request human input.</p></aside>}
    <div className="lab-frame" style={{ maxWidth: `${width}px` }}><Frame key={`${scenario.id}-${revision}`} scenario={scenario} html={smoke?.html} onLog={onLog} /></div>
    <details className="lab-log"><summary>Host event log</summary><ol>{logs.map((line, i) => <li key={i}>{line}</li>)}</ol></details>
    <footer>All five result views are available. Fixtures demonstrate rendering and never perform live n8n operations. The lab advertises no tool-call or message-sending capabilities.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Lab />);
