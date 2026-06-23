# Railway Deployment Guide for n8n-MCP

Deploy n8n-MCP to Railway's cloud platform with zero configuration and connect it to Claude Desktop from anywhere.

## 🚀 Quick Deploy

Deploy n8n-MCP with one click:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/VY6UOG?referralCode=n8n-mcp)

## 📋 Overview

Railway deployment provides:
- ☁️ **Instant cloud hosting** - No server setup required
- 🔒 **Secure by default** - HTTPS included, auth token warnings
- 🌐 **Global access** - Connect from any Claude Desktop
- ⚡ **Auto-scaling** - Railway handles the infrastructure
- 📊 **Built-in monitoring** - Logs and metrics included

## ⚠️ Before You Deploy

`AUTH_TOKEN` is **required** — the server refuses to start without it. How you handle it depends on how you deploy:

> ⚠️ **Required — `AUTH_TOKEN`**: Open your service's **Variables** tab and make sure `AUTH_TOKEN` is set to a secure value of at least 32 characters:
> ```bash
> # Generate a secure token locally:
> openssl rand -base64 32
> ```
> - **Deploying via the one-click template?** A placeholder `AUTH_TOKEN` is created for you — you **must replace** it with your own secure value (the server warns every 5 minutes until you do).
> - **Deploying from your own repo/Dockerfile?** Railway does **not** auto-create the variable — you **must add** `AUTH_TOKEN` yourself, or the server will not start.
>
> Either way, Railway redeploys automatically once the variable is saved. See [Configure Security](#2-configure-security) below for the full walkthrough.

> 💡 **Optional**: To enable n8n workflow-management integration, also set `N8N_API_URL` and `N8N_API_KEY`. See [Optional: n8n Integration](#optional-n8n-integration).

## 🎯 Step-by-Step Deployment

### 1. Deploy to Railway

1. **Click the Deploy button** above
2. **Sign in to Railway** (or create account)
3. **Configure your deployment**:
   - Project name (optional)
   - Environment (leave as "production")
   - Region (choose closest to you)
4. **Click "Deploy"** and wait ~2-3 minutes

### 2. Configure Security

**IMPORTANT**: The deployment includes a default AUTH_TOKEN for instant functionality, but you MUST change it:

![Railway Dashboard - Variables Tab](./img/railway-variables.png)

1. **Go to your Railway dashboard**
2. **Click on your n8n-mcp service**
3. **Navigate to "Variables" tab**
4. **Find `AUTH_TOKEN`** 
5. **Replace with secure token**:
   ```bash
   # Generate secure token locally:
   openssl rand -base64 32
   ```
6. **Railway will automatically redeploy** with the new token

> ⚠️ **Security Warning**: The server displays warnings every 5 minutes until you change the default token!

### 3. Get Your Service URL

![Railway Dashboard - Domain Settings](./img/railway-domain.png)

1. In Railway dashboard, click on your service
2. Go to **"Settings"** tab
3. Under **"Domains"**, you'll see your URL:
   ```
   https://your-app-name.up.railway.app
   ```
4. Copy this URL for Claude Desktop configuration and add /mcp at the end

### 4. Connect Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "n8n-railway": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-app-name.up.railway.app/mcp",
        "--header",
        "Authorization: Bearer YOUR_SECURE_TOKEN_HERE"
      ]
    }
  }
}
```

**Configuration file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Restart Claude Desktop** after saving the configuration.

## 🔧 Environment Variables

### Default Variables (Pre-configured)

These are automatically set by the Railway template:

| Variable | Default Value | Description |
|----------|--------------|-------------|
| `AUTH_TOKEN` | `REPLACE_THIS...` | **⚠️ CHANGE IMMEDIATELY** |
| `MCP_MODE` | `http` | Required for cloud deployment |
| `NODE_ENV` | `production` | Production optimizations |
| `LOG_LEVEL` | `info` | Balanced logging |
| `TRUST_PROXY` | `1` | Railway runs behind proxy |
| `CORS_ORIGIN` | `*` | Allow any origin |
| `HOST` | `0.0.0.0` | Listen on all interfaces |
| `PORT` | (Railway provides) | Don't set manually |
| `AUTH_RATE_LIMIT_WINDOW` | `900000` (15 min) | Rate limit window (v2.16.3+) |
| `AUTH_RATE_LIMIT_MAX` | `20` | Max auth attempts (v2.16.3+) |
| `WEBHOOK_SECURITY_MODE` | `strict` | SSRF protection mode (v2.16.3+) |

### Optional Variables

| Variable | Default Value | Description |
|----------|--------------|-------------|
| `N8N_MODE` | `false` | Enable n8n integration mode for MCP Client Tool |
| `N8N_API_URL` | - | URL of your n8n instance (for workflow management) |
| `N8N_API_KEY` | - | API key from n8n Settings → API |

### Optional: n8n Integration

#### For n8n MCP Client Tool Integration

To use n8n-MCP with n8n's MCP Client Tool node:

1. **Go to Railway dashboard** → Your service → **Variables**
2. **Add this variable**:
   - `N8N_MODE`: Set to `true` to enable n8n integration mode
3. **Save changes** - Railway will redeploy automatically

#### For n8n API Integration (Workflow Management)

To enable workflow management features:

1. **Go to Railway dashboard** → Your service → **Variables**
2. **Add these variables**:
   - `N8N_API_URL`: Your n8n instance URL (e.g., `https://n8n.example.com`)
   - `N8N_API_KEY`: API key from n8n Settings → API
