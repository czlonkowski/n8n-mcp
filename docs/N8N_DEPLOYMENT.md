# n8n-MCP Deployment Guide

This guide covers how to deploy n8n-MCP and connect it to your n8n instance. Whether you're testing locally or deploying to production, we'll show you how to set up n8n-MCP for use with n8n's MCP Client Tool node.

## Table of Contents
- [Overview](#overview)
- [Local Testing](#local-testing)
- [Production Deployment](#production-deployment)
  - [Same Server as n8n](#same-server-as-n8n)
  - [Different Server (Cloud Deployment)](#different-server-cloud-deployment)
- [Connecting n8n to n8n-MCP](#connecting-n8n-to-n8n-mcp)
- [Security & Best Practices](#security--best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

n8n-MCP is a Model Context Protocol server that provides AI assistants with comprehensive access to n8n node documentation and management capabilities. When connected to n8n via the MCP Client Tool node, it enables:
- AI-powered workflow creation and validation
- Access to documentation for 500+ n8n nodes
- Workflow management through the n8n API
- Real-time configuration validation

## Local Testing

### Quick Test Script

Test n8n-MCP locally with the provided test script:

```bash
# Clone the repository
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp

# Build the project
npm install
npm run build

# Run the integration test script
./scripts/test-n8n-integration.sh
```

This script will:
1. Start a real n8n instance in Docker
2. Start n8n-MCP server configured for n8n
3. Guide you through API key setup for workflow management
4. Test the complete integration between n8n and n8n-MCP

### Manual Local Setup

For development or custom testing:

1. **Prerequisites**:
   - n8n instance running (local or remote)
   - n8n API key (from n8n Settings → API)

2. **Start n8n-MCP**:
```bash
# Set environment variables
export N8N_MODE=true
export MCP_MODE=http                       # Required for HTTP mode
export N8N_API_URL=http://localhost:5678  # Your n8n instance URL
export N8N_API_KEY=your-api-key-here       # Your n8n API key
export WEBHOOK_SECURITY_MODE=moderate      # Required when N8N_API_URL is localhost or RFC1918
export MCP_AUTH_TOKEN=test-token-minimum-32-chars-long
export AUTH_TOKEN=test-token-minimum-32-chars-long  # Same value as MCP_AUTH_TOKEN
export PORT=3001

# Start the server
npm start
```

3. **Verify it's running**:
```bash
# Check health
curl http://localhost:3001/health

# Check MCP protocol endpoint (this is the endpoint n8n connects to)
curl http://localhost:3001/mcp
# Should return: {"protocolVersion":"2024-11-05"} for n8n compatibility
```

## Environment Variables Reference

| Variable | Required | Description | Example Value |
|----------|----------|-------------|---------------|
| `N8N_MODE` | Yes | Enables n8n integration mode | `true` |
| `MCP_MODE` | Yes | Enables HTTP mode for n8n MCP Client | `http` |
| `N8N_API_URL` | Yes* | URL of your n8n instance | `http://localhost:5678` |
| `N8N_API_KEY` | Yes* | n8n API key for workflow management | `n8n_api_xxx...` |
| `WEBHOOK_SECURITY_MODE` | No | SSRF gate (`strict` default, `moderate`, `permissive`). Set to `moderate` when `N8N_API_URL` is localhost or an RFC1918 host on the same network. | `moderate` |
| `MCP_AUTH_TOKEN` | Yes | Authentication token for MCP requests (min 32 chars) | `secure-random-32-char-token` |
| `AUTH_TOKEN` | Yes | **MUST match MCP_AUTH_TOKEN exactly** | `secure-random-32-char-token` |
| `PORT` | No | Port for the HTTP server | `3000` (default) |
| `LOG_LEVEL` | No | Logging verbosity | `info`, `debug`, `error` |

*Required only for workflow management features. Documentation tools work without these.

## Docker Build Changes (v2.9.2+)

Starting with version 2.9.2, we use a single optimized Dockerfile for all deployments:
- The previous `Dockerfile.n8n` has been removed as redundant
- N8N_MODE functionality is enabled via the `N8N_MODE=true` environment variable
- This reduces image size by 500MB+ and improves build times from 8+ minutes to 1-2 minutes
- All examples now use the standard `Dockerfile`

## Production Deployment

> **⚠️ Critical**: Docker caches images locally. Always run `docker pull ghcr.io/czlonkowski/n8n-mcp:latest` before deploying to ensure you have the latest version. This simple step prevents most deployment issues.

### Same Server as n8n

If you're running n8n-MCP on the same server as your n8n instance:

### Using Pre-built Image (Recommended)

The pre-built images are automatically updated with each release and are the easiest way to get started.

**IMPORTANT**: Always pull the latest image to avoid using cached versions:

```bash
# ALWAYS pull the latest image first
docker pull ghcr.io/czlonkowski/n8n-mcp:latest

# Generate a secure token (save this!)
AUTH_TOKEN=$(openssl rand -hex 32)
echo "Your AUTH_TOKEN: $AUTH_TOKEN"

# Create a Docker network if n8n uses one
docker network create n8n-net

# Run n8n-MCP container
docker run -d \
  --name n8n-mcp \
  --network n8n-net \
  -p 3000:3000 \
  -e N8N_MODE=true \
  -e MCP_MODE=http \
  -e N8N_API_URL=http://n8n:5678 \
  -e N8N_API_KEY=your-n8n-api-key \
  -e WEBHOOK_SECURITY_MODE=permissive \
  -e MCP_AUTH_TOKEN=$AUTH_TOKEN \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ghcr.io/czlonkowski/n8n-mcp:latest
```

### Building from Source (Advanced Users)

Only build from source if you need custom modifications or are contributing to development:

```bash
# Clone and build
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp

# Build Docker image
docker build -t n8n-mcp:latest .

# Run using your local image
docker run -d \
  --name n8n-mcp \
  -p 3000:3000 \
  -e N8N_MODE=true \
  -e MCP_MODE=http \
  -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  -e AUTH_TOKEN=$(openssl rand -hex 32) \
  # ... other settings
  n8n-mcp:latest
```

### Using systemd (for native installation)

```bash
# Create service file
sudo cat > /etc/systemd/system/n8n-mcp.service << EOF
[Unit]
Description=n8n-MCP Server
After=network.target

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/n8n-mcp
Environment="N8N_MODE=true"
Environment="MCP_MODE=http"
Environment="N8N_API_URL=http://localhost:5678"
Environment="N8N_API_KEY=your-n8n-api-key"
Environment="WEBHOOK_SECURITY_MODE=moderate"
Environment="MCP_AUTH_TOKEN=your-secure-token-32-chars-min"
Environment="AUTH_TOKEN=your-secure-token-32-chars-min"
Environment="PORT=3000"
ExecStart=/usr/bin/node /opt/n8n-mcp/dist/mcp/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable n8n-mcp
sudo systemctl start n8n-mcp
```

### Different Server (Cloud Deployment)

Deploy n8n-MCP on a separate server from your n8n instance:

#### Quick Docker Deployment (Recommended)

**Always pull the latest image to ensure you have the current version:**

```bash
# On your cloud server (Hetzner, AWS, DigitalOcean, etc.)
# ALWAYS pull the latest image first
docker pull ghcr.io/czlonkowski/n8n-mcp:latest

# Generate auth tokens
AUTH_TOKEN=$(openssl rand -hex 32)
echo "Save this AUTH_TOKEN: $AUTH_TOKEN"

# Run the container
docker run -d \
  --name n8n-mcp \
  -p 3000:3000 \
  -e N8N_MODE=true \
  -e MCP_MODE=http \
  -e N8N_API_URL=https://your-n8n-instance.com \
  -e N8N_API_KEY=your-n8n-api-key \
  -e MCP_AUTH_TOKEN=$AUTH_TOKEN \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  ghcr.io/czlonkowski/n8n-mcp:latest
```

#### Building from Source (Advanced)

Only needed if you're modifying the code:

```bash
# Clone and build
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp
docker build -t n8n-mcp:latest .

# Run using local image
docker run -d \
  --name n8n-mcp \
  -p 3000:3000 \
  # ... same environment variables as above
  n8n-mcp:latest
```

#### Full Production Setup (Hetzner/AWS/DigitalOcean)

1. **Server Requirements**:
   - **Minimal**: 1 vCPU, 1GB RAM (CX11 on Hetzner)
   - **Recommended**: 2 vCPU, 2GB RAM
   - **OS**: Ubuntu 22.04 LTS

2. **Initial Setup**:
```bash
# SSH into your server
ssh root@your-server-ip

# Update and install Docker
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
```

3. **Deploy n8n-MCP with SSL** (using Caddy for automatic HTTPS):

**Using Docker Compose (Recommended)**
```bash
# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  n8n-mcp:
    image: ghcr.io/czlonkowski/n8n-mcp:latest
    pull_policy: always  # Always pull latest image
    container_name: n8n-mcp
    restart: unless-stopped
    environment:
      - N8N_MODE=true
      - MCP_MODE=http
      - N8N_API_URL=${N8N_API_URL}
      - N8N_API_KEY=${N8N_API_KEY}
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
      - AUTH_TOKEN=${AUTH_TOKEN}
      - PORT=3000
      - LOG_LEVEL=info
    networks:
      - web

  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - web

networks:
  web:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
EOF
```

**Note**: The `pull_policy: always` ensures you always get the latest version.

**Building from Source (if needed)**
```bash
# Only if you need custom modifications
git clone https://github.com/czlonkowski/n8n-mcp.git
cd n8n-mcp
docker build -t n8n-mcp:local .

# Then update docker-compose.yml to use:
# image: n8n-mcp:local
    container_name: n8n-mcp
    restart: unless-stopped
    environment:
      - N8N_MODE=true
      - MCP_MODE=http
      - N8N_API_URL=${N8N_API_URL}
      - N8N_API_KEY=${N8N_API_KEY}
      - MCP_AUTH_TOKEN=${MCP_AUTH_TOKEN}
      - AUTH_TOKEN=${AUTH_TOKEN}
      - PORT=3000
      - LOG_LEVEL=info
    networks:
      - web

  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - web

networks:
  web:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
EOF
```

**Complete the Setup**
```bash
# Create Caddyfile
cat > Caddyfile << 'EOF'
mcp.yourdomain.com {
    reverse_proxy n8n-mcp:3000
}
EOF

# Create .env file
AUTH_TOKEN=$(openssl rand -hex 32)
cat > .env << EOF
N8N_API_URL=https://your-n8n-instance.com
N8N_API_KEY=your-n8n-api-key-here
MCP_AUTH_TOKEN=$AUTH_TOKEN
AUTH_TOKEN=$AUTH_TOKEN
EOF

# Save the AUTH_TOKEN!
echo "Your AUTH_TOKEN is: $AUTH_TOKEN"
echo "Save this token - you'll need it in n8n MCP Client Tool configuration"

# Start services
docker compose up -d
```

#### Cloud Provider Tips

**AWS EC2**:
- Security Group: Open port 3000 (or 443 with HTTPS)
- Instance Type: t3.micro is sufficient
- Use Elastic IP for stable addressing

**DigitalOcean**:
- Droplet: Basic ($6/month) is enough
- Enable backups for production use

**Google Cloud**:
- Machine Type: e2-micro (free tier eligible)
- Use Cloud Load Balancer for SSL

## Connecting n8n to n8n-MCP

### Configure n8n MCP Client Tool

1. **In your n8n workflow**, add the **MCP Client Tool** node

2. **Configure the connection**:
   ```
   Server URL (MUST include /mcp endpoint): 
   - Same server: http://localhost:3000/mcp
   - Docker network: http://n8n-mcp:3000/mcp
   - Different server: https://mcp.yourdomain.com/mcp
   
   Auth Token: [Your MCP_AUTH_TOKEN/AUTH_TOKEN value]
   
   Transport: HTTP Streamable (SSE)
   ```
   
   ⚠️ **Critical**: The Server URL must include the `/mcp` endpoint path. Without this, the connection will fail.

3. **Test the connection** by selecting a simple tool like `list_nodes`

### Available Tools

Once connected, you can use these MCP tools in n8n:

**Documentation Tools** (No API key required):
- `list_nodes` - List all n8n nodes with filtering
- `search_nodes` - Search nodes by keyword
- `get_node_info` - Get detailed node information
- `get_node_essentials` - Get only essential properties
- `validate_workflow` - Validate workflow configurations
- `get_node_documentation` - Get human-readable docs

**Management Tools** (Requires n8n API key):
- `n8n_create_workflow` - Create new workflows
- `n8n_update_workflow` - Update existing workflows
- `n8n_get_workflow` - Retrieve workflow details
- `n8n_list_workflows` - List all workflows
- `n8n_trigger_webhook_workflow` - Trigger webhook workflows

### Using with AI Agents

Connect n8n-MCP to AI Agent nodes for intelligent automation:

1. **Add an AI Agent node** (e.g., OpenAI, Anthropic)
2. **Connect MCP Client Tool** to the Agent's tool input
3. **Configure prompts** for workflow creation:

```
You are an n8n workflow expert. Use the MCP tools to:
1. Search for appropriate nodes using search_nodes
2. Get configuration details with get_node_essentials
3. Validate configurations with validate_workflow
4. Create the workflow if all validations pass
```

## Security & Best Practices

### Authentication
- **MCP_AUTH_TOKEN**: Always use a strong, random token (32+ characters)
- **N8N_API_KEY**: Only required for workflow management features
- Store tokens in environment variables or secure vaults

### Network Security
- **Use HTTPS** in production (Caddy/Nginx/Traefik)
- **Firewall**: Only expose necessary ports (3000 or 443)
- **IP Whitelisting**: Consider restricting access to known n8n instances

### Docker Security
- **Always pull latest images**: Docker caches images locally, so run `docker pull` before deployment
- Run containers with `--read-only` flag if possible
- Use specific image versions instead of `:latest` in production
- Regular updates: `docker pull ghcr.io/czlonkowski/n8n-mcp:latest`

## Troubleshooting

### Docker Image Issues

**Using Outdated Cached Images**
- **Symptom**: Missing features, old bugs reappearing, features not working as documented
- **Cause**: Docker uses locally cached images instead of pulling the latest version
- **Solution**: Always run `docker pull ghcr.io/czlonkowski/n8n-mcp:latest` before deployment
- **Verification**: Check image age with `docker images | grep n8n-mcp`

### Common Configuration Issues

**Missing `MCP_MODE=http` Environment Variable**
- **Symptom**: n8n MCP Client Tool cannot connect, server doesn't respond on `/mcp` endpoint
- **Solution**: Add `MCP_MODE=http` to your environment variables
- **Why**: Without this, the server runs in stdio mode which is incompatible with n8n

**Server URL Missing `/mcp` Endpoint**
- **Symptom**: "Connection refused" or "Invalid response" in n8n MCP Client Tool
- **Solution**: Ensure your Server URL includes `/mcp` (e.g., `http://localhost:3000/mcp`)
- **Why**: n8n connects to the `/mcp` endpoint specifically, not the root URL

**Mismatched Auth Tokens**
- **Symptom**: "Authentication failed" or "Invalid auth token"
- **Solution**: Ensure both `MCP_AUTH_TOKEN` and `AUTH_TOKEN` have the same value
- **Why**: Both variables must match for proper authentication

### Connection Issues

**"Connection refused" in n8n MCP Client Tool**
1. **Check n8n-MCP is running**:
   ```bash
   # Docker
   docker ps | grep n8n-mcp
   docker logs n8n-mcp --tail 20
   
   # Systemd
   systemctl status n8n-mcp
   journalctl -u n8n-mcp --tail 20
   ```

2. **Verify endpoints are accessible**:
   ```bash
   # Health check (should return status info)
   curl http://your-server:3000/health
   
   # MCP endpoint (should return protocol version)
   curl http://your-server:3000/mcp
   ```

3. **Check firewall and networking**:
   ```bash
   # Test port accessibility from n8n server
   telnet your-mcp-server 3000
   
   # Check firewall rules (Ubuntu/Debian)
   sudo ufw status
   
   # Check if port is bound correctly
   netstat -tlnp | grep :3000
   ```

**"Invalid auth token" or "Authentication failed"**
1. **Verify token format**:
   ```bash
   # Check token length (should be 64 chars for hex-32)
   echo $MCP_AUTH_TOKEN | wc -c
   
   # Verify both tokens match
   echo "MCP_AUTH_TOKEN: $MCP_AUTH_TOKEN"
   echo "AUTH_TOKEN: $AUTH_TOKEN"
   ```

2. **Common token issues**:
   - Token too short (minimum 32 characters)
   - Extra whitespace or newlines in token
   - Different values for `MCP_AUTH_TOKEN` and `AUTH_TOKEN`
   - Special characters not properly escaped in environment files

**"Cannot connect to n8n API"**
1. **Verify n8n configuration**:
   ```bash
   # Test n8n API accessibility
   curl -H "X-N8N-API-KEY: your-api-key" \
        https://your-n8n-instance.com/api/v1/workflows
   ```

2. **Common n8n API issues**:
   - `N8N_API_URL` missing protocol (http:// or https://)
   - n8n API key expired or invalid
   - n8n instance not accessible from n8n-MCP server
   - n8n API disabled in settings

### Version Compatibility Issues

**"Features Not Working as Expected"**
- **Symptom**: Missing features, old bugs, or compatibility issues
- **Solution**: Pull the latest image: `docker pull ghcr.io/czlonkowski/n8n-mcp:latest`
- **Check**: Verify image date with `docker inspect ghcr.io/czlonkowski/n8n-mcp:latest | grep Created`

**"Protocol version mismatch"**
- n8n-MCP automatically uses version 2024-11-05 for n8n compatibility
- Update to latest n8n-MCP version if issues persist
- Verify `/mcp` endpoint returns correct version

### Environment Variable Issues

**Complete Environment Variable Checklist**:
```bash
# Required for all deployments
export N8N_MODE=true                                    # Enables n8n integration
export MCP_MODE=http                                   # Enables HTTP mode for n8n
export MCP_AUTH_TOKEN=your-secure-32-char-token       # Auth token
export AUTH_TOKEN=your-secure-32-char-token           # Same value as MCP_AUTH_TOKEN

# Required for workflow management features
export N8N_API_URL=https://your-n8n-instance.com      # Your n8n URL
export N8N_API_KEY=your-n8n-api-key                   # Your n8n API key

# Optional
export PORT=3000                                       # HTTP port (default: 3000)
export LOG_LEVEL=info                                  # Logging level
```

### Docker-Specific Issues

**Container Build Failures**
```bash
# Clear Docker cache and rebuild
docker system prune -f
docker build --no-cache -t n8n-mcp:latest .
```

**Container Runtime Issues**
```bash
# Check container logs for detailed errors
docker logs n8n-mcp -f --timestamps

# Inspect container environment
docker exec n8n-mcp env | grep -E "(N8N|MCP|AUTH)"

# Test container connectivity
docker exec n8n-mcp curl -f http://localhost:3000/health
```

### Network and SSL Issues

**HTTPS/SSL Problems**
```bash
# Test SSL certificate
openssl s_client -connect mcp.yourdomain.com:443

# Check Caddy logs
docker logs caddy -f --tail 50
```

**Docker Network Issues**
```bash
# Check if containers can communicate
docker network ls
docker network inspect bridge

# Test inter-container connectivity
docker exec n8n curl http://n8n-mcp:3000/health
```

### Debugging Steps

1. **Enable comprehensive logging**:
```bash
# For Docker
docker run -d \
  --name n8n-mcp \
  -e DEBUG_MCP=true \
  -e LOG_LEVEL=debug \
  -e N8N_MODE=true \
  -e MCP_MODE=http \
  # ... other settings

# For systemd, add to service file:
Environment="DEBUG_MCP=true"
Environment="LOG_LEVEL=debug"
```

2. **Test all endpoints systematically**:
```bash
# 1. Health check (basic server functionality)
curl -v http://localhost:3000/health

# 2. MCP protocol endpoint (what n8n connects to)
curl -v http://localhost:3000/mcp

# 3. Test authentication (if working, returns tools list)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# 4. Test a simple tool (documentation only, no n8n API needed)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_database_statistics","arguments":{}},"id":2}'
```

3. **Common log patterns to look for**:
```bash
# Success patterns
grep "Server started" /var/log/n8n-mcp.log
grep "Protocol version" /var/log/n8n-mcp.log

# Error patterns
grep -i "error\|failed\|invalid" /var/log/n8n-mcp.log
grep -i "auth\|token" /var/log/n8n-mcp.log
grep -i "connection\|network" /var/log/n8n-mcp.log
```

### Getting Help

If you're still experiencing issues:

1. **Gather diagnostic information**:
```bash
# System info
docker --version
docker-compose --version
uname -a

# n8n-MCP version
docker exec n8n-mcp node dist/index.js --version

# Environment check
docker exec n8n-mcp env | grep -E "(N8N|MCP|AUTH)" | sort

# Container status
docker ps | grep n8n-mcp
docker stats n8n-mcp --no-stream
```

2. **Create a minimal test setup**:
```bash
# Test with minimal configuration
docker run -d \
  --name n8n-mcp-test \
  -p 3001:3000 \
  -e N8N_MODE=true \
  -e MCP_MODE=http \
  -e MCP_AUTH_TOKEN=test-token-minimum-32-chars-long \
  -e AUTH_TOKEN=test-token-minimum-32-chars-long \
  -e LOG_LEVEL=debug \
  n8n-mcp:latest

# Test basic functionality
curl http://localhost:3001/health
curl http://localhost:3001/mcp
```

3. **Report issues**: Include the diagnostic information when opening an issue on [GitHub](https://github.com/czlonkowski/n8n-mcp/issues)

## Performance Tips

- **Minimal deployment**: 1 vCPU, 1GB RAM is sufficient
- **Database**: Pre-built SQLite database (~15MB) loads quickly
- **Response time**: Average 12ms for queries
- **Caching**: Built-in 15-minute cache for repeated queries

## Next Steps

- Test your setup with the [MCP Client Tool in n8n](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-langchain.mcpclienttool/)
- Explore [available MCP tools](../README.md#-available-mcp-tools)
- Build AI-powered workflows with [AI Agent nodes](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmagent/)
- Join the [n8n Community](https://community.n8n.io) for ideas and support

---

Need help? Open an issue on [GitHub](https://github.com/czlonkowski/n8n-mcp/issues) or check the [n8n forums](https://community.n8n.io)