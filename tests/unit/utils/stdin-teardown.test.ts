import { describe, it, expect, vi } from 'vitest';
import { tearDownStdin } from '@/utils/stdin-teardown';

/**
 * Regression tests for Issues #383 / #385:
 * On Windows, `process.stdin.destroy()` during shutdown triggers a fatal libuv
 * UV_HANDLE_CLOSING double-close assertion that crashes the MCP server. The
 * teardown helper must skip destroy() on win32 while still pausing stdin, and
 * must still destroy() on every other platform. It must also no-op when stdin
 * is absent or already destroyed (the guard lives in the helper).
 */

function fakeStdin() {
  return {
    pause: vi.fn(),
    destroy: vi.fn(),
  } as unknown as NodeJS.ReadStream & { pause: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
}

describe('tearDownStdin', () => {
  it('does NOT call stdin.destroy() on win32 (Issues #383 / #385)', () => {
    const stdin = fakeStdin();

    tearDownStdin(stdin, 'win32');

    expect(stdin.pause).toHaveBeenCalledTimes(1);
    expect(stdin.destroy).not.toHaveBeenCalled();
  });

  it('calls stdin.destroy() on non-win32 platforms', () => {
    for (const platform of ['linux', 'darwin', 'freebsd'] as NodeJS.Platform[]) {
      const stdin = fakeStdin();

      tearDownStdin(stdin, platform);

      expect(stdin.pause).toHaveBeenCalledTimes(1);
      expect(stdin.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it('pauses stdin before destroying it (off-win32)', () => {
    const order: string[] = [];
    const stdin = {
      pause: vi.fn(() => order.push('pause')),
      destroy: vi.fn(() => order.push('destroy')),
    } as unknown as NodeJS.ReadStream;

    tearDownStdin(stdin, 'linux');

    expect(order).toEqual(['pause', 'destroy']);
  });

  it('defaults platform to process.platform', () => {
    const stdin = fakeStdin();

    tearDownStdin(stdin);

    // pause() always runs regardless of platform.
    expect(stdin.pause).toHaveBeenCalledTimes(1);
    // destroy() must mirror the real platform: skipped only on win32.
    if (process.platform === 'win32') {
      expect(stdin.destroy).not.toHaveBeenCalled();
    } else {
      expect(stdin.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it('is a no-op when stdin is already destroyed (neither pause nor destroy)', () => {
    const stdin = {
      destroyed: true,
      pause: vi.fn(),
      destroy: vi.fn(),
    } as unknown as NodeJS.ReadStream & {
      pause: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };

    // Even off-win32, a destroyed stream must not be touched.
    tearDownStdin(stdin, 'linux');

    expect(stdin.pause).not.toHaveBeenCalled();
    expect(stdin.destroy).not.toHaveBeenCalled();
  });

  it('is a no-op when stdin is absent (undefined)', () => {
    // Should not throw when the guard short-circuits on a missing stream.
    expect(() =>
      tearDownStdin(undefined as unknown as NodeJS.ReadStream, 'linux'),
    ).not.toThrow();
  });
});
