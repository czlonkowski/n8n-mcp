import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync, readdirSync, utimesSync,
} from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';

import { logger } from '../utils/logger';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const INLINE_RESULT_BYTES = envInt('MCP_RESPONSE_INLINE_BYTES', 32 * 1024);
export const PREVIEW_RESULT_BYTES = envInt('MCP_RESPONSE_PREVIEW_BYTES', 8 * 1024);
export const HARD_RESULT_BYTES = envInt('MCP_RESPONSE_HARD_BYTES', 128 * 1024);
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
const DEFAULT_ARTIFACT_MAX_BYTES = envInt('MCP_RESPONSE_ARTIFACT_MAX_BYTES', 50 * 1024 * 1024);
const DEFAULT_ARTIFACT_TTL_MS = envInt('MCP_RESPONSE_ARTIFACT_TTL_MS', 24 * 60 * 60 * 1000);
const DEFAULT_ARTIFACT_QUOTA_BYTES = envInt('MCP_RESPONSE_ARTIFACT_QUOTA_BYTES', 1024 * 1024 * 1024);
// How long a parsed artifact stays cached. Without an expiry, one query pins a large
// parsed document for the process lifetime.
const PARSE_CACHE_TTL_MS = envInt('MCP_RESPONSE_PARSE_CACHE_TTL_MS', 5 * 60 * 1000);

const cursorKey = (() => {
  const configured = process.env.MCP_RESPONSE_CURSOR_KEY;
  if (configured) return configured;
  logger.warn(
    'MCP_RESPONSE_CURSOR_KEY is not set; artifact cursors are signed with a per-process key ' +
    'and every outstanding cursor will be rejected after a restart.',
  );
  return randomBytes(32).toString('hex');
})();

export interface FilterStat {
  path: string;
  op: FilterOperation;
  /** Items whose `path` actually resolved. Zero means the pointer is wrong, not that nothing matched. */
  resolvedOn: number;
  matched: number;
}

export interface ResponseMeta {
  contractVersion: 3;
  truncated: boolean;
  complete: boolean;
  truncationReason: string | null;
  returnedCount: number | null;
  totalCount: number | null;
  remainingCount: number | null;
  nextCursor: string | null;
  serializedBytes: number;
  artifact?: ArtifactReference | null;
  warning: string | null;
  /** What returnedCount/totalCount count: array elements or object entries. */
  pageUnit?: 'items' | 'entries';
  /** True when the upstream payload was already reduced before it was stored. */
  sourceTruncated?: boolean;
  filtersApplied?: FilterStat[];
  fieldsResolved?: Record<string, number>;
  /** Unambiguous one-level array selected structurally when the caller queried the root. */
  inferredResponsePath?: string;
}

export interface ArtifactReference {
  id: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  expiresAt: string;
  queryTool: 'query_response_artifact';
  responseRoot: string;
  /** Pointers to the artifact's main collections; preview pointers may not exist here. */
  primaryPaths: string[];
  sourceTruncated: boolean;
}

export interface ArtifactDescriptor extends ArtifactReference {
  descriptorVersion: 1;
  contractVersion: 3;
  rawReadable: false;
  guidance: string;
}

/** Distinguishes recoverable handle problems so a model can re-mint instead of guessing. */
export class ArtifactHandleError extends Error {
  readonly reason: 'unknown' | 'expired' | 'wrong_scope' | 'invalid_cursor' | 'invalid_id';

  constructor(reason: ArtifactHandleError['reason'], message: string) {
    super(message);
    this.name = 'ArtifactHandleError';
    this.reason = reason;
  }
}

export type ResponseControlErrorCode =
  | 'INVALID_RESPONSE_PATH'
  | 'INVALID_RESPONSE_CONTROLS';

/** A caller-correctable semantic artifact query error, safe to return structurally. */
export class ResponseControlError extends Error {
  readonly code: ResponseControlErrorCode;

  constructor(code: ResponseControlErrorCode, message: string) {
    super(message);
    this.name = 'ResponseControlError';
    this.code = code;
  }
}

function invalidResponseControls(message: string): ResponseControlError {
  return new ResponseControlError('INVALID_RESPONSE_CONTROLS', message);
}

/** Tools that already bound their own replies and must not be bounded again. */
const SELF_BOUNDED_TOOLS = new Set<string>(['query_response_artifact']);

const FILTER_OPERATIONS = ['eq', 'ne', 'in', 'contains', 'icontains', 'lt', 'lte', 'gt', 'gte', 'exists'] as const;
type FilterOperation = typeof FILTER_OPERATIONS[number];
const COMPARISON_OPERATIONS = new Set<FilterOperation>(['lt', 'lte', 'gt', 'gte']);

export interface ResponseFilter {
  path: string;
  op?: FilterOperation;
  value?: unknown;
}

export interface TextSearch {
  query: string;
  caseSensitive?: boolean;
}

