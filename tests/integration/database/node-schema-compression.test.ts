import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createDatabaseAdapter, createSQLJSAdapter, DatabaseAdapter } from '../../../src/database/database-adapter';
import { NodeRepository } from '../../../src/database/node-repository';
import { compactNodeDatabase } from '../../../src/scripts/compact-node-database';
import { ParsedNode } from '../../../src/parsers/node-parser';

const node: ParsedNode = {
  nodeType: 'nodes-base.schemaCompression', packageName: 'n8n-nodes-base',
  displayName: 'Schema Compression', description: 'Test catalog entry',
  category: 'transform', style: 'programmatic', version: '1',
  isAITool: true, isTrigger: false, isWebhook: false, isVersioned: false,
  properties: [{ name: 'resource', type: 'options', options: [{ name: '文書', value: 'document' }] }],
  operations: [{ name: 'uniquesearchoperation', displayName: 'Unique Search Operation' }],
  credentials: [],
};

for (const backend of ['better-sqlite3', 'sql.js'] as const) {
  describe(`node schema compression (${backend})`, () => {
    let dir: string;
    let db: DatabaseAdapter;
    let repository: NodeRepository;
    let closed: boolean;
    const open = backend === 'sql.js' ? createSQLJSAdapter : createDatabaseAdapter;

    beforeEach(async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'node-schema-compression-'));
      db = await open(path.join(dir, 'nodes.db'));
      closed = false;
      // A missing native binding must not silently turn this into a fallback test.
      expect(db.constructor.name).toBe(backend === 'sql.js' ? 'SQLJSAdapter' : 'BetterSQLiteAdapter');
      let schema = readFileSync(path.join(__dirname, '../../..', 'src/database/schema.sql'), 'utf8');
      if (backend === 'sql.js') {
        // The shipped sql.js build has no FTS5, just as in normal fallback mode.
        schema = schema.replace(/-- FTS5 full-text search index for nodes[\s\S]*?-- Templates table/, '-- Templates table');
      }
      db.exec(schema);
      repository = new NodeRepository(db);
    });

    afterEach(() => {
      if (!closed) db?.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('stores compressed schemas with searchable plain operations and reads them losslessly', () => {
      repository.saveNode(node);
      const row = db.prepare('SELECT * FROM nodes WHERE node_type = ?').get(node.nodeType);
      expect(JSON.parse(gunzipSync(Buffer.from(row.properties_schema, 'base64')).toString('utf8'))).toEqual(node.properties);
      expect(JSON.parse(row.operations)).toEqual(node.operations);
      expect(repository.getNode(node.nodeType).properties).toEqual(node.properties);
      expect(repository.getNodeOperations(node.nodeType)).toEqual(node.operations);
      expect(repository.getNodesByCategory('transform')[0].properties).toEqual(node.properties);
    });

    it('reads old plain schemas and returns fresh objects even after cache hits', () => {
      repository.saveNode(node);
      repository.getNode(node.nodeType).properties[0].options[0].value = 'mutated';
      expect(repository.getNode(node.nodeType).properties).toEqual(node.properties);
      db.prepare('UPDATE nodes SET properties_schema = ? WHERE node_type = ?')
        .run(JSON.stringify([{ name: 'legacy' }]), node.nodeType);
      expect(repository.getNode(node.nodeType).properties).toEqual([{ name: 'legacy' }]);
    });

    it('does not serve stale schemas after upserts or rolled-back writes', () => {
      repository.saveNode(node);
      repository.getNode(node.nodeType);
      expect(() => repository.transaction(() => {
        repository.saveNode({ ...node, properties: [{ name: 'rolledBack' }] });
        expect(repository.getNode(node.nodeType).properties).toEqual([{ name: 'rolledBack' }]);
        throw new Error('rollback');
      })).toThrow('rollback');
      expect(repository.getNode(node.nodeType).properties).toEqual(node.properties);
      repository.saveNode({ ...node, properties: [{ name: 'updated' }] });
      expect(repository.getNode(node.nodeType).properties).toEqual([{ name: 'updated' }]);
    });

    it('migrates core and preserved community schemas once and persists them after VACUUM', async () => {
      repository.saveNode(node);
      repository.saveNode({ ...node, nodeType: 'community.node', isCommunity: true });
      db.prepare('UPDATE nodes SET properties_schema = ?').run(JSON.stringify(node.properties));
      const result = compactNodeDatabase(db);
      expect(result.compressed).toBe(2);
      expect(compactNodeDatabase(db).compressed).toBe(0);
      db.close();
      closed = true;
      expect(statSync(path.join(dir, 'nodes.db')).size).toBe(result.bytes);
      db = await open(path.join(dir, 'nodes.db'));
      closed = false;
      repository = new NodeRepository(db);
      expect(repository.getNode(node.nodeType).properties).toEqual(node.properties);
      expect(repository.getNode('community.node').properties).toEqual(node.properties);
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    });

    it('rolls back the whole migration if a legacy schema is invalid', () => {
      repository.saveNode(node);
      repository.saveNode({ ...node, nodeType: 'community.invalid', isCommunity: true });
      db.prepare('UPDATE nodes SET properties_schema = ? WHERE node_type = ?').run('[]', node.nodeType);
      db.prepare('UPDATE nodes SET properties_schema = ? WHERE node_type = ?').run('broken', 'community.invalid');
      expect(() => repository.compressNodeSchemas()).toThrow('community.invalid');
      expect(db.prepare('SELECT properties_schema FROM nodes WHERE node_type = ?').get(node.nodeType).properties_schema).toBe('[]');
    });

    it('retains fallback behavior for null and malformed stored schemas', () => {
      repository.saveNode(node);
      for (const stored of [null, 'broken', 'H4sIbroken']) {
        db.prepare('UPDATE nodes SET properties_schema = ? WHERE node_type = ?').run(stored, node.nodeType);
        expect(repository.getNode(node.nodeType).properties).toEqual(stored === null ? null : []);
      }
    });

    if (backend === 'better-sqlite3') {
      it('rejects a catalog that still exceeds the size budget after VACUUM', () => {
        db.exec('CREATE TABLE padding (payload BLOB)');
        db.exec('INSERT INTO padding VALUES (zeroblob(80 * 1024 * 1024))');
        expect(() => compactNodeDatabase(db)).toThrow('must be under 80 MiB before publishing');
      });

      it('preserves operation-only FTS matches across migration and index rebuild', () => {
        repository.saveNode(node);
        db.prepare('UPDATE nodes SET properties_schema = ?').run(JSON.stringify(node.properties));
        const search = () => db.prepare('SELECT node_type FROM nodes_fts WHERE nodes_fts MATCH ?')
          .all('operations:uniquesearchoperation');
        expect(search()).toEqual([{ node_type: node.nodeType }]);
        compactNodeDatabase(db);
        expect(search()).toEqual([{ node_type: node.nodeType }]);
        db.prepare("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')").run();
        expect(search()).toEqual([{ node_type: node.nodeType }]);
      });
    }
  });
}
