/**
 * Canvas group (`nodeGroups`) helpers.
 *
 * n8n 2.28+ stores canvas groups on the workflow as
 * `nodeGroups: [{ id, name, nodeIds, description? }]`. Groups are presentational, but n8n
 * validates them on every write: when a PUT omits `nodeGroups`, the server backfills the STORED
 * groups and validates them against the submitted nodes/connections. A workflow whose group has
 * lost a member, or whose members are no longer a single connected run, is rejected with HTTP 400 —
 * so an edit that has nothing to do with grouping fails.
 *
 * This module keeps two responsibilities strictly apart:
 *
 * 1. **Repair** — only changes that are safe on every n8n version: drop per-group keys the API's
 *    `additionalProperties: false` group schema rejects, prune node IDs that no longer exist, and
 *    drop groups left with no members.
 *
 * 2. **Error classification** — n8n's own rejection messages name the offending group, so topology
 *    is adjudicated by the server rather than re-implemented here. Reimplementing it would pin us
 *    to one n8n minor: the shared validator combines an all-connection-type connectivity search
 *    with main-only entry/exit extraction and node-type metadata for trigger detection, and those
 *    rules change between releases. A local copy that disagreed with the server would silently
 *    delete groups the server would have accepted.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowNodeGroup, Workflow, WorkflowNode } from '../types/n8n-api';
import { normalizeMcpJsonValue } from '../utils/mcp-input-normalizer';

/** Keys the n8n API accepts inside a group object (its schema is `additionalProperties: false`). */
const GROUP_KEYS = ['id', 'name', 'nodeIds', 'description'] as const;

/** n8n's cap on a group description (n8n 2.32+). */
export const GROUP_DESCRIPTION_MAX_LENGTH = 155;

/**
 * A group as the n8n API takes it, for tools that write whole workflows: members are node IDs,
 * because the caller is sending those nodes in the same payload. The diff operation
 * (`setNodeGroups`) additionally accepts node names — see types/workflow-diff.ts.
 *
 * A missing id is filled in, since n8n requires one.
 */
export const nodeGroupInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  nodeIds: z.array(z.string().trim().min(1)).min(1),
  description: z.string().trim().max(GROUP_DESCRIPTION_MAX_LENGTH).optional()
});

export type NodeGroupInput = z.infer<typeof nodeGroupInputSchema>;

/**
 * Parse a tool's `nodeGroups` argument.
 *
 * Declared as a loose field in the tool schemas and validated here (the same shape `settings`
 * uses), because nesting `.optional()` inside a `z.preprocess` defeats Zod's inference for the
 * whole enclosing object.
 *
 * `null` counts as "not provided" — some MCP clients serialize every optional field (issue #774).
 * Callers must keep "absent" and "empty array" apart: `[]` ungroups everything, absent leaves the
 * stored groups alone.
 *
 * @throws ZodError when the value is present but malformed
 */
export function parseNodeGroupsInput(value: unknown): WorkflowNodeGroup[] | undefined {
  if (value === undefined || value === null) return undefined;
  const groups = z.array(nodeGroupInputSchema).parse(normalizeMcpJsonValue(value));
  return normalizeGroupInput(groups);
}

/** Fill in the ids n8n requires. Kept out of the schema so tool input types stay simple. */
export function normalizeGroupInput(groups: NodeGroupInput[]): WorkflowNodeGroup[] {
  return groups.map(group => {
    const normalized: WorkflowNodeGroup = {
      id: group.id ?? uuidv4(),
      name: group.name,
      nodeIds: group.nodeIds
    };
    if (group.description) normalized.description = group.description;
    return normalized;
  });
}

export interface NodeGroupIssue {
  /** Stable code for programmatic use. */
  code:
    | 'group-member-removed'
    | 'group-empty'
    | 'group-unknown-keys'
    | 'group-duplicate-name'
    | 'group-node-in-multiple-groups'
    | 'group-contains-trigger'
    | 'group-rejected-by-n8n';
  /** Group name, or the group id when the name is unusable. */
  group: string;
  /** One user-facing sentence. */
  message: string;
}

export interface RepairResult {
  /**
   * Repaired groups, or undefined when the workflow carried none. The same array reference is
   * returned when nothing needed repair.
   */
  nodeGroups?: WorkflowNodeGroup[];
  issues: NodeGroupIssue[];
}

