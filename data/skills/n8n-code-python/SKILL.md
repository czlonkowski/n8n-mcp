---
name: n8n-code-python
description: Write Python in n8n Code nodes (native Python, `language` pythonNative, n8n 2.x). Use when the user explicitly wants Python in a Code node, when migrating old Pyodide/"Python (Beta)" code that used _input/_json/_node/_now, or when a Python Code node fails with NameError, "Security violations detected", "Import of standard library module … is disallowed", "__build_class__ not found", "A 'json' property isn't a dictionary", or "Python runner unavailable". Covers the only two variables (_items/_item), dict-only access, imports blocked by default, the sandbox's denied builtins, accepted return shapes, and how errors interact with onError. JavaScript is the default for Code nodes — native Python has no n8n helpers and, by default, no imports. EXCEPTION — for Python in the AI-agent-callable Custom Code Tool (@n8n/n8n-nodes-langchain.toolCode), use the n8n-code-tool skill instead (input is _query, return must be a string).
---

# Python Code Node (native)

Since n8n 2.0 the Code node's Python runs as **native Python in a task runner** (`language:
"pythonNative"`). The old Pyodide "Python (Beta)" is gone, and with it every n8n helper it had:
`_input`, `_json`, `_node`, `_now`, `_today` and `_jmespath` all raise `NameError` now. Code copied
from old templates, forum posts or older docs usually breaks on this.

---

## JavaScript first — stronger than before

Native Python gives you two variables and plain Python, and **by default no imports**: no
`json`, `datetime` or `re`. Everything n8n-specific (`$('Node')`, `$jmespath`, Luxon,
`this.helpers.httpRequest`, static data) exists only in JavaScript. Use Python only when the user
explicitly asks for it. Even then, first check whether an expression, Edit Fields, or a native
node (Crypto, Date & Time, HTML, XML) does the job. See **n8n-code-javascript** and the transform
gatekeeper in **n8n-expression-syntax**.

---

## Quick start

```python
# Run Once for All Items (default mode)
return [
    {"json": {"name": it["json"]["name"], "revenue": it["json"]["revenue"]}}
    for it in _items
    if it["json"].get("active")
]
```

```python
# Run Once for Each Item
row = _item["json"]
return {"json": {**row, "name_upper": (row.get("name") or "").upper()}}
```

Node config: `{"language": "pythonNative", "mode": "runOnceForAllItems" | "runOnceForEachItem",
"pythonCode": "..."}` on `n8n-nodes-base.code` typeVersion 2.

---

## The only inputs: `_items` and `_item`

| Mode | Variable | Shape |
|---|---|---|
| Run Once for All Items | `_items` | `list` of plain dicts `{"json": {...}, "pairedItem": {...}}` |
| Run Once for Each Item | `_item` | one plain dict `{"json": {...}, "pairedItem": {...}}` |

- Each variable exists **only in its own mode**. `_items` in each-item mode (or `_item` in
  all-items mode) raises `NameError`.
- **Dict access only.** `it["json"]["name"]` or `it["json"].get("name")`. `it.json.name` raises
  `AttributeError: 'dict' object has no attribute 'json'`.
- **No other nodes.** There is no `_node` / `$('Node')` equivalent. If you need data from another
  branch, bring it in with Merge first, or read it in JavaScript.
- **Webhook payloads** are under `["body"]`: `_items[0]["json"].get("body", {}).get("email")`.
- **Binary data** isn't covered here. Read and write binary in JavaScript (see **n8n-binary-and-data**).
- **pairedItem:** returning `_items` / `_item` keeps it. When you build new dicts and downstream
  uses `$('Node').item`, add `"pairedItem": {"item": i}` to each returned item. That isn't
  verified on native Python yet, so test-run before relying on it.
- Missing keys: prefer `.get(key, default)`. `row["missing"]` raises `KeyError`.

Migration table for legacy code:

| Legacy (Pyodide) | Native |
|---|---|
| `_input.all()` | `_items` |
| `_input.first()["json"]` | `_items[0]["json"]` (guard `if _items`) |
| `_input.item` / `_json` | `_item` / `_item["json"]` |
| `_node["X"]` | not available: Merge upstream, or use JS |
| `_now`, `_today` | not available: pass `{{ $now.toISO() }}` in via Edit Fields, or use JS |
| `_jmespath(data, q)` | not available: `$jmespath` in an expression, or a comprehension |
| `item.json.field` | `item["json"]["field"]` |

---

## Imports: blocked by default

Every `import` (standard library and third-party) is checked against an allowlist **before the
code runs**. The default allowlist is empty, so even `import json` rejects the whole node:

```
Security violations detected
Line 1: Import of standard library module 'json' is disallowed. Allowed stdlib modules: none
```

- **n8n Cloud:** no imports at all.
- **Self-hosted:** the admin can allowlist modules in the task-runner config (see
  **n8n-self-hosting** → `TASK_RUNNERS.md`). Some instances therefore allow `json`, `datetime`
  and `re`, and most don't.
- **Default to import-free code.** If an import would really help, confirm it first: a
  one-line test node `import json` + `return [{"json": {"ok": True}}]`, or ask the user. Never
  assume.
- Without imports: parse JSON strings upstream (`{{ JSON.parse($json.payload) }}` in Edit Fields).
  Do date math with the Date & Time node or Luxon in an expression. ISO-8601 strings still compare and sort correctly as
  plain strings. Use the Crypto node for hashing.
- `requests`, `pandas` and `numpy` are never available unless the admin built a custom runner
  image. Use the HTTP Request node for HTTP.

---

## Sandbox limits (these fail even without imports)

| You write | What happens | Use instead |
|---|---|---|
| `eval`, `exec`, `compile`, `open`, `input`, `type`, `getattr`, `setattr`, `hasattr`, `vars`, `dir`, `globals`, `locals`, `object`, `memoryview`, `breakpoint` | `NameError: name 'type' is not defined` (runtime) | `isinstance(x, dict)`; `key in d` / `d.get(key)` |
| `class Foo: ...` | `__build_class__ not found` (runtime) | dicts + functions |
| `x.__class__`, `"{0.__class__}".format(x)`, `__import__("json")` | `Security violations detected` (whole node rejected before running) | — |
| `global counter` inside a function | `NameError: name 'counter' is not defined`, because your code runs inside a wrapper function | `nonlocal counter` |

Everything else in plain Python works (verified): comprehensions, generators, lambdas, closures,
recursion, `try`/`except`, f-strings / `.format()` / `%`, `sorted`/`min`/`max`/`sum`/`any`/`all`/
`enumerate`/`zip`/`round`, sets, `isinstance`, `print()` (output goes to the browser console).

---

## Return shapes (verified)

Observed on n8n 2.38.5. The auto-wrapping and passthrough behaviours below are undocumented and could
change in a later release. Re-check with a test run after upgrading n8n.

**Run Once for All Items**

| Return | Result |
|---|---|
| `[{"json": {...}}, ...]` | canonical, N items |
| `[{...}, ...]` (plain dicts) | auto-wrapped under `json`, N items |
| `{"json": {...}}` or a single plain dict | 1 item |
| `_items` (mutated in place) | passthrough with your changes |
| `None` / no `return` | error `Cannot read properties of null (reading 'json')` |

**Run Once for Each Item**

| Return | Result |
|---|---|
| `{"json": {...}}`, a plain dict, or `_item` | 1 item |
| `None` | the item is **dropped** (a built-in filter) |
| a **list** | error `A 'json' property isn't a dictionary [item 0]` |

