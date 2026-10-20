import { ToolDocumentation } from '../types';

export const n8nWorkflowVersionsDoc: ToolDocumentation = {
  name: 'n8n_workflow_versions',
  category: 'workflow_management',
  essentials: {
    description: 'Manage workflow version history: list, get, diff, roll back and clean up, from n8n-mcp snapshots (local) or n8n\'s own history (native)',
    keyParameters: ['mode', 'source', 'workflowId', 'versionId'],
    example: 'n8n_workflow_versions({mode: "list", workflowId: "abc123"})',
    performance: 'Fast for list/get (~100ms), moderate for rollback (~200-500ms); native modes add one round-trip to n8n\'s MCP server',
    tips: [
      'Use mode="list" to see all saved versions before rollback',
      'source="local" (default) only sees changes n8n-mcp made; source="native" also sees UI edits',
      'Rollback creates a backup version automatically (local only)',
      'Use prune to clean up old versions and save storage (local only)',
      'Versions are scoped to your n8n instance; you only ever see your own',
      'Old backups are pruned automatically (10 per workflow + an age-based retention window)'
    ]
  },
  full: {
    description: `Workflow version management over two independent histories.

**source: "local"** (default) - the snapshots n8n-mcp writes before it changes a workflow. Numbered
per workflow, scoped to your n8n instance, available on any n8n version, and blind to anything that
did not go through n8n-mcp (a person editing the workflow in the n8n UI leaves no local snapshot).
This is the only source that supports delete and prune.

**source: "native"** - n8n's own workflow history, the same list the n8n UI shows, read through the
instance-level MCP server. It covers every change, including UI edits by people, and n8n owns its
retention, so delete and prune are refused with MODE_NOT_SUPPORTED_FOR_SOURCE. Requires an n8n MCP
access token (N8N_MCP_ACCESS_TOKEN) and the workflow's "Available in MCP" setting; the version ids
are opaque strings, not numbers.

Mode by source:

| mode | local | native |
|------|-------|--------|
| list | yes | yes (limit capped at 50, offset supported) |
| get | yes | yes |
| rollback | yes, optionally validated first | yes, never validated first |
| diff | yes (format: "n8n-mcp") | yes (format: "n8n") |
| delete | yes | MODE_NOT_SUPPORTED_FOR_SOURCE |
| prune | yes | MODE_NOT_SUPPORTED_FOR_SOURCE |

**Diff formats differ by source.** Local diff (\`data.format: "n8n-mcp"\`) reports \`addedNodes\`,
\`removedNodes\` and \`modifiedNodes\` as node **IDs**, \`connectionChanges\` as 0 or 1, and
\`settingChanges\` as a before/after settings diff. Native diff (\`data.format: "n8n"\`) is n8n's own
payload: field-level \`__old\`/\`__new\` values on modified nodes, plus connections added and removed.

**Native rollback is not pre-validated.** n8n's version payload carries only name, type and
credentials per node - no position, typeVersion or parameters - so there is nothing for the workflow
validator to check. \`validateBefore\` is accepted and ignored on native, and the response says
\`validation: "not available for native versions"\`.

**Consent flow for native modes.** If the workflow is not exposed to n8n's MCP server, the call
returns WORKFLOW_NOT_EXPOSED with a hint. Re-running with \`exposeToMcp: true\` turns on the
workflow's "Available in MCP" setting and retries once; the response then carries
\`exposedToMcp: true\`. That setting is visible and persistent in the n8n UI - confirm with the user
before enabling it. This flow only ever turns the setting on - disabling it again is a deliberate
\`updateSettings\` write (\`availableInMCP: false\`) or a change in the n8n UI.

Every response states \`mode\`, \`source\` and \`backend\` (\`"n8n-mcp"\` for local, \`"official-mcp"\`
for native).

Supports six operations:

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

**diff** - Compare two versions
- Requires versionId and toVersionId
- Local: compares two stored snapshots of the same workflow (both must belong to workflowId)
- Native: returns n8n's own diff between two of its versions

**delete** - Delete specific version(s) (local only)
- Delete a single version by versionId
- Delete all versions for a workflow with deleteAll: true

**prune** - Clean up old versions
- Keeps only the N most recent versions (default: 10)
- Useful for managing storage and keeping history manageable
- Local only

Local version operations are scoped to your n8n instance — you can only see and act on backups
created under your own credentials. Old local backups are also removed automatically (10 most recent
per workflow, plus an age-based retention window). Native history retention is n8n's own.`,
    parameters: {
      mode: {
        type: 'string',
        required: false,
        description: 'Operation mode: "list" (default), "get", "rollback", "diff", "delete", or "prune"',
        enum: ['list', 'get', 'rollback', 'delete', 'prune', 'diff']
      },
      source: {
        type: 'string',
        required: false,
        default: 'local',
        description: 'Which history to read: "local" (n8n-mcp snapshots) or "native" (n8n\'s own version history). delete and prune are local-only.',
        enum: ['local', 'native']
      },
      workflowId: {
        type: 'string',
        required: false,
        description: 'Workflow ID (required for list, rollback, diff, delete, prune modes; required for every native mode)'
      },
      versionId: {
        type: 'string | number',
        required: false,
        description: 'Version ID. local: numeric snapshot id (number or numeric string; anything else is INVALID_ARGS). native: n8n\'s version id string. Required for get and diff, for a single delete, and for native rollback; optional for local rollback.'
      },
      toVersionId: {
        type: 'string | number',
        required: false,
        description: 'The second version to compare against in diff mode (same id format as versionId)'
      },
      limit: {
        type: 'number',
        required: false,
        default: 10,
        description: 'Maximum versions to return in list mode (native: capped at 50)'
      },
      offset: {
        type: 'number',
        required: false,
        description: 'Skip this many versions in native list mode'
      },
      validateBefore: {
        type: 'boolean',
        required: false,
        default: true,
        description: 'Validate workflow structure before rollback (local rollback only; accepted and ignored on native)'
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
      },
      exposeToMcp: {
        type: 'boolean',
        required: false,
        description: 'Native only. On a WORKFLOW_NOT_EXPOSED refusal, enable the workflow\'s "Available in MCP" setting and retry once. Visible, persistent change - confirm with the user first.'
      },
      timeoutMs: {
        type: 'integer',
        required: false,
        default: 30000,
        description: 'Client deadline for the native call (5000-600000)'
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

**diff mode:**
- data.format: "n8n-mcp" (local) or "n8n" (native) - the two payloads are shaped differently
- local: addedNodes / removedNodes / modifiedNodes (node IDs), connectionChanges (0 or 1), settingChanges, nodeGroupChanges
- native: nodesAdded / nodesRemoved / nodesModified (with field-level __old/__new), connectionsAdded, connectionsRemoved

**prune mode:**
- prunedCount: Number of old versions removed
- remainingCount: Number of versions kept

Every response also carries mode, source and backend ("n8n-mcp" for local, "official-mcp" for native).
Native rollback additionally carries validation: "not available for native versions".`,
    examples: [
      '// List version history\nn8n_workflow_versions({mode: "list", workflowId: "abc123", limit: 5})',
      '// Get specific version details\nn8n_workflow_versions({mode: "get", versionId: 42})',
      '// Rollback to latest saved version\nn8n_workflow_versions({mode: "rollback", workflowId: "abc123"})',
      '// Rollback to specific version\nn8n_workflow_versions({mode: "rollback", workflowId: "abc123", versionId: 42})',
      '// Delete specific version\nn8n_workflow_versions({mode: "delete", workflowId: "abc123", versionId: 42})',
      '// Delete all versions for workflow\nn8n_workflow_versions({mode: "delete", workflowId: "abc123", deleteAll: true})',
      '// Prune to keep only 5 most recent\nn8n_workflow_versions({mode: "prune", workflowId: "abc123", maxVersions: 5})',
      '// Compare two local snapshots\nn8n_workflow_versions({mode: "diff", workflowId: "abc123", versionId: 41, toVersionId: 42})',
      '// List n8n\'s own history, including UI edits\nn8n_workflow_versions({mode: "list", source: "native", workflowId: "abc123", limit: 20})',
      '// Compare two of n8n\'s own versions\nn8n_workflow_versions({mode: "diff", source: "native", workflowId: "abc123", versionId: "v1", toVersionId: "v2"})',
      '// Restore one of n8n\'s own versions (no pre-validation)\nn8n_workflow_versions({mode: "rollback", source: "native", workflowId: "abc123", versionId: "v1"})',
      '// Retry after WORKFLOW_NOT_EXPOSED, enabling the setting\nn8n_workflow_versions({mode: "list", source: "native", workflowId: "abc123", exposeToMcp: true})'
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
- prune: Moderate (~100-300ms) - depends on number of versions to delete
- diff (local): Fast (~100ms) - two snapshot reads and an in-memory comparison
- native modes: one round-trip to n8n's MCP server per call (30s client deadline by default), so slower than any local mode`,
    modeComparison: `| Mode | Required Params | Optional Params | Sources | Risk Level |
|------|-----------------|-----------------|---------|------------|
| list | workflowId | limit, offset | local, native | Low |
| get | versionId (native: + workflowId) | - | local, native | Low |
| diff | workflowId, versionId, toVersionId | - | local, native | Low |
| rollback | workflowId | versionId, validateBefore | local, native | Medium |
| delete | workflowId | versionId, deleteAll | local | High |
| prune | workflowId | maxVersions | local | Medium |`,
    bestPractices: [
      'Always list versions before rollback to pick the right one',
      'Use source: "native" when the workflow is also edited in the n8n UI - local snapshots miss those edits',
      'Read a diff before a rollback so you know what the restore will change',
      'Enable validateBefore for rollback to catch structural issues',
      'Use prune regularly to keep version history manageable',
      'Document why you are rolling back for audit purposes'
    ],
    pitfalls: [
      'Rollback overwrites current workflow - backup is created automatically',
      'Deleted versions cannot be recovered',
      'Version operations are scoped to your instance - versions from other instances are not visible',
      'Version IDs are sequential but may have gaps after deletes',
      'Large workflows may have significant version storage overhead',
      'Local and native version ids are different id spaces - a native id will not resolve locally',
      'Native rollback is not validated before it is applied; n8n\'s version payload lacks the fields the validator needs',
      'Native delete and prune are refused (MODE_NOT_SUPPORTED_FOR_SOURCE) - n8n owns that retention',
      'Diff payloads differ by source; branch on data.format rather than assuming field names'
    ],
    relatedTools: [
      'n8n_get_workflow - View current workflow state',
      'n8n_update_partial_workflow - Make incremental changes',
      'n8n_validate_workflow - Validate before deployment'
    ]
  }
};
