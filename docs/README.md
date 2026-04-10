# n8n-MCP Documentation

## Getting Started
- [Self-Hosting Guide](./SELF_HOSTING.md) - npx, Docker, Railway, and local installation
- [Claude Desktop Setup](./README_CLAUDE_SETUP.md) - Step-by-step Claude Desktop configuration

## Deployment
- [n8n Deployment Guide](./N8N_DEPLOYMENT.md) - Production deployment with n8n
- [HTTP Deployment](./HTTP_DEPLOYMENT.md) - Remote HTTP server setup
- [Railway Deployment](./RAILWAY_DEPLOYMENT.md) - One-click cloud deployment
- [Docker Troubleshooting](./DOCKER_TROUBLESHOOTING.md) - Common Docker issues and solutions

## IDE Setup
- [Claude Code](./CLAUDE_CODE_SETUP.md)
- [Visual Studio Code](./VS_CODE_PROJECT_SETUP.md)
- [Cursor](./CURSOR_SETUP.md)
- [Windsurf](./WINDSURF_SETUP.md)
- [Codex](./CODEX_SETUP.md)
- [Antigravity](./ANTIGRAVITY_SETUP.md)

## Configuration
- [Security & Hardening](./SECURITY_HARDENING.md) - Trust model, hardening options
- [Database Configuration](./DATABASE_CONFIGURATION.md) - SQLite adapters, memory optimization
- [Dependency Updates](./DEPENDENCY_UPDATES.md) - Keeping n8n packages in sync

## Reference
- [Workflow Diff Operations](./workflow-diff-examples.md) - Token-efficient workflow updates
- [Automated Releases](./AUTOMATED_RELEASES.md) - Release process for maintainers
- [Acknowledgments](./ACKNOWLEDGMENTS.md) - Credits and template attribution

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_MODE` | Server mode: `stdio` or `http` | `stdio` |
| `AUTH_TOKEN` | Authentication token for HTTP mode | Required |
| `DISABLED_TOOLS` | Comma-separated list of tools to disable | None |
| `PORT` | HTTP server port | `3000` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Getting Help

1. Check the [Docker Troubleshooting Guide](./DOCKER_TROUBLESHOOTING.md)
2. Open an issue on [GitHub](https://github.com/czlonkowski/n8n-mcp/issues)
