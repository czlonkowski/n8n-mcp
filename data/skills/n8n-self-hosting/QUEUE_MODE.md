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

## Env parity: the rule for every var you add later

Those public-URL vars are the *only* legitimate difference between the main and a worker.
Everything else is behavioural — which database, which queue, which encryption key, which
optional modules, how binary data is stored — and a worker that disagrees with the main about
behaviour is a worker that executes your workflows wrongly.

That is why the template declares the common environment once, in the `x-n8n-env` anchor, and
has the main merge it (`<<: *n8n-env`) before adding its public-URL vars. **Add new behavioural
vars to the anchor, not to the main's own `environment:` block.**

This failure mode is nastier than it sounds, because the main is what you look at. The editor
UI, the REST API and every node's dropdown are served by the main, so a feature enabled only
there *looks* configured — it's the execution, on a worker, that fails. And with
`OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true` even a manual "Test workflow" run lands on a
worker, so there is no local sanity check that would catch it.

Check parity whenever you change the environment:

```bash
diff <(docker compose exec -T n8n env | sort) \
     <(docker compose exec -T --index 1 n8n-worker env | sort)
```

Only the public-URL/proxy vars above (plus per-container noise like `HOSTNAME`) should differ.
Anything else in that diff is a bug you just introduced.

## Optional modules

Some n8n features ship as backend **modules** that are off unless you list them in
`N8N_ENABLED_MODULES` (comma-separated). The Agents feature is the current example:
`N8N_ENABLED_MODULES=agents`. The template carries it commented out in the `x-n8n-env` anchor —
uncomment it there and it reaches main and workers together.

Enabling a module on the main only produces a characteristic failure: the module's REST routes
answer (so the UI populates), but the workers never registered the module's database entities,
so any node that touches it dies at runtime with a TypeORM error like
`EntityMetadataNotFoundError: No metadata for "Agent" was found`. If you see an error of that
shape after enabling a feature, check env parity first — it is almost always this.

**On Agents specifically, be straight with the user.** The docs say *"Queue mode isn't supported
for agents yet, and connecting channels (such as Telegram) can fail"* and recommend regular mode.
That sentence is broader than what the code actually gates: the leader/multi-main checks apply to
agent *schedules and chat channels*, while the `Message an Agent` node just runs the agent inline
in whichever process executes the workflow — so it does work on a worker once the module is
enabled there. Treat that as unsupported territory rather than a supported configuration: it can
break on any upgrade, and the agent knowledge base additionally needs the sandbox vars
(`N8N_AGENTS_AI_SANDBOX_*`, `DAYTONA_*`) on the workers too. If the user's main use of n8n is
agents, single/regular mode is the honest recommendation.

## Instance-wide OAuth apps (credential overwrites)

If you register a shared OAuth app with `CREDENTIALS_OVERWRITE_*`, only the **main** serves the
registration endpoint, but `CREDENTIALS_OVERWRITE_PERSISTENCE=true` belongs on the workers too:
a save is broadcast over pubsub so running workers reload immediately, yet a worker that
**cold-starts** without the flag never reads the stored row and silently loses the overwrite.
That is the classic parity failure from the section above — fine in the editor, broken in
execution. See `CREDENTIAL_OVERWRITES.md`.

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

# main and workers must agree on everything except the public-URL vars
diff <(docker compose exec -T n8n env | sort) <(docker compose exec -T --index 1 n8n-worker env | sort)
```

A real test: run a workflow from the editor and confirm a worker logs that it executed it.
