import { ToolDefinition } from '../types';

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
          description: 'Optional workflow settings (execution order, timezone, error handling)',
          properties: {
            executionOrder: { type: 'string', enum: ['v0', 'v1'] },
            timezone: { type: 'string' },
            saveDataErrorExecution: { type: 'string', enum: ['all', 'none'] },
            saveDataSuccessExecution: { type: 'string', enum: ['all', 'none'] },
            saveManualExecutions: { type: 'boolean' },
            saveExecutionProgress: { type: 'boolean' },
            executionTimeout: { type: 'number' },
            errorWorkflow: { type: 'string' }
          }
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID to create the workflow in (enterprise feature)'
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
    description: `Get workflow by ID with different detail levels. Use mode='full' for complete workflow, 'details' for metadata+stats, 'structure' for nodes/connections only, 'minimal' for id/name/active/tags.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Workflow ID'
        },
        mode: {
          type: 'string',
          enum: ['full', 'details', 'structure', 'minimal'],
          default: 'full',
          description: 'Detail level: full=complete workflow, details=full+execution stats, structure=nodes/connections topology, minimal=metadata only'
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
    description: `Update workflow incrementally with diff operations. Types: addNode, removeNode, updateNode, patchNodeField, moveNode, enable/disableNode, addConnection, removeConnection, updateSettings, updateName, add/removeTag, activate/deactivateWorkflow, transferWorkflow. See tools_documentation("n8n_update_partial_workflow", "full") for details.`,
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
    description: `Test/trigger workflow execution. Auto-detects trigger type (webhook/form/chat). Supports: webhook (HTTP), form (fields), chat (message). Note: Only workflows with these trigger types can be executed externally.`,
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID to execute (required)'
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
          description: 'Timeout in ms (default: 120000)'
        },
        waitForResponse: {
          type: 'boolean',
          description: 'Wait for workflow completion (default: true)'
        }
      },
      required: ['workflowId']
    },
    annotations: {
      title: 'Test Workflow',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'n8n_executions',
    description: `Manage workflow executions: get details, list, or delete. Use action='get' with id for execution details, action='list' for listing executions, action='delete' to remove execution record.`,
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
          description: 'For action=list: number of executions to return (1-100, default: 100)'
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
    description: `Manage workflow version history, rollback, and cleanup. Six modes:
- list: Show version history for a workflow
- get: Get details of specific version
- rollback: Restore workflow to previous version (creates backup first)
- delete: Delete specific version or all versions for a workflow
- prune: Manually trigger pruning to keep N most recent versions
- truncate: Delete ALL versions for ALL workflows (requires confirmation)`,
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['list', 'get', 'rollback', 'delete', 'prune', 'truncate'],
          description: 'Operation mode'
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID (required for list, rollback, delete, prune)'
        },
        versionId: {
          type: 'number',
          description: 'Version ID (required for get mode and single version delete, optional for rollback)'
        },
        limit: {
          type: 'number',
          default: 10,
          description: 'Max versions to return in list mode'
        },
        validateBefore: {
          type: 'boolean',
          default: true,
          description: 'Validate workflow structure before rollback'
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
        confirmTruncate: {
          type: 'boolean',
          default: false,
          description: 'REQUIRED: Must be true to truncate all versions (truncate mode only)'
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
    description: `Manage n8n data tables and rows. Actions: createTable, listTables, getTable, updateTable, deleteTable, getRows, insertRows, updateRows, upsertRows, deleteRows.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['createTable', 'listTables', 'getTable', 'updateTable', 'deleteTable', 'getRows', 'insertRows', 'updateRows', 'upsertRows', 'deleteRows'],
          description: 'Operation to perform',
        },
        tableId: { type: 'string', description: 'Data table ID (required for all actions except createTable and listTables)' },
        name: { type: 'string', description: 'For createTable: table name. For updateTable: new name (rename only — schema is immutable after creation)' },
        columns: {
          type: 'array',
          description: 'For createTable only: column definitions (schema is immutable after creation via public API)',
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
    name: 'n8n_manage_credentials',
    description: 'Manage n8n credentials. Actions: list, get, create, update, delete, getSchema. Use getSchema to discover required fields before creating. SECURITY: credential data values are never logged.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete', 'getSchema'], description: 'Action to perform' },
        id: { type: 'string', description: 'Credential ID (required for get, update, delete)' },
        name: { type: 'string', description: 'Credential name (required for create)' },
        type: { type: 'string', description: 'Credential type e.g. httpHeaderAuth, httpBasicAuth, oAuth2Api (required for create, getSchema)' },
        data: { type: 'object', description: 'Credential data fields - use getSchema to discover required fields (required for create, optional for update)' },
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
    name: 'n8n_generate_workflow',
    description: 'Generate an n8n workflow from a natural language description using AI. ' +
      'Call with just a description to get workflow proposals. ' +
      'Then call again with deploy_id to deploy a chosen proposal, ' +
      'or set skip_cache=true to generate a fresh workflow. ' +
      'Use confirm_deploy=true to deploy a previously generated workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Clear description of what the workflow should do. Include: trigger type ' +
            '(webhook, schedule, manual), services to integrate (Slack, Gmail, etc.), and the logic/flow.'
        },
        skip_cache: {
          type: 'boolean',
          description: 'Set to true to skip proposals and generate a fresh workflow from scratch. ' +
            'Returns a preview — call again with confirm_deploy=true to deploy it.'
        },
        deploy_id: {
          type: 'string',
          description: 'ID of a proposal to deploy. Get proposal IDs from a previous call ' +
            'that returned status "proposals".'
        },
        confirm_deploy: {
          type: 'boolean',
          description: 'Set to true to deploy the workflow from the last generation preview.'
        }
      },
      required: ['description'],
    },
    annotations: {
      title: 'Generate Workflow',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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
];
