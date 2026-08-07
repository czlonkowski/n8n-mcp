import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installStdioGuard } from '../../../src/utils/stdio-guard';

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
    originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };
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
    process.stdout.write = originalStdoutWrite;
    Object.assign(console, originalConsole);
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
  });

  it('returns the original console methods captured before override', () => {
    const originals = installStdioGuard({ silenceConsole: true });

    expect(originals.error).toBe(originalConsole.error);
    expect(originals.log).toBe(originalConsole.log);
  });
});
