#!/usr/bin/env node
import { createDatabaseAdapter, DatabaseAdapter } from '../database/database-adapter';
import { NodeRepository } from '../database/node-repository';

const MAX_DATABASE_BYTES = 80 * 1024 * 1024;

/** Compact preserved rows as well as newly rebuilt nodes before publishing. */
export function compactNodeDatabase(db: DatabaseAdapter): { compressed: number; bytes: number } {
  const compressed = new NodeRepository(db).compressNodeSchemas();
  db.exec('VACUUM');
  // Query SQLite itself: sql.js persists its in-memory database on close, so
  // stat-ing the file before close would report the previous size.
  const { bytes } = db.prepare(
    'SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()'
  ).get() as { bytes: number };
  if (bytes >= MAX_DATABASE_BYTES) {
    throw new Error(`Node database is ${(bytes / 1024 / 1024).toFixed(2)} MiB after VACUUM; must be under 80 MiB before publishing`);
  }
  return { compressed, bytes };
}

if (require.main === module) {
  (async () => {
    const db = await createDatabaseAdapter(process.env.NODE_DB_PATH || './data/nodes.db');
    try {
      const result = compactNodeDatabase(db);
      console.log(`Compressed ${result.compressed} schemas; database is ${(result.bytes / 1024 / 1024).toFixed(2)} MiB after VACUUM`);
    } finally {
      db.close();
    }
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
