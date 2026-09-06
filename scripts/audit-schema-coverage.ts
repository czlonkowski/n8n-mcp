/** Audit resourceLocator schema coverage in plain or compressed catalogs. */
import path from 'path';
import Database from 'better-sqlite3';
import { CompressedJsonReader } from '../src/database/compressed-json';

function auditSchemaCoverage() {
  const db = new Database(path.join(__dirname, '../data/nodes.db'), { readonly: true });
  try {
    const reader = new CompressedJsonReader();
    const rows = db.prepare('SELECT node_type, display_name, properties_schema FROM nodes').all() as Array<{
      node_type: string; display_name: string; properties_schema: string;
    }>;
    // SQL LIKE cannot inspect a compressed schema. Use the shared decoder
    // so this read-only audit works before and after the catalog migration.
    const resourceLocators = rows.map(row => ({
      ...row,
      schema: JSON.stringify(reader.parse(row.properties_schema)),
    })).filter(row => row.schema.includes('resourceLocator'));
    const withModes = resourceLocators.filter(row => row.schema.includes('modes'));
    const withoutModes = resourceLocators.filter(row => !row.schema.includes('modes'));
    const coverage = resourceLocators.length ? withModes.length / resourceLocators.length * 100 : 0;

    console.log('=== Schema Coverage Audit ===\n');
    console.log(`Nodes with resourceLocator properties: ${resourceLocators.length}`);
    console.log(`Nodes with modes defined: ${withModes.length}`);
    console.log('\nSample nodes WITHOUT modes (showing 10):');
    withoutModes.slice(0, 10).forEach(row => console.log(`  - ${row.display_name} (${row.node_type})`));
    console.log(`\nSchema coverage: ${coverage.toFixed(1)}% of resourceLocator nodes have modes defined`);
    console.log('\nSample nodes WITH modes (showing 5):');
    withModes.slice(0, 5).forEach(row => console.log(`  - ${row.display_name} (${row.node_type})`));
    console.log('\n=== Summary ===');
    console.log(`Total nodes in database: ${rows.length}`);
    console.log(`Nodes with resourceLocator: ${resourceLocators.length}`);
    console.log(`Nodes with complete mode schemas: ${withModes.length}`);
    console.log(`Nodes without mode schemas: ${withoutModes.length}`);
    console.log(`\nImplication: Schema-driven validation will apply to ${withModes.length} nodes.`);
    console.log(`For the remaining ${withoutModes.length} nodes, validation will be skipped (graceful degradation).`);
  } finally {
    db.close();
  }
}

try {
  auditSchemaCoverage();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
