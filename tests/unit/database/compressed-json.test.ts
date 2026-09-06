import { describe, expect, it, vi } from 'vitest';
import * as zlib from 'node:zlib';
import { compressJson, CompressedJsonReader } from '../../../src/database/compressed-json';

vi.mock('node:zlib', async importOriginal => {
  const actual = await importOriginal<typeof import('node:zlib')>();
  return { ...actual, gunzipSync: vi.fn(actual.gunzipSync) };
});

describe('CompressedJsonReader', () => {
  it.each([[], [{ name: '名', options: [{ value: '🚀' }] }], { nested: [null, true, 1] }, null])(
    'round-trips JSON without changing its value: %j', value => {
      expect(new CompressedJsonReader().parse(compressJson(value))).toEqual(value);
    }
  );

  it.each(['[]', '  {"properties": []}', 'null', '0', 'true', '"text"'])(
    'continues to accept legacy plain JSON: %s', stored => {
      expect(new CompressedJsonReader().parse(stored)).toEqual(JSON.parse(stored));
      expect(zlib.gunzipSync).not.toHaveBeenCalled();
    }
  );

  it('inflates once but returns independent nested objects on every read', () => {
    const reader = new CompressedJsonReader();
    const stored = compressJson([{ options: [{ value: 'original' }] }]);
    reader.parse(stored)[0].options[0].value = 'mutated';
    expect(reader.parse(stored)).toEqual([{ options: [{ value: 'original' }] }]);
    expect(zlib.gunzipSync).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently read schema when the byte budget is exceeded', () => {
    const values = ['first', 'second', 'third'].map(name => JSON.stringify({ name }));
    const stored = values.map(value => compressJson(JSON.parse(value)));
    const reader = new CompressedJsonReader(2 * Math.max(...stored.map((key, i) =>
      Buffer.byteLength(key) + Buffer.byteLength(values[i]))));
    reader.parse(stored[0]);
    reader.parse(stored[1]);
    reader.parse(stored[0]); // keep first, evict second
    reader.parse(stored[2]);
    reader.parse(stored[0]);
    expect(zlib.gunzipSync).toHaveBeenCalledTimes(3);
    reader.parse(stored[1]);
    expect(zlib.gunzipSync).toHaveBeenCalledTimes(4);
  });

  it('does not cache a schema larger than the byte budget', () => {
    const reader = new CompressedJsonReader(10);
    const stored = compressJson([{ description: 'large'.repeat(100) }]);
    expect(reader.parse(stored)).toEqual(reader.parse(stored));
    expect(zlib.gunzipSync).toHaveBeenCalledTimes(2);
  });

  it.each(['H4sIbroken', 'invalid json', zlib.gzipSync('not json').toString('base64')])(
    'rejects invalid stored data: %s', stored => {
      expect(() => new CompressedJsonReader().parse(stored)).toThrow();
    }
  );
});
