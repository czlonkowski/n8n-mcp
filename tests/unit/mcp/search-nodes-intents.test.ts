import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  SEARCH_INTENTS,
  matchSearchIntent,
  normalizeIntentQuery
} from '../../../src/services/search-intents';
import { N8NDocumentationMCPServer } from '../../../src/mcp/server';
import { closeSharedDatabase } from '../../../src/database/shared-database';

/**
 * search_nodes ranks the core node that performs a generic data-shaping
 * operation first when the whole query names that operation ("group by",
 * "deduplicate"). Queries with other content words keep FTS ranking.
 */

const sourceDbPath = path.join(__dirname, '../../../data/nodes.db');
const dbExists = fs.existsSync(sourceDbPath);

describe('matchSearchIntent', () => {
  it.each([
    ['deduplicate', 'nodes-base.removeDuplicates'],
    ['how to deduplicate', 'nodes-base.removeDuplicates'],
    ['How do I dedupe items in n8n?', 'nodes-base.removeDuplicates'],
    ['Group by?', 'nodes-base.summarize'],
    ['  group   by  ', 'nodes-base.summarize'],
    ['sum values', 'nodes-base.summarize'],
    ['flatten array', 'nodes-base.splitOut'],
    ['flatten an array', 'nodes-base.splitOut'],
    ['combine items into list', 'nodes-base.aggregate'],
    ['add a field', 'nodes-base.set'],
    ['transform data', 'nodes-base.set'],
    ['compare lists', 'nodes-base.compareDatasets'],
    ['join two lists', 'nodes-base.merge'],
    ['sort', 'nodes-base.sort'],
    ['sort items', 'nodes-base.sort'],
    ['filter items node', 'nodes-base.filter'],
    ['format date', 'nodes-base.dateTime'],
    ['limit items', 'nodes-base.limit']
  ])('matches "%s" to %s first', (query, nodeType) => {
    expect(matchSearchIntent(query)?.nodeTypes[0]).toBe(nodeType);
  });

  it('lists Set before Rename Keys for rename queries', () => {
    expect(matchSearchIntent('rename fields')?.nodeTypes).toEqual(['nodes-base.set', 'nodes-base.renameKeys']);
  });

  it.each([
    'hubspot deduplicate contacts',
    'deduplicate leads in salesforce',
    'postgres group by',
    'slack send message',
    'sort hubspot deals',
    'http request',
    'webhook',
    'code',
    'how to',
    ''
  ])('does not match "%s"', (query) => {
    expect(matchSearchIntent(query)).toBeUndefined();
  });

  it('drops only question and function words', () => {
    expect(normalizeIntentQuery('How do I flatten an array in n8n?')).toBe('flatten array');
    expect(normalizeIntentQuery('Group items by field!')).toBe('group items by field');
    expect(normalizeIntentQuery('the node')).toBe('');
  });
});

describe('normalizeIntentQuery on long input', () => {
  it('handles a long run of trailing punctuation in linear time', () => {
    const query = 'deduplicate' + '!'.repeat(50_000) + 'x';
    const started = Date.now();
    normalizeIntentQuery(query);
    expect(Date.now() - started).toBeLessThan(200);
    expect(normalizeIntentQuery('Group by?!')).toBe('group by');
  });
});

describe('SEARCH_INTENTS table', () => {
  it('has no phrase that maps to two intents', () => {
    const owner = new Map<string, string>();
    for (const intent of SEARCH_INTENTS) {
      for (const phrase of intent.phrases) {
        const key = normalizeIntentQuery(phrase);
        expect(key, `phrase "${phrase}" normalizes to nothing`).not.toBe('');
        expect(owner.get(key), `"${phrase}" is in ${owner.get(key)} and ${intent.id}`).toBeUndefined();
        owner.set(key, intent.id);
      }
    }
  });

  it('targets core nodes only, never the Code node', () => {
    for (const intent of SEARCH_INTENTS) {
      expect(intent.nodeTypes.length).toBeGreaterThan(0);
      for (const nodeType of intent.nodeTypes) {
        expect(nodeType).toMatch(/^nodes-base\./);
        expect(nodeType).not.toBe('nodes-base.code');
      }
    }
  });

  it.skipIf(!dbExists)('every target exists in data/nodes.db as a core node', () => {
    const db = new Database(sourceDbPath, { readonly: true });
    try {
      const stmt = db.prepare('SELECT is_community FROM nodes WHERE node_type = ?');
      for (const nodeType of new Set(SEARCH_INTENTS.flatMap(intent => intent.nodeTypes))) {
        const row = stmt.get(nodeType) as { is_community: number } | undefined;
        expect(row, `${nodeType} missing from nodes.db`).toBeDefined();
        expect(row!.is_community).toBe(0);
      }
    } finally {
      db.close();
    }
  });
});

