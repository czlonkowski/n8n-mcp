/**
 * Stdio guard — keeps the JSON-RPC channel clean in stdio mode.
 *
 * In stdio mode `process.stdout` IS the MCP protocol channel. Any stray write —
 * a console.log, a native module's diagnostic, a dependency banner — is fed
 * straight into the client's JSON parser. Claude Desktop logs one
 * `SyntaxError: ... is not valid JSON` per line; stricter clients drop the
 * connection outright.
 *
 * Extracted from stdio-wrapper.ts so both stdio entrypoints share one
 * implementation: the published bin (stdio-wrapper.ts) and the direct
 * `node dist/mcp/index.js` path that docs/SELF_HOSTING.md and
 * docs/README_CLAUDE_SETUP.md instruct source installs to use.
 * Prior instances of this bug class: #628, #627, #567.
 *
 * This module must stay dependency-free. Anything it imported would load — and
 * could write to stdout — before the guard is in place.
 */

/** Console methods captured before installation, so callers can still reach the real streams. */
export interface OriginalConsole {
  log: typeof console.log;
  error: typeof console.error;
  warn: typeof console.warn;
  info: typeof console.info;
  debug: typeof console.debug;
}

export interface StdioGuardOptions {
  /**
   * Replace every console method with a no-op.
   *
   * stdio-wrapper.ts sets this, preserving its long-standing behavior. index.ts
   * deliberately does not: logger.error() writes through console.error (see
   * utils/logger.ts), and stderr is the one channel a stdio client can safely
   * surface — Claude Desktop persists it to mcp-server-*.log. Silencing it there
   * would hide diagnostics from exactly the users this guard protects.
   *
   * Suppression is not needed for correctness either way: with the stdout filter
   * installed, a console.log is redirected to stderr rather than corrupting the
   * protocol.
   */
  silenceConsole?: boolean;
}

/**
 * Set on first install so repeat calls are no-ops. The guard is installed from
 * more than one place — the entrypoints install it as early as possible, and
 * N8NDocumentationMCPServer.run() installs it as a backstop for embedders that
 * bypass both. Without this, stdout.write would be wrapped once per call, and a
 * later call without `silenceConsole` would appear to undo an earlier silencing.
 */
let installedGuard: OriginalConsole | null = null;

/**
 * Redirect all non-JSON-RPC stdout to stderr, and optionally silence console.
 *
 * Call as early as possible, and only when running in stdio mode — in http mode
 * stdout is an ordinary output stream and must not be filtered. Idempotent: the
 * first call wins and later calls return the originals it captured.
 *
 * @returns the original console methods, captured before any override
 */
export function installStdioGuard(options: StdioGuardOptions = {}): OriginalConsole {
  if (installedGuard) {
    return installedGuard;
  }

  const originals: OriginalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };

  if (options.silenceConsole) {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};
    console.debug = () => {};
    console.trace = () => {};
    console.dir = () => {};
    console.time = () => {};
    console.timeEnd = () => {};
    console.timeLog = () => {};
    console.group = () => {};
    console.groupEnd = () => {};
    console.table = () => {};
    console.clear = () => {};
    console.count = () => {};
    console.countReset = () => {};
  }

  // Console suppression alone is insufficient — native modules (better-sqlite3),
  // n8n packages, and third-party code call process.stdout.write() directly.
  // Only writes that look like JSON-RPC messages pass through; the rest go to stderr.
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = function (chunk: any, encodingOrCallback?: any, callback?: any): boolean {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    // JSON-RPC messages are JSON objects with a "jsonrpc" field — let those through.
    // The MCP SDK sends one JSON object per write call.
    const trimmed = str.trimStart();
    if (trimmed.startsWith('{') && trimmed.includes('"jsonrpc"')) {
      return originalStdoutWrite(chunk, encodingOrCallback, callback);
    }
    return stderrWrite(chunk, encodingOrCallback, callback);
  } as typeof process.stdout.write;

  installedGuard = originals;
  return originals;
}

/** Test-only: forget the install so a suite can exercise a fresh guard. */
export function resetStdioGuardForTests(): void {
  installedGuard = null;
}
