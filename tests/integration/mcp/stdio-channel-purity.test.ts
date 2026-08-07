import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * The JSON-RPC channel must carry nothing but JSON-RPC.
 *
 * In stdio mode `process.stdout` IS the protocol stream, so a single stray write
 * — a console.log, a dependency banner, a native module diagnostic — is fed
 * straight into the client's JSON parser. Claude Desktop logs one
 * `SyntaxError: ... is not valid JSON` per line; stricter clients disconnect.
 *
 * The regression this guards against: the telemetry first-run notice was
 * console.log'd, so every install with no `~/.n8n-mcp/telemetry.json` pushed 34
 * lines of box-drawing characters onto the channel. Each case below therefore
 * runs against an empty HOME, which is what makes it a *first* run.
 *
 * LOG_LEVEL is deliberately 'info', not the 'error' a real client config uses:
 * the channel has to stay clean at any log level, and suppressing INFO would
 * hide exactly the logger output that leaks when the guard is missing.
 *
 * Related: #628 (parse-error flood on every new chat), #693 (the default bin
 * entry corrupting the transport).
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ENTRYPOINTS = {
  'index.js': path.join(REPO_ROOT, 'dist/mcp/index.js'),
  'stdio-wrapper.js': path.join(REPO_ROOT, 'dist/mcp/stdio-wrapper.js'),
};
const NODES_DB = path.join(REPO_ROOT, 'data/nodes.db');

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'purity-test', version: '1.0.0' },
  },
}) + '\n';

interface Captured {
  stdout: string;
  stderr: string;
}

/**
 * Spawn an entrypoint with a throwaway HOME (so the telemetry first-run notice
 * fires), send one initialize request, then close stdin to trigger shutdown.
 */
async function handshake(entrypoint: string, env: Record<string, string>): Promise<Captured> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-purity-'));
  try {
    // The suite runs with NODE_DB_PATH=':memory:' and NODE_ENV='test' (see
    // tests/setup/test-env.ts). Inheriting those would hand the child an empty
    // database and a test-mode logger, so the child gets the real environment a
    // user's client would give it instead.
    const omit = new Set(['NODE_DB_PATH', 'NODE_ENV', 'TEST_ENVIRONMENT']);
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !omit.has(key)) childEnv[key] = value;
    }
    Object.assign(childEnv, { HOME: home, USERPROFILE: home }, env);

    // Default stdio is 'pipe' on all three streams, which is what we need to
    // read stdout and stderr apart. Options and result are typed explicitly so
    // tsc picks the single no-stdio-override overload.
    // Cast because the repo augments ProcessEnv with a required NODE_ENV, which
    // is precisely one of the variables this child must NOT inherit.
    const options: SpawnOptionsWithoutStdio = {
      cwd: REPO_ROOT,
      env: childEnv as NodeJS.ProcessEnv,
    };
    const child: ChildProcessWithoutNullStreams =
      spawn(process.execPath, [entrypoint], options);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.stdin.write(INITIALIZE);
    child.stdin.end();

    await new Promise<void>((resolve, reject) => {
      child.on('exit', () => resolve());
      child.on('error', reject);
    });

    return { stdout, stderr };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Every non-blank stdout line must be a JSON-RPC object. */
function assertChannelClean(stdout: string) {
  const lines = stdout.split('\n').filter(l => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    let parsed: any;
    expect(
      () => { parsed = JSON.parse(line); },
      `non-JSON line on the protocol channel: ${line.slice(0, 120)}`
    ).not.toThrow();
    expect(parsed.jsonrpc).toBe('2.0');
  }
}

const missingArtifacts = [
  ...Object.entries(ENTRYPOINTS)
    .filter(([, file]) => !fs.existsSync(file))
    .map(([name]) => `${name} (run "npm run build")`),
  ...(fs.existsSync(NODES_DB) ? [] : ['nodes.db (run "npm run rebuild")']),
];

// On CI the workflow builds before this suite, so a missing artifact is a broken
// pipeline and must fail loudly — skipping is how this coverage went unnoticed
// before. Locally, skip with a hint rather than failing a contributor who has
// simply not built yet.
describe.skipIf(missingArtifacts.length > 0 && !process.env.CI)('stdio JSON-RPC channel purity', () => {
  beforeAll(() => {
    if (missingArtifacts.length > 0) {
      throw new Error(`Missing build artifacts: ${missingArtifacts.join(', ')}`);
    }
  });

  for (const [name, entrypoint] of Object.entries(ENTRYPOINTS)) {
    describe(name, () => {
      it('emits only JSON-RPC on stdout during a first-run handshake', async () => {
        const { stdout } = await handshake(entrypoint, { MCP_MODE: 'stdio', LOG_LEVEL: 'info' });
        assertChannelClean(stdout);
      }, 30_000);

      // Only the negative half is asserted here. The notice fires solely when
      // telemetry is not disabled by environment, and the suite disables it
      // globally (vitest.config.ts) so no test run can reach the production
      // backend — re-enabling it for a child process would undo that. That the
      // notice reaches *stderr* is covered directly in
      // tests/unit/telemetry/config-manager.test.ts.
      it('never puts the telemetry notice on the protocol channel', async () => {
        const { stdout } = await handshake(entrypoint, { MCP_MODE: 'stdio', LOG_LEVEL: 'info' });
        expect(stdout).not.toContain('Anonymous Usage Statistics');
        expect(stdout).not.toContain('╔');
      }, 30_000);
    });
  }

  // Transport selection treats anything that is not literally 'http' as stdio,
  // so the guard has to use the same predicate. Keying it on `=== 'stdio'` left
  // these values running the stdio transport with no protection at all.
  describe('noncanonical MCP_MODE values still select stdio', () => {
    for (const mode of ['STDIO', 'stdio ', 'sdtio']) {
      it(`keeps the channel clean for MCP_MODE=${JSON.stringify(mode)}`, async () => {
        const { stdout } = await handshake(ENTRYPOINTS['index.js'], { MCP_MODE: mode, LOG_LEVEL: 'info' });
        assertChannelClean(stdout);
      }, 30_000);
    }
  });
});