describe.skipIf(!dbExists)('search_nodes with intents (real database)', () => {
  let server: N8NDocumentationMCPServer;
  let tmpDir: string;
  const previousDbPath = process.env.NODE_DB_PATH;

  beforeAll(async () => {
    // Work on a copy: opening the tracked database rewrites bytes in it.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-search-intents-'));
    const dbCopy = path.join(tmpDir, 'nodes.db');
    fs.copyFileSync(sourceDbPath, dbCopy);
    process.env.NODE_DB_PATH = dbCopy;
    server = new N8NDocumentationMCPServer();
    await (server as any).initialized;
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await closeSharedDatabase();
    if (previousDbPath === undefined) delete process.env.NODE_DB_PATH;
    else process.env.NODE_DB_PATH = previousDbPath;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const search = async (args: Record<string, unknown>) =>
    (await server.executeTool('search_nodes', args)) as { results: any[]; totalCount: number };
  const types = (results: any[]) => results.map(result => result.nodeType);

  it('applies intents on the LIKE path used without FTS5 (sql.js)', async () => {
    const like = (query: string, options: Record<string, unknown> = {}) =>
      (server as any).searchNodesLIKE(query, 5, options) as Promise<{ results: any[] }>;
    expect((await like('group by')).results[0].nodeType).toBe('nodes-base.summarize');
    expect((await like('how to deduplicate?')).results[0].nodeType).toBe('nodes-base.removeDuplicates');
    const community = await like('group by', { source: 'community' });
    expect(community.results.every((result: any) => result.isCommunity)).toBe(true);
  });

  it('ranks Summarize first for "group by"', async () => {
    const { results } = await search({ query: 'group by', limit: 8 });
    expect(results[0].nodeType).toBe('nodes-base.summarize');
    expect(results[0].workflowNodeType).toBe('n8n-nodes-base.summarize');
    expect(results[0].relevance).toBe('high');
  });

  it('ranks Remove Duplicates first for "deduplicate" and its question form', async () => {
    expect((await search({ query: 'deduplicate', limit: 8 })).results[0].nodeType).toBe('nodes-base.removeDuplicates');
    expect((await search({ query: 'how to deduplicate?', limit: 8 })).results[0].nodeType).toBe('nodes-base.removeDuplicates');
  });

  it('puts Split Out in the top two for "flatten array"', async () => {
    const { results } = await search({ query: 'flatten array', limit: 8 });
    expect(types(results).slice(0, 2)).toContain('nodes-base.splitOut');
  });

  it('lists Set then Rename Keys for "rename fields" without duplicating rows', async () => {
    const { results } = await search({ query: 'rename fields', limit: 8 });
    expect(types(results).slice(0, 2)).toEqual(['nodes-base.set', 'nodes-base.renameKeys']);
    expect(new Set(types(results)).size).toBe(results.length);
  });

  it.each([
    ['hubspot deduplicate contacts', 'nodes-base.hubspot'],
    ['slack send message', 'nodes-base.slack'],
    ['http request', 'nodes-base.httpRequest'],
    ['webhook', 'nodes-base.webhook']
  ])('leaves "%s" ranked as before (%s first)', async (query, nodeType) => {
    const { results } = await search({ query, limit: 8 });
    expect(results[0].nodeType).toBe(nodeType);
  });

  it('applies with source "core"', async () => {
    const { results } = await search({ query: 'group by', limit: 5, source: 'core' });
    expect(results[0].nodeType).toBe('nodes-base.summarize');
    expect(results.every(result => !result.isCommunity)).toBe(true);
  });

  it('does not inject core nodes into community-only results', async () => {
    const { results } = await search({ query: 'deduplicate', limit: 8, source: 'community' });
    expect(types(results)).not.toContain('nodes-base.removeDuplicates');
    expect(results.every(result => result.isCommunity === true)).toBe(true);
  });

  it('respects limit after injecting a node', async () => {
    const { results, totalCount } = await search({ query: 'group by', limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
    expect(totalCount).toBe(results.length);
    expect(results[0].nodeType).toBe('nodes-base.summarize');

    const single = await search({ query: 'rename fields', limit: 1 });
    expect(types(single.results)).toEqual(['nodes-base.set']);
  });
});
