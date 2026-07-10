# Autohand Code Setup

Connect n8n-MCP to [Autohand Code](https://github.com/autohandai/code-cli/) for n8n workflow development.

## Quick Setup via CLI

On macOS, Linux, WSL, or Git Bash, add the documentation and validation tools with:

```bash
autohand mcp add n8n-mcp env MCP_MODE=stdio LOG_LEVEL=error DISABLE_CONSOLE_OUTPUT=true npx n8n-mcp
```

Add `--scope project` before `n8n-mcp` to save the server in the current project's `.autohand` configuration instead of your user configuration.

For workflow management tools, also pass your n8n URL and API key through `env`:

```bash
autohand mcp add n8n-mcp env \
  MCP_MODE=stdio \
  LOG_LEVEL=error \
  DISABLE_CONSOLE_OUTPUT=true \
  N8N_API_URL=https://your-n8n-instance.com \
  N8N_API_KEY=your-api-key \
  npx n8n-mcp
```

Replace the URL and API key placeholders with your n8n instance details. Autohand Code starts the configured MCP server automatically; use `/mcp` inside a session to see its connection status and available tools.

## Project Instructions

For optimal results, add the instructions from the [main README's Claude Project Setup section](../README.md#claude-project-setup) to your project's `AGENTS.md`.
