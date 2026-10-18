import { describe, it, expect, beforeEach } from 'vitest';
import { MutationTracker } from '../../../src/telemetry/mutation-tracker';
import { MutationToolName, WorkflowMutationData } from '../../../src/telemetry/mutation-types';
import { DiffOperation } from '../../../src/types/workflow-diff';

const defaultOperation: DiffOperation = {
  type: 'updateName',
  name: 'renamed-workflow',
} as any;

const makeBaseData = (overrides: Partial<WorkflowMutationData> = {}): WorkflowMutationData => ({
  sessionId: 'session-1',
  toolName: MutationToolName.UPDATE_PARTIAL,
  userIntent: 'change auth header',
  operations: [defaultOperation],
  workflowBefore: {
    id: 'wf-1',
    name: 'before',
    nodes: [
      {
        id: 'n1',
        name: 'HTTP',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
    ],
    connections: {},
  },
  workflowAfter: {
    id: 'wf-1',
    name: 'after-renamed',
    nodes: [
      {
        id: 'n1',
        name: 'HTTP',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 1,
        position: [0, 0],
        parameters: { newField: 'value' },
      },
    ],
    connections: {},
  },
  mutationSuccess: true,
  durationMs: 12,
  ...overrides,
});

describe('MutationTracker - telemetry redaction', () => {
  let tracker: MutationTracker;

  beforeEach(() => {
    tracker = new MutationTracker();
  });

  it('redacts bearer tokens from updateNode operations', async () => {
    const operations: DiffOperation[] = [
      {
        type: 'updateNode',
        nodeId: 'n1',
        updates: {
          'parameters.headers.Authorization': 'Bearer sk-secret-token-1234567890',
        } as any,
      } as any,
    ];
    const data = makeBaseData({ operations });

    const record = await tracker.processMutation(data, 'user-1');
    expect(record).not.toBeNull();

    const serialized = JSON.stringify(record!.operations);
    expect(serialized).not.toContain('sk-secret-token-1234567890');
    expect(serialized).toMatch(/REDACTED/);
  });

  it('removes free-text fields from operations', async () => {
    const operations: DiffOperation[] = [
      { type: 'addNode', description: 'op description text', node: { name: 'Set', type: 'n8n-nodes-base.set', notes: 'added note text' } } as any,
      { type: 'updateNode', nodeName: 'Set', updates: { notes: 'updated note text', 'parameters.mode': 'raw' } } as any,
      { type: 'patchNodeField', nodeName: 'Set', fieldPath: 'notes', patches: [{ find: 'a', replace: 'patched note text' }] } as any,
      { type: 'patchNodeField', nodeName: 'Set', fieldPath: 'parameters.jsCode', patches: [{ find: 'a', replace: 'b' }] } as any,
      { type: 'setNodeGroups', nodeGroups: [{ name: 'G', nodeNames: ['Set'], description: 'group description text' }] } as any,
    ];
    const data = makeBaseData({ operations });

    const record = await tracker.processMutation(data, 'user-1');
    expect(record).not.toBeNull();

    const serialized = JSON.stringify(record!.operations);
    for (const text of ['op description text', 'added note text', 'updated note text', 'patched note text', 'group description text']) {
      expect(serialized).not.toContain(text);
    }
    const ops = record!.operations as any[];
    expect(ops[1].updates['parameters.mode']).toBe('raw');
    expect(ops[1].updates).not.toHaveProperty('notes');
    expect(ops[3].patches).toEqual([{ find: 'a', replace: 'b' }]);
    expect(ops[4].nodeGroups[0].nodeNames).toEqual(['Set']);
  });

  it('removes node group descriptions from the workflow snapshots', async () => {
    const group = { name: 'G', nodeNames: ['Set'], description: 'snapshot group description' };
    const data = makeBaseData({
      operations: [
        { type: 'updateNode', nodeName: 'Set', updates: { notes: { __patch_find_replace: [{ find: 'a', replace: 'patch note text' }] } } } as any,
        { type: 'updateSettings', settings: { errorWorkflow: 'wf-123', timezone: 'UTC' } } as any,
      ],
    });
    data.workflowBefore = { ...data.workflowBefore, nodeGroups: [group] };
    data.workflowAfter = { ...data.workflowAfter, nodeGroups: [group] };

    const record = await tracker.processMutation(data, 'user-1');
    expect(record).not.toBeNull();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('snapshot group description');
    expect(serialized).not.toContain('patch note text');
    expect((record!.workflowAfter as any).nodeGroups[0].nodeNames).toEqual(['Set']);
    const ops = record!.operations as any[];
    expect(ops[1].settings).toEqual({ timezone: 'UTC' });
  });

  it('removes sticky-note content from operations and snapshots', async () => {
    const sticky = { id: 's1', name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, 0], parameters: { content: 'before sticky text' } };
    const data = makeBaseData({
      operations: [{ type: 'updateNode', nodeName: 'Note', updates: { 'parameters.content': 'after sticky text' } } as any],
    });
    data.workflowBefore = { ...data.workflowBefore, nodes: [...data.workflowBefore.nodes, sticky] };
    data.workflowAfter = { ...data.workflowAfter, nodes: [...data.workflowAfter.nodes, { ...sticky, parameters: { content: 'after sticky text' } }] };

    const record = await tracker.processMutation(data, 'user-1');
    expect(record).not.toBeNull();
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('before sticky text');
    expect(serialized).not.toContain('after sticky text');
  });

  it('redacts apiKey-like field values from operation updates', async () => {
    const operations: DiffOperation[] = [
      {
        type: 'updateNode',
        nodeId: 'n1',
        updates: {
          apiKey: 'super-secret-api-key-value-12345',
          headers: { 'X-Api-Key': 'another-very-long-secret-token-value' },
        } as any,
      } as any,
    ];
    const data = makeBaseData({ operations });

    const record = await tracker.processMutation(data, 'user-1');
    const serialized = JSON.stringify(record!.operations);
    expect(serialized).not.toContain('super-secret-api-key-value-12345');
    expect(serialized).not.toContain('another-very-long-secret-token-value');
  });

  it('redacts secrets from validationBefore and validationAfter', async () => {
    const validationBefore = {
      valid: false,
      errors: [
        { message: 'Invalid token: Bearer sk-secret-validation-token-9999' } as any,
      ],
    } as any;
    const validationAfter = {
      valid: true,
      errors: [],
      warnings: [{ apiKey: 'leaked-secret-key-very-long-value-here' } as any],
    } as any;
    const data = makeBaseData({ validationBefore, validationAfter });

    const record = await tracker.processMutation(data, 'user-1');
    const serializedBefore = JSON.stringify(record!.validationBefore);
    const serializedAfter = JSON.stringify(record!.validationAfter);
    expect(serializedBefore).not.toContain('sk-secret-validation-token-9999');
    expect(serializedAfter).not.toContain('leaked-secret-key-very-long-value-here');
  });

  it('redacts secrets from mutationError messages', async () => {
    const data = makeBaseData({
      mutationSuccess: false,
      mutationError: 'Auth failed for Bearer sk-secret-mutation-error-token-abc',
    });

    const record = await tracker.processMutation(data, 'user-1');
    expect(record!.mutationError).not.toContain('sk-secret-mutation-error-token-abc');
    expect(record!.mutationError).toContain('Bearer [REDACTED]');
  });

  it('preserves operation type and structure for analytics', async () => {
    const operations: DiffOperation[] = [
      { type: 'addNode', node: { id: 'new-node', name: 'X' } } as any,
      { type: 'removeNode', nodeId: 'old-node' } as any,
      { type: 'updateNode', nodeId: 'n1', updates: { name: 'Renamed' } } as any,
    ];
    const data = makeBaseData({ operations });

    const record = await tracker.processMutation(data, 'user-1');
    expect(record!.operationCount).toBe(3);
    expect(record!.operationTypes).toEqual(
      expect.arrayContaining(['addNode', 'removeNode', 'updateNode'])
    );
    expect(Array.isArray(record!.operations)).toBe(true);
    expect(record!.operations).toHaveLength(3);
    expect((record!.operations[0] as any).type).toBe('addNode');
  });

  it('records the post-mutation workflow only, identifying the prior state by hash', async () => {
    const record = await tracker.processMutation(makeBaseData(), 'user-1');

    expect(record).not.toHaveProperty('workflowBefore');
    expect(record!.workflowAfter.name).toBe('after-renamed');
    expect(record!.workflowHashBefore).toBeTruthy();
    expect(record!.workflowStructureHashBefore).toBeTruthy();
    expect(record!.workflowHashBefore).not.toBe(record!.workflowHashAfter);
  });
});
