# Queue mode

Executions are pulled off a Redis queue by a pool of **worker** processes, so work runs in
parallel and scales horizontally. Template: `assets/docker-compose.queue.yml`.

## Architecture

| Service | Role |
|---|---|
| `caddy` | public reverse proxy, HTTPS |
| `n8n` (main) | editor UI, REST API, triggers/timers, **receives webhooks and enqueues** executions — it does not run them |
| `n8n-worker` | pulls jobs off the queue and **executes** workflows; scale the replica count for more throughput |
| `redis` | the Bull message queue holding pending executions |
| `postgres` | the shared database (workflows, credentials ciphertext, execution data) — **required** |

SQLite is **not supported** in queue mode; Postgres is mandatory. `init-data.sh` creates the
non-root DB user n8n connects as, separate from the Postgres superuser.

## The settings that make it queue mode

Set on **main and every worker** (the `x-n8n` anchor applies them to both):

- `EXECUTIONS_MODE=queue`
- `QUEUE_BULL_REDIS_HOST=redis`, `QUEUE_BULL_REDIS_PORT=6379`
- `QUEUE_HEALTH_CHECK_ACTIVE=true` (workers expose `/healthz` for probes)
- `DB_TYPE=postgresdb` + the `DB_POSTGRESDB_*` connection vars
- **`N8N_ENCRYPTION_KEY` — identical everywhere.** Workers decrypt credentials to run nodes;
  a mismatched key means workers can't decrypt and executions fail. The anchor sets it once
  from `.env`; never override it per-service.
- `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true` — even "Test workflow" runs go to workers.

The **main** additionally gets the public-URL vars (`N8N_HOST`, `WEBHOOK_URL`,
`N8N_EDITOR_BASE_URL`, `N8N_PROTOCOL=https`, `N8N_PROXY_HOPS=1`, `N8N_SECURE_COOKIE=true`) —
workers don't serve the UI so they don't need them.

## Scaling the workers

- Each worker runs `worker --concurrency=5` (5 simultaneous executions per worker; raise for
  many light executions, lower for heavy ones).
- More throughput = more workers. The template sets `deploy.replicas: 2`, which **Docker Compose
  v2 honors under `docker compose up`** (here it is *not* Swarm-only). To change the count, either
  edit `deploy.replicas` and re-run `docker compose up -d`, or override at launch with
  `docker compose up -d --scale n8n-worker=N` — a `--scale` value supersedes `replicas` (passing
  both at once just prints a harmless conflict warning).
- Rough capacity ≈ `replicas × concurrency` simultaneous executions, bounded by CPU/RAM and
  `DB_POSTGRESDB_POOL_SIZE` (default 2 per process — raise it if many workers exhaust the pool).
- Optionally cap instance-wide load with `N8N_CONCURRENCY_PRODUCTION_LIMIT`.

## Binary data: filesystem vs S3

- **One host (this template):** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` works because main and
  all workers **share the `n8n_storage` volume**, so a file written by one is visible to the
  others. The anchor mounts that shared volume on every n8n container.
- **Workers on separate hosts:** they can't share a local volume — switch to
  `N8N_DEFAULT_BINARY_DATA_MODE=s3` and configure the `N8N_EXTERNAL_STORAGE_S3_*` vars, or
  binary references written by one host won't resolve on another.

## Optional: dedicated webhook processors

For very webhook-heavy instances you can run `n8n webhook` processes and route `/webhook/*` +
`/webhook-waiting/*` to them at the proxy, keeping the main process responsive. Don't put the
main process in that load-balancer pool. Most deployments don't need this — add it only when
webhook intake is the bottleneck.

## Memory

Queue mode wants more RAM than single: a practical floor is ~4 GB, with each worker wanting
~1–2 GB depending on workload (set `mem_limit`/`NODE_OPTIONS=--max-old-space-size` if needed).
Confirm the box is sized before deploying.

## Verify

```bash
docker compose ps     # postgres & redis healthy, then n8n (main) + workers Up
docker compose logs caddy | grep -i 'certificate obtained'
curl -fsS --retry 5 --retry-delay 10 https://<fqdn>/healthz
docker compose logs n8n-worker | grep -iE 'ready|listening|jobs'   # worker is up + listening
```

A real test: run a workflow from the editor and confirm a worker logs that it executed it.
