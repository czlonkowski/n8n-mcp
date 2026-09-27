/**
 * Transport for the n8n-mcp telemetry ingest API (v1). Replaces supabase-js.
 * Shaped like supabase-js's `from(table).insert(rows)` so call sites stay put.
 *
 * Status contract (server: apps/telemetry-ingest in n8n-mcp-backend):
 *   2xx → ok · 400/413 → drop, never retry · 401/403 → disable for this process
 *   410 → disable this client version permanently · 429/5xx/network → error (retry path)
 */
import { telemetryFetch } from './telemetry-fetch';

export type IngestTable = 'telemetry_events' | 'telemetry_workflows' | 'workflow_mutations';
export type ControlSignal = { kind: 'disable_version' | 'disable_process'; status: number };
export interface IngestResult {
  error: { message: string; status: number } | null;
  status: number;
  dropped?: boolean;
}

const STREAM: Record<IngestTable, string> = {
  telemetry_events: 'events',
  telemetry_workflows: 'workflows',
  workflow_mutations: 'mutations',
};

export interface IngestClientOptions {
  url: string;
  key: string;
  version: string;
  fetchImpl?: typeof fetch;
  onControl?: (signal: ControlSignal) => void;
}

export class IngestClient {
  private stopped = false;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: IngestClientOptions) {
    this.base = opts.url.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? telemetryFetch;
  }

  from(table: IngestTable) {
    return { insert: (rows: object | object[]) => this.send(table, Array.isArray(rows) ? rows : [rows]) };
  }

  private async send(table: IngestTable, rows: object[]): Promise<IngestResult> {
    if (this.stopped) return { error: null, status: 0, dropped: true };
    let status: number;
    try {
      const res = await this.fetchImpl(`${this.base}/v1/ingest/${STREAM[table]}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-MCP-Key': this.opts.key,
          'X-N8N-MCP-Version': this.opts.version,
        },
        body: JSON.stringify(rows),
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      return { error: { message: e instanceof Error ? e.message : String(e), status: 0 }, status: 0 };
    }
    if (status >= 200 && status < 300) return { error: null, status };
    if (status === 400 || status === 413) return { error: null, status, dropped: true };
    if (status === 410 || status === 401 || status === 403) {
      this.stopped = true;
      this.opts.onControl?.({ kind: status === 410 ? 'disable_version' : 'disable_process', status });
      return { error: null, status, dropped: true };
    }
    return { error: { message: `telemetry ingest HTTP ${status}`, status }, status };
  }
}
