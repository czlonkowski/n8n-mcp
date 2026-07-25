# n8n Self-Hosting Skill

Expert guidance for a coding agent to deploy a **production self-hosted n8n** end-to-end onto a
fresh Linux VM — Docker Compose behind a **Caddy** reverse proxy with automatic HTTPS — in
either **single/regular mode** or **queue mode** (main + Redis + Postgres + workers), plus the
essential Day-2 operations (update, back up, restore).

This is the one **deployment/ops** skill in the pack. The other skills are about *building*
workflows through the n8n-mcp MCP server; this one is about *standing up the server* they run on.
It does not touch the workflow-building router or hooks — it triggers on its own description when
someone wants to self-host n8n.

---

## What it does

Takes a bare Ubuntu/Debian box with SSH access to a running, TLS-secured n8n:

1. **Asks single vs queue first** (the architectures differ).
2. Collects inputs — domain, TLS email, timezone, SSH target.
3. Preflights DNS + ports (the #1 cause of "it won't get a cert").
4. Installs Docker, lays down the project, **generates fresh secrets on the box**.
5. Brings the stack up behind Caddy and verifies the cert + reachability.
6. Hands off with update/backup/restore guidance.

It is opinionated toward **secure defaults that exceed a naive install**: the encryption key is
set explicitly (not auto-generated), internal ports (5678/5432/6379) are never published,
telemetry is off, Code-node `process.env` access is blocked, and execution data is pruned.

---

## Two modes

| | Single / regular | Queue |
|---|---|---|
| Processes | one n8n | main + N workers |
| Services | n8n + Caddy (SQLite) | n8n + workers + Redis + Postgres + Caddy |
| Executes | in the main process | on workers, in parallel |
| For | one user, light/moderate load | high volume, horizontal scale |

---

## Skill Activation

Activates when the user wants to:
- Self-host / install / deploy / provision n8n on their own server, VPS, or VM
- Set up n8n with Docker Compose, a reverse proxy, or SSL/HTTPS
- Run n8n in queue mode / with workers / scale n8n
- Update, back up, restore, or harden a self-hosted n8n

**Not** for n8n Cloud, and not for building workflows (that's the rest of the pack).

**Example queries**:
- "Deploy n8n to my fresh Hetzner box at n8n.mycompany.com, queue mode."
- "Install self-hosted n8n with Docker and HTTPS on this Ubuntu server."
- "Set up n8n with workers so it can handle a lot of executions."
- "How do I back up and update my self-hosted n8n?"

---

## File Structure

### SKILL.md
The end-to-end orchestrator: mode selection, secret-hygiene rules, inputs, the numbered deploy
flow, verification, and "what not to do."

### Reference files
- **SINGLE_MODE.md** — single-instance specifics, SQLite vs Postgres, when/how to graduate to queue.
- **QUEUE_MODE.md** — queue architecture, worker scaling/concurrency, the shared encryption key, binary data (`database` mode; Enterprise S3/Azure), webhook processors, multi-main licensing.
- **SECURITY.md** — secret generation, the encryption-key rules, and the full hardening checklist.
- **DAY2.md** — updating the image, backing up (key + volume + Postgres), and restoring.

### assets/
Secret-free templates the agent copies to the box:
- `docker-compose.single.yml`, `docker-compose.queue.yml`
- `Caddyfile` (domain-free; driven by `.env`)
- `.env.single.example`, `.env.queue.example` (placeholder values only)
- `init-data.sh` (Postgres non-root user bootstrap for queue mode)

---

## Security posture

Every shipped file is **secret-free and domain-free**. Real secrets only ever exist in a `.env`
on the target box (mode 600), referenced as `${VAR}`. The skill instructs the agent to generate
fresh secrets per box, never reuse an encryption key or `.env` across instances, redact values
when inspecting, and keep internal services off the public interface.

---

## Version

**Version**: 1.1.0 — realigned with the restructured official hosting docs
([docs.n8n.io/deploy/host-n8n](https://docs.n8n.io/deploy/host-n8n)): queue-mode binary data
moved to `database` mode (filesystem is unsupported in queue mode), SSRF protection, encryption-key
rotation, task-runner isolation modes, owner pre-provisioning, CLI backup/export, and monitoring
endpoints, with deep links to the docs for the uncommon paths.
**Compatibility**: Docker Engine + Compose v2 on a Debian/Ubuntu host; n8n official image
(`docker.n8n.io/n8nio/n8n`); Caddy 2 for automatic TLS.

---

**Remember**: pick the mode first, preflight DNS + ports, generate fresh secrets on the box, and
back up the encryption key off-box — a database without its key is undecryptable.
