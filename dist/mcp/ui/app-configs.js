"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UI_APP_CONFIGS = void 0;
exports.UI_APP_CONFIGS = [
    {
        id: 'operation-result',
        displayName: 'Operation Result',
        description: 'Visual summary of workflow operations (create, update, delete, test)',
        uri: 'ui://n8n-mcp/operation-result',
        mimeType: 'text/html;profile=mcp-app',
        toolPatterns: [
            'n8n_create_workflow',
            'n8n_update_full_workflow',
            'n8n_update_partial_workflow',
            'n8n_delete_workflow',
            'n8n_test_workflow',
            'n8n_autofix_workflow',
        ],
    },
    {
        id: 'validation-summary',
        displayName: 'Validation Summary',
        description: 'Visual summary of node and workflow validation results',
        uri: 'ui://n8n-mcp/validation-summary',
        mimeType: 'text/html;profile=mcp-app',
        toolPatterns: [
            'validate_node',
            'validate_workflow',
            'n8n_validate_workflow',
        ],
    },
];
//# sourceMappingURL=app-configs.js.map