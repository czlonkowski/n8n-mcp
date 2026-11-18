---
name: n8n-multi-instance
description: Use when an n8n-mcp account targets more than one n8n instance — i.e. the `n8n_instances` tool is available, the user mentions multiple n8n instances or environments (prod vs staging, several teams or clients), several agents or chats work on one account in parallel, a workflow / datatable / credential / execution call returns an unexpected NOT_FOUND or reads data you don't recognize, or a call is refused with `INSTANCE_AMBIGUOUS` or `INSTANCE_NOT_FOUND`. Covers naming the target instance on each call with the `instance` argument, setting the default with `switch`, verifying the target before high-stakes work — credential writes above all — and recovering from misroutes and fail-closes. Always consult this skill before operating on a specific instance, before any credential create/update/delete on a multi-instance account, or when a call hits the wrong/empty data or an instance error.
---

# Working with multiple n8n instances over MCP

When the `n8n_instances` tool is available, the user has **multi-instance mode** on: one MCP
connection can reach several n8n instances (e.g. `prod`, `staging`, or one per client/team).

There are two ways to say which instance a call should hit:

- **Name it on the call** — every n8n tool (`n8n_get_workflow`, `n8n_list_workflows`,
  `n8n_update_partial_workflow`, `n8n_manage_datatable`, `n8n_manage_credentials`,
  `n8n_executions`, `n8n_test_workflow`, `n8n_health_check`, …) takes an optional
  `instance: "<name>"`. It routes **that one call** and changes nothing else. **Prefer this.**
- **Set the default with `switch`** — `n8n_instances({mode:"switch", name})` sets the instance used
  by calls that *don't* name one.

The default is shared more widely than it looks. On claude.ai (and other hosted connectors) one
connection serves **every chat and agent** using it, so a `switch` in one chat moves all the
others too — and their next unnamed call silently lands on your instance. A wrong target is
usually silent: a read returns the wrong data and a write lands in the wrong place. So name the
instance.

If the `n8n_instances` tool is **not** present, the account is single-instance: ignore this skill
and use the n8n tools directly.

> **Availability.** The `instance` argument needs hosted n8n-mcp backend 0.1.120+ / n8n-mcp
> 2.94.0+. It is there when the n8n tools' input schemas list an `instance` property (and the
> `n8n_instances` list output carries a `hint` about it). If it isn't listed, the server predates
> it: fall back to `switch`, in its own turn, as described under *Switching*.

## Golden rules

1. **Discover first.** Call `n8n_instances({mode:"list"})` so you know the exact instance names and
   which one is `current`. Never guess a name.
2. **Name the instance on every call when it matters** — whenever you work on more than one
   instance, on any instance other than `current`, or alongside other agents/chats on the same
   account: `n8n_list_workflows({instance:"prod"})`. Names are case-insensitive. Pass the name the
   same way on every call of the task; there is nothing to "set up" first.
3. **An `instance` you name is never silently replaced.** An unknown name fails with
   `INSTANCE_NOT_FOUND` and lists the `available` names — pick one from that list and retry. It
   never falls back to another instance.