/** True when the value looks like a usable group object. */
function isGroupLike(value: unknown): value is WorkflowNodeGroup {
  if (typeof value !== 'object' || value === null) return false;
  const group = value as Record<string, unknown>;
  return typeof group.id === 'string' && typeof group.name === 'string' && Array.isArray(group.nodeIds);
}

/** Label used in messages: the name when present, else the id. */
function groupLabel(group: WorkflowNodeGroup): string {
  return group.name?.trim() ? group.name : group.id;
}

export function hasNodeGroups(workflow: Pick<Workflow, 'nodeGroups'>): boolean {
  return Array.isArray(workflow.nodeGroups) && workflow.nodeGroups.length > 0;
}

/**
 * Reduce each group to the keys the API accepts. `description` only exists on n8n 2.32+; older
 * instances reject the whole write when it is present, so it is opt-in.
 */
export function sanitizeGroupsForApi(
  groups: unknown,
  options: { includeDescription: boolean }
): WorkflowNodeGroup[] {
  if (!Array.isArray(groups)) return [];

  const allowed = options.includeDescription
    ? GROUP_KEYS
    : GROUP_KEYS.filter(key => key !== 'description');

  return groups.filter(isGroupLike).map(group => {
    const sanitized: Record<string, unknown> = {};
    for (const key of allowed) {
      if (group[key] !== undefined) sanitized[key] = group[key];
    }
    sanitized.nodeIds = group.nodeIds.filter(id => typeof id === 'string');
    return sanitized as unknown as WorkflowNodeGroup;
  });
}

/**
 * Prune group members that no longer exist and drop groups left empty.
 *
 * Deliberately limited to changes no n8n version can disagree with. Topology violations are left
 * for the server: see the module docblock.
 */
export function repairNodeGroups(workflow: Pick<Workflow, 'nodes' | 'nodeGroups'>): RepairResult {
  const groups = workflow.nodeGroups;
  if (!Array.isArray(groups) || groups.length === 0) {
    return { nodeGroups: groups, issues: [] };
  }

  const knownIds = new Set(
    (workflow.nodes ?? []).map(node => node?.id).filter((id): id is string => typeof id === 'string')
  );
  const issues: NodeGroupIssue[] = [];
  const repaired: WorkflowNodeGroup[] = [];
  let changed = false;

  for (const group of groups) {
    if (!isGroupLike(group)) {
      changed = true; // malformed entries can only break the write
      continue;
    }

    const label = groupLabel(group);
    const keptIds = group.nodeIds.filter(id => typeof id === 'string' && knownIds.has(id));
    const removedCount = group.nodeIds.length - keptIds.length;

    if (keptIds.length === 0) {
      changed = true;
      issues.push({
        code: 'group-empty',
        group: label,
        message: `Node group "${label}" was removed because none of its nodes are left in the workflow.`
      });
      continue;
    }

    if (removedCount > 0) {
      changed = true;
      issues.push({
        code: 'group-member-removed',
        group: label,
        message: `Node group "${label}" lost ${removedCount} member${removedCount === 1 ? '' : 's'} that no longer exist in the workflow; the group was kept with its remaining ${keptIds.length} node${keptIds.length === 1 ? '' : 's'}.`
      });
      repaired.push({ ...group, nodeIds: keptIds });
      continue;
    }

    repaired.push(group);
  }

  return { nodeGroups: changed ? repaired : groups, issues };
}

/**
 * Non-blocking consistency checks for the offline validator. These never repair anything; they
 * report what n8n is likely to reject. `isTrigger` should resolve node-type metadata (the node
 * database), because a node type's name does not reliably indicate whether it is a trigger.
 */
