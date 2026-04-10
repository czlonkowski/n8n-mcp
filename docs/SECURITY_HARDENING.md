# Security & Hardening

n8n-mcp is a proxy to the n8n REST API. **The security boundary is n8n itself, not n8n-mcp.** Every operation available through n8n-mcp can be performed identically using the n8n REST API with the same API key. n8n-mcp does not grant any capability beyond what the n8n API already provides.

Whoever has access to the MCP session effectively has the same privileges as the configured `N8N_API_KEY`. For vulnerability reporting, see [SECURITY.md](../SECURITY.md).

## Hardening Options

| Environment Variable | Purpose | Example |
|---|---|---|
| `AUTH_TOKEN` | Required for HTTP mode. Use a strong random value (min 32 chars). | `openssl rand -base64 32` |
| `DISABLED_TOOLS` | Comma-separated list of MCP tools to disable. | `n8n_create_workflow,n8n_test_workflow` |

## Restricting Workflow Capabilities

The workflow management tools can create and execute workflows on your n8n instance, including workflows with Code nodes. This is by design -- Code nodes are a first-class n8n feature. To control what Code nodes can do, configure these on **your n8n instance**:

- **Code node sandbox**: Enabled by default in n8n, restricts execution scope
- **`N8N_CODE_NODE_ALLOWED_MODULES`**: Controls which Node.js modules Code nodes can import
- **RBAC** (n8n Enterprise): Fine-grained access control per user/role

If workflow creation via MCP is not needed at all, disable the tools:
```bash
DISABLED_TOOLS=n8n_create_workflow,n8n_update_full_workflow,n8n_update_partial_workflow,n8n_test_workflow
```

## Prompt Injection Awareness

When n8n-mcp returns data from an n8n instance (workflow names, descriptions, execution results), that content is surfaced to the LLM. If a malicious actor has access to modify workflows on the shared n8n instance, they could craft workflow names or descriptions designed to manipulate the AI assistant.

This is a general characteristic of all LLM-agent systems that surface user-generated content. Mitigations include:
- Restricting who can create or modify workflows on the n8n instance
- Using `DISABLED_TOOLS` to limit which MCP tools are available
- Reviewing AI-generated workflow actions before execution
