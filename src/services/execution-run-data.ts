/**
 * Helpers for reading n8n execution `runData`.
 *
 * n8n stores execution results as `runData[nodeName]`: an array with one
 * entry per invocation of the node ("run"), not a single entry. Nodes can
 * run more than once in an execution (an AI Agent's Chat Model is called
 * once to decide on a tool and again to produce the final answer), so
 * reading only `nodeData[0]` drops every later invocation.
 *
 * Each run holds its items under a connections object keyed by connection
 * type (`ITaskDataConnections` in n8n-workflow), whose values are arrays of
 * branches (output or input ports), each branch an array of items or
 * `null` when n8n recorded nothing on that port:
 *
 *   { data: { main: [[item, item], null] } }
 *
 * Outputs live under `data`, inputs under `inputOverride`. Regular nodes
 * use the `main` connection type; LangChain AI Agent sub-nodes (Chat
 * Model, Output Parser, Tool, Memory, Embedding, ...) use `ai_*` types
 * instead. Merging keeps branches of different connection types apart, so
 * a node whose runs populate different types still reads correctly.
 */

/** Field of a run holding its connections object. */
export type RunDataField = 'data' | 'inputOverride';

/** One port's items, or `null` when n8n recorded no data on that port. */
export type RunBranch = unknown[] | null;

/** Branches of a connections object grouped by connection type, in the order the keys appear. */
function branchesByType(connections: unknown): Array<[string, RunBranch[]]> {
  if (!connections || typeof connections !== 'object') return [];
  const grouped: Array<[string, RunBranch[]]> = [];
  for (const [type, value] of Object.entries(connections as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    grouped.push([type, value.map(branch => (Array.isArray(branch) ? branch : null))]);
  }
  return grouped;
}

/** Flatten a connections object into its branches, connection types in the order the keys appear. */
export function extractConnectionBranches(connections: unknown): RunBranch[] {
  return branchesByType(connections).flatMap(([, branches]) => branches);
}

/**
 * Merge a node's branches across every run, in run order, so a branch
 * holds its items from run 0, then run 1, and so on. Branches are matched
 * by connection type and port index, and the result lists the types in the
 * order they were first seen, so branch 0 belongs to whichever type a run
 * recorded first. A branch that no run filled stays `null`.
 *
 * `maxPerBranch` caps how many items each merged branch collects, for
 * callers that only show the first N and already know the totals; the
 * cap never changes which items come first.
 */
export function mergeRunBranches(
  nodeData: unknown,
  field: RunDataField = 'data',
  maxPerBranch = -1
): RunBranch[] {
  if (!Array.isArray(nodeData)) return [];

  const byType = new Map<string, RunBranch[]>();
  for (const run of nodeData) {
    for (const [type, branches] of branchesByType(run?.[field])) {
      let merged = byType.get(type);
      if (!merged) {
        merged = [];
        byType.set(type, merged);
      }
      branches.forEach((items, index) => {
        while (merged!.length <= index) merged!.push(null);
        if (items === null) return;
        let target = merged![index];
        if (!Array.isArray(target)) {
          target = [];
          merged![index] = target;
        }
        const room = maxPerBranch < 0 ? items.length : Math.max(0, maxPerBranch - target.length);
        // A loop rather than push(...items): spreading a large branch overflows the call stack.
        for (let i = 0; i < room && i < items.length; i++) target.push(items[i]);
      });
    }
  }

  return [...byType.values()].flat();
}

/**
 * Sample items from a node: its first output branch that carries any,
 * merged across every run. Branch 0 for most nodes; a node that emitted
 * only on a later port (an IF node's false branch) still yields a sample.
 */
export function sampleRunItems(nodeData: unknown, maxItems = -1): unknown[] {
  return mergeRunBranches(nodeData, 'data', maxItems).find(branch => branch && branch.length > 0) ?? [];
}

/** Output items across every run, port and connection type, without copying anything. */
export function countRunItems(nodeData: unknown): number {
  if (!Array.isArray(nodeData)) return 0;
  let count = 0;
  for (const run of nodeData) {
    for (const branch of extractConnectionBranches(run?.data)) count += branch?.length ?? 0;
  }
  return count;
}

/** The first item any run produced, without merging everything to find it. */
export function firstRunItem(nodeData: unknown, field: RunDataField = 'data'): unknown {
  if (!Array.isArray(nodeData)) return undefined;
  for (const run of nodeData) {
    for (const branch of extractConnectionBranches(run?.[field])) {
      if (branch && branch.length > 0) return branch[0];
    }
  }
  return undefined;
}

/** Whether any run recorded an output branch, even an empty one, as opposed to `null` ports only. */
export function hasRunOutputData(nodeData: unknown): boolean {
  if (!Array.isArray(nodeData)) return false;
  return nodeData.some(run => extractConnectionBranches(run?.data).some(Array.isArray));
}

/** The latest `startTime` across a node's runs, 0 when none reported one. */
export function latestStartTime(nodeData: unknown): number {
  if (!Array.isArray(nodeData)) return 0;
  let latest = 0;
  for (const run of nodeData) {
    if (typeof run?.startTime === 'number' && run.startTime > latest) latest = run.startTime;
  }
  return latest;
}

/** Total `executionTime` across every run, or undefined when no run reported one. */
export function totalExecutionTime(nodeData: unknown): number | undefined {
  if (!Array.isArray(nodeData)) return undefined;
  let total: number | undefined;
  for (const run of nodeData) {
    if (typeof run?.executionTime === 'number') total = (total ?? 0) + run.executionTime;
  }
  return total;
}

/**
 * The error from a node's runs, if any. A node invoked several times
 * fails on only one of them, and the last failing run is the one that
 * stopped the branch, so it wins over any earlier error.
 */
export function getRunError(nodeData: unknown): any {
  if (!Array.isArray(nodeData)) return undefined;

  let found: any;
  for (const run of nodeData) {
    if (run?.error) {
      found = run.error;
    }
  }
  return found;
}
