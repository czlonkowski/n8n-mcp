"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolsDocumentation = void 0;
const discovery_1 = require("./discovery");
const configuration_1 = require("./configuration");
const validation_1 = require("./validation");
const templates_1 = require("./templates");
const system_1 = require("./system");
const guides_1 = require("./guides");
const workflow_management_1 = require("./workflow_management");
exports.toolsDocumentation = {
    tools_documentation: system_1.toolsDocumentationDoc,
    n8n_health_check: system_1.n8nHealthCheckDoc,
    n8n_audit_instance: system_1.n8nAuditInstanceDoc,
    ai_agents_guide: guides_1.aiAgentsGuide,
    search_nodes: discovery_1.searchNodesDoc,
    get_node: configuration_1.getNodeDoc,
    validate_node: validation_1.validateNodeDoc,
    validate_workflow: validation_1.validateWorkflowDoc,
    get_template: templates_1.getTemplateDoc,
    search_templates: templates_1.searchTemplatesDoc,
    n8n_create_workflow: workflow_management_1.n8nCreateWorkflowDoc,
    n8n_get_workflow: workflow_management_1.n8nGetWorkflowDoc,
    n8n_update_full_workflow: workflow_management_1.n8nUpdateFullWorkflowDoc,
    n8n_update_partial_workflow: workflow_management_1.n8nUpdatePartialWorkflowDoc,
    n8n_delete_workflow: workflow_management_1.n8nDeleteWorkflowDoc,
    n8n_list_workflows: workflow_management_1.n8nListWorkflowsDoc,
    n8n_validate_workflow: workflow_management_1.n8nValidateWorkflowDoc,
    n8n_autofix_workflow: workflow_management_1.n8nAutofixWorkflowDoc,
    n8n_test_workflow: workflow_management_1.n8nTestWorkflowDoc,
    n8n_executions: workflow_management_1.n8nExecutionsDoc,
    n8n_workflow_versions: workflow_management_1.n8nWorkflowVersionsDoc,
    n8n_deploy_template: workflow_management_1.n8nDeployTemplateDoc,
    n8n_manage_datatable: workflow_management_1.n8nManageDatatableDoc,
    n8n_generate_workflow: workflow_management_1.n8nGenerateWorkflowDoc,
    n8n_manage_credentials: workflow_management_1.n8nManageCredentialsDoc
};
//# sourceMappingURL=index.js.map