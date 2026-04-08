# HTTP Deployment Guide for n8n-MCP

Deploy n8n-MCP as a remote HTTP server to provide n8n knowledge to compatible MCP Client from anywhere.

## 🎯 Overview

n8n-MCP HTTP mode enables:
- ☁️ Cloud deployment (VPS, Docker, Kubernetes)
- 🌐 Remote access from any Claude Desktop /Windsurf / other MCP Client 
- 🔒 Token-based authentication
- ⚡ Production-ready performance (~12ms response time)
- 🚀 Optional n8n management tools (16 additional tools when configured)
- ❌ Does not work with n8n MCP Tool

## 📐 Deployment Scenarios

### 1. Local Development (Simplest)
Use **stdio mode** - Claude Desktop connects directly to the Node.js process:
```
Claude Desktop → n8n-mcp (stdio mode)
```
- ✅ No HTTP server needed
- ✅ No authentication required
- ✅ Fastest performance
- ❌ Only works locally

### 2. Local HTTP Server
Run HTTP server locally for testing remote features:
```
Claude Desktop → http-bridge.js → localhost:3000
```
- ✅ Test HTTP features locally
- ✅ Multiple Claude instances can connect
- ✅ Good for development
- ❌ Still only local access

### 3. Remote Server
Deploy to cloud for access from anywhere:
```
Claude Desktop → mcp-remote → https://your-server.com
```
- ✅ Access from anywhere
- ✅ Team collaboration
- ✅ Production-ready
- ❌ Requires server setup
- Deploy to your VPS - if you just want remote acces, consider deploying to Railway -> [Railway Deployment Guide](./RAILWAY_DEPLOYMENT.md)


## 📋 Prerequisites

**Server Requirements:**
- Node.js 16+ or Docker
- 512MB RAM minimum
- Public IP or domain name
- (Recommended) SSL certificate for HTTPS

**Client Requirements:**
- Claude Desktop
- Node.js 18+ (for mcp-remote)
- Or Claude Pro/Team (for native remote MCP)

## 🚀 Quick Start

### Option 1: Docker Deployment (Recommended for Production)

```bash
# 1. Create environment file
cat > .env << EOF
AUTH_TOKEN=$(openssl rand -base64 32)
MCP_MODE=http
PORT=3000
# Optional: Enable n8n management tools
# N8N_API_URL=https://your-n8n-instance.com
# N8N_API_KEY=your-api-key-here
# Security Configuration (v2.16.3+)
# Rate limiting (default: 20 attempts per 15 minutes)
AUTH_RATE_LIMIT_WINDOW=900000
AUTH_RATE_LIMIT_MAX=20
# SSRF protection mode (default: strict)
# Use 'moderate' for local n8n, 'strict' for production
WEBHOOK_SECURITY_MODE=strict
EOF

# 2. Deploy with Docker
docker run -d \
  --name n8n-mcp \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  ghcr.io/czlonkowski/n8n-mcp:latest

# 3. Verify deployment
curl http://localhost:3000/health
```

### Option 2: Local Development (Without Docker)

```bash
# 1. Clone and setup
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp
npm install
npm run build
npm run rebuild

# 2. Configure environment
export MCP_MODE=http
export AUTH_TOKEN=$(openssl rand -base64 32)
export PORT=3000

# 3. Start server
npm run start:http
```

### Option 3: Direct stdio Mode (Simplest for Local)

Skip HTTP entirely and use stdio mode directly:

```json
{
  "mcpServers": {
    "n8n-local": {
      "command": "node",
      "args": [
        "/path/to/n8n-mcp/dist/mcp/index.js"
      ],
      "env": {
        "N8N_API_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

💡 **Save your AUTH_TOKEN** - clients will need it to connect!

### Self-Signed Certificates

If your n8n instance uses a self-signed SSL certificate, you need to configure the `N8N_CERT_PATH` environment variable:

#### Docker with Certificate

```bash
# 1. Create environment file with certificate path
cat > .env << EOF
AUTH_TOKEN=$(openssl rand -base64 32)
USE_FIXED_HTTP=true
MCP_MODE=http
PORT=3000
N8N_CERT_PATH=/app/certs/n8n.crt
N8N_API_URL=https://your-n8n-instance.com
N8N_API_KEY=your-api-key-here
EOF

