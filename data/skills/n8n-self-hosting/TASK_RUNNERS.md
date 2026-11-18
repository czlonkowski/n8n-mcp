# Task runners & Python Code nodes

Code nodes (JavaScript and Python) execute inside **task runners**, not in the n8n process. This
file covers switching a Docker deployment to **external mode** — a `n8nio/runners` sidecar next to
n8n — which is what makes Python Code nodes work and what the docs require for real isolation.
Official guide: <https://docs.n8n.io/deploy/host-n8n/configure-n8n/set-up-task-runners>.

## When you need it

- **Any Python Code node.** The official `n8nio/n8n` image ships no Python 3. In the default
  **internal** mode n8n launches the runners as its own child processes, so the Python runner has
  nothing to start and every Python Code node fails with:
  `Python runner unavailable: Python 3 is missing from this system`.
  JavaScript keeps working in internal mode (Node is in the image), which is why this surprises
  people. There is no env var that fixes it inside the n8n container — add the sidecar.
- **Hardening.** Internal mode runs user code as the same user, on the same host, as n8n: code
  that escapes the sandbox can read the database, the encryption key and stored credentials. The
  docs call external mode the production setup for any instance with sensitive data or more than
  one person editing workflows.

Ask the user during input collection: *"Will workflows use Python Code nodes, or will anyone
besides you edit workflows?"* A yes to either means external mode.

## How the pieces fit

- **n8n is the task broker.** It listens on port `5679`, inside the Docker network only — never
  publish it.
- **The sidecar (`n8nio/runners`)** holds a launcher plus the JavaScript runner and the Python
  runner (Python 3.13 on n8n 2.38). The launcher connects to the broker, then starts runner
  processes on demand and stops them after `N8N_RUNNERS_AUTO_SHUTDOWN_TIMEOUT` (default 15 s) idle.
- **The runner version must equal the n8n version.** Drive both images from the same tag
  variable. The image lives on **Docker Hub** (`n8nio/runners`) — there is no
  `docker.n8n.io/n8nio/runners`.
- **External mode moves every Code node, JavaScript included,** into the sidecar. JS module
  allowlists move with it (see "Allowlisting modules").
- **The launcher config** is `/etc/n8n-task-runners.json` inside the sidecar. It decides which env
  vars reach each runner (`allowed-env`) and pins some values (`env-overrides`).

## Single mode: what to add

`.env` — generate the token on the box, like every other secret (`SECURITY.md`):

```bash
echo "N8N_RUNNERS_AUTH_TOKEN=$(openssl rand -hex 32)" >> .env
# N8N_IMAGE_TAG must be a real version (e.g. 2.38.5) or `stable` — the same value feeds both images
```

`docker-compose.yml` — three vars on `n8n`, plus a new service:

```yaml
  n8n:
    image: docker.n8n.io/n8nio/n8n:${N8N_IMAGE_TAG:-stable}
    environment:
      # ...existing vars...
      - N8N_RUNNERS_MODE=external
      - N8N_RUNNERS_BROKER_LISTEN_ADDRESS=0.0.0.0     # default 127.0.0.1 is unreachable from the sidecar
      - N8N_RUNNERS_AUTH_TOKEN=${N8N_RUNNERS_AUTH_TOKEN}

  task-runners:
    image: n8nio/runners:${N8N_IMAGE_TAG:-stable}     # SAME tag as n8n
    restart: unless-stopped
    environment:
      - N8N_RUNNERS_TASK_BROKER_URI=http://n8n:5679   # the n8n service name
      - N8N_RUNNERS_AUTH_TOKEN=${N8N_RUNNERS_AUTH_TOKEN}
      - GENERIC_TIMEZONE=${GENERIC_TIMEZONE}
    # volumes:                                       # only when allowlisting modules (below)
    #   - ./n8n-task-runners.json:/etc/n8n-task-runners.json:ro
    depends_on:
      - n8n
    networks:
      - n8n_net
```

Then `docker compose config -q && docker compose up -d`. n8n is recreated, so expect a few
seconds of downtime.

## Queue mode: one sidecar per worker

> Built from the docs and checked with `docker compose config`. Not yet exercised on a live queue
> cluster. Verify with the `Registered runner` log line on **every** worker before handing off.

