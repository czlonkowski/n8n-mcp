import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, MockInstance } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { N8nNodeLoader } from '@/loaders/node-loader';

/**
 * Regression tests for the validator FP audit finding: a node module whose
 * require() throws MODULE_NOT_FOUND on a missing optional peer dependency
 * (e.g. @n8n/n8n-nodes-langchain's EmbeddingsHuggingFaceInference requiring
 * @huggingface/inference) was silently dropped from the database.
 *
 * These tests exercise the REAL loader against fixture packages on disk.
 */
describe('N8nNodeLoader optional dependency handling', () => {
  let fixtureDir: string;
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleWarnSpy: MockInstance;

  const writeFixture = (relPath: string, content: string) => {
    const fullPath = path.join(fixtureDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-loader-fixture-'));

    writeFixture('package.json', JSON.stringify({ name: 'fixture-pkg', version: '1.0.0' }));

    // Healthy node
    writeFixture(
      'dist/nodes/Good/Good.node.js',
      `class Good {
        constructor() {
          this.description = { name: 'good', displayName: 'Good', properties: [] };
        }
      }
      module.exports = { Good };`
    );

    // Node whose top-level require chain pulls in a missing optional peer dep
    // (mirrors EmbeddingsHuggingFaceInference -> @langchain/community -> @huggingface/inference)
    writeFixture(
      'dist/nodes/OptionalDep/OptionalDep.node.js',
      `const missing = require('@n8n-mcp-test/definitely-not-installed');
      class OptionalDep {
        constructor() {
          this.description = { name: 'optionalDep', displayName: 'Optional Dep', properties: [] };
        }
        supplyData() {
          return new missing.SomeRuntimeClass();
        }
      }
      module.exports = { OptionalDep };`
    );

    // Node that fails for a non-resolution reason: must still fail
    writeFixture(
      'dist/nodes/Broken/Broken.node.js',
      `throw new Error('evaluation exploded');`
    );

    // Node whose top-level require targets a missing RELATIVE sibling. Unlike a
    // bare optional peer dep, a missing local file is a real packaging bug and
    // must fail loudly, not be silently stubbed.
    writeFixture(
      'dist/nodes/RelativeDep/RelativeDep.node.js',
      `const helper = require('./missing-sibling');
      class RelativeDep {
        constructor() {
          this.description = { name: 'relativeDep', displayName: 'Relative Dep', properties: [] };
        }
      }
      module.exports = { RelativeDep };`
    );
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  const loadFixturePackage = async (nodePaths: string[]) => {
    const loader = new N8nNodeLoader();
    const packageJson = { n8n: { nodes: nodePaths } };
    return (loader as any).loadPackageNodes('fixture-pkg', fixtureDir, packageJson);
  };

  it('still indexes a node whose optional peer dependency is not installed', async () => {
    const results = await loadFixturePackage(['dist/nodes/OptionalDep/OptionalDep.node.js']);

    expect(results).toHaveLength(1);
    expect(results[0].nodeName).toBe('OptionalDep');
    const instance = new results[0].NodeClass();
    expect(instance.description.name).toBe('optionalDep');

    // The degraded load must be visible in the build output
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('@n8n-mcp-test/definitely-not-installed')
    );
  });

  it('one failing node does not hide sibling nodes', async () => {
    const results = await loadFixturePackage([
      'dist/nodes/Broken/Broken.node.js',
      'dist/nodes/OptionalDep/OptionalDep.node.js',
      'dist/nodes/Good/Good.node.js'
    ]);

    expect(results.map((r: any) => r.nodeName).sort()).toEqual(['Good', 'OptionalDep']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Broken'),
      expect.stringContaining('evaluation exploded')
    );
  });

  it('does not stub the node entry file itself when it is missing', async () => {
    const results = await loadFixturePackage(['dist/nodes/Missing/Missing.node.js']);

    expect(results).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing.node.js'),
      expect.any(String)
    );
  });

  it('does not swallow non-resolution evaluation errors (guard)', async () => {
    const results = await loadFixturePackage(['dist/nodes/Broken/Broken.node.js']);

    expect(results).toHaveLength(0);
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('stubbed')
    );
  });

  it('does not stub a missing relative sibling — a real packaging bug must fail loudly', async () => {
    const results = await loadFixturePackage(['dist/nodes/RelativeDep/RelativeDep.node.js']);

    expect(results).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('RelativeDep.node.js'),
      expect.stringContaining('missing-sibling')
    );
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('stubbed')
    );
  });
});
