# Kiro Setup

Connect n8n-MCP to Kiro IDE or Kiro CLI using a local stdio server. No n8n instance or API key is needed for documentation and validation tools.

## Prerequisites

- Install Node.js 22.12+ (recommended) with npm, and make sure `node` and `npx` are available to Kiro on `PATH`.
- Use a current Kiro IDE or Kiro CLI release. The paths and commands below follow [Kiro's MCP configuration guide](https://kiro.dev/docs/mcp/configuration/).

## Choose a configuration file

### Kiro IDE

Open the command palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux) and select:

- **Kiro: Open workspace MCP config (JSON)** for `.kiro/settings/mcp.json` in your project.
- **Kiro: Open user MCP config (JSON)** for `~/.kiro/settings/mcp.json`, shared across workspaces.

Enable MCP support in Kiro's settings if it is disabled. Save the configuration to apply changes; Kiro reconnects the server automatically.

### Kiro CLI

Create or edit `.kiro/settings/mcp.json` in your project, or `~/.kiro/settings/mcp.json` for user-wide configuration. Start `kiro-cli` from the project directory when using workspace configuration.

Workspace entries override user entries with the same server name. In the CLI, a custom agent's `mcpServers` configuration takes precedence over both files, so check it if your changes do not appear.

## Basic configuration (documentation and validation tools)

Add this entry to the chosen file. If `mcpServers` already exists, merge the `n8n-mcp` entry into it rather than replacing your other servers.

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true"
      },
      "autoApprove": []
    }
  }
}
```

`-y` lets npm install the package without an interactive prompt. The stdio and logging settings keep non-protocol output off the MCP channel. Leaving `autoApprove` empty avoids blanket tool approval; review tool requests in Kiro.

## Optional configuration (n8n management tools)

To manage workflows on a live n8n instance, use this configuration instead:

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "https://your-n8n-instance.example.com",
        "N8N_API_KEY": "${N8N_API_KEY}"
      },
      "autoApprove": []
    }
  }
}
```

Replace `N8N_API_URL` with your n8n instance's base URL, not an MCP endpoint. Create an API key in n8n under **Settings → API** and set `N8N_API_KEY` in the environment used to launch Kiro. The `${N8N_API_KEY}` reference keeps the actual key out of the JSON file:

- **IDE:** Allow expansion of `N8N_API_KEY` when prompted, or add it under **Mcp Approved Env Vars** in settings. Ensure the Kiro process inherits the variable; a desktop-launched IDE may not inherit your terminal's environment.
- **CLI:** Export the variable before starting `kiro-cli`. Project `.env` files are not loaded automatically by Kiro CLI.

Do not commit API keys. Management tools have the privileges of the configured n8n API key: use a development instance, back up workflows, and review changes before execution. For localhost/private-network instances and tool restrictions, see [Security & Hardening](./SECURITY_HARDENING.md) and the [Self-Hosting Guide](./SELF_HOSTING.md).

## Verify the connection

1. Save the configuration. In the IDE, check the MCP server status in the Kiro panel. In a CLI chat session, run `/mcp` to see loaded servers, connection status, and available tools.
2. Confirm that `n8n-mcp` is connected and exposes tools such as `tools_documentation`, `search_nodes`, and `get_node`.
3. Ask Kiro: “Use n8n-mcp to find the documentation for the HTTP Request node.” Approve the tool request if prompted.
4. If you configured management tools, ask Kiro to run `n8n_health_check` to verify API connectivity before making workflow changes.

## Troubleshooting

- **Server does not start:** Check `node --version` and `npx --version` in the environment that launches Kiro. If necessary, set `command` to the absolute path of your `npx` executable. The first run needs network access to download the package.
- **Server is missing or uses old settings:** Check JSON syntax and workspace/user/custom-agent overrides. On older Kiro releases, consult that release's MCP documentation or update Kiro.
- **Management tools are missing:** Check that `N8N_API_URL` and `N8N_API_KEY` are set and that Kiro can expand the key reference. Reconnect the server after changing its launch environment.
- **Local n8n requests are blocked:** Review `WEBHOOK_SECURITY_MODE` in [Security & Hardening](./SECURITY_HARDENING.md); do not disable network protections indiscriminately.

This guide configures MCP tools only. Converting the bundled skills to Kiro Steering files is a separate follow-up, not required for the MCP connection.
