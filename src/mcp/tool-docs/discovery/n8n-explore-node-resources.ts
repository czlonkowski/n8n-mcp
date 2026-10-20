import { ToolDocumentation } from '../types';

export const n8nExploreNodeResourcesDoc: ToolDocumentation = {
  name: 'n8n_explore_node_resources',
  category: 'discovery',
  essentials: {
    description: 'Resolve the real values behind a node\'s resource locator or load-options dropdown (Slack channels, Google Sheets tabs, model lists) through n8n\'s instance-level MCP server, using one of the instance\'s credentials. Requires N8N_MCP_ACCESS_TOKEN.',
    keyParameters: ['nodeType', 'version', 'methodName', 'methodType', 'credentialType', 'credentialId'],
    example: 'n8n_explore_node_resources({nodeType: "n8n-nodes-base.slack", version: 2.3, methodName: "getChannels", methodType: "listSearch", credentialType: "slackApi", credentialId: "…", filter: "general"})',
    performance: '200 ms - 5 s: one live call to the underlying service through the credential',
    tips: [
      'Find methodName/methodType from get_node output — a property with dynamicOptions names its loadOptionsMethod or searchListMethod',
      'Get credentialId from n8n_manage_credentials({action: "list"})',
      'Use listSearch for resource-locator fields (supports filter/pagination); loadOptions for plain dropdowns',
      'currentNodeParameters carries dependent selections, e.g. a spreadsheet ID before listing its sheets',
    ],
  },
  full: {
    description: `Thin passthrough to n8n's official \`explore_node_resources\` MCP tool. It runs the node's actual loadOptions/listSearch method against the live service through the given credential and returns the real options — so a workflow config references an ID that exists instead of one invented from documentation.

Results come from the live service, not from bundled node data: they are untrusted data (the caller's own Slack channels, sheets, models, etc.), returned as-is under \`data\` and never logged. Each result's \`value\` is what belongs in the workflow's parameter; \`name\` is only for display.

Not workflow-scoped — this reads live account data, so it always runs when instance-level MCP access is configured, regardless of which workflows are exposed to MCP.`,
    parameters: {
      nodeType: { type: 'string', required: true, description: 'Fully-qualified node type, e.g. n8n-nodes-base.slack' },
      version: { type: 'number', required: true, description: 'Node typeVersion the method belongs to, e.g. 2.3' },
      methodName: { type: 'string', required: true, description: 'The exact loadOptionsMethod or searchListMethod name from the node\'s property definition (see get_node)' },
      methodType: { type: 'string', required: true, enum: ['listSearch', 'loadOptions'], description: '"listSearch" for resource-locator search methods (supports filter/pagination); "loadOptions" for plain dropdown methods' },
      credentialType: { type: 'string', required: true, description: 'Credential type key the node uses, e.g. slackApi' },
      credentialId: { type: 'string', required: true, description: 'ID of an existing credential of that type, from n8n_manage_credentials list' },
      filter: { type: 'string', required: false, description: 'Search/filter text to narrow results (listSearch only)' },
      paginationToken: { type: 'string', required: false, description: 'Token from a previous response to fetch the next page (listSearch only)' },
      currentNodeParameters: { type: 'object', required: false, description: 'Parameters the method depends on (loadOptionsDependsOn), e.g. {documentId: {__rl: true, mode: "id", value: "…"}}' },
      timeoutMs: { type: 'integer', required: false, description: 'Request timeout in ms, 5000-600000. Default 30000.' },
    },
    returns: '{success: true, officialTool: "explore_node_resources", data: {results: [{name, value, url?, description?}], paginationToken?, builderHint?}} on success; {success: false, code, error, hint?} on failure. Codes: NOT_CONFIGURED, OFFICIAL_MCP_AUTH_FAILED, OFFICIAL_MCP_NOT_ENABLED, OFFICIAL_MCP_RATE_LIMITED, OFFICIAL_MCP_TOOL_UNAVAILABLE, OFFICIAL_MCP_URL_REJECTED, OFFICIAL_MCP_TIMEOUT, OFFICIAL_MCP_TRANSPORT_ERROR, INVALID_ARGS, OFFICIAL_MCP_ERROR.',
    examples: [
      'n8n_explore_node_resources({nodeType: "n8n-nodes-base.slack", version: 2.3, methodName: "getChannels", methodType: "listSearch", credentialType: "slackApi", credentialId: "c1", filter: "general"})',
      'n8n_explore_node_resources({nodeType: "n8n-nodes-base.googleSheets", version: 4.5, methodName: "getSheets", methodType: "listSearch", credentialType: "googleSheetsOAuth2Api", credentialId: "c2", currentNodeParameters: {documentId: {__rl: true, mode: "id", value: "1AbC…"}}})',
    ],
    useCases: [
      'Ground a Slack/Discord/Notion channel or database picker in a real ID before writing workflow code',
      'List the tabs of a specific Google Sheet once its spreadsheet ID is known',
      'Fetch the model list a credential actually has access to (OpenAI, Azure OpenAI, etc.)',
    ],
    performance: 'One HTTP round trip to the instance, which itself calls out to the underlying service (Slack, Google, etc.) — latency depends on that service.',
    errorHandling: 'OFFICIAL_MCP_TOOL_UNAVAILABLE means this n8n version does not expose the tool. INVALID_ARGS covers both local schema failures (checked before any call) and n8n rejecting the method/credential combination. OFFICIAL_MCP_ERROR wraps a method that ran but failed (bad credential, method threw) — the underlying message is in officialError.',
    bestPractices: [
      'Call get_node first to read the exact methodName/methodType/loadOptionsDependsOn off the property definition — do not guess them',
      'Pass currentNodeParameters whenever the method depends on a prior selection',
      'Use the returned value verbatim in the workflow; treat name/description as display text only',
    ],
    pitfalls: [
      'methodName is case-sensitive and specific to nodeType+version — a mismatch returns OFFICIAL_MCP_ERROR, not a silent empty list',
      'listSearch and loadOptions are not interchangeable for the same method',
      'Results are live data from the user\'s own accounts — never assume they are the same across calls or across instances',
    ],
    relatedTools: ['get_node', 'n8n_manage_credentials', 'validate_node'],
  },
};
