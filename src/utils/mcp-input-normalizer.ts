/**
 * Repairs workflow payloads mangled by some HTTP MCP clients (issue #814):
 * JSON-string roots (`parameters: "{}"`), arrays flattened to dense numeric-index
 * records (`[x, y]` → `{"0": x, "1": y}`), and stringified numbers (`typeVersion: "3"`).
 *
 * Deliberate tradeoff: a legitimate user object keyed exactly "0".."n" is
 * indistinguishable from a mangled array and WILL be converted to one. This is
 * accepted because n8n itself never produces dense numeric-index objects in node
 * parameters, and the normalization must run unconditionally — the client-side
 * mangling is non-deterministic, so there is no reliable signal to gate on.
 * The conversion can also surface as a validation error instead of silent data
 * change, e.g. a connections record whose only source node is literally named
 * "0" becomes an array and is rejected by the schema.
 */
type JsonRecord = Record<string, unknown>;

// Untrusted inputs can nest arbitrarily deep; beyond this we return the value
// untouched instead of risking a stack overflow. Real workflows are tens of
// levels deep at most.
const MAX_NORMALIZE_DEPTH = 256;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function tryParseJsonRoot(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isDenseIndexRecord(record: JsonRecord): boolean {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return false;
  }

  // Canonical array-index form only: "00" would pass /^\d+$/ but Number('00') → 0,
  // and the rebuild looks up the key "0" which doesn't exist, dropping the value.
  return keys.every((key) => /^(0|[1-9]\d*)$/.test(key))
    && keys
      .map(Number)
      .sort((a, b) => a - b)
      .every((key, index) => key === index);
}

function restoreIndexedArrays(value: unknown, depth = 0): unknown {
  if (depth >= MAX_NORMALIZE_DEPTH) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => restoreIndexedArrays(entry, depth + 1));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const normalizedEntries = Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, restoreIndexedArrays(entryValue, depth + 1)])
  );

  if (isDenseIndexRecord(normalizedEntries)) {
    // Keys are guaranteed dense and 0-based here, so index by position directly.
    const { length } = Object.keys(normalizedEntries);
    return Array.from({ length }, (_, index) => normalizedEntries[String(index)]);
  }

  return normalizedEntries;
}

export function normalizeMcpJsonValue(value: unknown): unknown {
  return restoreIndexedArrays(tryParseJsonRoot(value));
}

function normalizeNumberLike(value: unknown): unknown {
  // Canonical decimal form only — bare Number() would also accept "0x10",
  // "1e3", or padded strings, silently producing values Zod should reject.
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

export function normalizeMcpWorkflowPosition(value: unknown): unknown {
  const parsed = normalizeMcpJsonValue(value);
  if (!Array.isArray(parsed)) {
    return parsed;
  }

  // The same clients that flatten [x, y] into {"0": x, "1": y} also stringify
  // the coordinates; de-stringify them so the [number, number] check passes.
  return parsed.map(normalizeNumberLike);
}

export function normalizeMcpWorkflowNode(value: unknown): unknown {
  // Shallow root parse only: a node's own keys are field names, never dense
  // indices, and recursing from the node root would dense-convert credentials
  // before the per-field exemption below could protect it.
  const parsed = tryParseJsonRoot(value);
  if (!isPlainRecord(parsed)) {
    return parsed;
  }

  // Only rewrite fields present on the input — adding explicit undefined-valued
  // keys would change Object.keys()-based consumers downstream.
  const normalized: JsonRecord = { ...parsed };
  if ('typeVersion' in parsed) {
    normalized.typeVersion = normalizeNumberLike(parsed.typeVersion);
  }
  if ('position' in parsed) {
    normalized.position = normalizeMcpWorkflowPosition(parsed.position);
  }
  if ('parameters' in parsed) {
    normalized.parameters = normalizeMcpJsonValue(parsed.parameters);
  }
  if ('credentials' in parsed) {
    // Credentials are always an object keyed by credential-type name — never an
    // array — so dense-index conversion could only corrupt them. Parse a JSON
    // string root, nothing more. (A recursive pass upstream of this function,
    // e.g. on a diff request's operations root, can still convert dense-keyed
    // credentials; real credential keys are type names, so that stays theoretical.)
    normalized.credentials = tryParseJsonRoot(parsed.credentials);
  }
  return normalized;
}

export function normalizeMcpWorkflowNodes(value: unknown): unknown {
  // Restore only the collection itself here (shallowly) — per-node repair is
  // normalizeMcpWorkflowNode's job, and a recursive pass from this level would
  // bypass its credentials exemption.
  const parsed = tryParseJsonRoot(value);
  const collection = isPlainRecord(parsed) && isDenseIndexRecord(parsed)
    ? Array.from({ length: Object.keys(parsed).length }, (_, index) => parsed[String(index)])
    : parsed;
  if (!Array.isArray(collection)) {
    return collection;
  }

  return collection.map(normalizeMcpWorkflowNode);
}

export function normalizeMcpWorkflowConnections(value: unknown): unknown {
  return normalizeMcpJsonValue(value);
}
