# n8n Multi-Instance Skill

Expert guidance for working with the n8n-mcp `n8n_instances` tool — choosing and switching which
n8n instance an MCP session targets, verifying the target before high-stakes work, and recovering
from misroutes. Only relevant when the account has multi-instance mode on (the `n8n_instances` tool
is present); single-instance accounts never need it.

---

## The core problem this skill solves

In multi-instance mode, one MCP connection reaches several n8n instances (e.g. `prod`, `staging`,
or one per client). **Every** n8n tool — workflows, datatables, credentials, executions — routes to
whichever instance the session is currently targeting, uniformly and with no per-call instance
argument. There is no error when you operate on the wrong one: you simply read the wrong data, or
get a `NOT_FOUND` that looks like a deletion. The danger is silence, so the skill is about
**targeting deliberately and verifying before it matters**.

| | Get it right | Get it wrong |
|---|---|---|
| Read | Data from the instance you meant | Wrong/empty data, or `NOT_FOUND` that looks like a deletion |
| Credential write | Secret lands on the intended instance | The *ambiguous* case fails closed (`INSTANCE_AMBIGUOUS`); an explicit switch to the wrong instance still writes the secret there |
| Recovery | `list` → confirm `current` → `switch` → retry | Recreating an object that already exists on another instance |

---

## What This Skill Teaches

### Core concepts
1. **Discover, then switch by name** — `n8n_instances({mode:"list"})` to see `current`/`default`/`available`, then `{mode:"switch", name}` (case-insensitive)
2. **Switch in its own turn** — never batch a `switch` with a dependent call; parallel-batch ordering isn't guaranteed, so the dependent call can resolve against the previous instance
3. **Verify before high-stakes ops** — re-`list` (or `n8n_health_check`, which echoes `instanceName`) immediately before any credential create/update/delete; nothing downstream re-checks
4. **NOT_FOUND ≈ misroute, not deletion** — verify the instance and retry; never recreate
5. **The binding persists** — per-session, surviving reconnects/idle/deploys (~24h); you don't re-switch before every call
6. **Deleted-instance fallback** — if your selected instance is removed mid-session, calls silently fall back to `default`

### Top traps this skill prevents
1. Treating a `NOT_FOUND` as "it was deleted" and recreating an object that lives on another instance
2. Writing a credential to the wrong instance after an explicit (wrong) switch — `current` wasn't verified right before the write, and the ambiguous-write fail-close doesn't catch this case
3. Racing a `switch` against dependent work in the same parallel tool-call batch
4. Assuming a per-call instance argument exists (it doesn't — only `switch` changes the target)
5. Misreading a silent fallback to `default` (after an instance was deleted) as missing data

---

## Skill Activation

Activates when:
- The `n8n_instances` tool is available (multi-instance mode is on)
- The user mentions multiple n8n instances/environments (prod vs staging, several teams/clients)
- A workflow/datatable/credential/execution call returns an unexpected `NOT_FOUND` or wrong/empty data
- You're about to create/update/delete a credential on a multi-instance account

**Example queries**:
- "I have a prod and a staging n8n — create this credential on staging, not prod."
- "`n8n_get_workflow` says NOT_FOUND but I can see the workflow in the UI. What's wrong?"
- "How do I copy a workflow from one of my n8n instances to another?"
- "My agent keeps editing the wrong n8n instance — how do I pin it to the right one?"
- "`n8n_list_workflows` is showing workflows I don't recognize."

---

## File Structure

### SKILL.md
The full skill content — loaded when the skill activates.
- What multi-instance mode is, and when to ignore this skill
- Five golden rules (discover, switch-by-name, switch-in-own-turn, verify-before-writes, NOT_FOUND≈misroute)
- The `n8n_instances` tool: modes, real response shapes, the real error envelope
- Mental model: per-session binding + persistence, uniform resolution, deleted→default fallback
- Recovery playbook (symptom → cause → fix)
- Credential operations as the highest-stakes case
- Copy-between-instances task; quick reference; cross-skill integration

This skill is self-contained in one file — no reference files — because the surface is small and
the rules are tightly coupled.

---

## Quick Reference

```
# See instances + where you are
n8n_instances({ mode: "list" })   → { current, default, available:[{id,name,url,isDefault,isCurrent}] }

# Change the session's target (own turn, then operate)
n8n_instances({ mode: "switch", name: "staging" })   → { previous, current }

# Confirm before a credential write
n8n_instances({ mode: "list" })   # or n8n_health_check → instanceName
n8n_manage_credentials({ action: "create", ... })
```

`n8n_instances` error codes: `UNKNOWN_INSTANCE`, `NAME_REQUIRED`, `MULTI_INSTANCE_DISABLED`,
`NO_SESSION`, `UNKNOWN_MODE`, `INVALID_CONTEXT`. A credential create/update/delete can additionally
fail closed with `INSTANCE_AMBIGUOUS` when the target is ambiguous — switch on this session to
confirm, then retry. The fail-close only covers the ambiguous case, so still verify `current`
before any credential write.

---

## Integration with Other Skills

**n8n-mcp-tools-expert**: owns the `n8n_manage_credentials` tool (CRUD, `getSchema`) and the
secrets-via-credential-system rule. This skill adds the "which instance?" layer on top.

**using-n8n-mcp-skills**: the router — names which skill owns each step of a build.

---

## Success Metrics

After using this skill, you should be able to:

- [ ] List instances and read `current` before acting
- [ ] Switch by name, in its own turn, and confirm the result
- [ ] Verify `current` immediately before any credential create/update/delete
- [ ] Diagnose an unexpected `NOT_FOUND` as a misroute and recover without recreating anything
- [ ] Copy a workflow or credential between instances safely
- [ ] Recognize the silent fallback to `default` when a selected instance is deleted

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n-mcp servers exposing the `n8n_instances` tool (multi-instance mode). On
single-instance accounts the tool is absent and this skill does not apply.

---

**Remember**: there is no per-call instance argument, and a wrong target is usually silent — the
one exception is an ambiguous credential write, which fails closed with `INSTANCE_AMBIGUOUS`.
Discover, switch by name in its own turn, and verify `current` before anything that writes —
credentials above all.
