import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabase, createTestDatabaseAdapter } from '../database/test-utils';
import { NodeRepository } from '../../../src/database/node-repository';
import { WorkflowVersioningService } from '../../../src/services/workflow-versioning-service';
import { handleWorkflowVersions } from '../../../src/mcp/handlers-n8n-manager';
import { getInstanceScopeId, type InstanceContext } from '../../../src/types/instance-context';

/**
 * End-to-end regression for GHSA-j6r7-6fhx-77wx, mirroring the advisory PoC:
 * two tenants on one shared n8n-mcp instance must not be able to read, list,
 * or delete each other's workflow version backups.
 */
describe('GHSA-j6r7-6fhx-77wx: n8n_workflow_versions cross-tenant isolation', () => {
  const contextA: InstanceContext = {
    n8nApiUrl: 'https://tenant-a.example.com',
    n8nApiKey: 'n8n_api_key_tenant_a_0123456789'
  };
  const contextB: InstanceContext = {
    n8nApiUrl: 'https://tenant-b.example.com',
    n8nApiKey: 'n8n_api_key_tenant_b_0123456789'
  };

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

  // Tenant A creates a backup through the normal versioning code path.
  async function seedTenantABackup(): Promise<number> {
    const service = new WorkflowVersioningService(repository, undefined, getInstanceScopeId(contextA));
    const result = await service.createBackup(
      'wf-001',
      { name: 'Tenant-A-Confidential', nodes: [], connections: {}, settings: {} },
      { trigger: 'partial_update' }
    );
    return result.versionId;
  }

  it('lets the owning tenant read its own version (control)', async () => {
    const versionId = await seedTenantABackup();

    const res = await handleWorkflowVersions({ mode: 'get', versionId }, repository, contextA);
    expect(res.success).toBe(true);
    expect((res.data as any).workflowName).toBe('Tenant-A-Confidential');
  });

  it('does NOT let another tenant read the version (get)', async () => {
    const versionId = await seedTenantABackup();

    const res = await handleWorkflowVersions({ mode: 'get', versionId }, repository, contextB);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  it('does NOT let another tenant list the version history', async () => {
    await seedTenantABackup();

    const res = await handleWorkflowVersions({ mode: 'list', workflowId: 'wf-001' }, repository, contextB);
    expect(res.success).toBe(true);
    expect((res.data as any).count).toBe(0);
  });

  it('does NOT let another tenant delete the version', async () => {
    const versionId = await seedTenantABackup();

    const res = await handleWorkflowVersions({ mode: 'delete', versionId }, repository, contextB);
    expect(res.success).toBe(false);

    // Owner's backup still intact.
    const owner = await handleWorkflowVersions({ mode: 'get', versionId }, repository, contextA);
    expect(owner.success).toBe(true);
  });

  it('no longer exposes the global truncate mode', async () => {
    const res = await handleWorkflowVersions({ mode: 'truncate', confirmTruncate: true } as any, repository, contextA);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid input');
  });
});

/**
 * GHSA-2cf7-hpwf-47h9: in multi-tenant mode the handler must fail closed when
 * the request-derived context maps to the empty default scope, so default-scope
 * backups stay unreachable through n8n_workflow_versions.
 */
describe('GHSA-2cf7-hpwf-47h9: default-scope fail-closed in multi-tenant mode', () => {
  // A partial context (url without key) derives the empty default scope.
  const partialContext: InstanceContext = {
    n8nApiUrl: 'https://tenant-a.example.com'
  };

  let testDb: TestDatabase;
  let repository: NodeRepository;
  let originalMultiTenant: string | undefined;

  beforeEach(async () => {
    originalMultiTenant = process.env.ENABLE_MULTI_TENANT;
    process.env.ENABLE_MULTI_TENANT = 'true';
    testDb = new TestDatabase({ mode: 'memory' });
    const db = await testDb.initialize();
    repository = new NodeRepository(createTestDatabaseAdapter(db));
  });

  afterEach(async () => {
    if (originalMultiTenant === undefined) {
      delete process.env.ENABLE_MULTI_TENANT;
    } else {
      process.env.ENABLE_MULTI_TENANT = originalMultiTenant;
    }
    await testDb.cleanup();
  });

  // Seed a backup in the empty default scope.
  async function seedDefaultScopeBackup(): Promise<number> {
    const service = new WorkflowVersioningService(repository, undefined, getInstanceScopeId(undefined));
    const result = await service.createBackup(
      'wf-default',
      { name: 'Default-Scope-Backup', nodes: [], connections: {}, settings: {} },
      { trigger: 'partial_update' }
    );
    return result.versionId;
  }

  it('refuses get for a partial context', async () => {
    const versionId = await seedDefaultScopeBackup();

    const res = await handleWorkflowVersions({ mode: 'get', versionId }, repository, partialContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not available for this tenant context');
  });

  it('refuses list for a partial context', async () => {
    await seedDefaultScopeBackup();

    const res = await handleWorkflowVersions({ mode: 'list', workflowId: 'wf-default' }, repository, partialContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not available for this tenant context');
  });

  it('refuses delete for a partial context and leaves the backup intact', async () => {
    const versionId = await seedDefaultScopeBackup();

    const res = await handleWorkflowVersions({ mode: 'delete', versionId }, repository, partialContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not available for this tenant context');

    // The default-scope backup is still present after the refused delete.
    const service = new WorkflowVersioningService(repository, undefined, getInstanceScopeId(undefined));
    const version = await service.getVersion(versionId);
    expect(version).not.toBeNull();
  });
});