export function checkNodeGroups(
  workflow: Pick<Workflow, 'nodes' | 'nodeGroups'>,
  options: { isTrigger?: (node: WorkflowNode) => boolean } = {}
): NodeGroupIssue[] {
  const groups = workflow.nodeGroups;
  if (!Array.isArray(groups) || groups.length === 0) return [];

  const issues: NodeGroupIssue[] = [];
  const nodesById = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes ?? []) {
    if (node?.id) nodesById.set(node.id, node);
  }

  const seenNames = new Set<string>();
  const groupByNodeId = new Map<string, string>();

  for (const group of groups) {
    if (!isGroupLike(group)) continue;
    const label = groupLabel(group);

    if (seenNames.has(group.name)) {
      issues.push({
        code: 'group-duplicate-name',
        group: label,
        message: `Two node groups are named "${group.name}"; n8n requires group names to be unique.`
      });
    }
    seenNames.add(group.name);

    if (group.nodeIds.length === 0) {
      issues.push({
        code: 'group-empty',
        group: label,
        message: `Node group "${label}" has no members; n8n rejects empty groups.`
      });
    }

    for (const nodeId of group.nodeIds) {
      const node = nodesById.get(nodeId);
      if (!node) {
        issues.push({
          code: 'group-member-removed',
          group: label,
          message: `Node group "${label}" references node ID "${nodeId}", which is not in the workflow.`
        });
        continue;
      }

      const owner = groupByNodeId.get(nodeId);
      if (owner) {
        issues.push({
          code: 'group-node-in-multiple-groups',
          group: label,
          message: `Node "${node.name}" is in both "${owner}" and "${label}"; a node can only belong to one group.`
        });
      } else {
        groupByNodeId.set(nodeId, label);
      }

      if (options.isTrigger?.(node)) {
        issues.push({
          code: 'group-contains-trigger',
          group: label,
          message: `Node group "${label}" contains trigger node "${node.name}"; n8n does not allow triggers inside a group.`
        });
      }
    }
  }

  return issues;
}

/** Remove one group by name, matched exactly as n8n reported it. */
export function dropGroupByName(
  groups: WorkflowNodeGroup[],
  name: string
): { groups: WorkflowNodeGroup[]; dropped: WorkflowNodeGroup | null } {
  const index = groups.findIndex(group => group.name === name);
  if (index === -1) return { groups, dropped: null };
  const dropped = groups[index];
  return { groups: groups.filter((_, i) => i !== index), dropped };
}

export type GroupErrorKind =
  /** The instance's group schema has no `description` property (n8n 2.28–2.31). */
  | 'schema-description'
  /** The instance's workflow schema has no `nodeGroups` property at all (before n8n 2.28). */
  | 'schema-field'
  /** The instance accepts the field but rejects these groups (dangling member, broken shape, ...). */
  | 'semantic'
  /** Nothing to do with groups. */
  | 'unrelated';

export interface GroupErrorClassification {
  kind: GroupErrorKind;
  /** Group name n8n named in the message, when it named one. */
  groupName?: string;
  /** n8n's own message, for surfacing to the caller. */
  message: string;
}

/**
 * Decide whether a failed write was rejected because of `nodeGroups`, and if so how.
 *
 * Only HTTP 400 responses are considered, and the distinction between "this field does not exist
 * on this instance" (a schema error, worth remembering) and "these particular groups are invalid"
 * (a semantic error, never worth remembering) is what keeps the capability memo from being
 * poisoned by a normal validation failure.
 */
export function classifyGroupError(
  error: unknown,
  sentGroups: WorkflowNodeGroup[]
): GroupErrorClassification {
  const apiError = error as { statusCode?: number; message?: string; details?: unknown } | null;
  const message = typeof apiError?.message === 'string' ? apiError.message : '';

  if (!apiError || apiError.statusCode !== 400 || sentGroups.length === 0) {
    return { kind: 'unrelated', message };
  }

  let detailsText = '';
  try {
    detailsText = apiError.details === undefined ? '' : JSON.stringify(apiError.details);
  } catch {
    detailsText = '';
  }
  const haystack = `${message} ${detailsText}`;

  // Schema rejection. n8n (express-openapi-validator) reports unknown properties as
  // "request/body must NOT have additional properties", sometimes with the offending path in
  // details. A nested path (`/nodeGroups/0`) means the group object has an unsupported key —
  // in practice `description`, which only exists on n8n 2.32+.
  if (/must NOT have additional propert/i.test(haystack)) {
    if (/nodeGroups\/\d+/.test(haystack) || /description/i.test(haystack)) {
      return { kind: 'schema-description', message };
    }
    // A generic complaint with no path: try the narrower fix first when it could apply.
    if (sentGroups.some(group => group.description !== undefined)) {
      return { kind: 'schema-description', message };
    }
    return { kind: 'schema-field', message };
  }

  // Semantic rejection. Every violation message from n8n's group validator names the group,
  // e.g. `Group "Transform records" references node ID "..." that does not exist in the
  // workflow.` or `Node group "Transform records" (<id>) must form a single connected subgraph
  // with a single entry and exit.`
  const named = /(?:node group|group)\s+"([^"]+)"/i.exec(haystack);
  if (named) {
    return { kind: 'semantic', groupName: named[1], message };
  }
  if (/nodeGroups/.test(haystack)) {
    return { kind: 'semantic', message };
  }

  return { kind: 'unrelated', message };
}
