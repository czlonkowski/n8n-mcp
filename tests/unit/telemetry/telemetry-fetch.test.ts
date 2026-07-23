import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelemetryFetch } from '../../../src/telemetry/telemetry-fetch';

describe('createTelemetryFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a successful response and clears the deadline timer', async () => {
    const response = new Response(null, { status: 204 });
    const baseFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });

    await expect(telemetryFetch('https://example.test/telemetry')).resolves.toBe(response);

    expect(baseFetch).toHaveBeenCalledOnce();
    expect(baseFetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the underlying fetch when the deadline expires', async () => {
    const requestState: { signal: AbortSignal | null } = { signal: null };
    const baseFetch = vi.fn<typeof fetch>((_input, init) => {
      requestState.signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        requestState.signal?.addEventListener('abort', () => reject(requestState.signal?.reason), {
          once: true,
        });
      });
    });
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });
    const request = telemetryFetch('https://example.test/telemetry');
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(2000);

    await rejection;
    expect(requestState.signal?.aborted).toBe(true);
    expect(requestState.signal?.reason).toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates an upstream abort to the underlying fetch', async () => {
    const upstreamController = new AbortController();
    const upstreamReason = new DOMException('Caller cancelled', 'AbortError');
    const requestState: { signal: AbortSignal | null } = { signal: null };
    const baseFetch = vi.fn<typeof fetch>((_input, init) => {
      requestState.signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        requestState.signal?.addEventListener('abort', () => reject(requestState.signal?.reason), {
          once: true,
        });
      });
    });
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });
    const request = telemetryFetch('https://example.test/telemetry', {
      signal: upstreamController.signal,
    });
    const rejection = expect(request).rejects.toBe(upstreamReason);

    upstreamController.abort(upstreamReason);

    await rejection;
    expect(requestState.signal?.aborted).toBe(true);
    expect(requestState.signal?.reason).toBe(upstreamReason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('promptly propagates an already-aborted upstream signal', async () => {
    const upstreamController = new AbortController();
    const upstreamReason = new DOMException('Caller already cancelled', 'AbortError');
    upstreamController.abort(upstreamReason);

    const requestState: { signal: AbortSignal | null } = { signal: null };
    const baseFetch = vi.fn<typeof fetch>((_input, init) => {
      requestState.signal = init?.signal ?? null;
      return new Promise<Response>(() => {});
    });
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });

    await expect(telemetryFetch('https://example.test/telemetry', {
      signal: upstreamController.signal,
    })).rejects.toBe(upstreamReason);

    expect(baseFetch).toHaveBeenCalledOnce();
    expect(requestState.signal?.aborted).toBe(true);
    expect(requestState.signal?.reason).toBe(upstreamReason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses an AbortError fallback when an aborted upstream signal has no reason', async () => {
    const upstreamController = new AbortController();
    upstreamController.abort();
    Object.defineProperty(upstreamController.signal, 'reason', { value: undefined });

    const requestState: { signal: AbortSignal | null } = { signal: null };
    const baseFetch = vi.fn<typeof fetch>((_input, init) => {
      requestState.signal = init?.signal ?? null;
      return new Promise<Response>(() => {});
    });
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });
    const rejectionReason = await telemetryFetch('https://example.test/telemetry', {
      signal: upstreamController.signal,
    }).catch((reason: unknown) => reason);

    expect(rejectionReason).toMatchObject({
      name: 'AbortError',
      message: 'The operation was aborted',
    });
    expect(requestState.signal?.aborted).toBe(true);
    expect(requestState.signal?.reason).toBe(rejectionReason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('derives and propagates the upstream signal from a Request input', async () => {
    const upstreamController = new AbortController();
    const upstreamReason = new DOMException('Request cancelled', 'AbortError');
    const input = new Request('https://example.test/telemetry', {
      signal: upstreamController.signal,
    });
    const requestState: { signal: AbortSignal | null } = { signal: null };
    const baseFetch = vi.fn<typeof fetch>((_input, init) => {
      requestState.signal = init?.signal ?? null;
      return new Promise<Response>(() => {});
    });
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });
    const request = telemetryFetch(input);
    const rejection = expect(request).rejects.toBe(upstreamReason);

    upstreamController.abort(upstreamReason);

    await rejection;
    expect(baseFetch).toHaveBeenCalledWith(input, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(requestState.signal?.aborted).toBe(true);
    expect(requestState.signal?.reason).toBe(upstreamReason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects on the deadline even when the base fetch ignores abort', async () => {
    const requestState: { signal: AbortSignal | null } = { signal: null };
    const baseFetch = vi.fn<typeof fetch>((_input, init) => {
      requestState.signal = init?.signal ?? null;
      return new Promise<Response>(() => {});
    });
    const telemetryFetch = createTelemetryFetch({ baseFetch, timeoutMs: 2000 });
    const request = telemetryFetch('https://example.test/telemetry');
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(2000);

    await rejection;
    expect(requestState.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
