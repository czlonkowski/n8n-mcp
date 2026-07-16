/**
 * Post-rebuild completeness check for canonical core nodes.
 *
 * The shipped database once lacked nodes-base.extractFromFile, so the
 * validator hard-errored ("Unknown node type") on workflows using a valid
 * core node. Any of these missing after a rebuild means the build silently
 * dropped a core node and the database must not be shipped.
 */
export const CANONICAL_CORE_NODES: readonly string[] = [
  'nodes-base.code',
  'nodes-base.convertToFile',
  'nodes-base.evaluation',
  'nodes-base.evaluationTrigger',
  'nodes-base.executeWorkflow',
  'nodes-base.extractFromFile',
  'nodes-base.httpRequest',
  'nodes-base.if',
  'nodes-base.manualTrigger',
  'nodes-base.merge',
  'nodes-base.readWriteFile',
  'nodes-base.respondToWebhook',
  'nodes-base.scheduleTrigger',
  'nodes-base.set',
  'nodes-base.splitInBatches',
  'nodes-base.switch',
  'nodes-base.webhook'
];

export interface CoreNodeLookup {
  /** Returns a truthy value when the node type exists in the database. */
  getNode(nodeType: string): unknown;
}

export function findMissingCoreNodes(lookup: CoreNodeLookup): string[] {
  return CANONICAL_CORE_NODES.filter(nodeType => !lookup.getNode(nodeType));
}

export function assertCoreNodesPresent(lookup: CoreNodeLookup): void {
  const missing = findMissingCoreNodes(lookup);
  if (missing.length > 0) {
    throw new Error(
      `Core node completeness check failed - missing from database: ${missing.join(', ')}. ` +
      'The rebuild dropped canonical core nodes; do not ship this database.'
    );
  }
}
