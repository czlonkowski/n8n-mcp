# Day-2: update, back up, restore

Operating the instance after it's live. All commands run from `<DATA_FOLDER>` on the box.

## Update the n8n image

n8n ships breaking changes between majors — pin a version in `.env` (`N8N_IMAGE_TAG`) and bump
it deliberately rather than chasing `:latest`.

```bash
cd <DATA_FOLDER>
# (optional) bump N8N_IMAGE_TAG in .env to a specific version first
docker compose pull
docker compose up -d           # recreates only changed services; volumes/data persist
docker compose exec n8n n8n --version
```

(The docs' own sequence inserts `docker compose down` between `pull` and `up -d`; skipping it as
above avoids the full-stack teardown and is equally safe for data — either works.)

- **Queue mode:** `pull` + `up -d` updates main and workers together — keep them on the **same
  version** (a mixed-version cluster misbehaves).
- On restart, containers get `N8N_GRACEFUL_SHUTDOWN_TIMEOUT` (default 30 s) to finish in-flight
  executions before being killed — raise it if long-running workflows keep getting cut off
  mid-update. (The old `QUEUE_WORKER_TIMEOUT` is deprecated in favor of this.)
- **Rollback is only half-safe.** Pinning the previous `N8N_IMAGE_TAG` works *if no DB migration
  ran* during the update. n8n auto-runs migrations on boot and they are forward-only — the docs
  document no downgrade path — so once the new version has booted against the DB, a clean
  rollback means old image tag **plus restoring the pre-update DB backup**. This is why the
  backup below comes *before* the update, not after it breaks.
- Update deliberately but regularly (docs suggest at least monthly, so you never jump many
  versions at once) and read the release notes for breaking changes before **every** update, not
  just majors. For instances a business depends on, docs recommend trying the update on a
  staging copy first. Official update guide:
  <https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/update-n8n>.

## Back up — what actually matters

Two things, and they're only useful **together**:

1. **The `N8N_ENCRYPTION_KEY`** — it's in `.env` (and the `n8n_data`/`n8n_storage` volume at
   `~/.n8n/config`). Store it off-box. A DB backup without this key is undecryptable.
2. **The data:**
   - **Single (SQLite):** the `n8n_data` volume (holds the SQLite DB, the key, and filesystem
     binary data).
   - **Queue (Postgres):** a `pg_dump` of the database. With the template's
     `N8N_DEFAULT_BINARY_DATA_MODE=database`, binary data is **inside Postgres**, so the dump
     covers it — the `n8n_storage` tar below is belt-and-braces for `~/.n8n` itself (config,
     including any auto-generated key).

### Single (SQLite) — snapshot the volume

```bash
docker run --rm \
  -v n8n_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n_data-$(date +%F).tar.gz -C /data .
# also copy .env (it holds the encryption key) somewhere safe & private
```

### Queue (Postgres) — dump the DB

```bash
# Single-quote the inner command so $POSTGRES_USER/$POSTGRES_DB expand INSIDE the
# postgres container (where they're set), not in your host shell (where they aren't).
docker compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > n8n-db-$(date +%F).sql.gz
# optional but cheap — the ~/.n8n volume (config; name matches the compose `name:`):
docker run --rm -v n8n_storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n_storage-$(date +%F).tar.gz -C /data .
# and back up .env (encryption key) off-box
```

Schedule these (cron) and copy the artifacts off the machine. Test a restore at least once.

### Alternative: CLI export (portable, human-readable)

For workflow-level backups (e.g. before risky edits) the CLI has a purpose-built flag:

```bash
docker compose exec -u node n8n n8n export:workflow --backup --output=/home/node/.n8n/backup/
```

Credentials export encrypted by default (`n8n export:credentials --all`) and need the same
`N8N_ENCRYPTION_KEY` to re-import; `--decrypted` writes **plaintext secrets** — treat such a
file as a live credential dump. CLI reference:
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line>.

## Restore

The golden rule: **restore the data with the original `N8N_ENCRYPTION_KEY` in place**, or saved
credentials won't decrypt. So put the backed-up key into `.env` *before* bringing n8n up.

### Single (SQLite)

```bash
# fresh box: lay down the project + .env (with the ORIGINAL encryption key), do NOT start n8n yet
docker volume create n8n_data
docker run --rm -v n8n_data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/n8n_data-YYYY-MM-DD.tar.gz'
docker compose up -d
```

### Queue (Postgres)

```bash
# bring up just the DB first so it's ready to receive the dump
docker compose up -d postgres
gunzip -c n8n-db-YYYY-MM-DD.sql.gz | \
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
# restore the binary volume if you backed it up, then:
docker compose up -d
```

## Routine checks

```bash
docker compose ps                 # health
docker compose logs -f n8n        # main logs
docker system df                  # disk used by images/volumes
df -h                             # host disk (watch execution data + binary growth)
```

If disk creeps up, tighten execution pruning (`EXECUTIONS_DATA_MAX_AGE` /
`EXECUTIONS_DATA_PRUNE_MAX_COUNT`; defaults 336 h / 10 000 — the templates set them explicitly).
In single mode also confirm `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` so run payloads aren't
bloating SQLite; in queue mode binary data intentionally lives in Postgres, so pruning is what
bounds it.

Going further (all optional):

- **Log tuning** — `N8N_LOG_LEVEL` (`info` default; `debug` when diagnosing) and
  `N8N_LOG_OUTPUT=console` fit Docker; file output + rotation vars exist:
  <https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/set-up-logging>.
- **Prometheus** — `N8N_METRICS=true` exposes `/metrics` **unauthenticated**; since Caddy proxies
  everything, that would be public — keep it off, or block `/metrics` in the Caddyfile first:
  <https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/enable-prometheus-metrics>.
- **Health/monitoring endpoints** — `/healthz` (process up) vs `/healthz/readiness` (DB ready):
  <https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/monitor-n8n>.
- **Periodic security audit** — `docker compose exec -u node n8n n8n audit` (or the
  `n8n_audit_instance` MCP tool from the n8n-mcp pack):
  <https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/run-security-audits>.
