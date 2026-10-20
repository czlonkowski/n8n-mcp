import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Static drift guard for the `@modelcontextprotocol/sdk` pin.
 *
 * The version is declared in four places, and the bump to 1.30.0 updated the
 * three obvious ones — package.json, package.runtime.json and the Dockerfile
 * builder stage — while leaving the expected version in the fresh-install CI
 * check at 1.28.0. That check installs the packed tarball without a lockfile
 * and fails on any version other than the one hardcoded in it, so the omission
 * did not surface until CI ran.
 *
 * The workflow constant is deliberately hardcoded rather than read from
 * package.json, so that changing the SDK is an explicit edit there. This test
 * keeps that property while removing the failure mode it creates: the four
 * declarations must agree, and disagreeing fails here rather than in CI.
 *
 * Same class of drift as the bin entry in bin-consistency.test.ts.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const SDK = '@modelcontextprotocol/sdk';

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

describe('@modelcontextprotocol/sdk pin consistency', () => {
  const pkg = JSON.parse(read('package.json'));
  const declaredVersion: string = pkg.dependencies[SDK];

  it('package.json pins an exact version', () => {
    // The pin is exact by policy: a range would let a fresh install resolve
    // something other than the version the build is tested against, which is
    // what the CI fresh-install check exists to catch.
    expect(declaredVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package.runtime.json declares the same version', () => {
    const runtime = JSON.parse(read('package.runtime.json'));
    expect(runtime.dependencies[SDK]).toBe(declaredVersion);
  });

  it('the Dockerfile builder stage installs the same version', () => {
    const dockerfile = read('Dockerfile');
    const match = dockerfile.match(/@modelcontextprotocol\/sdk@(\d+\.\d+\.\d+)/);
    expect(match, 'no pinned SDK install found in Dockerfile').toBeTruthy();
    expect(match![1]).toBe(declaredVersion);
  });

  it('the fresh-install CI check expects the same version', () => {
    const workflow = read('.github/workflows/dependency-check.yml');
    // Matches the comparison guarding the resolved version, e.g.
    //   if [[ "$SDK_VERSION" != "1.30.0" ]]; then
    const match = workflow.match(/SDK_VERSION"?\s*!=\s*"(\d+\.\d+\.\d+)"/);
    expect(match, 'no SDK version comparison found in dependency-check.yml').toBeTruthy();
    expect(match![1]).toBe(declaredVersion);
  });
});