# 2. Deploy with Docker and mount certificate
docker run -d \
  --name n8n-mcp \
  --restart unless-stopped \
  --env-file .env \
  -v /path/to/your/certificate.crt:/app/certs/n8n.crt:ro \
  -p 3000:3000 \
  ghcr.io/czlonkowski/n8n-mcp:latest
```

#### Docker Compose with Certificate

Add the following to your `docker-compose.yml`:

```yaml
services:
  n8n-mcp:
    image: ghcr.io/czlonkowski/n8n-mcp:latest
    environment:
      # ... other environment variables ...
      N8N_CERT_PATH: /app/certs/n8n.crt
    volumes:
      - n8n-mcp-data:/app/data
      - /path/to/your/certificate.crt:/app/certs/n8n.crt:ro
```

#### Local Development with Certificate

```bash
# Set the certificate path
export N8N_CERT_PATH=/path/to/your/certificate.crt
export N8N_API_URL=https://your-n8n-instance.com
export N8N_API_KEY=your-api-key

# Start the server
npm run start:http
```

#### Certificate Troubleshooting

- **Format**: Certificate must be in PEM format (.crt or .pem file)
- **Permissions**: Ensure the certificate file is readable by the process
- **Path**: Use absolute paths to avoid resolution issues
- **Testing**: You can test the certificate with `openssl s_client -connect your-n8n-instance.com:443 -showcerts`

## ⚙️ Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|------|
| `MCP_MODE` | Must be set to `http` | `http` |
| `AUTH_TOKEN` or `AUTH_TOKEN_FILE` | Authentication method | See security section |

### Optional Settings

| Variable | Description | Default | Since |
|----------|-------------|---------|-------|
| `PORT` | Server port | `3000` | v1.0 |
| `HOST` | Bind address | `0.0.0.0` | v1.0 |
| `LOG_LEVEL` | Log verbosity (error/warn/info/debug) | `info` | v1.0 |
| `NODE_ENV` | Environment | `production` | v1.0 |
| `TRUST_PROXY` | Trust proxy headers (0=off, 1+=hops) | `0` | v2.7.6 |
| `BASE_URL` | Explicit public URL | Auto-detected | v2.7.14 |
| `PUBLIC_URL` | Alternative to BASE_URL | Auto-detected | v2.7.14 |
| `CORS_ORIGIN` | CORS allowed origins | `*` | v2.7.8 |
| `AUTH_TOKEN_FILE` | Path to token file | - | v2.7.10 |

### n8n Management Tools (Optional)

Enable 16 additional tools for managing n8n workflows by configuring API access:

⚠️ **Requires v2.7.1+** - Earlier versions had an issue with tool registration in Docker environments.

| Variable | Description | Example |
|----------|-------------|---------|
| `N8N_API_URL` | Your n8n instance URL | `https://your-n8n.com` |
| `N8N_API_KEY` | n8n API key (from Settings > API) | `n8n_api_key_xxx` |
| `N8N_API_TIMEOUT` | Request timeout (ms) | `30000` |
| `N8N_API_MAX_RETRIES` | Max retry attempts | `3` |

#### What This Enables

When configured, you get **16 additional tools** (total: 39 tools):

**Workflow Management (11 tools):**
- `n8n_create_workflow` - Create new workflows
- `n8n_get_workflow` - Get workflow by ID
- `n8n_update_full_workflow` - Update entire workflow
- `n8n_update_partial_workflow` - Update using diff operations (v2.7.0+)
- `n8n_delete_workflow` - Delete workflows
- `n8n_list_workflows` - List all workflows
- And more workflow detail/structure tools

**Execution Management (4 tools):**
- `n8n_trigger_webhook_workflow` - Execute via webhooks
- `n8n_get_execution` - Get execution details
- `n8n_list_executions` - List workflow runs
- `n8n_delete_execution` - Delete execution records

**System Tools:**
- `n8n_health_check` - Check n8n connectivity
- `n8n_diagnostic` - System diagnostics
- `n8n_validate_workflow` - Validate from n8n instance

#### Getting Your n8n API Key

1. Log into your n8n instance
2. Go to **Settings** > **API**
3. Click **Create API Key**
4. Copy the generated key

⚠️ **Security Note**: Store API keys securely and never commit them to version control.

## 🏗️ Architecture

### How HTTP Mode Works

