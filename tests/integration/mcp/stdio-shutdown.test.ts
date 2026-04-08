import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { once } from 'events';
import path from 'path';
import fs from 'fs';

/**
 * Regression tests for Issue #711:
 * "Container stdio path ignores stdin close; default npx process exits only
 * after SIGTERM"
 *
 * The published bin entry for `npx n8n-mcp` is `dist/mcp/stdio-wrapper.js`
 * (after the release.yml fix in v2.47.5 — before that, the CI workflow
 * shipped `dist/mcp/index.js` as the bin despite `package.json` specifying
 * the wrapper). The wrapper registers stdin `end`/`close` handlers
 * unconditionally, so closing stdin terminates the process in every
 * environment, which is what Issue #711 was asking for.
 *
 * We deliberately do NOT spawn `dist/mcp/index.js` here: that path is used
 * by the Docker entrypoint's root-switch code, which relies on the
 * container guard in index.ts to keep detached containers alive for their
 * signal-based lifecycle (see `docker-entrypoint.sh` line 122 and the
 * `isContainerEnvironment()` guard in `src/mcp/index.ts`). Testing the
 * wrapper matches the `npx` path real users hit.
 *
 * Notes:
 * - `DISABLE_CONSOLE_OUTPUT=1` + `LOG_LEVEL=error` keep the child quiet.
 * - `MCP_MODE` is forced to stdio by the wrapper itself — no need to set it.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WRAPPER_JS = path.join(REPO_ROOT, 'dist/mcp/stdio-wrapper.js');
const NODES_DB = path.join(REPO_ROOT, 'data/nodes.db');
const SHUTDOWN_BUDGET_MS = 5_000;

function spawnServer(env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, [WRAPPER_JS], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DISABLE_CONSOLE_OUTPUT: 'true',
      LOG_LEVEL: 'error',
      ...env,
    },
    // stdin must be 'pipe' so we can close it; stdout/stderr 'ignore' so the
    // child can never block on a full pipe buffer (e.g. if the telemetry
    // first-run banner grows beyond 64KB) and we don't leak handles.
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

/**
 * Give the child a fixed budget to finish importing modules and registering
 * its stdin/signal handlers before we attempt to close stdin or signal it.
 *
 * We deliberately do NOT key off a server-side readiness signal. The server
 * suppresses all stdout/stderr in stdio mode (see `src/utils/logger.ts`), so
 * there is nothing observable to wait on without polluting production code
 * with a test-only token. 500ms is a comfortable margin: the MCP SDK and
 * n8n-nodes-base load in ~300–400ms on CI, and stdin handlers register
 * synchronously right after imports at `src/mcp/index.ts` (see the stdin
 * block near Issue #711).
 */
const SERVER_READY_WAIT_MS = 500;

async function waitForServerAlive(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SERVER_READY_WAIT_MS));
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Wait for the child to exit within `budgetMs`. Returns `'timeout'` if the
 * budget expires (and force-kills the child so vitest doesn't hang).
 * Returning `{ code, signal }` keeps callers honest — relying on just `code`
 * would mask signal-only exits (code is null when the process is killed).
 */
async function expectExitWithin(
  child: ChildProcess,
  budgetMs: number,
): Promise<ExitResult | 'timeout'> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  let budgetTimer: NodeJS.Timeout | undefined;
  const timer = new Promise<'timeout'>((resolve) => {
    budgetTimer = setTimeout(() => resolve('timeout'), budgetMs);
  });
  const exited = once(child, 'exit').then(([code, signal]): ExitResult => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
  }));
  const result = await Promise.race([exited, timer]);
  clearTimeout(budgetTimer);
  if (result === 'timeout') {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  return result;
}

const wrapperMissing = !fs.existsSync(WRAPPER_JS);
const dbMissing = !fs.existsSync(NODES_DB);

describe.skipIf(wrapperMissing || dbMissing)('stdio shutdown on stdin close (Issue #711)', () => {
  beforeAll(() => {
    if (wrapperMissing) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping: ${WRAPPER_JS} not found. Run \`npm run build\` before the integration suite.`,
      );
    }
    if (dbMissing) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping: ${NODES_DB} not found. Run \`npm run rebuild\` before the integration suite.`,
      );
    }
  });

  it('exits on stdin close with IS_DOCKER=true (the Issue #711 repro)', async () => {
    const child = spawnServer({ IS_DOCKER: 'true' });
    await waitForServerAlive();
    child.stdin?.end();
    const result = await expectExitWithin(child, SHUTDOWN_BUDGET_MS);
    expect(result).not.toBe('timeout');
  });

  it('exits on stdin close without container env (regression guard)', async () => {
    const child = spawnServer({ IS_DOCKER: '', IS_CONTAINER: '' });
    await waitForServerAlive();
    child.stdin?.end();
    const result = await expectExitWithin(child, SHUTDOWN_BUDGET_MS);
    expect(result).not.toBe('timeout');
  });

  it('exits on SIGTERM with IS_DOCKER=true (existing path still works)', async () => {
    const child = spawnServer({ IS_DOCKER: 'true' });
    await waitForServerAlive();
    child.kill('SIGTERM');
    const result = await expectExitWithin(child, SHUTDOWN_BUDGET_MS);
    expect(result).not.toBe('timeout');
  });
});