export const queryResponseArtifactTool = {
  name: 'query_response_artifact',
  description:
    'Query structured JSON in a large MCP result artifact without loading it into context. ' +
    'Use the exact camelCase arguments artifactId, responsePath, fields, filters, pageSize, cursor, ' +
    'describe, objectMode, and textSearch; snake_case names are invalid. pageSize accepts 1-100 only. ' +
    'Start with describe=true to see the real keys and array lengths at a path — the inline tool ' +
    'preview is a reshaped summary, so pointers copied from it may not exist in the artifact ' +
    '(responseMeta.artifact.primaryPaths lists pointers that do). responsePath uses RFC 6901 and ' +
    'defaults to the artifact responseRoot when omitted. Exact pointers win; if one is missing and ' +
    'responseRoot is non-empty, it is tried once beneath that root and the canonical pointer is reported. ' +
    'fields accepts root names such as id or pointers such as /status/name. Nested paths must begin ' +
    'with /; status/name is treated as one literal root key. Arrays page by element and ' +
    'objects page by entry. For keyed maps such as n8n connections, set objectMode="entries" and filter ' +
    'on /key rather than guessing nested array paths. Use textSearch for a bounded literal search across ' +
    'large string values. Shape descriptions and result sets are pageable; pass responseMeta.nextCursor ' +
    'back as cursor while keeping responsePath, fields, filters, pageSize, describe, objectMode, and textSearch unchanged. ' +
    'Request another page only when ' +
    'the current page did not answer the question. On any selected object, fields or filters may infer exactly one array child; ' +
    'responseMeta.inferredResponsePath reports its full pointer, while ambiguous shapes require a more specific path. ' +
    'Artifact handles are valid until the ' +
    'MCP server restarts, and at most 24 hours; an unknown handle means you should re-run the originating tool.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Opaque artifact id returned in responseMeta.artifact.id' },
      responsePath: { type: 'string', description: 'RFC 6901 pointer selecting the value to query. Omit it to use the artifact responseRoot. Exact pointers win; a missing pointer is tried once beneath a non-empty responseRoot and reports its canonical path. Use an empty string for the full stored document. A literal / selects an empty-key property, not the root.' },
      describe: {
        type: 'boolean',
        description: 'Return the shape at responsePath (types, key names, array lengths) instead of values. Use this first when you do not know the structure.',
        default: false,
      },
      objectMode: {
        type: 'string',
        enum: ['entries'],
        description: 'For an object selection, expose [{key,value}] rows so filters and fields can be applied generically.',
      },
      fields: {
        type: 'array',
        maxItems: 50,
        items: { type: 'string' },
        description: 'Optional root property names (id) or RFC 6901 pointers (/status/name) projected from each selected item. Nested paths must begin with /; status/name is treated as one literal root key. Fields that do not resolve are omitted, not returned as null; see responseMeta.fieldsResolved.',
      },
      filters: {
        type: 'array',
        maxItems: 10,
        description: 'Optional provider-independent predicates applied to a selected array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', maxLength: 500, description: 'RFC 6901 pointer relative to each item' },
            op: { type: 'string', enum: FILTER_OPERATIONS, default: 'eq' },
            value: {},
          },
          required: ['path'],
        },
      },
      textSearch: {
        type: 'object',
        additionalProperties: false,
        description: 'Bounded literal search across string values beneath responsePath. Returns at most 20 matches with 240 characters of context each.',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 500 },
          caseSensitive: { type: 'boolean', default: false },
        },
        required: ['query'],
      },
      pageSize: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE, description: 'Elements or entries per page, 1-100. Use cursor for additional pages instead of requesting more than 100.' },
      cursor: { type: 'string', description: 'Opaque responseMeta.nextCursor from the previous query page. Keep every other query-view argument unchanged.' },
    },
    required: ['artifactId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      responsePath: { type: 'string' },
      response: {},
      shape: { type: 'object' },
      responseMeta: {
        type: 'object',
        properties: {
          contractVersion: { type: 'integer', const: 3 },
          truncated: { type: 'boolean' },
          complete: { type: 'boolean' },
          truncationReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          returnedCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          totalCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          remainingCount: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          serializedBytes: { type: 'integer', minimum: 0 },
          warning: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          pageUnit: { type: 'string', enum: ['items', 'entries'] },
          sourceTruncated: { type: 'boolean' },
          filtersApplied: { type: 'array' },
          fieldsResolved: { type: 'object' },
          inferredResponsePath: { type: 'string' },
        },
        required: [
          'contractVersion', 'truncated', 'complete', 'truncationReason',
          'returnedCount', 'totalCount', 'remainingCount', 'nextCursor',
          'serializedBytes', 'warning',
        ],
        additionalProperties: false,
      },
    },
    required: ['artifactId', 'responsePath', 'responseMeta'],
    oneOf: [{ required: ['response'] }, { required: ['shape'] }],
    additionalProperties: false,
  },
  annotations: { title: 'Query Response Artifact', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

const MISSING = Symbol('missing');

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

/**
 * The single definition of how a tool result becomes text. Compact JSON avoids spending
 * the response budget on indentation and matches the bytes persisted in an artifact.
 */
export function serializeToolText(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

function emittedBytes(value: unknown): number {
  return Buffer.byteLength(serializeToolText(value));
}


function rootPath(): string {
  return process.env.MCP_RESPONSE_ARTIFACT_ROOT || '/tmp/n8n-mcp-artifacts';
}

function safeOwner(owner: string): string {
  return createHash('sha256').update(owner).digest('hex');
}

function encodeCursor(state: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify({ v: 3, ...state }));
  const signature = createHmac('sha256', cursorKey).update(payload).digest();
  return Buffer.concat([payload, signature]).toString('base64url');
}

function decodeCursor(cursor: string): Record<string, any> {
  const raw = Buffer.from(cursor, 'base64url');
  if (raw.length <= 32) throw new ArtifactHandleError('invalid_cursor', 'Invalid artifact cursor');
  const payload = raw.subarray(0, raw.length - 32);
  const supplied = raw.subarray(raw.length - 32);
  const expected = createHmac('sha256', cursorKey).update(payload).digest();
  if (!timingSafeEqual(supplied, expected)) {
    throw new ArtifactHandleError(
      'invalid_cursor',
      'Invalid artifact cursor signature. Cursors are bound to the signing key of the process that ' +
      'issued them; if the server restarted, restart the query without a cursor.',
    );
  }
  const decoded = JSON.parse(payload.toString('utf8')) as Record<string, any>;
  if (decoded.v !== 3) {
    throw new ArtifactHandleError('invalid_cursor', 'Artifact cursor uses an unsupported response contract version');
  }
  return decoded;
}

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

class JsonPointerResolutionError extends Error {
  constructor(
    readonly requestedPath: string,
    readonly resolvedPath: string,
    readonly failedToken: string,
    readonly selectedValue: unknown,
  ) {
    super(`JSON pointer does not exist: ${requestedPath}`);
    this.name = 'JsonPointerResolutionError';
  }
}

function pointer(value: unknown, jsonPointer: string): unknown {
  if (jsonPointer === '') return value;
  if (!jsonPointer.startsWith('/')) {
    throw invalidResponseControls('responsePath and filter paths must use RFC 6901 JSON pointers');
  }
  let current = value;
  const resolvedTokens: string[] = [];
  for (const rawToken of jsonPointer.slice(1).split('/')) {
    const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current) && /^(0|[1-9]\d*)$/.test(token) && Number(token) < current.length) {
      current = current[Number(token)];
    } else if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, token)) {
      current = (current as Record<string, unknown>)[token];
    } else {
      const resolvedPath = resolvedTokens.length ? `/${resolvedTokens.join('/')}` : '';
      throw new JsonPointerResolutionError(jsonPointer, resolvedPath, rawToken, current);
    }
    resolvedTokens.push(rawToken);
  }
  return current;
}

function isMissingPointerError(error: unknown): boolean {
  return error instanceof JsonPointerResolutionError;
}

function responseRootCandidate(requestedPath: string, responseRoot: string): string | undefined {
  if (
    responseRoot === '' ||
    requestedPath === '' ||
    requestedPath === responseRoot ||
    requestedPath.startsWith(`${responseRoot}/`)
  ) return undefined;
  return `${responseRoot}${requestedPath}`;
}

function invalidResponsePath(
  error: JsonPointerResolutionError,
  responseRoot: string,
  attemptedPath?: string,
  attemptedError?: JsonPointerResolutionError,
): ResponseControlError {
  const diagnostic = attemptedError ?? error;
  const at = diagnostic.resolvedPath === '' ? 'the document root' : `"${diagnostic.resolvedPath}"`;
  const attempted = attemptedPath
    ? ` as an absolute pointer or relative to responseRoot=${JSON.stringify(responseRoot)} (tried "${attemptedPath}")`
    : '';
  return new ResponseControlError(
    'INVALID_RESPONSE_PATH',
    `INVALID_RESPONSE_PATH: "${error.requestedPath}" does not exist${attempted}. ` +
    `${at} resolves to ${jsonType(diagnostic.selectedValue)} and has no "${diagnostic.failedToken}" child. ` +
    `Available children: ${describeAvailableKeys(diagnostic.selectedValue)}. ` +
    `Retry without responsePath to use responseRoot=${JSON.stringify(responseRoot)}, ` +
    'or call with describe=true at a valid parent pointer.',
  );
}

function selectResponsePath(
  document: unknown,
  requestedPath: string,
  responseRoot: string,
): { selected: unknown; responsePath: string; inferredResponsePath?: string } {
  try {
    return { selected: pointer(document, requestedPath), responsePath: requestedPath };
  } catch (error) {
    if (!(error instanceof JsonPointerResolutionError)) throw error;
    const candidate = responseRootCandidate(requestedPath, responseRoot);
    if (!candidate) throw invalidResponsePath(error, responseRoot);
    try {
      return {
        selected: pointer(document, candidate),
        responsePath: candidate,
        inferredResponsePath: candidate,
      };
    } catch (attemptedError) {
      if (attemptedError instanceof JsonPointerResolutionError) {
        throw invalidResponsePath(error, responseRoot, candidate, attemptedError);
      }
      throw attemptedError;
    }
  }
}

function fieldPointer(field: string): string {
  if (typeof field !== 'string' || field.length === 0) {
    throw invalidResponseControls('fields entries must be non-empty strings');
  }
  if (field.startsWith('/')) return field;
  return `/${escapeToken(field)}`;
}

/** Human-readable key list for error messages, so a wrong pointer is self-correcting. */
function describeAvailableKeys(sample: unknown): string {
  if (Array.isArray(sample)) return `an array of ${sample.length} items`;
  if (sample && typeof sample === 'object') {
    const keys = Object.keys(sample as Record<string, unknown>);
    const shown = keys.slice(0, 30).map(key => `/${escapeToken(key)}`);
    return shown.length ? shown.join(', ') + (keys.length > shown.length ? `, … (${keys.length} total)` : '') : '(no properties)';
  }
  return `a ${sample === null ? 'null' : typeof sample} value with no properties`;
}

/** Select a one-level collection only when its shape is unambiguous. */
function singleArrayChild(value: unknown): { path: string; value: unknown[] } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const arrays = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
  if (arrays.length !== 1) return undefined;
  const [key, child] = arrays[0];
  return { path: `/${escapeToken(key)}`, value: child };
}

