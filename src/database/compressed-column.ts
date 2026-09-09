/**
 * Bulk text columns in nodes.db are stored gzip-compressed and base64-encoded, the layout
 * templates.workflow_json_compressed and node_versions.properties_schema already use, so the
 * committed database stays under GitHub's 100 MiB file limit. Plain values written before
 * compression was introduced are still accepted on read, so an older database works with this
 * code and a newer database keeps working with code that only reads plain JSON for as long as
 * those rows have not been rewritten.
 *
 * Columns that feed an FTS index (nodes.operations, templates.description) must stay plain: FTS
 * tokenises the stored text, and base64 is not searchable.
 */
import * as zlib from 'zlib';
import { logger } from '../utils/logger';

// gzip's magic bytes (1f 8b 08) base64-encode to this prefix. Nothing JSON.stringify produces
// starts with it, and a README that does is handled by the inflate failing.
const GZIP_BASE64_PREFIX = 'H4sI';

/**
 * Values shorter than this stay plain. Below it gzip's header and base64's 4/3 expansion cost
 * more than they save, and short values such as '[]' stay readable in SQL predicates.
 */
export const COMPRESSION_MIN_LENGTH = 1024;

export function isCompressedColumn(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(GZIP_BASE64_PREFIX);
}

/**
 * Returns the value to store for a text column: the text itself when it is short or already
 * compressed, otherwise its gzip base64 form.
 */
export function compressColumnText(text: string): string {
  if (text.length < COMPRESSION_MIN_LENGTH || isCompressedColumn(text)) return text;
  return zlib.gzipSync(text).toString('base64');
}

/**
 * Returns the text a stored column holds, inflating it when it was compressed. A value that
 * carries the gzip prefix but does not inflate is returned as-is.
 */
export function decompressColumnText(stored: string): string {
  if (!isCompressedColumn(stored)) return stored;
  try {
    return zlib.gunzipSync(Buffer.from(stored, 'base64')).toString('utf8');
  } catch (error) {
    logger.warn('Stored column carries the gzip prefix but did not inflate; returning it unchanged', {
      error: (error as Error).message,
    });
    return stored;
  }
}

export function compressColumnJson(value: unknown): string {
  return compressColumnText(JSON.stringify(value));
}

/**
 * Parses a JSON column, inflating it first when it was compressed. Returns `fallback` when the
 * value is neither valid JSON nor a compressed form of it.
 */
export function decompressColumnJson<T>(stored: string, fallback: T): any {
  try {
    if (!isCompressedColumn(stored)) return JSON.parse(stored);
    return JSON.parse(zlib.gunzipSync(Buffer.from(stored, 'base64')).toString('utf8'));
  } catch (error) {
    if (isCompressedColumn(stored)) {
      logger.warn('Failed to decompress stored JSON column', { error: (error as Error).message });
    }
    return fallback;
  }
}
