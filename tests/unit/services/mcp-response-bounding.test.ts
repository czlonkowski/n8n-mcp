import { createHash, createHmac } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HARD_RESULT_BYTES,
  INLINE_RESULT_BYTES,
  boundToolResult,
  deleteResponseArtifact,
  describeResponseArtifact,
  persistResponseArtifact,
  pruneResponseArtifacts,
  queryResponseArtifact,
  queryResponseArtifactTool,
} from '../../../src/services/mcp-response-bounding';

describe('MCP response bounding', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'n8n-mcp-response-'));
    process.env.MCP_RESPONSE_ARTIFACT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.MCP_RESPONSE_ARTIFACT_ROOT;
    delete process.env.MCP_RESPONSE_CURSOR_KEY;
    delete process.env.MCP_RESPONSE_INLINE_BYTES;
    delete process.env.MCP_RESPONSE_PREVIEW_BYTES;
    delete process.env.MCP_RESPONSE_HARD_BYTES;
    delete process.env.MCP_RESPONSE_ARTIFACT_MAX_BYTES;
    delete process.env.MCP_RESPONSE_ARTIFACT_TTL_MS;
    delete process.env.MCP_RESPONSE_ARTIFACT_QUOTA_BYTES;
    delete process.env.MCP_RESPONSE_PARSE_CACHE_TTL_MS;
    rmSync(root, { recursive: true, force: true });
  });

  it('advertises only the unified camelCase v3 query contract', () => {
    const schema = queryResponseArtifactTool.inputSchema;
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining([
      'artifactId', 'responsePath', 'fields', 'filters', 'pageSize', 'cursor',
      'describe', 'objectMode', 'textSearch',
    ]));
    expect(schema.required).toEqual(['artifactId']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.filters.items.additionalProperties).toBe(false);
    expect(schema.properties.filters.items.properties.op.enum).toContain('icontains');
    expect(schema.properties.textSearch.additionalProperties).toBe(false);
    expect(queryResponseArtifactTool.outputSchema).toMatchObject({
      type: 'object',
      required: ['artifactId', 'responsePath', 'responseMeta'],
      additionalProperties: false,
    });
    for (const legacy of [
      'artifact_id', 'response_path', 'response_filter', 'response_page_size',
      'response_cursor', 'object_mode', 'text_search',
    ]) {
      expect(schema.properties).not.toHaveProperty(legacy);
    }
  });

  it('exposes only a bounded descriptor and deletes within the owning scope', () => {
    const artifact = persistResponseArtifact({ secretPayload: 'not-in-the-descriptor' }, 'tenant-a');
    const descriptor = describeResponseArtifact(artifact.id, 'tenant-a');

    expect(descriptor).toMatchObject({
      descriptorVersion: 1,
      contractVersion: 3,
      id: artifact.id,
      rawReadable: false,
      queryTool: 'query_response_artifact',
    });
    expect(JSON.stringify(descriptor)).not.toContain('secretPayload');
    expect(() => describeResponseArtifact(artifact.id, 'tenant-b')).toThrow('different MCP scope');
    expect(deleteResponseArtifact(artifact.id, 'tenant-a')).toBe(true);
    expect(deleteResponseArtifact(artifact.id, 'tenant-a')).toBe(false);
  });

  it('preserves compact results for backward compatibility', () => {
    const value = { success: true, data: { id: 'workflow-1', name: 'Small' } };
    expect(boundToolResult('n8n_get_workflow', value, 'tenant-a')).toBe(value);
  });

  it('stores large results and returns a compact workflow structure', () => {
    const value = {
      success: true,
      data: {
        id: 'workflow-1',
        name: 'Large workflow',
        active: true,
        nodes: Array.from({ length: 40 }, (_, index) => ({
          id: `node-${index}`,
          name: `Node ${index}`,
          type: 'n8n-nodes-base.code',
          parameters: { jsCode: 'x'.repeat(3000) },
        })),
        connections: {},
      },
    };

    const bounded = boundToolResult('n8n_get_workflow', value, 'tenant-a') as any;
    expect(bounded.responseMeta.truncated).toBe(true);
    expect(bounded.responseMeta.complete).toBe(false);
    expect(bounded.responseMeta.warning).toContain('INCOMPLETE RESULT');
    expect(bounded.responseMeta.artifact.byteLength).toBeGreaterThan(INLINE_RESULT_BYTES);
    expect(bounded.responseMeta.artifact.queryTool).toBe('query_response_artifact');
    expect(bounded.data.data.nodes).toHaveLength(40);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThan(HARD_RESULT_BYTES);
    const artifact = readFileSync(
      path.join(root, `response-${bounded.responseMeta.artifact.id}.json`),
      'utf8',
    );
    expect(JSON.parse(artifact)).toEqual(value);
  });

  it('summarizes oversized execution lists while retaining pagination metadata', () => {
    const value = {
      success: true,
      data: {
        executions: Array.from({ length: 40 }, (_, index) => ({
          id: String(index),
          workflowId: 'workflow-1',
          status: 'success',
          mode: 'manual',
          startedAt: '2026-08-04T00:00:00.000Z',
          stoppedAt: '2026-08-04T00:00:01.000Z',
          finished: true,
          data: 'x'.repeat(1000),
        })),
        nextCursor: 'upstream-cursor',
      },
    };

    const bounded = boundToolResult('n8n_executions', value, 'tenant-a') as any;
    expect(bounded.data.data.executions).toHaveLength(20);
    expect(bounded.data.data).toMatchObject({
      returned: 20,
      // pageCount is the size of the upstream page, not a global total.
      pageCount: 40,
      nextCursor: 'upstream-cursor',
      hasMore: true,
    });
    expect(bounded.data.data).not.toHaveProperty('totalCount');
    expect(bounded.data.data.executions[0]).not.toHaveProperty('data');
  });

  it('rejects invalid ids and distinguishes an unknown handle from an expired one', () => {
    expect(() => queryResponseArtifact('../escape', '', undefined, undefined, 20, undefined, 'tenant-a')).toThrow('Invalid artifact id');
    expect(() => queryResponseArtifact('a'.repeat(20), '', undefined, undefined, 20, undefined, 'tenant-a')).toThrow(
      'handle is unknown',
    );
  });

  it('deletes expired artifacts when they are read', () => {
    const value = { records: Array.from({ length: 100 }, (_, i) => ({ i, text: 'z'.repeat(1000) })) };
    const bounded = boundToolResult('additional_large_tool', value, 'tenant-a') as any;
    const artifactId = bounded.responseMeta.artifact.id as string;
    const dataPath = path.join(root, `response-${artifactId}.json`);
    const metaPath = path.join(root, `response-${artifactId}.meta.json`);
    const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
    metadata.expiresAt = '2000-01-01T00:00:00.000Z';
    writeFileSync(metaPath, JSON.stringify(metadata));

    expect(() => queryResponseArtifact(artifactId, '', undefined, undefined, 20, undefined, 'tenant-a')).toThrow('handle expired at');
    expect(existsSync(dataPath)).toBe(false);
    expect(existsSync(metaPath)).toBe(false);
  });

  it('rejects a query cursor that is too short to contain a signature', () => {
    const artifact = persistResponseArtifact({ value: 'small' }, 'tenant-a');
    expect(() => queryResponseArtifact(artifact.id, '', undefined, undefined, 20, 'short', 'tenant-a')).toThrow(
      'Invalid artifact cursor',
    );
  });

  it('uses the default temporary artifact root when no override is configured', () => {
    delete process.env.MCP_RESPONSE_ARTIFACT_ROOT;
    const artifact = persistResponseArtifact({ value: 'default-root' }, 'tenant-a');
    const defaultRoot = '/tmp/n8n-mcp-artifacts';
    const dataPath = path.join(defaultRoot, `response-${artifact.id}.json`);
    const metaPath = path.join(defaultRoot, `response-${artifact.id}.meta.json`);

    try {
      expect(existsSync(dataPath)).toBe(true);
      expect(existsSync(metaPath)).toBe(true);
    } finally {
      rmSync(dataPath, { force: true });
      rmSync(metaPath, { force: true });
      process.env.MCP_RESPONSE_ARTIFACT_ROOT = root;
    }
  });

  it('returns immediately when pruning a missing artifact root', () => {
    process.env.MCP_RESPONSE_ARTIFACT_ROOT = path.join(root, 'missing');
    expect(() => pruneResponseArtifacts()).not.toThrow();
  });

  it('prunes expired artifact data and tolerates missing metadata', () => {
    const artifact = persistResponseArtifact({ value: 'expired' }, 'tenant-a');
    const dataPath = path.join(root, `response-${artifact.id}.json`);
    const metaPath = path.join(root, `response-${artifact.id}.meta.json`);
    unlinkSync(metaPath);
    const old = new Date(Date.now() - (25 * 60 * 60 * 1000));
    utimesSync(dataPath, old, old);

    pruneResponseArtifacts();

    expect(existsSync(dataPath)).toBe(false);
    expect(existsSync(metaPath)).toBe(false);
  });

  it('prunes expired artifact data together with its metadata sidecar', () => {
    const artifact = persistResponseArtifact({ value: 'expired-with-metadata' }, 'tenant-a');
    const dataPath = path.join(root, `response-${artifact.id}.json`);
    const metaPath = path.join(root, `response-${artifact.id}.meta.json`);
    const old = new Date(Date.now() - (25 * 60 * 60 * 1000));
    utimesSync(dataPath, old, old);

    pruneResponseArtifacts();

    expect(existsSync(dataPath)).toBe(false);
    expect(existsSync(metaPath)).toBe(false);
  });

  it('rejects artifacts above the individual size limit', () => {
    const value = { text: 'x'.repeat(50 * 1024 * 1024) };
    expect(() => persistResponseArtifact(value, 'tenant-a')).toThrow('artifact limit');
  });

  it('uses safe workflow fallbacks when success and nodes are absent', () => {
    const value = {
      data: {
        id: 'workflow-no-nodes',
        name: 'No nodes',
        connections: { payload: 'x'.repeat(40_000) },
      },
    };

    const bounded = boundToolResult('n8n_get_workflow', value, 'tenant-a') as any;
    expect(bounded.data).toMatchObject({
      success: true,
      data: { id: 'workflow-no-nodes', nodeCount: 0, nodes: [] },
    });
  });

  it('reports a short execution page without an upstream cursor as complete', () => {
    const value = {
      data: {
        executions: Array.from({ length: 5 }, (_, index) => ({
          id: String(index),
          workflowId: 'workflow-1',
          status: 'success',
          data: 'x'.repeat(8_000),
        })),
      },
    };

    const bounded = boundToolResult('n8n_executions', value, 'tenant-a') as any;
    expect(bounded.data.success).toBe(true);
    expect(bounded.data.data).toMatchObject({ returned: 5, pageCount: 5, hasMore: false });
  });

  it('compacts oversized summaries until the inline budget is met', () => {
    const value = {
      success: true,
      data: {
        id: 'workflow-wide-summary',
        name: 'Wide summary',
        nodes: Array.from({ length: 100 }, (_, index) => ({
          id: `node-${index}`,
          name: `Node ${index} ${'x'.repeat(2_000)}`,
          type: 'n8n-nodes-base.code',
          parameters: { jsCode: 'y'.repeat(2_000) },
        })),
        connections: {},
      },
    };

    const bounded = boundToolResult('n8n_get_workflow', value, 'tenant-a') as any;
    expect(bounded.responseMeta.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(INLINE_RESULT_BYTES);
    expect(bounded.responseMeta.artifact).toBeTruthy();
  });

  it('reports omitted fields when compacting wide objects', () => {
    const value = {
      payload: 'x'.repeat(40_000),
      wide: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`field_${index}`, index])),
    };

    const bounded = boundToolResult('additional_large_tool', value, 'tenant-a') as any;

    expect(bounded.data.wide._omittedFields).toBe(5);
    expect(Object.keys(bounded.data.wide)).toHaveLength(21);
  });

  it('queries provider-independent nested arrays with filters, projection, and cursors', () => {
    const artifact = persistResponseArtifact({
      providerPayload: {
        records: Array.from({ length: 17 }, (_, index) => ({
          id: index,
          name: `Record ${index}`,
          state: { name: index % 2 ? 'open' : 'closed' },
          score: index,
          payload: 'x'.repeat(1000),
        })),
      },
    }, 'tenant-a');

    const first = queryResponseArtifact(
      artifact.id,
      '/providerPayload/records',
      ['id', 'name', '/state/name'],
      [{ path: '/state/name', op: 'eq', value: 'open' }, { path: '/score', op: 'gte', value: 5 }],
      3,
      undefined,
      'tenant-a',
    ) as any;

    expect(first.response).toEqual([
      { id: 5, name: 'Record 5', '/state/name': 'open' },
      { id: 7, name: 'Record 7', '/state/name': 'open' },
      { id: 9, name: 'Record 9', '/state/name': 'open' },
    ]);
    expect(first.responseMeta).toMatchObject({
      complete: false,
      returnedCount: 3,
      totalCount: 6,
      remainingCount: 3,
      truncationReason: 'page_limit',
    });
    expect(first.responseMeta.nextCursor).toBeTruthy();

    const second = queryResponseArtifact(
      artifact.id,
      '/providerPayload/records',
      ['id', 'name', '/state/name'],
      [{ path: '/state/name', op: 'eq', value: 'open' }, { path: '/score', op: 'gte', value: 5 }],
      3,
      first.responseMeta.nextCursor,
      'tenant-a',
    ) as any;
    expect(second.response.map((item: any) => item.id)).toEqual([11, 13, 15]);
    expect(second.responseMeta).toMatchObject({
      complete: true,
      returnedCount: 3,
      totalCount: 6,
      remainingCount: 0,
      nextCursor: null,
    });
  });

  it('omits unresolved projected fields, reports resolution counts, and rejects an entirely missing projection', () => {
    const artifact = persistResponseArtifact({ rows: [{ id: 1, optional: 'yes' }, { id: 2 }] }, 'tenant-a');
    const optional = queryResponseArtifact(
      artifact.id,
      '/rows',
      ['id', 'optional'],
      [{ path: '/optional', op: 'exists', value: false }],
      20,
      undefined,
      'tenant-a',
    ) as any;
    // Unresolved pointers are omitted, not nulled; fieldsResolved makes the miss visible.
    expect(optional.response).toEqual([{ id: 2 }]);
    expect(optional.responseMeta.fieldsResolved).toEqual({ id: 1, optional: 0 });
    expect(optional.responseMeta.warning).toContain('optional');

    expect(() => queryResponseArtifact(
      artifact.id,
      '/rows',
      ['unknown'],
      undefined,
      20,
      undefined,
      'tenant-a',
    )).toThrow('matched no properties');
  });

  it('suggests a leading slash for nested fields while preserving literal slash keys', () => {
    const nested = persistResponseArtifact({
      nodes: [{ parameters: { jsCode: 'return [];' } }],
    }, 'tenant-a');

    expect(() => queryResponseArtifact(
      nested.id,
      '/nodes',
      ['parameters/jsCode'],
      undefined,
      20,
      undefined,
      'tenant-a',
    )).toThrow("Did you mean '/parameters/jsCode' instead of 'parameters/jsCode'?");

    const corrected = queryResponseArtifact(
      nested.id,
      '/nodes',
      ['/parameters/jsCode'],
      undefined,
      20,
      undefined,
      'tenant-a',
    ) as any;
    expect(corrected.response).toEqual([{ '/parameters/jsCode': 'return [];' }]);

    const literal = persistResponseArtifact({
      rows: [{ 'parameters/jsCode': 'literal root value' }],
    }, 'tenant-a');
    const literalProjection = queryResponseArtifact(
      literal.id,
      '/rows',
      ['parameters/jsCode'],
      undefined,
      20,
      undefined,
      'tenant-a',
    ) as any;
    expect(literalProjection.response).toEqual([{ 'parameters/jsCode': 'literal root value' }]);
  });

  it('infers one unambiguous array envelope when projecting from the artifact root', () => {
    const populated = persistResponseArtifact({ fields: [{ id: 'one', name: 'Example' }] }, 'tenant-a');
    const projected = queryResponseArtifact(
      populated.id, '', ['id', 'name'], undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(projected.response).toEqual([{ id: 'one', name: 'Example' }]);
    expect(projected.responseMeta.inferredResponsePath).toBe('/fields');
    expect(projected.responseMeta.fieldsResolved).toEqual({ id: 1, name: 1 });

    const empty = persistResponseArtifact({ fields: [] }, 'tenant-a');
    const emptyProjection = queryResponseArtifact(
      empty.id, '', ['id'], undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(emptyProjection.response).toEqual([]);
    expect(emptyProjection.responseMeta.inferredResponsePath).toBe('/fields');
    expect(emptyProjection.responseMeta.fieldsResolved).toEqual({ id: 0 });
  });

  it('normalizes a redundant collection prefix only after unambiguous array inference', () => {
    const artifact = persistResponseArtifact({
      tags: [
        { name: 'retainer', tag_fg: '#ffffff', tag_bg: '#000000' },
        { name: 'complete', tag_fg: '#111111', tag_bg: '#eeeeee' },
      ],
    }, 'tenant-a');

    const projected = queryResponseArtifact(
      artifact.id,
      '',
      ['/tags/name', '/tags/tag_fg', '/tags/tag_bg'],
      undefined,
      20,
      undefined,
      'tenant-a',
    ) as any;

    expect(projected.response).toEqual([
      { '/tags/name': 'retainer', '/tags/tag_fg': '#ffffff', '/tags/tag_bg': '#000000' },
      { '/tags/name': 'complete', '/tags/tag_fg': '#111111', '/tags/tag_bg': '#eeeeee' },
    ]);
    expect(projected.responseMeta.inferredResponsePath).toBe('/tags');
    expect(projected.responseMeta.fieldsResolved).toEqual({
      '/tags/name': 2,
      '/tags/tag_fg': 2,
      '/tags/tag_bg': 2,
    });
    expect(projected.responseMeta.warning).toContain('interpreted fields relative to each item');

    expect(() => queryResponseArtifact(
      artifact.id,
      '',
      ['/tags/name', '/other/value'],
      undefined,
      20,
      undefined,
      'tenant-a',
    )).toThrow('matched no properties');
  });

  it('does not infer a child when a projected root field resolves', () => {
    const artifact = persistResponseArtifact({ id: 'root', rows: [{ id: 'child' }] }, 'tenant-a');
    const projected = queryResponseArtifact(
      artifact.id, '', ['id'], undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(projected.response).toEqual({ id: 'root' });
    expect(projected.responseMeta.inferredResponsePath).toBeUndefined();
  });

  it('infers one array for root filtering and refuses ambiguous envelopes', () => {
    const filterable = persistResponseArtifact(
      { rows: [{ kind: 'keep' }, { kind: 'drop' }] }, 'tenant-a',
    );
    const filtered = queryResponseArtifact(
      filterable.id, '', undefined, [{ path: '/kind', op: 'eq', value: 'keep' }],
      20, undefined, 'tenant-a',
    ) as any;
    expect(filtered.response).toEqual([{ kind: 'keep' }]);
    expect(filtered.responseMeta.inferredResponsePath).toBe('/rows');

    const ambiguous = persistResponseArtifact(
      { rows: [{ id: 1 }], errors: [] }, 'tenant-a',
    );
    expect(() => queryResponseArtifact(
      ambiguous.id, '', ['id'], undefined, 20, undefined, 'tenant-a',
    )).toThrow('matched no properties');
  });

  it('infers below an explicit envelope path and reports the full pointer', () => {
    const artifact = persistResponseArtifact(
      { data: { executions: [{ id: 'one' }], returned: 1 } }, 'tenant-a',
    );
    const projected = queryResponseArtifact(
      artifact.id, '/data', ['id'], undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(projected.response).toEqual([{ id: 'one' }]);
    expect(projected.responseMeta.inferredResponsePath).toBe('/data/executions');
  });

  it('binds structured query cursors to artifact, scope, and exact view', () => {
    const firstArtifact = persistResponseArtifact({ rows: [1, 2, 3] }, 'tenant-a');
    // Distinct content: artifact ids are content-addressed per scope, so identical
    // payloads deliberately collapse to one handle (see the dedup test below).
    const secondArtifact = persistResponseArtifact({ rows: [4, 5, 6] }, 'tenant-a');
    const first = queryResponseArtifact(
      firstArtifact.id, '/rows', undefined, undefined, 1, undefined, 'tenant-a',
    ) as any;

    expect(() => queryResponseArtifact(
      secondArtifact.id, '/rows', undefined, undefined, 1, first.responseMeta.nextCursor, 'tenant-a',
    )).toThrow(firstArtifact.id);
    expect(() => queryResponseArtifact(
      firstArtifact.id, '/rows', undefined, undefined, 2, first.responseMeta.nextCursor, 'tenant-a',
    )).toThrow('does not match this query');
    expect(() => queryResponseArtifact(
      firstArtifact.id, '/rows', undefined, undefined, 1, undefined, 'tenant-b',
    )).toThrow('different MCP scope');
  });

  it('advances past one oversized item with a compact page', () => {
    const artifact = persistResponseArtifact({
      rows: [{ id: 1, body: 'x'.repeat(40 * 1024) }, { id: 2 }],
    }, 'tenant-a');
    const first = queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(first.response[0].id).toBe(1);
    expect(first.responseMeta).toMatchObject({
      returnedCount: 1,
      totalCount: 2,
      remainingCount: 1,
      truncationReason: 'item_size_limit',
    });
    expect(first.responseMeta.nextCursor).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(HARD_RESULT_BYTES);
  });

  it('validates structured query bounds and filter shapes', () => {
    const artifact = persistResponseArtifact({ rows: [{ id: 1 }] }, 'tenant-a');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 0, undefined, 'tenant-a',
    )).toThrow('pageSize');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, Array.from({ length: 11 }, () => ({ path: '/id' })), 20, undefined, 'tenant-a',
    )).toThrow('at most 10');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, [{ path: '/id', op: 'in', value: 'invalid' } as any], 20, undefined, 'tenant-a',
    )).toThrow('must be an array');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', Array.from({ length: 51 }, (_, index) => `field-${index}`), undefined, 20, undefined, 'tenant-a',
    )).toThrow('at most 50');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, [{} as any], 20, undefined, 'tenant-a',
    )).toThrow('each filter');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, [{ path: '/id', op: 'invalid' as any }], 20, undefined, 'tenant-a',
    )).toThrow('Unsupported filter operation');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, [{ path: '/id', op: 'exists', value: 'yes' }], 20, undefined, 'tenant-a',
    )).toThrow('must be boolean');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', [''], undefined, 20, undefined, 'tenant-a',
    )).toThrow('non-empty strings');
  });

  it('supports generic comparison and containment filters', () => {
    const artifact = persistResponseArtifact({
      rows: [
        { id: 1, score: 5, text: 'hello', tags: ['alpha'], metadata: { key: true } },
        { id: 2, score: 10, text: 'goodbye', tags: ['beta'], metadata: {} },
      ],
    }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id,
      '/rows',
      ['id'],
      [
        { path: '/id', op: 'ne', value: 2 },
        { path: '/id', op: 'in', value: [1, 3] },
        { path: '/score', op: 'gt', value: 4 },
        { path: '/score', op: 'gte', value: 5 },
        { path: '/score', op: 'lt', value: 6 },
        { path: '/score', op: 'lte', value: 5 },
        { path: '/text', op: 'contains', value: 'ell' },
        { path: '/tags', op: 'contains', value: 'alpha' },
        { path: '/metadata', op: 'contains', value: 'key' },
        { path: '/missing', op: 'exists', value: false },
      ],
      20,
      undefined,
      'tenant-a',
    ) as any;
    expect(result.response).toEqual([{ id: 1 }]);
  });

  it('validates response paths and object projections', () => {
    const artifact = persistResponseArtifact({ record: { id: 1, name: 'One' } }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id, '/record', ['id'], undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(result.response).toEqual({ id: 1 });
    expect(result.responseMeta.complete).toBe(true);

    expect(() => queryResponseArtifact(
      artifact.id, 'record', undefined, undefined, 20, undefined, 'tenant-a',
    )).toThrow('RFC 6901');
    const missing = () => queryResponseArtifact(
      artifact.id, '/missing', undefined, undefined, 20, undefined, 'tenant-a',
    );
    expect(missing).toThrow('INVALID_RESPONSE_PATH');
    expect(missing).toThrow('Available children: /record');
    expect(missing).toThrow('responseRoot=""');
    expect(() => queryResponseArtifact(
      artifact.id, '/record', ['unknown'], undefined, 20, undefined, 'tenant-a',
    )).toThrow('matched no properties');
    expect(() => queryResponseArtifact(
      artifact.id, '/record', undefined, [{ path: '/id', op: 'eq', value: 1 }], 20, undefined, 'tenant-a',
    )).toThrow('select a JSON array');

    const scalar = queryResponseArtifact(
      artifact.id, '/record/id', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(scalar.response).toBe(1);

    const arrayArtifact = persistResponseArtifact({ rows: [{ id: 2 }] }, 'tenant-a');
    const arrayScalar = queryResponseArtifact(
      arrayArtifact.id, '/rows/0/id', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(arrayScalar.response).toBe(2);

    const rootArtifact = persistResponseArtifact({ '': 'empty-key', value: 'root' }, 'tenant-a');
    const defaulted = queryResponseArtifact(
      rootArtifact.id, undefined, undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(defaulted.responsePath).toBe('');
    expect(defaulted.response).toEqual({ '': 'empty-key', value: 'root' });
    expect(defaulted.responseMeta).not.toHaveProperty('inferredResponsePath');
    const exactRoot = queryResponseArtifact(
      rootArtifact.id, '/value', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(exactRoot.responsePath).toBe('/value');
    expect(exactRoot.responseMeta).not.toHaveProperty('inferredResponsePath');
    const emptyKey = queryResponseArtifact(
      rootArtifact.id, '/', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(emptyKey.response).toBe('empty-key');
  });

  it('normalizes missing pointers beneath the advertised response root', () => {
    const artifact = persistResponseArtifact({
      response: { teams: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    }, 'tenant-a');
    const metaPath = path.join(root, `response-${artifact.id}.meta.json`);
    const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
    metadata.responseRoot = '/response';
    writeFileSync(metaPath, JSON.stringify(metadata));

    const first = queryResponseArtifact(
      artifact.id, '/teams', ['id'], undefined, 1, undefined, 'tenant-a',
    ) as any;
    const second = queryResponseArtifact(
      artifact.id, '/response/teams', ['id'], undefined, 1,
      first.responseMeta.nextCursor, 'tenant-a',
    ) as any;

    expect(first.responsePath).toBe('/response/teams');
    expect(first.response).toEqual([{ id: 1 }]);
    expect(first.responseMeta.inferredResponsePath).toBe('/response/teams');
    expect(second.response).toEqual([{ id: 2 }]);
    expect(second.responseMeta).not.toHaveProperty('inferredResponsePath');
  });

  it('keeps exact pointers authoritative and reports failed root-relative attempts', () => {
    const artifact = persistResponseArtifact({
      teams: [{ id: 'document' }],
      response: { teams: [{ id: 'private-team-value' }], available: true },
    }, 'tenant-a');
    const metaPath = path.join(root, `response-${artifact.id}.meta.json`);
    const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
    metadata.responseRoot = '/response';
    writeFileSync(metaPath, JSON.stringify(metadata));

    const exact = queryResponseArtifact(
      artifact.id, '/teams', ['id'], undefined, 20, undefined, 'tenant-a',
    ) as any;
    const missing = () => queryResponseArtifact(
      artifact.id, '/missing', undefined, undefined, 20, undefined, 'tenant-a',
    );

    expect(exact.response).toEqual([{ id: 'document' }]);
    expect(exact.responseMeta).not.toHaveProperty('inferredResponsePath');
    expect(missing).toThrow('tried "/response/missing"');
    expect(missing).toThrow('Available children: /teams, /available');
    expect(missing).not.toThrow('private-team-value');
  });

  it('supports case-insensitive contains filters', () => {
    const artifact = persistResponseArtifact({ rows: [{ name: 'AddNode' }, { name: 'removeNode' }] }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id,
      '/rows',
      undefined,
      [{ path: '/name', op: 'icontains', value: 'ADDNODE' }],
      20,
      undefined,
      'tenant-a',
    ) as any;
    expect(result.response).toEqual([{ name: 'AddNode' }]);
    expect(result.responseMeta.filtersApplied).toEqual([
      { path: '/name', op: 'icontains', resolvedOn: 2, matched: 1 },
    ]);
  });

  it('treats contains on an unsupported scalar type as not matched', () => {
    const artifact = persistResponseArtifact({ rows: [{ id: 1 }] }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id,
      '/rows',
      undefined,
      [{ path: '/id', op: 'contains', value: 1 }],
      20,
      undefined,
      'tenant-a',
    ) as any;
    expect(result.response).toEqual([]);
  });

  it('pages a large non-array structured query result by entry instead of gutting it', () => {
    const artifact = persistResponseArtifact({ record: { id: 1, body: 'x'.repeat(40 * 1024) } }, 'tenant-a');
    const first = queryResponseArtifact(
      artifact.id, '/record', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;
    expect(first.response).toEqual({ id: 1 });
    expect(first.responseMeta).toMatchObject({
      complete: false,
      truncated: true,
      pageUnit: 'entries',
      totalCount: 2,
      returnedCount: 1,
    });
    expect(first.responseMeta.nextCursor).toBeTruthy();

    // A 40 KiB entry exceeds the whole budget, so it is summarized and directs the
    // caller to a narrower semantic query.
    const second = queryResponseArtifact(
      artifact.id, '/record', undefined, undefined, 20, first.responseMeta.nextCursor, 'tenant-a',
    ) as any;
    expect(Object.keys(second.response)).toEqual(['body']);
    expect(second.response.body).toContain('40960 chars total');
    expect(second.responseMeta).toMatchObject({
      truncated: true,
      truncationReason: 'item_size_limit',
      nextCursor: null,
    });
    expect(second.responseMeta.warning).toContain('narrower responsePath');
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(HARD_RESULT_BYTES);
  });

  it('deduplicates identical payloads within a scope but not across scopes', () => {
    const value = { rows: Array.from({ length: 50 }, (_, i) => ({ i, text: 'q'.repeat(1000) })) };
    const first = persistResponseArtifact(value, 'tenant-a');
    const second = persistResponseArtifact(value, 'tenant-a');
    const other = persistResponseArtifact(value, 'tenant-b');
    expect(second.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    // Reuse must refresh the handle so a long session cannot have it expire underneath.
    expect(Date.parse(second.expiresAt)).toBeGreaterThanOrEqual(Date.parse(first.expiresAt));
  });

  it('rejects a filter path that resolves on no item instead of reporting a complete zero', () => {
    const artifact = persistResponseArtifact({
      data: { executions: Array.from({ length: 10 }, (_, i) => ({ id: String(i), status: 'success' })) },
    }, 'tenant-a');

    // A pointer one token wrong must raise, not report a complete zero.
    let thrown: Error | undefined;
    try {
      queryResponseArtifact(
        artifact.id, '/data/executions', undefined,
        [{ path: '/data/status', op: 'eq', value: 'error' }], 20, undefined, 'tenant-a',
      );
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('/data/status');
    expect(thrown!.message).toContain('/status');

    // The correct pointer still works, and a genuine zero-match stays a clean zero.
    const correct = queryResponseArtifact(
      artifact.id, '/data/executions', ['id'],
      [{ path: '/status', op: 'eq', value: 'success' }], 20, undefined, 'tenant-a',
    ) as any;
    expect(correct.responseMeta.totalCount).toBe(10);
    expect(correct.responseMeta.filtersApplied).toEqual([
      { path: '/status', op: 'eq', resolvedOn: 10, matched: 10 },
    ]);

    const genuineZero = queryResponseArtifact(
      artifact.id, '/data/executions', ['id'],
      [{ path: '/status', op: 'eq', value: 'error' }], 20, undefined, 'tenant-a',
    ) as any;
    expect(genuineZero.response).toEqual([]);
    expect(genuineZero.responseMeta).toMatchObject({ totalCount: 0, complete: true });
    expect(genuineZero.responseMeta.filtersApplied[0]).toMatchObject({ resolvedOn: 10, matched: 0 });
  });

  it('rejects a comparison whose operands are never mutually comparable', () => {
    const artifact = persistResponseArtifact({ rows: [{ ms: 10 }, { ms: 2000 }] }, 'tenant-a');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, [{ path: '/ms', op: 'gt', value: '100' }], 20, undefined, 'tenant-a',
    )).toThrow('comparable operands');
    const numeric = queryResponseArtifact(
      artifact.id, '/rows', undefined, [{ path: '/ms', op: 'gt', value: 100 }], 20, undefined, 'tenant-a',
    ) as any;
    expect(numeric.response).toEqual([{ ms: 2000 }]);
  });

  it('describes shape without emitting values so pointers do not have to be guessed', () => {
    const artifact = persistResponseArtifact({
      data: { executions: [{ id: '1', status: 'error', nested: { a: 1 } }, { id: '2', extra: true }] },
    }, 'tenant-a');
    const described = queryResponseArtifact(
      artifact.id, '/data/executions', undefined, undefined, 20, undefined, 'tenant-a', true,
    ) as any;
    expect(described.shape.type).toBe('array');
    expect(described.shape.length).toBe(2);
    // Keys merge across sampled items, so a heterogeneous array still yields usable pointers.
    const names = described.shape.itemKeys.map((key: any) => key.name).sort();
    expect(names).toEqual(['extra', 'id', 'nested', 'status']);
    expect(described.shape.itemKeys.find((k: any) => k.name === 'id').pointer).toBe('/id');
    expect(JSON.stringify(described)).not.toContain('error');
    expect(described.responseMeta.complete).toBe(true);
    expect(described.responseMeta.contractVersion).toBe(3);
    expect(described.responseMeta.artifact).toBeUndefined();
  });

  it('filters native n8n connection maps through generic object entries', () => {
    const connections = {
      'Source Alpha': { main: [[{ node: 'Transform Alpha', type: 'main', index: 0 }]] },
      'Source Beta': { main: [[{ node: 'Decision Beta', type: 'main', index: 0 }]] },
      'Decision Beta': { main: [[{ node: 'Sink Beta', type: 'main', index: 0 }]] },
    };
    const artifact = persistResponseArtifact({ data: { connections } }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id,
      '/data/connections',
      ['key', '/value/main'],
      [{ path: '/key', op: 'in', value: ['Source Alpha', 'Decision Beta'] }],
      20,
      undefined,
      'tenant-a',
      false,
      'entries',
    ) as any;

    expect(result.response.map((entry: any) => entry.key)).toEqual([
      'Source Alpha',
      'Decision Beta',
    ]);
    expect(result.responseMeta).toMatchObject({ contractVersion: 3, totalCount: 2, complete: true });
  });

  it('returns an executable entry-mode suggestion for keyed object queries', () => {
    const artifact = persistResponseArtifact({
      data: {
        connections: {
          'Source Alpha': { id: 'a', type: 'main' },
          'Source Beta': { id: 'b', type: 'main' },
        },
      },
    }, 'tenant-a');

    const query = () => queryResponseArtifact(
      artifact.id,
      '/data/connections',
      ['id', 'type'],
      [{ path: '/from', op: 'eq', value: 'Source Alpha' }],
      20,
      undefined,
      'tenant-a',
    );
    expect(query).toThrow('OBJECT_MODE_REQUIRED');
    expect(query).toThrow('"objectMode":"entries"');
    expect(query).toThrow('"path":"/key"');
    expect(query).toThrow('"/value/id"');
  });

  it('validates object entry mode and describe combinations', () => {
    const artifact = persistResponseArtifact({
      map: { alpha: 1 },
      rows: [{ id: 1 }],
      scalar: 42,
    }, 'tenant-a');

    expect(() => queryResponseArtifact(
      artifact.id, '/map', undefined, undefined, 20, undefined, 'tenant-a', true, 'entries',
    )).toThrow('describe cannot be combined with objectMode');
    expect(() => queryResponseArtifact(
      artifact.id, '/map', undefined, undefined, 20, undefined, 'tenant-a', false, 'other' as any,
    )).toThrow('Unsupported objectMode');
    expect(() => queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 20, undefined, 'tenant-a', false, 'entries',
    )).toThrow('requires responsePath to select a JSON object');
    expect(() => queryResponseArtifact(
      artifact.id, '/scalar', undefined, undefined, 20, undefined, 'tenant-a', false, 'entries',
    )).toThrow('it selects number');
  });

  it('warns when an oversized scalar comes from an already truncated source', () => {
    const artifact = persistResponseArtifact({
      hasMoreData: true,
      value: 'x'.repeat(40 * 1024),
    }, 'tenant-a');

    const result = queryResponseArtifact(
      artifact.id, '/value', undefined, undefined, 20, undefined, 'tenant-a',
    ) as any;

    expect(result.responseMeta).toMatchObject({
      truncated: true,
      sourceTruncated: true,
      truncationReason: 'scalar_size_limit',
    });
    expect(result.responseMeta.warning).toContain('reduced view');
    expect(result.responseMeta.warning).toContain('textSearch');
  });

  it('describes scalar, empty-array, and child-array shapes', () => {
    const artifact = persistResponseArtifact({
      text: 'alpha',
      empty: [],
      record: { children: [1, 2, 3] },
    }, 'tenant-a');

    const scalar = queryResponseArtifact(
      artifact.id, '/text', undefined, undefined, 20, undefined, 'tenant-a', true,
    ) as any;
    expect(scalar.shape).toEqual({ type: 'string', length: 5 });

    const empty = queryResponseArtifact(
      artifact.id, '/empty', undefined, undefined, 20, undefined, 'tenant-a', true,
    ) as any;
    expect(empty.shape).toMatchObject({ type: 'array', length: 0, itemType: null });

    const record = queryResponseArtifact(
      artifact.id, '/record', undefined, undefined, 20, undefined, 'tenant-a', true,
    ) as any;
    expect(record.shape.keys).toContainEqual(expect.objectContaining({ name: 'children', length: 3 }));
  });

  it('compacts valid and malformed workflow connection groups within the edge limit', async () => {
    vi.resetModules();
    process.env.MCP_RESPONSE_ARTIFACT_ROOT = root;
    process.env.MCP_RESPONSE_CURSOR_KEY = 'coverage-test-connections-key';
    process.env.MCP_RESPONSE_PREVIEW_BYTES = String(64 * 1024);
    const fresh = await import('../../../src/services/mcp-response-bounding');
    const targets = Array.from({ length: 402 }, (_, index) => ({
      node: `S${index}`,
      type: 'main',
      index,
    }));
    const connections: Record<string, unknown> = {
      'Source Alpha': { main: [targets] },
      'Source Beta': { main: 'invalid-groups' },
      'Source Gamma': { main: [null] },
      'Source Delta': null,
      'Source Epsilon': { main: [[null, { node: 'Sink Epsilon' }]] },
      'Source Zeta': { main: [[{ node: 'Sink Zeta', index: 1 }]] },
    };
    const value = {
      success: true,
      data: {
        id: 'workflow-connections',
        name: 'Connection coverage',
        nodes: [{ id: 'node-1', name: 'Source Alpha', type: 'n8n-nodes-base.code' }],
        connections,
        filler: 'x'.repeat(40 * 1024),
      },
    };

    const bounded = fresh.boundToolResult('n8n_get_workflow', value, 'tenant-a') as any;
    expect(bounded.data.data.connections).toHaveLength(400);
    expect(bounded.data.data.connectionsOmitted).toBe(4);
    expect(bounded.responseMeta.artifact.primaryPaths).toContain('/data/connections');
  });

  it('supports deterministic configuration and rejects signed invalid cursor states', async () => {
    vi.resetModules();
    process.env.MCP_RESPONSE_ARTIFACT_ROOT = root;
    process.env.MCP_RESPONSE_CURSOR_KEY = 'coverage-test-cursor-key';
    process.env.MCP_RESPONSE_INLINE_BYTES = 'invalid';
    process.env.MCP_RESPONSE_PREVIEW_BYTES = '4096';
    process.env.MCP_RESPONSE_HARD_BYTES = '131072';
    const fresh = await import('../../../src/services/mcp-response-bounding');

    expect(fresh.INLINE_RESULT_BYTES).toBe(32 * 1024);
    expect(fresh.PREVIEW_RESULT_BYTES).toBe(4096);

    const artifact = fresh.persistResponseArtifact({ rows: [1, 2, 3] }, 'tenant-a');
    const scopedOwner = createHash('sha256').update('tenant-a').digest('hex');
    const otherOwner = createHash('sha256').update('tenant-b').digest('hex');
    const sign = (state: Record<string, unknown>, version = 3): string => {
      const payload = Buffer.from(JSON.stringify({ v: version, ...state }));
      const signature = createHmac('sha256', 'coverage-test-cursor-key').update(payload).digest();
      return Buffer.concat([payload, signature]).toString('base64url');
    };

    const queryState = {
      artifactId: artifact.id,
      owner: scopedOwner,
      viewHash: 'wrong-view',
      offset: 0,
    };
    expect(() => fresh.queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 1,
      sign(queryState, 1), 'tenant-a',
    )).toThrow('unsupported response contract version');
    expect(() => fresh.queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 1, sign({ ...queryState, owner: otherOwner }), 'tenant-a',
    )).toThrow('different MCP scope');
    expect(() => fresh.queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 1, sign(queryState), 'tenant-a',
    )).toThrow('does not match this query');
  });

  it('enforces deliberately restrictive configured response budgets', async () => {
    vi.resetModules();
    process.env.MCP_RESPONSE_ARTIFACT_ROOT = root;
    process.env.MCP_RESPONSE_CURSOR_KEY = 'coverage-test-budget-key';
    process.env.MCP_RESPONSE_INLINE_BYTES = '1024';
    process.env.MCP_RESPONSE_PREVIEW_BYTES = '1';
    process.env.MCP_RESPONSE_HARD_BYTES = '64';
    const fresh = await import('../../../src/services/mcp-response-bounding');

    expect(() => fresh.boundToolResult(
      'additional_large_tool', { value: 'x'.repeat(2048) }, 'tenant-a',
    )).toThrow('hard serialized-size limit');

    const artifact = fresh.persistResponseArtifact({ rows: [{ id: 1 }] }, 'tenant-a');
    expect(() => fresh.queryResponseArtifact(
      artifact.id, '/rows', undefined, undefined, 20, undefined, 'tenant-a',
    )).toThrow('hard serialized-size limit');
  });

  it('pages object shape keys with absolute pointers and binds the cursor to the view', () => {
    const artifact = persistResponseArtifact({ data: { map: { 'a/b': 1, 'c~d': 2, third: 3 } } }, 'tenant-a');
    const first = queryResponseArtifact(
      artifact.id, '/data/map', undefined, undefined, 2, undefined, 'tenant-a', true,
    ) as any;
    expect(first.shape.keys.map((key: any) => key.pointer)).toEqual(['/data/map/a~1b', '/data/map/c~0d']);
    expect(first.responseMeta.nextCursor).toBeTruthy();

    const second = queryResponseArtifact(
      artifact.id, '/data/map', undefined, undefined, 2, first.responseMeta.nextCursor, 'tenant-a', true,
    ) as any;
    expect(second.shape.keys.map((key: any) => key.pointer)).toEqual(['/data/map/third']);
    expect(second.responseMeta.complete).toBe(true);
    expect(() => queryResponseArtifact(
      artifact.id, '/data/map', ['third'], undefined, 2, undefined, 'tenant-a', true,
    )).toThrow('describe cannot be combined');
  });

  it('uses compact JSON for the inline threshold and caps artifact previews separately', () => {
    const value = {
      rows: Array.from({ length: 440 }, (_, index) => ({ id: index, label: `row-${index}`, active: true })),
    };
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(INLINE_RESULT_BYTES);
    expect(Buffer.byteLength(JSON.stringify(value, null, 2))).toBeGreaterThan(INLINE_RESULT_BYTES);
    expect(boundToolResult('additional_large_tool', value, 'tenant-a')).toEqual(value);

    const oversized = { rows: Array.from({ length: 80 }, (_, index) => ({ index, payload: 'x'.repeat(1000) })) };
    const bounded = boundToolResult('additional_large_tool', oversized, 'tenant-a') as any;
    expect(bounded.responseMeta.artifact).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(8 * 1024);
  });

  it('marks truncated arrays and preserves scalars at every depth', () => {
    // The generic compact path runs for tools without a bespoke preview.
    const value = {
      rows: Array.from({ length: 9 }, (_, i) => i),
      deep: { two: { three: { count: 42, flag: false, name: 'kept' } } },
      filler: 'y'.repeat(40 * 1024),
    };
    const bounded = boundToolResult('additional_large_tool', value, 'tenant-a') as any;

    // A sliced array must carry a remainder marker.
    expect(Array.isArray(bounded.data.rows)).toBe(true);
    expect(bounded.data.rows[bounded.data.rows.length - 1]).toEqual({ _omittedItems: 6 });

    // Scalars must survive depth clipping.
    const three = bounded.data.deep?.two?.three;
    expect(three).toEqual({ count: 42, flag: false, name: 'kept' });
  });

  it('advertises artifact paths that actually resolve on the stored payload', () => {
    const value = {
      success: true,
      data: { executions: Array.from({ length: 60 }, (_, i) => ({ id: String(i), blob: 'z'.repeat(1000) })) },
    };
    const bounded = boundToolResult('n8n_executions', value, 'tenant-a') as any;
    const paths: string[] = bounded.responseMeta.artifact.primaryPaths;
    expect(paths).toContain('/data/executions');
    // Every advertised pointer must resolve against the stored payload.
    for (const pointer of paths) {
      expect(() => queryResponseArtifact(
        bounded.responseMeta.artifact.id, pointer, undefined, undefined, 1, undefined, 'tenant-a', true,
      )).not.toThrow();
    }
    expect(() => queryResponseArtifact(
      bounded.responseMeta.artifact.id, '/data/data/executions', undefined, undefined, 1, undefined, 'tenant-a',
    )).toThrow('INVALID_RESPONSE_PATH');
  });

  it('searches large string values without returning the full artifact', () => {
    const artifact = persistResponseArtifact({
      records: [
        { body: `${'x'.repeat(20_000)}Needle${'y'.repeat(20_000)}` },
        { body: 'needle again' },
      ],
    }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id, '/records', undefined, undefined, 20, undefined, 'tenant-a', false, undefined,
      { query: 'needle' },
    ) as any;

    expect(result.response).toHaveLength(2);
    expect(result.response[0]).toMatchObject({ pointer: '/records/0/body', offset: 20_000 });
    expect(result.response[0].context.length).toBeLessThanOrEqual(240);
    expect(result.responseMeta).toMatchObject({ complete: true, returnedCount: 2, nextCursor: null });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(INLINE_RESULT_BYTES);
  });

  it('caps literal search matches and rejects incompatible query modes', () => {
    const artifact = persistResponseArtifact({
      records: Array.from({ length: 30 }, (_, index) => ({ body: `needle-${index}` })),
    }, 'tenant-a');
    const result = queryResponseArtifact(
      artifact.id, '/records', undefined, undefined, 20, undefined, 'tenant-a', false, undefined,
      { query: 'needle' },
    ) as any;

    expect(result.response).toHaveLength(20);
    expect(result.responseMeta).toMatchObject({ complete: false, truncated: true, returnedCount: 20 });
    expect(() => queryResponseArtifact(
      artifact.id, '/records', ['body'], undefined, 20, undefined, 'tenant-a', false, undefined,
      { query: 'needle' },
    )).toThrow('textSearch cannot be combined');
  });

  it('rejects an artifact whose stored body is no longer valid JSON', () => {
    const artifact = persistResponseArtifact({ rows: [] }, 'tenant-a');
    writeFileSync(path.join(root, `response-${artifact.id}.json`), '{invalid');
    expect(() => queryResponseArtifact(
      artifact.id, '', undefined, undefined, 20, undefined, 'tenant-a',
    )).toThrow('valid JSON');
  });
});
