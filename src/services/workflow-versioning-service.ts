/**
 * Workflow Versioning Service
 *
 * Provides workflow backup, versioning, rollback, and cleanup capabilities.
 * Automatically prunes to 10 versions per workflow to prevent memory leaks.
 */

import { NodeRepository } from '../database/node-repository';
import { N8nApiClient } from './n8n-api-client';
import { WorkflowValidator } from './workflow-validator';
import { EnhancedConfigValidator } from './enhanced-config-validator';

export interface WorkflowVersion {
  id: number;
  workflowId: string;
  versionNumber: number;
  workflowName: string;
  workflowSnapshot: any;
  trigger: 'partial_update' | 'full_update' | 'autofix';
  operations?: any[];
  fixTypes?: string[];
  metadata?: any;
  createdAt: string;
}

export interface VersionInfo {
  id: number;
  workflowId: string;
  versionNumber: number;
  workflowName: string;
  trigger: string;
  operationCount?: number;
  fixTypesApplied?: string[];
  createdAt: string;
  size: number; // Size in bytes
}

export interface RestoreResult {
  success: boolean;
  message: string;
  workflowId: string;
  fromVersion?: number;
  toVersionId: number;
  backupCreated: boolean;
  backupVersionId?: number;
  validationErrors?: string[];
}

export interface BackupResult {
  versionId: number;
  versionNumber: number;
  pruned: number;
  message: string;
}

export interface StorageStats {
  totalVersions: number;
  totalSize: number;
  totalSizeFormatted: string;
  byWorkflow: WorkflowStorageInfo[];
}

export interface WorkflowStorageInfo {
  workflowId: string;
  workflowName: string;
  versionCount: number;
  totalSize: number;
  totalSizeFormatted: string;
  lastBackup: string;
}

export interface VersionDiff {
  versionId1: number;
  versionId2: number;
  version1Number: number;
  version2Number: number;
  addedNodes: string[];
  removedNodes: string[];
  modifiedNodes: string[];
  connectionChanges: number;
  settingChanges: any;
}

/**
 * Workflow Versioning Service
 */
export class WorkflowVersioningService {
  private readonly DEFAULT_MAX_VERSIONS = 10;

  constructor(
    private nodeRepository: NodeRepository,
    private apiClient?: N8nApiClient,
    // Tenant scope for all version operations (GHSA-j6r7-6fhx-77wx). Derived
    // via getInstanceScopeId; '' is the single tenant for single-user mode.
    private instanceId: string = ''
  ) {}

  /**
   * Create backup before modification
   * Automatically prunes to 10 versions after backup creation
   */
  async createBackup(
    workflowId: string,
    workflow: any,
    context: {
      trigger: 'partial_update' | 'full_update' | 'autofix';
      operations?: any[];
      fixTypes?: string[];
      metadata?: any;
    }
  ): Promise<BackupResult> {
    // Get current max version number
    const versions = this.nodeRepository.getWorkflowVersions(workflowId, this.instanceId, 1);
    const nextVersion = versions.length > 0 ? versions[0].versionNumber + 1 : 1;

    // Create new version
    const versionId = this.nodeRepository.createWorkflowVersion({
      instanceId: this.instanceId,
      workflowId,
      versionNumber: nextVersion,
      workflowName: workflow.name || 'Unnamed Workflow',
      workflowSnapshot: workflow,
      trigger: context.trigger,
      operations: context.operations,
      fixTypes: context.fixTypes,
      metadata: context.metadata
    });

    // Auto-prune to keep max 10 versions
    const pruned = this.nodeRepository.pruneWorkflowVersions(
      workflowId,
      this.DEFAULT_MAX_VERSIONS,
      this.instanceId
    );

    return {
      versionId,
      versionNumber: nextVersion,
      pruned,
      message: pruned > 0
        ? `Backup created (version ${nextVersion}), pruned ${pruned} old version(s)`
        : `Backup created (version ${nextVersion})`
    };
  }

