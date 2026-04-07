import { ToolDocumentation } from '../types';

export const n8nDeployTemplateDoc: ToolDocumentation = {
  name: 'n8n_deploy_template',
  category: 'workflow_management',
  essentials: {
    description: 'Deploy a workflow template from n8n.io directly to your n8n instance. Deploys first, then auto-fixes common issues (expression format, typeVersions).',
    keyParameters: ['templateId', 'name', 'autoUpgradeVersions', 'autoFix', 'stripCredentials'],
    example: 'n8n_deploy_template({templateId: 2776, name: "My Deployed Template"})',
    performance: 'Network-dependent',
    tips: [
      'Auto-fixes expression format issues after deployment',
      'Workflow created inactive - configure credentials in n8n UI first',
      'Returns list of required credentials and fixes applied',
      'Use search_templates to find template IDs'
    ]
  },
  full: {
    description: 'Deploys a workflow template from n8n.io directly to your n8n instance. This tool deploys first, then automatically fixes common issues like missing expression prefixes (=) and outdated typeVersions. Templates are stored locally and fetched from the database. The workflow is always created in an inactive state, allowing you to configure credentials before activation.',
    parameters: {
      templateId: { type: 'number', required: true, description: 'Template ID from n8n.io (find via search_templates)' },
      name: { type: 'string', description: 'Custom workflow name (default: template name)' },
      autoUpgradeVersions: { type: 'boolean', description: 'Upgrade node typeVersions to latest supported (default: true)' },
      autoFix: { type: 'boolean', description: 'Auto-apply fixes after deployment for expression format issues, missing = prefix, etc. (default: true)' },
      stripCredentials: { type: 'boolean', description: 'Remove credential references - user configures in n8n UI (default: true)' }
    },
    returns: 'Object with workflowId, name, nodeCount, triggerType, requiredCredentials array, url, templateId, templateUrl, autoFixStatus (success/failed/skipped), and fixesApplied array',
    examples: [
      `// Deploy template with default settings (auto-fix enabled)
n8n_deploy_template({templateId: 2776})`,
      `// Deploy with custom name
n8n_deploy_template({
  templateId: 2776,
  name: "My Google Drive to Airtable Sync"
})`,
      `// Deploy without auto-fix (not recommended)
n8n_deploy_template({
  templateId: 2776,
  autoFix: false
})`,
      `// Keep original node versions (useful for compatibility)
n8n_deploy_template({
  templateId: 2776,
  autoUpgradeVersions: false
})`
    ],
    useCases: [
      'Quickly deploy pre-built workflow templates',
      'Set up common automation patterns',
      'Bootstrap new projects with proven workflows',
      'Deploy templates found via search_templates'
    ],
    performance: 'Network-dependent - Typically 300-800ms (template fetch + workflow creation + autofix)',
    bestPractices: [
      'Use search_templates to find templates by use case',
      'Review required credentials in the response',
      'Check autoFixStatus in response - "success", "failed", or "skipped"',
      'Check fixesApplied in response to see what was automatically corrected',
      'Configure credentials in n8n UI before activating',
      'Test workflow before connecting to production systems'
    ],
    pitfalls: [
      '**REQUIRES N8N_API_URL and N8N_API_KEY (or N8N_API_COOKIE) environment variables** - tool unavailable without n8n API access',
      'Workflows created in INACTIVE state - must configure credentials and activate in n8n',
      'Templates may reference services you do not have (Slack, Google, etc.)',
      'Template database must be populated - run npm run fetch:templates if templates not found',
      'Some issues may not be auto-fixable (e.g., missing required fields that need user input)'
    ],
    relatedTools: ['search_templates', 'get_template', 'n8n_create_workflow', 'n8n_autofix_workflow']
  }
};
