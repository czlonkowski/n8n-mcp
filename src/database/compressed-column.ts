/**
 * Bulk text columns in nodes.db are stored gzip-compressed and base64-encoded, the layout
 * templates.workflow_json_compressed and node_versions.properties_schema already use, so the
 * committed database stays under GitHub's 100 MiB file limit. Plain values written before
 * compression was introduced are still accepted on read, so a database built by an earlier
 * version keeps working with this code.
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

/** True when a stored value carries the gzip base64 prefix, i.e. it was written compressed. */
export function isCompressedColumn(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(GZIP_BASE64_PREFIX);
}

// Buffer.from(value, 'base64') stops at the first character outside the alphabet and ignores
// the rest, so a plain README that opens with a gzip base64 blob and continues with Markdown
// would otherwise inflate to just the blob. Only a value that is base64 end to end is inflated.
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The inflated text, or null when the value is not a compressed column end to end. */
function inflate(value: string): string | null {
  if (!isCompressedColumn(value) || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) {
    return null;
  }
  try {
    const bytes = Buffer.from(value, 'base64');
    // With `info` the sync call returns the output and the engine; @types/node only declares
    // the Buffer-returning shape.
    const { buffer, engine } = zlib.gunzipSync(bytes, { info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    // gzip tolerates trailing zero bytes after a member; a value the writer produced has none,
    // so anything left unconsumed means this is not a compressed column.
    return engine.bytesWritten === bytes.length ? buffer.toString('utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Returns the value to store for a text column: the text itself when it is short or already
 * compressed, otherwise its gzip base64 form. "Already compressed" means the value inflates,
 * so text that merely starts with the prefix is compressed like any other and reads back intact.
 */
export function compressColumnText(text: string): string {
  if (text.length < COMPRESSION_MIN_LENGTH || inflate(text) !== null) return text;
  return zlib.gzipSync(text).toString('base64');
}

/**
 * Returns the text a stored column holds, inflating it when it was compressed. A value that
 * carries the gzip prefix but does not inflate is returned as-is.
 */
export function decompressColumnText(stored: string): string {
  if (!isCompressedColumn(stored)) return stored;
  const text = inflate(stored);
  if (text === null) {
    // Plain text that happens to start with the prefix is valid data, so this is not a warning.
    logger.debug('Stored column carries the gzip prefix but is not a compressed column; returning it unchanged');
    return stored;
  }
  return text;
}

/**
 * Serialises a value compactly and returns the form to store for it. A value JSON cannot
 * represent (undefined, a function, a symbol) is stored as JSON null.
 */
export function compressColumnJson(value: unknown): string {
  return compressColumnText(JSON.stringify(value) ?? 'null');
}

/**
 * Parses a JSON column, inflating it first when it was compressed. Returns `fallback` when the
 * column is NULL, empty, JSON null, or neither valid JSON nor a compressed form of it.
 */
export function decompressColumnJson(stored: string | null | undefined, fallback: any): any {
  if (typeof stored !== 'string' || stored === '') return fallback;
  try {
    return JSON.parse(decompressColumnText(stored)) ?? fallback;
  } catch {
    return fallback;
  }
}
