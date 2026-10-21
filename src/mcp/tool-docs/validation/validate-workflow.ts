import { ToolDocumentation } from '../types';

export const validateWorkflowDoc: ToolDocumentation = {
  name: 'validate_workflow',
  category: 'validation',
  essentials: {
    description: 'Full workflow validation: structure, connections, expressions, AI tools. Returns errors/warnings/fixes. Essential before deploy.',
    keyParameters: ['workflow', 'options'],
    example: 'validate_workflow({workflow: {nodes: [...], connections: {...}}})',
    performance: 'Moderate (100-500ms)',
    tips: [
      'Always validate before n8n_create_workflow to catch errors early',
      'Use options.profile="minimal" for quick checks during development',
      'AI tool connections are automatically validated for proper node references',
      'Detects operator structure issues (binary vs unary, singleValue requirements)'
    ]
  },
  full: {
    description: 'Performs comprehensive validation of n8n workflows including structure, node configurations, connections, and expressions. This is a three-layer validation system that catches errors before deployment, validates complex multi-node workflows, checks all n8n expressions for syntax errors, and ensures proper node connections and data flow.',
    parameters: {
      workflow: { 
        type: 'object', 
        required: true, 
        description: 'The complete workflow JSON to validate. Must include nodes array and connections object.' 
      },
      options: { 
        type: 'object', 
        required: false, 
        description: 'Validation options object' 
      },
      'options.validateNodes': { 
        type: 'boolean', 
        required: false, 
        description: 'Validate individual node configurations. Default: true' 
      },
      'options.validateConnections': { 
        type: 'boolean', 
        required: false, 
        description: 'Validate node connections and flow. Default: true' 
      },
      'options.validateExpressions': { 
        type: 'boolean', 
        required: false, 
        description: 'Validate n8n expressions syntax and references. Default: true' 
      },
      'options.profile': { 
        type: 'string', 
        required: false, 
        description: 'Validation profile for node validation: minimal, runtime (default), ai-friendly, strict' 
      }
    },
    returns: 'Object with valid (boolean), errors (array), warnings (array), statistics (object), and suggestions (array)',
    examples: [
      'validate_workflow({workflow: myWorkflow}) - Full validation with default settings',
      'validate_workflow({workflow: myWorkflow, options: {profile: "minimal"}}) - Quick validation for editing',
      'validate_workflow({workflow: myWorkflow, options: {validateExpressions: false}}) - Skip expression validation'
    ],
    useCases: [
      'Pre-deployment validation to catch all workflow issues',
      'Quick validation during workflow development',
      'Validate workflows with AI Agent nodes and tool connections',
      'Check expression syntax before workflow execution',
      'Ensure workflow structure integrity after modifications'
    ],
    performance: 'Moderate (100-500ms). Depends on workflow size and validation options. Expression validation adds ~50-100ms.',
    bestPractices: [
      'Always validate workflows before creating or updating in n8n',
      'Use minimal profile during development, strict profile before production',
      'Pay attention to warnings - they often indicate potential runtime issues',
      'Validate after any workflow modifications, especially connection changes',
      'Check statistics to understand workflow complexity',
      '**Auto-sanitization runs during create/update**: Operator structures and missing metadata are automatically fixed when workflows are created or updated, but validation helps catch issues before they reach n8n',
      'If validation detects operator issues, they will be auto-fixed during n8n_create_workflow or n8n_update_partial_workflow'
    ],
    pitfalls: [
      'Large workflows (100+ nodes) may take longer to validate',
      'Expression validation requires proper node references to exist',
      'Some warnings may be acceptable depending on use case',
      'Validation cannot catch all runtime errors (e.g., API failures)',
      'Profile setting only affects node validation, not connection/expression checks',
      'A DEPRECATED_NODE warning (Function, Function Item, LangChain Code) means n8n 2.44+ rejects saving the workflow if that node was added or edited; an untouched existing one is accepted'
    ],
    relatedTools: ['validate_node', 'n8n_create_workflow', 'n8n_update_partial_workflow', 'n8n_autofix_workflow']
  }
};