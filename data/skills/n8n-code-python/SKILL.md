---
name: n8n-code-python
description: Write Python code in n8n Code nodes. Use when writing Python in n8n, using _input/_json/_node syntax, working with standard library, or need to understand Python limitations in n8n Code nodes. Use this skill when the user specifically requests Python for an n8n Code node. Note — JavaScript is recommended for 95% of use cases — only use Python when the user explicitly prefers it or the task requires Python-specific standard library capabilities (regex, hashlib, statistics). EXCEPTION — for Python in the AI-agent-callable Custom Code Tool (@n8n/n8n-nodes-langchain.toolCode), use the n8n-code-tool skill instead (input is _query, return must be a string).
---

# Python Code Node (Beta)

Expert guidance for writing Python code in n8n Code nodes.

---

## ⚠️ Important: JavaScript First

**Recommendation**: Use **JavaScript for 95% of use cases**. Only use Python when:
- You need specific Python standard library functions
- You're significantly more comfortable with Python syntax
- You're doing data transformations better suited to Python

**Why JavaScript is preferred:**
- Full n8n helper functions (`this.helpers.httpRequest`, etc.)
- Luxon DateTime library for advanced date/time operations
- No external library limitations
- Better n8n documentation and community support

---

## Quick Start

```python
# Basic template for Python Code nodes
items = _input.all()

# Process data
processed = []
for item in items:
    processed.append({
        "json": {
            **item["json"],
            "processed": True,
            "timestamp": datetime.now().isoformat()
        }
    })

return processed
```

### Essential Rules

1. **Consider JavaScript first** - Use Python only when necessary
2. **Access data**: `_input.all()`, `_input.first()`, or `_input.item`
3. **CRITICAL**: Must return `[{"json": {...}}]` format
4. **CRITICAL**: Webhook data is under `_json["body"]` (not `_json` directly)
5. **CRITICAL LIMITATION**: **No external libraries** (no requests, pandas, numpy)
6. **Standard library only**: json, datetime, re, base64, hashlib, urllib.parse, math, random, statistics

---

## Mode Selection Guide

Same as JavaScript - choose based on your use case:

### Run Once for All Items (Recommended - Default)

**Use this mode for:** 95% of use cases

- **How it works**: Code executes **once** regardless of input count
- **Data access**: `_input.all()` or `_items` array (Native mode)
- **Best for**: Aggregation, filtering, batch processing, transformations
- **Performance**: Faster for multiple items (single execution)

```python
# Example: Calculate total from all items
all_items = _input.all()
total = sum(item["json"].get("amount", 0) for item in all_items)

return [{
    "json": {
        "total": total,
        "count": len(all_items),
        "average": total / len(all_items) if all_items else 0
    }
}]
```

### Run Once for Each Item

**Use this mode for:** Specialized cases only

- **How it works**: Code executes **separately** for each input item
- **Data access**: `_input.item` or `_item` (Native mode)
- **Best for**: Item-specific logic, independent operations, per-item validation
- **Performance**: Slower for large datasets (multiple executions)

```python
# Example: Add processing timestamp to each item
item = _input.item

return [{
    "json": {
        **item["json"],
        "processed": True,
        "processed_at": datetime.now().isoformat()
    }
}]
```

---

## Python Modes: Beta vs Native

n8n offers two Python execution modes:

### Python (Beta) - Recommended
- **Use**: `_input`, `_json`, `_node` helper syntax
- **Best for**: Most Python use cases
- **Helpers available**: `_now`, `_today`, `_jmespath()`
- **Import**: `from datetime import datetime`

```python
# Python (Beta) example
items = _input.all()
now = _now  # Built-in datetime object

return [{
    "json": {
        "count": len(items),
        "timestamp": now.isoformat()
    }
}]
```

### Python (Native) (Beta)
- **Use**: `_items`, `_item` variables only
- **No helpers**: No `_input`, `_now`, etc.
- **More limited**: Standard Python only
- **Use when**: Need pure Python without n8n helpers

