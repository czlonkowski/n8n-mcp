import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Issue #999: connectStdio() used to patch process.stdout.write for Docker /
 * non-TTY environments so that every write was followed by
 * process.stdout.emit('drain'), intending to "force a flush". 'drain' is the
 * signal that the buffer emptied, not a command to empty it, so the patch
 * flushed nothing. It did have an effect, and a harmful one: the MCP SDK's
 * StdioServerTransport.send() waits on once('drain') whenever write() reports
 * backpressure, so a synthetic drain emitted by one write resolves an earlier
 * send whose bytes are still sitting in the stream buffer.
 *
 * This guard fails if a stdout override or synthetic drain emission is ever
 * reintroduced into server.ts. (The legitimate stdout wrapper lives in
 * src/utils/stdio-guard.ts and never touches 'drain'.)
 */
describe('stdio drain contract (issue #999)', () => {
  it('keeps the synthetic-drain patch out of server.ts', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../src/mcp/server.ts'),
      'utf-8'
    );

    expect(source).not.toMatch(/process\.stdout\.write\s*=/);
    expect(source).not.toMatch(/process\.stdout\.emit\s*\(\s*['"]drain['"]/);
  });
});
