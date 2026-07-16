import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, MockInstance } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { N8nNodeLoader } from '@/loaders/node-loader';

/**
 * Regression tests for issue #937: nodes-base.evaluationTrigger was silently
 * dropped from the database. Two compounding causes:
 *
 * 1. The node-name regex only matched `.node.js`/`.node.ts`, so enterprise
 *    `.node.ee.js` paths produced a garbage node name and the named-export
 *    lookup missed.
 * 2. The export fallback took the FIRST module export, which for
 *    EvaluationTrigger is the constant DEFAULT_STARTING_ROW (a number), not
 *    the node class — so a number was passed downstream and parsing failed.
 *
 * These tests exercise the REAL loader against fixture packages on disk.
 */
describe('N8nNodeLoader enterprise (.node.ee.js) modules', () => {
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
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-loader-ee-fixture-'));

    writeFixture('package.json', JSON.stringify({ name: 'fixture-pkg', version: '1.0.0' }));

    // Mirrors n8n-nodes-base EvaluationTrigger.node.ee.js: a non-class export
    // listed BEFORE the node class.
    writeFixture(
      'dist/nodes/Evaluation/EvaluationTrigger/EvaluationTrigger.node.ee.js',
      `const DEFAULT_STARTING_ROW = 2;
      class EvaluationTrigger {
        constructor() {
          this.description = { name: 'evaluationTrigger', displayName: 'Evaluation Trigger', properties: [] };
        }
      }
      module.exports = { DEFAULT_STARTING_ROW, EvaluationTrigger };`
    );

    // Mirrors n8n-nodes-base Evaluation.node.ee.js: single class export.
    writeFixture(
      'dist/nodes/Evaluation/Evaluation/Evaluation.node.ee.js',
      `class Evaluation {
        constructor() {
          this.description = { name: 'evaluation', displayName: 'Evaluation', properties: [] };
        }
      }
      module.exports = { Evaluation };`
    );

    // A module whose export name matches neither the file name nor a default
    // export, with a non-class export first: the fallback must still resolve
    // the class, never a constant.
    writeFixture(
      'dist/nodes/Renamed/Renamed.node.js',
      `const SOME_CONSTANT = 42;
      class InternalName {
        constructor() {
          this.description = { name: 'renamed', displayName: 'Renamed', properties: [] };
        }
      }
      module.exports = { SOME_CONSTANT, InternalName };`
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

  it('extracts the node name from a .node.ee.js path and resolves the class by name', async () => {
    const results = await loadFixturePackage([
      'dist/nodes/Evaluation/EvaluationTrigger/EvaluationTrigger.node.ee.js'
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].nodeName).toBe('EvaluationTrigger');
    expect(typeof results[0].NodeClass).toBe('function');
    const instance = new results[0].NodeClass();
    expect(instance.description.name).toBe('evaluationTrigger');
  });

  it('loads a single-export .node.ee.js module', async () => {
    const results = await loadFixturePackage([
      'dist/nodes/Evaluation/Evaluation/Evaluation.node.ee.js'
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].nodeName).toBe('Evaluation');
    const instance = new results[0].NodeClass();
    expect(instance.description.name).toBe('evaluation');
  });

  it('never resolves a non-class export as the node class', async () => {
    const results = await loadFixturePackage(['dist/nodes/Renamed/Renamed.node.js']);

    expect(results).toHaveLength(1);
    expect(results[0].nodeName).toBe('Renamed');
    expect(typeof results[0].NodeClass).toBe('function');
    const instance = new results[0].NodeClass();
    expect(instance.description.name).toBe('renamed');
  });
});
