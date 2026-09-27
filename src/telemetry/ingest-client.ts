/**
 * Transport for the n8n-mcp telemetry ingest API (v1). Replaces supabase-js.
 * Shaped like supabase-js's `from(table).insert(rows)` so call sites stay put.
 *
 * Status contract (server: apps/telemetry-ingest in n8n-mcp-backend):
 *   2xx → ok · 400/413/other 4xx → drop, never retry · 401/403 → disable for this process
 *   410 → disable this client version permanently · 429 → local backoff via Retry-After
 *   5xx/network → error (retry path)
 *
 * Process-wide state (module-level, not per-instance). This migration exists because
 * the old Supabase-backed client could retry forever under sustained errors. A stop
 * signal or a 429 backoff observed on ANY IngestClient instance in this process (the
 * telemetry manager's, the early error logger's, ...) must hold for every instance —
 * otherwise one client going quiet just shifts the hammering onto the other.
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

const RETRY_AFTER_DEFAULT_MS = 60_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000; // cap at 1 hour

// Shared by every IngestClient instance in this process — see the module doc above.
let processStopped = false;
let blockedUntil = 0;

/**
 * Test-only: clear the process-wide stop/backoff state between test cases.
 * Real code has no reason to call this — the state is meant to persist for
 * the life of the process.
 */
export function resetIngestClientProcessStateForTests(): void {
  processStopped = false;
  blockedUntil = 0;
}

/**
 * Parse a Retry-After header value into a millisecond delay.
 * Accepts a delay in seconds (RFC 7231) or an HTTP-date. Missing or
 * unparseable values default to 60s; every result is capped at 1 hour so a
 * misconfigured or hostile value cannot park the client indefinitely.
 */
function parseRetryAfterMs(header: string | null, now: number): number {
  if (!header) return RETRY_AFTER_DEFAULT_MS;
  const trimmed = header.trim();

  if (/^\d+$/.test(trimmed)) {
    return Math.min(parseInt(trimmed, 10) * 1000, RETRY_AFTER_MAX_MS);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - now, 0), RETRY_AFTER_MAX_MS);
  }

  return RETRY_AFTER_DEFAULT_MS;
}

export interface IngestClientOptions {
  url: string;
  key: string;
  version: string;
  fetchImpl?: typeof fetch;
  onControl?: (signal: ControlSignal) => void;
}

export class IngestClient {
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
    if (processStopped) return { error: null, status: 0, dropped: true };

    if (Date.now() < blockedUntil) {
      // Still inside a server-requested backoff window from a prior 429 —
      // on this instance or any other in the process. Never hit the network.
      return { error: { message: 'rate limited (local backoff)', status: 429 }, status: 429 };
    }

    let status: number;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/ingest/${STREAM[table]}`, {
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
      processStopped = true;
      this.opts.onControl?.({ kind: status === 410 ? 'disable_version' : 'disable_process', status });
      return { error: null, status, dropped: true };
    }
    if (status === 429) {
      blockedUntil = Date.now() + parseRetryAfterMs(res.headers.get('retry-after'), Date.now());
      return { error: { message: `telemetry ingest HTTP ${status}`, status }, status };
    }
    if (status >= 400 && status < 500) {
      // Any other 4xx (404, 422, ...) is a client-side error the server will
      // never accept on retry — terminal, same as 400/413.
      return { error: null, status, dropped: true };
    }
    return { error: { message: `telemetry ingest HTTP ${status}`, status }, status };
  }
}
