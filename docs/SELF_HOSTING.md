# Self-Hosting Options

Prefer to run n8n-MCP yourself? Choose your deployment method:

## npx (Quick Local Setup)

Get n8n-MCP running in minutes:

[![n8n-mcp Video Quickstart Guide](../thumbnail.png)](https://youtu.be/5CccjiLLyaY?si=Z62SBGlw9G34IQnQ&t=343)

**Prerequisites:** [Node.js](https://nodejs.org/) installed on your system

```bash
# Run directly with npx (no installation needed!)
npx n8n-mcp
```

Add to Claude Desktop config:

> ⚠️ **Important**: The `MCP_MODE: "stdio"` environment variable is **required** for Claude Desktop. Without it, you will see JSON parsing errors like `"Unexpected token..."` in the UI. This variable ensures that only JSON-RPC messages are sent to stdout, preventing debug logs from interfering with the protocol.

**Basic configuration (documentation tools only):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true"
      }
    }
  }
}
```

**Full configuration (with n8n management tools):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

> **Note**: npx will download and run the latest version automatically. The package includes a pre-built database with all n8n node information.

**Configuration file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Restart Claude Desktop after updating configuration** - That's it! 🎉

## Docker (Isolated & Reproducible)

**Prerequisites:** Docker installed on your system

<details>
<summary><strong>📦 Install Docker</strong> (click to expand)</summary>

**macOS:**
```bash
# Using Homebrew
brew install --cask docker

# Or download from https://www.docker.com/products/docker-desktop/
```

**Linux (Ubuntu/Debian):**
```bash
# Update package index
sudo apt-get update

# Install Docker
sudo apt-get install docker.io

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER
# Log out and back in for this to take effect
```

**Windows:**
```bash
# Option 1: Using winget (Windows Package Manager)
winget install Docker.DockerDesktop

# Option 2: Using Chocolatey
choco install docker-desktop

# Option 3: Download installer from https://www.docker.com/products/docker-desktop/
```

**Verify installation:**
```bash
docker --version
```
</details>

```bash
# Pull the Docker image (~280MB, no n8n dependencies!)
docker pull ghcr.io/czlonkowski/n8n-mcp:latest
```

> **⚡ Ultra-optimized:** Our Docker image is 82% smaller than typical n8n images because it contains NO n8n dependencies - just the runtime MCP server with a pre-built database!

Add to Claude Desktop config:

**Basic configuration (documentation tools only):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "DISABLE_CONSOLE_OUTPUT=true",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

**Full configuration (with n8n management tools):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "DISABLE_CONSOLE_OUTPUT=true",
        "-e", "N8N_API_URL=https://your-n8n-instance.com",
        "-e", "N8N_API_KEY=your-api-key",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

>💡 Tip: If you're running n8n locally on the same machine (e.g., via Docker), use http://host.docker.internal:5678 as the N8N_API_URL.

> **Note**: The n8n API credentials are optional. Without them, you'll have access to all documentation and validation tools. With them, you'll additionally get workflow management capabilities (create, update, execute workflows).

### Local n8n Instance Configuration

If you're running n8n locally (e.g., `http://localhost:5678` or Docker), you need to allow localhost webhooks:

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "--init",
        "-e", "MCP_MODE=stdio",
        "-e", "LOG_LEVEL=error",
        "-e", "DISABLE_CONSOLE_OUTPUT=true",
        "-e", "N8N_API_URL=http://host.docker.internal:5678",
        "-e", "N8N_API_KEY=your-api-key",
        "-e", "WEBHOOK_SECURITY_MODE=moderate",
        "ghcr.io/czlonkowski/n8n-mcp:latest"
      ]
    }
  }
}
```

> ⚠️ **Important:** Set `WEBHOOK_SECURITY_MODE=moderate` to allow webhooks to your local n8n instance. This is safe for local development while still blocking private networks and cloud metadata.

**Important:** The `-i` flag is required for MCP stdio communication.

> 🔧 If you encounter any issues with Docker, check our [Docker Troubleshooting Guide](./DOCKER_TROUBLESHOOTING.md).

**Configuration file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Restart Claude Desktop after updating configuration** - That's it! 🎉

## Local Installation (For Development)

**Prerequisites:** [Node.js](https://nodejs.org/) installed on your system

```bash
# 1. Clone and setup
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp
npm install
npm run build
npm run rebuild

# 2. Test it works
npm start
```

Add to Claude Desktop config:

**Basic configuration (documentation tools only):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/n8n-mcp/dist/mcp/index.js"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true"
      }
    }
  }
}
```

**Full configuration (with n8n management tools):**
```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/n8n-mcp/dist/mcp/index.js"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

> **Note**: The n8n API credentials can be configured either in a `.env` file (create from `.env.example`) or directly in the Claude config as shown above.

> 💡 Tip: If you're running n8n locally on the same machine (e.g., via Docker), use http://host.docker.internal:5678 as the N8N_API_URL.

## Railway Cloud Deployment (One-Click Deploy)

**Prerequisites:** Railway account (free tier available)

Deploy n8n-MCP to Railway's cloud platform with zero configuration:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/n8n-mcp?referralCode=n8n-mcp)

**Benefits:**
- ☁️ **Instant cloud hosting** - No server setup required
- 🔒 **Secure by default** - HTTPS included, auth token warnings
- 🌐 **Global access** - Connect from any Claude Desktop
- ⚡ **Auto-scaling** - Railway handles the infrastructure
- 📊 **Built-in monitoring** - Logs and metrics included

**Quick Setup:**
1. Click the "Deploy on Railway" button above
2. Sign in to Railway (or create a free account)
3. Configure your deployment (project name, region)
4. Click "Deploy" and wait ~2-3 minutes
5. Copy your deployment URL and auth token
6. Add to Claude Desktop config using the HTTPS URL

> 📚 **For detailed setup instructions, troubleshooting, and configuration examples, see our [Railway Deployment Guide](./RAILWAY_DEPLOYMENT.md)**

**Configuration file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Restart Claude Desktop after updating configuration** - That's it! 🎉
