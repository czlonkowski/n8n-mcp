# Single / regular mode

One n8n process handles everything: the editor UI, the REST API, triggers/timers, and it
**executes workflows in-process**. Simplest to run and reason about. Template:
`assets/docker-compose.single.yml`.

## What you get

- `caddy` — public reverse proxy, automatic HTTPS (80/443).
- `n8n` — the single process; data in the `n8n_data` volume (`/home/node/.n8n`).
- **SQLite** by default (the DB file lives in `n8n_data`). No separate database container.

## Is single mode the right call?

Good fit: one user or a small team, light-to-moderate execution volume, you value simple ops
and simple backups. The whole instance is one volume to back up.

Outgrow it when: executions queue up behind each other, long/heavy runs block the UI, or you
need to scale across CPU cores or machines. That's **queue mode** (`QUEUE_MODE.md`).

## SQLite vs Postgres in single mode

These are the only two supported databases — MySQL/MariaDB support no longer exists, and
Postgres is supported on "actively maintained versions" only:
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/choose-n8ns-database>.

- **SQLite (default, template):** zero extra moving parts; back up by snapshotting the
  `n8n_data` volume. Great for most single-instance installs.
- **Postgres (optional upgrade):** more robust under write pressure and the standard if you
  expect to grow. If you know you'll move to queue mode soon, starting on Postgres now avoids a
  later SQLite→Postgres migration. To use it, add a `postgres:16` service (see the queue
  template for the service + `init-data.sh` + healthcheck) and set on n8n:
  `DB_TYPE=postgresdb`, `DB_POSTGRESDB_HOST=postgres`, `DB_POSTGRESDB_DATABASE`,
  `DB_POSTGRESDB_USER`, `DB_POSTGRESDB_PASSWORD`. Everything else stays the same.

## Migrating SQLite → Postgres later

There's no in-place switch. The supported path is: export workflows & credentials, stand up
Postgres, point n8n at it (fresh DB), and re-import. The CLI runs **inside the container as the
`node` user**:

```bash
docker compose exec -u node n8n n8n export:workflow --backup --output=/home/node/.n8n/backup/
docker compose exec -u node n8n n8n export:credentials --all --output=/home/node/.n8n/creds.json
# after pointing n8n at Postgres:
docker compose exec -u node n8n n8n import:workflow --separate --input=/home/node/.n8n/backup/
docker compose exec -u node n8n n8n import:credentials --input=/home/node/.n8n/creds.json
```

Credentials export **encrypted by default** — they only re-import under the **same
`N8N_ENCRYPTION_KEY`**, so keep the key unchanged across the migration. (`--decrypted` exists
but writes plaintext secrets to disk — avoid it unless that's explicitly wanted, and shred the
file after.) Plan a short maintenance window. CLI reference:
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line>.

## Resource notes

A single instance runs comfortably on a small box (≈1–2 GB RAM for light use). Heavy Code-node
or binary work wants more headroom. Set `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` (template
default) so big files don't sit in memory/DB.

## Verify

```bash
docker compose ps                       # caddy + n8n Up
docker compose exec n8n wget -qO- http://localhost:5678/healthz   # n8n itself up (internal)
docker compose logs caddy | grep -i 'certificate obtained'        # cert issued (first boot: ~1–2 min)
curl -fsS --retry 5 --retry-delay 10 https://<fqdn>/healthz       # public; retry covers ACME delay
```

A first-boot TLS failure usually means the cert hasn't issued yet, not that n8n is down. Then open
`https://<fqdn>` and create the owner account immediately (first visitor becomes the owner).
