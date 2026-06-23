import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TestDatabase, createTestDatabaseAdapter } from './test-utils';
import { NodeRepository } from '../../../src/database/node-repository';
import { migrateWorkflowVersionsInstanceId } from '../../../src/database/migrations/add-workflow-versions-instance-id';
import type { DatabaseAdapter } from '../../../src/database/database-adapter';

/**
 * Regression tests for GHSA-j6r7-6fhx-77wx (cross-tenant IDOR in
 * workflow_versions). Verifies every version query is scoped by instance_id
 * and that the in-place migration upgrades and purges legacy databases.
 */
describe('workflow_versions tenant isolation', () => {
  const TENANT_A = 'tenant-a';
  const TENANT_B = 'tenant-b';

  const snapshot = (name: string) => ({ name, nodes: [], connections: {}, settings: {} });

  const createVersion = (repo: NodeRepository, instanceId: string, workflowId: string, versionNumber: number) =>
    repo.createWorkflowVersion({
      instanceId,
      workflowId,
      versionNumber,
      workflowName: `wf ${workflowId}`,
      workflowSnapshot: snapshot(`wf ${workflowId}`),
      trigger: 'partial_update'
    });

  describe('scoped queries', () => {
    let testDb: TestDatabase;
    let repository: NodeRepository;

    beforeEach(async () => {
      testDb = new TestDatabase({ mode: 'memory' });
      const db = await testDb.initialize();
      repository = new NodeRepository(createTestDatabaseAdapter(db));
    });

    afterEach(async () => {
      await testDb.cleanup();
    });

    it('does not let one tenant read another tenant\'s version (the IDOR core)', () => {
      const idA = createVersion(repository, TENANT_A, 'wf-001', 1);

      // Owner can read.
      expect(repository.getWorkflowVersion(idA, TENANT_A)).not.toBeNull();
      // Other tenant cannot read the same numeric id.
      expect(repository.getWorkflowVersion(idA, TENANT_B)).toBeNull();
    });

    it('lists only the calling tenant\'s versions', () => {
      createVersion(repository, TENANT_A, 'wf-001', 1);
      createVersion(repository, TENANT_B, 'wf-001', 1);

      expect(repository.getWorkflowVersions('wf-001', TENANT_A)).toHaveLength(1);
      expect(repository.getWorkflowVersions('wf-001', TENANT_B)).toHaveLength(1);
      expect(repository.getWorkflowVersionCount('wf-001', TENANT_A)).toBe(1);
    });

    it('does not let one tenant delete another tenant\'s version', () => {
      const idA = createVersion(repository, TENANT_A, 'wf-001', 1);

      // Wrong tenant deletes nothing.
      expect(repository.deleteWorkflowVersion(idA, TENANT_B)).toBe(0);
      expect(repository.getWorkflowVersion(idA, TENANT_A)).not.toBeNull();

      // Owner deletes its own.
      expect(repository.deleteWorkflowVersion(idA, TENANT_A)).toBe(1);
      expect(repository.getWorkflowVersion(idA, TENANT_A)).toBeNull();
    });

    it('scopes deleteAll by tenant', () => {
      createVersion(repository, TENANT_A, 'wf-001', 1);
      createVersion(repository, TENANT_A, 'wf-001', 2);
      createVersion(repository, TENANT_B, 'wf-001', 1);

      const deleted = repository.deleteWorkflowVersionsByWorkflowId('wf-001', TENANT_A);
      expect(deleted).toBe(2);
      // Tenant B's backup survives.
      expect(repository.getWorkflowVersionCount('wf-001', TENANT_B)).toBe(1);
    });

    it('allows the same workflow_id + version_number across tenants', () => {
      // Per-tenant version numbering: the UNIQUE constraint includes instance_id.
      expect(() => {
        createVersion(repository, TENANT_A, 'wf-001', 1);
        createVersion(repository, TENANT_B, 'wf-001', 1);
      }).not.toThrow();
    });

    it('scopes storage stats by tenant', () => {
      createVersion(repository, TENANT_A, 'wf-001', 1);
      createVersion(repository, TENANT_B, 'wf-002', 1);

      const statsA = repository.getVersionStorageStats(TENANT_A);
      expect(statsA.totalVersions).toBe(1);
      expect(statsA.byWorkflow.map((w: any) => w.workflowId)).toEqual(['wf-001']);
    });
  });

  describe('age-based retention sweep', () => {
    let testDb: TestDatabase;
    let repository: NodeRepository;
    let rawDb: Database.Database;

    beforeEach(async () => {
      testDb = new TestDatabase({ mode: 'memory' });
      rawDb = await testDb.initialize();
      repository = new NodeRepository(createTestDatabaseAdapter(rawDb));
    });

    afterEach(async () => {
      await testDb.cleanup();
    });

    it('deletes only rows older than the cutoff, across all tenants', () => {
      createVersion(repository, TENANT_A, 'wf-001', 1);
      // Backdate one row well past any retention window.
      rawDb.prepare(`UPDATE workflow_versions SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`)
        .run(createVersion(repository, TENANT_B, 'wf-002', 1));

      const cutoff = new Date('2001-01-01T00:00:00.000Z').toISOString();
      const removed = repository.deleteWorkflowVersionsOlderThan(cutoff);

      expect(removed).toBe(1);
      expect(repository.getWorkflowVersionCount('wf-001', TENANT_A)).toBe(1);
      expect(repository.getWorkflowVersionCount('wf-002', TENANT_B)).toBe(0);
    });
  });

  describe('migration from legacy (un-tenanted) schema', () => {
    let rawDb: Database.Database;
    let adapter: DatabaseAdapter;

    beforeEach(() => {
      rawDb = new Database(':memory:');
      // Recreate the pre-fix schema (no instance_id, old UNIQUE constraint).
      rawDb.exec(`
        CREATE TABLE workflow_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_id TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          workflow_name TEXT NOT NULL,
          workflow_snapshot TEXT NOT NULL,
          trigger TEXT NOT NULL,
          operations TEXT,
          fix_types TEXT,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(workflow_id, version_number)
        );
      `);
      rawDb.prepare(`
        INSERT INTO workflow_versions (workflow_id, version_number, workflow_name, workflow_snapshot, trigger)
        VALUES (?, ?, ?, ?, ?)
      `).run('legacy-wf', 1, 'Legacy', '{}', 'partial_update');
      adapter = createTestDatabaseAdapter(rawDb);
    });

    afterEach(() => {
      rawDb.close();
    });

    it('adds the instance_id column and purges legacy rows', () => {
      const before = rawDb.prepare('PRAGMA table_info(workflow_versions)').all() as Array<{ name: string }>;
      expect(before.some((c) => c.name === 'instance_id')).toBe(false);

      const changed = migrateWorkflowVersionsInstanceId(adapter);
      expect(changed).toBe(true);

      const after = rawDb.prepare('PRAGMA table_info(workflow_versions)').all() as Array<{ name: string }>;
      expect(after.some((c) => c.name === 'instance_id')).toBe(true);

      // Legacy, cross-tenant-readable rows are purged.
      const count = rawDb.prepare('SELECT COUNT(*) as c FROM workflow_versions').get() as { c: number };
      expect(count.c).toBe(0);
    });

    it('is idempotent (no-op once migrated)', () => {
      expect(migrateWorkflowVersionsInstanceId(adapter)).toBe(true);
      expect(migrateWorkflowVersionsInstanceId(adapter)).toBe(false);
    });

    it('enforces per-tenant uniqueness after migration', () => {
      migrateWorkflowVersionsInstanceId(adapter);
      const repo = new NodeRepository(adapter);

      // Same (workflow_id, version_number) is allowed for different tenants...
      expect(() => {
        createVersion(repo, TENANT_A, 'wf-001', 1);
        createVersion(repo, TENANT_B, 'wf-001', 1);
      }).not.toThrow();

      // ...but a duplicate within one tenant violates the scoped UNIQUE.
      expect(() => createVersion(repo, TENANT_A, 'wf-001', 1)).toThrow();
    });
  });
});
