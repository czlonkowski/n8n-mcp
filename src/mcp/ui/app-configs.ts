import type { UIAppConfig } from './types';

export const UI_APP_CONFIGS: UIAppConfig[] = [
  {
    id: 'operation-result',
    displayName: 'Operation Result',
    description: 'Visual summary of workflow operations (create, update, delete, test)',
    uri: 'ui://n8n-mcp/operation-result',
    mimeType: 'text/html',
    toolPatterns: [
      'n8n_create_workflow',
      'n8n_update_full_workflow',
      'n8n_update_partial_workflow',
      'n8n_delete_workflow',
      'n8n_test_workflow',
      'n8n_autofix_workflow',
      'n8n_deploy_template',
    ],
  },
  {
    id: 'validation-summary',
    displayName: 'Validation Summary',
    description: 'Visual summary of node and workflow validation results',
    uri: 'ui://n8n-mcp/validation-summary',
    mimeType: 'text/html',
    toolPatterns: [
      'validate_node',
      'validate_workflow',
      'n8n_validate_workflow',
    ],
  },
];
