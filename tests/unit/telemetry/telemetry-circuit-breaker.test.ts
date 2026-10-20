import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryCircuitBreaker } from '../../../src/telemetry/telemetry-error';

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

// Round 3, CRITICAL: shouldAllow() is the only method allowed to have side
// effects (the open->half-open transition, consuming a half-open probe
// slot). getState() — and therefore batch-processor's getMetrics() — must
// be a pure read: calling it must never itself flip the breaker into
// half-open or spend a probe slot a real request would have needed.
describe('TelemetryCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function openBreaker(breaker: TelemetryCircuitBreaker, failures = 5): void {
    for (let i = 0; i < failures; i++) breaker.recordFailure();
  }

  it('getState() never transitions open -> half-open, even after the reset timeout has elapsed', () => {
    const breaker = new TelemetryCircuitBreaker(5, 60000, 3);
    openBreaker(breaker);
    expect(breaker.getState().state).toBe('open');

    vi.advanceTimersByTime(60_001); // past resetTimeout

    for (let i = 0; i < 10; i++) {
      const s = breaker.getState();
      expect(s.state).toBe('open');
      // canRetry correctly reflects that a real attempt would now be let
      // through — the read is informative, just not state-mutating.
      expect(s.canRetry).toBe(true);
    }
  });

  it('getState() never consumes a half-open probe slot', () => {
    const breaker = new TelemetryCircuitBreaker(5, 60000, 3);
    openBreaker(breaker);
    vi.advanceTimersByTime(60_001);

    // Read state repeatedly — more times than there are probe slots.
    for (let i = 0; i < 10; i++) breaker.getState();

    // A real attempt (shouldAllow) must still be the one to actually enter
    // half-open — this first call performs the open->half-open transition
    // itself and does not consume a probe slot.
    expect(breaker.shouldAllow()).toBe(true);
    expect(breaker.getState().state).toBe('half-open');
    // All 3 (halfOpenRequests) probe slots are still available, none stolen
    // by the earlier getState() reads.
    for (let i = 0; i < 3; i++) {
      expect(breaker.shouldAllow()).toBe(true);
    }
    // Exhausted now — the 3 real probes have all been used.
    expect(breaker.shouldAllow()).toBe(false);
  });

  it('shouldAllow() keeps its normal side effects: half-open closes once enough successes land', () => {
    const breaker = new TelemetryCircuitBreaker(5, 60000, 3);
    openBreaker(breaker);
    vi.advanceTimersByTime(60_001);

    // The first shouldAllow() call performs the open->half-open transition
    // and does not itself count as one of the 3 (halfOpenRequests) probes,
    // so closing takes 4 successful attempts here, not 3.
    for (let i = 0; i < 4; i++) {
      expect(breaker.shouldAllow()).toBe(true);
      breaker.recordSuccess();
    }

    expect(breaker.getState().state).toBe('closed');
    expect(breaker.getState().failureCount).toBe(0);
  });
});