function joinResponsePath(base: string, child: string): string {
  return `${base}${child}`;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Unresolved pointers are OMITTED, not nulled, so a miss differs from a real null. */
function projectItem(item: unknown, fields: string[], resolved: Record<string, number>): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    try {
      value[field] = pointer(item, fieldPointer(field));
      resolved[field] = (resolved[field] ?? 0) + 1;
    } catch (error) {
      if (!isMissingPointerError(error)) throw error;
    }
  }
  return value;
}

function nestedFieldPointerHint(selected: unknown, fields: string[]): string {
  const samples = Array.isArray(selected) ? selected : [selected];
  const suggestions: Array<[string, string]> = [];
  for (const field of fields) {
    if (field.startsWith('/') || !field.includes('/')) continue;
    const candidate = `/${field}`;
    if (samples.some((sample) => {
      try {
        pointer(sample, candidate);
        return true;
      } catch (error) {
        if (error instanceof JsonPointerResolutionError) return false;
        throw error;
      }
    })) {
      suggestions.push([field, candidate]);
    }
  }

  if (suggestions.length === 0) return '';
  if (suggestions.length === 1) {
    const [field, candidate] = suggestions[0];
    return ` Nested field paths must begin with '/'. Did you mean '${candidate}' instead of '${field}'?`;
  }
  const rendered = suggestions.map(([field, candidate]) => `'${field}' -> '${candidate}'`).join(', ');
  return ` Nested field paths must begin with '/'. Did you mean: ${rendered}?`;
}

function projectSelection(
  selected: unknown,
  fields: string[],
): { value: unknown; resolved: Record<string, number> } {
  const resolved: Record<string, number> = {};
  for (const field of fields) resolved[field] = 0;

  if (Array.isArray(selected)) {
    const projected = selected.map(item => projectItem(item, fields, resolved));
    if (selected.length > 0 && !Object.values(resolved).some(count => count > 0)) {
      throw invalidResponseControls(
        `fields matched no properties on any of the ${selected.length} selected items. ` +
        `Each item exposes: ${describeAvailableKeys(selected[0])}. ` +
        `Use root names such as 'id' or RFC 6901 pointers such as '/status/name'.` +
        nestedFieldPointerHint(selected, fields),
      );
    }
    return { value: projected, resolved };
  }

  const projected = projectItem(selected, fields, resolved);
  if (!Object.values(resolved).some(count => count > 0)) {
    throw invalidResponseControls(
      `fields matched no properties. The selected value exposes: ${describeAvailableKeys(selected)}. ` +
      `Use root names such as 'id' or RFC 6901 pointers such as '/status/name'.` +
      nestedFieldPointerHint(selected, fields),
    );
  }
  return { value: projected, resolved };
}

/** Remove one redundant collection prefix only when every field uses it. */
function relativeFieldsForInferredArray(fields: string[], childPath: string): string[] | undefined {
  const prefix = `${childPath}/`;
  const normalized: string[] = [];
  for (const field of fields) {
    const candidate = fieldPointer(field);
    if (!candidate.startsWith(prefix)) return undefined;
    const relative = candidate.slice(childPath.length);
    if (relative === '' || relative === '/') return undefined;
    normalized.push(relative);
  }
  return normalized;
}

/** Keep caller-visible projection keys stable after a safe pointer rewrite. */
function restoreProjectedFieldLabels(
  projected: unknown[],
  requestedFields: string[],
  effectiveFields: string[],
): Record<string, unknown>[] {
  return projected.map(item => {
    const source = item as Record<string, unknown>;
    const restored: Record<string, unknown> = {};
    requestedFields.forEach((requested, index) => {
      const effective = effectiveFields[index];
      if (Object.prototype.hasOwnProperty.call(source, effective)) restored[requested] = source[effective];
    });
    return restored;
  });
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string') return typeof expected === 'string' && actual.includes(expected);
  if (Array.isArray(actual)) return actual.some(value => isDeepStrictEqual(value, expected));
  if (actual && typeof actual === 'object' && typeof expected === 'string') {
    return Object.prototype.hasOwnProperty.call(actual, expected);
  }
  return false;
}

function icontains(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  return actual.toLowerCase().includes(expected.toLowerCase());
}

interface FilterOutcome {
  /** The pointer resolved on this item. `exists` always counts as resolved — probing is its purpose. */
  resolved: boolean;
  /** Both operands were mutually comparable (only meaningful for lt/lte/gt/gte). */
  comparable: boolean;
  matched: boolean;
}

function evaluateFilter(item: unknown, filter: ResponseFilter): FilterOutcome {
  const op = filter.op ?? 'eq';
  let actual: unknown = MISSING;
  try {
    actual = pointer(item, filter.path);
  } catch (error) {
    if (!isMissingPointerError(error)) throw error;
  }

  if (op === 'exists') {
    const shouldExist = filter.value === undefined ? true : filter.value;
    if (typeof shouldExist !== 'boolean') throw invalidResponseControls('exists filter value must be boolean when provided');
    return { resolved: true, comparable: true, matched: (actual !== MISSING) === shouldExist };
  }

  if (actual === MISSING) return { resolved: false, comparable: false, matched: false };

  if (op === 'eq') return { resolved: true, comparable: true, matched: isDeepStrictEqual(actual, filter.value) };
  if (op === 'ne') return { resolved: true, comparable: true, matched: !isDeepStrictEqual(actual, filter.value) };
  if (op === 'in') {
    if (!Array.isArray(filter.value)) throw invalidResponseControls('in filter value must be an array');
    return { resolved: true, comparable: true, matched: filter.value.some(value => isDeepStrictEqual(actual, value)) };
  }
  if (op === 'contains') return { resolved: true, comparable: true, matched: contains(actual, filter.value) };
  if (op === 'icontains') return { resolved: true, comparable: true, matched: icontains(actual, filter.value) };

  // Strings compare lexicographically (correct for ISO-8601); a mismatched pair is
  // reported not-comparable rather than silently failing every item.
  const actualComparable = typeof actual === 'number' || typeof actual === 'string';
  const valueComparable = typeof filter.value === 'number' || typeof filter.value === 'string';
  if (!actualComparable || !valueComparable || typeof actual !== typeof filter.value) {
    return { resolved: true, comparable: false, matched: false };
  }
  const left = actual as number | string;
  const right = filter.value as number | string;
  if (op === 'lt') return { resolved: true, comparable: true, matched: left < right };
  if (op === 'lte') return { resolved: true, comparable: true, matched: left <= right };
  if (op === 'gt') return { resolved: true, comparable: true, matched: left > right };
  return { resolved: true, comparable: true, matched: left >= right };
}

/**
 * Filters and counts how often each pointer resolved. A pointer that resolves on nothing
 * is a query bug, not an empty result set, and must not read as a complete zero.
 */
function applyFilters(items: unknown[], filters: ResponseFilter[]): { kept: unknown[]; stats: FilterStat[] } {
  const stats: FilterStat[] = filters.map(filter => ({
    path: filter.path,
    op: filter.op ?? 'eq',
    resolvedOn: 0,
    matched: 0,
  }));
  const comparableOn = filters.map(() => 0);

  const kept = items.filter(item => {
    let all = true;
    // Every filter is evaluated for every item (no short-circuit) so the counts are honest.
    for (let index = 0; index < filters.length; index += 1) {
      const outcome = evaluateFilter(item, filters[index]);
      if (outcome.resolved) stats[index].resolvedOn += 1;
      if (outcome.comparable) comparableOn[index] += 1;
      if (outcome.matched) stats[index].matched += 1;
      else all = false;
    }
    return all;
  });

  if (items.length > 0) {
    const unresolved = stats.filter(stat => stat.resolvedOn === 0);
    if (unresolved.length > 0) {
      throw invalidResponseControls(
        `filter path did not resolve on any of the ${items.length} selected items: ` +
        `${unresolved.map(stat => stat.path).join(', ')}. Each item exposes: ` +
        `${describeAvailableKeys(items[0])}. Filter paths are RFC 6901 pointers relative to each item, ` +
        `not to the artifact root — use describe=true to inspect the real shape.`,
      );
    }
    const incomparable = stats.filter(
      (stat, index) => COMPARISON_OPERATIONS.has(stat.op) && comparableOn[index] === 0,
    );
    if (incomparable.length > 0) {
      throw invalidResponseControls(
        `filter comparison never had comparable operands: ` +
        `${incomparable.map(stat => `${stat.path} ${stat.op}`).join(', ')}. ` +
        `The stored values and the supplied value must both be numbers, or both strings. ` +
        `Check for a numeric field compared against a quoted string.`,
      );
    }
  }

  return { kept, stats };
}

