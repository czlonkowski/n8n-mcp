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

// Matches anything that reads as a bare number (optional sign, optional
// fractional part) — RFC 7231 seconds-delays are non-negative integers ONLY,
// but any number-shaped string must be judged as a seconds-delay candidate
// and never handed to Date.parse: Date.parse on a bare number like "-5" or
// "20260101" does not reliably return NaN and must not be silently
// reinterpreted as a date.
const NUMBER_LIKE_RE = /^[+-]?\d+(?:\.\d+)?$/;
const POSITIVE_INTEGER_RE = /^\d+$/;

/**
 * Parse a Retry-After header value into a millisecond delay.
 * Accepts a delay in seconds (RFC 7231: a non-negative integer) or an
 * HTTP-date strictly in the future. Missing, unparseable, non-positive-
 * integer numeric, or non-future-date values all default to 60s; every
 * result is capped at 1 hour so a misconfigured or hostile value cannot
 * park the client indefinitely.
 */
function parseRetryAfterMs(header: string | null, now: number): number {
  if (!header) return RETRY_AFTER_DEFAULT_MS;
  const trimmed = header.trim();
  if (!trimmed) return RETRY_AFTER_DEFAULT_MS;

  if (NUMBER_LIKE_RE.test(trimmed)) {
    // Number-shaped: only a valid positive integer is a real seconds-delay.
    // Never fall through to Date.parse for these — "-5", "0", "5.5", and
    // giant bare numbers like "20260101" are not dates.
    if (POSITIVE_INTEGER_RE.test(trimmed)) {
      const seconds = parseInt(trimmed, 10);
      if (seconds > 0) {
        return Math.min(seconds * 1000, RETRY_AFTER_MAX_MS);
      }
    }
    return RETRY_AFTER_DEFAULT_MS;
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs) && dateMs > now) {
    return Math.min(dateMs - now, RETRY_AFTER_MAX_MS);
  }

  // Unparseable, or a date that is not strictly in the future.
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
      const now = Date.now();
      const candidate = now + parseRetryAfterMs(res.headers.get('retry-after'), now);
      // Never let a new 429 shorten an already-longer active window — e.g.
      // two in-flight requests resolving out of order, one with a longer
      // backoff than the other.
      blockedUntil = Math.max(blockedUntil, candidate);
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