4. **Use `switch` only to change the default**, and only when you're the sole user of the
   connection. Switch in its **own turn** — never in the same parallel batch as a call that depends
   on it (batch order isn't guaranteed).
5. **Credential writes: name the instance.** `n8n_manage_credentials({action:"create", …,
   instance:"prod"})`. A named write is explicit, so it is never `INSTANCE_AMBIGUOUS`. Check the name
   against `list` first — naming the *wrong* instance writes the secret there.
6. **An unexpected `NOT_FOUND` is almost always a wrong-instance misroute, not a deletion.** Don't
   recreate the object. Retry with `instance` set to where it lives (see Recovery).

## Core workflow

```
1. n8n_instances({mode:"list"})                        # names, current, default
2. n8n_list_workflows({instance:"client-a"})            # read on client-a
3. n8n_get_workflow({id:"…", instance:"client-b"})      # read on client-b — no switch needed
4. n8n_update_partial_workflow({id:"…", operations:[…], instance:"client-b"})
5. Credential write:
   n8n_manage_credentials({action:"create", name:"…", type:"…", data:{…}, instance:"client-a"})
```

Every call names its target, so it doesn't matter what any other chat switched to in between, and
calls can safely run in the same parallel batch even when they target different instances.

## The `instance` argument

- **Value:** an instance **name** from `n8n_instances` `list` (`available[].name`), matched
  case-insensitively. Not the id, not the URL — the same URL can be registered under several names.
- **Scope:** routes only the call that carries it. It does **not** change `current` or the default
  for anyone.
- **Omitted (or empty):** the call uses the default — the last `switch` on this connection, or the
  account default.
- **Fails closed** with `INSTANCE_NOT_FOUND` (the call never reaches n8n, no quota charged) when:
  - the name matches no instance — the error lists `available`;
  - the value isn't a string;
  - multi-instance mode is off and the name isn't the one instance the connection reaches.

```json
{
  "error": "INSTANCE_NOT_FOUND",
  "message": "No n8n instance named \"clinet-a\". Pass one of the available names as `instance`, …",
  "available": ["client-a", "client-b"]
}
```

`n8n_instances` itself doesn't take `instance` — it has its own `name` argument for `switch`.

## The `n8n_instances` tool

Two modes (`mode` is required and enum-validated):

- `{mode:"list"}` → `{ current, default, available, hint }`, no side effects.
  - `current` and `default` are each one instance `{ id, name, url, isDefault }` (or `null`).
  - `available` is every instance, each with an extra `isCurrent` boolean. Match by **`name`**;
    never hard-code `id`.
- `{mode:"switch", name:"<name>"}` → `{ previous, current }`, and sets the default for calls that
  don't name an instance. `name` is case-insensitive.

### Error envelope (from the `n8n_instances` tool)

Every error returns `{ error: "<CODE>", message, … }`. The ones you'll actually hit:

| Code | When | What to do |
|---|---|---|
| `UNKNOWN_INSTANCE` | `switch` `name` matches no instance | Pick a name from the `available` list in the error payload and retry. |
| `NAME_REQUIRED` | `switch` with no `name` | Re-call with a `name` (the error lists the valid ones in `available`). |
| `MULTI_INSTANCE_DISABLED` | multi-instance mode is off | There's nothing to switch; use the n8n tools directly. The user can enable it at the n8n-mcp dashboard. |
| `NO_SESSION` | the request has **neither** an MCP session id **nor** a credential id | A selection has nowhere to land. Reconnect / initialize a session, then switch — or just name the `instance` on each call. |
| `UNKNOWN_MODE` | `mode` wasn't `list`/`switch` | Use `list` or `switch`. |
| `INVALID_CONTEXT` | server-side metadata missing | A server bug, not your input — report it. |

> Instance names can never be `default`, `current`, `list`, or `switch` (reserved), so you'll never
> see an instance literally named after a mode or field.

### `INSTANCE_AMBIGUOUS` (from the credential-write path, not the tool)

Returned when you call `n8n_manage_credentials` (or an `n8n_manage_agents` write) **without**
`instance`, and the default this call inherited is ambiguous: this session never switched on its own
but picked up a switch made elsewhere, pointing at a **non-default** instance. Rather than risk
writing a secret to the wrong instance, the server **blocks the write** (it never reaches n8n, no
quota is charged) and returns:

```json
{
  "error": "INSTANCE_AMBIGUOUS",
  "message": "… the session issuing this request never switched there itself … Re-run n8n_instances({mode:\"switch\", name:\"…\"}) on this session to confirm the target …",
  "lastSelected": { "id": "…", "name": "…" },
  "default":      { "id": "…", "name": "…" }
}
```

**Fix:** decide which instance you actually want (`lastSelected` is the inherited switch, `default`
is the account default) and **retry the write with `instance:"<that name>"`**. (On a server without
the `instance` argument, run `n8n_instances({mode:"switch", name:"…"})` on this session, then retry.)

## How targeting behaves (mental model)

- **A named call** goes to the named instance, full stop. It's stateless: it neither reads nor
  changes the default.
- **An unnamed call** goes to the default: the last `switch` on this connection, else the account
  default.
- **Who shares the default depends on the client.** A hosted connector (claude.ai, and anything that
  spreads one chat over many MCP sessions) keeps **one default per connection**, shared by every
  chat and agent on it. A direct client with a stable MCP session (Claude Code, Cursor) keeps a
  default per terminal, but can fall back to the connection's last switch after a reconnect. Either
  way, other work can move your default — that is why rule 2 says to name the instance.
- A `switch` persists across reconnects, idle and backend deploys (~24h, the MCP session lifetime).
- **Reads and non-credential writes** without `instance` route to the default silently — a misroute
  produces wrong data or a `NOT_FOUND`, not an error.
- **If the default instance is deleted** (the user removes it mid-session), unnamed calls silently
  fall back to the **account default** — no error. Named calls to a deleted instance fail with
  `INSTANCE_NOT_FOUND`.

## Switching (only when you need to change the default)

Use `switch` when the user asks to change "the" instance, or on an older server without the
`instance` argument.

```
1. n8n_instances({mode:"switch", name:"prod"})   # its own turn
   → returns { previous, current }; confirm current.name == "prod"
2. (then, in a later turn) the unnamed calls
3. Before a credential write: n8n_instances({mode:"list"}) → re-confirm current, then write
```

Never batch the switch with the work that depends on it, and remember it moves every chat sharing
the connection.

## Recovery playbook

| Symptom | What it usually means | Do this |
|---|---|---|
| `INSTANCE_NOT_FOUND` | The `instance` name is wrong (typo, guess, or the instance was removed) | Pick a name from the error's `available` list and retry. Never drop `instance` to "make it work" — that silently runs it on the default. |
| `INSTANCE_AMBIGUOUS` on a credential create/update/delete | An unnamed secret write on a session that never chose a target | Retry the write with `instance:"<target>"` (the error names `lastSelected` and `default` — pick the one you want). Never retry blindly. |
| `NOT_FOUND` for a workflow/datatable/credential you **know exists** | You're pointed at the wrong instance — **not** that it was deleted | Retry with `instance` set to where it lives (check names with `list`). **Do not recreate the object.** |
| A read returns **empty or unfamiliar** data | An unnamed call went to a default someone else moved, or fell back after your instance was deleted | Re-run the read with `instance:"<name>"` before drawing conclusions. |
| `UNKNOWN_INSTANCE` on `switch` | The `name` is wrong | Read the `available` names in the error and switch to one of those. |
| `n8n_health_check` reports an `instanceName` you didn't expect | Your unnamed calls are going somewhere else | Name the instance on your calls (or `switch` if you own the connection). `n8n_health_check({instance:"…"})` confirms a name resolves. |

To confirm where unnamed calls go, read `current` from `n8n_instances({mode:"list"})` (primary).
`n8n_health_check` also returns the resolved instance under `details.instanceName`, but it can be
absent on some paths (legacy/chat), so treat it as a secondary confirmation.

## Credential operations (highest stakes)

Credentials hold live secrets, and a misrouted credential write puts a secret on the **wrong
instance**. So:

- **Name the instance on every credential create/update/delete:**
  `n8n_manage_credentials({action:"create", …, instance:"client-a"})`. Take the name from `list` —
  a named write to the wrong instance still writes there.
- Without `instance`, the write goes to the default, which other chats may have moved. The server
  only catches the *ambiguous* case (`INSTANCE_AMBIGUOUS`); an unnamed write after someone else's
  explicit switch goes through to their instance.
- Credential **reads** (`action:"list"`/`"get"`/`"getSchema"`) don't write a secret, but a read off
  the wrong instance returns the wrong schema or list — name the instance there too.
- For the `n8n_manage_credentials` tool itself (CRUD shapes, `getSchema` discovery, never inlining
  secrets into text fields), see `n8n-mcp-tools-expert`.

## Common multi-instance task: copy something between instances

To recreate a credential or workflow from instance A on instance B:

```
1. read the source on A:  n8n_get_workflow({id:"…", instance:"A"})
                          (credentials: n8n_manage_credentials({action:"get", id:"…", instance:"A"}))
2. create it on B:        n8n_create_workflow({…, instance:"B"})
                          (credentials: n8n_manage_credentials({action:"create", …, instance:"B"}))
3. verify on B:           n8n_get_workflow({id:"<new id>", instance:"B"})
```

No switching, so nothing can move the target between the read and the write. n8n doesn't return
credential secret values, so for a credential the user supplies them again for the create on B.

## Quick reference

- See instances: `n8n_instances({mode:"list"})` → `{ current, default, available, hint }`
- Target one call: add `instance:"<name>"` to any n8n tool call — preferred
- Change the default for unnamed calls: `n8n_instances({mode:"switch", name:"<name>"})`, its own turn; shared by every chat on a hosted connection
- `INSTANCE_NOT_FOUND` → use a name from the error's `available` list
- `INSTANCE_AMBIGUOUS` (unnamed credential write) → retry with `instance:"<target>"`
- Unexpected `NOT_FOUND` → retry with the right `instance`; **do not recreate**
- No `instance` property in the tool schemas → older server: `switch` in its own turn, verify `current` before credential writes

## Integration with other skills

- **n8n-mcp-tools-expert** — owns `n8n_manage_credentials` (CRUD + `getSchema`) and the rule that
  secrets go through the credential system, never text fields. This skill adds the "which instance?"
  layer on top.
- **using-n8n-mcp-skills** — the router; consult it for which skill owns a given build step.
