/**
 * Property-based tests for prototype-pollution resistance of
 * WorkflowDiffEngine.applyDiff (GHSA-ppgm-m8rg-4wqv and the reserved-key
 * guards in src/utils/object-keys.ts).
 *
 * Operations are generated with `__proto__`, `constructor` and `prototype`
 * at random depths: in property paths (dot and bracket syntax), node names,
 * connection outputs and inputs, and as own keys of JSON-parsed payloads
 * (settings, parameters, connection maps). Whatever the engine returns, no
 * built-in prototype may gain a key, and nothing in the resulting workflow may
 * have a prototype other than Object.prototype, Array.prototype or null.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { WorkflowDiffEngine } from '../../../src/services/workflow-diff-engine';

const RESERVED = ['__proto__', 'constructor', 'prototype'] as const;
const MARKER = 'pollutedByPropertyTest';
const NODE_NAMES = ['A', 'B', 'C'];

const buildWorkflow = () => ({
  id: 'wf-1',
  name: 'Pollution',
  nodes: NODE_NAMES.map((name, i) => ({
    id: `id-${name}`,
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [i * 200, 0] as [number, number],
    parameters: { options: {}, assignments: { assignments: [{ name: 'x', value: 'y' }] } },
  })),
  connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
});

// ---------------------------------------------------------------------------
// Pollution detection
// ---------------------------------------------------------------------------

const WATCHED: Array<[string, object]> = [
  ['Object.prototype', Object.prototype],
  ['Array.prototype', Array.prototype],
  ['Function.prototype', Function.prototype],
  ['String.prototype', String.prototype],
  ['Object', Object],
];
const snapshot = () => WATCHED.map(([label, target]) => `${label}:${Object.getOwnPropertyNames(target).sort().join(',')}`);

const cleanUp = () => {
  for (const [, target] of WATCHED) delete (target as any)[MARKER];
};

/** Every reachable object keeps a standard prototype, and the marker is not inherited. */
const assertStandardPrototypes = (value: unknown, path = 'result', seen = new Set<object>()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  expect([Object.prototype, Array.prototype, null].includes(proto), `${path} has a non-standard prototype`).toBe(true);
  expect(MARKER in value && !Object.prototype.hasOwnProperty.call(value, MARKER), `${path} inherits ${MARKER}`).toBe(false);
  for (const key of Object.keys(value)) assertStandardPrototypes((value as any)[key], `${path}.${key}`, seen);
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const reserved = fc.constantFrom(...RESERVED);
const plainKey = fc.constantFrom('parameters', 'options', 'assignments', 'value', 'name', 'x', 'jsCode', 'settings');

/** A dotted path with at least one reserved segment at a random depth. */
const pathWithReserved = fc
  .tuple(fc.array(plainKey, { maxLength: 3 }), reserved, fc.array(fc.oneof(plainKey, reserved), { maxLength: 3 }), fc.boolean())
  .map(([before, bad, after, prefixParams]) => [...(prefixParams ? ['parameters'] : []), ...before, bad, ...after].join('.'));

/** JSON text with a reserved key at a random depth, parsed so it is an own key. */
const pollutingPayload = fc
  .tuple(fc.array(plainKey, { maxLength: 3 }), fc.constantFrom('__proto__', 'constructor.prototype', 'prototype'))
  .map(([wrap, attack]) => {
    let text = JSON.stringify({ [MARKER]: true });
    for (const key of [...wrap, ...attack.split('.')].reverse()) text = `{${JSON.stringify(key)}:${text}}`;
    return JSON.parse(text);
  });

const nodeName = fc.constantFrom(...NODE_NAMES);
const nameOrReserved = fc.oneof(nodeName, reserved);

const operation = fc.oneof(
  fc.record({ type: fc.constant('updateNode'), nodeName, updates: fc.dictionary(pathWithReserved, fc.oneof(fc.constant({ [MARKER]: true }), pollutingPayload, fc.constant(MARKER)), { minKeys: 1, maxKeys: 2 }) }),
  fc.record({ type: fc.constant('updateNode'), nodeName, updates: fc.tuple(plainKey, pollutingPayload).map(([k, v]) => ({ [`parameters.${k}`]: v })) }),
  fc.record({ type: fc.constant('updateNode'), nodeName, updates: reserved.map((name) => ({ name })) }),
  fc.record({ type: fc.constant('patchNodeField'), nodeName, fieldPath: pathWithReserved, patches: fc.constant([{ find: 'y', replace: MARKER }]) }),
  fc.record({ type: fc.constant('addNode'), node: fc.record({ name: fc.oneof(reserved, fc.constant('D')), type: fc.constant('n8n-nodes-base.set'), typeVersion: fc.constant(3.4), position: fc.constant([600, 0]), parameters: pollutingPayload }) }),
  fc.record({ type: fc.constant('addConnection'), source: nameOrReserved, target: nameOrReserved, sourceOutput: fc.option(fc.oneof(reserved, fc.constant('main')), { nil: undefined }), targetInput: fc.option(fc.oneof(reserved, fc.constant('main')), { nil: undefined }) }),
  fc.record({ type: fc.constant('removeConnection'), source: nameOrReserved, target: nameOrReserved, sourceOutput: fc.option(reserved, { nil: undefined }), ignoreErrors: fc.constant(true) }),
  fc.record({ type: fc.constant('rewireConnection'), source: nameOrReserved, from: nameOrReserved, to: nameOrReserved, sourceOutput: fc.option(reserved, { nil: undefined }) }),
  fc.record({ type: fc.constant('updateSettings'), settings: pollutingPayload }),
  fc.record({
    type: fc.constant('replaceConnections'),
    connections: fc.tuple(nameOrReserved, fc.oneof(reserved, fc.constant('main')), nameOrReserved).map(([src, out, dst]) =>
      JSON.parse(`{${JSON.stringify(src)}:{${JSON.stringify(out)}:[[{"node":${JSON.stringify(dst)},"type":"main","index":0}]]}}`)),
  }),
  fc.record({ type: fc.constant('removeNode'), nodeName: nameOrReserved }),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('WorkflowDiffEngine prototype-pollution properties', () => {
  let before: string[];

  beforeEach(() => { before = snapshot(); });
  afterEach(() => {
    const after = snapshot();
    cleanUp();
    expect(after).toEqual(before);
  });

  it('no operation sequence adds a key to a built-in prototype', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(operation, { minLength: 1, maxLength: 5 }),
      fc.boolean(),
      fc.boolean(),
      async (operations, validateOnly, continueOnError) => {
        const engine = new WorkflowDiffEngine();
        await engine.applyDiff(buildWorkflow() as any, { id: 'wf-1', operations, validateOnly, continueOnError } as any);
        const polluted = snapshot().filter((entry, i) => entry !== before[i]);
        cleanUp();
        expect(polluted, JSON.stringify(operations)).toEqual([]);
        expect(({} as any)[MARKER]).toBeUndefined();
      },
    ), { numRuns: 300 });
  });

  it('a workflow returned by applyDiff contains only plain objects and arrays', async () => {
    // Counted so the property cannot pass vacuously because every diff failed.
    let returned = 0;
    await fc.assert(fc.asyncProperty(
      fc.array(operation, { minLength: 1, maxLength: 5 }),
      fc.boolean(),
      async (operations, continueOnError) => {
        const engine = new WorkflowDiffEngine();
        const result = await engine.applyDiff(buildWorkflow() as any, { id: 'wf-1', operations, continueOnError } as any);
        cleanUp();
        if (result.workflow) {
          returned++;
          assertStandardPrototypes(result.workflow);
        }
      },
    ), { numRuns: 300 });
    expect(returned).toBeGreaterThan(30);
  });
});
