import { ToolDocumentation } from '../types';

export const n8nListCatalogDoc: ToolDocumentation = {
  name: 'n8n_list_catalog',
  category: 'workflow_management',
  essentials: {
    description: 'List instance-level catalog entries — projects (with the personal project marked) or tags — needed as inputs elsewhere, e.g. projectId for n8n_manage_agents and n8n_manage_datatable.',
    keyParameters: ['kind', 'query', 'limit'],
    example: 'n8n_list_catalog({kind: "projects"}) → n8n_list_catalog({kind: "tags", query: "prod"})',
    performance: '50-300 ms via the Public API; up to a few seconds when it falls back to n8n\'s MCP server',
    tips: [
      'projects marks the personal project with personal: true — use its id when a projectId is required and no team project applies.',
      'teamProjectsEnabled reflects the instance licence, not the current result set: true whenever GET /projects answered (even with only the personal project visible) or the official server says so; false only in the personal-only fallback.',
      'tags never falls back — it always reads the Public API.',
    ],
  },
  full: {
    description: `Reads the Public API first. For kind: "projects", GET /projects is Enterprise-licensed; on an unlicensed instance it answers 403 (older instances 404). On that refusal, this tool falls back to n8n's official MCP server's search_projects when N8N_MCP_ACCESS_TOKEN is configured (the official server lists projects regardless of the Public API's licence gate); when it is not configured, it returns just the caller's personal project, resolved the same way n8n_manage_folders resolves the 'personal' alias. If that resolution itself fails (e.g. an ambiguous or ungrafted instance), the tool returns an API_ERROR envelope with a hint instead of throwing.

teamProjectsEnabled reports the instance licence, computed per backend: on the Public API branch it is true whenever GET /projects succeeded at all — the endpoint itself is the licence gate, so a successful call means team projects are licensed even if none are visible to this API key; on the official-MCP fallback it is the official response's own teamProjectsEnabled flag when present, otherwise derived from whether any returned project is non-personal; in the personal-only fallback it is always false.

For kind: "tags", the Public API always answers — there is no fallback, since the official server's list_workflow_tags would return the same data.

query filters items by a case-insensitive substring match on name; limit caps the result count after filtering.`,
    parameters: {
      kind: { type: 'string', required: true, enum: ['projects', 'tags'], description: 'Which catalog to list' },
      query: { type: 'string', required: false, description: 'Case-insensitive name filter' },
      limit: { type: 'integer', required: false, description: 'Max items to return after filtering, 1-500' },
    },
    returns: '{success: true, kind, backend: "public-api" | "official-mcp", data: {items: [{id, name, type?, personal?}], teamProjectsEnabled?}} on success; {success: false, kind?, backend?, code, error, hint?} on failure. Codes: INVALID_ARGS, NOT_CONFIGURED, API_ERROR, and (via the official-MCP fallback) NOT_CONFIGURED, OFFICIAL_MCP_AUTH_FAILED, OFFICIAL_MCP_NOT_ENABLED, OFFICIAL_MCP_RATE_LIMITED, OFFICIAL_MCP_TOOL_UNAVAILABLE, OFFICIAL_MCP_TIMEOUT, OFFICIAL_MCP_TRANSPORT_ERROR, OFFICIAL_MCP_ERROR. An API_ERROR from the personal-only fallback (the caller\'s personal project could not be resolved) carries a hint pointing at either passing projectId explicitly or configuring N8N_MCP_ACCESS_TOKEN.',
    examples: [
      'n8n_list_catalog({kind: "projects"})',
      'n8n_list_catalog({kind: "projects", query: "marketing"})',
      'n8n_list_catalog({kind: "tags", query: "prod", limit: 20})',
    ],
    useCases: [
      'Resolve a projectId before n8n_manage_agents create or n8n_manage_datatable create',
      'Find the caller\'s personal project on an instance without team projects',
      'Look up a tag id by name before filtering workflows',
    ],
    performance: 'One HTTP round trip to the Public API; the official-MCP fallback (projects only, on a licence refusal) adds one more round trip to the instance.',
    errorHandling: 'API_ERROR from the Public API is returned as-is for tags and for any projects failure that is not 403/404. A 403/404 on projects triggers the fallback instead of an error.',
    bestPractices: [
      'Check teamProjectsEnabled before assuming a returned team project is usable for writes',
      'Use personal: true to find the personal project rather than matching on name',
    ],
    pitfalls: [
      'On the official-MCP fallback, only search_projects is available — a project the Public API would show but the official server doesn\'t expose won\'t appear',
      'tags has no fallback: without N8N_API_URL/N8N_API_KEY it returns NOT_CONFIGURED, never an official-MCP result',
    ],
    relatedTools: ['n8n_manage_agents', 'n8n_manage_datatable', 'n8n_manage_folders', 'n8n_list_workflows'],
  },
};
