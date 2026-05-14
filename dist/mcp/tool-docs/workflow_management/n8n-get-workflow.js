"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.n8nGetWorkflowDoc = void 0;
exports.n8nGetWorkflowDoc = {
    name: 'n8n_get_workflow',
    category: 'workflow_management',
    essentials: {
        description: 'Get workflow by ID with different detail levels. n8n has a draft/publish model: the workflow body is the draft; use mode="active" for the published graph.',
        keyParameters: ['id', 'mode'],
        example: 'n8n_get_workflow({id: "workflow_123", mode: "structure"})',
        performance: 'Fast (50-200ms)',
        tips: [
            'mode="full" (default): Draft workflow + metadata (heavy activeVersion payload stripped, activeVersionId pointer retained)',
            'mode="details": Full workflow + execution stats',
            'mode="active": Published graph that is actually running (errors if workflow was never activated)',
            'mode="structure": Just nodes and connections (topology)',
            'mode="minimal": Only id, name, active status, tags'
        ]
    },
    full: {
        description: `**Draft vs published.** n8n keeps a draft (the workflow body's nodes/connections — what you see in the editor) and an active version (the published graph that actually runs). Saving in the editor updates the draft; publishing promotes it to the active version. The two diverge whenever there are unpublished edits. Older n8n versions don't have this split — \`workflow.nodes\` is the only graph.

**Modes:**
- full (default): Draft workflow with all metadata. The heavy nested \`activeVersion\` payload is omitted to keep responses small, but \`activeVersionId\` is preserved so callers know whether a published version exists.
- details: Full draft + execution statistics (success/error counts, last execution time)
- active: The published (running) graph. On older n8n versions that don't have the draft/publish split, falls back to \`workflow.nodes\` when \`active: true\` so the mode stays usable across n8n versions. Returns \`code: 'NO_ACTIVE_VERSION'\` only for inactive workflows that were never published.
- structure: Nodes and connections only - useful for topology analysis
- minimal: Just id, name, active status, and tags - fastest response`,
        parameters: {
            id: { type: 'string', required: true, description: 'Workflow ID to retrieve' },
            mode: { type: 'string', required: false, description: 'Detail level: "full" (default), "details", "active", "structure", "minimal"' }
        },
        returns: `Depends on mode:
- full: Draft workflow object (id, name, active, nodes[], connections{}, settings, createdAt, updatedAt, activeVersionId)
- details: Full draft + executionStats (successCount, errorCount, lastExecution, etc.)
- active: Published graph as { id, name, active, activeVersionId, versionCreatedAt, versionName, nodes[], connections{}, settings, tags, createdAt, updatedAt }. \`versionCreatedAt\` is the version row's creation time (within ~1s of the publish event in current n8n). Returns { success: false, code: 'NO_ACTIVE_VERSION' } if the workflow has no published version.
- structure: { nodes: [...], connections: {...} } - topology only
- minimal: { id, name, active, tags, createdAt, updatedAt }`,
        examples: [
            '// Get draft workflow (default)\nn8n_get_workflow({id: "abc123"})',
            '// Get draft + execution stats\nn8n_get_workflow({id: "abc123", mode: "details"})',
            '// Get the published/running graph\nn8n_get_workflow({id: "abc123", mode: "active"})',
            '// Get just the topology\nn8n_get_workflow({id: "abc123", mode: "structure"})',
            '// Quick metadata check\nn8n_get_workflow({id: "abc123", mode: "minimal"})'
        ],
        useCases: [
            'View and edit the draft (mode=full)',
            'Analyze workflow performance (mode=details)',
            'Inspect what is actually running in production (mode=active)',
            'Diff draft vs published before promoting (mode=full + mode=active)',
            'Clone or compare workflow structure (mode=structure)',
            'List workflows with status (mode=minimal)'
        ],
        performance: `Response times vary by mode:
- minimal: ~20-50ms (smallest response)
- structure: ~30-80ms (nodes + connections only)
- full: ~50-200ms (draft, no activeVersion duplicate)
- active: ~50-200ms (single-shaped published graph)
- details: ~100-300ms (includes execution queries)`,
        bestPractices: [
            'Use mode="minimal" when listing or checking status',
            'Use mode="structure" for workflow analysis or cloning',
            'Use mode="full" (default) when editing the draft',
            'Use mode="active" when you need to reason about what is actually running, not what is being edited',
            'Use mode="details" for debugging execution issues',
            'Validate workflow after retrieval if planning modifications'
        ],
        pitfalls: [
            'Requires N8N_API_URL and N8N_API_KEY configured',
            'mode="full" no longer carries the nested activeVersion payload — switch to mode="active" if you previously read it from there',
            'mode="active" returns NO_ACTIVE_VERSION for workflows that were never activated',
            'mode="details" adds database queries for execution stats',
            'Workflow must exist or returns 404 error',
            'Credentials are referenced by ID but values not included'
        ],
        relatedTools: ['n8n_list_workflows', 'n8n_update_full_workflow', 'n8n_update_partial_workflow', 'n8n_validate_workflow']
    }
};
//# sourceMappingURL=n8n-get-workflow.js.map