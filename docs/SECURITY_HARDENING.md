# Security & Hardening

n8n-mcp is a proxy to the n8n REST API. **The security boundary is n8n itself, not n8n-mcp.** Every operation available through n8n-mcp can be performed identically using the n8n REST API with the same API key. n8n-mcp does not grant any capability beyond what the n8n API already provides.

Whoever has access to the MCP session effectively has the same privileges as the configured `N8N_API_KEY`. For vulnerability reporting, see [SECURITY.md](../SECURITY.md).

## Hardening Options

| Environment Variable | Purpose | Example |
|---|---|---|
| `AUTH_TOKEN` | Required for HTTP mode. Use a strong random value (min 32 chars). | `openssl rand -base64 32` |
| `AUTH_TOKEN_FILE` | Path to a file holding the token, used instead of `AUTH_TOKEN` so the value stays out of the process environment (for example a Docker secret). | `/run/secrets/mcp_token` |
| `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW` | Failed authentication attempts allowed per IP, and the window in milliseconds. Defaults: 20 per 900000 (15 minutes). | `10` / `900000` |
| `TRUST_PROXY` | Number of reverse-proxy hops to trust for the client IP. Set it when n8n-mcp runs behind a proxy, otherwise the rate limit counts every client as the proxy's address. Do not set it without a proxy, or clients can choose their own IP with `X-Forwarded-For`. | `1` |
| `CORS_ORIGIN` | Origin allowed to call the HTTP endpoint from a browser. Defaults to `*`. | `https://your-client.example` |
| `N8N_MCP_MAX_SESSIONS` / `SESSION_TIMEOUT_MINUTES` | Cap on concurrent MCP sessions (default 100; new sessions are refused at the cap) and idle timeout in minutes (default 30). Lower them to limit memory use per process. | `20` / `15` |
| `DISABLED_TOOLS` | Comma-separated list of MCP tools to disable. | `n8n_create_workflow,n8n_test_workflow` |
| `DISABLED_TOOL_OPERATIONS` | Disable single operations of a tool instead of the whole tool, as `tool:op1,op2;tool2:op3`. See `.env.example` for a read-only recipe. | `n8n_executions:delete;n8n_workflow_versions:delete,rollback,prune` |
| `N8N_MCP_DISABLE_UI_APPS` | Set to `true` to stop advertising result cards (MCP Apps UI metadata). Tools and their text results are unchanged. | `true` |
| `N8N_MCP_VERSION_CHECK_DISABLED` | Set to `true` or `1` to stop `n8n_health_check` from requesting the latest n8n-mcp version from `registry.npmjs.org`. With `N8N_MCP_TELEMETRY_DISABLED=true` as well, n8n-mcp sends no requests other than those to your n8n instance. The health check then reports `upToDate: null` and `checkStatus: "disabled"`. | `true` |
| `N8N_MCP_TELEMETRY_DISABLED` | Set to `true` to turn off anonymous usage telemetry. See [PRIVACY.md](../PRIVACY.md). | `true` |
| `WORKFLOW_VERSION_RETENTION_DAYS` | Days to keep the workflow backups n8n-mcp stores in its database before each update. Backups hold full workflow JSON, including node parameters. Older ones are deleted at startup; `0` keeps them indefinitely. Default 30. | `7` |
| `WEBHOOK_SECURITY_MODE` | SSRF gate applied to webhook trigger URLs, the n8n API client (`N8N_API_URL`), and per-request URLs from the `x-n8n-url` header. Default `strict` blocks localhost, RFC1918, other IANA special-purpose ranges that are not globally reachable (including `100.64.0.0/10` shared address space, multicast, and broadcast), and cloud metadata endpoints. Use `moderate` to allow localhost while still blocking the rest; "localhost" there means every plain localhost spelling (loopback literals plus `0.0.0.0`), so `http://localhost:5678`, `http://127.0.0.1:5678` (any address in `127.0.0.0/8`), `http://0.0.0.0:5678` and `http://[::1]:5678` are all accepted. `permissive` allows all of them except metadata; only suitable when n8n-mcp and n8n share a private Docker/Kubernetes network, or when your n8n instance is reachable only over a CGNAT-range overlay such as Tailscale. Cloud metadata endpoints (169.254.169.254, metadata.google.internal, etc.) are blocked in all modes. | `moderate` |

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
