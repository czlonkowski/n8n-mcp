import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSQLJSAdapter, DatabaseAdapter } from '../../../src/database/database-adapter';
import { NodeRepository } from '../../../src/database/node-repository';
import { isCompressedColumn } from '../../../src/database/compressed-column';

/**
 * The sql.js adapter frees a prepared statement after its first run(), and only writes the
 * database file on close(). Both matter for the bulk-column repack, so it is exercised on the
 * real sql.js adapter here rather than only on better-sqlite3. The bundled schema's FTS5
 * triggers do not load in sql.js, so a nodes table with just the columns involved is used.
 */
describe('compressed bulk columns on the sql.js adapter (#1067)', () => {
  let dir: string;
  let adapter: DatabaseAdapter;
  let repository: NodeRepository;

  const largeProperties = Array.from({ length: 200 }, (_, i) => ({
    name: `field${i}`,
    type: 'string',
    displayOptions: { show: { resource: ['message'] } },
  }));
  const longReadme = '# Community node\n\nInstall with `npm install`.\n'.repeat(60);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-mcp-sqljs-'));
    adapter = await createSQLJSAdapter(path.join(dir, 'nodes.db'));
    adapter.exec(`
      CREATE TABLE nodes (
        node_type TEXT PRIMARY KEY,
        package_name TEXT,
        display_name TEXT,
        properties_schema TEXT,
        npm_readme TEXT,
        is_community INTEGER DEFAULT 0
      )
    `);
    repository = new NodeRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const insertPlain = (nodeType: string) =>
    adapter.prepare(
      'INSERT INTO nodes (node_type, package_name, display_name, properties_schema, npm_readme, is_community) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(nodeType, 'pkg', nodeType, JSON.stringify(largeProperties, null, 2), longReadme);

  const raw = (nodeType: string) =>
    adapter.prepare('SELECT properties_schema, npm_readme FROM nodes WHERE node_type = ?').get(nodeType) as {
      properties_schema: string;
      npm_readme: string;
    };

  it('repacks every plain row, not only the first', () => {
    for (const nodeType of ['pkg.one', 'pkg.two', 'pkg.three']) insertPlain(nodeType);

    expect(repository.compressStoredColumns()).toEqual({ rewritten: 3 });

    for (const nodeType of ['pkg.one', 'pkg.two', 'pkg.three']) {
      expect(isCompressedColumn(raw(nodeType).properties_schema)).toBe(true);
      expect(isCompressedColumn(raw(nodeType).npm_readme)).toBe(true);
      const node = repository.getNode(nodeType);
      expect(node.properties).toEqual(largeProperties);
      expect(node.npmReadme).toBe(longReadme);
    }
    expect(repository.compressStoredColumns()).toEqual({ rewritten: 0 });
  });

  it('reads compressed rows back after the file is written and reopened', async () => {
    insertPlain('pkg.persisted');
    repository.compressStoredColumns();
    adapter.close();

    adapter = await createSQLJSAdapter(path.join(dir, 'nodes.db'));
    repository = new NodeRepository(adapter);
    const node = repository.getNode('pkg.persisted');
    expect(node.properties).toEqual(largeProperties);
    expect(node.npmReadme).toBe(longReadme);
  });
});
