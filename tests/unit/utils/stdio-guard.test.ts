import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installStdioGuard, resetStdioGuardForTests } from '../../../src/utils/stdio-guard';

/**
 * Every console method the guard can replace under `silenceConsole`. Restoring a
 * subset would leak no-ops into later tests sharing this process.
 */
const OVERRIDDEN_CONSOLE_METHODS = [
  'log', 'error', 'warn', 'info', 'debug', 'trace', 'dir', 'time', 'timeEnd',
  'timeLog', 'group', 'groupEnd', 'table', 'clear', 'count', 'countReset',
] as const;

/** Captured once at module load, before any test can override console. */
const PRISTINE_CONSOLE: Record<string, any> = Object.fromEntries(
  OVERRIDDEN_CONSOLE_METHODS.map(m => [m, (console as any)[m]])
);

/**
 * The guard is the last line of defence for the JSON-RPC channel: in stdio mode
 * anything written to stdout that is not a protocol frame corrupts the stream.
 */
describe('installStdioGuard', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let originalConsole: Record<string, any>;
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write;
    originalConsole = {};
    for (const method of OVERRIDDEN_CONSOLE_METHODS) {
      originalConsole[method] = (console as any)[method];
    }
    resetStdioGuardForTests();
    stdoutChunks = [];
    stderrChunks = [];

    // Capture underneath the guard, so we observe where each write lands.
    process.stdout.write = ((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: any) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    resetStdioGuardForTests();
    process.stdout.write = originalStdoutWrite;
    for (const method of OVERRIDDEN_CONSOLE_METHODS) {
      (console as any)[method] = originalConsole[method];
    }
    vi.restoreAllMocks();
  });

  it('lets JSON-RPC frames through to stdout', () => {
    installStdioGuard();
    const frame = '{"jsonrpc":"2.0","id":1,"result":{}}';

    process.stdout.write(frame);

    expect(stdoutChunks).toEqual([frame]);
    expect(stderrChunks).toEqual([]);
  });

  it('redirects non-protocol writes to stderr instead of corrupting stdout', () => {
    installStdioGuard();

    process.stdout.write('╔══ Anonymous Usage Statistics ══╗\n');
    process.stdout.write('some native module diagnostic\n');

    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toContain('Anonymous Usage Statistics');
    expect(stderrChunks.join('')).toContain('native module diagnostic');
  });

  it('leaves console intact by default', () => {
    // logger.error() writes through console.error; stubbing it would blind the
    // client-side log, the only diagnostic channel a stdio server has. Anything
    // console.log emits is caught by the stdout filter above instead.
    installStdioGuard();

    expect(console.log).toBe(originalConsole.log);
    expect(console.error).toBe(originalConsole.error);
    expect(console.warn).toBe(originalConsole.warn);
  });

  it('silences console when asked, as the published bin requires', () => {
    installStdioGuard({ silenceConsole: true });

    expect(console.log).not.toBe(originalConsole.log);
    expect(console.error).not.toBe(originalConsole.error);
    expect(console.log('x')).toBeUndefined();
    // Reaches well beyond the common methods — the whole set has to be restored.
    expect(console.trace).not.toBe(originalConsole.trace);
    expect(console.table).not.toBe(originalConsole.table);
  });

  // Runs after the silencing test above, so a no-op left on any console method
  // would surface here rather than in an unrelated suite sharing this process.
  it('leaves no silenced console methods behind for later tests', () => {
    for (const method of OVERRIDDEN_CONSOLE_METHODS) {
      expect((console as any)[method]).toBe(PRISTINE_CONSOLE[method]);
    }
  });

  // The guard is installed from the entrypoints AND from the server's
  // constructor/run(), so repeat calls are normal rather than exceptional.
  describe('idempotency', () => {
    it('does not wrap stdout.write a second time', () => {
      installStdioGuard();
      const afterFirst = process.stdout.write;

      installStdioGuard();

      expect(process.stdout.write).toBe(afterFirst);
    });

    it('does not let a later plain call undo an earlier silencing', () => {
      installStdioGuard({ silenceConsole: true });
      const silenced = console.log;

      installStdioGuard();

      expect(console.log).toBe(silenced);
      expect(console.log).not.toBe(originalConsole.log);
    });

    it('returns the first call’s originals on every later call', () => {
      const first = installStdioGuard({ silenceConsole: true });
      const second = installStdioGuard();

      expect(second).toBe(first);
      expect(second.error).toBe(originalConsole.error);
    });

    it('still routes correctly after repeat installs', () => {
      installStdioGuard();
      installStdioGuard();

      process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}}');
      process.stdout.write('noise\n');

      expect(stdoutChunks).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}']);
      expect(stderrChunks.join('')).toContain('noise');
    });
  });

  it('returns the original console methods captured before override', () => {
    const originals = installStdioGuard({ silenceConsole: true });

    expect(originals.error).toBe(originalConsole.error);
    expect(originals.log).toBe(originalConsole.log);
  });
});
