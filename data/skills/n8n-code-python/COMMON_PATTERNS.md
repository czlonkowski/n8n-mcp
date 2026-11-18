# Common Patterns — native Python Code node

Twelve import-free patterns. Each block below was run verbatim in a Code node (`language: "pythonNative"`) on n8n 2.38.5 against the sample input shown, and the noted output was observed. They use only `_items` / `_item`, dict access, and builtins that the sandbox allows — no imports, classes, `type()`, or dunders (see SKILL.md → Sandbox limits).

Before using any of these, re-check the first rule of the skill: **is Python actually what the user asked for?** Most of these are one expression, an Edit Fields field, or a native node (Filter, Aggregate, Split Out, Remove Duplicates, Sort, Limit) in a JavaScript-first workflow.

**Sample input** (3 items, e.g. after Split Out):

```json
[
  {"name": "Acme", "country": "PL", "revenue": 120000, "active": true,  "contact": {"email": "a@acme.pl", "first-name": "Jan"},  "orders": [{"id": "A1", "total": 500}, {"id": "A2", "total": 1500}]},
  {"name": "Foo",  "country": "DE", "revenue": 30000,  "active": false, "contact": {"email": "f@foo.de", "first-name": "Hans"}, "orders": [{"id": "F1", "total": 90}]},
  {"name": "Bar",  "country": "PL", "revenue": 80000,  "active": true,  "contact": {"email": null, "first-name": "Ola"},       "orders": []}
]
```

| # | Pattern | Mode |
|---|---|---|
| 1 | Filter and reshape | All Items |
| 2 | Totals and averages | All Items |
| 3 | Group by a field | All Items |
| 4 | Deduplicate by key | All Items |
| 5 | Top N by a field | All Items |
| 6 | One item per nested element | All Items |
| 7 | Validate and flag | Each Item |
| 8 | Keep only some items (each-item) | Each Item |
| 9 | Text report | All Items |
| 10 | Safe nested access | All Items |
| 11 | Running state with nonlocal | All Items |
| 12 | ISO timestamps without datetime | All Items |

---

## 1. Filter and reshape

**Mode:** Run Once for All Items. Keep active customers above a threshold and emit only the fields downstream needs.

```python
return [
    {"json": {"name": it["json"]["name"], "revenue": it["json"]["revenue"]}}
    for it in _items
    if it["json"].get("active") and it["json"].get("revenue", 0) >= 50000
]
```

**Output:** 2 items: `{name, revenue}` for Acme and Bar.

---

## 2. Totals and averages

**Mode:** Run Once for All Items. One summary item from all input items. `max(..., default=0)` and the `if count` guard keep empty input from raising.

```python
revenues = [it["json"].get("revenue") or 0 for it in _items]
count = len(revenues)
return [{"json": {
    "count": count,
    "total": sum(revenues),
    "average": round(sum(revenues) / count, 2) if count else 0,
    "max": max(revenues, default=0),
}}]
```

**Output:** `{count: 3, total: 230000, average: 76666.67, max: 120000}`

---

## 3. Group by a field

**Mode:** Run Once for All Items. `setdefault` builds the buckets; emit one item per group, sorted.

```python
groups = {}
for it in _items:
    row = it["json"]
    key = row.get("country") or "unknown"
    groups.setdefault(key, {"country": key, "customers": [], "revenue": 0})
    groups[key]["customers"].append(row["name"])
    groups[key]["revenue"] += row.get("revenue") or 0
return [{"json": g} for g in sorted(groups.values(), key=lambda g: g["revenue"], reverse=True)]
```

**Output:** `{country: "PL", customers: ["Acme", "Bar"], revenue: 200000}`, then DE.

---

## 4. Deduplicate by key

**Mode:** Run Once for All Items. Keeps the first item per normalized key and returns the original items, so all fields are preserved.

```python
seen = set()
unique = []
for it in _items:
    key = (it["json"].get("country") or "").lower()
    if key in seen:
        continue
    seen.add(key)
    unique.append(it)
return unique
```

**Output:** 2 items (first PL, first DE).

---

## 5. Top N by a field

**Mode:** Run Once for All Items. `sorted(..., key=..., reverse=True)[:N]` then rank with `enumerate`.

```python
top = sorted(_items, key=lambda it: it["json"].get("revenue") or 0, reverse=True)[:2]
return [{"json": {"rank": i + 1, "name": it["json"]["name"]}} for i, it in enumerate(top)]
```

