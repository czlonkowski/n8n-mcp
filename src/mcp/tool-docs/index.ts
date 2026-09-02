import { ToolDocumentation } from './types';

// Import all tool documentations
import { searchNodesDoc, n8nExploreNodeResourcesDoc } from './discovery';
import { getNodeDoc } from './configuration';
import { validateNodeDoc, validateWorkflowDoc } from './validation';
import { getTemplateDoc, searchTemplatesDoc } from './templates';
import {
  toolsDocumentationDoc,
  n8nHealthCheckDoc,
  n8nAuditInstanceDoc,
  queryResponseArtifactDoc
} from './system';
import { aiAgentsGuide } from './guides';
import {
  n8nCreateWorkflowDoc,
  n8nGetWorkflowDoc,
  n8nUpdateFullWorkflowDoc,
  n8nUpdatePartialWorkflowDoc,
  n8nDeleteWorkflowDoc,
  n8nListWorkflowsDoc,
  n8nValidateWorkflowDoc,
  n8nAutofixWorkflowDoc,
  n8nTestWorkflowDoc,
  n8nExecutionsDoc,
  n8nEvaluationsDoc,
  n8nWorkflowVersionsDoc,
  n8nDeployTemplateDoc,
  n8nManageDatatableDoc,
  n8nManageCredentialsDoc,
  n8nManageFoldersDoc,
  n8nManageAgentsDoc,
  n8nListCatalogDoc
} from './workflow_management';

// Combine all tool documentations into a single object
export const toolsDocumentation: Record<string, ToolDocumentation> = {
  // System tools
  tools_documentation: toolsDocumentationDoc,
  n8n_health_check: n8nHealthCheckDoc,
  n8n_audit_instance: n8nAuditInstanceDoc,

  // Response-bounding wrappers. Registered by src/services/mcp-response-bounding.ts
  // rather than src/mcp/tools.ts, which is why they were missing here.
  query_response_artifact: queryResponseArtifactDoc,

  // Guides
  ai_agents_guide: aiAgentsGuide,

  // Discovery tools
  search_nodes: searchNodesDoc,
  n8n_explore_node_resources: n8nExploreNodeResourcesDoc,

  // Configuration tools
  get_node: getNodeDoc,

  // Validation tools
  validate_node: validateNodeDoc,
  validate_workflow: validateWorkflowDoc,

  // Template tools
  get_template: getTemplateDoc,
  search_templates: searchTemplatesDoc,

  // Workflow Management tools (n8n API)
  n8n_create_workflow: n8nCreateWorkflowDoc,
  n8n_get_workflow: n8nGetWorkflowDoc,
  n8n_update_full_workflow: n8nUpdateFullWorkflowDoc,
  n8n_update_partial_workflow: n8nUpdatePartialWorkflowDoc,
  n8n_delete_workflow: n8nDeleteWorkflowDoc,
  n8n_list_workflows: n8nListWorkflowsDoc,
  n8n_validate_workflow: n8nValidateWorkflowDoc,
  n8n_autofix_workflow: n8nAutofixWorkflowDoc,
  n8n_test_workflow: n8nTestWorkflowDoc,
  n8n_executions: n8nExecutionsDoc,
  n8n_evaluations: n8nEvaluationsDoc,
  n8n_workflow_versions: n8nWorkflowVersionsDoc,
  n8n_deploy_template: n8nDeployTemplateDoc,
  n8n_manage_datatable: n8nManageDatatableDoc,
  n8n_manage_credentials: n8nManageCredentialsDoc,
  n8n_manage_folders: n8nManageFoldersDoc,
  n8n_manage_agents: n8nManageAgentsDoc,
  n8n_list_catalog: n8nListCatalogDoc
};

// Re-export types
export type { ToolDocumentation } from './types';