```
┌─────────────────┐        ┌─────────────┐        ┌──────────────┐
│ Claude Desktop  │ stdio  │ mcp-remote  │  HTTP  │  n8n-MCP     │
│ (stdio only)    ├───────►│ (bridge)    ├───────►│  HTTP Server │
└─────────────────┘        └─────────────┘        └──────────────┘
                                                           │
                                                           ▼
                                                   ┌──────────────┐
                                                   │ Your n8n     │
                                                   │ Instance     │
                                                   └──────────────┘
```

**Key Points:**
- Claude Desktop **only supports stdio** communication
- `mcp-remote` acts as a bridge, converting stdio ↔ HTTP
- n8n-MCP server connects to **one n8n instance** (configured server-side)
- All clients share the same n8n instance (single-tenant design)

## 🌐 Reverse Proxy Configuration

### URL Configuration (v2.7.14+)

n8n-MCP intelligently detects your public URL:

#### Priority Order:
1. **Explicit Configuration** (highest priority):
   ```bash
   BASE_URL=https://n8n-mcp.example.com  # Full public URL
   # or
   PUBLIC_URL=https://api.company.com:8443/mcp
   ```

2. **Auto-Detection** (when TRUST_PROXY is enabled):
   ```bash
   TRUST_PROXY=1  # Required for proxy header detection
   # Server reads X-Forwarded-Proto and X-Forwarded-Host
   ```

3. **Fallback** (local binding):
   ```bash
   # No configuration needed
   # Shows: http://localhost:3000 (or configured HOST:PORT)
   ```

#### What You'll See in Logs:
```
[INFO] Starting n8n-MCP HTTP Server v2.7.17...
[INFO] Server running at https://n8n-mcp.example.com
[INFO] Endpoints:
[INFO]   Health: https://n8n-mcp.example.com/health
[INFO]   MCP:    https://n8n-mcp.example.com/mcp
```

### Trust Proxy for Correct IP Logging

When running n8n-MCP behind a reverse proxy (Nginx, Traefik, etc.), enable trust proxy to log real client IPs instead of proxy IPs:

```bash
# Enable trust proxy in your environment
TRUST_PROXY=1  # Trust 1 proxy hop (standard setup)
# or
TRUST_PROXY=2  # Trust 2 proxy hops (CDN → Load Balancer → n8n-mcp)
```

**Without TRUST_PROXY:**
```
[INFO] GET /health { ip: '172.19.0.2' }  # Docker internal IP
```

**With TRUST_PROXY=1:**
```
[INFO] GET /health { ip: '203.0.113.1' }  # Real client IP
```

This is especially important when:
- Running in Docker/Kubernetes
- Using load balancers
- Debugging client issues
- Implementing rate limiting

## 🔐 Security Setup

### Authentication

All requests require Bearer token authentication:

```bash
# Test authentication
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     https://your-server.com/health
```

### SSL/HTTPS (Strongly Recommended)

Use a reverse proxy for SSL termination:

**Nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location /mcp {
        proxy_pass http://localhost:3000;
        proxy_set_header Authorization $http_authorization;
        # Important: Forward client IP headers
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Caddy example (automatic HTTPS):**
```caddy
your-domain.com {
    reverse_proxy /mcp localhost:3000
}
```

## 💻 Client Configuration

⚠️ **Requirements**: Node.js 18+ must be installed on the client machine for `mcp-remote`

### Method 1: Using mcp-remote (Recommended)

```json
{
  "mcpServers": {
    "n8n-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-server.com/mcp",
        "--header",
        "Authorization: Bearer YOUR_AUTH_TOKEN_HERE"
      ]
    }
  }
}
```

**Note**: Replace `YOUR_AUTH_TOKEN_HERE` with your actual token. Do NOT use `${AUTH_TOKEN}` syntax - Claude Desktop doesn't support environment variable substitution in args.

### Method 2: Using Custom Bridge Script

For local testing or when mcp-remote isn't available:

```json
{
  "mcpServers": {
    "n8n-local-http": {
      "command": "node",
      "args": [
        "/path/to/n8n-mcp/scripts/http-bridge.js"
      ],
      "env": {
        "MCP_URL": "http://localhost:3000/mcp",
        "AUTH_TOKEN": "your-auth-token-here"
      }
    }
  }
}
```

### Local Development with Docker

When testing locally with Docker:

```json
{
  "mcpServers": {
    "n8n-docker-http": {
      "command": "node",
      "args": [
        "/path/to/n8n-mcp/scripts/http-bridge.js"
      ],
      "env": {
        "MCP_URL": "http://localhost:3001/mcp",
        "AUTH_TOKEN": "docker-test-token"
      }
    }
  }
}
```

## 🌐 Production Deployment

### Docker Compose (Complete Example)

```yaml
version: '3.8'

services:
  n8n-mcp:
    image: ghcr.io/czlonkowski/n8n-mcp:latest
    container_name: n8n-mcp
    restart: unless-stopped
    environment:
      # Core configuration
      MCP_MODE: http
      NODE_ENV: production
      
      # Security - Using file-based secret
      AUTH_TOKEN_FILE: /run/secrets/auth_token
      
      # Networking
      HOST: 0.0.0.0
      PORT: 3000
      TRUST_PROXY: 1  # Behind Nginx/Traefik
      CORS_ORIGIN: https://app.example.com  # Restrict in production
      
      # URL Configuration
      BASE_URL: https://n8n-mcp.example.com
      
      # Logging
      LOG_LEVEL: info
      
      # Optional: n8n API Integration
      N8N_API_URL: ${N8N_API_URL}
      N8N_API_KEY_FILE: /run/secrets/n8n_api_key
      
    secrets:
      - auth_token
      - n8n_api_key
      
    ports:
      - "127.0.0.1:3000:3000"  # Only expose to localhost
      
    volumes:
      - n8n-mcp-data:/app/data:ro  # Read-only database
      
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
      
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 128M
          cpus: '0.1'
    
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

secrets:
  auth_token:
    file: ./secrets/auth_token.txt
  n8n_api_key:
    file: ./secrets/n8n_api_key.txt

volumes:
  n8n-mcp-data:
```

### Systemd Service (Production Linux)

```ini
# /etc/systemd/system/n8n-mcp.service
[Unit]
Description=n8n-MCP HTTP Server
Documentation=https://github.com/czlonkowski/n8n-mcp
After=network.target
Requires=network.target

[Service]
Type=simple
User=n8n-mcp
Group=n8n-mcp
WorkingDirectory=/opt/n8n-mcp

# Use file-based secret
Environment="AUTH_TOKEN_FILE=/etc/n8n-mcp/auth_token"
Environment="MCP_MODE=http"
Environment="NODE_ENV=production"
Environment="TRUST_PROXY=1"
Environment="BASE_URL=https://n8n-mcp.example.com"

# Additional config from file
EnvironmentFile=-/etc/n8n-mcp/config.env

ExecStartPre=/usr/bin/test -f /etc/n8n-mcp/auth_token
ExecStart=/usr/bin/node dist/mcp/index.js --http

# Restart configuration
Restart=always
RestartSec=10
StartLimitBurst=5
StartLimitInterval=60s

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/n8n-mcp/data
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

# Resource limits
LimitNOFILE=65536
MemoryLimit=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

**Setup:**
```bash
# Create user and directories
sudo useradd -r -s /bin/false n8n-mcp
sudo mkdir -p /opt/n8n-mcp /etc/n8n-mcp
sudo chown n8n-mcp:n8n-mcp /opt/n8n-mcp

# Create secure token
sudo sh -c 'openssl rand -base64 32 > /etc/n8n-mcp/auth_token'
sudo chmod 600 /etc/n8n-mcp/auth_token
sudo chown n8n-mcp:n8n-mcp /etc/n8n-mcp/auth_token

# Deploy application
sudo -u n8n-mcp git clone https://github.com/czlonkowski/n8n-mcp.git /opt/n8n-mcp
cd /opt/n8n-mcp
sudo -u n8n-mcp npm install --production
sudo -u n8n-mcp npm run build
sudo -u n8n-mcp npm run rebuild

# Start service
sudo systemctl daemon-reload
sudo systemctl enable n8n-mcp
sudo systemctl start n8n-mcp
```

Enable:
```bash
sudo systemctl enable n8n-mcp
sudo systemctl start n8n-mcp
```

## 📡 Monitoring & Maintenance

### Health Endpoint Details

```bash
# Basic health check
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     https://your-server.com/health

# Response:
{
  "status": "ok",
  "mode": "http-fixed",
  "version": "2.7.17",
  "uptime": 3600,
  "memory": {
    "used": 95,
    "total": 512,
    "percentage": 18.5
  },
  "node": {
    "version": "v20.11.0",
    "platform": "linux"
  },
  "features": {
    "n8nApi": true,  // If N8N_API_URL configured
    "authFile": true  // If using AUTH_TOKEN_FILE
  }
}
```

## 🔒 Security Features (v2.16.3+)

### Rate Limiting

Built-in rate limiting protects authentication endpoints from brute force attacks:

**Configuration:**
```bash
# Defaults (15 minutes window, 20 attempts per IP)
AUTH_RATE_LIMIT_WINDOW=900000  # milliseconds
AUTH_RATE_LIMIT_MAX=20
```

**Features:**
- Per-IP rate limiting with configurable window and max attempts
- Standard rate limit headers (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)
- JSON-RPC formatted error responses
- Automatic IP tracking behind reverse proxies (requires TRUST_PROXY=1)

**Behavior:**
- First 20 attempts: Return 401 Unauthorized for invalid credentials
- Attempts 21+: Return 429 Too Many Requests with Retry-After header
- Counter resets after 15 minutes (configurable)

### SSRF Protection

Prevents Server-Side Request Forgery attacks when using webhook triggers:

**Three Security Modes:**

1. **Strict Mode (default)** - Production deployments
   ```bash
   WEBHOOK_SECURITY_MODE=strict
   ```
   - ✅ Block localhost (127.0.0.1, ::1)
   - ✅ Block private IPs (10.x, 192.168.x, 172.16-31.x)
   - ✅ Block cloud metadata (169.254.169.254, metadata.google.internal)
   - ✅ DNS rebinding prevention
   - 🎯 **Use for**: Cloud deployments, production environments

2. **Moderate Mode** - Local development with local n8n
   ```bash
   WEBHOOK_SECURITY_MODE=moderate
   ```
   - ✅ Allow localhost (for local n8n instances)
   - ✅ Block private IPs
   - ✅ Block cloud metadata
   - ✅ DNS rebinding prevention
   - 🎯 **Use for**: Development with n8n on localhost:5678

3. **Permissive Mode** - Internal networks only
   ```bash
   WEBHOOK_SECURITY_MODE=permissive
   ```
   - ✅ Allow localhost and private IPs
   - ✅ Block cloud metadata (always blocked)
   - ✅ DNS rebinding prevention
   - 🎯 **Use for**: Internal testing (NOT for production)

**Important:** Cloud metadata endpoints are ALWAYS blocked in all modes for security.

## 🔒 Security Best Practices

### 1. Token Management

**DO:**
- ✅ Use tokens with 32+ characters
- ✅ Store tokens in secure files or secrets management
- ✅ Rotate tokens regularly (monthly minimum)
- ✅ Use different tokens for each environment
- ✅ Monitor logs for authentication failures

**DON'T:**
- ❌ Use default or example tokens
- ❌ Commit tokens to version control
- ❌ Share tokens between environments
- ❌ Log tokens in plain text

```bash
# Generate strong token
openssl rand -base64 32

# Secure storage options:
# 1. Docker secrets (recommended)
echo $(openssl rand -base64 32) | docker secret create auth_token -

# 2. Kubernetes secrets
kubectl create secret generic n8n-mcp-auth \
  --from-literal=token=$(openssl rand -base64 32)

# 3. HashiCorp Vault
vault kv put secret/n8n-mcp token=$(openssl rand -base64 32)
```

### 2. Network Security

- ✅ **Always use HTTPS** in production
- ✅ **Firewall rules** to limit access
- ✅ **VPN** for internal deployments
- ✅ **Rate limiting** at proxy level

### 3. Container Security

```bash
# Run as non-root user (already configured)
# Read-only filesystem
docker run --read-only \
  --tmpfs /tmp \
  -v n8n-mcp-data:/app/data \
  n8n-mcp

# Security scanning
docker scan ghcr.io/czlonkowski/n8n-mcp:latest
```

## 🔍 Troubleshooting

### Common Issues & Solutions

#### Authentication Issues

**"Unauthorized" error:**
```bash
# Check token is set correctly
docker exec n8n-mcp env | grep AUTH

# Test with curl
curl -v -H "Authorization: Bearer YOUR_TOKEN" \
     https://your-server.com/health

# Common causes:
# - Extra spaces in token
# - Missing "Bearer " prefix
# - Token file has newline at end
# - Wrong quotes in JSON config
```

**Default token warning:**
```
⚠️ SECURITY WARNING: Using default AUTH_TOKEN
```
- Change token immediately via environment variable
- Server shows this warning every 5 minutes

#### Connection Issues

**"TransformStream is not defined":**
```bash
# Check Node.js version on CLIENT machine
node --version  # Must be 18+

# Update Node.js
# macOS: brew upgrade node
# Linux: Use NodeSource repository
# Windows: Download from nodejs.org
```

**"Cannot connect to server":**
```bash
# 1. Check server is running
docker ps | grep n8n-mcp

# 2. Check logs for errors
docker logs n8n-mcp --tail 50

# 3. Test locally first
curl http://localhost:3000/health

# 4. Check firewall
sudo ufw status  # Linux
```

**"Stream is not readable":**
- This issue was fixed in v2.3.2+ with the SingleSessionHTTPServer
- No additional configuration needed

**Bridge script not working:**
```bash
# Test the bridge manually
export MCP_URL=http://localhost:3000/mcp
export AUTH_TOKEN=your-token
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node /path/to/http-bridge.js
```

**Connection refused:**
```bash
# Check server is running
curl http://localhost:3000/health

# Check Docker status
docker ps
docker logs n8n-mcp

# Check firewall
sudo ufw status
```

**Authentication failed:**
- Verify AUTH_TOKEN matches exactly
- Check for extra spaces or quotes
- Test with curl first

#### Bridge Configuration Issues

**"Why use 'node' instead of 'docker' in Claude config?"**

Claude Desktop only supports stdio. The architecture is:
```
Claude → stdio → mcp-remote → HTTP → Docker container
```

The `node` command runs mcp-remote (the bridge), not the server directly.

**"Command not found: npx":**
```bash
# Install Node.js 18+ which includes npx
# Or use full path:
which npx  # Find npx location
# Use that path in Claude config
```

### Debug Mode

```bash
# 1. Enable debug logging
docker run -e LOG_LEVEL=debug ...

# 2. Test MCP endpoint
curl -X POST https://your-server.com/mcp \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'

# 3. Test with mcp-remote directly
MCP_URL=https://your-server.com/mcp \
AUTH_TOKEN=your-token \
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
  npx mcp-remote $MCP_URL --header "Authorization: Bearer $AUTH_TOKEN"
```

### Cloud Platform Deployments

**Railway:** See our [Railway Deployment Guide](./RAILWAY_DEPLOYMENT.md)

## 🔧 Using n8n Management Tools

When n8n API is configured, Claude can manage workflows directly:

### Example: Create a Workflow via Claude

```bash
# Test n8n connectivity first
curl -X POST https://your-server.com/mcp \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "n8n_health_check",
    "params": {},
    "id": 1
  }'