interface CompactLimits {
  depth: number;
  arrayItems: number;
  objectKeys: number;
  stringChars: number;
}

const DEFAULT_COMPACT_LIMITS: CompactLimits = { depth: 4, arrayItems: 3, objectKeys: 20, stringChars: 1000 };

/**
 * Lossy preview summary. Truncated arrays must carry a remainder marker, and scalars
 * must survive at any depth — otherwise a count becomes "[nested value omitted]".
 */
function compactWith(value: unknown, limits: CompactLimits, depth = 0): unknown {
  if (Array.isArray(value)) {
    if (depth >= limits.depth) return { _omittedArray: value.length };
    const kept: unknown[] = value.slice(0, limits.arrayItems).map(item => compactWith(item, limits, depth + 1));
    if (value.length > limits.arrayItems) kept.push({ _omittedItems: value.length - limits.arrayItems });
    return kept;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= limits.depth) return { _omittedObject: entries.length };
    const result: Record<string, unknown> = {};
    for (const [key, child] of entries.slice(0, limits.objectKeys)) {
      result[key] = compactWith(child, limits, depth + 1);
    }
    if (entries.length > limits.objectKeys) result._omittedFields = entries.length - limits.objectKeys;
    return result;
  }
  if (typeof value === 'string' && value.length > limits.stringChars) {
    return `${value.slice(0, limits.stringChars)}… [${value.length} chars total]`;
  }
  return value;
}

/** Compacts until the assembled result fits `budget`; plain compact() is unbounded. */
function compactToBudget(value: unknown, budget: number, wrap: (compacted: unknown) => unknown): unknown {
  const ladder: CompactLimits[] = [
    DEFAULT_COMPACT_LIMITS,
    { depth: 3, arrayItems: 2, objectKeys: 12, stringChars: 400 },
    { depth: 2, arrayItems: 1, objectKeys: 8, stringChars: 200 },
    { depth: 1, arrayItems: 1, objectKeys: 5, stringChars: 100 },
  ];
  let compacted: unknown = null;
  for (const limits of ladder) {
    compacted = compactWith(value, limits);
    if (emittedBytes(wrap(compacted)) <= budget) return compacted;
  }
  return {
    _summaryUnavailable: 'value is too large to summarize within the inline budget',
    _type: jsonType(value),
    _nextStep: 'query a narrower responsePath, project fewer fields, or use textSearch for large strings',
  };
}

interface KeyShape {
  name: string;
  pointer: string;
  type: string;
  length?: number;
}

function shapeOf(container: unknown, keyLimit: number): KeyShape[] {
  if (!container || typeof container !== 'object') return [];
  const entries = Object.entries(container as Record<string, unknown>).slice(0, keyLimit);
  return entries.map(([name, child]) => {
    const shape: KeyShape = { name, pointer: `/${escapeToken(name)}`, type: jsonType(child) };
    if (Array.isArray(child)) shape.length = child.length;
    else if (typeof child === 'string') shape.length = child.length;
    else if (child && typeof child === 'object') shape.length = Object.keys(child).length;
    return shape;
  });
}

/** Shape at a path without values; array item keys are merged across a sample. */
function describeSelection(
  selected: unknown,
  responsePath: string,
  offset: number,
  pageSize: number,
  sampleSize = 20,
): { shape: Record<string, unknown>; total: number; returned: number } {
  const type = jsonType(selected);
  if (Array.isArray(selected)) {
    const merged = new Map<string, KeyShape>();
    for (const item of selected.slice(0, sampleSize)) {
      for (const shape of shapeOf(item, Number.MAX_SAFE_INTEGER)) {
        if (!merged.has(shape.name)) merged.set(shape.name, shape);
      }
    }
    const keys = Array.from(merged.values());
    const page = keys.slice(offset, offset + pageSize);
    return { shape: {
      type,
      length: selected.length,
      sampledItems: Math.min(selected.length, sampleSize),
      itemType: selected.length ? jsonType(selected[0]) : null,
      itemKeys: page,
      note: 'itemKeys pointers are relative to each item — use them for filters[].path and fields.',
    }, total: keys.length, returned: page.length };
  }
  if (selected && typeof selected === 'object') {
    const entries = Object.entries(selected as Record<string, unknown>);
    const page = shapeOf(Object.fromEntries(entries.slice(offset, offset + pageSize)), pageSize)
      .map(key => ({
        ...key,
        pointer: `${responsePath}/${escapeToken(key.name)}`,
      }));
    return { shape: {
      type,
      entryCount: entries.length,
      keys: page,
      note: 'keys pointers are absolute RFC 6901 pointers from the artifact root.',
    }, total: entries.length, returned: page.length };
  }
  const shape: Record<string, unknown> = { type };
  if (typeof selected === 'string') shape.length = selected.length;
  return { shape, total: 0, returned: 0 };
}

/** Pointers to the main collections. Bounded walk: arrays sampled at [0], budget capped. */
function primaryPaths(value: unknown, limit = 6): string[] {
  const found: Array<{ pointer: string; score: number }> = [];
  let budget = 4000;

  const walk = (node: unknown, at: string, depth: number): void => {
    if (budget <= 0 || depth > 4 || node === null || typeof node !== 'object') return;
    budget -= 1;
    if (Array.isArray(node)) {
      // Only collections worth paging; skip incidental arrays like /nodes/0/position.
      if (node.length >= 5) found.push({ pointer: at === '' ? '/' : at, score: node.length });
      walk(node[0], `${at}/0`, depth + 1);
      return;
    }
    const entries = Object.entries(node as Record<string, unknown>);
    const objectValued = entries.filter(([, child]) => child !== null && typeof child === 'object' && !Array.isArray(child)).length;
    // A keyed collection (e.g. execution nodes keyed by node name) is as useful a
    // landing point as an array.
    if (at !== '' && entries.length >= 5 && objectValued >= entries.length / 2) {
      found.push({ pointer: at, score: entries.length });
    }
    for (const [key, child] of entries) {
      if (budget <= 0) return;
      walk(child, `${at}/${escapeToken(key)}`, depth + 1);
    }
  };

  walk(value, '', 0);
  const seen = new Set<string>();
  return found
    .sort((a, b) => b.score - a.score)
    .filter(entry => !seen.has(entry.pointer) && seen.add(entry.pointer))
    .slice(0, limit)
    .map(entry => entry.pointer);
}

/** Detects reduction the upstream tool handler applied before we ever saw the payload. */
function detectSourceTruncation(value: unknown): boolean {
  let budget = 4000;
  const walk = (node: unknown, depth: number): boolean => {
    if (budget <= 0 || depth > 6 || node === null || typeof node !== 'object') return false;
    budget -= 1;
    if (Array.isArray(node)) return node.slice(0, 5).some(child => walk(child, depth + 1));
    const record = node as Record<string, unknown>;
    if (record.truncated === true || record.hasMoreData === true || record.hasMore === true) return true;
    for (const child of Object.values(record)) {
      if (budget <= 0) return false;
      if (walk(child, depth + 1)) return true;
    }
    return false;
  };
  return walk(value, 0);
}

function completionMetadata(
  truncated: boolean,
  returnedCount: number | null,
  totalCount: number | null,
  offset = 0,
): Pick<ResponseMeta, 'complete' | 'remainingCount' | 'warning'> {
  return {
    complete: !truncated,
    remainingCount: totalCount !== null && returnedCount !== null
      ? Math.max(totalCount - offset - returnedCount, 0)
      : null,
    warning: truncated
      ? 'INCOMPLETE RESULT: do not treat the visible response as exhaustive; follow nextCursor until it is null or query the response artifact.'
      : null,
  };
}

