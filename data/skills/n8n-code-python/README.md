# n8n Code Python Skill

Guidance for writing **native Python** in n8n Code nodes (`language: "pythonNative"`, n8n 2.x).

---

## Why this skill exists

n8n 2.0 removed the Pyodide-based "Python (Beta)" and replaced it with native Python running in a
task runner. A large share of the Python n8n code in circulation (templates, forum answers, older
docs, model training data) targets the old runtime and fails on the new one:

- `_input`, `_json`, `_node`, `_now`, `_today`, `_jmespath` → `NameError` (only `_items` / `_item` exist)
- `item.json.field` → `AttributeError` (dict access only)
- `import json` → `Security violations detected` (every import is blocked unless the instance allowlists it; n8n Cloud allows none)
- `class Foo:` → `__build_class__ not found`; `type()`, `getattr()`, `hasattr()` → `NameError`

The skill teaches the runtime as it actually behaves. Every rule and pattern was verified by
execution on n8n 2.38.5, and the skill keeps pushing agents toward JavaScript, expressions, and
native nodes whenever the user hasn't explicitly asked for Python.

---

## Skill activation

- The user explicitly wants a Python Code node
- Migrating legacy Pyodide Python (`_input.all()`, `_json`, `_node[...]`)
- A Python Code node fails with `NameError`, `Security violations detected`, `Import of standard library module … is disallowed`, `A 'json' property isn't a dictionary`, or `Python runner unavailable`

**Not** for the AI-agent Custom Code Tool (`toolCode`) — that's **n8n-code-tool**.

**Example queries**:
- "Write a Python Code node that groups these items by country."
- "My Python Code node says name '_input' is not defined."
- "Why can't I import json in the Python Code node?"

---

## File structure

### SKILL.md
JavaScript-first rule; `_items` / `_item` and dict-only access; legacy→native migration table;
imports blocked by default (Cloud vs self-hosted allowlist); sandbox limits (denied builtins, no
classes, no dunders, `nonlocal` instead of `global`); verified return shapes per mode and output
value conversion; how runtime vs static vs return-shape errors behave with `onError`; performance;
checklist.

### COMMON_PATTERNS.md
12 import-free patterns, each run verbatim on a live instance with the observed output: filter
and reshape, totals, group by, dedupe, top N, flatten nested arrays, validate and flag, drop items
in each-item mode, text report, safe nested access, running totals with `nonlocal`, ISO timestamps
without `datetime`.

---

## Related skills

- **n8n-code-javascript** — the default for Code nodes
- **n8n-expression-syntax** — `$jmespath`, Luxon, and the transform gatekeeper
- **n8n-code-tool** — Python in the AI-agent Custom Code Tool
- **n8n-error-handling** — error outputs and the `continueRegularOutput` passthrough trap
- **n8n-self-hosting** — enabling the Python task runner (`TASK_RUNNERS.md`)

---

## Version

**Version**: 2.0.0 — rewritten for native Python (n8n 2.x); replaces the Pyodide-era 1.x content
(STANDARD_LIBRARY.md, DATA_ACCESS.md and ERROR_PATTERNS.md were removed because they described a
runtime that no longer exists).
**Compatibility**: n8n ≥ 2.0 Code node, `language: "pythonNative"`.

---

## Credits

Part of the n8n-skills project.

**Conceived by Romuald Członkowski**
- Website: [aiadvisors.pl/en](https://aiadvisors.pl/en)
- Part of [n8n-mcp project](https://github.com/czlonkowski/n8n-mcp)