```

### Common Use Cases

1. **Workflow Automation**: Claude can create, update, and manage workflows
2. **CI/CD Integration**: Deploy workflows from version control
3. **Workflow Templates**: Claude can apply templates to new workflows
4. **Monitoring**: Track execution status and debug failures
5. **Incremental Updates**: Use diff-based updates for efficient changes

### Security Best Practices for n8n API

- 🔐 Use separate API keys for different environments
- 🔄 Rotate API keys regularly
- 📝 Audit workflow changes via n8n's audit log
- 🚫 Never expose n8n API directly to the internet
- ✅ Use MCP server as a security layer

## 📦 Updates & Maintenance

### Version Updates

```bash
# Check current version
docker exec n8n-mcp node -e "console.log(require('./package.json').version)"

# Update to latest
docker pull ghcr.io/czlonkowski/n8n-mcp:latest
docker stop n8n-mcp
docker rm n8n-mcp
# Re-run with same environment

# Update to specific version
docker pull ghcr.io/czlonkowski/n8n-mcp:v2.7.17
```

### Database Management

```bash
# The database is read-only and pre-built
# No backups needed for the node database
# Updates include new database versions

# Check database stats
curl -X POST https://your-server.com/mcp \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "get_database_statistics",
    "id": 1
  }'
```

## 🆘 Getting Help

- 📚 [Full Documentation](https://github.com/czlonkowski/n8n-mcp)
- 🚂 [Railway Deployment Guide](./RAILWAY_DEPLOYMENT.md) - Easiest deployment option
- 🐛 [Report Issues](https://github.com/czlonkowski/n8n-mcp/issues)
- 💬 [Community Discussions](https://github.com/czlonkowski/n8n-mcp/discussions)