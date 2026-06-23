import { describe, it, expect } from 'vitest';
import { redactHeaders, summarizeMcpBody, summarizeToolCallArgs, REDACTED } from '../../../src/utils/redaction';

describe('redactHeaders', () => {
  it('redacts authorization header', () => {
    const result = redactHeaders({ authorization: 'Bearer secret-token' });
    expect(result.authorization).toBe(REDACTED);
  });

  it('redacts authorization header with any case', () => {
    const result = redactHeaders({ Authorization: 'Bearer secret-token' });
    expect(result.Authorization).toBe(REDACTED);
  });

  it('redacts x-n8n-key and x-n8n-url', () => {
    const result = redactHeaders({
      'x-n8n-key': 'per-tenant-api-key',
      'x-n8n-url': 'https://tenant.internal/',
    });
    expect(result['x-n8n-key']).toBe(REDACTED);
    expect(result['x-n8n-url']).toBe(REDACTED);
  });

  it('redacts cookie, set-cookie and proxy-authorization', () => {
    const result = redactHeaders({
      cookie: 'session=abc',
      'set-cookie': 'session=abc',
      'proxy-authorization': 'Basic xyz',
    });
    expect(result.cookie).toBe(REDACTED);
    expect(result['set-cookie']).toBe(REDACTED);
    expect(result['proxy-authorization']).toBe(REDACTED);
  });

  it('preserves non-sensitive headers unchanged', () => {
    const result = redactHeaders({
      'content-type': 'application/json',
      'user-agent': 'curl/8.4.0',
      accept: '*/*',
    });
    expect(result['content-type']).toBe('application/json');
    expect(result['user-agent']).toBe('curl/8.4.0');
    expect(result.accept).toBe('*/*');
  });

  it('returns empty object for undefined or null input', () => {
    expect(redactHeaders(undefined)).toEqual({});
    expect(redactHeaders(null)).toEqual({});
  });

  it('mixes redacted and preserved headers correctly', () => {
    const result = redactHeaders({
      Authorization: 'Bearer secret',
      'content-type': 'application/json',
      'x-n8n-key': 'api-key',
    });
    expect(result.Authorization).toBe(REDACTED);
    expect(result['content-type']).toBe('application/json');
    expect(result['x-n8n-key']).toBe(REDACTED);
  });
});

describe('summarizeMcpBody', () => {
  it('returns jsonrpc, method, id and hasParams for a valid body', () => {
    const result = summarizeMcpBody({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'client', version: '1.0' } },
    });
    expect(result).toEqual({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      hasParams: true,
    });
  });

  it('reports hasParams false when params is absent', () => {
    const result = summarizeMcpBody({ jsonrpc: '2.0', method: 'ping', id: 7 });
    expect(result.hasParams).toBe(false);
  });

  it('reports hasParams false when params is null', () => {
    const result = summarizeMcpBody({ jsonrpc: '2.0', method: 'ping', id: 7, params: null });
    expect(result.hasParams).toBe(false);
  });

  it('accepts a string id', () => {
    const result = summarizeMcpBody({ jsonrpc: '2.0', method: 'ping', id: 'abc' });
    expect(result.id).toBe('abc');
  });

  it('returns bodyType placeholder for undefined body', () => {
    expect(summarizeMcpBody(undefined)).toEqual({ bodyType: 'undefined' });
  });

  it('returns bodyType placeholder for null body', () => {
    expect(summarizeMcpBody(null)).toEqual({ bodyType: 'null' });
  });

  it('returns bodyType placeholder for non-object primitives', () => {
    expect(summarizeMcpBody('raw text')).toEqual({ bodyType: 'string' });
    expect(summarizeMcpBody(42)).toEqual({ bodyType: 'number' });
  });

  it('returns bodyType placeholder for array bodies', () => {
    expect(summarizeMcpBody([{ jsonrpc: '2.0' }])).toEqual({ bodyType: 'array' });
  });

  it('drops unexpected keys from the summary', () => {
    const result = summarizeMcpBody({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: { secret: 'canary' },
      extra: 'canary',
    });
    expect(result).not.toHaveProperty('extra');
    expect(result).not.toHaveProperty('params');
    expect(JSON.stringify(result)).not.toContain('canary');
  });
});

describe('summarizeToolCallArgs', () => {
  it('omits values from objects but keeps the key list', () => {
    const result = summarizeToolCallArgs({
      action: 'create',
      name: 'demo',
      type: 'httpHeaderAuth',
      data: { name: 'Authorization', value: 'Bearer DEMO_SECRET' },
    });
    expect(result.argsType).toBe('object');
    expect(result.argsKeys).toEqual(['action', 'name', 'type', 'data']);
    expect(result.hasNestedOutput).toBe(false);
    expect(typeof result.size).toBe('number');
    expect(JSON.stringify(result)).not.toContain('DEMO_SECRET');
    expect(JSON.stringify(result)).not.toContain('Bearer');
  });

  it('flags hasNestedOutput when args includes output', () => {
    const result = summarizeToolCallArgs({ output: '{"nested":true}' });
    expect(result.hasNestedOutput).toBe(true);
    expect(JSON.stringify(result)).not.toContain('nested');
  });

  it('returns string type and size for string args without leaking content', () => {
    const result = summarizeToolCallArgs('Bearer DEMO_SECRET');
    expect(result.argsType).toBe('string');
    expect(result.size).toBe('Bearer DEMO_SECRET'.length);
    expect(JSON.stringify(result)).not.toContain('DEMO_SECRET');
  });

  it('returns argsType placeholder for undefined and null', () => {
    expect(summarizeToolCallArgs(undefined)).toEqual({ argsType: 'undefined' });
    expect(summarizeToolCallArgs(null)).toEqual({ argsType: 'null' });
  });

  it('returns argsType array for array args', () => {
    const result = summarizeToolCallArgs(['secret-value']);
    expect(result.argsType).toBe('array');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
