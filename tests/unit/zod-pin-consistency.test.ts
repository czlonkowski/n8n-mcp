import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Static drift guard for the `zod` pin (#1232).
 *
 * The published npm package.json is generated from package.runtime.json, not from
 * package.json. package.runtime.json did not list zod, although the compiled server
 * calls require('zod') at startup. Under an isolated install (pnpm, npm
 * --install-strategy=linked) the server failed with "Cannot find module 'zod'". Under
 * a default hoisted install npm resolved zod through @modelcontextprotocol/sdk's
 * `^3.25 || ^4.0` range, which gave Zod 4, where ZodError#errors is undefined.
 *
 * zod is pinned on purpose (see .github/dependabot.yml), so the runtime manifest and
 * the Dockerfile builder stage must carry the same exact version as package.json.
 * Same class of drift as sdk-pin-consistency.test.ts.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

describe('zod pin consistency', () => {
  const pkg = JSON.parse(read('package.json'));
  const declaredVersion: string = pkg.dependencies.zod;

  it('package.json pins an exact Zod 3 version', () => {
    expect(declaredVersion).toMatch(/^3\.\d+\.\d+$/);
  });

  it('package.runtime.json declares the same version', () => {
    // package.runtime.json is the manifest npm users install from, so a missing
    // entry here leaves zod to whatever the SDK's range resolves to.
    const runtime = JSON.parse(read('package.runtime.json'));
    expect(runtime.dependencies.zod).toBe(declaredVersion);
  });

  it('the Dockerfile builder stage installs the same version', () => {
    const dockerfile = read('Dockerfile');
    const match = dockerfile.match(/\bzod@(\d+\.\d+\.\d+)/);
    expect(match, 'no pinned zod install found in Dockerfile').toBeTruthy();
    expect(match![1]).toBe(declaredVersion);
  });
});
