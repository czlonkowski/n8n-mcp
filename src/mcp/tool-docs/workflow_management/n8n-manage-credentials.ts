import { ToolDocumentation } from '../types';

export const n8nManageCredentialsDoc: ToolDocumentation = {
  name: 'n8n_manage_credentials',
  category: 'workflow_management',
  essentials: {
    description: 'CRUD operations for n8n credentials with schema discovery',
    keyParameters: ['action', 'type', 'name', 'data'],
    example: 'n8n_manage_credentials({action: "getSchema", type: "httpHeaderAuth"}) then n8n_manage_credentials({action: "create", name: "My Auth", type: "httpHeaderAuth", data: {name: "X-API-Key", value: "secret"}})',
    performance: 'Fast - single API call per action',
    tips: [
      'Always use getSchema first to discover required fields before creating credentials',
      'Credential data values are never logged for security',
      'Use with n8n_audit_instance to fix security findings',
      'Actions: list, get, create, update, delete, getSchema',
    ]
  },
  full: {
    description: `Manage n8n credentials through a unified interface. Supports full lifecycle operations:

**Discovery:**
- **getSchema**: Retrieve the schema for a credential type, showing all required and optional fields with their types and descriptions. Always call this before creating credentials to know the exact field names and formats.

**Read Operations:**
- **list**: List all credentials with their names, types, and IDs. Does not return credential data values.
- **get**: Get a specific credential by ID, including its metadata and data fields.

**Write Operations:**
- **create**: Create a new credential with a name, type, and data fields. Requires name, type, and data.
- **update**: Update an existing credential by ID. Can update name and/or data fields.
- **delete**: Permanently delete a credential by ID.

**Security:** Credential data values (API keys, passwords, tokens) are never written to logs. The n8n API encrypts stored credential data at rest.`,
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'Operation to perform on credentials',
        enum: ['list', 'get', 'create', 'update', 'delete', 'getSchema'],
      },
      id: {
        type: 'string',
        required: false,
        description: 'Credential ID (required for get, update, delete)',
      },
      name: {
        type: 'string',
        required: false,
        description: 'Credential display name (required for create, optional for update)',
      },
      type: {
        type: 'string',
        required: false,
        description: 'Credential type identifier, e.g. httpHeaderAuth, httpBasicAuth, oAuth2Api (required for create and getSchema)',
        examples: ['httpHeaderAuth', 'httpBasicAuth', 'oAuth2Api', 'slackApi', 'gmailOAuth2Api'],
      },
      data: {
        type: 'object',
        required: false,
        description: 'Credential data fields as key-value pairs. Use getSchema to discover required fields (required for create, optional for update)',
      },
    },
    returns: `Depends on action:
- list: Array of credentials with id, name, type, createdAt, updatedAt
- get: Full credential object with id, name, type, and data fields
- create: Created credential object with id, name, type
- update: Updated credential object
- delete: Success confirmation message
- getSchema: Schema object with field definitions including name, type, required status, description, and default values`,
    examples: [
      '// Discover schema before creating\nn8n_manage_credentials({action: "getSchema", type: "httpHeaderAuth"})',
      '// Create an HTTP header auth credential\nn8n_manage_credentials({action: "create", name: "My API Key", type: "httpHeaderAuth", data: {name: "X-API-Key", value: "sk-abc123"}})',
      '// List all credentials\nn8n_manage_credentials({action: "list"})',
      '// Get a specific credential\nn8n_manage_credentials({action: "get", id: "123"})',
      '// Update credential data\nn8n_manage_credentials({action: "update", id: "123", data: {value: "new-secret-value"}})',
      '// Rename a credential\nn8n_manage_credentials({action: "update", id: "123", name: "Renamed Credential"})',
      '// Delete a credential\nn8n_manage_credentials({action: "delete", id: "123"})',
      '// Create basic auth credential\nn8n_manage_credentials({action: "create", name: "Service Auth", type: "httpBasicAuth", data: {user: "admin", password: "secret"}})',
    ],
    useCases: [
      'Provisioning credentials for new workflow integrations',
      'Rotating API keys and secrets on a schedule',
      'Remediating security findings from n8n_audit_instance',
      'Discovering available credential types and their required fields',
      'Bulk credential management across n8n instances',
      'Replacing hardcoded secrets with proper credential references',
    ],
    performance: 'Fast response expected: single HTTP API call per action, typically <200ms.',
    bestPractices: [
      'Always call getSchema before create to discover required fields and their formats',
      'Use descriptive names that identify the service and purpose (e.g., "Slack - Production Bot")',
      'Rotate credentials regularly by updating data fields',
      'After creating credentials, reference them in workflows instead of hardcoding secrets',
      'Use n8n_audit_instance to find credentials that need rotation or cleanup',
      'Verify credential validity by testing the workflow after creation',
    ],
    pitfalls: [
      'delete is permanent and cannot be undone - workflows using the credential will break',
      'Credential type must match exactly (case-sensitive) - use getSchema to verify',
      'OAuth2 credentials may require browser-based authorization flow that cannot be completed via API alone',
      'The list action does not return credential data values for security',
      'Requires N8N_API_URL and N8N_API_KEY to be configured',
    ],
    relatedTools: ['n8n_audit_instance', 'n8n_create_workflow', 'n8n_update_partial_workflow', 'n8n_health_check'],
  }
};