3. **Save changes** - Railway will redeploy automatically

## 🏗️ Architecture Details

### How It Works

```
Claude Desktop → mcp-remote → Railway (HTTPS) → n8n-MCP Server
```

1. **Claude Desktop** uses `mcp-remote` as a bridge
2. **mcp-remote** converts stdio to HTTP requests
3. **Railway** provides HTTPS endpoint and infrastructure
4. **n8n-MCP** runs in HTTP mode on Railway

### Single-Instance Design

**Important**: The n8n-MCP HTTP server is designed for single n8n instance deployment:
- n8n API credentials are configured server-side via environment variables
- All clients connecting to the server share the same n8n instance
- For multi-tenant usage, deploy separate Railway instances

### Security Model

- **Bearer Token Authentication**: All requests require the AUTH_TOKEN
- **HTTPS by Default**: Railway provides SSL certificates
- **Environment Isolation**: Each deployment is isolated
- **No State Storage**: Server is stateless (database is read-only)

## 🚨 Troubleshooting

### Connection Issues

**"Invalid URL" error in Claude Desktop:**
- Ensure you're using the exact configuration format shown above
- Don't add "connect" or other arguments before the URL
- The URL should end with `/mcp`

**"Unauthorized" error:**
- Check that your AUTH_TOKEN matches exactly (no extra spaces)
- Ensure the Authorization header format is correct: `Authorization: Bearer TOKEN`

**"Cannot connect to server":**
- Verify your Railway deployment is running (check Railway dashboard)
- Ensure the URL is correct and includes `https://`
- Check Railway logs for any errors

**Windows: "The filename, directory name, or volume label syntax is incorrect" or npx command not found:**

This is a common Windows issue with spaces in Node.js installation paths. The error occurs because Claude Desktop can't properly execute npx.

**Solution 1: Use node directly (Recommended)**
```json
{
  "mcpServers": {
    "n8n-railway": {
      "command": "node",
      "args": [
        "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js",
        "-y",
        "mcp-remote",
        "https://your-app-name.up.railway.app/mcp",
        "--header",
        "Authorization: Bearer YOUR_SECURE_TOKEN_HERE"
      ]
    }
  }
}
```

**Solution 2: Use cmd wrapper**
```json
{
  "mcpServers": {
    "n8n-railway": {
      "command": "cmd",
      "args": [
        "/C",
        "\"C:\\Program Files\\nodejs\\npx\" -y mcp-remote https://your-app-name.up.railway.app/mcp --header \"Authorization: Bearer YOUR_SECURE_TOKEN_HERE\""
      ]
    }
  }
}
```

