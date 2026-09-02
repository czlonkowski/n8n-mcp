import { ToolDefinition } from '../types';
import { AGENT_ACTIONS, DESTRUCTIVE_AGENT_ACTIONS } from './agents-action-map';

/**
 * n8n Management Tools
 * 
 * These tools enable AI agents to manage n8n workflows through the n8n API.
 * They require N8N_API_URL and N8N_API_KEY to be configured.
 */
export const n8nManagementTools: ToolDefinition[] = [
  // Workflow Management Tools
  {
    name: 'n8n_create_workflow',
    description: `Create workflow. Requires: name, nodes[], connections{}. Created inactive. Returns workflow with ID.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { 
          type: 'string', 
          description: 'Workflow name (required)' 
        },
        nodes: { 
          type: 'array', 
          description: 'Array of workflow nodes. Each node must have: id, name, type, typeVersion, position, and parameters',
          items: {
            type: 'object',
            required: ['id', 'name', 'type', 'typeVersion', 'position', 'parameters'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
              typeVersion: { type: 'number' },
              position: { 
                type: 'array',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2
              },
              parameters: { type: 'object' },
              credentials: { type: 'object' },
              disabled: { type: 'boolean' },
              notes: { type: 'string' },
              continueOnFail: { type: 'boolean' },
              retryOnFail: { type: 'boolean' },
              maxTries: { type: 'number' },
              waitBetweenTries: { type: 'number' }
            }
          }
        },
        connections: {
          type: 'object',
          description: 'Workflow connections object. Keys are source node names (the name field, not id), values define output connections'
        },
        settings: {
          type: 'object',
          description: 'Optional workflow settings (execution order, timezone, error handling). Any other key the n8n Public API accepts is forwarded as well, e.g. availableInMCP (expose the workflow to n8n\'s instance-level MCP server), callerPolicy, callerIds.',
          properties: {
            executionOrder: { type: 'string', enum: ['v0', 'v1'] },
            timezone: { type: 'string' },
            saveDataErrorExecution: { type: 'string', enum: ['all', 'none'] },
            saveDataSuccessExecution: { type: 'string', enum: ['all', 'none'] },
            saveManualExecutions: { type: 'boolean' },
            saveExecutionProgress: { type: 'boolean' },
            executionTimeout: { type: 'number' },
            errorWorkflow: { type: 'string' },
            availableInMCP: { type: 'boolean', description: 'Expose the workflow to n8n\'s instance-level MCP server (n8n 1.119+)' }
          }
        },
        nodeGroups: {
          type: 'array',
          description: 'Optional canvas groups (n8n 2.28+): named frames around a connected run of non-trigger nodes. Members are node IDs from nodes[]. Dropped automatically on older n8n.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional; generated when omitted' },
              name: { type: 'string' },
              nodeIds: { type: 'array', items: { type: 'string' } },
              description: { type: 'string', description: 'Optional, max 155 chars (n8n 2.32+)' }
            },
            required: ['name', 'nodeIds']
          }
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID to create the workflow in (enterprise feature)'
        },
        parentFolderId: {
          type: 'string',
          description: 'Optional folder ID to place the workflow in (n8n 2.32+). Omit for the project root. Find or create folders with n8n_manage_folders.'
        }
      },
      required: ['name', 'nodes', 'connections']
    },
    annotations: {
      title: 'Create Workflow',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_get_workflow',
    description: `Get workflow by ID with bounded output. With mode omitted, small workflows are returned in full; large workflows return a compact structure plus responseMeta.artifact for the full JSON. The compact structure is a RESHAPED preview whose nesting differs from the artifact, so query the pointers in responseMeta.artifact.primaryPaths rather than pointers copied from the preview. Artifact handles are valid until the MCP server restarts, and at most 24 hours; re-run this tool to mint a new one. Explicit modes remain available: 'full', 'details', 'active', 'structure', 'filtered', and 'minimal'.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Workflow ID'
        },
        mode: {
          type: 'string',
          enum: ['full', 'details', 'structure', 'minimal', 'active', 'filtered'],
          default: 'full',
          description: 'Detail level: full=draft + metadata, details=full+execution stats, active=published graph, structure=topology, filtered=selected nodes, minimal=metadata only. Oversized results return a compact summary plus a pageable artifact.'
        },
        nodeNames: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: "For mode='filtered': node names or node IDs to return with full config. Returns only matching nodes (avoids client-side truncation on large workflows with long Code-node source). Discover names with mode='structure' first."
        }
      },
      required: ['id']
    },
    annotations: {
      title: 'Get Workflow',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    // Retained from #786 as defense in depth for Claude hosts. The server-side
    // response bouncer normally keeps this result far below the host ceiling.
    _meta: {
      'anthropic/maxResultSizeChars': 450000,
    },
  },
  {
    name: 'n8n_update_full_workflow',
    description: `Full workflow update. Requires complete nodes[] and connections{}. For incremental use n8n_update_partial_workflow.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { 
          type: 'string', 
          description: 'Workflow ID to update' 
        },
        name: { 
          type: 'string', 
          description: 'New workflow name' 
        },
        nodes: { 
          type: 'array', 
          description: 'Complete array of workflow nodes (required if modifying workflow structure)',
          items: {
            type: 'object',
            additionalProperties: true
          }
        },
        connections: { 
          type: 'object', 
          description: 'Complete connections object (required if modifying workflow structure)' 
        },
        settings: {
          type: 'object',
          description: 'Workflow settings to update'
        },
        nodeGroups: {
          type: 'array',
          description: 'Canvas groups (n8n 2.28+). Omit to keep the existing groups; pass [] to ungroup everything. Members are node IDs.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional; generated when omitted' },
              name: { type: 'string' },
              nodeIds: { type: 'array', items: { type: 'string' } },
              description: { type: 'string', description: 'Optional, max 155 chars (n8n 2.32+)' }
            },
            required: ['name', 'nodeIds']
          }
        },
        parentFolderId: {
          type: ['string', 'null'],
          description: 'Move the workflow into this folder (n8n 2.32+): folder ID = move there, null = move to project root, omit = leave the current folder unchanged. For a move without other changes prefer the moveToFolder operation of n8n_update_partial_workflow.'
        }
      },
      required: ['id']
    },
    annotations: {
      title: 'Update Full Workflow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_update_partial_workflow',
    description: `Update workflow incrementally with diff operations. Types: addNode, removeNode, updateNode, patchNodeField, moveNode, enable/disableNode, addConnection, removeConnection, rewireConnection, cleanStaleConnections, replaceConnections, updateSettings, updateName, setNodeGroups, add/removeTag, activate/deactivateWorkflow, transferWorkflow, moveToFolder. patchNodeField requires fieldPath (dot path, e.g. "parameters.jsCode") and patches: [{find, replace}]. setNodeGroups replaces all canvas groups: [{name, nodeNames|nodeIds}] (or [] to ungroup). moveToFolder moves the workflow into a folder (n8n 2.32+): {parentFolderId: folder ID or null for project root}. See tools_documentation("n8n_update_partial_workflow", "full") for details.`,
    inputSchema: {
      type: 'object',
      additionalProperties: true,  // Allow any extra properties Claude Desktop might add
      properties: {
        id: { 
          type: 'string', 
          description: 'Workflow ID to update' 
        },
        operations: {
          type: 'array',
          description: 'Array of diff operations to apply. Each operation must have a "type" field and relevant properties for that operation type.',
          items: {
            type: 'object',
            additionalProperties: true
          }
        },
        validateOnly: {
          type: 'boolean',
          description: 'If true, only validate operations without applying them'
        },
        continueOnError: {
          type: 'boolean',
          description: 'If true, apply valid operations even if some fail (best-effort mode). Returns applied and failed operation indices. Default: false (atomic)'
        }
      },
      required: ['id', 'operations']
    },
    annotations: {
      title: 'Update Partial Workflow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_delete_workflow',
    description: `Permanently delete a workflow. This action cannot be undone.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { 
          type: 'string', 
          description: 'Workflow ID to delete' 
        }
      },
      required: ['id']
    },
    annotations: {
      title: 'Delete Workflow',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_list_workflows',
    description: `List workflows (minimal metadata only). Returns id/name/active/dates/tags. Check hasMore/nextCursor for pagination.`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { 
          type: 'number', 
          description: 'Number of workflows to return (1-100, default: 100)' 
        },
        cursor: { 
          type: 'string', 
          description: 'Pagination cursor from previous response' 
        },
        active: { 
          type: 'boolean', 
          description: 'Filter by active status' 
        },
        tags: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Filter by tags (exact match)' 
        },
        projectId: { 
          type: 'string', 
          description: 'Filter by project ID (enterprise feature)' 
        },
        excludePinnedData: {
          type: 'boolean',
          description: 'Exclude pinned data from response (default: true)'
        }
      }
    },
    annotations: {
      title: 'List Workflows',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_validate_workflow',
    description: `Validate workflow by ID. Checks nodes, connections, expressions. Returns errors/warnings/suggestions.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { 
          type: 'string', 
          description: 'Workflow ID to validate' 
        },
        options: {
          type: 'object',
          description: 'Validation options',
          properties: {
            validateNodes: { 
              type: 'boolean', 
              description: 'Validate node configurations (default: true)' 
            },
            validateConnections: { 
              type: 'boolean', 
              description: 'Validate workflow connections (default: true)' 
            },
            validateExpressions: { 
              type: 'boolean', 
              description: 'Validate n8n expressions (default: true)' 
            },
            profile: {
              type: 'string',
              enum: ['minimal', 'runtime', 'ai-friendly', 'strict'],
              description: 'Validation profile to use (default: runtime)'
            }
          }
        }
      },
      required: ['id']
    },
    annotations: {
      title: 'Validate Workflow',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_autofix_workflow',
    description: `Automatically fix common workflow validation errors. Preview fixes or apply them. Fixes expression format, typeVersion, error output config, webhook paths, connection structure issues (numeric keys, invalid types, ID-to-name, duplicates, out-of-bounds indices).`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Workflow ID to fix'
        },
        applyFixes: {
          type: 'boolean',
          description: 'Apply fixes to workflow (default: false - preview mode)'
        },
        fixTypes: {
          type: 'array',
          description: 'Types of fixes to apply (default: all)',
          items: {
            type: 'string',
            enum: ['expression-format', 'typeversion-correction', 'error-output-config', 'node-type-correction', 'webhook-missing-path', 'typeversion-upgrade', 'version-migration', 'tool-variant-correction', 'connection-numeric-keys', 'connection-invalid-type', 'connection-id-to-name', 'connection-duplicate-removal', 'connection-input-index']
          }
        },
        confidenceThreshold: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Minimum confidence level for fixes (default: medium)'
        },
        maxFixes: {
          type: 'number',
          description: 'Maximum number of fixes to apply (default: 50)'
        }
      },
      required: ['id']
    },
    annotations: {
      title: 'Autofix Workflow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },

  // Execution Management Tools
  {
    name: 'n8n_test_workflow',
    description: `Run a workflow. method=auto (default) triggers it over HTTP through its webhook/form/chat trigger. Workflows without such a trigger need n8n's MCP server: method=prepare lists the nodes that need pinned data, method=pinned runs the workflow with that data, method=direct starts a run with optional inputs. The official methods need N8N_MCP_ACCESS_TOKEN and the workflow's "Available in MCP" setting (exposeToMcp: true enables it after you confirm with the user).`,
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID to execute (required)'
        },
        method: {
          type: 'string',
          enum: ['auto', 'trigger', 'prepare', 'pinned', 'direct'],
          description: 'How to run it. auto (default): trigger over HTTP when the workflow has a webhook/form/chat trigger, otherwise report that it cannot be triggered - auto never runs through n8n\'s MCP server. trigger: force the HTTP path. prepare: list the nodes needing pinned data (read-only). pinned: run with pinData through n8n\'s MCP server. direct: start a run through n8n\'s MCP server, with optional inputs.'
        },
        triggerType: {
          type: 'string',
          enum: ['webhook', 'form', 'chat'],
          description: 'Trigger type. Auto-detected if not specified. Workflow must have a matching trigger node.'
        },
        // Webhook options
        httpMethod: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE'],
          description: 'For webhook: HTTP method (default: from workflow config or POST)'
        },
        webhookPath: {
          type: 'string',
          description: 'For webhook: override the webhook path'
        },
        // Chat options
        message: {
          type: 'string',
          description: 'For chat: message to send (required for chat triggers)'
        },
        sessionId: {
          type: 'string',
          description: 'For chat: session ID for conversation continuity'
        },
        // Common options
        data: {
          type: 'object',
          description: 'Input data/payload for webhook, form fields, or execution data'
        },
        headers: {
          type: 'object',
          description: 'Custom HTTP headers'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (default: 120000). HTTP trigger path only (method auto/trigger) — the official methods (prepare/pinned/direct) use timeoutMs instead.'
        },
        waitForResponse: {
          type: 'boolean',
          description: 'Wait for workflow completion (default: true)'
        },
        pinData: {
          type: 'object',
          description: 'For method=pinned (required, non-empty): pinned trigger data keyed by node name. Each value is an array of ITEMS, and every item must be wrapped as { "json": { ... } } - e.g. {"Webhook": [{"json": {"id": "123"}}]}, never a flat object. Get the node list from method=prepare.'
        },
        triggerNodeName: {
          type: 'string',
          description: 'For method=pinned/direct: which trigger node to start from. Defaults to the detected trigger node. Required by n8n when inputs are given.'
        },
        executionMode: {
          type: 'string',
          enum: ['manual', 'production'],
          description: 'For method=direct: manual (default) runs it as a manual execution; production runs it through the production execution path. Both execute the workflow\'s nodes for real - this only changes the execution context. Never chosen implicitly.'
        },
        exposeToMcp: {
          type: 'boolean',
          description: 'For the official methods: enable the workflow\'s persistent "Available in MCP" setting when n8n refuses the call. Confirm with the user first.'
        },
        timeoutMs: {
          type: 'integer',
          minimum: 5000,
          maximum: 600000,
          description: 'Client-side deadline for the official call (default: 30000 for prepare, 300000 for pinned/direct)'
        }
      },
      required: ['workflowId']
    },
    annotations: {
      title: 'Test Workflow',
      readOnlyHint: false,
      // Running a workflow has the workflow's own side effects; n8n marks its
      // execute_workflow / test_workflow tools destructive for the same reason.
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_executions',
    description: `Manage workflow executions: get details, list, or delete. Use action='get' with id for execution details, action='list' for listing executions, action='delete' to remove execution record. Large results return a compact preview plus responseMeta.artifact holding the full JSON; the preview is RESHAPED, so query the pointers in responseMeta.artifact.primaryPaths rather than pointers copied from the preview. Artifact handles are valid until the MCP server restarts, and at most 24 hours; re-run this tool to mint a new one.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'list', 'delete'],
          description: 'Operation: get=get execution details, list=list executions, delete=delete execution'
        },
        // For action='get' and action='delete'
        id: {
          type: 'string',
          description: 'Execution ID (required for action=get or action=delete)'
        },
        // For action='get' - detail level
        mode: {
          type: 'string',
          enum: ['preview', 'summary', 'filtered', 'full', 'error'],
          description: 'For action=get: preview=structure only, summary=2 items (default), filtered=custom, full=all data, error=optimized error debugging'
        },
        nodeNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'For action=get with mode=filtered: filter to specific nodes by name'
        },
        itemsLimit: {
          type: 'number',
          description: 'For action=get with mode=filtered: items per node (0=structure, 2=default, -1=unlimited)'
        },
        includeInputData: {
          type: 'boolean',
          description: 'For action=get: include input data in addition to output (default: false)'
        },
        // Error mode specific parameters
        errorItemsLimit: {
          type: 'number',
          description: 'For action=get with mode=error: sample items from upstream node (default: 2, max: 100)'
        },
        includeStackTrace: {
          type: 'boolean',
          description: 'For action=get with mode=error: include full stack trace (default: false, shows truncated)'
        },
        includeExecutionPath: {
          type: 'boolean',
          description: 'For action=get with mode=error: include execution path leading to error (default: true)'
        },
        fetchWorkflow: {
          type: 'boolean',
          description: 'For action=get with mode=error: fetch workflow for accurate upstream detection (default: true)'
        },
        // For action='list'
        limit: {
          type: 'number',
          description: 'For action=list: number of executions to return (1-100, default: 20)'
        },
        cursor: {
          type: 'string',
          description: 'For action=list: pagination cursor from previous response'
        },
        workflowId: {
          type: 'string',
          description: 'For action=list: filter by workflow ID'
        },
        projectId: {
          type: 'string',
          description: 'For action=list: filter by project ID (enterprise feature)'
        },
        status: {
          type: 'string',
          enum: ['success', 'error', 'waiting'],
          description: 'For action=list: filter by execution status'
        },
        includeData: {
          type: 'boolean',
          description: 'For action=list: include execution data (default: false)'
        }
      },
      required: ['action']
    },
    annotations: {
      title: 'Manage Executions',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_evaluations',
    description: `Run and read evaluation test runs for a workflow. Reading requires n8n >= 2.30, run/cancel require n8n >= 2.32, and the API key must be created on the matching release to carry the testRun scopes; run/cancel also need the key owner to hold workflow:execute on the workflow. Actions: list_runs=list runs for a workflow, get_run=single run with aggregated metrics, list_cases=per-case results (paginate - cases can be large), run=trigger a run on a workflow with an evaluation trigger, cancel=stop a running run.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_runs', 'get_run', 'list_cases', 'run', 'cancel'],
          description: 'Operation: list_runs=list test runs, get_run=run details with metrics, list_cases=per-case results, run=trigger a run, cancel=stop a running run'
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID the test runs belong to (required)'
        },
        runId: {
          type: 'string',
          description: 'Test run ID (required for action=get_run, list_cases, or cancel)'
        },
        status: {
          type: 'string',
          enum: ['new', 'running', 'completed', 'error', 'cancelled'],
          description: 'For action=list_runs: filter by run status'
        },
        limit: {
          type: 'number',
          description: 'Results per page (1-250). Defaults: n8n server default (100) for list_runs, 20 for list_cases (per-case inputs/outputs can be large)'
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor from previous response'
        }
      },
      required: ['action', 'workflowId']
    },
    annotations: {
      title: 'Manage Evaluation Test Runs',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },

  // System Tools
  {
    name: 'n8n_health_check',
    description: `Check n8n instance health and API connectivity. Use mode='diagnostic' for detailed troubleshooting with env vars and tool status.`,
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['status', 'diagnostic'],
          description: 'Mode: "status" (default) for quick health check, "diagnostic" for detailed debug info including env vars and tool status',
          default: 'status'
        },
        verbose: {
          type: 'boolean',
          description: 'Include extra details in diagnostic mode (default: false)'
        }
      }
    },
    annotations: {
      title: 'Health Check',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_workflow_versions',
    description: `Manage workflow version history, rollback, comparison, and cleanup. Six modes:
- list: Show version history for a workflow
- get: Get details of a specific version
- rollback: Restore workflow to a previous version (creates backup first)
- diff: Compare two versions
- delete: Delete specific version or all versions for a workflow
- prune: Manually trigger pruning to keep N most recent versions

Two sources:
- source: 'local' (default) - snapshots n8n-mcp takes before it changes a workflow. Scoped to your n8n instance, works on any n8n version, and covers only changes made through n8n-mcp. Old backups are pruned automatically (10 most recent per workflow, plus an age-based retention window).
- source: 'native' - n8n's own workflow history, the same list the n8n UI shows, including edits made by people in the UI. Needs an n8n MCP access token and the workflow's "Available in MCP" setting; supports list, get, rollback and diff only. Native rollback is not pre-validated.`,
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['list', 'get', 'rollback', 'delete', 'prune', 'diff'],
          description: 'Operation mode'
        },
        source: {
          type: 'string',
          enum: ['local', 'native'],
          default: 'local',
          description: "Which history to read: 'local' (n8n-mcp snapshots, default) or 'native' (n8n's own version history). delete and prune are local-only."
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID (required for list, rollback, delete, prune, diff; required for every native mode)'
        },
        // No JSON-Schema `type`: local ids are integers and native ids are
        // strings, and the server's argument coercion only touches properties
        // that declare a scalar type.
        versionId: {
          description: "Version ID. local: numeric snapshot id (number or numeric string); native: n8n's version id string. Required for get and diff, for a single-version delete, and for native rollback; optional for local rollback."
        },
        toVersionId: {
          description: 'The second version to compare against in diff mode (same id format as versionId)'
        },
        limit: {
          type: 'number',
          default: 10,
          description: 'Max versions to return in list mode (native: capped at 50)'
        },
        offset: {
          type: 'number',
          minimum: 0,
          description: 'Skip this many versions in native list mode'
        },
        validateBefore: {
          type: 'boolean',
          default: true,
          description: 'Validate workflow structure before rollback (local only; accepted and ignored for native)'
        },
        deleteAll: {
          type: 'boolean',
          default: false,
          description: 'Delete all versions for workflow (delete mode only)'
        },
        maxVersions: {
          type: 'number',
          default: 10,
          description: 'Keep N most recent versions (prune mode only)'
        },
        exposeToMcp: {
          type: 'boolean',
          description: 'Native only. When n8n refuses the workflow because it is not available in MCP, enable that setting on the workflow and retry once. This is a visible, persistent workflow setting - confirm with the user first.'
        },
        timeoutMs: {
          type: 'integer',
          minimum: 5000,
          maximum: 600000,
          description: 'Client deadline for the native call (default 30000)'
        }
      },
      required: ['mode']
    },
    annotations: {
      title: 'Workflow Versions',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },

  // Template Deployment Tool
  {
    name: 'n8n_deploy_template',
    description: `Deploy a workflow template from n8n.io directly to your n8n instance. Deploys first, then auto-fixes common issues (expression format, typeVersions). Returns workflow ID, required credentials, and fixes applied.`,
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'number',
          description: 'Template ID from n8n.io (required)'
        },
        name: {
          type: 'string',
          description: 'Custom workflow name (default: template name)'
        },
        autoUpgradeVersions: {
          type: 'boolean',
          default: true,
          description: 'Automatically upgrade node typeVersions to latest supported (default: true)'
        },
        autoFix: {
          type: 'boolean',
          default: true,
          description: 'Auto-apply fixes after deployment for expression format issues, missing = prefix, etc. (default: true)'
        },
        stripCredentials: {
          type: 'boolean',
          default: true,
          description: 'Remove credential references from nodes - user configures in n8n UI (default: true)'
        }
      },
      required: ['templateId']
    },
    annotations: {
      title: 'Deploy Template',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_manage_datatable',
    description: `Manage n8n data tables, rows and columns. Actions: createTable, listTables, getTable, updateTable, deleteTable, getRows, insertRows, updateRows, upsertRows, deleteRows, addColumn, deleteColumn, renameColumn. The column actions run through n8n's own MCP server (N8N_MCP_ACCESS_TOKEN, n8n 2.34+) because the public API cannot change a table's columns after creation; everything else uses the public API.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['createTable', 'listTables', 'getTable', 'updateTable', 'deleteTable', 'getRows', 'insertRows', 'updateRows', 'upsertRows', 'deleteRows', 'addColumn', 'deleteColumn', 'renameColumn'],
          description: 'Operation to perform. addColumn/deleteColumn/renameColumn need N8N_MCP_ACCESS_TOKEN.',
        },
        tableId: { type: 'string', description: 'Data table ID (required for all actions except createTable and listTables)' },
        name: { type: 'string', description: 'For createTable: table name. For updateTable: new table name. For renameColumn: new column name.' },
        columns: {
          type: 'array',
          description: 'For createTable (required, at least one): column definitions. Change columns later with addColumn/deleteColumn/renameColumn.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['string', 'number', 'boolean', 'date'] },
            },
            required: ['name'],
          },
        },
        data: { description: 'For insertRows: array of row objects. For updateRows/upsertRows: object with column values.' },
        filter: {
          type: 'object',
          description: 'For getRows/updateRows/upsertRows/deleteRows: {type?: "and"|"or", filters: [{columnName, condition, value}]}',
        },
        limit: { type: 'number', description: 'For listTables/getRows: max results (1-100)' },
        cursor: { type: 'string', description: 'For listTables/getRows: pagination cursor' },
        sortBy: { type: 'string', description: 'For getRows: "columnName:asc" or "columnName:desc"' },
        search: { type: 'string', description: 'For getRows: text search across string columns' },
        returnType: { type: 'string', enum: ['count', 'id', 'all'], description: 'For insertRows: what to return (default: count)' },
        returnData: { type: 'boolean', description: 'For updateRows/upsertRows/deleteRows: return affected rows (default: false)' },
        dryRun: { type: 'boolean', description: 'For updateRows/upsertRows/deleteRows: preview without applying (default: false)' },
        projectId: { type: 'string', description: 'For createTable: project ID to create the table in. If omitted, uses the default project. For the column actions: the project owning the table - resolved automatically when the instance has exactly one accessible project, otherwise required (the error lists the candidates).' },
        columnId: { type: 'string', description: 'For deleteColumn/renameColumn: ID of the column (from getTable).' },
        column: {
          type: 'object',
          description: 'For addColumn: the column to add. Name must start with a letter, contain only letters, digits and underscores, and be at most 63 characters.',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['string', 'number', 'boolean', 'date'] },
          },
          required: ['name', 'type'],
        },
        timeoutMs: {
          type: 'integer',
          minimum: 5000,
          maximum: 600000,
          description: 'For the column actions: client timeout in ms (5000-600000, default 30000).',
        },
      },
      required: ['action'],
    },
    annotations: {
      title: 'Manage Data Tables',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_manage_folders',
    description: `Manage workflow folders (n8n 2.19+; folders need a registered Community instance or higher). Actions: create, list, get, rename, move, delete. projectId defaults to 'personal' (the calling user's personal project). Place workflows into folders via n8n_create_workflow's parentFolderId or the moveToFolder operation of n8n_update_partial_workflow (both n8n 2.32+). Note: n8n's API cannot report which folder a workflow is in - folder contents are visible only as counts.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'get', 'rename', 'move', 'delete'],
          description: 'Operation: create=new folder, list=folders in a project (with workflow/subfolder counts), get=folder details with recursive totals, rename=change name, move=re-parent under another folder or the project root, delete=remove folder',
        },
        projectId: {
          type: 'string',
          description: `Project containing the folder(s). Defaults to 'personal' - resolved to the calling user's personal project. Pass a real project ID on multi-project (enterprise) instances.`,
        },
        folderId: { type: 'string', description: 'Folder ID (required for get, rename, move, delete)' },
        name: { type: 'string', description: 'For create: folder name (required). For rename: new name (required).' },
        parentFolderId: {
          type: ['string', 'null'],
          description: 'For create: optional parent folder to nest under. For move: target parent folder ID, or null to move to the project root (required). For list: only return direct children of this folder.',
        },
        transferToFolderId: {
          type: 'string',
          description: `For delete: move contained workflows and sub-folders into this folder first ('0' = project root). If omitted, workflows are moved to the project root AND ARCHIVED, and sub-folders are deleted.`,
        },
        nameFilter: { type: 'string', description: 'For list: filter folders by name (contains match)' },
        sortBy: {
          type: 'string',
          enum: ['name:asc', 'name:desc', 'createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'],
          description: 'For list: sort order (default: updatedAt:desc)',
        },
        skip: { type: 'number', description: 'For list: items to skip for pagination (default 0)' },
        take: { type: 'number', description: 'For list: items to return (default 50, max 100)' },
      },
      required: ['action'],
    },
    annotations: {
      title: 'Manage Workflow Folders',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_manage_credentials',
    description: 'Manage n8n credentials. Actions: list, get, create, update, delete, getSchema. Use getSchema to discover required fields before creating. For list, page beyond 100 results with cursor (from the previous response\'s nextCursor). NOTE: list/get need an n8n deployment whose public API permits credential reads — older n8n versions, restricted API keys, or instance settings can reject them, returning NOT_SUPPORTED (create, delete, getSchema — and update where the API version supports it — still work). SECURITY: credential data values are never logged.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete', 'getSchema'], description: 'Action to perform' },
        id: { type: 'string', description: 'Credential ID (required for get, update, delete)' },
        name: { type: 'string', description: 'Credential name (required for create)' },
        type: { type: 'string', description: 'Credential type e.g. httpHeaderAuth, httpBasicAuth, oAuth2Api (required for create, getSchema)' },
        data: { type: 'object', description: 'Credential data fields - use getSchema to discover required fields (required for create, optional for update)' },
        includeUsage: { type: 'boolean', description: 'For list/get: also return workflows that reference each credential (id, name, active). On list, triggers a full scan of all credential pages (up to 5000 credentials; ignores cursor/limit, no nextCursor returned). Slower on large instances. Default: false.' },
        cursor: { type: 'string', description: 'For list: pagination cursor from a previous response\'s nextCursor. Ignored when includeUsage is true.' },
        limit: { type: 'number', description: 'For list: max results per page (1-100, default 100). Ignored when includeUsage is true.' },
      },
      required: ['action'],
    },
    annotations: {
      title: 'Manage Credentials',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_audit_instance',
    description: `Security audit of n8n instance. Combines n8n's built-in audit API (credentials, database, nodes, instance, filesystem risks) with deep workflow scanning (hardcoded secrets via 50+ regex patterns, unauthenticated webhooks, error handling gaps, data retention risks). Returns actionable markdown report with remediation steps using n8n_manage_credentials and n8n_update_partial_workflow.`,
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['credentials', 'database', 'nodes', 'instance', 'filesystem'],
          },
          description: 'Built-in audit categories to check (default: all 5)',
        },
        includeCustomScan: {
          type: 'boolean',
          description: 'Run deep workflow scanning for secrets, webhooks, error handling (default: true)',
        },
        daysAbandonedWorkflow: {
          type: 'number',
          description: 'Days threshold for abandoned workflow detection (default: 90)',
        },
        customChecks: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['hardcoded_secrets', 'unauthenticated_webhooks', 'error_handling', 'data_retention'],
          },
          description: 'Specific custom checks to run (default: all 4)',
        },
      },
    },
    annotations: {
      title: 'Audit Instance Security',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_manage_agents',
    description: `Manage n8n Agents (persisted assistants with a model, instructions, tools, skills, tasks, memory and channels) through n8n's instance-level MCP server. Requires N8N_MCP_ACCESS_TOKEN (MCP API key from n8n Settings → Instance-level MCP) and n8n >= 2.34 with the agents module. Actions: reference, search, get, create, mutate, validate, call, publish, unpublish, revert, versions, delete, discover_assets, verify_mcp_server, update_integration. Start with action=reference (config shape and mutate operations), then discover_assets → create → mutate (one resource at a time, always with the latest configHash) → validate. publish only when the user explicitly asks. call runs the agent with real credentials and tools and may return approvals[] that need a human decision — never approve on the user's behalf. This is not the AI Agent workflow node; use get_node for that.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: AGENT_ACTIONS, description: 'Operation to perform' },
        args: { type: 'object', description: 'Arguments for the action, forwarded to n8n verbatim. See tools_documentation("n8n_manage_agents", "full") for the per-action fields.' },
        timeoutMs: { type: 'integer', minimum: 5000, maximum: 600000, description: 'Request timeout in ms. Default 30000; 180000 for action=call. The agent run continues in n8n even if this expires.' },
      },
      required: ['action'],
    },
    annotations: { title: 'Manage n8n Agents', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'n8n_explore_node_resources',
    description: 'Resolve the real options behind a node\'s dynamic dropdown (loadOptions) or resource-locator search (listSearch) using one of the instance\'s credentials — Slack channels, Google Sheets tabs, model lists — so workflow configs use existing IDs instead of invented ones. Requires N8N_MCP_ACCESS_TOKEN. Find methodName/methodType in get_node output (dynamicOptions on a property) and the credentialId with n8n_manage_credentials list.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeType: { type: 'string', description: 'Full node type, e.g. n8n-nodes-base.slack' },
        version: { type: 'number', description: 'Node typeVersion' },
        methodName: { type: 'string', description: 'loadOptionsMethod or searchListMethod name from the property definition' },
        methodType: { type: 'string', enum: ['listSearch', 'loadOptions'] },
        credentialType: { type: 'string', description: 'Credential type the node uses, e.g. slackApi' },
        credentialId: { type: 'string', description: 'ID of an existing credential of that type' },
        filter: { type: 'string', description: 'Search text (listSearch only)' },
        paginationToken: { type: 'string', description: 'Token from a previous page (listSearch only)' },
        currentNodeParameters: { type: 'object', description: 'Parameters the method depends on (loadOptionsDependsOn), e.g. {documentId: {...}}' },
        timeoutMs: { type: 'integer', minimum: 5000, maximum: 600000, description: 'Request timeout in ms (default 30000)' },
      },
      required: ['nodeType', 'version', 'methodName', 'methodType', 'credentialType', 'credentialId'],
    },
    annotations: { title: 'Explore Node Resources', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'n8n_list_catalog',
    description: 'List instance-level catalog entries: projects (with the personal project marked, needed as projectId for agents and data tables) or tags. Reads the Public API first; when team projects are not licensed there, falls back to n8n\'s MCP server if N8N_MCP_ACCESS_TOKEN is set.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['projects', 'tags'] },
        query: { type: 'string', description: 'Case-insensitive name filter' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['kind'],
    },
    annotations: { title: 'List Catalog', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
];

/**
 * Maps tool names to the argument key that carries the operation/mode selector.
 * Only tools listed here are eligible for DISABLED_TOOL_OPERATIONS filtering.
 * Add an entry here when introducing a new tool that bundles multiple operations.
 */
export const TOOL_OPERATION_PARAM: Record<string, string> = {
  'n8n_executions': 'action',
  'n8n_test_workflow': 'method',
  'n8n_evaluations': 'action',
  'n8n_manage_folders': 'action',
  'n8n_workflow_versions': 'mode',
  'n8n_manage_agents': 'action',
  'n8n_list_catalog': 'kind',
  'n8n_manage_datatable': 'action',
};

/**
 * The operation a call is checked as when its operation parameter is omitted.
 *
 * The call-time policy check reads the raw arguments, before Zod applies the
 * schema default, so a tool whose operation parameter has a default needs that
 * default here — otherwise an omitted value would slip past a rule naming it.
 */
export const TOOL_OPERATION_DEFAULT: Record<string, string> = {
  'n8n_test_workflow': 'auto',
};

/**
 * The write/destructive operation values per multi-operation tool. Used by
 * DISABLED_TOOL_OPERATIONS filtering: when every destructive value has been
 * disabled, the filtered tool is effectively read-only and its MCP annotations
 * are recomputed (readOnlyHint/destructiveHint) so hosts that honor them don't
 * keep gating the remaining read paths. Values are lowercase to match parsing.
 */
export const DESTRUCTIVE_TOOL_OPERATIONS: Record<string, Set<string>> = {
  'n8n_executions': new Set(['delete']),
  // Every method that runs the workflow; prepare is the read path. `auto`
  // resolves to `trigger`, so it runs the workflow too. `expose` is virtual: it
  // is not a `method` value but the consent write behind `exposeToMcp: true`.
  'n8n_test_workflow': new Set(['auto', 'trigger', 'pinned', 'direct', 'expose']),
  'n8n_evaluations': new Set(['run', 'cancel']),
  // Every write action; list/get are the read paths. delete is the sharpest — without
  // transferToFolderId it archives the folder's workflows.
  'n8n_manage_folders': new Set(['create', 'rename', 'move', 'delete']),
  // `expose` is virtual: it is not a `mode` value but the consent write behind
  // `exposeToMcp: true` on the native modes.
  'n8n_workflow_versions': new Set(['delete', 'rollback', 'prune', 'expose']),
  // Derived from AGENT_ACTION_MAP: create/mutate persist a draft and call runs
  // the agent's real tools, so the write set is wider than the publish/delete pair.
  'n8n_manage_agents': new Set(DESTRUCTIVE_AGENT_ACTIONS),
  // Every write action; listTables/getTable/getRows are the read paths. The
  // column actions write through n8n's own MCP server, the rest through the
  // public API - both are writes as far as policy is concerned.
  'n8n_manage_datatable': new Set([
    'createtable', 'updatetable', 'deletetable',
    'insertrows', 'updaterows', 'upsertrows', 'deleterows',
    'addcolumn', 'deletecolumn', 'renamecolumn',
  ]),
};
