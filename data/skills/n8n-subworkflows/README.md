# n8n Sub-workflows Skill

Expert guidance for building reusable, composable n8n sub-workflows — extracting shared logic into Execute Workflow Trigger / Execute Workflow pairs that behave like functions: typed inputs, a body that does the work, a returned output shape every caller can rely on.

---

## A sub-workflow is a function

| | Inline logic | Sub-workflow |
|---|---|---|
| Reuse | Copy-pasted across workflows | Called from many workflows |
| Bug fix | Fix in every copy (miss one → drift) | Fix once |
| Caller sees | Five+ nodes of detail | One node ("Parse date") |
| Testable alone | No | Yes (`n8n_test_workflow` with pinned input) |
| Swap implementation | Ripples to every copy | Behind the contract, callers untouched |
| Agent tool | Not directly | Typed trigger → fill-able tool |

The trigger declares typed inputs, the last node returns the output, and the caller invokes it through an Execute Workflow node. Get the input contract and the name right and it's reusable; get them wrong and it quietly becomes the next duplicate.

---

## What This Skill Teaches

### Core Concepts
1. **Search before you build** — `n8n_list_workflows` / `n8n_get_workflow` to find an existing sub-workflow before duplicating (the MCP can't filter by tags, so the name is the discovery surface)
2. **Define Below, not passthrough** — typed trigger fields are what let agents (`$fromAI`) and structured callers pass values; passthrough only for binary or zero-input
3. **`mode: all` vs `each`** — run once over all items, or N times over one each; prefer `each` over an internal Loop Over Items
4. **`waitForSubWorkflow`** — block on the result vs fire-and-forget; `each` + `false` is the only true parallelization
5. **Inputs/outputs are a contract** — typed fields in, a natural (not storage) shape out, documented in the description
6. **Stateless vs deliberately stateful** — the repository pattern, and avoiding accidental state
7. **Verb-first naming** — `Subworkflow:`, `<Domain>:`, `Tool:` prefixes so the next search finds it

### Top traps this skill prevents
1. Passthrough trigger when it should be Define Below → agent can't pass params, structured callers can't bind
2. `mode: all` on a body that assumes one item → aggregates everyone instead of one-per-input
3. Building a duplicate because the existing one wasn't discoverable
4. Returning a storage shape (stringified column) instead of the natural shape
5. Renaming a live input field without migrating callers → silent `undefined`, no error anywhere

---

## Skill Activation

Activates when you:
- Extract shared logic into a reusable sub-workflow
- Build anything multi-step, repeatable, or over ~10 nodes
- Configure an Execute Workflow Trigger's inputs ("Define Below", `workflowInputs`)
- Decide between `mode: all` and `mode: each`, or set `waitForSubWorkflow`
- Want a workflow callable as an AI-agent tool
- Need to name sub-workflows so they're found, not rebuilt

**Example queries**:
- "My agent can't pass parameters to a sub-workflow — the trigger is on passthrough. How do I fix that?"
- "My per-customer sub-workflow runs once and aggregates everyone. Why?"
- "How do I make reusable sub-workflows discoverable so they don't get rebuilt?"
- "When should I use `mode: each` vs `all`?"
- "How do I expose a workflow as a tool my AI Agent can call?"

---

## File Structure

### SKILL.md
Main skill content — loaded when the skill activates.
- A sub-workflow as a function: trigger → body → returned output
- The two non-negotiables: search first; Define Below over passthrough
- Should-this-be-a-sub-workflow decision tree
- Stateless vs deliberately stateful (and avoiding accidental state)
- Inputs/outputs as a contract; the legitimate final-Set exception
- Calling: `mode` all vs each, `waitForSubWorkflow`, the only true parallelization
- Splitting by input shape (the N+1 pattern), in brief
- Sub-workflow as an agent tool, in brief
- Anti-patterns table; what's NOT available via the community MCP
- Quick-reference checklist

### SUBWORKFLOW_PATTERNS.md
The three n8n-specific patterns in depth.
- `mode: all` vs `each` with a worked per-customer contrast
- Splitting by input shape — the reflexive mistake and the N+1 fix (binary vs ID worked example)
- Fire-and-forget parallelization with a Data Table status poll

### NAMING_AND_DISCOVERY.md
Discovery is naming, because the MCP can't filter by tags.
- Verb-first prefix convention (`Subworkflow:`, `<Domain>:`, `Tool:`)
- Search-before-build with `n8n_list_workflows` / `n8n_get_workflow`
- The description as a discoverability tool
- What a healthy library looks like; cross-project sharing; renaming

---

## Quick Reference

### Typed trigger (Define Below)
```json
{
  "type": "n8n-nodes-base.executeWorkflowTrigger",
  "parameters": {
    "workflowInputs": {
      "values": [
        { "name": "customer_id", "type": "string" },
        { "name": "include_orders", "type": "boolean" }
      ]
    }
  }
}
```

### Read an input in the body
```
{{ $json.customer_id }}
{{ $('When Executed by Another Workflow').first().json.customer_id }}
```

### Caller: run once per item (body assumes one item)
```
Execute Workflow → mode: "each"
```

### Caller: fire-and-forget (with a tracking Data Table)
```
Execute Workflow → mode: "each", options.waitForSubWorkflow: false
```

### Naming
- Verb-first prefix: `Subworkflow: Parse RFC2822 date`, `Customer: get by id`, `Tool: list credentials`
- Never `Helper 3` — it matches no search

---

## Integration with Other Skills

**n8n-workflow-patterns**: shape the orchestrating workflow there; decide which sections become sub-workflows here.

**n8n-mcp-tools-expert**: parameter formats for `n8n_list_workflows`, `n8n_get_workflow`, `n8n_update_partial_workflow`, and `n8n_manage_datatable`.

**n8n-node-configuration**: `workflowInputs` and the Define-Below / passthrough toggle are displayOptions-driven config on the Execute Workflow Trigger.

**n8n-expression-syntax**: reading inputs (`$json`, `$('When Executed by Another Workflow')`) and the legitimate final-`Set` exception.

**n8n-error-handling**: expected failures return `{ ok: false, error }`; unexpected ones throw and route through error outputs.

**n8n-validation-expert**: validate the sub-workflow and callers — but an unrecognized input field won't surface, so verify field changes by hand.

**n8n-code-javascript / n8n-code-python**: a Code-node body's contract is still the trigger's typed inputs and the returned shape.

**n8n-code-tool**: the Custom Code Tool is the *inline* agent-tool option; a sub-workflow tool is the reusable, multi-step one.

**n8n-agents**: wiring a typed sub-workflow as an agent tool (zero-input and binary cases).

**n8n-binary-and-data**: passthrough triggers for binary, and why binary can't flow through an agent tool directly.

**using-n8n-mcp-skills**: when to reach for which skill across a build.

---

## When NOT to extract

| Situation | Why not |
|---|---|
| One HTTP call with no logic | A trigger → HTTP → return wrapper adds a boundary for nothing |
| Tightly coupled to one caller's data shape | Extracting just relocates the coupling — fix the shape first |
| Performance-critical hot path | Each call adds (small but real) latency — profile before adding boundaries |

Everything else that's >5 nodes and conceptually one thing, or a generic concern (auth, retry, parsing, formatting), is a strong extract.

---

## Success Metrics

After using this skill, you should be able to:

- [ ] Search the library before building, and name new sub-workflows so they're found
- [ ] Declare typed Define-Below inputs (and know the two passthrough exceptions)
- [ ] Pick `mode: each` vs `all` from whether the body assumes a single item
- [ ] Set `waitForSubWorkflow` deliberately, and know `each` + `false` is the only true parallelization
- [ ] Return a natural, consistent output shape via a final `Return` Set node
- [ ] Build deliberately stateful sub-workflows without accidental state
- [ ] Split a capability into N+1 sub-workflows when its input contracts diverge
- [ ] Wire a typed sub-workflow as an AI-agent tool

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n with `n8n-nodes-base.executeWorkflowTrigger` and `n8n-nodes-base.executeWorkflow`; typed `workflowInputs` (Define Below) on recent versions.

---

**Remember**: a sub-workflow is a function. Its API is the trigger's typed inputs and the last node's output shape — make both explicit, name it so it's found, and call it with the `mode` its body expects.