interface ConnectionEdge {
  from: string;
  to: string;
  type: string;
  output: number;
  index: number;
}

/** Flattens an n8n connections map into an edge list. */
function connectionEdges(connections: unknown, limit = 400): { edges: ConnectionEdge[]; omitted: number } {
  const edges: ConnectionEdge[] = [];
  let omitted = 0;
  if (!connections || typeof connections !== 'object') return { edges, omitted };
  for (const [from, outputs] of Object.entries(connections as Record<string, any>)) {
    if (!outputs || typeof outputs !== 'object') continue;
    for (const [type, outputGroups] of Object.entries(outputs as Record<string, any>)) {
      if (!Array.isArray(outputGroups)) continue;
      outputGroups.forEach((group: any, output: number) => {
        if (!Array.isArray(group)) return;
        for (const target of group) {
          if (!target || typeof target !== 'object') continue;
          if (edges.length >= limit) { omitted += 1; continue; }
          edges.push({
            from,
            to: String((target as any).node ?? ''),
            type,
            output,
            index: Number((target as any).index ?? 0),
          });
        }
      });
    }
  }
  return { edges, omitted };
}

function compactToolValue(toolName: string, value: unknown): unknown {
  if (toolName === 'n8n_get_workflow' && value && typeof value === 'object') {
    const response = value as Record<string, any>;
    const workflow = response.data?.workflow ?? response.data;
    if (workflow && typeof workflow === 'object') {
      const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
      const { edges, omitted } = connectionEdges(workflow.connections);
      return {
        success: response.success ?? true,
        data: {
          id: workflow.id,
          name: workflow.name,
          active: workflow.active,
          nodeCount: nodes.length,
          // Not pre-sliced: compactToBudget is the single truncation point, so exactly one
          // _omittedItems marker appears and it reconciles against nodeCount.
          nodes: nodes.map((node: Record<string, unknown>) => ({
            id: node.id, name: node.name, type: node.type, typeVersion: node.typeVersion, disabled: node.disabled,
          })),
          connectionCount: edges.length + omitted,
          connections: edges,
          connectionsOmitted: omitted,
        },
      };
    }
  }
  if (toolName === 'n8n_executions' && value && typeof value === 'object') {
    const response = value as Record<string, any>;
    const data = response.data;
    if (Array.isArray(data?.executions)) {
      const executions = data.executions;
      return {
        success: response.success ?? true,
        data: {
          executions: executions.slice(0, DEFAULT_PAGE_SIZE).map((execution: Record<string, unknown>) => ({
            id: execution.id,
            workflowId: execution.workflowId,
            status: execution.status,
            mode: execution.mode,
            startedAt: execution.startedAt,
            stoppedAt: execution.stoppedAt,
            finished: execution.finished,
          })),
          returned: Math.min(executions.length, DEFAULT_PAGE_SIZE),
          // Size of the upstream page, not a global total.
          pageCount: executions.length,
          nextCursor: data.nextCursor,
          hasMore: executions.length > DEFAULT_PAGE_SIZE || Boolean(data.nextCursor),
        },
      };
    }
  }
  return compactWith(value, DEFAULT_COMPACT_LIMITS);
}

function paths(artifactId: string): { data: string; meta: string } {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(artifactId)) {
    throw new ArtifactHandleError('invalid_id', 'Invalid artifact id');
  }
  const root = rootPath();
  return { data: path.join(root, `response-${artifactId}.json`), meta: path.join(root, `response-${artifactId}.meta.json`) };
}

function atomicWrite(destination: string, content: Buffer): void {
  const temporary = `${destination}.${process.pid}.${randomBytes(4).toString('hex')}.part`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, destination);
}

interface ArtifactMetadata {
  contractVersion: 3;
  owner: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  expiresAt: string;
  responseRoot: string;
  primaryPaths?: string[];
  sourceTruncated?: boolean;
}

function artifactReference(artifactId: string, metadata: ArtifactMetadata): ArtifactReference {
  return {
    id: artifactId,
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    expiresAt: metadata.expiresAt,
    queryTool: 'query_response_artifact',
    responseRoot: metadata.responseRoot,
    primaryPaths: metadata.primaryPaths ?? [],
    sourceTruncated: metadata.sourceTruncated ?? false,
  };
}

function loadMetadata(artifactId: string, owner: string): { dataPath: string; metadata: ArtifactMetadata } {
  const target = paths(artifactId);
  if (!existsSync(target.data) || !existsSync(target.meta)) {
    throw new ArtifactHandleError(
      'unknown',
      'Response artifact handle is unknown. It was never created, or it was pruned. ' +
      're-run the tool that produced it to mint a new artifact.',
    );
  }
  const metadata = JSON.parse(readFileSync(target.meta, 'utf8')) as ArtifactMetadata;
  if (metadata.contractVersion !== 3) {
    throw new ArtifactHandleError(
      'unknown',
      'Response artifact uses an unsupported contract version; re-run the tool that produced it.',
    );
  }
  if (metadata.owner !== safeOwner(owner)) {
    throw new ArtifactHandleError(
      'wrong_scope',
      'Response artifact belongs to a different MCP scope (a different n8n instance or credential). ' +
      're-run the originating tool on this connection to mint an artifact in this scope.',
    );
  }
  if (Date.parse(metadata.expiresAt) <= Date.now()) {
    unlinkSync(target.data);
    unlinkSync(target.meta);
    if (parsedArtifact?.artifactId === artifactId) parsedArtifact = null;
    throw new ArtifactHandleError(
      'expired',
      `Response artifact handle expired at ${metadata.expiresAt}. ` +
      're-run the tool that produced it to mint a new artifact.',
    );
  }
  return { dataPath: target.data, metadata };
}

export function describeResponseArtifact(artifactId: string, owner: string): ArtifactDescriptor {
  const { metadata } = loadMetadata(artifactId, owner);
  return {
    descriptorVersion: 1,
    contractVersion: 3,
    ...artifactReference(artifactId, metadata),
    rawReadable: false,
    guidance: 'This resource is a bounded descriptor only. Use query_response_artifact to inspect stored values.',
  };
}

export function deleteResponseArtifact(artifactId: string, owner: string): boolean {
  const target = paths(artifactId);
  if (!existsSync(target.data) && !existsSync(target.meta)) return false;
  const { dataPath } = loadMetadata(artifactId, owner);
  let deleted = false;
  for (const file of [dataPath, target.meta]) {
    if (existsSync(file)) {
      unlinkSync(file);
      deleted = true;
    }
  }
  if (parsedArtifact?.artifactId === artifactId) parsedArtifact = null;
  return deleted;
}

/**
 * Holds exactly one parsed artifact, which matches the access pattern: a caller pages
 * through a single artifact. A multi-entry cache sized in *serialized* bytes was the
 * wrong shape — a parsed graph measures up to 4x its serialized form, so the nominal
 * budget under-counted heap by that much, and admitting only documents under the budget
 * excluded the large artifacts that motivated caching at all.
 */
let parsedArtifact: { artifactId: string; mtimeMs: number; expiresAt: number; document: unknown } | null = null;

