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

The docs mark SQLite as not recommended for queue mode; this skill treats **Postgres as
mandatory** — don't deploy queue mode without it. `init-data.sh` creates the non-root DB user
n8n connects as, separate from the Postgres superuser. Official guide:
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode>.

## The settings that make it queue mode

Set on **main and every worker** (the `x-n8n` anchor applies them to both):

- `EXECUTIONS_MODE=queue`
- `QUEUE_BULL_REDIS_HOST=redis`, `QUEUE_BULL_REDIS_PORT=6379` (Redis auth/TLS/cluster vars
  exist for external Redis; `QUEUE_BULL_REDIS_USERNAME` needs Redis ≥ 6 — full list:
  <https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/queue-mode>)
- `QUEUE_HEALTH_CHECK_ACTIVE=true` (workers expose `/healthz` for probes — off by default)
- `DB_TYPE=postgresdb` + the `DB_POSTGRESDB_*` connection vars
- **`N8N_ENCRYPTION_KEY` — identical everywhere.** Workers decrypt credentials to run nodes;
  a mismatched key means workers can't decrypt and executions fail. The anchor sets it once
  from `.env`; never override it per-service.
- `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true` — even "Test workflow" runs go to workers.

The **main** additionally gets the public-URL vars (`N8N_HOST`, `WEBHOOK_URL`,
`N8N_EDITOR_BASE_URL`, `N8N_PROTOCOL=https`, `N8N_PROXY_HOPS=1`, `N8N_SECURE_COOKIE=true`) —
workers don't serve the UI so they don't need them.

## Scaling the workers

- Each worker runs `worker --concurrency=5` (5 simultaneous executions per worker; the flag's
  upstream default is 10 — the template pins 5 as a safer floor for modest boxes; raise for
  many light executions, lower for heavy ones).
- More throughput = more workers. The template sets `deploy.replicas: 2`, which **Docker Compose
  v2 honors under `docker compose up`** (here it is *not* Swarm-only). To change the count, either
  edit `deploy.replicas` and re-run `docker compose up -d`, or override at launch with
  `docker compose up -d --scale n8n-worker=N` — a `--scale` value supersedes `replicas` (passing
  both at once just prints a harmless conflict warning).
- Rough capacity ≈ `replicas × concurrency` simultaneous executions, bounded by CPU/RAM and
  `DB_POSTGRESDB_POOL_SIZE` (default 2 per process — raise it if many workers exhaust the pool).
- Optionally cap load with `N8N_CONCURRENCY_PRODUCTION_LIMIT` (default `-1` = off). Caveats:
  it counts only **production** executions (webhook/trigger) — manual, sub-workflow, error, and
  CLI runs bypass it — and in queue mode a value other than `-1` **supersedes the worker
  `--concurrency` flag**. Details:
  <https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/control-concurrency>.

## Binary data: database or external storage — NOT filesystem

- **Queue mode does not support `filesystem` binary mode** (the docs are explicit), even with a
  shared volume — workers wouldn't reliably resolve each other's files. The template sets
  `N8N_DEFAULT_BINARY_DATA_MODE=database`: binary data lives in Postgres, visible to main and
  every worker. Doc: <https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/handle-binary-data>.
- `database` mode makes execution **pruning** load-bearing — big payloads now grow Postgres, so
  the template sets `EXECUTIONS_DATA_PRUNE=true` + age/count caps explicitly (binary data is
  pruned as part of execution-data pruning).
- **External storage (S3 / Azure Blob) is Enterprise-licensed** — n8n won't even start in `s3`
  mode without a valid license. If licensed: `N8N_DEFAULT_BINARY_DATA_MODE=s3` +
  `N8N_EXTERNAL_STORAGE_S3_*` vars, and an S3 **lifecycle policy is mandatory** (in s3 mode n8n
  delegates binary pruning to the bucket instead of doing it itself). Doc:
  <https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/use-external-storage>.

## Optional: dedicated webhook processors

For very webhook-heavy instances you can run `n8n webhook` processes (same env as a worker) and
route `/webhook/*` + `/webhook-waiting/*` to them at the proxy, keeping the main process
responsive. Set `N8N_DISABLE_PRODUCTION_MAIN_PROCESS=true` on the main so it stays out of the
webhook pool. Most deployments don't need this — add it only when webhook intake is the
bottleneck. Doc: <https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode>.

## Not in this template: multi-main (HA)

Running **multiple main processes** with leader election/failover exists but is
**Enterprise-only** (`N8N_MULTI_MAIN_SETUP_ENABLED=true` on every main). On the community
edition the main process stays a singleton; scale workers instead. If a user asks for "HA n8n"
without an Enterprise license, that's the honest answer.

## Memory

Queue mode wants more RAM than single: a practical floor is ~4 GB, with each worker wanting
~1–2 GB depending on workload — rules of thumb from real deployments; the docs don't publish
sizing tables. For OOM crashes the docs' first advice is to redesign the workflow (batches,
sub-workflows, less Code node), then raise the heap via `NODE_OPTIONS=--max-old-space-size`:
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/fix-memory-issues>. Confirm the box
is sized before deploying.

## Verify

```bash
docker compose ps     # postgres & redis healthy, then n8n (main) + workers Up
docker compose logs caddy | grep -i 'certificate obtained'
curl -fsS --retry 5 --retry-delay 10 https://<fqdn>/healthz
docker compose logs n8n-worker | grep -iE 'ready|listening|jobs'   # worker is up + listening
```

A real test: run a workflow from the editor and confirm a worker logs that it executed it.
