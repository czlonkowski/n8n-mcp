"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDACTED = void 0;
exports.redactHeaders = redactHeaders;
exports.summarizeMcpBody = summarizeMcpBody;
exports.summarizeToolCallArgs = summarizeToolCallArgs;
const SENSITIVE_HEADER_NAMES = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-n8n-key',
    'x-n8n-url',
]);
exports.REDACTED = '[REDACTED]';
function redactHeaders(headers) {
    if (!headers || typeof headers !== 'object') {
        return {};
    }
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        out[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? exports.REDACTED : value;
    }
    return out;
}
function summarizeMcpBody(body) {
    if (body === undefined || body === null) {
        return { bodyType: body === null ? 'null' : 'undefined' };
    }
    if (typeof body !== 'object' || Array.isArray(body)) {
        return { bodyType: Array.isArray(body) ? 'array' : typeof body };
    }
    const b = body;
    return {
        jsonrpc: typeof b.jsonrpc === 'string' ? b.jsonrpc : undefined,
        method: typeof b.method === 'string' ? b.method : undefined,
        id: typeof b.id === 'string' || typeof b.id === 'number' ? b.id : undefined,
        hasParams: b.params !== undefined && b.params !== null,
    };
}
function summarizeToolCallArgs(args) {
    if (args === undefined || args === null) {
        return { argsType: args === null ? 'null' : 'undefined' };
    }
    if (typeof args !== 'object' || Array.isArray(args)) {
        let size;
        if (typeof args === 'string')
            size = args.length;
        return {
            argsType: Array.isArray(args) ? 'array' : typeof args,
            ...(size !== undefined ? { size } : {}),
        };
    }
    const keys = Object.keys(args);
    let size;
    try {
        size = JSON.stringify(args).length;
    }
    catch {
        size = undefined;
    }
    return {
        argsType: 'object',
        argsKeys: keys,
        hasNestedOutput: keys.includes('output'),
        ...(size !== undefined ? { size } : {}),
    };
}
//# sourceMappingURL=redaction.js.map