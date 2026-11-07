# Workflow Builder Agent API

The self-hosted HTTP server exposes a two-step REST API for a frontend that collects a user's automation goal, reviews the generated workflow, and asks for confirmation before creating it. The agent uses the bundled node catalog and an OpenAI-compatible chat-completions endpoint. It does not activate workflows.

## Configuration

Set the usual HTTP server settings (`MCP_MODE=http`, `AUTH_TOKEN`) and an n8n API target (`N8N_API_URL` and `N8N_API_KEY`). In multi-tenant mode, provide `x-n8n-url` and `x-n8n-key` on both requests instead.

Configure the model on the server:

- `WORKFLOW_AGENT_API_KEY`: model API key; falls back to `N8N_MCP_LLM_API_KEY`, then `OPENAI_API_KEY`.
- `WORKFLOW_AGENT_BASE_URL`: OpenAI-compatible API base URL; defaults to `https://api.openai.com/v1`.
- `WORKFLOW_AGENT_MODEL`: model name; defaults to `gpt-4o-mini`.
- `WORKFLOW_AGENT_TIMEOUT_MS`: request timeout; defaults to `60000`.
- `WORKFLOW_AGENT_RATE_LIMIT_WINDOW` and `WORKFLOW_AGENT_RATE_LIMIT_MAX`: per-IP request limit; default is 10 requests per minute.

The model key must remain server-side. Do not embed `AUTH_TOKEN`, n8n API keys, or model credentials in browser code. Put an authenticated application backend or trusted identity-aware gateway between a public browser and this API. The existing `AUTH_TOKEN` is a shared server credential, not per-user authentication or RBAC. Configure `CORS_ORIGIN` to the trusted application origin when cross-origin requests are needed.

## Plan

`POST /api/agent/plan` requires bearer authentication and a configured n8n target. The server sends the goal and relevant node metadata to the configured model, validates the structured workflow draft, and returns either clarification questions or a reviewable draft.

```json
{
  "goal": "When a new order arrives, send the team a Slack message with the order total"
}
```

A ready response contains `plan.workflow`, `plan.validation`, and `draftToken`. The token expires after 10 minutes, is bound to the workflow content and n8n target, and can be consumed only once. If the goal is ambiguous, the response has `plan.status: "needs_input"` and `plan.questions`; if validation or credential checks cannot be resolved, it has `plan.status: "needs_revision"`. Neither response includes an approval token.

## Create

After a human reviews the exact returned workflow, `POST /api/agent/create` requires explicit approval and the token from the plan response:

```json
{
  "approved": true,
  "draftToken": "<token from plan response>",
  "workflow": { "name": "...", "nodes": [], "connections": {} }
}
```

The server rejects changed workflows, changed n8n targets, expired tokens, and invalid drafts. It revalidates the workflow immediately before creating it. n8n creates the workflow inactive; activation and credential setup remain separate user actions.

Both endpoints return JSON. `400` indicates invalid input or tenant configuration, `401` an invalid/expired draft token or missing authentication, `409` a changed draft or target, `422` workflow validation or n8n API rejection, `429` a rate-limit response, and `502` a model/n8n upstream failure. Responses include a `requestId` where processing has started. Audit events are emitted to structured server logs without recording the goal, model key, n8n API key, or workflow body.