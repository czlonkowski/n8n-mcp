import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowDiffEngine, MAX_CONNECTION_INDEX } from '@/services/workflow-diff-engine';
import type { WorkflowDiffOperation } from '@/types/workflow-diff';
import type { Workflow } from '@/types/n8n-api';

function node(id: string, name: string, type = 'n8n-nodes-base.set', parameters: Record<string, unknown> = {}) {
  return {
    id,
    name,
    type,
    typeVersion: 3.4,
    position: [0, 0] as [number, number],
    parameters
  };
}

function buildWorkflow(text = 'hello world'): Workflow {
  return {
    id: 'wf-1',
    name: 'Limits',
    nodes: [
      node('a', 'A'),
      node('b', 'B'),
      node('c', 'C'),
      node('s', 'Switch', 'n8n-nodes-base.switch'),
      node('t', 'Text', 'n8n-nodes-base.set', { text })
    ],
    connections: {
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] }
    },
    settings: {}
  } as unknown as Workflow;
}

describe('WorkflowDiffEngine limits', () => {
  let engine: WorkflowDiffEngine;

  beforeEach(() => {
    engine = new WorkflowDiffEngine();
  });

  async function apply(operations: WorkflowDiffOperation[], workflow = buildWorkflow(), extra: Record<string, unknown> = {}) {
    return engine.applyDiff(workflow, { id: 'wf-1', operations, ...extra } as any);
  }

  describe('connection indexes', () => {
    it.each([
      ['sourceIndex', { sourceIndex: MAX_CONNECTION_INDEX + 1 }],
      ['a numeric sourceOutput', { sourceOutput: String(MAX_CONNECTION_INDEX + 1) }],
      ['case', { case: MAX_CONNECTION_INDEX + 1 }],
      ['targetIndex', { targetIndex: MAX_CONNECTION_INDEX + 1 }]
    ])('rejects an addConnection %s above the limit', async (_label, params) => {
      const workflow = buildWorkflow();
      const result = await apply([{ type: 'addConnection', source: 'Switch', target: 'C', ...params } as any], workflow);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('out of range');
      expect(workflow.connections.Switch).toBeUndefined();
    });

    it('rejects a very large sourceIndex without growing the output list', async () => {
      const startedAt = performance.now();
      const result = await apply(
        [{ type: 'addConnection', source: 'A', target: 'C', sourceIndex: 1_000_000_000 } as any],
        buildWorkflow(),
        { validateOnly: true }
      );

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('out of range');
      expect(performance.now() - startedAt).toBeLessThan(500);
    });

    it('rejects it in continueOnError mode too', async () => {
      const result = await apply(
        [{ type: 'addConnection', source: 'A', target: 'C', sourceIndex: MAX_CONNECTION_INDEX + 1 } as any],
        buildWorkflow(),
        { continueOnError: true }
      );

      expect(result.errors?.[0]?.message).toContain('out of range');
      expect(result.workflow?.connections.A.main).toHaveLength(1);
    });

    it('accepts an index at the limit', async () => {
      const result = await apply([{ type: 'addConnection', source: 'Switch', target: 'C', case: MAX_CONNECTION_INDEX } as any]);

      expect(result.success).toBe(true);
      expect(result.workflow!.connections.Switch.main).toHaveLength(MAX_CONNECTION_INDEX + 1);
      expect(result.workflow!.connections.Switch.main[MAX_CONNECTION_INDEX]).toEqual([{ node: 'C', type: 'main', index: 0 }]);
    });

    it('rejects index values that are not non-negative integers', async () => {
      for (const params of [
        { targetIndex: '1000000000' }, { targetIndex: -1 }, { targetIndex: 1.5 },
        { sourceIndex: -1 }, { sourceIndex: 2.5 }, { sourceIndex: '3' }
      ]) {
        const result = await apply([{ type: 'addConnection', source: 'Switch', target: 'C', ...params } as any]);

        expect(result.success, JSON.stringify(params)).toBe(false);
        expect(result.errors![0].message, JSON.stringify(params)).toContain('out of range');
      }
    });

    it('validates connection indexes in replaceConnections', async () => {
      for (const index of [MAX_CONNECTION_INDEX + 1, -1, '3', 0.5]) {
        const result = await apply([
          { type: 'replaceConnections', connections: { A: { main: [[{ node: 'B', type: 'main', index }]] } } } as any
        ]);

        expect(result.success, String(index)).toBe(false);
        expect(result.errors![0].message, String(index)).toContain('out of range');
      }

      const tooManyOutputs = Array.from({ length: MAX_CONNECTION_INDEX + 2 }, () => []);
      const wide = await apply([{ type: 'replaceConnections', connections: { A: { main: tooManyOutputs } } } as any]);
      expect(wide.success).toBe(false);

      const valid = await apply([
        { type: 'replaceConnections', connections: { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } } } as any
      ]);
      expect(valid.success).toBe(true);
    });

    it('rejects a rewireConnection sourceIndex above the limit', async () => {
      const result = await apply([
        { type: 'rewireConnection', source: 'A', from: 'B', to: 'C', sourceIndex: MAX_CONNECTION_INDEX + 1 } as any
      ]);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('out of range');
    });
  });

  describe('patchNodeField regex', () => {
    function patch(find: string, extra: Record<string, unknown> = {}): WorkflowDiffOperation {
      return {
        type: 'patchNodeField',
        nodeName: 'Text',
        fieldPath: 'parameters.text',
        patches: [{ find, replace: 'x', regex: true, ...extra }]
      } as any;
    }

    it('rejects a group repeated without bound around another unbounded repeat', async () => {
      for (const pattern of ['((ab)*c)+', '(?:x+y)*z', '(a(?:b{2,}c)?)+', '(?<w>[0-9]+-)+']) {
        const result = await apply([patch(pattern)], buildWorkflow());

        expect(result.success, pattern).toBe(false);
        expect(result.errors![0].message, pattern).toContain('unsafe regex');
      }
    });

    it('accepts bounded repeats, optional parts and alternation inside repeated groups', async () => {
      const patterns = [
        '(\\d{1,3}\\.){3}\\d{1,3}', '(foo|bar)+', '(foo|bar){2}', '(?:\\r?\\n)+', '(<br>|\\n)+',
        '\\(a+\\)+', '[(]a+[)]+', '(foo)+', '(?:ab){2}', 'a+b*', '(https?)://'
      ];
      for (const pattern of patterns) {
        const result = await apply(
          [patch(pattern, { replaceAll: true })],
          buildWorkflow('10.0.0.1 foobar\r\n<br>\n (aa)) abab aab https://')
        );

        expect(result.errors?.[0]?.message ?? '', pattern).not.toContain('unsafe regex');
        expect(result.success, pattern).toBe(true);
      }
    });

    it('stops a regex evaluation that runs past the time limit', async () => {
      const startedAt = performance.now();
      const result = await apply([patch('\\S*[a-z]*\\w*[0-9]')], buildWorkflow('word'.repeat(5000)));

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('took too long');
      expect(performance.now() - startedAt).toBeLessThan(2000);
    });

    it('caps total regex time across operations in one request', async () => {
      const operations = Array.from({ length: 12 }, () => patch('\\S*[a-z]*\\w*[0-9]'));
      const startedAt = performance.now();
      const result = await apply(operations, buildWorkflow('word'.repeat(5000)), { continueOnError: true });

      expect(performance.now() - startedAt).toBeLessThan(2000);
      expect(result.errors).toHaveLength(12);
      expect(result.errors![11].message).toContain('time limit for this request is used up');
    });

    it('applies a regex patch with a capture group on a large field', async () => {
      const text = 'x'.repeat(400_000) + ' const limit = 25;';
      const result = await apply([
        { type: 'patchNodeField', nodeName: 'Text', fieldPath: 'parameters.text',
          patches: [{ find: 'limit = (\\d+)', replace: 'limit = $1 * 2', regex: true }] } as any
      ], buildWorkflow(text));

      expect(result.success).toBe(true);
      const patched = result.workflow!.nodes.find((n: { name: string }) => n.name === 'Text')!.parameters.text as string;
      expect(patched.endsWith(' const limit = 25 * 2;')).toBe(true);
      expect(patched.length).toBe(text.length + 4);
    });

    describe('patched field size', () => {
      function patches(list: Array<Record<string, unknown>>): WorkflowDiffOperation {
        return { type: 'patchNodeField', nodeName: 'Text', fieldPath: 'parameters.text', patches: list } as any;
      }

      it('rejects a literal replaceAll that grows the field past the cap', async () => {
        const result = await apply(
          [patches([{ find: 'a', replace: 'b'.repeat(1000), replaceAll: true }])],
          buildWorkflow('a'.repeat(1000))
        );

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('would grow');
      });

      it('caps growth across many patches in one operation', async () => {
        const list = Array.from({ length: 50 }, () => ({ find: 'a', replace: 'aa', replaceAll: true }));
        const startedAt = performance.now();
        const result = await apply([patches(list)], buildWorkflow('a'.repeat(1000)));

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('would grow');
        expect(performance.now() - startedAt).toBeLessThan(500);
      });

      it('rejects a regex replacement that grows the field past the cap', async () => {
        const result = await apply(
          [patches([{ find: 'a', replace: '$&'.repeat(600), regex: true, replaceAll: true }])],
          buildWorkflow('a'.repeat(1000))
        );

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('would grow');
      });

      it('rejects a regex replacement that repeats the surrounding text past the cap', async () => {
        const result = await apply(
          [patches([{ find: 'a', replace: "$'", regex: true, replaceAll: true }])],
          buildWorkflow('a'.repeat(2000))
        );

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('would grow');
      });

      it('accepts a capture replacement that keeps the field length', async () => {
        const text = 'xy'.repeat(25_000);
        const result = await apply(
          [patches([{ find: '(.)', replace: '$1', regex: true, replaceAll: true }])],
          buildWorkflow(text)
        );

        expect(result.success).toBe(true);
        expect(result.workflow!.nodes.find((n: { name: string }) => n.name === 'Text')!.parameters.text).toBe(text);
      });

      it('counts captures that extend past the match', async () => {
        const result = await apply(
          [patches([{ find: '(?=(.{1000}))', replace: '$1', regex: true, replaceAll: true }])],
          buildWorkflow('a'.repeat(2000))
        );

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('would grow');
      });

      it('shares the growth limit across operations in one request', async () => {
        const operations = Array.from({ length: 60 }, () =>
          patches([{ find: 'Q', replace: 'Q' + 'z'.repeat(100), replaceAll: true }])
        );
        const result = await apply(operations, buildWorkflow('Q'.repeat(100)));

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('would grow');
        expect(result.errors![0].operation).toBeGreaterThan(40);
      });

      it('applies the regex field size limit after earlier patches', async () => {
        const result = await apply(
          [patches([
            { find: 'a', replace: 'b'.repeat(2_000_000) },
            { find: 'b$', replace: 'c', regex: true }
          ])],
          buildWorkflow('a')
        );

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('too large for regex operations');
      });

      it('allows growth up to the cap', async () => {
        const result = await apply(
          [patches([
            { find: 'a', replace: 'b'.repeat(500), replaceAll: true },
            { find: 'b', replace: 'cc', regex: true, replaceAll: true }
          ])],
          buildWorkflow('a'.repeat(500))
        );

        expect(result.success).toBe(true);
        const text = result.workflow!.nodes.find((n: { name: string }) => n.name === 'Text')!.parameters.text as string;
        expect(text).toBe('c'.repeat(500_000));
      });
    });

    it('reports a pattern that matches several times without replaceAll', async () => {
      const result = await apply([patch('o')], buildWorkflow('foo'));

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('matches 2 times');
    });
  });

  describe('operation count', () => {
    it('rejects a request with too many operations', async () => {
      const operations = Array.from({ length: 1001 }, (_, i) => ({ type: 'updateName', name: `Name ${i}` }));
      const result = await apply(operations as any);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Too many operations');
    });

    it('accepts a request at the operation limit', async () => {
      const operations = Array.from({ length: 1000 }, (_, i) => ({ type: 'updateName', name: `Name ${i}` }));
      const result = await apply(operations as any);

      expect(result.success).toBe(true);
    });
  });

  describe('updateSettings', () => {
    it('rejects a reserved settings key', async () => {
      const settings = JSON.parse('{"__proto__": {"injected": true}, "timezone": "UTC"}');
      const result = await apply([{ type: 'updateSettings', settings } as any]);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('reserved');
    });

    it('still applies ordinary settings', async () => {
      const result = await apply([{ type: 'updateSettings', settings: { timezone: 'UTC' } } as any]);

      expect(result.success).toBe(true);
      expect(result.workflow!.settings).toEqual({ timezone: 'UTC' });
      expect(Object.getPrototypeOf(result.workflow!.settings)).toBe(Object.prototype);
    });
  });
});