To find your exact npx path, open Command Prompt and run: `where npx`

### Railway-Specific Issues

**Build failures:**
- Railway uses AMD64 architecture - the template is configured for this
- Check build logs in Railway dashboard for specific errors

**Environment variable issues:**
- Variables are case-sensitive
- Don't include quotes in the Railway dashboard (only in JSON config)
- Railway automatically restarts when you change variables

**Domain not working:**
- It may take 1-2 minutes for the domain to become active
- Check the "Deployments" tab to ensure the latest deployment succeeded

## 📊 Monitoring & Logs

### View Logs

1. Go to Railway dashboard
2. Click on your n8n-mcp service
3. Click on **"Logs"** tab
4. You'll see real-time logs including:
   - Server startup messages
   - Authentication attempts
   - API requests (without sensitive data)
   - Any errors or warnings

### Monitor Usage

Railway provides metrics for:
- **Memory usage** (typically ~100-200MB)
- **CPU usage** (minimal when idle)
- **Network traffic**
- **Response times**

## 💰 Pricing & Limits

### Railway Free Tier
- **$5 free credit** monthly
- **500 hours** of runtime
- **Sufficient for personal use** of n8n-MCP

### Estimated Costs
- **n8n-MCP typically uses**: ~0.1 GB RAM
- **Monthly cost**: ~$2-3 for 24/7 operation
- **Well within free tier** for most users

## 🔄 Updates & Maintenance

### Manual Updates

Since the Railway template uses a specific Docker image tag, updates are manual:

1. **Check for updates** on [GitHub](https://github.com/czlonkowski/n8n-mcp)
2. **Update image tag** in Railway:
   - Go to Settings → Deploy → Docker Image
   - Change tag from current to new version
   - Click "Redeploy"

### Automatic Updates (Not Recommended)

You could use the `latest` tag, but this may cause unexpected breaking changes.

## 🔒 Security Features (v2.16.3+)

Railway deployments include enhanced security features:

### Rate Limiting
- **Automatic brute force protection** - 20 attempts per 15 minutes per IP
- **Configurable limits** via `AUTH_RATE_LIMIT_WINDOW` and `AUTH_RATE_LIMIT_MAX`
- **Standard rate limit headers** for client awareness

### SSRF Protection
- **Default strict mode** blocks localhost, private IPs, and cloud metadata
- **Cloud metadata always blocked** (169.254.169.254, metadata.google.internal, etc.)
- **Use `moderate` mode only if** connecting to local n8n instance

**Security Configuration:**
```bash
# In Railway Variables tab:
WEBHOOK_SECURITY_MODE=strict          # Production (recommended)
# or
WEBHOOK_SECURITY_MODE=moderate        # If using local n8n with port forwarding

# Rate limiting (defaults are good for most use cases)
AUTH_RATE_LIMIT_WINDOW=900000         # 15 minutes
AUTH_RATE_LIMIT_MAX=20                # 20 attempts per IP
```

## 📝 Best Practices

1. **Always change the default AUTH_TOKEN immediately**
2. **Use strong, unique tokens** (32+ characters)
3. **Monitor logs** for unauthorized access attempts
4. **Keep credentials secure** - never commit them to git
5. **Use environment variables** for all sensitive data
6. **Regular updates** - check for new versions monthly

## 🆘 Getting Help

- **Railway Documentation**: [docs.railway.app](https://docs.railway.app)
- **n8n-MCP Issues**: [GitHub Issues](https://github.com/czlonkowski/n8n-mcp/issues)
- **Railway Community**: [Discord](https://discord.gg/railway)

## 🎉 Success!

Once connected, you can use all n8n-MCP features from Claude Desktop:
- Search and explore 500+ n8n nodes
- Get node configurations and examples
- Validate workflows before deployment
- Manage n8n workflows (if API configured)

The cloud deployment means you can access your n8n knowledge base from any computer with Claude Desktop installed!