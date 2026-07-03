# Secrets & hardening

The deploy flow lives in `SKILL.md`; this file is the security depth it points to.

## Generating secrets (on the target box)

Generate each value **on the server** and **write it into `.env`, replacing the matching
`REPLACE_WITH_…` placeholder** — generating without substituting leaves the literal placeholder
as the password, and Postgres/n8n then fail to connect. Never reuse values across instances.

```bash
cd <DATA_FOLDER>

# Encryption key — encrypts all stored credentials. REQUIRED, both modes.
openssl rand -base64 32

# Queue mode also needs two Postgres passwords:
openssl rand -base64 24   # POSTGRES_PASSWORD (superuser)
openssl rand -base64 24   # POSTGRES_NON_ROOT_PASSWORD (the user n8n connects as)
```

Substitute each into `.env` (edit it directly, or for a fresh `.env` with no special chars in
the value, e.g.):

```bash
KEY=$(openssl rand -base64 32)
# write it in place of the placeholder (use a delimiter that won't clash with base64's / and +)
sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=${KEY}|" .env
# repeat for POSTGRES_PASSWORD / POSTGRES_NON_ROOT_PASSWORD in queue mode
```

Then **confirm nothing was missed** and lock the file down:

```bash
grep REPLACE_WITH_ .env   # must print NOTHING before you launch
chmod 600 .env
```

## The encryption key (`N8N_ENCRYPTION_KEY`) — read this twice

- It encrypts every credential n8n stores. **Lose it or change it and all saved credentials
  become undecryptable** — effectively a reset.
- **Set it explicitly before the first start.** If you start n8n once without it, n8n
  auto-generates one into the `n8n_data` volume (`~/.n8n/config`); adding a *different* key
  later breaks decryption. The templates set it from `.env`, so do step 4 before step 6.
- **Queue mode: the exact same key must reach the main process and every worker.** The
  `x-n8n` anchor in the queue compose guarantees this — don't override it per-service.
- **Back it up off the box** (password manager / secrets vault). A database backup is useless
  without the matching key. To recover the auto-generated one if you ever need it:
  `docker compose exec n8n cat /home/node/.n8n/config`.

## Hardening checklist

Most of these are already baked into the `assets/` templates (marked ✓). The rest are optional
toggles to apply based on the user's needs.

| Setting | Templates | Why |
|---|---|---|
| `N8N_ENCRYPTION_KEY` set explicitly | ✓ | Key lives in your secret store, not just a volume |
| `N8N_SECURE_COOKIE=true` + `N8N_PROXY_HOPS=1` + `N8N_PROTOCOL=https` | ✓ | Login cookie only over HTTPS; n8n trusts Caddy's `X-Forwarded-*`. (Get these wrong and secure-cookie can lock you out.) |
| `WEBHOOK_URL` / `N8N_EDITOR_BASE_URL` = the public HTTPS URL | ✓ | Otherwise n8n hands out `http://localhost:5678/...` webhook & OAuth-callback URLs |
| `N8N_DIAGNOSTICS_ENABLED=false` | ✓ | Turns off anonymous telemetry |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` | ✓ | Code-node/expressions can't read `process.env` (your container secrets). Relax only if a workflow genuinely needs an env var. |
| `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` | ✓ | Large files go to disk, not RAM/DB (queue multi-host → `s3`) |
| Execution-data pruning (`EXECUTIONS_DATA_PRUNE` + `_MAX_AGE` + `_PRUNE_MAX_COUNT`) | ✓ | Caps disk/DB growth and how long run data (which can contain PII) is retained |
| Internal ports never published (5678/5432/6379) | ✓ | Only Caddy is internet-facing |
| `N8N_RUNNERS_ENABLED=true` | ✓ | Isolates Code-node execution in a task runner |
| `NODE_FUNCTION_ALLOW_EXTERNAL` left unset | ✓ | Blocks importing arbitrary npm modules in the Code node. To allow specific ones: set a comma list (e.g. `axios,lodash`) — never `*` on a multi-user box. |
| `N8N_PUBLIC_API_DISABLED=true` | optional | Turn the public REST API off if unused (commented in the single template) |
| OS firewall: only 22/80/443 | apply in step 5 | `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable` |
| Owner account + 2FA | hand-off | First account created is the instance owner; enable 2FA |
| Keep host + image updated | `DAY2.md` | Patch the OS; update the n8n image deliberately |

## Don't-leak rules (client safety)

- **Fresh secrets per box** — never carry an encryption key, DB password, or `.env` from one
  client's instance to another.
- **No secrets in committed files** — `.env` only (600), referenced as `${VAR}`. Scan any file
  you're about to commit: it must contain zero real keys, tokens, passwords, or client domains.
- **Redact when inspecting** — when reading a `.env` to debug, mask values
  (`sed -E 's/=.*/=<redacted>/'`); never paste raw secret values into chat or logs.
- **The Caddyfile and compose templates are domain-free** (the domain comes from `.env`), so
  they're safe to keep in version control; a `.env` is not.
