import { gunzipSync } from 'zlib';
import { NPM_MISSING_README_PLACEHOLDER } from '../constants/npm-readme';

/** Default cap on the unpacked tarball size read while looking for a README (64 MiB). */
const DEFAULT_MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/** The npm registry truncates packument READMEs to this many characters; a tarball README is cut to match. */
const MAX_README_LENGTH = 64 * 1024;

const TAR_BLOCK_SIZE = 512;

/** `README`, `README.md`, `readme.markdown`, `README.txt` and similar, matched case-insensitively. */
const README_FILE_NAME = /^readme(\.[a-z0-9]+)?$/i;
const MARKDOWN_README_FILE_NAME = /^readme\.(md|markdown)$/i;

/**
 * Returns the packument README, or null when the registry has none: a missing or
 * empty field, or npm's placeholder text.
 */
export function normalizeRegistryReadme(readme: unknown): string | null {
  if (typeof readme !== 'string') return null;
  const trimmed = readme.trim();
  if (!trimmed || trimmed === NPM_MISSING_README_PLACEHOLDER) return null;
  return readme;
}

/**
 * Reads the README at the root of a gzipped npm package tarball.
 *
 * npm tarballs hold a single top-level directory (usually `package/`), so the
 * root README is an entry exactly one level below it. A Markdown README wins
 * over any other README file, and the text is cut to the registry's README length.
 * Returns null for a tarball without a root README, for data that is not a gzipped
 * tarball, and when the unpacked archive would exceed `maxUnpackedBytes`. An archive
 * that ends mid-entry still returns a README found before the break.
 */
export function extractReadmeFromTarball(
  gzipped: Buffer,
  options: { maxUnpackedBytes?: number } = {}
): string | null {
  let archive: Buffer;
  try {
    archive = gunzipSync(gzipped, { maxOutputLength: options.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED_BYTES });
  } catch {
    return null;
  }

  let fallback: string | null = null;
  let pendingPath: string | null = null;
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break;

    const size = parseOctal(header.subarray(124, 136));
    const dataStart = offset + TAR_BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (size < 0 || dataEnd > archive.length) return fallback;

    const typeflag = String.fromCharCode(header[156]);
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;

    if (typeflag === 'x') {
      pendingPath = parsePaxPath(data) ?? pendingPath;
      continue;
    }
    if (typeflag === 'L') {
      pendingPath = readString(data);
      continue;
    }
    if (typeflag === 'g') continue;

    const path = pendingPath ?? entryPath(header);
    pendingPath = null;
    if (typeflag !== '0' && typeflag !== '\0') continue;

    const fileName = rootFileName(path);
    if (!fileName || !README_FILE_NAME.test(fileName)) continue;

    const text = data.toString('utf8').slice(0, MAX_README_LENGTH);
    if (!text.trim()) continue;
    if (MARKDOWN_README_FILE_NAME.test(fileName)) return text;
    fallback ??= text;
  }

  return fallback;
}

/** The file name of an entry that sits directly in the tarball's top-level directory, or null. */
function rootFileName(path: string): string | null {
  const parts = path.replace(/^\.\//, '').split('/');
  return parts.length === 2 && parts[0] && parts[0] !== '.' && parts[0] !== '..' ? parts[1] : null;
}

function entryPath(header: Buffer): string {
  const name = readString(header.subarray(0, 100));
  // POSIX ustar only: GNU headers ("ustar  ") keep access and change times where POSIX keeps the prefix.
  const isUstar = header.toString('ascii', 257, 263) === 'ustar\0';
  const prefix = isUstar ? readString(header.subarray(345, 500)) : '';
  return prefix ? `${prefix}/${name}` : name;
}

function readString(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
}

/** Parses a tar numeric field; returns -1 for a value this reader does not handle. */
function parseOctal(field: Buffer): number {
  // A set high bit marks the base-256 encoding tar uses for sizes above 8 GiB.
  if (field[0] & 0x80) return -1;
  const text = readString(field).trim();
  if (!text) return 0;
  return /^[0-7]+$/.test(text) ? parseInt(text, 8) : -1;
}

/** Reads the `path` record from a pax extended header ("<length> path=<value>\n" records). */
function parsePaxPath(data: Buffer): string | null {
  for (const record of data.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1];
  }
  return null;
}