**Output:** `{rank: 1, name: "Acme"}`, `{rank: 2, name: "Bar"}`

---

## 6. One item per nested element

**Mode:** Run Once for All Items. Fan an array inside each item out into separate items — the Python equivalent of Split Out with parent fields attached.

```python
out = []
for it in _items:
    customer = it["json"]
    for order in customer.get("orders", []):
        out.append({"json": {"customer": customer["name"], "order_id": order["id"], "total": order["total"]}})
return out
```

**Output:** 3 items: `{customer, order_id, total}`

---

## 7. Validate and flag

**Mode:** Run Once for Each Item. Each-item mode: attach `valid` + `problems` instead of failing the run; route on `valid` with an IF node afterwards.

```python
row = _item["json"]
problems = []
if not row.get("name"):
    problems.append("name missing")
email = (row.get("contact") or {}).get("email")
if not email or "@" not in email:
    problems.append("email missing or invalid")
return {"json": {**row, "valid": not problems, "problems": problems}}
```

**Output:** Bar gets `valid: false, problems: ["email missing or invalid"]`.

---

## 8. Keep only some items (each-item)

**Mode:** Run Once for Each Item. In each-item mode `return None` drops the item — a Filter node in code form.

```python
if _item["json"].get("country") != "PL":
    return None
return _item
```

**Output:** 2 items (the PL customers).

---

## 9. Text report

**Mode:** Run Once for All Items. f-strings with format specs (`:,`) and `"\n".join` for a message body (Slack, email).

```python
lines = [
    f"- {it['json']['name']} ({it['json']['country']}): {it['json']['revenue']:,} PLN"
    for it in sorted(_items, key=lambda it: it["json"]["name"])
]
return [{"json": {"report": "Customers:\n" + "\n".join(lines), "lines": len(lines)}}]
```

**Output:** `"Customers:\n- Acme (PL): 120,000 PLN\n- Bar (PL): 80,000 PLN\n- Foo (DE): 30,000 PLN"`

---

## 10. Safe nested access

**Mode:** Run Once for All Items. A small `dig()` helper instead of chained `[...]` lookups that raise on missing keys/indexes. `isinstance` replaces the denied `type()`.

```python
def dig(data, *path, default=None):
    for key in path:
        if isinstance(data, dict) and key in data:
            data = data[key]
        elif isinstance(data, list) and isinstance(key, int) and -len(data) <= key < len(data):
            data = data[key]
        else:
            return default
    return data

return [{"json": {
    "first_order_total": dig(it["json"], "orders", 0, "total", default=0),
    "first_name": dig(it["json"], "contact", "first-name", default=""),
}} for it in _items]
```

**Output:** Bar (no orders) gets `first_order_total: 0`.

---

## 11. Running state with nonlocal

**Mode:** Run Once for All Items. Code runs inside a wrapper function, so `global` fails — use `nonlocal` for state shared with helper functions.

```python
running = 0
def add(value):
    nonlocal running
    running += value
    return running

return [{"json": {"name": it["json"]["name"], "cumulative": add(it["json"]["revenue"])}} for it in _items]
```

**Output:** cumulative 120000 → 150000 → 230000

---

## 12. ISO timestamps without datetime

**Mode:** Run Once for All Items. *Illustrative, no input needed* (the timestamps are inline). With no `datetime` import, ISO-8601 strings in the same timezone still sort and compare correctly as strings; slice for year/month buckets. Real date math belongs in expressions (Luxon) or JS.

```python
stamps = ["2026-09-16T10:00:00Z", "2026-01-02T08:30:00Z", "2025-12-31T23:59:59Z"]
return [{"json": {
    "latest": max(stamps),
    "in_2026": [s for s in stamps if s[:4] == "2026"],
    "by_month": sorted({s[:7] for s in stamps}),
}}]
```

**Output:** `latest: "2026-09-16T10:00:00Z"`, `by_month: ["2025-12", "2026-01", "2026-09"]`

---

## Not covered here — and why

- **Parsing JSON strings, regex, hashing, real date arithmetic** need `json` / `re` / `hashlib` / `datetime`, which are blocked unless the instance allowlists them. Do these with a native node or an expression first (Date & Time or Luxon, `.parseJson()`, `.match()`, the Crypto node), or in a JavaScript Code node.
- **Reading another node's output** — native Python has no `_node`. Merge the branches first, or use JavaScript `$('Node Name')`.
- **HTTP calls** — HTTP Request node.
