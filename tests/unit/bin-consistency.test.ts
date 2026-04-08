import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Static drift guard for the published `bin` entry (Issue #693 + Issue #711).
 *
 * Commit bc191b0 (v2.45.1) switched the bin from `dist/mcp/index.js` to
 * `dist/mcp/stdio-wrapper.js` to stop INFO logs from corrupting JSON-RPC
 * (Issue #693). It updated `package.json`, `scripts/publish-npm.sh`, and
 * `scripts/publish-npm-quick.sh` — but missed `.github/workflows/release.yml`,
 * which is the path CI actually uses to publish. Result: every CI release
 * from v2.45.1 through v2.47.4 shipped `bin: dist/mcp/index.js`, and Issue
 * #711 then surfaced as a symptom of the still-index.js bin path.
 *
 * This test catches the same class of drift by asserting all four locations
 * agree on `stdio-wrapper.js`.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXPECTED_BIN = './dist/mcp/stdio-wrapper.js';

describe('bin entry consistency (Issue #693 / Issue #711)', () => {
  it('package.json bin points to stdio-wrapper', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.bin).toEqual({ 'n8n-mcp': EXPECTED_BIN });
  });

  it.each([
    'scripts/publish-npm.sh',
    'scripts/publish-npm-quick.sh',
    '.github/workflows/release.yml',
  ])('%s writes stdio-wrapper as the bin entry', (relPath) => {
    const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
    // Match the shared pattern: `pkg.bin = { 'n8n-mcp': './dist/mcp/<something>.js' }`
    const binAssignments = content.match(
      /pkg\.bin\s*=\s*\{\s*['"]n8n-mcp['"]\s*:\s*['"]([^'"]+)['"]\s*\}/g,
    );
    expect(binAssignments, `no pkg.bin assignment found in ${relPath}`).toBeTruthy();
    for (const assignment of binAssignments!) {
      expect(assignment).toContain(EXPECTED_BIN);
    }
  });
});
