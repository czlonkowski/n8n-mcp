import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IngestClient, resetIngestClientProcessStateForTests } from '../../../src/telemetry/ingest-client';

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 201 ? null : '', { status, headers });

function client(status: number, onControl = vi.fn(), headers: Record<string, string> = {}) {
  const fetchImpl = vi.fn(async () => res(status, headers));
  const c = new IngestClient({ url: 'https://t.example', key: 'k', version: '2.90.0', fetchImpl: fetchImpl as any, onControl });
  return { c, fetchImpl, onControl };
}

describe('IngestClient', () => {
  // Stop/backoff state is shared process-wide (module-level) by design (see
  // ingest-client.ts). Every test must start from a clean slate.
  beforeEach(() => {
    resetIngestClientProcessStateForTests();
  });

  it('POSTs a JSON array to /v1/ingest/<stream> with key and version headers', async () => {
    const { c, fetchImpl } = client(201);
    const r = await c.from('telemetry_events').insert({ user_id: 'u', event: 'e', properties: {} });
    expect(r.error).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe('https://t.example/v1/ingest/events');
    expect(init.method).toBe('POST');
    expect(init.headers['X-N8N-MCP-Key']).toBe('k');
    expect(init.headers['X-N8N-MCP-Version']).toBe('2.90.0');
    expect(JSON.parse(init.body)).toHaveLength(1);
  });
  it('maps tables to streams', async () => {
    const { c, fetchImpl } = client(201);
    await c.from('telemetry_workflows').insert([]);
    await c.from('workflow_mutations').insert([]);
    expect((fetchImpl.mock.calls as any[]).map(a => a[0])).toEqual([
      'https://t.example/v1/ingest/workflows', 'https://t.example/v1/ingest/mutations']);
  });
  it('400/413 are dropped without error (no retry)', async () => {
    for (const s of [400, 413]) {
      resetIngestClientProcessStateForTests();
      const { c } = client(s);
      const r = await c.from('telemetry_events').insert([{}]);
      expect(r).toMatchObject({ error: null, dropped: true, status: s });
    }
  });
  it('410 signals disable_version and stops all further sends', async () => {
    const { c, fetchImpl, onControl } = client(410);
    await c.from('telemetry_events').insert([{}]);
    const r2 = await c.from('telemetry_events').insert([{}]);
    expect(onControl).toHaveBeenCalledWith({ kind: 'disable_version', status: 410 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r2.dropped).toBe(true);
  });
  it('401/403 signal disable_process', async () => {
    const { c, onControl } = client(401);
    await c.from('telemetry_events').insert([{}]);
    expect(onControl).toHaveBeenCalledWith({ kind: 'disable_process', status: 401 });
  });
  it('5xx returns an error so the breaker and DLQ apply', async () => {
    const { c } = client(503);
    const r = await c.from('telemetry_events').insert([{}]);
    expect(r.error?.status).toBe(503);
  });
  it('network failure returns an error with status 0 instead of throwing', async () => {
    const c = new IngestClient({ url: 'https://t.example', key: 'k', version: '1.0.0',
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as any });
    const r = await c.from('telemetry_events').insert([{}]);
    expect(r.error).toEqual({ message: 'fetch failed', status: 0 });
  });

  describe('unspecified 4xx are terminal drops, like 400', () => {
    it.each([404, 422])('%i is dropped without error (no retry)', async (status) => {
      const { c, fetchImpl } = client(status);
      const r = await c.from('telemetry_events').insert([{}]);
      expect(r).toMatchObject({ error: null, dropped: true, status });

      // Not a stop signal and not a backoff — a second call still reaches the network.
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('process-wide stop state is shared across instances', () => {
    it('client A getting 401 means client B makes no fetch at all', async () => {
      const fetchImplA = vi.fn(async () => res(401));
      const clientA = new IngestClient({ url: 'https://t.example', key: 'kA', version: '2.90.0', fetchImpl: fetchImplA as any });
      const fetchImplB = vi.fn(async () => res(201));
      const clientB = new IngestClient({ url: 'https://t.example', key: 'kB', version: '2.90.0', fetchImpl: fetchImplB as any });

      await clientA.from('telemetry_events').insert([{}]);
      expect(fetchImplA).toHaveBeenCalledTimes(1);

      const rB = await clientB.from('telemetry_events').insert([{}]);
      expect(fetchImplB).not.toHaveBeenCalled();
      expect(rB.dropped).toBe(true);
    });

    it('client A getting 410 means client B makes no fetch at all', async () => {
      const fetchImplA = vi.fn(async () => res(410));
      const clientA = new IngestClient({ url: 'https://t.example', key: 'kA', version: '2.90.0', fetchImpl: fetchImplA as any });
      const fetchImplB = vi.fn(async () => res(201));
      const clientB = new IngestClient({ url: 'https://t.example', key: 'kB', version: '2.90.0', fetchImpl: fetchImplB as any });

      await clientA.from('telemetry_events').insert([{}]);
      const rB = await clientB.from('telemetry_workflows').insert([{}]);

      expect(fetchImplB).not.toHaveBeenCalled();
      expect(rB.dropped).toBe(true);
    });
  });

  describe('429 Retry-After: process-wide local backoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('a numeric Retry-After (seconds) blocks further sends without calling fetch, until it elapses', async () => {
      const { c, fetchImpl } = client(429, vi.fn(), { 'retry-after': '2' });

      const r1 = await c.from('telemetry_events').insert([{}]);
      expect(r1.error?.status).toBe(429);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Still inside the 2s window: no new fetch, local-backoff message.
      vi.advanceTimersByTime(1999);
      const r2 = await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(r2).toEqual({ error: { message: 'rate limited (local backoff)', status: 429 }, status: 429 });

      // Window elapsed: fetch happens again.
      vi.advanceTimersByTime(2);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('an HTTP-date Retry-After blocks until that date', async () => {
      const future = new Date('2026-01-01T00:00:05.000Z').toUTCString();
      const { c, fetchImpl } = client(429, vi.fn(), { 'retry-after': future });

      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(4999);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('defaults to 60s when Retry-After is missing', async () => {
      const { c, fetchImpl } = client(429);

      await c.from('telemetry_events').insert([{}]);
      vi.advanceTimersByTime(59_999);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('defaults to 60s when Retry-After is unparseable', async () => {
      const { c, fetchImpl } = client(429, vi.fn(), { 'retry-after': 'not-a-value' });

      await c.from('telemetry_events').insert([{}]);
      vi.advanceTimersByTime(59_999);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('caps an excessive Retry-After at 1 hour', async () => {
      const { c, fetchImpl } = client(429, vi.fn(), { 'retry-after': '999999' }); // ~11.5 days

      await c.from('telemetry_events').insert([{}]);

      // Just under the 1-hour cap: still blocked.
      vi.advanceTimersByTime(60 * 60_000 - 1);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Past the cap: unblocked, even though the header asked for far longer.
      vi.advanceTimersByTime(2);
      await c.from('telemetry_events').insert([{}]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('the local backoff is shared process-wide: a 429 on client A blocks client B too', async () => {
      const fetchImplA = vi.fn(async () => res(429, { 'retry-after': '30' }));
      const clientA = new IngestClient({ url: 'https://t.example', key: 'kA', version: '2.90.0', fetchImpl: fetchImplA as any });
      const fetchImplB = vi.fn(async () => res(201));
      const clientB = new IngestClient({ url: 'https://t.example', key: 'kB', version: '2.90.0', fetchImpl: fetchImplB as any });

      await clientA.from('telemetry_events').insert([{}]);
      const rB = await clientB.from('telemetry_events').insert([{}]);

      expect(fetchImplB).not.toHaveBeenCalled();
      expect(rB.error).toEqual({ message: 'rate limited (local backoff)', status: 429 });
    });
  });
});