function loadDocument(artifactId: string, dataPath: string): unknown {
  const stats = statSync(dataPath);
  const now = Date.now();
  if (parsedArtifact
    && parsedArtifact.artifactId === artifactId
    && parsedArtifact.mtimeMs === stats.mtimeMs
    && parsedArtifact.expiresAt > now) {
    return parsedArtifact.document;
  }

  // Drop the previous document before parsing the next so both are never live at once.
  parsedArtifact = null;

  let document: unknown;
  try {
    document = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch {
    throw new Error('Response artifact does not contain valid JSON');
  }

  parsedArtifact = { artifactId, mtimeMs: stats.mtimeMs, expiresAt: now + PARSE_CACHE_TTL_MS, document };
  return document;
}

let lastPruneMs = 0;

export function pruneResponseArtifacts(now = Date.now()): void {
  const root = rootPath();
  if (!existsSync(root)) return;
  lastPruneMs = now;
  const candidates = readdirSync(root)
    .filter(name => name.startsWith('response-'))
    .map(name => ({ name, file: path.join(root, name) }))
    .filter(entry => !entry.name.endsWith('.meta.json'))
    .map(entry => ({ ...entry, stat: statSync(entry.file) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
  let total = candidates.reduce((sum, entry) => sum + entry.stat.size, 0);
  for (const entry of candidates) {
    if (entry.stat.mtimeMs < now - DEFAULT_ARTIFACT_TTL_MS || total > DEFAULT_ARTIFACT_QUOTA_BYTES) {
      unlinkSync(entry.file);
      const meta = entry.file.replace(/\.json$/, '.meta.json');
      if (existsSync(meta)) unlinkSync(meta);
      total -= entry.stat.size;
    }
  }
}

export function persistResponseArtifact(value: unknown, owner: string, encoded?: Buffer): ArtifactReference {
  // `encoded` lets a caller that already serialized the value hand the buffer over
  // rather than paying a second full pass on a payload up to the artifact ceiling.
  const content = encoded ?? encode(value);
  if (content.length > DEFAULT_ARTIFACT_MAX_BYTES) {
    throw new Error(`MCP result exceeds the ${DEFAULT_ARTIFACT_MAX_BYTES}-byte artifact limit`);
  }
  const root = rootPath();
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const scopedOwner = safeOwner(owner);
  const digest = createHash('sha256').update(content).digest('hex');
  // Content-addressed per scope: an identical repeat reuses one handle. Still opaque —
  // a hash exposes no internal structure.
  const id = createHash('sha256').update(`${scopedOwner}:${digest}`).digest('hex').slice(0, 48);
  const target = paths(id);
  const expiresAt = new Date(Date.now() + DEFAULT_ARTIFACT_TTL_MS).toISOString();
  const metadata: ArtifactMetadata = {
    contractVersion: 3,
    owner: scopedOwner,
    mediaType: 'application/json',
    byteLength: content.length,
    sha256: digest,
    expiresAt,
    responseRoot: '',
    primaryPaths: primaryPaths(value),
    sourceTruncated: detectSourceTruncation(value),
  };

  const reused = existsSync(target.data) && existsSync(target.meta);
  if (reused) {
    // Refresh the TTL so a long-running session cannot have a handle expire underneath it.
    const now = new Date();
    utimesSync(target.data, now, now);
  } else {
    // Prune only when actually adding a file, and at most once a minute: the scan is a
    // readdir plus a stat per artifact, which is wasted work on a dedup hit.
    if (Date.now() - lastPruneMs > 60_000) pruneResponseArtifacts();
    atomicWrite(target.data, content);
  }
  atomicWrite(target.meta, encode(metadata));
  logger.debug('Persisted MCP response artifact', {
    artifactId: id,
    bytes: content.length,
    reused,
    root,
    primaryPaths: metadata.primaryPaths,
    sourceTruncated: metadata.sourceTruncated,
  });
  return artifactReference(id, metadata);
}

type Selection =
  | { kind: 'array'; items: unknown[] }
  | { kind: 'object'; entries: Array<[string, unknown]> }
  | { kind: 'scalar'; value: unknown };

function classify(selected: unknown): Selection {
  if (Array.isArray(selected)) return { kind: 'array', items: selected };
  if (selected && typeof selected === 'object') {
    return { kind: 'object', entries: Object.entries(selected as Record<string, unknown>) };
  }
  return { kind: 'scalar', value: selected };
}

interface TextSearchMatch {
  pointer: string;
  offset: number;
  context: string;
  contextStart: number;
  contextEnd: number;
}

const TEXT_SEARCH_MAX_MATCHES = 20;
const TEXT_SEARCH_CONTEXT_CHARS = 240;

function searchStringValues(
  selected: unknown,
  responsePath: string,
  search: TextSearch,
): { matches: TextSearchMatch[]; truncated: boolean } {
  if (!search || typeof search !== 'object' || typeof search.query !== 'string') {
    throw invalidResponseControls('textSearch.query must be a non-empty string');
  }
  if (search.query.length < 1 || search.query.length > 500) {
    throw invalidResponseControls('textSearch.query must contain between 1 and 500 characters');
  }

  const needle = search.caseSensitive ? search.query : search.query.toLowerCase();
  const matches: TextSearchMatch[] = [];
  let truncated = false;

  const visit = (value: unknown, at: string): void => {
    if (truncated) return;
    if (typeof value === 'string') {
      const haystack = search.caseSensitive ? value : value.toLowerCase();
      let from = 0;
      while (from <= haystack.length) {
        const offset = haystack.indexOf(needle, from);
        if (offset < 0) break;
        if (matches.length >= TEXT_SEARCH_MAX_MATCHES) {
          truncated = true;
          return;
        }
        const flank = Math.floor((TEXT_SEARCH_CONTEXT_CHARS - search.query.length) / 2);
        const contextStart = Math.max(0, offset - Math.max(flank, 0));
        const contextEnd = Math.min(value.length, contextStart + TEXT_SEARCH_CONTEXT_CHARS);
        matches.push({
          pointer: at || '',
          offset,
          context: value.slice(contextStart, contextEnd),
          contextStart,
          contextEnd,
        });
        from = offset + Math.max(needle.length, 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${at}/${index}`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, `${at}/${escapeToken(key)}`);
        if (truncated) return;
      }
    }
  };

  visit(selected, responsePath);
  return { matches, truncated };
}

function objectModeSuggestion(
  artifactId: string,
  responsePath: string,
  pageSize: number,
  fields?: string[],
  filters?: ResponseFilter[],
): Record<string, unknown> {
  const suggested: Record<string, unknown> = {
    artifactId,
    responsePath,
    objectMode: 'entries',
    pageSize,
  };
  if (filters?.length) {
    suggested.filters = filters.map(filter => ({
      ...filter,
      path: filter.path === '/from' ? '/key' : filter.path.startsWith('/value/') || filter.path === '/key'
        ? filter.path
        : `/value${filter.path}`,
    }));
  }
  if (fields?.length) {
    suggested.fields = fields.map(field => field === 'key' || field === '/key'
      ? 'key'
      : field.startsWith('/value/') ? field : `/value${fieldPointer(field)}`);
  } else if (filters?.length) {
    suggested.fields = ['key', 'value'];
  }
  return suggested;
}

function objectModeRequired(
  artifactId: string,
  responsePath: string,
  pageSize: number,
  fields?: string[],
  filters?: ResponseFilter[],
): ResponseControlError {
  const suggestion = objectModeSuggestion(artifactId, responsePath, pageSize, fields, filters);
  return invalidResponseControls(
    `OBJECT_MODE_REQUIRED: ${responsePath || '/'} selects a keyed JSON object, not an array. ` +
    `Query its entries and filter /key or fields beneath /value. suggestedRequest=${JSON.stringify(suggestion)}`,
  );
}

function isKeyedObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length < 2) return false;
  const objectValues = entries.filter(child => child !== null && typeof child === 'object' && !Array.isArray(child));
  return objectValues.length >= entries.length / 2;
}

export function queryResponseArtifact(
  artifactId: string,
  responsePath: string | undefined,
  fields: string[] | undefined,
  filters: ResponseFilter[] | undefined,
  pageSize: number,
  cursor: string | undefined,
  owner: string,
  describe = false,
  objectMode?: 'entries',
  textSearch?: TextSearch,
): unknown {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw invalidResponseControls(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  if (fields && fields.length > 50) throw invalidResponseControls('fields accepts at most 50 entries');
  if (filters && filters.length > 10) throw invalidResponseControls('filters accepts at most 10 predicates');
  for (const filter of filters ?? []) {
    if (!filter || typeof filter !== 'object' || typeof filter.path !== 'string') {
      throw invalidResponseControls('each filter must be an object with an RFC 6901 path');
    }
    if (filter.op !== undefined && !FILTER_OPERATIONS.includes(filter.op)) {
      throw invalidResponseControls(`Unsupported filter operation: ${filter.op}`);
    }
  }

  const { dataPath, metadata } = loadMetadata(artifactId, owner);
  const document = loadDocument(artifactId, dataPath);
  responsePath = responsePath ?? metadata.responseRoot;
  const sourceTruncated = metadata.sourceTruncated ?? false;
  const resolution = selectResponsePath(document, responsePath, metadata.responseRoot);
  let selected = resolution.selected;
  responsePath = resolution.responsePath;
  let inferredResponsePath = resolution.inferredResponsePath;

  if (textSearch !== undefined) {
    if (describe || fields?.length || filters?.length || objectMode !== undefined || cursor) {
      throw invalidResponseControls('textSearch cannot be combined with describe, fields, filters, objectMode, or cursor');
    }
    const searched = searchStringValues(selected, responsePath, textSearch);
    const meta: ResponseMeta = {
      contractVersion: 3,
      truncated: searched.truncated,
      complete: !searched.truncated,
      truncationReason: searched.truncated ? 'match_limit' : null,
      returnedCount: searched.matches.length,
      totalCount: searched.truncated ? null : searched.matches.length,
      remainingCount: null,
      nextCursor: null,
      serializedBytes: 0,
      pageUnit: 'items',
      sourceTruncated,
      warning: searched.truncated
        ? `More than ${TEXT_SEARCH_MAX_MATCHES} matches exist; narrow responsePath or use a more specific literal.`
        : null,
    };
    if (inferredResponsePath) meta.inferredResponsePath = inferredResponsePath;
    const result = {
      artifactId,
      responsePath,
      response: searched.matches,
      responseMeta: meta,
    };
    meta.serializedBytes = emittedBytes(result);
    return result;
  }

  if (describe) {
    if (fields?.length || filters?.length) {
      throw invalidResponseControls('describe cannot be combined with fields or filters');
    }
    if (objectMode !== undefined) {
      throw invalidResponseControls('describe cannot be combined with objectMode');
    }
    const viewHash = createHash('sha256').update(encode({
      contractVersion: 3,
      artifactId,
      responsePath,
      describe: true,
      pageSize,
    })).digest('hex');
    let offset = 0;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded.owner !== safeOwner(owner) || decoded.artifactId !== artifactId || decoded.viewHash !== viewHash) {
        throw new ArtifactHandleError('invalid_cursor', 'Artifact shape cursor does not match this artifact, scope, path, or page size');
      }
      offset = decoded.offset;
    }
    const described = describeSelection(selected, responsePath, offset, pageSize);
    if (offset > described.total) {
      throw new ArtifactHandleError('invalid_cursor', 'Artifact shape cursor is past the end of the selection');
    }
    const nextOffset = offset + described.returned;
    const nextCursor = nextOffset < described.total
      ? encodeCursor({ artifactId, owner: safeOwner(owner), viewHash, offset: nextOffset })
      : null;
    const result = {
      artifactId,
      responsePath,
      shape: described.shape,
      responseMeta: {
        contractVersion: 3,
        truncated: nextCursor !== null,
        truncationReason: nextCursor ? 'page_limit' : null,
        returnedCount: described.returned,
        totalCount: described.total,
        nextCursor,
        serializedBytes: 0,
        pageUnit: 'entries' as const,
        sourceTruncated,
        ...(inferredResponsePath ? { inferredResponsePath } : {}),
        ...completionMetadata(nextCursor !== null, described.returned, described.total, offset),
      } satisfies ResponseMeta,
    };
    result.responseMeta.serializedBytes = emittedBytes(result);
    return result;
  }

  if (objectMode !== undefined) {
    if (objectMode !== 'entries') throw invalidResponseControls(`Unsupported objectMode: ${objectMode}`);
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
      throw invalidResponseControls(`objectMode=entries requires responsePath to select a JSON object, but it selects ${jsonType(selected)}`);
    }
    selected = Object.entries(selected as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  }

  let filterStats: FilterStat[] | undefined;
  if (filters?.length) {
    let selectedArray: unknown[];
    if (Array.isArray(selected)) {
      selectedArray = selected;
    } else {
      const inferred = singleArrayChild(selected);
      if (!inferred) {
        if (isKeyedObject(selected)) {
          throw objectModeRequired(artifactId, responsePath, pageSize, fields, filters);
        }
        throw invalidResponseControls(`filters require responsePath to select a JSON array, but ${responsePath || '/'} selects ${jsonType(selected)}. Use describe=true to find an array path.`);
      }
      inferredResponsePath = joinResponsePath(responsePath, inferred.path);
      selectedArray = inferred.value;
    }
    const applied = applyFilters(selectedArray, filters);
    selected = applied.kept;
    filterStats = applied.stats;
  }

  let fieldsResolved: Record<string, number> | undefined;
  let fieldNormalizationWarning: string | undefined;
  if (fields?.length) {
    let projected: ReturnType<typeof projectSelection>;
    try {
      projected = projectSelection(selected, fields);
    } catch (error) {
      const inferred = error instanceof Error && error.message.includes('fields matched no properties')
        ? singleArrayChild(selected) : undefined;
      if (!inferred) {
        if (isKeyedObject(selected)) {
          throw objectModeRequired(artifactId, responsePath, pageSize, fields, filters);
        }
        throw error;
      }
      inferredResponsePath = joinResponsePath(responsePath, inferred.path);
      selected = inferred.value;
      try {
        projected = projectSelection(selected, fields);
      } catch (inferredError) {
        const normalizedFields = inferredError instanceof Error
          && inferredError.message.includes('fields matched no properties')
          ? relativeFieldsForInferredArray(fields, inferred.path)
          : undefined;
        if (!normalizedFields) throw inferredError;
        const normalized = projectSelection(selected, normalizedFields);
        projected = {
          value: restoreProjectedFieldLabels(normalized.value as unknown[], fields, normalizedFields),
          resolved: Object.fromEntries(fields.map((field, index) => [
            field,
            normalized.resolved[normalizedFields[index]],
          ])),
        };
        fieldNormalizationWarning =
          `Inferred collection ${inferredResponsePath} and interpreted fields relative to each item: ` +
          `${normalizedFields.join(', ')}.`;
      }
    }
    selected = projected.value;
    fieldsResolved = projected.resolved;
  }

  const viewHash = createHash('sha256').update(encode({
    contractVersion: 3,
    artifactId,
    responsePath,
    objectMode: objectMode ?? null,
    fields: fields ?? null,
    filters: filters ?? null,
    pageSize,
  })).digest('hex');

  let offset = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor) as {
      artifactId: string;
      owner: string;
      viewHash: string;
      offset: number;
    };
    if (decoded.owner !== safeOwner(owner)) {
      throw new ArtifactHandleError('invalid_cursor', 'Artifact query cursor was issued for a different MCP scope');
    }
    if (decoded.artifactId !== artifactId) {
      throw new ArtifactHandleError(
        'invalid_cursor',
        `Artifact query cursor was issued for ${decoded.artifactId}, not ${artifactId}.`,
      );
    }
    if (decoded.viewHash !== viewHash) {
      throw new ArtifactHandleError(
        'invalid_cursor',
        'Artifact query cursor does not match this query. A cursor is bound to its exact ' +
        'responsePath, fields, filters and pageSize — repeat the original arguments, or restart without a cursor.',
      );
    }
    offset = decoded.offset;
  }

  const selection = classify(selected);
  const unitWarnings: string[] = [];
  if (fieldNormalizationWarning) unitWarnings.push(fieldNormalizationWarning);
  if (fieldsResolved && Object.values(fieldsResolved).some(count => count > 0)) {
    const missing = Object.entries(fieldsResolved).filter(([, count]) => count === 0).map(([field]) => field);
    if (missing.length) {
      unitWarnings.push(
        `fields did not resolve on any selected item and were omitted from every result: ${missing.join(', ')}.`,
      );
    }
  }
  if (sourceTruncated) {
    unitWarnings.push(
      'The stored artifact is itself a reduced view produced by the originating tool; ' +
      'completeness here refers to this artifact, not to everything upstream holds.',
    );
  }

  // Scalars cannot be paged. Compact within budget and say so explicitly.
  if (selection.kind === 'scalar') {
    const build = (response: unknown, truncated: boolean) => {
      const meta: ResponseMeta = {
        contractVersion: 3,
        truncated,
        truncationReason: truncated ? 'scalar_size_limit' : null,
        returnedCount: null,
        totalCount: null,
        nextCursor: null,
        serializedBytes: 0,
        sourceTruncated,
        ...completionMetadata(truncated, null, null),
      };
      if (filterStats) meta.filtersApplied = filterStats;
      if (fieldsResolved) meta.fieldsResolved = fieldsResolved;
      if (inferredResponsePath) meta.inferredResponsePath = inferredResponsePath;
      const notes = [...unitWarnings];
      if (truncated) notes.push('The selected value exceeded the inline budget; query a narrower responsePath or use textSearch for a literal within large strings.');
      if (notes.length) meta.warning = [meta.warning, ...notes].filter(Boolean).join(' ');
      return { artifactId, responsePath, response, responseMeta: meta };
    };
    const direct = build(selection.value, false);
    if (emittedBytes(direct) <= INLINE_RESULT_BYTES) {
      direct.responseMeta.serializedBytes = emittedBytes(direct);
      return direct;
    }
    const compacted = compactToBudget(selection.value, INLINE_RESULT_BYTES, value => build(value, true));
    const result = build(compacted, true);
    result.responseMeta.serializedBytes = emittedBytes(result);
    return result;
  }

  const pageUnit: 'items' | 'entries' = selection.kind === 'array' ? 'items' : 'entries';
  const totalCount = selection.kind === 'array' ? selection.items.length : selection.entries.length;

  const slice = (from: number, count: number): unknown => {
    if (selection.kind === 'array') return selection.items.slice(from, from + count);
    return Object.fromEntries(selection.entries.slice(from, from + count));
  };
  const build = (response: unknown, returnedCount: number, nextCursor: string | null, truncationReason: string | null) => {
    const truncated = nextCursor !== null || truncationReason !== null;
    const meta: ResponseMeta = {
      contractVersion: 3,
      truncated,
      truncationReason,
      returnedCount,
      totalCount,
      nextCursor,
      serializedBytes: 0,
      pageUnit,
      sourceTruncated,
      ...completionMetadata(truncated, returnedCount, totalCount, offset),
    };
    if (filterStats) meta.filtersApplied = filterStats;
    if (fieldsResolved) meta.fieldsResolved = fieldsResolved;
    if (inferredResponsePath) meta.inferredResponsePath = inferredResponsePath;
    const notes = [...unitWarnings];
    if (truncationReason === 'item_size_limit') {
      notes.push(
        `A single ${pageUnit === 'entries' ? 'entry' : 'item'} at offset ${offset} exceeded the inline ` +
        `budget and was summarized. Query a narrower responsePath beneath it, project fewer fields, ` +
        `or use textSearch for a literal within large strings.`,
      );
    }
    if (notes.length) meta.warning = [meta.warning, ...notes].filter(Boolean).join(' ');
    return { artifactId, responsePath, response, responseMeta: meta };
  };

  if (offset > totalCount) {
    throw new ArtifactHandleError('invalid_cursor', 'Artifact query cursor is past the end of the selection');
  }

  const maxCount = Math.min(pageSize, Math.max(totalCount - offset, 0));
  let reason: string | null = null;

  const fits = (n: number): boolean => {
    if (n === 0) return true;
    const tentativeOffset = offset + n;
    const tentativeCursor = tentativeOffset < totalCount
      ? encodeCursor({ artifactId, owner: safeOwner(owner), viewHash, offset: tentativeOffset })
      : null;
    const tentativeReason = tentativeCursor ? (n === pageSize ? 'page_limit' : 'size_limit') : null;
    return emittedBytes(build(slice(offset, n), n, tentativeCursor, tentativeReason)) <= INLINE_RESULT_BYTES;
  };

  // Serialized size grows monotonically with the element count, so bisect for the
  // largest page that fits. Walking down one element at a time re-serialized the whole
  // candidate page on every step: ~100 serializations and ~148 MB for a page of large
  // items, against ~7 and ~3 MB here.
  let count = maxCount;
  if (maxCount > 0 && !fits(maxCount)) {
    let low = 0;
    let high = maxCount;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    count = low;
  }

  let page: unknown = slice(offset, count);
  let returnedCount = count;
  if (count === 0 && offset < totalCount) {
    // One oversized element must still advance the offset, or the caller loops forever.
    const single = slice(offset, 1);
    const compactedSingle = compactToBudget(
      single,
      INLINE_RESULT_BYTES,
      value => build(value, 1, null, 'item_size_limit'),
    );
    page = compactedSingle;
    returnedCount = 1;
    reason = 'item_size_limit';
  }

  const nextOffset = offset + returnedCount;
  const nextCursor = nextOffset < totalCount
    ? encodeCursor({ artifactId, owner: safeOwner(owner), viewHash, offset: nextOffset })
    : null;
  reason = reason ?? (nextCursor ? (returnedCount === pageSize ? 'page_limit' : 'size_limit') : null);

  const result = build(page, returnedCount, nextCursor, reason);
  result.responseMeta.serializedBytes = emittedBytes(result);
  if (emittedBytes(result) > HARD_RESULT_BYTES) {
    throw new Error('Bounded artifact query exceeded its hard serialized-size limit');
  }
  logger.debug('Queried MCP response artifact', {
    artifactId,
    responsePath,
    pageUnit,
    offset,
    returnedCount,
    totalCount,
    serialized: result.responseMeta.serializedBytes,
  });
  return result;
}

export function boundToolResult(toolName: string, value: unknown, owner: string): unknown {
  // Self-bounded tools shape their own replies against this same budget; re-bounding them
  // re-artifacts the reply and nulls its nextCursor, so a caller stops paging early.
  if (SELF_BOUNDED_TOOLS.has(toolName)) return value;

  // Indentation only grows a document, so an over-budget compact form settles the
  // question without building the much larger indented string for a huge payload.
  const compactBytes = encode(value);
  if (compactBytes.length <= INLINE_RESULT_BYTES && emittedBytes(value) <= INLINE_RESULT_BYTES) return value;
  // Hand the already-serialized buffer over rather than stringifying the payload twice.
  const artifact = persistResponseArtifact(value, owner, compactBytes);
  const sourceTruncated = artifact.sourceTruncated;
  const pathHint = artifact.primaryPaths.length
    ? ` Query these artifact paths rather than pointers copied from the summary: ${artifact.primaryPaths.join(', ')}.`
    : '';
  const bounded = {
    success: typeof value === 'object' && value !== null && 'success' in value
      ? Boolean((value as Record<string, unknown>).success)
      : true,
    data: compactToolValue(toolName, value) as unknown,
    responseMeta: {
      contractVersion: 3,
      truncated: true,
      truncationReason: 'size_limit',
      returnedCount: null,
      totalCount: null,
      nextCursor: null,
      serializedBytes: 0,
      artifact,
      sourceTruncated,
      ...completionMetadata(true, null, null),
    } satisfies ResponseMeta,
    guidance:
      `The visible ${toolName} summary is a RESHAPED preview, not a subtree of the artifact: its ` +
      `nesting and field names differ from the stored JSON, so do not copy pointers out of it.` +
      `${pathHint} Use query_response_artifact with describe=true to inspect the real shape, then ` +
      `filter, project, or search only the data needed for the task.`,
  };

  if (emittedBytes(bounded) > PREVIEW_RESULT_BYTES) {
    bounded.data = compactToBudget(bounded.data, PREVIEW_RESULT_BYTES, compacted => ({ ...bounded, data: compacted }));
  }
  bounded.responseMeta.serializedBytes = emittedBytes(bounded);
  if (emittedBytes(bounded) > HARD_RESULT_BYTES) {
    throw new Error('Bounded MCP result exceeded its hard serialized-size limit');
  }
  logger.debug('Bounded oversized MCP tool result', {
    tool: toolName,
    artifactId: artifact.id,
    artifactBytes: artifact.byteLength,
    inlineBytes: bounded.responseMeta.serializedBytes,
  });
  return bounded;
}
