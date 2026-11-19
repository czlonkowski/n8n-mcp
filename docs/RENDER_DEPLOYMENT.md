# Render Deployment Guide for n8n-MCP

Deploy n8n-MCP on [Render](https://render.com/) using the repo's Docker image and connect MCP clients (Cursor, VS Code, Claude Desktop, etc.) over HTTPS.

## Quick Deploy

Deploy n8n-MCP with one click (same repository as [`render.yaml`](../render.yaml)):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/czlonkowski/n8n-mcp)

## Overview

Render deployment provides:

- **Blueprint (`render.yaml`)** - Infrastructure as code at the repo root; recommended path for new environments and rollbacks.
- **Secrets** - `AUTH_TOKEN` can be generated at apply time (`generateValue`) so HTTP mode always has a credential.
- **HTTPS** - Managed TLS on `*.onrender.com` (or attach a custom domain).
- **Health checks** - `/health` for Render deploy checks.

## Recommended: Render Blueprint (`render.yaml`)

The repository includes a **`render.yaml`** [Blueprint](https://render.com/docs/infrastructure-as-code) at the repo root. Blueprints keep infrastructure version-controlled and reproducible. This is the **recommended** path.

### Quick start (Blueprint)

1. **Push this repo** to GitHub (or GitLab / Bitbucket) if it isn't already.
2. Open **[Create a new Blueprint](https://dashboard.render.com/select-repo?type=blueprint)** (or **Blueprint → New Blueprint**).
3. Select the **Git provider** and **repository** that contains `render.yaml`.
4. Confirm Render detects **`render.yaml`** (default path is repo root).
5. Choose **workspace** and **region** as needed.
6. On apply, Render will prompt for any **`sync: false`** secrets (this Blueprint uses **`generateValue`** for `AUTH_TOKEN`, so you mainly review and deploy).
7. Click **Apply** and wait for the **Docker build** and **deploy** to finish.

**Blueprint deeplink (adjust the repo URL if you use a fork):**

`https://dashboard.render.com/blueprint/new?repo=https://github.com/czlonkowski/n8n-mcp`

### After deploy

1. Open the **Web Service** and copy **URL** (e.g. `https://n8n-mcp-xxxx.onrender.com`).
2. Under **Environment**, reveal **`AUTH_TOKEN`**. MCP clients send it as **`Authorization: Bearer <AUTH_TOKEN>`**.
3. Endpoints:
   - **Health:** `https://<your-service>.onrender.com/health`
   - **MCP:** `https://<your-service>.onrender.com/mcp` (clients use this path, not `/` alone).

Sanity check:

```bash
curl -sS "https://<your-service>.onrender.com/health"
```

Expect JSON with `"status":"ok"`.

---

## Alternative: Manual Docker Web Service

If you prefer not to use a Blueprint:

1. **New +** → **Web Service** → connect the repo.
2. **Runtime:** **Docker**.
3. **Dockerfile path:** `./Dockerfile` (default).
4. Set the same environment variables as in [`render.yaml`](../render.yaml), especially **`MCP_MODE=http`** and **`AUTH_TOKEN`** (required for HTTP mode).
5. **Health check path:** `/health`.

---

## Environment variables

Values aligned with [`render.yaml`](../render.yaml) and [HTTP deployment](./HTTP_DEPLOYMENT.md).

### Set by the Blueprint (review in Dashboard)

| Variable | Typical value | Notes |
|----------|----------------|--------|
| `MCP_MODE` | `http` | Required for remote MCP over HTTP. |
| `NODE_ENV` | `production` | |
| `HOST` | `0.0.0.0` | Listen on all interfaces. |
| `TRUST_PROXY` | `1` | Correct client IPs and URLs behind Render's proxy. |
| `AUTH_TOKEN` | *(generated or set by you)* | **Bearer** secret for all MCP requests. Do not commit. |
| `PORT` | *(injected by Render)* | Do **not** hardcode in Blueprint; Render sets this. |

### Optional (add in Dashboard after deploy)

| Variable | Description |
|----------|-------------|
| `N8N_API_URL` | Base URL of your n8n instance; enables workflow management tools. |
| `N8N_API_KEY` | API key from n8n **Settings → API**. |
| `BASE_URL` / `PUBLIC_URL` | If URLs in logs or responses must match a custom domain. |
| `CORS_ORIGIN` | Restrict browser origins if needed (default permissive in dev docs). |

See also [Security & Hardening](./SECURITY_HARDENING.md) and [`HTTP_DEPLOYMENT.md`](./HTTP_DEPLOYMENT.md) for rate limits and `WEBHOOK_SECURITY_MODE`.

---

## Architecture

```
MCP client (Cursor / VS Code HTTP / Claude Desktop + mcp-remote)
        → HTTPS (Render)
        → n8n-MCP HTTP server (:PORT from Render)
        → optional n8n API (if N8N_API_URL / N8N_API_KEY set)
```

- **Claude Desktop** does not speak HTTP MCP natively. Use **`mcp-remote`** as in [HTTP Deployment](./HTTP_DEPLOYMENT.md).
- **VS Code:** HTTP MCP example in [VS_CODE_PROJECT_SETUP.md](./VS_CODE_PROJECT_SETUP.md).
- **Cursor:** Configure remote MCP URL `https://<host>/mcp` and **`Authorization: Bearer ...`**.

---

## Troubleshooting

### Build fails (Docker)

- Check **Logs** → **Build** for out-of-memory or timeout. Heavy native installs (`better-sqlite3`) may need a **non-free instance type** or a retry.
- Confirm **`Dockerfile`** is at repo root (or set **Dockerfile path** in the service).

### Deploy succeeds but health check fails

- Confirm **`MCP_MODE=http`** and **`AUTH_TOKEN`** are set (container exits without them in HTTP mode).
- **`/health`** must return success. The Blueprint sets **`healthCheckPath: /health`**.

### MCP client: 401 Unauthorized

- **`Authorization: Bearer`** must match **`AUTH_TOKEN`** exactly (no extra spaces or quotes).
- If you rotated the token in Render, update **every** client config.

### Cold starts (free tier)

- Free web services [spin down after idle](https://render.com/docs/free); first request may take ~minute. Paid instances stay warm.

---

If you fork this repository, update **Deploy to Render** and Blueprint links to point at **your** Git remote so `render.yaml` is found.

## Links

- [Render Blueprint spec](https://render.com/docs/blueprint-spec)
- [Docker on Render](https://render.com/docs/docker)
- [Deploy to Render button](https://render.com/docs/deploy-to-render-button)
- [n8n-MCP HTTP deployment](./HTTP_DEPLOYMENT.md)