**Value conversion on output:** `tuple` becomes a list, `set` becomes the *string* `"{1, 2}"`,
and a `datetime` becomes `str(dt)` (`"2026-09-16 10:18:00.025792"`, not ISO). Convert explicitly
(`sorted(s)`, `dt.isoformat()`).

Prefer the explicit `[{"json": ...}]` in all-items mode and `{"json": ...}` in each-item mode.
The auto-wrapping works, but the explicit shape makes the intent obvious to the next reader.

---

## Errors and `onError`

A plain `raise ValueError("bad row")` fails the node with that message. When the node has an
`onError` continue mode, the three failure kinds behave **differently** (verified):

| Failure | `continueErrorOutput` | `continueRegularOutput` |
|---|---|---|
| Runtime exception (`raise`, `KeyError`, `NameError`, denied builtin) | `{"error": "<message>"}` on the error output (`main[1]`) ✅ | `{"error": "<message>"}` on the main output |
| Static rejection (`Security violations detected`: import, dunder) | node marked failed, but the **input items, unchanged, go out the success output**; `main[1]` stays empty | input items, unchanged, on the main output |
| Bad return shape (list in each-item mode, `None` in all-items mode) | same: **unchanged input on the success output** | same |

The last two are silent-data traps: downstream nodes receive unprocessed input as if the code had
run, and the execution still shows success. No error branch catches them. Prevent them (no
imports unless confirmed, correct return shape) and confirm with a real test run, checking the
Code node's status and output (see **n8n-error-handling**).

Other messages:

- `Python runner unavailable: Python 3 is missing from this system`: the self-hosted instance has
  no Python task runner (the stock image ships none). It's an infrastructure problem, not a code
  problem. See **n8n-self-hosting** → `TASK_RUNNERS.md`.
- `validate_node` / `validate_workflow` catch a few Python mistakes (`import requests`, missing
  `return`, `return None`). They do **not** catch `_input`/`_json`, dot access, blocked stdlib
  imports, dunder access or classes. A test execution is the only reliable check.

---

## Performance

Each Python Code node costs roughly 0.4 s (about 1 s when the runner is cold), noticeably more
than a JS Code node or an expression. Process lists in **Run Once for All Items** mode rather than
per item, and don't chain several small Python nodes where one would do.

---

## Checklist

- [ ] The user actually asked for Python. Otherwise JS, an expression, or a native node.
- [ ] Mode matches the variable: `_items` (all items) / `_item` (each item).
- [ ] Only dict access. No `_input`, `_json`, `_node`, `_now` or `_jmespath`.
- [ ] No `import` unless confirmed allowlisted on *this* instance.
- [ ] No classes, `type()`, `getattr`/`hasattr` or dunders. `nonlocal` instead of `global`.
- [ ] Return shape fits the mode. Sets and datetimes converted explicitly.
- [ ] Ran a real test execution and inspected the output items (validation alone won't catch the traps above).

---

## Reference

- **[COMMON_PATTERNS.md](COMMON_PATTERNS.md)**: 12 import-free patterns, each verified on a live
  n8n instance (filter, aggregate, group, dedupe, top N, flatten, validate, drop items, text
  report, safe nested access, running totals, ISO timestamps).

## Related skills

- **n8n-code-javascript**: the default for Code nodes, with all n8n helpers.
- **n8n-expression-syntax**: `$jmespath`, Luxon and the transform gatekeeper, often a better fit than any Code node.
- **n8n-code-tool**: Python in the AI-agent Custom Code Tool (`_query`, returns a string).
- **n8n-error-handling**: wiring error outputs; the passthrough trap above.
- **n8n-self-hosting**: enabling the Python task runner and allowlisting modules.
