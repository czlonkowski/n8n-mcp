import { ToolDocumentation } from '../types';

export const n8nCreateDataTableDoc: ToolDocumentation = {
  name: 'n8n_create_data_table',
  category: 'workflow_management',
  essentials: {
    description: 'Create a new data table in n8n. Requires n8n enterprise or cloud with the data tables feature enabled.',
    keyParameters: ['name', 'columns'],
    example: 'n8n_create_data_table({name: "Contacts", columns: [{name: "email", type: "string"}]})',
    performance: 'Fast (100-300ms)',
    tips: [
      'Available column types: string, number, boolean, date, json',
      'Columns are optional — a table can be created without columns',
      'Requires n8n enterprise or cloud plan with data tables feature',
      'projectId cannot be set via the public API — use the n8n UI for project assignment'
    ]
  },
  full: {
    description: 'Creates a new data table in n8n. Data tables are structured, persistent storage for workflow data. Each table can have typed columns (string, number, boolean, date, json). Requires the data tables feature to be enabled on the n8n instance.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name for the new data table' },
      columns: {
        type: 'array',
        required: false,
        description: 'Column definitions. Each column has a name and optional type (string, number, boolean, date, json). Defaults to string if type is omitted.'
      }
    },
    returns: 'Object with id and name of the created data table on success.',
    examples: [
      'n8n_create_data_table({name: "Orders"}) - Create table without columns',
      'n8n_create_data_table({name: "Contacts", columns: [{name: "email", type: "string"}, {name: "score", type: "number"}]}) - Create table with typed columns',
      'n8n_create_data_table({name: "Events", columns: [{name: "payload", type: "json"}, {name: "occurred_at", type: "date"}]})'
    ],
    useCases: [
      'Persist structured workflow data across executions',
      'Store lookup tables for workflow logic',
      'Accumulate records from multiple workflow runs',
      'Share data between different workflows'
    ],
    performance: 'Fast operation — typically 100-300ms.',
    bestPractices: [
      'Define columns upfront to enforce schema consistency',
      'Use typed columns for numeric or date data to enable proper filtering',
      'Use json type for nested or variable-structure data'
    ],
    pitfalls: [
      'Requires N8N_API_URL and N8N_API_KEY configured',
      'Feature only available on n8n enterprise or cloud plans',
      'projectId cannot be set via the public API',
      'Column types cannot be changed after table creation via API'
    ],
    relatedTools: ['n8n_create_workflow', 'n8n_list_workflows', 'n8n_health_check']
  }
};
