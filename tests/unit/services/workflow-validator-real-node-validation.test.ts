import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowValidator } from '@/services/workflow-validator';
import { NodeRepository } from '@/database/node-repository';
import { EnhancedConfigValidator } from '@/services/enhanced-config-validator';

// EnhancedConfigValidator is deliberately NOT mocked here, unlike every sibling suite. It runs
// before the condition-structure check, so a malformed entry in a filter's `conditions` or a
// Switch's `rules.values` threw inside it and surfaced as "Failed to validate node: <TypeError>"
// - invisible to suites that replace it with a stub (#1094).
vi.mock('@/database/node-repository');
vi.mock('@/utils/logger');

describe('WorkflowValidator with the real EnhancedConfigValidator (#1094)', () => {
  let validator: WorkflowValidator;

  const nodeTypes: Record<string, any> = {
    'nodes-base.manualTrigger': { type: 'nodes-base.manualTrigger', displayName: 'Manual Trigger', package: 'n8n-nodes-base', isTrigger: true, version: 1, isVersioned: true, outputs: ['main'], properties: [] },
    'nodes-base.if': { type: 'nodes-base.if', displayName: 'IF', package: 'n8n-nodes-base', version: 2, isVersioned: true, outputs: ['main', 'main'], properties: [{ name: 'conditions', displayName: 'Conditions', type: 'filter', default: {} }] },
    'nodes-base.switch': { type: 'nodes-base.switch', displayName: 'Switch', package: 'n8n-nodes-base', version: 3, isVersioned: true, outputs: ['main', 'main'], properties: [{ name: 'rules', displayName: 'Rules', type: 'fixedCollection', default: {} }] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const repository = new NodeRepository({} as any) as any;
    if (!repository.getNode) repository.getNode = vi.fn();
    if (!repository.getAllNodes) repository.getAllNodes = vi.fn();
    vi.mocked(repository.getNode).mockImplementation((type: string) => nodeTypes[type] ?? null);
    vi.mocked(repository.getAllNodes).mockReturnValue(Object.values(nodeTypes));
    validator = new WorkflowValidator(repository, EnhancedConfigValidator);
  });

  const trigger = { id: '1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0] as [number, number], parameters: {} };
  const connections = { Start: { main: [[{ node: 'N', type: 'main', index: 0 }]] } };

  const validate = (type: string, typeVersion: number, parameters: unknown) =>
    validator.validateWorkflow({
      name: 'Malformed parameters',
      nodes: [trigger, { id: '2', name: 'N', type, typeVersion, position: [200, 0], parameters }],
      connections,
    } as any);

  it.each([
    { label: 'an IF condition entry that is not an object', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { conditions: [null] } } },
    { label: 'a Switch rules.values entry that is not an object', type: 'n8n-nodes-base.switch', typeVersion: 3.2, parameters: { rules: { values: [null] } } },
    { label: 'a Switch rules.rules entry that is not an object', type: 'n8n-nodes-base.switch', typeVersion: 3.2, parameters: { rules: { rules: [null] } } },
  ])('does not leak a TypeError for $label', async ({ type, typeVersion, parameters }) => {
    const result = await validate(type, typeVersion, parameters);

    expect(result.errors.some(e => /Failed to validate node:|Cannot read propert|Workflow validation failed:/.test(e.message))).toBe(false);
  });

  it('reports the missing operator on an IF condition entry that is not an object', async () => {
    const result = await validate('n8n-nodes-base.if', 2.2, { conditions: { conditions: [null] } });

    expect(result.errors.some(e => /conditions\.conditions\[0\]\.operator: operator is missing or not an object/.test(e.message))).toBe(true);
  });

  // WorkflowValidator runs the same operator check twice: once via EnhancedConfigValidator
  // (which reads `@version`) and once as a direct validateConditionNodeStructure call. The
  // direct call skips any message the config validator already reported, so this still comes
  // back exactly once rather than twice.
  it('reports a malformed IF operator exactly once', async () => {
    const result = await validate('n8n-nodes-base.if', 2.2, {
      conditions: { conditions: [{ id: '1', leftValue: 'x', operator: { type: 'string' }, rightValue: 'y' }] },
    });

    const message = 'conditions.conditions[0].operator: missing required field "operation". Operation specifies the comparison type (e.g., "equals", "contains", "notEmpty")';
    expect(result.errors.filter(e => e.message === message)).toHaveLength(1);
  });

  it('reports two distinct malformed operators on the same IF node, each exactly once', async () => {
    const result = await validate('n8n-nodes-base.if', 2.2, {
      conditions: {
        conditions: [
          { id: '1', leftValue: 'x', operator: { type: 'string' }, rightValue: 'y' },
          { id: '2', leftValue: 'a', operator: { operation: 'equals' }, rightValue: 'b' },
        ],
      },
    });

    const message0 = 'conditions.conditions[0].operator: missing required field "operation". Operation specifies the comparison type (e.g., "equals", "contains", "notEmpty")';
    const message1 = 'conditions.conditions[1].operator: missing required field "type". Must be a data type: "string", "number", "boolean", "dateTime", "array", "object", "any"';

    expect(result.errors.filter(e => e.message === message0)).toHaveLength(1);
    expect(result.errors.filter(e => e.message === message1)).toHaveLength(1);
  });

  it('still validates a well-formed IF node', async () => {
    const result = await validate('n8n-nodes-base.if', 2, {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
        conditions: [{ leftValue: '={{ $json.x }}', rightValue: 'a', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
    });

    expect(result.errors).toHaveLength(0);
  });
});
