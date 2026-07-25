---
name: n8n-self-hosting
description: Deploy a production self-hosted n8n end-to-end to a fresh Linux VM over SSH, using Docker Compose behind a Caddy reverse proxy with automatic HTTPS. Use whenever the user wants to self-host, install, set up, provision, or deploy n8n on their own server/VPS/box (Hetzner, DigitalOcean, AWS EC2, bare metal, etc.) — in either single/regular mode or queue mode with workers — or to update, back up, restore, or harden such an instance. This is for SELF-HOSTED n8n (Docker), not n8n Cloud and not building workflows. The skill makes the agent ask single-vs-queue first, collect the domain/SSH/timezone inputs, generate fresh secrets on the box, and bring the stack up with TLS. Trigger on "deploy n8n", "self-host n8n", "install n8n on my server", "n8n docker compose", "n8n queue mode / workers / scaling", "n8n reverse proxy / SSL", or "back up / update my n8n".
---

# Deploying self-hosted n8n

This skill takes a **fresh Linux VM** (Ubuntu/Debian, root or sudo SSH) to a **running,
HTTPS, production n8n** via Docker Compose behind **Caddy** (automatic Let's Encrypt TLS).
It is for **self-hosted n8n on Docker** — not n8n Cloud, and not for building workflows
(that's the rest of this pack).

Two deployment modes. The architectures differ, so **pick the mode before doing anything**.

You drive this end-to-end over SSH: preflight → install Docker → lay down the project →
generate secrets → launch → verify TLS → hand off. The template files live in `assets/`;
the per-mode and security depth live in the reference files named below.

## Rule 0 — choose the mode (ask the user)

Do not guess. Ask, then commit to one:

| | **Single / regular** | **Queue** |
|---|---|---|
| Processes | one n8n | main + N workers |
| Extra services | none (SQLite) | Redis (queue) + Postgres (DB) |
| Executes workflows | in the main process | on workers, in parallel |
| Good for | 1 user, light/moderate load, simplest ops | high volume, heavy/long executions, horizontal scale |
| Compose | `assets/docker-compose.single.yml` | `assets/docker-compose.queue.yml` |
| Deep dive | **`SINGLE_MODE.md`** | **`QUEUE_MODE.md`** |

If unsure, start **single** — it's the simplest correct thing and covers most needs. Moving
to queue later means swapping the compose file and migrating SQLite→Postgres, so if the user
already expects real volume, start **queue**.

## Rule 1 — secret hygiene (non-negotiable)

A misstep here leaks client credentials. Be diligent:

1. **Generate every secret fresh, on the target box.** Never copy an encryption key, DB
   password, or `.env` from another n8n instance into this one. See `SECURITY.md` for the
   `openssl` commands.
2. **Secrets live only in `.env`** (mode 600), referenced by the compose as `${VAR}`. Never
   inline a secret into `docker-compose.yml`, the Caddyfile, or anything you commit.
3. **The `N8N_ENCRYPTION_KEY` is sacred.** It encrypts every stored credential. If it's lost
   or changes, all saved credentials become undecryptable. Set it explicitly, and tell the
   user to back it up **off the box**. Don't echo it into long-lived logs or chat history
   beyond what's needed to hand it over.
4. **Never expose internal services.** Only Caddy (80/443) is public. n8n (5678), Postgres
   (5432), Redis (6379) stay on the private Docker network — the templates already omit their
   host port mappings. Don't add them.
5. **`.env` and Caddy's `caddy_data` volume (the issued certs + ACME account key) are not
   artifacts to share.** If you're working inside a git repo, confirm `.env` is git-ignored
   before any commit.

## Inputs to collect up front

- **SSH target** — `user@host` and how you authenticate (key path or the user confirms the agent already has access). Root or a sudo user.
- **Domain** — the full hostname n8n will live at, e.g. `n8n.example.com` (→ `SUBDOMAIN=n8n`, `DOMAIN_NAME=example.com`). The user must control its DNS.
- **TLS email** — for Let's Encrypt (`SSL_EMAIL`).
- **Timezone** — IANA name for Schedule/Cron nodes (e.g. `Europe/Warsaw`), else `Etc/UTC`.
- **Mode** — single or queue (Rule 0). Queue → confirm the box has enough RAM (rough floor ~4 GB; each worker wants ~1–2 GB).

## The deploy flow

Work through these in order. `SINGLE_MODE.md` / `QUEUE_MODE.md` give the mode-specific command
detail; `SECURITY.md` covers secret generation and hardening; `DAY2.md` covers update/backup/restore.

### 1. Preflight (the cheapest failure is the one you catch here)
- SSH in; confirm the OS is Debian/Ubuntu-like (`. /etc/os-release`).
- **DNS must already point at the box.** Compare the box's public IP (`curl -s ifconfig.me`)
  with `dig +short <fqdn>` (run it from the box AND ideally your laptop). If they don't match,
  **stop** — Caddy's ACME challenge will fail. Have the user create the A record, wait for it
  to propagate, then continue.
- Ports **80 and 443** must be reachable from the internet. Check the host firewall AND any
  cloud security group / network firewall (Hetzner Cloud, AWS SG, etc.) — these are outside
  the box and a common silent blocker.

### 2. Install Docker (if absent)
- Check `docker --version` and `docker compose version`. If missing, install Docker Engine +
  the Compose plugin (Docker's official `get.docker.com` script on Ubuntu/Debian is fine).
  Re-check `docker compose version` before proceeding.

### 3. Lay down the project
- Pick `DATA_FOLDER` — an **absolute path**, e.g. `/opt/n8n`. The `DATA_FOLDER` value in `.env`
  **must equal this exact directory** (the compose mounts `${DATA_FOLDER}/caddy_config/Caddyfile`,
  and `init-data.sh` is mounted via a relative `./` path), so always run `docker compose` from
  here. Create it, plus `caddy_config/` and `local_files/` inside.
- **Get the template files onto the box.** They live in this skill's `assets/` on *your* machine,
  not on the server — transfer each one. Either `scp` them up, or (no local copy needed) write
  each file's contents over SSH, e.g.
  `ssh <target> 'cat > <DATA_FOLDER>/docker-compose.yml' < assets/docker-compose.single.yml`.
  Land them with these exact names:
  - the chosen compose → `<DATA_FOLDER>/docker-compose.yml` (rename it to exactly this)
  - `Caddyfile` → `<DATA_FOLDER>/caddy_config/Caddyfile`
  - **queue only:** `init-data.sh` → `<DATA_FOLDER>/init-data.sh`, then `chmod +x` it
  - the matching `.env.*.example` → `<DATA_FOLDER>/.env`

### 4. Fill `.env` + generate secrets
- Set `DATA_FOLDER`, `DOMAIN_NAME`, `SUBDOMAIN`, `SSL_EMAIL`, `GENERIC_TIMEZONE`.
- Generate each secret **on the box** with `openssl` (`SECURITY.md` has the commands) and **write
  it into `.env`, replacing the matching `REPLACE_WITH_…` placeholder**: `N8N_ENCRYPTION_KEY`;
  queue also `POSTGRES_PASSWORD` + `POSTGRES_NON_ROOT_PASSWORD`.
- **Before launching, confirm none are left unset:** `grep REPLACE_WITH_ .env` must return nothing
  — a leftover placeholder becomes the literal password and Postgres/n8n fail to connect.
- `chmod 600 .env`. Record the encryption key so the user can back it up off-box.

### 5. Firewall
- `ufw`: allow OpenSSH + 80 + 443, then enable. Do **not** open 5678/5432/6379.

### 6. Launch
- `cd <DATA_FOLDER> && docker compose up -d`.
- Queue mode brings up Redis + Postgres + main + workers (workers via `replicas`). To add
  capacity: `docker compose up -d --scale n8n-worker=N`.

### 7. Verify (don't declare success without this)
- `docker compose ps` — every service `Up`/healthy (queue: postgres & redis `healthy` first).
- **n8n itself up (internal):** `docker compose exec n8n wget -qO- http://localhost:5678/healthz`
  → `{"status":"ok"}`. This separates "n8n is running" from "TLS isn't ready yet."
- **Cert issued:** `docker compose logs caddy | grep -i 'certificate obtained'`. First-boot ACME
  can take a minute or two; until it finishes, a public `https://` request fails TLS — that means
  the cert is still pending, **not** that n8n is down.
- **Public reachability (with retry):** `curl -fsS --retry 5 --retry-delay 10 https://<fqdn>/healthz`
  → `{"status":"ok"}`. (`/healthz` only proves the process is reachable; `/healthz/readiness`
  additionally confirms the DB is connected and migrated — use it when debugging a boot loop.)
- Open `https://<fqdn>` → the **owner setup** screen. **Whoever completes that signup form first
  claims the instance** — an exposed un-owned instance is a race, so create the owner account
  immediately, before sharing the URL. Enable 2FA. (Automated deploys can pre-provision the
  owner via env vars instead — see the owner row in `SECURITY.md`.)

### 8. Hand off
- Give the user: the URL, where the project lives, the encryption key to store safely, and the
  Day-2 basics (update / backup / restore) from **`DAY2.md`**.

## What NOT to do

- **Don't skip the DNS/ports preflight.** A wrong A record or a closed cloud firewall is the
  #1 reason Caddy can't get a cert and n8n looks "broken."
- **Don't publish 5678/5432/6379** to the host. Caddy reaches n8n over the private network.
- **Don't reuse another instance's encryption key or `.env`.** Fresh secrets per box.
- **Don't run queue mode on SQLite.** Queue requires Postgres (the template already wires it).
- **Don't put secrets in `docker-compose.yml` or the Caddyfile.** `.env` only.
- **Don't use `:latest` blindly.** Pin `N8N_IMAGE_TAG`; update deliberately (`DAY2.md`).

## Reference files

- **`SINGLE_MODE.md`** — single-instance specifics, SQLite vs Postgres, when to graduate to queue.
- **`QUEUE_MODE.md`** — queue architecture, workers/concurrency/scaling, shared encryption key, binary data (`database` mode — filesystem is unsupported in queue mode; S3/Azure = Enterprise), webhook processors, multi-main licensing.
- **`SECURITY.md`** — generating secrets, the encryption-key rules, the full hardening checklist (telemetry off, env-access block, public API, firewall, secure cookies).
- **`DAY2.md`** — updating the image, backing up (encryption key + volume + Postgres), and restoring.
- **`assets/`** — the templates: `docker-compose.single.yml`, `docker-compose.queue.yml`, `Caddyfile`, `.env.single.example`, `.env.queue.example`, `init-data.sh`.

Authoritative upstream reference: the official hosting docs live at
<https://docs.n8n.io/deploy/host-n8n> (restructured mid-2026 from the old `/hosting/` paths —
prefer these URLs). The env-var reference index is at
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables>.
When this skill and the live docs disagree, trust the docs and tell the user.
