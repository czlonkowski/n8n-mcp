import { gzipSync, gunzipSync } from 'node:zlib';
import { LRUCache } from 'lru-cache';

/** The same gzip + base64 text format used by node_versions and templates. */
export function compressJson(value: unknown): string {
  return gzipSync(JSON.stringify(value)).toString('base64');
}

/**
 * Cache inflated JSON text rather than parsed objects: each caller still gets
 * its own mutable schema, so validators cannot contaminate subsequent reads.
 * Both the compressed key and decoded value count toward the memory bound.
 */
export class CompressedJsonReader {
  private readonly cache: LRUCache<string, string>;

  constructor(maxSize = 16 * 1024 * 1024) {
    this.cache = new LRUCache<string, string>({
      max: 256,
      maxSize,
      sizeCalculation: (value, key) => Buffer.byteLength(value) + Buffer.byteLength(key),
    });
  }

  parse(stored: string): any {
    if (!stored?.startsWith('H4sI')) return JSON.parse(stored);
    let text = this.cache.get(stored);
    if (text === undefined) {
      text = gunzipSync(Buffer.from(stored, 'base64')).toString('utf8');
      // Validate before caching; malformed JSON must never poison the cache.
      const value = JSON.parse(text);
      this.cache.set(stored, text);
      return value;
    }
    return JSON.parse(text);
  }
}
