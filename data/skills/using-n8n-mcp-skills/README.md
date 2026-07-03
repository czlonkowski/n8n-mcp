# Using n8n-mcp Skills (Router)

The always-on router for the n8n-mcp-skills pack. Loaded into every session by the
plugin's `SessionStart` hook, it tells Claude **which** skill owns the task at hand,
gives working knowledge of every n8n-mcp tool from turn one, and states the
cross-cutting rules.

---

## What This Skill Teaches

### Core Concepts
1. **Route first** — recognize which skill owns your task before the first MCP call
2. **Three non-negotiables** — invoke the matching skill before any n8n action; validate AND verify connections before activating; secrets only via the credential system
3. **Lean on skills + live tools, not training data** — n8n drifts faster than the model cutoff
4. **Strong defaults** — Code node is a last resort; a Set node feeding ≤1 consumer is an antipattern; per-item iteration is automatic
5. **The n8n-mcp tool surface** — a one-line summary of every tool, including the SHORT-vs-LONG node-type-form trap and the absence of an `execute_workflow` tool

---

## Skill Activation

This skill is loaded automatically at session start (via the `SessionStart` hook) when
the pack is installed as a Claude Code / Codex plugin. It also activates by description
whenever the user mentions n8n, workflows, nodes, or automation — which makes it work as
a plain skill on Claude.ai too, where hooks are not available.

**Example queries**:
- "Build me an n8n workflow that …"
- "Which n8n skill should I use for …?"
- "How do I edit a workflow with the n8n-mcp tools?"

---

## File Structure

### SKILL.md
The router itself — loaded every session.
- The three non-negotiables and strong defaults
- The "about to ___ → invoke ___" red-flags table
- The skill index (which skill owns what)
- A compact reference for every n8n-mcp tool
- The protocol, in order; and the common "when in doubt" cases

This skill has no reference files — it is intentionally a thin router. Depth lives in the
skills it points to.

---

## Integration with Other Skills

This skill points to every other skill in the pack. It does not duplicate their content;
it routes to them. The skills it most often hands off to first are
`n8n-mcp-tools-expert` (tool usage), `n8n-workflow-patterns` (architecture), and
`n8n-node-configuration` (node setup).

---

## How It's Loaded

The plugin's `hooks/session-start.sh` reads this `SKILL.md` and injects it as
`additionalContext` at the start of every session, re-firing on resume/clear/compact so
the protocol survives compaction. If the file is missing or hooks aren't available, the
session proceeds normally and the skill still activates by its description.

---

## Version

**Version**: 1.0.0
**Compatibility**: n8n-mcp MCP server; hooks require the Claude Code / Codex plugin install.

---

## Credits

Part of the n8n-skills project.

**Remember**: this is a router. It names the skill that owns your task — then get out of
the way and let that skill do the work.
