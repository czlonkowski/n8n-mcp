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

- **Queue mode:** `pull` + `up -d` updates main and workers together — keep them on the **same
  version** (a mixed-version cluster misbehaves). Review the release notes before a major bump.
- Roll back by setting `N8N_IMAGE_TAG` to the previous version and re-running `pull` + `up -d`.
- Always **back up before** a major upgrade (below). n8n auto-runs DB migrations on boot.

## Back up — what actually matters

Two things, and they're only useful **together**:

1. **The `N8N_ENCRYPTION_KEY`** — it's in `.env` (and the `n8n_data`/`n8n_storage` volume at
   `~/.n8n/config`). Store it off-box. A DB backup without this key is undecryptable.
2. **The data:**
   - **Single (SQLite):** the `n8n_data` volume (holds the SQLite DB, the key, and filesystem
     binary data).
   - **Queue (Postgres):** a `pg_dump` of the database, **plus** the `n8n_storage` volume if you
     use `filesystem` binary mode.

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
# plus the binary volume if using filesystem mode (name matches the compose `name:`):
docker run --rm -v n8n_storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n_storage-$(date +%F).tar.gz -C /data .
# and back up .env (encryption key) off-box
```

Schedule these (cron) and copy the artifacts off the machine. Test a restore at least once.

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
`EXECUTIONS_DATA_PRUNE_MAX_COUNT`) and confirm `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` so run
payloads aren't bloating the database.