```python
# Python (Native) example
processed = []

for item in _items:
    processed.append({
        "json": {
            "id": item["json"].get("id"),
            "processed": True
        }
    })

return processed
```

**Recommendation**: Use **Python (Beta)** for better n8n integration.

---

## Data Access Patterns

Access input data through underscore-prefixed variables. Each item is a dict shaped `{"json": {...}}`, so the actual fields live under `["json"]`.

```python
# Pattern 1: _input.all() - Most common. Arrays, batch ops, aggregations
all_items = _input.all()            # list of {"json": {...}} dicts

# Pattern 2: _input.first() - Very common. Single objects, API responses
data = _input.first()["json"]       # built-in safety vs all_items[0]

# Pattern 3: _input.item - "Run Once for Each Item" mode ONLY
current = _input.item["json"]       # None/error in All Items mode

# Pattern 4: _node - Reference a specific named node
webhook_data = _node["Webhook"]["json"]
http_data = _node["HTTP Request"]["json"]
```

**See**: [DATA_ACCESS.md](DATA_ACCESS.md) for the comprehensive guide — six `_input.all()` recipes (filter, transform, aggregate, sort, group, deduplicate), `_input.first()` and `_input.item` examples, multi-node combining, the JS-vs-Python variable table, and the decision tree.

---

## Critical: Webhook Data Structure

**MOST COMMON MISTAKE**: Webhook data is nested under `["body"]`

```python
# ❌ WRONG - Will raise KeyError
name = _json["name"]
email = _json["email"]

# ✅ CORRECT - Webhook data is under ["body"]
name = _json["body"]["name"]
email = _json["body"]["email"]

# ✅ SAFER - Use .get() for safe access
webhook_data = _json.get("body", {})
name = webhook_data.get("name")
```

**Why**: Webhook node wraps all request data under `body` property. This includes POST data, query parameters, and JSON payloads.

**See**: [DATA_ACCESS.md](DATA_ACCESS.md) for full webhook structure details

---

## Return Format Requirements

**CRITICAL RULE**: Always return list of dictionaries with `"json"` key

### Correct Return Formats

```python
# ✅ Single result
return [{
    "json": {
        "field1": value1,
        "field2": value2
    }
}]

# ✅ Multiple results
return [
    {"json": {"id": 1, "data": "first"}},
    {"json": {"id": 2, "data": "second"}}
]

# ✅ List comprehension
transformed = [
    {"json": {"id": item["json"]["id"], "processed": True}}
    for item in _input.all()
    if item["json"].get("valid")
]
return transformed

# ✅ Empty result (when no data to return)
return []

# ✅ Conditional return
if should_process:
    return [{"json": processed_data}]
else:
    return []
```

### Incorrect Return Formats

```python
# ❌ WRONG: Dictionary without list wrapper
return {
    "json": {"field": value}
}

# ❌ WRONG: List without json wrapper
return [{"field": value}]

# ❌ WRONG: Plain string
return "processed"

# ❌ WRONG: Incomplete structure
return [{"data": value}]  # Should be {"json": value}
```

**Why it matters**: Next nodes expect list format. Incorrect format causes workflow execution to fail.

**See**: [ERROR_PATTERNS.md](ERROR_PATTERNS.md) #2 for detailed error solutions

---

## Critical Limitation: No External Libraries

**MOST IMPORTANT PYTHON LIMITATION**: Cannot import external packages on default installs.

> **Self-hosted exception**: external package availability depends entirely on the instance's Python runner configuration. If the user states their self-hosted instance has specific packages available in the Python runner environment, use them — don't refuse. When unsure, ask or write standard-library-only code.

**❌ NOT available** (raise `ModuleNotFoundError`): `requests`, `pandas`, `numpy`, `scipy`, `bs4`/BeautifulSoup, `lxml`.

**✅ Available** (standard library only): `json`, `datetime`, `re`, `base64`, `hashlib`, `urllib.parse`, `math`, `random`, `statistics`.

### Workarounds

