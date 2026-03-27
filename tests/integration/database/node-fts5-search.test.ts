/**
 * Integration tests for node FTS5 search functionality
 * Ensures the production search failures (Issue #296) are prevented
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseAdapter } from '../../../src/database/database-adapter';
import { NodeRepository } from '../../../src/database/node-repository';
import * as fs from 'fs';
import * as path from 'path';

describe('Node FTS5 Search Integration Tests', () => {
  let db: any;
  let repository: NodeRepository;

  beforeAll(async () => {
    // Use test database
    const testDbPath = './data/nodes.db';
    db = await createDatabaseAdapter(testDbPath);
    repository = new NodeRepository(db);

    // Rebuild FTS5 index to ensure it is in sync with the nodes table.
    // The content-synced FTS5 index (content=nodes) can become stale if the
    // database was rebuilt without an explicit FTS5 rebuild command, leaving
    // phantom rowid references that cause "missing row" errors on MATCH queries.
    db.prepare("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')").run();
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
  });

  describe('FTS5 Table Existence', () => {
    it('should have nodes_fts table in schema', () => {
      const schemaPath = path.join(__dirname, '../../../src/database/schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      expect(schema).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5');
      expect(schema).toContain('CREATE TRIGGER IF NOT EXISTS nodes_fts_insert');
      expect(schema).toContain('CREATE TRIGGER IF NOT EXISTS nodes_fts_update');
      expect(schema).toContain('CREATE TRIGGER IF NOT EXISTS nodes_fts_delete');
    });

    it('should have nodes_fts table in database', () => {
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='nodes_fts'
      `).get();

      expect(result).toBeDefined();
      expect(result.name).toBe('nodes_fts');
    });

    it('should have FTS5 triggers in database', () => {
      const triggers = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='trigger' AND name LIKE 'nodes_fts_%'
      `).all();

      expect(triggers).toHaveLength(3);
      const triggerNames = triggers.map((t: any) => t.name);
      expect(triggerNames).toContain('nodes_fts_insert');
      expect(triggerNames).toContain('nodes_fts_update');
      expect(triggerNames).toContain('nodes_fts_delete');
    });
  });

  describe('FTS5 Index Population', () => {
    it('should have nodes_fts count matching nodes count', () => {
      const nodesCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get();
      const ftsCount = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();

      expect(nodesCount.count).toBeGreaterThan(500); // Should have both packages
      expect(ftsCount.count).toBe(nodesCount.count);
    });

    it('should not have empty FTS5 index', () => {
      const ftsCount = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();

      expect(ftsCount.count).toBeGreaterThan(0);
    });
  });

  describe('Critical Node Searches (Production Failure Cases)', () => {
    it('should find webhook node via FTS5', () => {
      const results = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'webhook'
      `).all();

      expect(results.length).toBeGreaterThan(0);
      const nodeTypes = results.map((r: any) => r.node_type);
      expect(nodeTypes).toContain('nodes-base.webhook');
    });

    it('should find merge node via FTS5', () => {
      const results = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'merge'
      `).all();

      expect(results.length).toBeGreaterThan(0);
      const nodeTypes = results.map((r: any) => r.node_type);
      expect(nodeTypes).toContain('nodes-base.merge');
    });

    it('should find split batch node via FTS5', () => {
      const results = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'split OR batch'
      `).all();

      expect(results.length).toBeGreaterThan(0);
      const nodeTypes = results.map((r: any) => r.node_type);
      expect(nodeTypes).toContain('nodes-base.splitInBatches');
    });

    it('should find code node via FTS5', () => {
      const results = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'code'
      `).all();

      expect(results.length).toBeGreaterThan(0);
      const nodeTypes = results.map((r: any) => r.node_type);
      expect(nodeTypes).toContain('nodes-base.code');
    });

    it('should find http request node via FTS5', () => {
      const results = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'http OR request'
      `).all();

      expect(results.length).toBeGreaterThan(0);
      const nodeTypes = results.map((r: any) => r.node_type);
      expect(nodeTypes).toContain('nodes-base.httpRequest');
    });
  });

  describe('FTS5 Search Quality', () => {
    it('should rank exact matches higher', () => {
      const results = db.prepare(`
        SELECT
          n.node_type,
          rank
        FROM nodes n
        JOIN nodes_fts ON n.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH 'webhook'
        ORDER BY
          CASE
            WHEN LOWER(n.display_name) = LOWER('webhook') THEN 0
            WHEN LOWER(n.display_name) LIKE LOWER('%webhook%') THEN 1
            WHEN LOWER(n.node_type) LIKE LOWER('%webhook%') THEN 2
            ELSE 3
          END,
          rank
        LIMIT 10
      `).all();

      expect(results.length).toBeGreaterThan(0);
      // Exact match should be in top results (using production boosting logic with CASE-first ordering)
      const topResults = results.slice(0, 3).map((r: any) => r.node_type);
      expect(topResults).toContain('nodes-base.webhook');
    });

    it('should support phrase searches', () => {
      const results = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH '"http request"'
      `).all();

      expect(results.length).toBeGreaterThan(0);
    });

    it('should support boolean operators', () => {
      const andResults = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'google AND sheets'
      `).all();

      const orResults = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'google OR sheets'
      `).all();

      expect(andResults.length).toBeGreaterThan(0);
      expect(orResults.length).toBeGreaterThanOrEqual(andResults.length);
    });
  });

  describe('FTS5 Index Synchronization', () => {
    it('should keep FTS5 in sync after node updates', () => {
      // This test ensures triggers work properly
      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();

      // Insert a test node
      db.prepare(`
        INSERT INTO nodes (
          node_type, package_name, display_name, description,
          category, development_style, is_ai_tool, is_trigger,
          is_webhook, is_versioned, version, properties_schema,
          operations, credentials_required
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'test.node',
        'test-package',
        'Test Node',
        'A test node for FTS5 synchronization',
        'Test',
        'programmatic',
        0, 0, 0, 0,
        '1.0',
        '[]', '[]', '[]'
      );

      const afterInsert = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();
      expect(afterInsert.count).toBe(beforeCount.count + 1);

      // Verify the new node is searchable
      const searchResults = db.prepare(`
        SELECT node_type FROM nodes_fts
        WHERE nodes_fts MATCH 'test synchronization'
      `).all();
      expect(searchResults.length).toBeGreaterThan(0);

      // Clean up
      db.prepare('DELETE FROM nodes WHERE node_type = ?').run('test.node');

      const afterDelete = db.prepare('SELECT COUNT(*) as count FROM nodes_fts').get();
      expect(afterDelete.count).toBe(beforeCount.count);
    });
  });
});
