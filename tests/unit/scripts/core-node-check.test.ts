import { describe, it, expect } from 'vitest';
import {
  CANONICAL_CORE_NODES,
  findMissingCoreNodes,
  assertCoreNodesPresent
} from '@/scripts/core-node-check';

/**
 * Guard for the validator FP audit finding: the shipped nodes.db was missing
 * nodes-base.extractFromFile (a core node), producing hard "Unknown node
 * type" errors in 69 workflows. The rebuild flow must fail loudly when any
 * canonical core node is absent after a rebuild.
 */
describe('core-node completeness check', () => {
  const lookupWithAll = { getNode: (_nodeType: string) => ({ nodeType: _nodeType }) };
  const lookupMissing = (...missing: string[]) => ({
    getNode: (nodeType: string) => (missing.includes(nodeType) ? null : { nodeType })
  });

  it('includes the canonical core nodes that regressed or must never regress', () => {
    const required = [
      'nodes-base.extractFromFile',
      'nodes-base.convertToFile',
      'nodes-base.readWriteFile',
      'nodes-base.code',
      'nodes-base.httpRequest',
      'nodes-base.webhook',
      'nodes-base.set',
      'nodes-base.if',
      'nodes-base.switch',
      'nodes-base.merge',
      'nodes-base.splitInBatches',
      'nodes-base.executeWorkflow',
      'nodes-base.respondToWebhook',
      'nodes-base.scheduleTrigger',
      'nodes-base.manualTrigger'
    ];
    for (const nodeType of required) {
      expect(CANONICAL_CORE_NODES).toContain(nodeType);
    }
  });

  it('returns no missing nodes when all core nodes are present', () => {
    expect(findMissingCoreNodes(lookupWithAll)).toEqual([]);
    expect(() => assertCoreNodesPresent(lookupWithAll)).not.toThrow();
  });

  it('reports a single missing core node', () => {
    const lookup = lookupMissing('nodes-base.extractFromFile');
    expect(findMissingCoreNodes(lookup)).toEqual(['nodes-base.extractFromFile']);
  });

  it('throws listing every missing core node', () => {
    const lookup = lookupMissing('nodes-base.extractFromFile', 'nodes-base.merge');
    expect(() => assertCoreNodesPresent(lookup)).toThrow(/nodes-base\.extractFromFile/);
    expect(() => assertCoreNodesPresent(lookup)).toThrow(/nodes-base\.merge/);
  });

  it('treats undefined lookup results as missing', () => {
    const lookup = { getNode: (_nodeType: string) => undefined };
    expect(findMissingCoreNodes(lookup)).toEqual([...CANONICAL_CORE_NODES]);
    expect(() => assertCoreNodesPresent(lookup)).toThrow();
  });
});