The docs are explicit: **each worker needs its own runners sidecar**, and the main needs one too
if `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=false` (the template sets `true`, so the main doesn't).

A launcher connects to exactly one broker, and every worker is its own broker. That breaks the
template's `deploy.replicas` / `--scale n8n-worker=N` approach. A single `task-runners` service
pointed at `http://n8n-worker:5679` attaches to whichever replica DNS returns first. The other
workers have no runner, so their Code nodes wait out `N8N_RUNNERS_TASK_REQUEST_TIMEOUT`
(60 s) and fail. Scaling the sidecar to the same count doesn't help either: the pairing is random.

Use explicit pairs instead, one per worker:

```yaml
  n8n-worker-1:
    <<: *n8n
    command: worker --concurrency=5
  task-runners-1:
    image: n8nio/runners:${N8N_IMAGE_TAG:-stable}
    restart: unless-stopped
    environment:
      N8N_RUNNERS_TASK_BROKER_URI: http://n8n-worker-1:5679
      N8N_RUNNERS_AUTH_TOKEN: ${N8N_RUNNERS_AUTH_TOKEN}
      GENERIC_TIMEZONE: ${GENERIC_TIMEZONE}
    depends_on: [n8n-worker-1]
    networks: [n8n_net]
  # n8n-worker-2 + task-runners-2, … — drop `deploy.replicas` from the worker definition
```

- `N8N_RUNNERS_MODE`, `N8N_RUNNERS_BROKER_LISTEN_ADDRESS` and `N8N_RUNNERS_AUTH_TOKEN` are
  behavioural. Put them in the `x-n8n-env` anchor so main and workers agree (the parity rule in
  `QUEUE_MODE.md`).
- Scaling now means adding a worker plus its runner, not `--scale`.

## Allowlisting modules

**Python: every import is blocked by default**, even `json` or `datetime`. The image's launcher
config pins `N8N_RUNNERS_STDLIB_ALLOW` and `N8N_RUNNERS_EXTERNAL_ALLOW` to empty strings. The
code is rejected before it runs:

```
Security violations detected
Line 1: Import of standard library module 'datetime' is disallowed. Allowed stdlib modules: none
```

Setting those vars on the sidecar container does nothing: the `env-overrides` win, and the docs
say to set them in the config file. The recipe:

```bash
cd <DATA_FOLDER>
# 1. copy the default from the SAME image version you run
docker run --rm --entrypoint cat n8nio/runners:<tag> /etc/n8n-task-runners.json > n8n-task-runners.json
# 2. edit the "python" runner's env-overrides, e.g.
#    "N8N_RUNNERS_STDLIB_ALLOW": "json,datetime,re,math,statistics,hashlib,base64,urllib,collections,itertools,functools,uuid,zoneinfo,decimal"
# 3. mount it read-only on the sidecar (the commented `volumes:` lines above), then:
docker compose config -q && docker compose up -d --force-recreate task-runners
```

- A module entry includes its submodules (`urllib` allows `import urllib.parse`). `*` allows the
  whole standard library, including `os`, `sys`, `subprocess` and `socket`, so don't use it on a
  shared instance.
- **Third-party packages** (`pandas`, `numpy`, …) need a custom image:
  `FROM n8nio/runners:<tag>` +
  `RUN cd /opt/runners/task-runner-python && uv pip install pandas`. Then list them in
  `N8N_RUNNERS_EXTERNAL_ALLOW`. If a package imports modules you haven't listed, set
  `N8N_RUNNERS_ALLOW_TRANSITIVE_IMPORTS=true`, but only for packages you trust.
- **Builtins:** `eval, exec, compile, open, input, breakpoint, getattr, object, type, vars,
  setattr, delattr, hasattr, dir, memoryview, __build_class__, globals, locals` are removed by
  default. Code that calls one fails at runtime with `name 'eval' is not defined`. Dunder attribute
  access (`x.__class__`) and `__import__()` are rejected before execution
  (`Security violations detected`). The deny list is `N8N_RUNNERS_BUILTINS_DENY`.
- **JavaScript:** in external mode `NODE_FUNCTION_ALLOW_BUILTIN` / `NODE_FUNCTION_ALLOW_EXTERNAL`
  are also `env-overrides` in this file, on the `javascript` runner. The image default is `crypto`
  / `moment`. Set them there, not on the n8n container.
- **Timeout:** n8n warns that the default `N8N_RUNNERS_TASK_TIMEOUT` will drop from 300 s to 60 s
  in a future version. If Code nodes legitimately run long, set it explicitly on n8n and on the
  sidecar.

The Python *language* rules this imposes (only `_items`/`_item`, bracket access, return shapes)
belong to workflow authors — the `n8n-code-python` skill covers them.

## Verify

```bash
docker compose ps                                    # n8n + task-runners Up, same tag
docker compose logs n8n | grep 'Registered runner'   # → "launcher-javascript" AND "launcher-python"
docker compose logs task-runners | tail -5           # idle steady state: "Waiting for launcher's task offer to be accepted..."
```

Smoke test: a workflow with a Code node set to **Python** containing
`return [{"json": {"items": len(_items)}}]`. The first run after the sidecar has been idle takes
~1–2 s (runner cold start); later runs take ~0.4 s.

| Symptom | Cause |
|---|---|
| `Python runner unavailable: Python 3 is missing from this system` | The process that executed is still in internal mode. Queue mode: check the **worker** env, not just the main. |
| Code nodes wait ~60 s, then fail | No runner is connected to that broker: token mismatch, wrong `N8N_RUNNERS_TASK_BROKER_URI`, broker still on `127.0.0.1`, runner/n8n version mismatch, or a queue worker without its own sidecar. |
| `Security violations detected` / `Import of … is disallowed` | Module not in the launcher-config allowlist (see above). |
| `name 'open' is not defined` (or another builtin) | Builtin deny list, working as intended. |

## Upgrades

- Bump the shared tag, then `docker compose pull && docker compose up -d`. n8n and the runners
  must move together.
- If you mounted a custom `n8n-task-runners.json`, diff it against the **new** image's default
  before switching. A newer launcher may add `allowed-env` entries or runner args that your
  stale copy would silently drop.
