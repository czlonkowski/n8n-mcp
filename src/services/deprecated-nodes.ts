import { ALL_VERSIONS, normalizeNodeVersion } from '../parsers/node-parser';

/**
 * n8n marks some node types `deprecated: true` in their description. Since n8n 2.44
 * (backported to 2.42.x and 2.43.x patch releases, on by default through
 * N8N_DEPRECATED_NODES_BLOCK) the server refuses to save a workflow that adds such a
 * node or changes one in place. Unchanged nodes, position-only moves, deletion and a
 * move to a non-deprecated typeVersion stay allowed, and saved workflows keep running.
 */

interface NodeDeprecationInfo {
  nodeType: string;
  version?: string | null;
  deprecatedVersions?: string[];
}

const REPLACEMENT_HINTS: Record<string, string> = {
  'nodes-base.function':
    'Replace it with the Code node (n8n-nodes-base.code) in "Run Once for All Items" mode.',
  'nodes-base.functionItem':
    'Replace it with the Code node (n8n-nodes-base.code) in "Run Once for Each Item" mode.',
};

const DEFAULT_HINT = 'Replace it with a supported node or remove it from the workflow.';

/**
 * True when the node's typeVersion (or its default version when omitted) is deprecated.
 * ['*'] marks a plain node, whose one description n8n returns for any typeVersion.
 */
export function isDeprecatedNodeVersion(nodeInfo: NodeDeprecationInfo, typeVersion?: unknown): boolean {
  const deprecated = nodeInfo.deprecatedVersions;
  if (!deprecated || deprecated.length === 0) return false;
  if (deprecated.includes(ALL_VERSIONS)) return true;

  const version = typeVersion ?? nodeInfo.version;
  if (version === undefined || version === null) return true;
  return deprecated.includes(normalizeNodeVersion(version));
}

export function deprecatedNodeReplacementHint(nodeType: string): string {
  return REPLACEMENT_HINTS[nodeType] ?? DEFAULT_HINT;
}

export function deprecatedNodeMessage(workflowNodeType: string): string {
  return (
    `"${workflowNodeType}" is deprecated. n8n 2.44+ (and 2.42.x/2.43.x patch releases) ` +
    'rejects saving a workflow that adds this node or changes it in any way other than moving it; ' +
    'an existing, unchanged node keeps running.'
  );
}
