import { ToolDocumentation } from '../types';

export const n8nValidateWorkflowDoc: ToolDocumentation = {
  name: 'n8n_validate_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Validate workflow from n8n instance by ID - checks nodes, connections, expressions, and returns errors/warnings',
    keyParameters: ['id'],
    example: 'n8n_validate_workflow({id: "wf_abc123"})',
    performance: 'Network-dependent (100-500ms) - fetches and validates workflow',
    tips: [
      'Use options.profile to control validation strictness (minimal/runtime/ai-friendly/strict)',
      'Validation includes node configs, connections, and n8n expression syntax',
      'Returns categorized errors, warnings, and actionable fix suggestions'
    ]
  },
  full: {
    description: `Validates a workflow stored in your n8n instance by fetching it via API and running comprehensive validation checks. This tool:

- Fetches the workflow from n8n using the workflow ID
- Validates all node configurations based on their schemas
- Checks workflow connections and data flow
- Validates n8n expression syntax in all fields
- Returns categorized issues with fix suggestions

The validation uses the same engine as validate_workflow but works with workflows already in n8n, making it perfect for validating existing workflows before execution.

Requires N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) environment variables to be configured.`,
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The workflow ID to validate from your n8n instance'
      },
      options: {
        type: 'object',
        required: false,
        description: 'Validation options: {validateNodes: bool (default true), validateConnections: bool (default true), validateExpressions: bool (default true), profile: "minimal"|"runtime"|"ai-friendly"|"strict" (default "runtime")}'
      }
    },
    returns: 'ValidationResult object containing isValid boolean, arrays of errors/warnings, and suggestions for fixes',
    examples: [
      'n8n_validate_workflow({id: "wf_abc123"}) - Validate with default settings',
      'n8n_validate_workflow({id: "wf_abc123", options: {profile: "strict"}}) - Strict validation',
      'n8n_validate_workflow({id: "wf_abc123", options: {validateExpressions: false}}) - Skip expression validation'
    ],
    useCases: [
      'Validating workflows before running them in production',
      'Checking imported workflows for compatibility',
      'Debugging workflow execution failures',
      'Ensuring workflows follow best practices',
      'Pre-deployment validation in CI/CD pipelines'
    ],
    performance: 'Depends on workflow size and API latency. Typically 100-500ms for medium workflows.',
    bestPractices: [
      'Run validation before activating workflows in production',
      'Use "runtime" profile for pre-execution checks',
      'Use "strict" profile for code review and best practices',
      'Fix errors before warnings - errors will likely cause execution failures',
      'Pay attention to expression validation - syntax errors are common'
    ],
    pitfalls: [
      'Requires valid API credentials - check n8n_health_check first',
      'Large workflows may take longer to validate',
      'Some warnings may be intentional (e.g., optional parameters)',
      'Profile affects validation time - strict is slower but more thorough',
      'Expression validation may flag working but non-standard syntax'
    ],
    relatedTools: ['validate_workflow', 'n8n_get_workflow', 'n8n_health_check', 'n8n_autofix_workflow']
  }
};