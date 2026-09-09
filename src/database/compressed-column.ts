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
    return zlib.gunzipSync(Buffer.from(value, 'base64')).toString('utf8');
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
    logger.warn('Stored column carries the gzip prefix but did not inflate; returning it unchanged');
    return stored;
  }
  return text;
}

/** Serialises a value compactly and returns the form to store for it. */
export function compressColumnJson(value: unknown): string {
  return compressColumnText(JSON.stringify(value));
}

/**
 * Parses a JSON column, inflating it first when it was compressed. Returns `fallback` when the
 * value is neither valid JSON nor a compressed form of it.
 */
export function decompressColumnJson(stored: string, fallback: any): any {
  const text = decompressColumnText(stored);
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
