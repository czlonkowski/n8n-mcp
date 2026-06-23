import { ToolDocumentation } from '../types';

export const n8nWorkflowVersionsDoc: ToolDocumentation = {
  name: 'n8n_workflow_versions',
  category: 'workflow_management',
  essentials: {
    description: 'Manage workflow version history, rollback to previous versions, and cleanup old versions',
    keyParameters: ['mode', 'workflowId', 'versionId'],
    example: 'n8n_workflow_versions({mode: "list", workflowId: "abc123"})',
    performance: 'Fast for list/get (~100ms), moderate for rollback (~200-500ms)',
    tips: [
      'Use mode="list" to see all saved versions before rollback',
      'Rollback creates a backup version automatically',
      'Use prune to clean up old versions and save storage',
      'Versions are scoped to your n8n instance; you only ever see your own',
      'Old backups are pruned automatically (10 per workflow + an age-based retention window)'
    ]
  },
  full: {
    description: `Comprehensive workflow version management system. Supports five operations:

**list** - Show version history for a workflow
- Returns all saved versions with timestamps, snapshot sizes, and metadata
- Use limit parameter to control how many versions to return

**get** - Get details of a specific version
- Returns the complete workflow snapshot from that version
- Use to compare versions or extract old configurations

**rollback** - Restore workflow to a previous version
- Creates a backup of the current workflow before rollback
- Optionally validates the workflow structure before applying
- Returns the restored workflow and backup version ID

**delete** - Delete specific version(s)
- Delete a single version by versionId
- Delete all versions for a workflow with deleteAll: true

**prune** - Clean up old versions
- Keeps only the N most recent versions (default: 10)
- Useful for managing storage and keeping history manageable

All version operations are scoped to your n8n instance — you can only see and act on backups created
under your own credentials. Old backups are also removed automatically (10 most recent per workflow,
plus an age-based retention window).`,
    parameters: {
      mode: {
        type: 'string',
        required: true,
        description: 'Operation mode: "list", "get", "rollback", "delete", or "prune"',
        enum: ['list', 'get', 'rollback', 'delete', 'prune']
      },
      workflowId: {
        type: 'string',
        required: false,
        description: 'Workflow ID (required for list, rollback, delete, prune modes)'
      },
      versionId: {
        type: 'number',
        required: false,
        description: 'Version ID (required for get mode, optional for rollback to specific version, required for single delete)'
      },
      limit: {
        type: 'number',
        required: false,
        default: 10,
        description: 'Maximum versions to return in list mode'
      },
      validateBefore: {
        type: 'boolean',
        required: false,
        default: true,
        description: 'Validate workflow structure before rollback (rollback mode only)'
      },
      deleteAll: {
        type: 'boolean',
        required: false,
        default: false,
        description: 'Delete all versions for workflow (delete mode only)'
      },
      maxVersions: {
        type: 'number',
        required: false,
        default: 10,
        description: 'Keep N most recent versions (prune mode only)'
      }
    },
    returns: `Response varies by mode:

**list mode:**
- versions: Array of version objects with id, workflowId, snapshotSize, createdAt
- totalCount: Total number of versions

**get mode:**
- version: Complete version object including workflow snapshot

**rollback mode:**
- success: Boolean indicating success
- restoredVersion: The version that was restored
- backupVersionId: ID of the backup created before rollback

**delete mode:**
- deletedCount: Number of versions deleted

**prune mode:**
- prunedCount: Number of old versions removed
- remainingCount: Number of versions kept`,
    examples: [
      '// List version history\nn8n_workflow_versions({mode: "list", workflowId: "abc123", limit: 5})',
      '// Get specific version details\nn8n_workflow_versions({mode: "get", versionId: 42})',
      '// Rollback to latest saved version\nn8n_workflow_versions({mode: "rollback", workflowId: "abc123"})',
      '// Rollback to specific version\nn8n_workflow_versions({mode: "rollback", workflowId: "abc123", versionId: 42})',
      '// Delete specific version\nn8n_workflow_versions({mode: "delete", workflowId: "abc123", versionId: 42})',
      '// Delete all versions for workflow\nn8n_workflow_versions({mode: "delete", workflowId: "abc123", deleteAll: true})',
      '// Prune to keep only 5 most recent\nn8n_workflow_versions({mode: "prune", workflowId: "abc123", maxVersions: 5})'
    ],
    useCases: [
      'Recover from accidental workflow changes',
      'Compare workflow versions to understand changes',
      'Maintain audit trail of workflow modifications',
      'Clean up old versions to save database storage',
      'Roll back failed workflow deployments'
    ],
    performance: `Performance varies by operation:
- list: Fast (~100ms) - simple database query
- get: Fast (~100ms) - single row retrieval
- rollback: Moderate (~200-500ms) - includes backup creation and workflow update
- delete: Fast (~50-100ms) - database delete operation
- prune: Moderate (~100-300ms) - depends on number of versions to delete`,
    modeComparison: `| Mode | Required Params | Optional Params | Risk Level |
|------|-----------------|-----------------|------------|
| list | workflowId | limit | Low |
| get | versionId | - | Low |
| rollback | workflowId | versionId, validateBefore | Medium |
| delete | workflowId | versionId, deleteAll | High |
| prune | workflowId | maxVersions | Medium |`,
    bestPractices: [
      'Always list versions before rollback to pick the right one',
      'Enable validateBefore for rollback to catch structural issues',
      'Use prune regularly to keep version history manageable',
      'Document why you are rolling back for audit purposes'
    ],
    pitfalls: [
      'Rollback overwrites current workflow - backup is created automatically',
      'Deleted versions cannot be recovered',
      'Version operations are scoped to your instance - versions from other instances are not visible',
      'Version IDs are sequential but may have gaps after deletes',
      'Large workflows may have significant version storage overhead'
    ],
    relatedTools: [
      'n8n_get_workflow - View current workflow state',
      'n8n_update_partial_workflow - Make incremental changes',
      'n8n_validate_workflow - Validate before deployment'
    ]
  }
};