  /**
   * Get version history for a workflow
   */
  async getVersionHistory(workflowId: string, limit: number = 10): Promise<VersionInfo[]> {
    const versions = this.nodeRepository.getWorkflowVersions(workflowId, this.instanceId, limit);

    return versions.map(v => ({
      id: v.id,
      workflowId: v.workflowId,
      versionNumber: v.versionNumber,
      workflowName: v.workflowName,
      trigger: v.trigger,
      operationCount: v.operations ? v.operations.length : undefined,
      fixTypesApplied: v.fixTypes || undefined,
      createdAt: v.createdAt,
      size: JSON.stringify(v.workflowSnapshot).length
    }));
  }

  /**
   * Get a specific workflow version
   */
  async getVersion(versionId: number): Promise<WorkflowVersion | null> {
    return this.nodeRepository.getWorkflowVersion(versionId, this.instanceId);
  }

  /**
   * Restore workflow to a previous version
   * Creates backup of current state before restoring
   */
  async restoreVersion(
    workflowId: string,
    versionId?: number,
    validateBefore: boolean = true
  ): Promise<RestoreResult> {
    if (!this.apiClient) {
      return {
        success: false,
        message: 'API client not configured - cannot restore workflow',
        workflowId,
        toVersionId: versionId || 0,
        backupCreated: false
      };
    }

    // Get the version to restore
    let versionToRestore: WorkflowVersion | null = null;

    if (versionId) {
      versionToRestore = this.nodeRepository.getWorkflowVersion(versionId, this.instanceId);
    } else {
      // Get latest backup
      versionToRestore = this.nodeRepository.getLatestWorkflowVersion(workflowId, this.instanceId);
    }

    if (!versionToRestore) {
      return {
        success: false,
        message: versionId
          ? `Version ${versionId} not found`
          : `No backup versions found for workflow ${workflowId}`,
        workflowId,
        toVersionId: versionId || 0,
        backupCreated: false
      };
    }

    // Validate workflow structure if requested
    if (validateBefore) {
      const validator = new WorkflowValidator(this.nodeRepository, EnhancedConfigValidator);
      const validationResult = await validator.validateWorkflow(
        versionToRestore.workflowSnapshot,
        {
          validateNodes: true,
          validateConnections: true,
          validateExpressions: false,
          profile: 'runtime'
        }
      );

      if (validationResult.errors.length > 0) {
        return {
          success: false,
          message: `Cannot restore - version ${versionToRestore.versionNumber} has validation errors`,
          workflowId,
          toVersionId: versionToRestore.id,
          backupCreated: false,
          validationErrors: validationResult.errors.map(e => e.message || 'Unknown error')
        };
      }
    }

    // Create backup of current workflow before restoring
    let backupResult: BackupResult | undefined;
    try {
      const currentWorkflow = await this.apiClient.getWorkflow(workflowId);
      backupResult = await this.createBackup(workflowId, currentWorkflow, {
        trigger: 'partial_update',
        metadata: {
          reason: 'Backup before rollback',
          restoringToVersion: versionToRestore.versionNumber
        }
      });
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to create backup before restore: ${error.message}`,
        workflowId,
        toVersionId: versionToRestore.id,
        backupCreated: false
      };
    }

    // Restore the workflow
    try {
      await this.apiClient.updateWorkflow(workflowId, versionToRestore.workflowSnapshot);

      return {
        success: true,
        message: `Successfully restored workflow to version ${versionToRestore.versionNumber}`,
        workflowId,
        fromVersion: backupResult.versionNumber,
        toVersionId: versionToRestore.id,
        backupCreated: true,
        backupVersionId: backupResult.versionId
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to restore workflow: ${error.message}`,
        workflowId,
        toVersionId: versionToRestore.id,
        backupCreated: true,
        backupVersionId: backupResult.versionId
      };
    }
  }

  /**
   * Delete a specific version
   */
  async deleteVersion(versionId: number): Promise<{ success: boolean; message: string }> {
    const version = this.nodeRepository.getWorkflowVersion(versionId, this.instanceId);

    if (!version) {
      return {
        success: false,
        message: `Version ${versionId} not found`
      };
    }

    this.nodeRepository.deleteWorkflowVersion(versionId, this.instanceId);

    return {
      success: true,
      message: `Deleted version ${version.versionNumber} for workflow ${version.workflowId}`
    };
  }

  /**
   * Delete all versions for a workflow
   */
  async deleteAllVersions(workflowId: string): Promise<{ deleted: number; message: string }> {
    const count = this.nodeRepository.getWorkflowVersionCount(workflowId, this.instanceId);

    if (count === 0) {
      return {
        deleted: 0,
        message: `No versions found for workflow ${workflowId}`
      };
    }

    const deleted = this.nodeRepository.deleteWorkflowVersionsByWorkflowId(workflowId, this.instanceId);

    return {
      deleted,
      message: `Deleted ${deleted} version(s) for workflow ${workflowId}`
    };
  }

  /**
   * Manually trigger pruning for a workflow
   */
  async pruneVersions(
    workflowId: string,
    maxVersions: number = 10
  ): Promise<{ pruned: number; remaining: number }> {
    const pruned = this.nodeRepository.pruneWorkflowVersions(workflowId, maxVersions, this.instanceId);
    const remaining = this.nodeRepository.getWorkflowVersionCount(workflowId, this.instanceId);

    return { pruned, remaining };
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    const stats = this.nodeRepository.getVersionStorageStats(this.instanceId);

    return {
      totalVersions: stats.totalVersions,
      totalSize: stats.totalSize,
      totalSizeFormatted: this.formatBytes(stats.totalSize),
      byWorkflow: stats.byWorkflow.map((w: any) => ({
        workflowId: w.workflowId,
        workflowName: w.workflowName,
        versionCount: w.versionCount,
        totalSize: w.totalSize,
        totalSizeFormatted: this.formatBytes(w.totalSize),
        lastBackup: w.lastBackup
      }))
    };
  }

  /**
   * Compare two versions
   */
  async compareVersions(versionId1: number, versionId2: number): Promise<VersionDiff> {
    const v1 = this.nodeRepository.getWorkflowVersion(versionId1, this.instanceId);
    const v2 = this.nodeRepository.getWorkflowVersion(versionId2, this.instanceId);

    if (!v1 || !v2) {
      throw new Error(`One or both versions not found: ${versionId1}, ${versionId2}`);
    }

    // Compare nodes
    const nodes1 = new Set<string>(v1.workflowSnapshot.nodes?.map((n: any) => n.id as string) || []);
    const nodes2 = new Set<string>(v2.workflowSnapshot.nodes?.map((n: any) => n.id as string) || []);

    const addedNodes: string[] = [...nodes2].filter(id => !nodes1.has(id));
    const removedNodes: string[] = [...nodes1].filter(id => !nodes2.has(id));
    const commonNodes = [...nodes1].filter(id => nodes2.has(id));

    // Check for modified nodes
    const modifiedNodes: string[] = [];
    for (const nodeId of commonNodes) {
      const node1 = v1.workflowSnapshot.nodes?.find((n: any) => n.id === nodeId);
      const node2 = v2.workflowSnapshot.nodes?.find((n: any) => n.id === nodeId);

      if (JSON.stringify(node1) !== JSON.stringify(node2)) {
        modifiedNodes.push(nodeId);
      }
    }

    // Compare connections
    const conn1Str = JSON.stringify(v1.workflowSnapshot.connections || {});
    const conn2Str = JSON.stringify(v2.workflowSnapshot.connections || {});
    const connectionChanges = conn1Str !== conn2Str ? 1 : 0;

    // Compare settings
    const settings1 = v1.workflowSnapshot.settings || {};
    const settings2 = v2.workflowSnapshot.settings || {};
    const settingChanges = this.diffObjects(settings1, settings2);

    return {
      versionId1,
      versionId2,
      version1Number: v1.versionNumber,
      version2Number: v2.versionNumber,
      addedNodes,
      removedNodes,
      modifiedNodes,
      connectionChanges,
      settingChanges
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Simple object diff
   */
  private diffObjects(obj1: any, obj2: any): any {
    const changes: any = {};

    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

    for (const key of allKeys) {
      if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
        changes[key] = {
          before: obj1[key],
          after: obj2[key]
        };
      }
    }

    return changes;
  }
}
