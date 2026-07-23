import { TELEMETRY_CONFIG } from './telemetry-types';

type TelemetryFetch = typeof globalThis.fetch;

export interface TelemetryFetchOptions {
  baseFetch?: TelemetryFetch;
  timeoutMs?: number;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Create a fetch implementation with a hard deadline for best-effort telemetry.
 *
 * The explicit race is intentional: aborting the controller alone is not enough
 * to guarantee settlement when a custom or mocked fetch implementation ignores
 * its signal.
 */
export function createTelemetryFetch({
  baseFetch = globalThis.fetch,
  timeoutMs = TELEMETRY_CONFIG.FETCH_TIMEOUT_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}: TelemetryFetchOptions = {}): TelemetryFetch {
  return (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal
      ?? (typeof Request !== 'undefined' && input instanceof Request
        ? input.signal
        : undefined);
    let rejectAbort!: (reason?: unknown) => void;

    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });

    const abort = (reason: unknown): void => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
      rejectAbort(reason);
    };

    const handleUpstreamAbort = (): void => {
      if (upstreamSignal) {
        abort(abortReason(upstreamSignal));
      }
    };

    if (upstreamSignal?.aborted) {
      handleUpstreamAbort();
    } else {
      upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true });
    }

    const timer = setTimeoutFn(() => {
      abort(new DOMException(
        `Telemetry fetch timed out after ${timeoutMs}ms`,
        'TimeoutError'
      ));
    }, timeoutMs);
    timer.unref?.();

    const fetchPromise = Promise.resolve().then(() => baseFetch(input, {
      ...init,
      signal: controller.signal,
    }));

    return Promise.race([fetchPromise, abortPromise]).finally(() => {
      clearTimeoutFn(timer);
      upstreamSignal?.removeEventListener('abort', handleUpstreamAbort);
    });
  };
}

export const telemetryFetch = createTelemetryFetch();
