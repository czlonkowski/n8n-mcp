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
});
