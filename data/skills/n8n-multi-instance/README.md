# n8n Multi-Instance Skill

Expert guidance for accounts where one n8n-mcp connection reaches several n8n instances — naming the
target instance on each call with the `instance` argument, setting the default with
`n8n_instances` `switch`, verifying the target before high-stakes work, and recovering from
misroutes. Only relevant when the account has multi-instance mode on (the `n8n_instances` tool is
present); single-instance accounts never need it.

---

## The core problem this skill solves

In multi-instance mode, one MCP connection reaches several n8n instances (e.g. `prod`, `staging`,
or one per client). A call that doesn't name its instance goes to the connection's **default** —
and on hosted connectors (claude.ai) that default is shared by every chat and agent on the
connection, so a `switch` in one chat silently moves the others. There is no error when you operate
on the wrong instance: you read the wrong data, or get a `NOT_FOUND` that looks like a deletion.

The fix is to **name the instance on the call**: every n8n tool takes an optional
`instance: "<name>"` that routes only that call and changes nothing for anyone else. That is what
lets several agents work on different instances at the same time.

| | Get it right | Get it wrong |
|---|---|---|
| Read | `instance` named → data from the instance you meant | Unnamed → whatever the shared default points at; wrong/empty data or a `NOT_FOUND` that looks like a deletion |
| Credential write | `instance` named → the secret lands exactly there, never `INSTANCE_AMBIGUOUS` | Unnamed → the default, which another chat may have switched |
| Parallel agents | Each agent names its instance on every call | Agents `switch` and overwrite each other's target |
| Recovery | Retry with the right `instance` | Recreating an object that already exists on another instance |

---

## What This Skill Teaches

### Core concepts
1. **Discover names** — `n8n_instances({mode:"list"})` → `current`/`default`/`available`
2. **Name the instance on every call that matters** — `instance:"<name>"`, case-insensitive, stateless
3. **Unknown names fail closed** — `INSTANCE_NOT_FOUND` with the `available` names; never a silent fallback
4. **`switch` sets the shared default** — only for unnamed calls; its own turn; it moves every chat on a hosted connection
5. **Credential writes name the instance** — a named write is never `INSTANCE_AMBIGUOUS`
6. **NOT_FOUND ≈ misroute, not deletion** — retry with the right `instance`; never recreate
7. **Older servers** — no `instance` property in the tool schemas → switch in its own turn and verify `current`

### Top traps this skill prevents
1. Agents in parallel chats switching the shared default and editing each other's instances
2. Treating a `NOT_FOUND` as "it was deleted" and recreating an object that lives on another instance
3. Writing a credential to whatever instance another chat last switched to
4. Dropping the `instance` argument after `INSTANCE_NOT_FOUND`, which silently runs the call on the default
5. Racing a `switch` against dependent work in the same parallel tool-call batch

---

## Skill Activation

Activates when:
- The `n8n_instances` tool is available (multi-instance mode is on)
- The user mentions multiple n8n instances/environments (prod vs staging, several teams/clients)
- Several agents or chats work on one account at the same time
- A call returns an unexpected `NOT_FOUND`, wrong/empty data, `INSTANCE_NOT_FOUND` or `INSTANCE_AMBIGUOUS`
- You're about to create/update/delete a credential on a multi-instance account

**Example queries**:
- "I have a prod and a staging n8n — create this credential on staging, not prod."
- "I'm running three agents at once, one per client instance — keep them from stepping on each other."
- "`n8n_get_workflow` says NOT_FOUND but I can see the workflow in the UI. What's wrong?"
- "How do I copy a workflow from one of my n8n instances to another?"
- "`n8n_list_workflows` is showing workflows I don't recognize."

---

## File Structure

### SKILL.md
The full skill content — loaded when the skill activates.
- What multi-instance mode is, and when to ignore this skill
- Golden rules (discover, name the instance, fail-closed names, switch only for the default, credential writes, NOT_FOUND≈misroute)
- The `instance` argument: value, scope, fail-closed cases, availability
- The `n8n_instances` tool: modes, real response shapes, the real error envelope
- Mental model: named vs unnamed calls, who shares the default, deleted-instance fallback
- Recovery playbook (symptom → cause → fix)
- Credential operations as the highest-stakes case
- Copy-between-instances without switching; quick reference; cross-skill integration

This skill is self-contained in one file — no reference files — because the surface is small and
the rules are tightly coupled.

---

## Quick Reference

```
# See instances
n8n_instances({ mode: "list" })   → { current, default, available:[{id,name,url,isDefault,isCurrent}], hint }

# Target one call (preferred)
n8n_list_workflows({ instance: "staging" })
n8n_manage_credentials({ action: "create", ..., instance: "staging" })

# Change the default for unnamed calls (own turn; shared by every chat on a hosted connection)
n8n_instances({ mode: "switch", name: "staging" })   → { previous, current }
```

Errors: `INSTANCE_NOT_FOUND` (named instance unknown — pick from `available`), `INSTANCE_AMBIGUOUS`
(unnamed credential write on a session that never chose a target — retry with `instance`), and the
`n8n_instances` codes `UNKNOWN_INSTANCE`, `NAME_REQUIRED`, `MULTI_INSTANCE_DISABLED`, `NO_SESSION`,
`UNKNOWN_MODE`, `INVALID_CONTEXT`.

---

## Integration with Other Skills

**n8n-mcp-tools-expert**: owns the `n8n_manage_credentials` tool (CRUD, `getSchema`) and the
secrets-via-credential-system rule. This skill adds the "which instance?" layer on top.

**using-n8n-mcp-skills**: the router — names which skill owns each step of a build.

---

## Success Metrics

After using this skill, you should be able to:

- [ ] List instances and use their exact names
- [ ] Name the instance on every call of a task, including credential writes
- [ ] Run several agents on one connection without them moving each other's target
- [ ] Recover from `INSTANCE_NOT_FOUND` and `INSTANCE_AMBIGUOUS` correctly
- [ ] Diagnose an unexpected `NOT_FOUND` as a misroute and recover without recreating anything
- [ ] Copy a workflow or credential between instances without switching

---

## Version

**Version**: 2.0.0
**Compatibility**: n8n-mcp servers exposing the `n8n_instances` tool (multi-instance mode). The
per-call `instance` argument needs hosted backend 0.1.120+ / n8n-mcp 2.94.0+; on older servers the
skill falls back to `switch`. On single-instance accounts the tool is absent and this skill does not
apply.

---

**Remember**: name the instance on the call. The default is shared, a wrong target is usually
silent, and a named call is the only target nobody else can move.
