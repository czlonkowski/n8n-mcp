import { ToolDocumentation } from '../types';

export const n8nManageAgentsDoc: ToolDocumentation = {
  name: 'n8n_manage_agents',
  category: 'workflow_management',
  essentials: {
    description: 'Create, configure, validate, run and publish n8n Agents (persisted assistants) through n8n\'s instance-level MCP server. Needs N8N_MCP_ACCESS_TOKEN and n8n >= 2.34 with the agents module.',
    keyParameters: ['action', 'args', 'timeoutMs'],
    example: 'n8n_manage_agents({action: "reference"}) → n8n_manage_agents({action: "create", args: {projectId, name, config: {model: "openai/gpt-4o-mini", instructions: "..."}}})',
    performance: '150-400 ms per action; call: 5-60 s per turn (one n8n execution each)',
    tips: [
      'Always read action=reference first: it returns the config schema and the exact mutate operations.',
      'Every mutate needs the configHash from the last get/create/mutate response; STALE_CONFIG means re-read it.',
      'publish only on explicit user request; call uses real credentials and tools.',
      'approvals[] in a call result are for the human to decide — resume with {type: "approval", approved, continuation} only after they say so.',
    ],
  },
  full: {
    description: `Thin adapter over n8n's official MCP agent tools. The action selects the official tool, args are forwarded verbatim, results are returned verbatim under data with our envelope and error codes.

Build sequence: reference → discover_assets (kind=models with provider, kind=integrations/workflows/subagents/mcpServers) → create (projectId, name, config) → mutate per resource (config.patch is RFC 6902; skill.upsert/delete, task.upsert/delete, customTool.upsert/delete) → validate → call (test) → publish (only when asked).

Gates: reference and search work for every agent; all other actions need the agent exposed to MCP (agents created here are exposed automatically).

Custom tools are TypeScript with only @n8n/agents and zod imports; errors from n8n's agent tooling (a compile failure, an unknown agentId) come back as AGENT_TOOL_ERROR.

Credentials: on this n8n generation the agents runtime rejects azureOpenAiApi and aws credentials as incompatible (reported as missing: ["credential"]); the response hint names the accepted credential types.`,
    parameters: {
      action: { type: 'string', required: true, description: 'reference | search | get | create | mutate | validate | call | publish | unpublish | revert | versions | delete | discover_assets | verify_mcp_server | update_integration' },
      args: { type: 'object', description: 'Per action — search: projectId?, query?, publishedOnly?, excludeAgentId?, limit?; get: agentId, versionId?; create: projectId, name, config?; mutate: agentId, baseConfigHash, operation; validate: agentId; call: agentId, request ({type:"message", message, sessionId?} | {type:"approval", approved, continuation}); publish/revert: agentId, versionId?; unpublish/delete: agentId; versions: agentId, limit?, offset?; discover_assets: projectId, kind (models|integrations|workflows|subagents|mcpServers), provider?, credentialId?, query?; verify_mcp_server: projectId, name, url, transport?, authentication?, credential?; update_integration: agentId, action (connect|disconnect), type, credentialId, settings?, replacesCredentialId?' },
      timeoutMs: { type: 'integer', description: 'Request timeout, 5000-600000 ms. Default 30000, 180000 for call. On expiry the run continues in n8n (see n8n_executions).' },
    },
    returns: '{success, action, officialTool, data} on success; {success:false, action, code, error, hint?, officialError?} on failure. Codes: NOT_CONFIGURED, OFFICIAL_MCP_AUTH_FAILED, OFFICIAL_MCP_NOT_ENABLED, OFFICIAL_MCP_RATE_LIMITED, OFFICIAL_MCP_TOOL_UNAVAILABLE, OFFICIAL_MCP_URL_REJECTED, OFFICIAL_MCP_TIMEOUT, OFFICIAL_MCP_TRANSPORT_ERROR, INVALID_ARGS, STALE_CONFIG, AGENT_NOT_RUNNABLE, AGENT_TOOL_ERROR, OFFICIAL_MCP_ERROR.',
    examples: [
      'n8n_manage_agents({action: "discover_assets", args: {projectId: "p1", kind: "models", provider: "openai"}})',
      'n8n_manage_agents({action: "mutate", args: {agentId: "a1", baseConfigHash: "…", operation: {type: "skill.upsert", skill: {name: "triage", instructions: "…"}}}})',
      'n8n_manage_agents({action: "call", args: {agentId: "a1", request: {type: "message", message: "Summarise yesterday\'s tickets"}}, timeoutMs: 300000})',
    ],
    useCases: ['Build a persisted n8n Agent from a spec', 'Add skills, tasks and custom tools to an existing agent', 'Validate and test-run an agent before the user publishes it', 'Inspect agent versions and revert'],
    performance: 'Each action is one HTTP round trip to the instance; call adds the model latency.',
    errorHandling: 'STALE_CONFIG → get and retry with the new configHash. AGENT_NOT_RUNNABLE → validate and fix errors/missing. OFFICIAL_MCP_TIMEOUT on call → the turn continues in n8n; reuse sessionId instead of re-sending.',
    bestPractices: ['One mutate per resource, re-reading configHash between them', 'Validate before call and before publish', 'Name test agents "[TEST] …" and delete them afterwards', 'Never publish, delete or approve without the user saying so'],
    pitfalls: ['args are forwarded verbatim — a misspelled field is reported by n8n as INVALID_ARGS', 'timeoutMs belongs at the top level, not inside args', 'The MCP access token is separate from the Public API key'],
    relatedTools: ['n8n_manage_credentials', 'n8n_list_catalog', 'n8n_executions', 'n8n_health_check'],
  },
};
