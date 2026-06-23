import { describe, it, expect } from 'vitest';
import {
  normalizeMcpJsonValue,
  normalizeMcpWorkflowNode,
  normalizeMcpWorkflowNodes,
  normalizeMcpWorkflowConnections,
  normalizeMcpWorkflowPosition,
} from '@/utils/mcp-input-normalizer';

describe('mcp-input-normalizer', () => {
  describe('normalizeMcpJsonValue', () => {
    it('restores dense numeric-index records to arrays', () => {
      expect(normalizeMcpJsonValue({ '0': 100, '1': 200 })).toEqual([100, 200]);
    });

    it('restores nested dense records recursively', () => {
      expect(normalizeMcpJsonValue({ '0': { '0': { node: 'End' } } }))
        .toEqual([[{ node: 'End' }]]);
    });

    it('parses a JSON string root', () => {
      expect(normalizeMcpJsonValue('{"a":1}')).toEqual({ a: 1 });
    });

    it('does not JSON-parse nested string values (guards jsCode payloads)', () => {
      const input = { parameters: { jsCode: '{"not":"parsed"}' } };
      expect(normalizeMcpJsonValue(input)).toEqual(input);
    });

    it('keeps an empty object as an object', () => {
      expect(normalizeMcpJsonValue({})).toEqual({});
    });

    it('leaves records with non-canonical numeric keys (leading zeros) untouched', () => {
      expect(normalizeMcpJsonValue({ '00': 'a' })).toEqual({ '00': 'a' });
      expect(normalizeMcpJsonValue({ '0': 'a', '01': 'b' })).toEqual({ '0': 'a', '01': 'b' });
    });

    it('leaves sparse numeric-key records untouched', () => {
      expect(normalizeMcpJsonValue({ '0': 'a', '2': 'b' })).toEqual({ '0': 'a', '2': 'b' });
    });

    it('leaves records with non-numeric keys untouched', () => {
      expect(normalizeMcpJsonValue({ '0': 'a', name: 'b' })).toEqual({ '0': 'a', name: 'b' });
    });

    it('passes already-normal input through unchanged (idempotent)', () => {
      const input = {
        nodes: [{ position: [1, 2], parameters: { values: ['a'] } }],
      };
      expect(normalizeMcpJsonValue(input)).toEqual(input);
      expect(normalizeMcpJsonValue(normalizeMcpJsonValue(input))).toEqual(input);
    });

    it('leaves non-JSON strings and primitives untouched', () => {
      expect(normalizeMcpJsonValue('plain text')).toBe('plain text');
      expect(normalizeMcpJsonValue(42)).toBe(42);
      expect(normalizeMcpJsonValue(null)).toBe(null);
      expect(normalizeMcpJsonValue(undefined)).toBe(undefined);
    });

    it('never allocates beyond the input key count for huge sparse indices', () => {
      expect(normalizeMcpJsonValue({ '0': 'a', '4294967296': 'b' }))
        .toEqual({ '0': 'a', '4294967296': 'b' });
    });

    it('does not pollute Object.prototype via __proto__ or constructor keys', () => {
      normalizeMcpJsonValue('{"__proto__":{"polluted":true},"constructor":{"bad":1}}');
      normalizeMcpJsonValue({ '0': 'a', __proto__: { polluted: true } });
      expect(({} as any).polluted).toBeUndefined();
    });

    it('stops recursing on extremely deep payloads instead of overflowing the stack', () => {
      let deep: any = { '0': 'leaf' };
      for (let i = 0; i < 1000; i++) {
        deep = { nested: deep };
      }
      expect(() => normalizeMcpJsonValue(deep)).not.toThrow();
    });
  });

  describe('normalizeMcpWorkflowPosition', () => {
    it('restores a dense record and de-stringifies coordinates', () => {
      expect(normalizeMcpWorkflowPosition({ '0': '500', '1': '100' })).toEqual([500, 100]);
      expect(normalizeMcpWorkflowPosition(['250', 300])).toEqual([250, 300]);
    });

    it('leaves non-canonical coordinate strings for Zod to reject', () => {
      expect(normalizeMcpWorkflowPosition(['0x10', 100])).toEqual(['0x10', 100]);
    });

    it('returns non-array input unchanged after root normalization', () => {
      expect(normalizeMcpWorkflowPosition('not a position')).toBe('not a position');
    });
  });

  describe('normalizeMcpWorkflowNode', () => {
    it('normalizes typeVersion, position, parameters and credentials', () => {
      const result = normalizeMcpWorkflowNode({
        id: 'n1',
        name: 'Set',
        type: 'n8n-nodes-base.set',
        typeVersion: '3.4',
        position: { '0': 100, '1': 200 },
        parameters: '{"values":{"0":{"name":"x"}}}',
        credentials: '{"httpBasicAuth":{"id":"c1","name":"creds"}}',
      });

      expect(result).toEqual({
        id: 'n1',
        name: 'Set',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [100, 200],
        parameters: { values: [{ name: 'x' }] },
        credentials: { httpBasicAuth: { id: 'c1', name: 'creds' } },
      });
    });

    it('never dense-converts credentials (object keyed by type name, not an array)', () => {
      const result = normalizeMcpWorkflowNode({ credentials: { '0': { id: 'c1' } } }) as any;
      expect(result.credentials).toEqual({ '0': { id: 'c1' } });
    });

    it('de-stringifies position coordinates', () => {
      const result = normalizeMcpWorkflowNode({ position: { '0': '500', '1': '100' } }) as any;
      expect(result.position).toEqual([500, 100]);
    });

    it('is idempotent when applied twice (operations-level + node-level preprocess)', () => {
      const once = normalizeMcpWorkflowNode({
        id: 'n1',
        typeVersion: '3',
        position: { '0': '100', '1': 200 },
        parameters: '{"values":{"0":{"name":"x"}}}',
      });
      expect(normalizeMcpWorkflowNode(once)).toEqual(once);
    });

    it('does not add keys absent from the input', () => {
      const result = normalizeMcpWorkflowNode({ id: 'n1', name: 'Set' }) as object;
      expect(Object.keys(result)).toEqual(['id', 'name']);
    });

    it('leaves non-canonical number strings for Zod to reject', () => {
      expect((normalizeMcpWorkflowNode({ typeVersion: 'not-a-number' }) as any).typeVersion).toBe('not-a-number');
      expect((normalizeMcpWorkflowNode({ typeVersion: '0x10' }) as any).typeVersion).toBe('0x10');
      expect((normalizeMcpWorkflowNode({ typeVersion: '1e3' }) as any).typeVersion).toBe('1e3');
      expect((normalizeMcpWorkflowNode({ typeVersion: ' 3 ' }) as any).typeVersion).toBe(' 3 ');
    });

    it('returns non-record input unchanged', () => {
      expect(normalizeMcpWorkflowNode('not a node')).toBe('not a node');
      expect(normalizeMcpWorkflowNode(null)).toBe(null);
    });
  });

  describe('normalizeMcpWorkflowNodes', () => {
    it('restores a dense-record nodes collection and normalizes each node', () => {
      const result = normalizeMcpWorkflowNodes({
        '0': { id: 'n1', typeVersion: '1', position: { '0': 0, '1': 0 } },
      });
      expect(result).toEqual([{ id: 'n1', typeVersion: 1, position: [0, 0] }]);
    });

    it('returns non-array input unchanged after root normalization', () => {
      expect(normalizeMcpWorkflowNodes({ notAnArray: true })).toEqual({ notAnArray: true });
    });
  });

  describe('normalizeMcpWorkflowConnections', () => {
    it('restores nested connection arrays', () => {
      const result = normalizeMcpWorkflowConnections({
        Start: { main: { '0': { '0': { node: 'End', type: 'main', index: 0 } } } },
      });
      expect(result).toEqual({
        Start: { main: [[{ node: 'End', type: 'main', index: 0 }]] },
      });
    });
  });
});
