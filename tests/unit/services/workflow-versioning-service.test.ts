import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowVersioningService, type WorkflowVersion, type BackupResult } from '@/services/workflow-versioning-service';
import { NodeRepository } from '@/database/node-repository';
import { N8nApiClient } from '@/services/n8n-api-client';
import { WorkflowValidator } from '@/services/workflow-validator';
import type { Workflow } from '@/types/n8n-api';

vi.mock('@/database/node-repository');
vi.mock('@/services/n8n-api-client');
vi.mock('@/services/workflow-validator');

describe('WorkflowVersioningService', () => {
  let service: WorkflowVersioningService;
  let mockRepository: NodeRepository;
  let mockApiClient: N8nApiClient;

  const createMockWorkflow = (id: string, name: string, nodes: any[] = []): Workflow => ({
    id,
    name,
    active: false,
    nodes,
    connections: {},
    settings: {},
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  });

  const createMockVersion = (versionNumber: number): WorkflowVersion => ({
    id: versionNumber,
    workflowId: 'workflow-1',
    versionNumber,
    workflowName: 'Test Workflow',
    workflowSnapshot: createMockWorkflow('workflow-1', 'Test Workflow'),
    trigger: 'partial_update',
    createdAt: '2025-01-01T00:00:00.000Z'
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = new NodeRepository({} as any);
    mockApiClient = new N8nApiClient({ baseUrl: 'http://test', apiKey: 'test-key' });
    service = new WorkflowVersioningService(mockRepository, mockApiClient);
  });

  describe('createBackup', () => {
    it('should create a backup with version 1 for new workflow', async () => {
      const workflow = createMockWorkflow('workflow-1', 'Test Workflow');

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(1);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);

      const result = await service.createBackup('workflow-1', workflow, {
        trigger: 'partial_update'
      });

      expect(result.versionId).toBe(1);
      expect(result.versionNumber).toBe(1);
      expect(result.pruned).toBe(0);
      expect(result.message).toContain('Backup created (version 1)');
    });

    it('should increment version number from latest version', async () => {
      const workflow = createMockWorkflow('workflow-1', 'Test Workflow');
      const existingVersions = [createMockVersion(3), createMockVersion(2)];

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue(existingVersions);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(4);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);

      const result = await service.createBackup('workflow-1', workflow, {
        trigger: 'full_update'
      });

      expect(result.versionNumber).toBe(4);
      expect(mockRepository.createWorkflowVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 4
        })
      );
    });

    it('should include context in version metadata', async () => {
      const workflow = createMockWorkflow('workflow-1', 'Test Workflow');

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(1);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);

      await service.createBackup('workflow-1', workflow, {
        trigger: 'autofix',
        operations: [{ type: 'updateNode', nodeId: 'node-1' }],
        fixTypes: ['expression-format'],
        metadata: { testKey: 'testValue' }
      });

      expect(mockRepository.createWorkflowVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'autofix',
          operations: [{ type: 'updateNode', nodeId: 'node-1' }],
          fixTypes: ['expression-format'],
          metadata: { testKey: 'testValue' }
        })
      );
    });

    it('should auto-prune to 10 versions and report pruned count', async () => {
      const workflow = createMockWorkflow('workflow-1', 'Test Workflow');

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([createMockVersion(1)]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(2);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(3);

      const result = await service.createBackup('workflow-1', workflow, {
        trigger: 'partial_update'
      });

      expect(mockRepository.pruneWorkflowVersions).toHaveBeenCalledWith('workflow-1', 10, '');
      expect(result.pruned).toBe(3);
      expect(result.message).toContain('pruned 3 old version(s)');
    });
  });

  describe('getVersionHistory', () => {
    it('should return formatted version history', async () => {
      const versions = [
        createMockVersion(3),
        createMockVersion(2),
        createMockVersion(1)
      ];

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue(versions);

      const result = await service.getVersionHistory('workflow-1', 10);

      expect(result).toHaveLength(3);
      expect(result[0].versionNumber).toBe(3);
      expect(result[0].workflowId).toBe('workflow-1');
      expect(result[0].size).toBeGreaterThan(0);
    });

    it('should include operation count when operations exist', async () => {
      const versionWithOps: WorkflowVersion = {
        ...createMockVersion(1),
        operations: [{ type: 'updateNode' }, { type: 'addNode' }]
      };

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([versionWithOps]);

      const result = await service.getVersionHistory('workflow-1', 10);

      expect(result[0].operationCount).toBe(2);
    });

    it('should include fixTypes when present', async () => {
      const versionWithFixes: WorkflowVersion = {
        ...createMockVersion(1),
        fixTypes: ['expression-format', 'typeversion-correction']
      };

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([versionWithFixes]);

      const result = await service.getVersionHistory('workflow-1', 10);

      expect(result[0].fixTypesApplied).toEqual(['expression-format', 'typeversion-correction']);
    });

    it('should respect the limit parameter', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);

      await service.getVersionHistory('workflow-1', 5);

      expect(mockRepository.getWorkflowVersions).toHaveBeenCalledWith('workflow-1', '', 5);
    });
  });

  describe('getVersion', () => {
    it('should return the requested version', async () => {
      const version = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(version);

      const result = await service.getVersion(1);

      expect(result).toEqual(version);
    });

    it('should return null if version does not exist', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(null);

      const result = await service.getVersion(999);

      expect(result).toBeNull();
    });
  });

  describe('restoreVersion', () => {
    it('should fail if API client is not configured', async () => {
      const serviceWithoutApi = new WorkflowVersioningService(mockRepository);

      const result = await serviceWithoutApi.restoreVersion('workflow-1', 1);

      expect(result.success).toBe(false);
      expect(result.message).toContain('API client not configured');
      expect(result.backupCreated).toBe(false);
    });

    it('should fail if version does not exist', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(null);

      const result = await service.restoreVersion('workflow-1', 999);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Version 999 not found');
      expect(result.backupCreated).toBe(false);
    });

    it('should restore latest version when no versionId provided', async () => {
      const version = createMockVersion(3);
      vi.spyOn(mockRepository, 'getLatestWorkflowVersion').mockReturnValue(version);
      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(4);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockApiClient, 'getWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Current'));
      vi.spyOn(mockApiClient, 'updateWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Restored'));

      const result = await service.restoreVersion('workflow-1', undefined, false);

      expect(mockRepository.getLatestWorkflowVersion).toHaveBeenCalledWith('workflow-1', '');
      expect(result.success).toBe(true);
    });

    it('should fail if no backup versions exist and no versionId provided', async () => {
      vi.spyOn(mockRepository, 'getLatestWorkflowVersion').mockReturnValue(null);

      const result = await service.restoreVersion('workflow-1', undefined);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No backup versions found');
    });

    it('should validate version before restore when validateBefore is true', async () => {
      const version = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(version);

      const mockValidator = {
        validateWorkflow: vi.fn().mockResolvedValue({
          errors: [{ message: 'Validation error' }]
        })
      };
      vi.spyOn(WorkflowValidator.prototype, 'validateWorkflow').mockImplementation(
        mockValidator.validateWorkflow
      );

      const result = await service.restoreVersion('workflow-1', 1, true);

      expect(result.success).toBe(false);
      expect(result.message).toContain('has validation errors');
      expect(result.validationErrors).toEqual(['Validation error']);
      expect(result.backupCreated).toBe(false);
    });

    it('should skip validation when validateBefore is false', async () => {
      const version = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(version);
      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(2);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockApiClient, 'getWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Current'));
      vi.spyOn(mockApiClient, 'updateWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Restored'));

      const mockValidator = vi.fn();
      vi.spyOn(WorkflowValidator.prototype, 'validateWorkflow').mockImplementation(mockValidator);

      await service.restoreVersion('workflow-1', 1, false);

      expect(mockValidator).not.toHaveBeenCalled();
    });

    it('should create backup before restoring', async () => {
      const versionToRestore = createMockVersion(1);
      const currentWorkflow = createMockWorkflow('workflow-1', 'Current Workflow');

      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(versionToRestore);
      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([createMockVersion(2)]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(3);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockApiClient, 'getWorkflow').mockResolvedValue(currentWorkflow);
      vi.spyOn(mockApiClient, 'updateWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Restored'));

      const result = await service.restoreVersion('workflow-1', 1, false);

      expect(mockApiClient.getWorkflow).toHaveBeenCalledWith('workflow-1');
      expect(mockRepository.createWorkflowVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowSnapshot: currentWorkflow,
          metadata: expect.objectContaining({
            reason: 'Backup before rollback',
            restoringToVersion: 1
          })
        })
      );
      expect(result.backupCreated).toBe(true);
      expect(result.backupVersionId).toBe(3);
    });

    it('should fail if backup creation fails', async () => {
      const version = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(version);
      vi.spyOn(mockApiClient, 'getWorkflow').mockRejectedValue(new Error('Backup failed'));

      const result = await service.restoreVersion('workflow-1', 1, false);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to create backup before restore');
      expect(result.backupCreated).toBe(false);
    });

    it('should successfully restore workflow', async () => {
      const versionToRestore = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(versionToRestore);
      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([createMockVersion(2)]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(3);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockApiClient, 'getWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Current'));
      vi.spyOn(mockApiClient, 'updateWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Restored'));

      const result = await service.restoreVersion('workflow-1', 1, false);

      expect(mockApiClient.updateWorkflow).toHaveBeenCalledWith('workflow-1', versionToRestore.workflowSnapshot);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully restored workflow to version 1');
      expect(result.fromVersion).toBe(3);
      expect(result.toVersionId).toBe(1);
    });

    it('should handle restore API failures', async () => {
      const version = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(version);
      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(2);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockApiClient, 'getWorkflow').mockResolvedValue(createMockWorkflow('workflow-1', 'Current'));
      vi.spyOn(mockApiClient, 'updateWorkflow').mockRejectedValue(new Error('API Error'));

      const result = await service.restoreVersion('workflow-1', 1, false);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to restore workflow');
      expect(result.backupCreated).toBe(true);
      expect(result.backupVersionId).toBe(2);
    });
  });

  describe('deleteVersion', () => {
    it('should delete a specific version', async () => {
      const version = createMockVersion(1);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(version);
      vi.spyOn(mockRepository, 'deleteWorkflowVersion').mockReturnValue(1);

      const result = await service.deleteVersion(1);

      expect(mockRepository.deleteWorkflowVersion).toHaveBeenCalledWith(1, '');
      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted version 1');
    });

    it('should fail if version does not exist', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(null);

      const result = await service.deleteVersion(999);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Version 999 not found');
    });
  });

  describe('deleteAllVersions', () => {
    it('should delete all versions for a workflow', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersionCount').mockReturnValue(5);
      vi.spyOn(mockRepository, 'deleteWorkflowVersionsByWorkflowId').mockReturnValue(5);

      const result = await service.deleteAllVersions('workflow-1');

      expect(result.deleted).toBe(5);
      expect(result.message).toContain('Deleted 5 version(s)');
    });

    it('should return zero if no versions exist', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersionCount').mockReturnValue(0);

      const result = await service.deleteAllVersions('workflow-1');

      expect(result.deleted).toBe(0);
      expect(result.message).toContain('No versions found');
    });
  });

  describe('pruneVersions', () => {
    it('should prune versions and return counts', async () => {
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(3);
      vi.spyOn(mockRepository, 'getWorkflowVersionCount').mockReturnValue(10);

      const result = await service.pruneVersions('workflow-1', 10);

      expect(result.pruned).toBe(3);
      expect(result.remaining).toBe(10);
    });

    it('should use custom maxVersions parameter', async () => {
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockRepository, 'getWorkflowVersionCount').mockReturnValue(5);

      await service.pruneVersions('workflow-1', 5);

      expect(mockRepository.pruneWorkflowVersions).toHaveBeenCalledWith('workflow-1', 5, '');
    });
  });

  describe('tenant scoping (GHSA-j6r7-6fhx-77wx)', () => {
    it('passes the configured instance scope to every repository call', async () => {
      const scoped = new WorkflowVersioningService(mockRepository, mockApiClient, 'tenant-a');
      const workflow = createMockWorkflow('workflow-1', 'Test Workflow');

      vi.spyOn(mockRepository, 'getWorkflowVersions').mockReturnValue([]);
      vi.spyOn(mockRepository, 'createWorkflowVersion').mockReturnValue(1);
      vi.spyOn(mockRepository, 'pruneWorkflowVersions').mockReturnValue(0);
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(null);
      vi.spyOn(mockRepository, 'getWorkflowVersionCount').mockReturnValue(0);
      vi.spyOn(mockRepository, 'deleteWorkflowVersionsByWorkflowId').mockReturnValue(0);
      vi.spyOn(mockRepository, 'getVersionStorageStats').mockReturnValue({ totalVersions: 0, totalSize: 0, byWorkflow: [] });

      await scoped.createBackup('workflow-1', workflow, { trigger: 'partial_update' });
      await scoped.getVersionHistory('workflow-1', 5);
      await scoped.getVersion(42);
      await scoped.deleteAllVersions('workflow-1');
      await scoped.getStorageStats();

      expect(mockRepository.getWorkflowVersions).toHaveBeenCalledWith('workflow-1', 'tenant-a', 1);
      expect(mockRepository.createWorkflowVersion).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: 'tenant-a' })
      );
      expect(mockRepository.pruneWorkflowVersions).toHaveBeenCalledWith('workflow-1', 10, 'tenant-a');
      expect(mockRepository.getWorkflowVersions).toHaveBeenCalledWith('workflow-1', 'tenant-a', 5);
      expect(mockRepository.getWorkflowVersion).toHaveBeenCalledWith(42, 'tenant-a');
      expect(mockRepository.getWorkflowVersionCount).toHaveBeenCalledWith('workflow-1', 'tenant-a');
      expect(mockRepository.getVersionStorageStats).toHaveBeenCalledWith('tenant-a');
    });
  });

  describe('getStorageStats', () => {
    it('should return formatted storage statistics', async () => {
      const mockStats = {
        totalVersions: 10,
        totalSize: 1024000,
        byWorkflow: [
          {
            workflowId: 'workflow-1',
            workflowName: 'Test Workflow',
            versionCount: 5,
            totalSize: 512000,
            lastBackup: '2025-01-01T00:00:00.000Z'
          }
        ]
      };

      vi.spyOn(mockRepository, 'getVersionStorageStats').mockReturnValue(mockStats);

      const result = await service.getStorageStats();

      expect(result.totalVersions).toBe(10);
      expect(result.totalSizeFormatted).toContain('KB');
      expect(result.byWorkflow).toHaveLength(1);
      expect(result.byWorkflow[0].totalSizeFormatted).toContain('KB');
    });

    it('should format bytes correctly', async () => {
      const mockStats = {
        totalVersions: 1,
        totalSize: 0,
        byWorkflow: []
      };

      vi.spyOn(mockRepository, 'getVersionStorageStats').mockReturnValue(mockStats);

      const result = await service.getStorageStats();

      expect(result.totalSizeFormatted).toBe('0 Bytes');
    });
  });

  describe('compareVersions', () => {
    it('should detect added nodes', async () => {
      const v1 = createMockVersion(1);
      v1.workflowSnapshot.nodes = [{ id: 'node-1', name: 'Node 1', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} }];

      const v2 = createMockVersion(2);
      v2.workflowSnapshot.nodes = [
        { id: 'node-1', name: 'Node 1', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'node-2', name: 'Node 2', type: 'test', typeVersion: 1, position: [100, 0], parameters: {} }
      ];

      vi.spyOn(mockRepository, 'getWorkflowVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await service.compareVersions(1, 2);

      expect(result.addedNodes).toEqual(['node-2']);
      expect(result.removedNodes).toEqual([]);
      expect(result.modifiedNodes).toEqual([]);
    });

    it('should detect removed nodes', async () => {
      const v1 = createMockVersion(1);
      v1.workflowSnapshot.nodes = [
        { id: 'node-1', name: 'Node 1', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} },
        { id: 'node-2', name: 'Node 2', type: 'test', typeVersion: 1, position: [100, 0], parameters: {} }
      ];

      const v2 = createMockVersion(2);
      v2.workflowSnapshot.nodes = [{ id: 'node-1', name: 'Node 1', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} }];

      vi.spyOn(mockRepository, 'getWorkflowVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await service.compareVersions(1, 2);

      expect(result.removedNodes).toEqual(['node-2']);
      expect(result.addedNodes).toEqual([]);
    });

    it('should detect modified nodes', async () => {
      const v1 = createMockVersion(1);
      v1.workflowSnapshot.nodes = [{ id: 'node-1', name: 'Node 1', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} }];

      const v2 = createMockVersion(2);
      v2.workflowSnapshot.nodes = [{ id: 'node-1', name: 'Node 1', type: 'test', typeVersion: 2, position: [0, 0], parameters: {} }];

      vi.spyOn(mockRepository, 'getWorkflowVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await service.compareVersions(1, 2);

      expect(result.modifiedNodes).toEqual(['node-1']);
    });

    it('should detect connection changes', async () => {
      const v1 = createMockVersion(1);
      v1.workflowSnapshot.connections = { 'node-1': { main: [[{ node: 'node-2', type: 'main', index: 0 }]] } };

      const v2 = createMockVersion(2);
      v2.workflowSnapshot.connections = {};

      vi.spyOn(mockRepository, 'getWorkflowVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await service.compareVersions(1, 2);

      expect(result.connectionChanges).toBe(1);
    });

    it('should detect settings changes', async () => {
      const v1 = createMockVersion(1);
      v1.workflowSnapshot.settings = { executionOrder: 'v0' };

      const v2 = createMockVersion(2);
      v2.workflowSnapshot.settings = { executionOrder: 'v1' };

      vi.spyOn(mockRepository, 'getWorkflowVersion')
        .mockReturnValueOnce(v1)
        .mockReturnValueOnce(v2);

      const result = await service.compareVersions(1, 2);

      expect(result.settingChanges).toHaveProperty('executionOrder');
      expect(result.settingChanges.executionOrder.before).toBe('v0');
      expect(result.settingChanges.executionOrder.after).toBe('v1');
    });

    it('should throw error if version not found', async () => {
      vi.spyOn(mockRepository, 'getWorkflowVersion').mockReturnValue(null);

      await expect(service.compareVersions(1, 2)).rejects.toThrow('One or both versions not found');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes to human-readable string', () => {
      // Access private method through any cast
      const formatBytes = (service as any).formatBytes.bind(service);

      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(500)).toBe('500 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });
  });

  describe('diffObjects', () => {
    it('should detect object differences', () => {
      const diffObjects = (service as any).diffObjects.bind(service);

      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 3, c: 4 };

      const diff = diffObjects(obj1, obj2);

      expect(diff).toHaveProperty('b');
      expect(diff.b).toEqual({ before: 2, after: 3 });
      expect(diff).toHaveProperty('c');
      expect(diff.c).toEqual({ before: undefined, after: 4 });
    });

    it('should return empty object when no differences', () => {
      const diffObjects = (service as any).diffObjects.bind(service);

      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 2 };

      const diff = diffObjects(obj1, obj2);

      expect(Object.keys(diff)).toHaveLength(0);
    });
  });
});
