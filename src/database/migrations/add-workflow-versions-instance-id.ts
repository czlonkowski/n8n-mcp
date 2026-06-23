/**
 * Migration: add tenant scoping (instance_id) to workflow_versions.
 *
 * Fixes GHSA-j6r7-6fhx-77wx: the workflow_versions table had no tenant
 * column, so in multi-tenant deployments any tenant could read/delete other
 * tenants' version backups by enumerating sequential version ids.
 *
 * File-based databases do not re-run schema.sql at startup, so this runs at
 * NodeRepository init to upgrade existing databases in place. It is idempotent
 * (guarded by PRAGMA table_info) and a no-op once the column exists.
 *
 * Pre-fix rows have no known tenant and were cross-tenant-readable while
 * vulnerable, so they are purged: when the column is missing the table is
 * dropped and recreated rather than backfilled. Dropping also lets us fix the
 * UNIQUE constraint (now scoped by instance_id), which SQLite cannot ALTER.
 *
 * Only the workflow_versions table is touched; the nodes table (including
 * community nodes) is never affected.
 */

import { DatabaseAdapter } from '../database-adapter';
import { logger } from '../../utils/logger';

// Canonical DDL — keep in sync with src/database/schema.sql.
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS workflow_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL DEFAULT '',
    workflow_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    workflow_name TEXT NOT NULL,
    workflow_snapshot TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK(trigger IN (
      'partial_update',
      'full_update',
      'autofix'
    )),
    operations TEXT,
    fix_types TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(instance_id, workflow_id, version_number)
  );
`;

const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_workflow_versions_instance ON workflow_versions(instance_id, workflow_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_versions_created_at ON workflow_versions(created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_versions_trigger ON workflow_versions(trigger);
`;

/**
 * Ensure the workflow_versions table is tenant-scoped. Safe to call on every
 * startup. Returns true if a schema change was applied.
 */
export function migrateWorkflowVersionsInstanceId(db: DatabaseAdapter): boolean {
  try {
    const columns = db.prepare('PRAGMA table_info(workflow_versions)').all() as Array<{ name: string }>;
    const tableExists = columns.length > 0;
    const hasInstanceId = columns.some((col) => col.name === 'instance_id');

    if (tableExists && hasInstanceId) {
      // Already migrated.
      return false;
    }

    // Drop (purging legacy, un-tenanted rows) and recreate with the new schema.
    db.exec(`
      DROP TABLE IF EXISTS workflow_versions;
      ${CREATE_TABLE}
      ${CREATE_INDEXES}
    `);

    logger.info(
      tableExists
        ? 'Migrated workflow_versions: added instance_id tenant scoping (legacy version backups purged)'
        : 'Created workflow_versions table with instance_id tenant scoping'
    );
    return true;
  } catch (error) {
    // Tolerate read-only databases and other failures: log and continue so a
    // read-only deployment still starts. Tenant-scoped queries assume the
    // column exists, which holds for any writable versioning database.
    logger.warn('Could not apply workflow_versions instance_id migration', { error });
    return false;
  }
}
