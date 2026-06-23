/**
 * Platform-aware teardown of process.stdin during graceful shutdown.
 *
 * Issues #383 / #385: On Windows, calling `process.stdin.destroy()` while the
 * underlying libuv handle is already closing triggers a fatal assertion:
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 *   file src\win\async.c, line 76
 * which crashes the MCP server on exit / client disconnect. `pause()` is safe
 * on every platform, so we always call it; we only `destroy()` off-Windows,
 * where the destroy releases the handle so the process can exit promptly.
 *
 * This helper ONLY handles pause/destroy. It does NOT guarantee process exit:
 * on win32, where we skip destroy(), the stdin pipe may keep the libuv loop
 * alive, so the CALLER is responsible for ensuring the process exits (the
 * stdio-wrapper bin and src/mcp/index.ts both call process.exit(0) on win32).
 */
export function tearDownStdin(
  stdin: NodeJS.ReadStream = process.stdin,
  platform: NodeJS.Platform = process.platform,
): void {
  // No-op if stdin is missing or already torn down.
  if (!stdin || stdin.destroyed) return;

  // pause() is always safe and stops further 'data' events.
  stdin.pause();

  if (platform !== 'win32') {
    stdin.destroy();
  }
}
