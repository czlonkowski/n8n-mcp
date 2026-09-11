import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import {
  COMPRESSION_MIN_LENGTH,
  compressColumnJson,
  compressColumnText,
  decompressColumnJson,
  decompressColumnText,
  isCompressedColumn,
} from '../../../src/database/compressed-column';

function longText(seed: string, length = COMPRESSION_MIN_LENGTH * 4): string {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

describe('compressed-column', () => {
  describe('compressColumnText', () => {
    it('leaves text below the threshold untouched', () => {
      const text = 'a'.repeat(COMPRESSION_MIN_LENGTH - 1);
      expect(compressColumnText(text)).toBe(text);
    });

    it('compresses text at the threshold into a gzip base64 string', () => {
      const text = 'a'.repeat(COMPRESSION_MIN_LENGTH);
      const stored = compressColumnText(text);
      expect(isCompressedColumn(stored)).toBe(true);
      expect(stored.length).toBeLessThan(text.length);
      expect(decompressColumnText(stored)).toBe(text);
    });

    it('round-trips multi-byte text', () => {
      const text = longText('# Węzeł społeczności — README 🚀\n');
      expect(decompressColumnText(compressColumnText(text))).toBe(text);
    });

    it('does not compress a value that is already compressed', () => {
      const stored = compressColumnText(longText('readme '));
      expect(compressColumnText(stored)).toBe(stored);
    });

    it('compresses long text that merely starts with the gzip prefix and reads it back', () => {
      const text = longText('H4sI is how this README starts. ');
      const stored = compressColumnText(text);
      expect(stored).not.toBe(text);
      expect(decompressColumnText(stored)).toBe(text);
    });
  });

  describe('decompressColumnText', () => {
    it('returns plain text unchanged', () => {
      expect(decompressColumnText('# README')).toBe('# README');
      expect(decompressColumnText('')).toBe('');
    });

    it('returns the raw value when it carries the gzip prefix but does not inflate', () => {
      expect(decompressColumnText('H4sI is how this README starts')).toBe('H4sI is how this README starts');
    });

    it('does not truncate plain text that opens with a gzip blob and continues with Markdown', () => {
      // Buffer.from(_, 'base64') would stop at the newline and inflate only the blob.
      const text = gzipSync('example payload').toString('base64') + '\n\n# Usage\n\nPaste the blob above.';
      expect(decompressColumnText(text)).toBe(text);

      const long = text + '\n' + longText('More documentation. ');
      const stored = compressColumnText(long);
      expect(stored).not.toBe(long);
      expect(decompressColumnText(stored)).toBe(long);
    });

    it('does not truncate canonical base64 whose tail gzip would ignore as zero padding', () => {
      // 'AABh' decodes to bytes gunzip skips after a complete member.
      const text = gzipSync('payload').toString('base64') + 'AABh';
      expect(decompressColumnText(text)).toBe(text);

      const long = text.repeat(Math.ceil(COMPRESSION_MIN_LENGTH / text.length) + 1);
      expect(decompressColumnText(long)).toBe(long);
      expect(decompressColumnText(compressColumnText(long))).toBe(long);
    });
  });

  describe('compressColumnJson / decompressColumnJson', () => {
    it('stores small JSON as plain compact text', () => {
      expect(compressColumnJson([])).toBe('[]');
      expect(compressColumnJson([{ name: 'url', type: 'string' }])).toBe('[{"name":"url","type":"string"}]');
    });

    it('round-trips a large property schema through gzip', () => {
      const properties = Array.from({ length: 200 }, (_, i) => ({
        name: `field${i}`,
        displayName: `Field ${i}`,
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['message'], operation: ['send'] } },
      }));
      const stored = compressColumnJson(properties);
      expect(isCompressedColumn(stored)).toBe(true);
      expect(stored.length).toBeLessThan(JSON.stringify(properties).length);
      expect(decompressColumnJson(stored, [])).toEqual(properties);
    });

    it('parses plain JSON written before compression was introduced', () => {
      expect(decompressColumnJson('[{"name": "a"}]', [])).toEqual([{ name: 'a' }]);
      expect(decompressColumnJson('{\n  "a": 1\n}', null)).toEqual({ a: 1 });
    });

    it('returns the fallback for invalid plain JSON', () => {
      expect(decompressColumnJson('{invalid json', [])).toEqual([]);
      expect(decompressColumnJson('not json at all', null)).toBeNull();
    });

    it('returns the fallback for a NULL, empty, or JSON-null column', () => {
      expect(decompressColumnJson(null, [])).toEqual([]);
      expect(decompressColumnJson(undefined, [])).toEqual([]);
      expect(decompressColumnJson('', [])).toEqual([]);
      expect(decompressColumnJson('null', [])).toEqual([]);
    });

    it('stores a value JSON cannot represent as JSON null', () => {
      expect(compressColumnJson(undefined)).toBe('null');
      expect(compressColumnJson(() => 1)).toBe('null');
      expect(decompressColumnJson(compressColumnJson(undefined), [])).toEqual([]);
    });

    it('returns the fallback when the inflated text is not JSON', () => {
      const stored = gzipSync('not json').toString('base64');
      expect(isCompressedColumn(stored)).toBe(true);
      expect(decompressColumnJson(stored, [])).toEqual([]);
    });

    it('returns the fallback for a corrupt compressed value', () => {
      const stored = compressColumnJson(Array.from({ length: 500 }, (_, i) => ({ i })));
      expect(decompressColumnJson(stored.slice(0, 40), [])).toEqual([]);
    });
  });

  describe('isCompressedColumn', () => {
    it('recognises only strings with the gzip base64 prefix', () => {
      expect(isCompressedColumn(gzipSync('x').toString('base64'))).toBe(true);
      expect(isCompressedColumn('[]')).toBe(false);
      expect(isCompressedColumn(null)).toBe(false);
      expect(isCompressedColumn(undefined)).toBe(false);
      expect(isCompressedColumn(42)).toBe(false);
    });
  });
});
