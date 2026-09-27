import { describe, it, expect, vi } from 'vitest';
import { IngestClient } from '../../../src/telemetry/ingest-client';

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 201 ? null : '', { status, headers });

function client(status: number, onControl = vi.fn()) {
  const fetchImpl = vi.fn(async () => res(status));
  const c = new IngestClient({ url: 'https://t.example', key: 'k', version: '2.90.0', fetchImpl: fetchImpl as any, onControl });
  return { c, fetchImpl, onControl };
}

describe('IngestClient', () => {
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
  it('429 and 5xx return an error so the breaker and DLQ apply', async () => {
    for (const s of [429, 503]) {
      const { c } = client(s);
      const r = await c.from('telemetry_events').insert([{}]);
      expect(r.error?.status).toBe(s);
    }
  });
  it('network failure returns an error with status 0 instead of throwing', async () => {
    const c = new IngestClient({ url: 'https://t.example', key: 'k', version: '1.0.0',
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as any });
    const r = await c.from('telemetry_events').insert([{}]);
    expect(r.error).toEqual({ message: 'fetch failed', status: 0 });
  });
});
