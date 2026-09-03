import { describe, it, expect } from 'vitest';
import {
  classifyGroupError,
  checkNodeGroups,
  dropRejectedGroup,
  parseNodeGroupsInput,
  repairNodeGroups,
  sanitizeGroupsForApi,
} from '../../../src/services/node-groups';
import { N8nApiError } from '../../../src/utils/n8n-errors';
import { Workflow, WorkflowNode } from '../../../src/types/n8n-api';

const node = (id: string, name: string, type = 'n8n-nodes-base.set'): WorkflowNode => ({
  id,
  name,
  type,
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
});

const workflow = (nodes: WorkflowNode[], nodeGroups: any[]): Pick<Workflow, 'nodes' | 'nodeGroups'> => ({
  nodes,
  nodeGroups,
});

describe('node-groups', () => {
  describe('repairNodeGroups', () => {
    it('prunes a member that no longer exists but keeps the group', () => {
      const result = repairNodeGroups(
        workflow([node('a', 'Set A'), node('b', 'Set B')], [
          { id: 'g1', name: 'Transform', nodeIds: ['a', 'b', 'gone'] },
        ])
      );

      expect(result.nodeGroups).toEqual([{ id: 'g1', name: 'Transform', nodeIds: ['a', 'b'] }]);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('group-member-removed');
      expect(result.issues[0].message).toContain('Transform');
    });

    it('drops a group whose members are all gone', () => {
      const result = repairNodeGroups(
        workflow([node('a', 'Set A')], [{ id: 'g1', name: 'Transform', nodeIds: ['x', 'y'] }])
      );

      expect(result.nodeGroups).toEqual([]);
      expect(result.issues[0].code).toBe('group-empty');
    });

    it('keeps other groups when one is dropped', () => {
      const result = repairNodeGroups(
        workflow([node('a', 'Set A')], [
          { id: 'g1', name: 'Gone', nodeIds: ['x'] },
          { id: 'g2', name: 'Kept', nodeIds: ['a'] },
        ])
      );

      expect(result.nodeGroups).toEqual([{ id: 'g2', name: 'Kept', nodeIds: ['a'] }]);
    });

    it('returns the same array reference when nothing needs repair', () => {
      const groups = [{ id: 'g1', name: 'Transform', nodeIds: ['a'] }];
      const result = repairNodeGroups(workflow([node('a', 'Set A')], groups));

      expect(result.nodeGroups).toBe(groups);
      expect(result.issues).toEqual([]);
    });

    it('never mutates the workflow it is given', () => {
      const input = workflow([node('a', 'Set A')], [
        { id: 'g1', name: 'Transform', nodeIds: ['a', 'gone'] },
      ]);
      Object.freeze(input);
      Object.freeze(input.nodeGroups);
      Object.freeze(input.nodeGroups![0]);
      Object.freeze(input.nodeGroups![0].nodeIds);

      // Would throw in strict mode if repair wrote through to the input — version snapshots and
      // rollback payloads share these objects.
      expect(() => repairNodeGroups(input)).not.toThrow();
      expect(input.nodeGroups![0].nodeIds).toEqual(['a', 'gone']);
    });

    it('tolerates a workflow with no groups', () => {
      expect(repairNodeGroups({ nodes: [node('a', 'Set A')] }).issues).toEqual([]);
      expect(repairNodeGroups(workflow([node('a', 'Set A')], [])).nodeGroups).toEqual([]);
    });

    it('drops malformed entries and says so', () => {
      const result = repairNodeGroups(
        workflow([node('a', 'Set A')], [null, { name: 'no id' }, { id: 'g1', name: 'Ok', nodeIds: ['a'] }])
      );

      expect(result.nodeGroups).toEqual([{ id: 'g1', name: 'Ok', nodeIds: ['a'] }]);
      expect(result.issues.filter(i => i.code === 'group-malformed')).toHaveLength(2);
    });

    it('errors instead of pruning when the caller authored the group in this request', () => {
      // A member that does not exist is a mistake in the request, not something to repair silently:
      // n8n would have answered with the same complaint.
      const result = repairNodeGroups(
        workflow([node('a', 'Set A')], [{ id: 'g1', name: 'Mine', nodeIds: ['a', 'typo'] }]),
        { authoredGroups: new Set(['Mine']) }
      );

      expect(result.errors?.join(' ')).toContain('"typo"');
      expect(result.issues).toEqual([]);
    });

    it('still prunes an inherited group with the same problem', () => {
      const result = repairNodeGroups(
        workflow([node('a', 'Set A')], [{ id: 'g1', name: 'Inherited', nodeIds: ['a', 'typo'] }]),
        { authoredGroups: new Set(['Something else']) }
      );

      expect(result.errors).toBeUndefined();
      expect(result.nodeGroups).toEqual([{ id: 'g1', name: 'Inherited', nodeIds: ['a'] }]);
    });
  });

  describe('sanitizeGroupsForApi', () => {
    it('drops description when the instance does not support it', () => {
      const sanitized = sanitizeGroupsForApi(
        [{ id: 'g1', name: 'Transform', nodeIds: ['a'], description: 'cleans records' }],
        { includeDescription: false }
      );

      expect(sanitized).toEqual([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);
    });

    it('keeps description when supported', () => {
      const sanitized = sanitizeGroupsForApi(
        [{ id: 'g1', name: 'Transform', nodeIds: ['a'], description: 'cleans records' }],
        { includeDescription: true }
      );

      expect(sanitized[0].description).toBe('cleans records');
    });

    it('drops a description that is not a usable string', () => {
      // Groups read back from n8n are untyped at runtime; forwarding a non-string would earn a 400
      // the degradation ladder cannot attribute to descriptions.
      const sanitized = sanitizeGroupsForApi(
        [
          { id: 'g1', name: 'A', nodeIds: ['a'], description: 42 },
          { id: 'g2', name: 'B', nodeIds: ['b'], description: '   ' },
          { id: 'g3', name: 'C', nodeIds: ['c'], description: '  real  ' },
        ] as any,
        { includeDescription: true }
      );

      expect(sanitized[0]).not.toHaveProperty('description');
      expect(sanitized[1]).not.toHaveProperty('description');
      expect(sanitized[2].description).toBe('real');
    });

    it('drops keys outside the API group schema', () => {
      const sanitized = sanitizeGroupsForApi(
        [{ id: 'g1', name: 'Transform', nodeIds: ['a'], collapsed: true, color: 3 } as any],
        { includeDescription: true }
      );

      expect(Object.keys(sanitized[0]).sort()).toEqual(['id', 'name', 'nodeIds']);
    });
  });

  describe('checkNodeGroups', () => {
    it('reports a node claimed by two groups', () => {
      const issues = checkNodeGroups(
        workflow([node('a', 'Set A'), node('b', 'Set B')], [
          { id: 'g1', name: 'First', nodeIds: ['a'] },
          { id: 'g2', name: 'Second', nodeIds: ['a', 'b'] },
        ])
      );

      expect(issues.map(i => i.code)).toContain('group-node-in-multiple-groups');
    });

    it('does not report a node as double-claimed within its own group', () => {
      const issues = checkNodeGroups(
        workflow([node('a', 'Set A'), node('b', 'Set B')], [
          { id: 'g1', name: 'Only', nodeIds: ['a', 'b'] },
        ])
      );

      expect(issues).toEqual([]);
    });

    it('reports duplicate group names', () => {
      const issues = checkNodeGroups(
        workflow([node('a', 'Set A'), node('b', 'Set B')], [
          { id: 'g1', name: 'Same', nodeIds: ['a'] },
          { id: 'g2', name: 'Same', nodeIds: ['b'] },
        ])
      );

      expect(issues.map(i => i.code)).toContain('group-duplicate-name');
    });

    it('detects a trigger inside a group using supplied node-type metadata', () => {
      // The name of a type does not reliably say whether it is a trigger (n8n-nodes-base.cron is
      // one), so the caller resolves it from the node database.
      const issues = checkNodeGroups(
        workflow([node('a', 'Every hour', 'n8n-nodes-base.cron'), node('b', 'Set B')], [
          { id: 'g1', name: 'Group', nodeIds: ['a', 'b'] },
        ]),
        { isTrigger: n => n.type === 'n8n-nodes-base.cron' }
      );

      expect(issues.map(i => i.code)).toContain('group-contains-trigger');
    });

    it('reports nothing without a trigger resolver', () => {
      const issues = checkNodeGroups(
        workflow([node('a', 'Every hour', 'n8n-nodes-base.cron')], [
          { id: 'g1', name: 'Group', nodeIds: ['a'] },
        ])
      );

      expect(issues).toEqual([]);
    });
  });

  describe('dropRejectedGroup', () => {
    const groups = () => [
      { id: 'g1', name: 'Keep', nodeIds: ['a'] },
      { id: 'g2', name: 'Drop', nodeIds: ['b'] },
    ];

    it('removes only the named group', () => {
      const input = groups();
      const { groups: remaining, dropped } = dropRejectedGroup(input, { groupName: 'Drop' });

      expect(dropped?.id).toBe('g2');
      expect(remaining).toEqual([{ id: 'g1', name: 'Keep', nodeIds: ['a'] }]);
      expect(input).toHaveLength(2);
    });

    it('prefers the id when n8n reported one', () => {
      // Group names are free-form user text; a quote in one truncates any name capture, so the id
      // is the reliable identifier when the message carries it.
      const { dropped } = dropRejectedGroup(groups(), { groupId: 'g2', groupName: 'mangled' });

      expect(dropped?.id).toBe('g2');
    });

    it('falls back to the name when the reported id matches nothing', () => {
      // The id is scraped from a parenthetical in n8n's message. If that parenthetical is not an
      // id at all (`Node group "X" (2 nodes) ...`), an id-only match would strand the write.
      const { dropped } = dropRejectedGroup(groups(), { groupId: '2 nodes', groupName: 'Drop' });

      expect(dropped?.id).toBe('g2');
    });

    it('reports nothing dropped for an unknown name', () => {
      const input = groups();
      const { groups: remaining, dropped } = dropRejectedGroup(input, { groupName: 'Missing' });

      expect(dropped).toBeNull();
      expect(remaining).toBe(input);
    });
  });

  describe('classifyGroupError', () => {
    const groups = [{ id: 'g1', name: 'Transform records', nodeIds: ['a'] }];

    // The fixtures below are the bodies n8n actually sends, captured from a live instance. Its
    // public-API serializer keeps only `{ message }`, and AJV's text names the offending property
    // only when the path is nested — so a top-level rejection identifies nothing.
    it('treats a pathless unsupported-property rejection as a candidate schema-field problem', () => {
      const error = new N8nApiError('request/body must NOT have additional properties', 400);

      expect(classifyGroupError(error).kind).toBe('schema-field');
    });

    it('ignores an unsupported-property rejection whose path names another field', () => {
      // Latching "this instance has no nodeGroups" off an unrelated 400 would make every later
      // write omit the field, so n8n would backfill the stored groups and revalidate them — exactly
      // the failure this module exists to prevent, on an instance that supports groups fine.
      const error = new N8nApiError('request/body/settings must NOT have additional properties', 400);

      expect(classifyGroupError(error).kind).toBe('unrelated');
    });

    it('extracts the group id when n8n reports one, so a quoted name cannot mislead it', () => {
      const error = new N8nApiError(
        'Node group "Say "hi"" (9b1c8e2a-4d3f-4a6b-8c7d-1e2f3a4b5c6d) must form a single connected subgraph with a single entry and exit.',
        400
      );
      const classification = classifyGroupError(error);

      expect(classification.kind).toBe('semantic');
      expect(classification.groupId).toBe('9b1c8e2a-4d3f-4a6b-8c7d-1e2f3a4b5c6d');
    });

    it('classifies a nested nodeGroups path as a description problem', () => {
      // Exact text from a live pre-2.32 instance rejecting a group that carried a description.
      const error = new N8nApiError(
        'request/body/nodeGroups/0 must NOT have additional properties',
        400
      );

      expect(classifyGroupError(error).kind).toBe('schema-description');
    });

    it('prefers stripping descriptions when the rejection names nodeGroups without a path', () => {
      const error = new N8nApiError(
        'request/body/nodeGroups must NOT have additional properties',
        400
      );
      const withDescription = [{ ...groups[0], description: 'cleans records' }];

      expect(classifyGroupError(error).kind).toBe('schema-description');
    });

    it('extracts the group name from a dangling-member rejection', () => {
      const error = new N8nApiError(
        'Group "Transform records" references node ID "ccc" that does not exist in the workflow.',
        400
      );
      const classification = classifyGroupError(error);

      expect(classification.kind).toBe('semantic');
      expect(classification.groupName).toBe('Transform records');
    });

    it('extracts the group name from a broken-shape rejection', () => {
      const error = new N8nApiError(
        'Node group "Transform records" (9b1c8e2a-4d3f-4a6b-8c7d-1e2f3a4b5c6d) must form a single connected subgraph with a single entry and exit.',
        400
      );
      const classification = classifyGroupError(error);

      expect(classification.kind).toBe('semantic');
      expect(classification.groupName).toBe('Transform records');
    });

    it('ignores errors unrelated to groups', () => {
      const error = new N8nApiError('request/body must have required property \'name\'', 400);

      expect(classifyGroupError(error).kind).toBe('unrelated');
    });

    it('ignores non-400 responses', () => {
      expect(classifyGroupError(new N8nApiError('Group "X" is invalid', 500)).kind).toBe('unrelated');
    });

    it('still classifies a rejection when the sent payload was an empty array', () => {
      // `nodeGroups: []` means "ungroup everything" — a field a pre-2.28 instance rejects as an
      // unknown property, which must degrade to omitting it rather than failing the write.
      const error = new N8nApiError('request/body must NOT have additional properties', 400);

      expect(classifyGroupError(error).kind).toBe('schema-field');
    });
  });

  describe('parseNodeGroupsInput', () => {
    it('treats null and undefined as "not provided"', () => {
      expect(parseNodeGroupsInput(null)).toBeUndefined();
      expect(parseNodeGroupsInput(undefined)).toBeUndefined();
    });

    it('keeps an empty array distinct from absence (it means ungroup everything)', () => {
      expect(parseNodeGroupsInput([])).toEqual([]);
    });

    it('parses a JSON string, as some MCP transports send arrays', () => {
      const parsed = parseNodeGroupsInput('[{"name":"Transform","nodeIds":["a"]}]');

      expect(parsed).toHaveLength(1);
      expect(parsed![0].name).toBe('Transform');
    });

    it('generates an id when one is not supplied', () => {
      const parsed = parseNodeGroupsInput([{ name: 'Transform', nodeIds: ['a'] }]);

      expect(parsed![0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('keeps a supplied id', () => {
      const parsed = parseNodeGroupsInput([{ id: 'g1', name: 'Transform', nodeIds: ['a'] }]);

      expect(parsed![0].id).toBe('g1');
    });

    it('rejects a group with no members or no name', () => {
      expect(() => parseNodeGroupsInput([{ name: 'Transform', nodeIds: [] }])).toThrow();
      expect(() => parseNodeGroupsInput([{ name: '  ', nodeIds: ['a'] }])).toThrow();
    });

    it('rejects a description over n8n\'s 155-character cap', () => {
      expect(() =>
        parseNodeGroupsInput([{ name: 'Transform', nodeIds: ['a'], description: 'x'.repeat(156) }])
      ).toThrow();
    });
  });
});

describe('classifyGroupError with the zod wording (n8n 2.37 create)', () => {
  const err = (message: string) => ({ statusCode: 400, message });

  it('treats an unnamed top-level rejection as the field candidate', async () => {
    const { classifyGroupError } = await import('../../../src/services/node-groups');
    expect(classifyGroupError(err("request/body Unrecognized key(s) in object: 'nodeGroups'")).kind).toBe('schema-field');
  });

  it('treats a rejection inside a group as the description case, and other paths as unrelated', async () => {
    const { classifyGroupError } = await import('../../../src/services/node-groups');
    expect(classifyGroupError(err("request/body/nodeGroups/0 Unrecognized key(s) in object: 'description'")).kind).toBe('schema-description');
    expect(classifyGroupError(err("request/body/settings Unrecognized key(s) in object: 'x'")).kind).toBe('unrelated');
  });
});
