/**
 * Redaction helpers for log output. The project logger has no built-in
 * redaction, so callers must scrub sensitive values before passing them in.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-n8n-key',
  'x-n8n-url',
]);

export const REDACTED = '[REDACTED]';

/**
 * Return a shallow copy of the headers object with sensitive values replaced
 * by a fixed placeholder. Header names are matched case-insensitively.
 */
export function redactHeaders(
  headers: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Reduce a JSON-RPC request body to a safe metadata summary that is suitable
 * for logging. Intentionally drops params/payload content.
 */
export function summarizeMcpBody(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) {
    return { bodyType: body === null ? 'null' : 'undefined' };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { bodyType: Array.isArray(body) ? 'array' : typeof body };
  }
  const b = body as Record<string, unknown>;
  return {
    jsonrpc: typeof b.jsonrpc === 'string' ? b.jsonrpc : undefined,
    method: typeof b.method === 'string' ? b.method : undefined,
    id: typeof b.id === 'string' || typeof b.id === 'number' ? b.id : undefined,
    hasParams: b.params !== undefined && b.params !== null,
  };
}

/**
 * Reduce MCP tool-call arguments to a safe metadata summary. Returns the type,
 * the top-level key list, a hasNestedOutput flag for the n8n nested-output
 * workaround, and an approximate serialized size. Never returns values.
 */
export function summarizeToolCallArgs(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) {
    return { argsType: args === null ? 'null' : 'undefined' };
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    let size: number | undefined;
    if (typeof args === 'string') size = args.length;
    return {
      argsType: Array.isArray(args) ? 'array' : typeof args,
      ...(size !== undefined ? { size } : {}),
    };
  }
  const keys = Object.keys(args as Record<string, unknown>);
  let size: number | undefined;
  try {
    size = JSON.stringify(args).length;
  } catch {
    size = undefined;
  }
  return {
    argsType: 'object',
    argsKeys: keys,
    hasNestedOutput: keys.includes('output'),
    ...(size !== undefined ? { size } : {}),
  };
}
