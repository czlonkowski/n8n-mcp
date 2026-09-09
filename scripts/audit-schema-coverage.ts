/**
 * Database Schema Coverage Audit Script
 *
 * Audits the database to determine how many nodes have complete schema information
 * for resourceLocator mode validation. This helps assess the coverage of our
 * schema-driven validation approach.
 *
 * properties_schema is stored gzip-compressed (see src/database/compressed-column.ts),
 * so the rows are decoded here instead of matched with SQL LIKE.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { decompressColumnJson } from '../src/database/compressed-column';

const dbPath = path.join(__dirname, '../data/nodes.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== Schema Coverage Audit ===\n');

type NodeRow = { node_type: string; display_name: string; properties_schema: string | null };

const rows = db
  .prepare('SELECT node_type, display_name, properties_schema FROM nodes')
  .all() as NodeRow[];

// Inflate each schema once and match on its JSON text, the way the SQL LIKE predicates used to.
const nodes = rows.map(row => ({
  nodeType: row.node_type,
  displayName: row.display_name,
  schema: JSON.stringify(decompressColumnJson(row.properties_schema ?? '[]', [])),
}));

const resourceLocatorNodes = nodes.filter(node => node.schema.includes('resourceLocator'));
const withModes = resourceLocatorNodes.filter(node => node.schema.includes('modes'));
const withoutModes = resourceLocatorNodes.filter(node => !node.schema.includes('modes'));

console.log(`Nodes with resourceLocator properties: ${resourceLocatorNodes.length}`);
console.log(`Nodes with modes defined: ${withModes.length}`);

console.log(`\nSample nodes WITHOUT modes (showing 10):`);
withoutModes.slice(0, 10).forEach(node => {
  console.log(`  - ${node.displayName} (${node.nodeType})`);
});

// Calculate coverage percentage
const coverage = resourceLocatorNodes.length > 0
  ? (withModes.length / resourceLocatorNodes.length) * 100
  : 0;

console.log(`\nSchema coverage: ${coverage.toFixed(1)}% of resourceLocator nodes have modes defined`);

console.log('\nSample nodes WITH modes (showing 5):');
withModes.slice(0, 5).forEach(node => {
  console.log(`  - ${node.displayName} (${node.nodeType})`);
});

// Summary
console.log('\n=== Summary ===');
console.log(`Total nodes in database: ${rows.length}`);
console.log(`Nodes with resourceLocator: ${resourceLocatorNodes.length}`);
console.log(`Nodes with complete mode schemas: ${withModes.length}`);
console.log(`Nodes without mode schemas: ${withoutModes.length}`);
console.log(`\nImplication: Schema-driven validation will apply to ${withModes.length} nodes.`);
console.log(`For the remaining ${withoutModes.length} nodes, validation will be skipped (graceful degradation).`);

db.close();