**Need HTTP requests?**
- ✅ Use **HTTP Request node** before Code node
- ✅ Or switch to **JavaScript** and use `this.helpers.httpRequest()` (the bare `$helpers` global is undefined in the task-runner sandbox)

**Need data analysis (pandas/numpy)?**
- ✅ Use Python **statistics** module for basic stats
- ✅ Or switch to **JavaScript** for most operations
- ✅ Manual calculations with lists and dictionaries

**Need web scraping (BeautifulSoup)?**
- ✅ Use **HTTP Request node** + **HTML Extract node**
- ✅ Or switch to **JavaScript** with regex/string methods

**See**: [STANDARD_LIBRARY.md](STANDARD_LIBRARY.md) for complete reference

---

## Common Patterns Overview

Based on production workflows, the most useful Python patterns are:

1. **Data Transformation** - Transform all items with list comprehensions
2. **Filtering & Aggregation** - Sum, filter, count with built-in functions
3. **String Processing with Regex** - Extract patterns from text with `re`
4. **Data Validation** - Validate and clean data, attach error lists
5. **Statistical Analysis** - Calculate mean/median/stdev with the `statistics` module

Copy-ready snippets for all five live in [COMMON_PATTERNS.md](COMMON_PATTERNS.md#quick-pattern-snippets), alongside 10 fully detailed production patterns (multi-source aggregation, markdown parsing, JSON comparison, CRM normalization, dictionary lookup, top-N filtering, and more).

---

## Error Prevention - Top 5 Mistakes

1. **Importing external libraries** (Python-specific) → `import requests` raises `ModuleNotFoundError`. Use the HTTP Request node or JavaScript instead.
2. **Empty code or missing return** → every path must end with `return [{"json": ...}]`.
3. **Incorrect return format** → wrap in a list: `{"json": {...}}` becomes `[{"json": {...}}]`.
4. **KeyError on dictionary access** → use `.get()`: `_json.get("user", {}).get("name", "Unknown")`.
5. **Webhook body nesting** → read via `["body"]`: `_json.get("body", {}).get("email", "no-email")`.

**See**: [ERROR_PATTERNS.md](ERROR_PATTERNS.md) for the comprehensive guide — each error with wrong-vs-right code, error messages, nested-access fixes, an `AttributeError` bonus case, a prevention checklist, and a quick-fix table.

---

## Standard Library Reference

Most useful modules: `json` (parse/generate), `datetime` (dates + `timedelta`), `re` (regex), `base64` (encode/decode), `hashlib` (hashing), `urllib.parse` (URL ops), and `statistics` (mean/median/stdev). Also available: `math`, `random`, `collections`, `itertools`, `functools`.

For a condensed cheat sheet plus full per-module examples, see [STANDARD_LIBRARY.md](STANDARD_LIBRARY.md#quick-reference-most-useful-modules).

---

## Best Practices

### 1. Always Use .get() for Dictionary Access

```python
# ✅ SAFE: Won't crash if field missing
value = item["json"].get("field", "default")

# ❌ RISKY: Crashes if field doesn't exist
value = item["json"]["field"]
```

### 2. Handle None/Null Values Explicitly

```python
# ✅ GOOD: Default to 0 if None
amount = item["json"].get("amount") or 0

# ✅ GOOD: Check for None explicitly
text = item["json"].get("text")
if text is None:
    text = ""
```

### 3. Use List Comprehensions for Filtering

```python
# ✅ PYTHONIC: List comprehension
valid = [item for item in items if item["json"].get("active")]

# ❌ VERBOSE: Manual loop
valid = []
for item in items:
    if item["json"].get("active"):
        valid.append(item)
```

### 4. Return Consistent Structure

```python
# ✅ CONSISTENT: Always list with "json" key
return [{"json": result}]  # Single result
return results  # Multiple results (already formatted)
return []  # No results
```

### 5. Debug with print() Statements

```python
# Debug statements appear in browser console (F12)
items = _input.all()
print(f"Processing {len(items)} items")
print(f"First item: {items[0] if items else 'None'}")
```

---

## Production Gotchas

### SplitInBatches Loop Semantics

The SplitInBatches node has two outputs:
- `main[0]` = **done** — fires ONCE after all batches complete
- `main[1]` = **each batch** — fires for every batch (the loop body)

Always add a **Limit 1** node after the done output.

### Correct Node Reference Syntax

```python
# ❌ WRONG
data = _node['HTTP Request']['json']

# ✅ CORRECT - call .first() then access json
data = _node['HTTP Request'].first()['json']
```

### Cross-Iteration Data Not Available in Python

`$getWorkflowStaticData('global')` may not be available in Python Beta mode. If you need to accumulate data across SplitInBatches iterations, use a JavaScript Code node for the accumulation logic instead.

---

## When to Use Python vs JavaScript

### Use Python When:
- ✅ You need `statistics` module for statistical operations
- ✅ You're significantly more comfortable with Python syntax
- ✅ Your logic maps well to list comprehensions
- ✅ You need specific standard library functions

### Use JavaScript When:
- ✅ You need HTTP requests (`this.helpers.httpRequest()`)
- ✅ You need advanced date/time (DateTime/Luxon)
- ✅ You want better n8n integration
- ✅ **For 95% of use cases** (recommended)

### Consider Other Nodes When:
- ❌ Simple field mapping → Use **Set** node
- ❌ Basic filtering → Use **Filter** node
- ❌ Simple conditionals → Use **IF** or **Switch** node
- ❌ HTTP requests only → Use **HTTP Request** node

---

## Integration with Other Skills

### Works With:

**n8n Expression Syntax**:
- Expressions use `{{ }}` syntax in other nodes
- Code nodes use Python directly (no `{{ }}`)
- When to use expressions vs code

**n8n MCP Tools Expert**:
- How to find Code node: `search_nodes({query: "code"})`
- Get configuration help: `get_node({nodeType: "nodes-base.code"})`
- Validate code: `validate_node({nodeType: "nodes-base.code", config: {...}})`

**n8n Node Configuration**:
- Mode selection (All Items vs Each Item)
- Language selection (Python vs JavaScript)
- Understanding property dependencies

**n8n Workflow Patterns**:
- Code nodes in transformation step
- When to use Python vs JavaScript in patterns

**n8n Validation Expert**:
- Validate Code node configuration
- Handle validation errors
- Auto-fix common issues

**n8n Code JavaScript**:
- When to use JavaScript instead
- Comparison of JavaScript vs Python features
- Migration from Python to JavaScript

---

## Quick Reference Checklist

Before deploying Python Code nodes, verify:

- [ ] **Considered JavaScript first** - Using Python only when necessary
- [ ] **Code is not empty** - Must have meaningful logic
- [ ] **Return statement exists** - Must return list of dictionaries
- [ ] **Proper return format** - Each item: `{"json": {...}}`
- [ ] **Data access correct** - Using `_input.all()`, `_input.first()`, or `_input.item`
- [ ] **No external imports** - Only standard library (json, datetime, re, etc.)
- [ ] **Safe dictionary access** - Using `.get()` to avoid KeyError
- [ ] **Webhook data** - Access via `["body"]` if from webhook
- [ ] **Mode selection** - "All Items" for most cases
- [ ] **Output consistent** - All code paths return same structure

---

## Additional Resources

### Related Files
- [DATA_ACCESS.md](DATA_ACCESS.md) - Comprehensive Python data access patterns
- [COMMON_PATTERNS.md](COMMON_PATTERNS.md) - 10 Python patterns for n8n
- [ERROR_PATTERNS.md](ERROR_PATTERNS.md) - Top 5 errors and solutions
- [STANDARD_LIBRARY.md](STANDARD_LIBRARY.md) - Complete standard library reference

### n8n Documentation
- Code Node Guide: https://docs.n8n.io/code/code-node/
- Python in n8n: https://docs.n8n.io/code/builtin/python-modules/

---

**Ready to write Python in n8n Code nodes - but consider JavaScript first!** Use Python for specific needs, reference the error patterns guide to avoid common mistakes, and leverage the standard library effectively.
